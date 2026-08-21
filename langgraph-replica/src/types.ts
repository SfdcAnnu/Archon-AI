/**
 * The agent-graph spec — deliberately the SAME shape Archon stores in
 * Salesforce (AgentNode__c rows + CanvasJson__c edges, as loaded by
 * server/src/salesforce/* today). Nothing LangChain-specific lives here:
 * the point of the replica is that the DATA MODEL is unchanged and only
 * the RUNTIME underneath it is swapped for LangGraph.
 */

export type NodeType = 'ai' | 'subagent' | 'tool' | 'catalog';

export interface AgentNodeSpec {
  id: string;
  nodeType: NodeType;
  nodeSubType: string; // provider for ai/subagent ('openai' | 'anthropic' | 'google'), 'tool'/'catalog' otherwise
  label: string;
  config: {
    model?: string;
    systemPrompt?: string;
    routingDescription?: string; // subagent: what the router reads to decide handoff
    description?: string;        // tool/catalog: what the model reads
    actionType?: 'MCP' | 'Apex' | 'Flow';
    toolName?: string;
    requiresApproval?: boolean;
    provider?: string;           // catalog: which MCP server its tools come from
    allowedTools?: string[];     // catalog: the ticked tool names
  };
}

export interface ConnectionSpec {
  from: string;
  to: string;
  /** Same runtime rule as Archon's subagent-router.ts: subagent/tool
   *  attachment REQUIRES fromPort === 'tool'; catalog attachment is
   *  port-agnostic (adjacency only). The compiler enforces this so a
   *  miswired graph fails loudly here instead of silently at runtime. */
  fromPort: string;
  toPort: string;
}

export interface AgentGraphSpec {
  agent: {
    apiName: string;
    name: string;
    systemPrompt: string;
  };
  nodes: AgentNodeSpec[];
  connections: ConnectionSpec[];
}
