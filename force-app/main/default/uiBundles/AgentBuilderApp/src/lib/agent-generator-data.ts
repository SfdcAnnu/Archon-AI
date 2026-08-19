import { apexFetch } from './apex-client';
import { slugify } from './agents-data';
import type { AgentConnection, AgentDefinition, AgentGraph, AgentNode, ChecklistItem, NodeType, PortName } from '@/types/agent';

/**
 * Talks to AgentGeneratorRestService.cls, a thin passthrough to the Archon
 * Node server's /api/agent/generate (server/src/agent-generator/generate.ts)
 * — text/file requirement in, either a clarifying-question round-trip or a
 * complete generated agent graph out. See generate.ts's GeneratorMode doc
 * for why "mode" matters: chat and trigger agents use different node
 * vocabularies (ai/subagent/tool/catalog vs. trigger/ai/logic/action/catalog).
 */
const GENERATE_BASE = '/services/apexrest/agent-builder/generate/';
// Above AgentGeneratorRestService's own 60s callout ceiling, so a real
// backend timeout surfaces as a real error instead of the client racing
// ahead of a callout that would otherwise have succeeded — apexFetch's
// default 15s (fine for plain CRUD) is far too short for an LLM call.
const GENERATE_TIMEOUT_MS = 65000;

export type GeneratorMode = 'trigger' | 'chat';

export interface QaTurn {
  question: string;
  answer: string;
}

interface GeneratedNodeRaw {
  label: string;
  type: string;
  subType: string;
  config: Record<string, unknown>;
  rationale?: string;
  x?: number;
  y?: number;
}

interface GeneratedConnectionRaw {
  fromIndex: number;
  fromPort: string;
  toIndex: number;
  toPort: string;
}

interface GeneratedAgentRaw {
  kind: 'agent';
  agent: { name: string; department: string; description: string; knowledgeBase: string };
  nodes: GeneratedNodeRaw[];
  connections: GeneratedConnectionRaw[];
  setupChecklist: ChecklistItem[];
}

export type GenerateResponse = { kind: 'questions'; questions: string[] } | GeneratedAgentRaw;

export async function generateAgentFromRequirement(
  requirementText: string,
  mode: GeneratorMode,
  opts?: {
    fileBase64?: string;
    fileName?: string;
    qaHistory?: QaTurn[];
    resolvedCapabilities?: ResolvedCapability[];
    grounding?: GroundingPack;
  }
): Promise<GenerateResponse> {
  return apexFetch<GenerateResponse>(
    GENERATE_BASE,
    {
      method: 'POST',
      body: JSON.stringify({
        requirementText,
        mode,
        fileBase64: opts?.fileBase64,
        fileName: opts?.fileName,
        qaHistory: opts?.qaHistory ?? [],
        resolvedCapabilities: opts?.resolvedCapabilities,
        grounding: opts?.grounding,
      }),
    },
    GENERATE_TIMEOUT_MS
  );
}

// ── v2 guided flow: analyze + verify ─────────────────────────────────
// Same Apex endpoint, dispatched via body.op — see
// AgentGeneratorRestService.cls and server/src/agent-generator/analyze.ts
// (the server owns the plan/verify logic and the one-follow-up-max rule).

export type CapabilityResolution =
  | { kind: 'catalog'; provider: string; allowedTools: string[]; description: string }
  | { kind: 'mcp_tool'; provider: string; toolName: string; description: string }
  | { kind: 'apex_tool'; name: string; description: string }
  | { kind: 'flow_tool'; name: string; description: string }
  | { kind: 'instruction'; note: string }
  | { kind: 'deferred'; checklistTitle: string; description: string };

export interface CapabilityOption {
  id: string;
  label: string;
  description: string;
  resolution: CapabilityResolution;
}

export interface Capability {
  id: string;
  title: string;
  requirementQuote: string;
  status: 'resolved' | 'question' | 'no_node';
  /** Subagent/domain grouping — absent = attached to the root agent. */
  domain?: string;
  resolution?: CapabilityResolution;
  explanation?: string;
  question?: { text: string; options: CapabilityOption[]; recommendedId: string };
}

export interface CapabilityPlan {
  agentName: string;
  capabilities: Capability[];
}

/** Opaque to the client — echoed back verbatim on verify/generate calls. */
export type GroundingPack = Record<string, unknown>;

export interface ResolvedCapability {
  title: string;
  requirementQuote: string;
  domain?: string;
  resolution: CapabilityResolution;
}

export interface AnalyzeResponse {
  plan: CapabilityPlan;
  grounding: GroundingPack;
  /** Requirement + extracted file text combined server-side — reuse for generate. */
  requirementText: string;
}

export async function analyzeRequirement(
  requirementText: string,
  mode: GeneratorMode,
  opts?: { fileBase64?: string; fileName?: string }
): Promise<AnalyzeResponse> {
  return apexFetch<AnalyzeResponse>(
    GENERATE_BASE,
    {
      method: 'POST',
      body: JSON.stringify({
        op: 'analyze',
        requirementText,
        mode,
        fileBase64: opts?.fileBase64,
        fileName: opts?.fileName,
      }),
    },
    125000
  );
}

export type VerifyAnswerResponse =
  | { kind: 'resolved'; resolution: CapabilityResolution; userSummary: string }
  | { kind: 'question'; question: NonNullable<Capability['question']> };

export async function verifyCapabilityAnswer(
  capability: Capability,
  answerText: string,
  round: number,
  mode: GeneratorMode,
  grounding: GroundingPack
): Promise<VerifyAnswerResponse> {
  return apexFetch<VerifyAnswerResponse>(
    GENERATE_BASE,
    {
      method: 'POST',
      body: JSON.stringify({ op: 'verify', capability, answerText, round, mode, grounding }),
    },
    GENERATE_TIMEOUT_MS
  );
}

/** Converts the generator's index-based node/connection arrays (same
 *  encoding agentCanvas.js's handleSave writes, and what CanvasJson__c
 *  stores) into a real client-side AgentGraph — local `gen_N` node ids,
 *  matching the `new_N` convention agents-data.ts's createAgent() already
 *  uses for a not-yet-saved graph. Nothing is persisted here; the caller
 *  still goes through saveAgentGraph() once the user accepts the result. */
export function generatedResponseToGraph(resp: GeneratedAgentRaw, mode: GeneratorMode): AgentGraph {
  const apiName = slugify(resp.agent.name);
  const nodes: AgentNode[] = resp.nodes.map((n, i) => ({
    id: `gen_${i}`,
    name: n.label,
    nodeType: n.type as NodeType,
    nodeSubType: n.subType,
    config: n.config,
    positionX: n.x ?? 0,
    positionY: n.y ?? 0,
    sortOrder: i,
    isEnabled: true,
    mcpServer: null,
    mcpTool: null,
    aiEngineConnectionId: null,
  }));

  const connections: AgentConnection[] = resp.connections
    .filter(c => nodes[c.fromIndex] && nodes[c.toIndex])
    .map((c, i) => ({
      id: `gen_c${i}`,
      fromNodeId: nodes[c.fromIndex].id,
      fromPort: c.fromPort as PortName,
      toNodeId: nodes[c.toIndex].id,
      toPort: c.toPort as PortName,
    }));

  const agent: AgentDefinition = {
    id: '',
    apiName,
    name: resp.agent.name,
    department: resp.agent.department,
    description: resp.agent.description,
    knowledgeBase: resp.agent.knowledgeBase,
    status: 'Draft',
    executeType: mode === 'chat' ? 'Chat' : 'Trigger',
    accessMode: 'Org',
    setupChecklist: resp.setupChecklist ?? [],
  };

  return { agent, nodes, connections };
}
