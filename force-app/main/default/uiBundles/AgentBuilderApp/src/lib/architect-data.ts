import { apexFetch } from './apex-client';

const BASE = '/services/apexrest/agent-builder/architect';

export type BuildStepState = 'pending' | 'running' | 'done' | 'warn' | 'failed';

export interface BuildStep {
  key: string;
  label: string;
  state: BuildStepState;
  detail?: string;
}

export interface BuildPrerequisite {
  id: string;
  kind: string;
  title: string;
  why: string;
  steps: string[];
  assignee: string;
  blocking: boolean;
  status: string;
  estimatedEffort?: string;
}

export interface BuildResult {
  agentId: string;
  apiName: string;
  status: string;
  summarySteps: string[];
  shape: string;
  prerequisites: BuildPrerequisite[];
  estimate: { costPerRunUsd: number; latencySeconds: number };
  assumptions: string[];
  notes: string[];
  confidence: string;
}

export interface BuildJobView {
  jobId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  steps: BuildStep[];
  costUsd: number;
  maxCostUsd: number;
  elapsedMs: number;
  result?: BuildResult;
  error?: string;
}

/** Starts the async build. Returns the job id to poll. */
export async function startArchitectBuild(input: {
  requirement: string;
  attachmentText?: string;
  maxCostUsd?: number;
}): Promise<string> {
  const res = await apexFetch<{ jobId: string }>(BASE, { method: 'POST', body: JSON.stringify(input) }, 60000);
  return res.jobId;
}

export async function getArchitectBuild(jobId: string): Promise<BuildJobView> {
  return apexFetch<BuildJobView>(`${BASE}?jobId=${encodeURIComponent(jobId)}`, { method: 'GET' }, 30000);
}

/** Who a prerequisite belongs to, in the client's vocabulary. */
export const ASSIGNEE_LABEL: Record<string, string> = {
  salesforce_admin: 'Needs your Salesforce admin',
  apex_developer: 'Needs an Apex developer',
  integration_owner: 'Needs whoever owns the integration',
  data_owner: 'Needs the data owner',
  business_owner: 'Needs a business decision',
};

// ── ✦ Rewrite an instruction for the model that will run it ──────────
export interface RewriteResult {
  instructions: string;
  changed: string[];
  costUsd: number;
}

export async function rewritePrompt(input: {
  draft: string;
  role: 'agent' | 'subagent' | 'tool';
  modelId: string;
  agentName?: string;
  department?: string;
  channel?: string;
  toolNames?: string[];
}): Promise<RewriteResult> {
  return apexFetch<RewriteResult>(
    `${BASE}/rewrite`,
    { method: 'POST', body: JSON.stringify({ action: 'rewrite', ...input }) },
    120000,
  );
}

// ── ✦ Ask Archon ─────────────────────────────────────────────────────
export type CopilotOperation =
  | { kind: 'setInstructions'; nodeId: string; value: string; why: string }
  | { kind: 'setDescription'; nodeId: string; value: string; why: string }
  | { kind: 'setRoutingDescription'; nodeId: string; value: string; why: string }
  | { kind: 'setModel'; nodeId: string; value: string; why: string }
  | { kind: 'setApproval'; nodeId: string; value: boolean; why: string }
  | { kind: 'setContextPolicy'; nodeId: string; value: 'isolated' | 'windowed' | 'full'; why: string }
  | { kind: 'setMode'; nodeId: string; value: 'call' | 'transfer'; why: string };

export interface CopilotReply {
  reply: string;
  operations: CopilotOperation[];
  costUsd: number;
}

export async function askArchon(input: {
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  agent?: {
    apiName: string;
    name: string;
    department?: string;
    nodes: Array<{ id: string; name: string; nodeType: string; nodeSubType: string; config: Record<string, unknown> }>;
  };
}): Promise<CopilotReply> {
  return apexFetch<CopilotReply>(
    `${BASE}/copilot`,
    { method: 'POST', body: JSON.stringify({ action: 'copilot', ...input }) },
    120000,
  );
}

/** Human label for a proposed change, for the preview list. */
export const OPERATION_LABEL: Record<CopilotOperation['kind'], string> = {
  setInstructions: 'Rewrite its instructions',
  setDescription: 'Change the description',
  setRoutingDescription: 'Change when it gets used',
  setModel: 'Change the model',
  setApproval: 'Change the approval setting',
  setContextPolicy: 'Change what it can see',
  setMode: 'Change how it answers',
};
