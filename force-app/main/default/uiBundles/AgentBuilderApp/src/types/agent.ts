/**
 * Mirrors the real AgentNode__c / AgentDefinition__c shape (Salesforce
 * side: force-app/main/default/objects/AgentNode__c, .../AgentDefinition__c)
 * and the graph connection shape written by agentCanvas.js's handleSave /
 * read by server/src/orchestrator/graph.ts. Kept in one file so the mock
 * data, the canvas, and the (future) Salesforce data layer all agree on
 * one contract.
 */

export type NodeType =
  | 'trigger'
  | 'ai'
  | 'action'
  | 'logic'
  | 'email'
  | 'sms'
  | 'storage'
  | 'end'
  | 'catalog'
  | 'subagent'
  | 'tool'
  | 'guardrail'
  | 'automation';

export type EngineSubType = 'claude' | 'gpt4' | 'gemini';

/** Config shapes per node type — matches the ConfigJson__c contract for
 *  subagent/tool nodes, and the existing catalog/ai node shapes already
 *  used by agentCanvas.js. */
export interface AiNodeConfig {
  model?: string;
  systemPrompt?: string;
  instruction?: string;
  useKnowledgeBase?: boolean;
}

export interface SubagentNodeConfig {
  routingDescription: string;
  systemPrompt: string;
  model?: string;
}

export interface ToolNodeConfig {
  description: string;
  actionType: 'MCP' | 'Apex' | 'Flow';
  toolName: string;
  connectorId: string;
  parameterSchema?: Record<string, unknown>;
  requiresApproval: boolean;
}

export interface CatalogNodeConfig {
  description: string;
  connectorId: string;
  provider?: string;
  allowedTools: string[];
}

/** ONE rule inside the agent's single Guardrails node — a line of control
 *  ("must never / only this"), enforced by the server. */
export interface GuardrailRule {
  kind: 'bannedWords' | 'numberLimit';
  /** bannedWords: words/phrases that must never reach the customer. */
  bannedWords?: string[];
  /** numberLimit (deal pricing): per-product max-discount % field on Product2. */
  maxDiscountField?: string;
  firstOfferPct?: number;
  defaultMaxPct?: number;
}

/** The agent's single Guardrails node: a LIST of restriction rules. At most
 *  one guardrail node per agent (enforced in the builder). The server maps
 *  it via readGuardrailsFromAgent (server-langchain/src/chat/
 *  pricing-guardrails.ts). */
export interface GuardrailNodeConfig {
  rules: GuardrailRule[];
}

/** An Automation node: system work that happens deterministically alongside
 *  the conversation — NOT a restriction. Any number per agent. */
export interface AutomationNodeConfig {
  mechanism: 'dataCapture' | 'followUpAction' | '';
  /** dataCapture: what to listen for (plain language), what to extract,
   *  where to save it, and optional prefilter keywords. */
  listenFor?: string;
  extract?: string[];
  targetField?: string;
  keywords?: string[];
  /** followUpAction: when the agent creates a Task/Event, set this field. */
  stageField?: string;
  fromStage?: string;
  toStage?: string;
}

export interface GenericNodeConfig {
  [key: string]: unknown;
}

export type NodeConfig =
  | AiNodeConfig
  | SubagentNodeConfig
  | ToolNodeConfig
  | CatalogNodeConfig
  | GuardrailNodeConfig
  | AutomationNodeConfig
  | GenericNodeConfig;

export interface AgentNode {
  /** Salesforce record Id — absent for a node created client-side and not
   *  yet saved (mirrors the LWC canvas's `new_N` local id convention). */
  id: string;
  name: string;
  nodeType: NodeType;
  nodeSubType: string;
  config: NodeConfig;
  positionX: number;
  positionY: number;
  sortOrder: number;
  isEnabled: boolean;
  mcpServer?: string | null;
  mcpTool?: string | null;
  aiEngineConnectionId?: string | null;
}

/** fromPort 'tool' is the ONE port that server/src/orchestrator/graph.ts's
 *  nextNodes() and subagent-router.ts actually read for subagent/catalog/
 *  tool attachment — see subagent-router.ts's module doc. Every other port
 *  name is structural flow (automation-mode chaining) and carries no
 *  special meaning here. */
export type PortName = 'in' | 'out' | 'tool' | 'yes' | 'no' | 'each' | 'done';

export interface AgentConnection {
  id: string;
  fromNodeId: string;
  fromPort: PortName;
  toNodeId: string;
  toPort: PortName;
}

/** Matches server/src/agent-generator/generate.ts's ChecklistItem shape —
 *  the generator is the primary producer of this data. */
export interface ChecklistItem {
  title: string;
  description: string;
  category: 'connector' | 'ai_engine' | 'review' | 'knowledge_base' | 'other';
}

export interface AgentDefinition {
  id: string;
  apiName: string;
  name: string;
  department: string;
  description: string;
  knowledgeBase: string;
  status: 'Draft' | 'Active' | 'Inactive';
  executeType: 'Trigger' | 'Chat' | 'Both';
  accessMode: 'Org' | 'PerUser';
  setupChecklist: ChecklistItem[];
}

export interface AgentGraph {
  agent: AgentDefinition;
  nodes: AgentNode[];
  connections: AgentConnection[];
}
