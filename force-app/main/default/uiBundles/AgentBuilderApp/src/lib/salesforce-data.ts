import { apexFetch } from './apex-client';
import type { AgentConnection, AgentDefinition, AgentGraph, AgentNode, ChecklistItem, PortName } from '@/types/agent';

/**
 * Talks to AgentBuilderRestService.cls (force-app/main/default/classes),
 * a thin Apex REST wrapper around the SAME AgentBuilderController.cls
 * logic the LWC canvas already uses. See apex-client.ts for why this
 * goes through Apex REST rather than an @AuraEnabled import, and why the
 * path is relative — confirmed working against a real deployed UI Bundle
 * (the live WhatsApp Revival agent) at that base path.
 */
const AGENT_BUILDER_BASE = '/services/apexrest/agent-builder/agent/';

// ── Raw Salesforce field shapes (exactly what AgentBuilderRestService /
//    AgentBuilderController return and expect — snake-Salesforce casing
//    kept verbatim here, translated to our clean camelCase types below). ──

interface RawAgentDefinition {
  Id: string;
  ApiName__c: string;
  Name: string;
  Department__c: string;
  Description__c: string;
  KnowledgeBase__c: string | null;
  Status__c: string;
  ExecuteType__c: string;
  AccessMode__c: string;
  CanvasJson__c: string | null;
  SetupChecklistJson__c: string | null;
}

interface RawAgentNode {
  Id: string;
  Name: string;
  NodeType__c: string;
  NodeSubType__c: string;
  ConfigJson__c: string | null;
  PositionX__c: number | null;
  PositionY__c: number | null;
  SortOrder__c: number | null;
  IsEnabled__c: boolean;
  McpServer__c: string | null;
  McpTool__c: string | null;
  AiEngineConnection__c: string | null;
}

interface RawAgentWithNodes {
  agent: RawAgentDefinition;
  nodes: RawAgentNode[];
}

interface RawCanvasConnection {
  id: string;
  fromIndex: number;
  fromPort: string;
  toIndex: number;
  toPort: string;
}

function parseSetupChecklist(json: string | null): ChecklistItem[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function fromRaw(raw: RawAgentWithNodes): AgentGraph {
  const nodes: AgentNode[] = raw.nodes.map(n => ({
    id: n.Id,
    name: n.Name,
    nodeType: n.NodeType__c as AgentNode['nodeType'],
    nodeSubType: n.NodeSubType__c,
    config: n.ConfigJson__c ? JSON.parse(n.ConfigJson__c) : {},
    positionX: n.PositionX__c ?? 0,
    positionY: n.PositionY__c ?? 0,
    sortOrder: n.SortOrder__c ?? 0,
    isEnabled: n.IsEnabled__c,
    mcpServer: n.McpServer__c,
    mcpTool: n.McpTool__c,
    aiEngineConnectionId: n.AiEngineConnection__c,
  }));

  // CanvasJson__c connections are index-based (position in `nodes`), not
  // id-based — matches exactly what agentCanvas.js's handleSave writes.
  const canvasJson = raw.agent.CanvasJson__c ? JSON.parse(raw.agent.CanvasJson__c) : { connections: [] };
  const rawConnections: RawCanvasConnection[] = canvasJson.connections ?? [];
  const connections: AgentConnection[] = rawConnections
    .filter(c => nodes[c.fromIndex] && nodes[c.toIndex])
    .map(c => ({
      id: c.id,
      fromNodeId: nodes[c.fromIndex].id,
      fromPort: c.fromPort as PortName,
      toNodeId: nodes[c.toIndex].id,
      toPort: c.toPort as PortName,
    }));

  const agent: AgentDefinition = {
    id: raw.agent.Id,
    apiName: raw.agent.ApiName__c,
    name: raw.agent.Name,
    department: raw.agent.Department__c,
    description: raw.agent.Description__c ?? '',
    knowledgeBase: raw.agent.KnowledgeBase__c ?? '',
    status: raw.agent.Status__c as AgentDefinition['status'],
    executeType: raw.agent.ExecuteType__c as AgentDefinition['executeType'],
    accessMode: raw.agent.AccessMode__c as AgentDefinition['accessMode'],
    setupChecklist: parseSetupChecklist(raw.agent.SetupChecklistJson__c),
  };

  return { agent, nodes, connections };
}

export async function loadAgentGraph(apiName: string): Promise<AgentGraph> {
  const raw = await apexFetch<RawAgentWithNodes>(
    `${AGENT_BUILDER_BASE}?apiName=${encodeURIComponent(apiName)}`,
    { method: 'GET' }
  );
  return fromRaw(raw);
}

/** Mirrors agentCanvas.js's handleSave — same AgentDefinitionInput /
 *  AgentNodeInput field names AgentBuilderController.saveAgentWithNodes
 *  already expects, and the same index-based connection encoding. */
export async function saveAgentGraph(graph: AgentGraph): Promise<string> {
  const idToIndex = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const indexedConnections = graph.connections
    .map(c => ({
      id: c.id,
      fromIndex: idToIndex.get(c.fromNodeId),
      fromPort: c.fromPort,
      toIndex: idToIndex.get(c.toNodeId),
      toPort: c.toPort,
    }))
    .filter(c => c.fromIndex !== undefined && c.toIndex !== undefined);

  const body = {
    agent: {
      apiName: graph.agent.apiName,
      label: graph.agent.name,
      department: graph.agent.department,
      description: graph.agent.description,
      knowledgeBase: graph.agent.knowledgeBase,
      status: graph.agent.status,
      accessMode: graph.agent.accessMode,
      executeType: graph.agent.executeType,
      canvasJson: JSON.stringify({ connections: indexedConnections }),
      setupChecklistJson: JSON.stringify(graph.agent.setupChecklist ?? []),
    },
    nodes: graph.nodes.map(n => ({
      label: n.name,
      nodeType: n.nodeType,
      nodeSubType: n.nodeSubType,
      configJson: JSON.stringify(n.config),
      positionX: Math.round(n.positionX),
      positionY: Math.round(n.positionY),
      isEnabled: n.isEnabled,
      mcpServer: n.mcpServer ?? null,
      mcpTool: n.mcpTool ?? null,
      aiEngineConnectionId: n.aiEngineConnectionId ?? null,
    })),
  };

  const result = await apexFetch<{ agentId: string }>(AGENT_BUILDER_BASE, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return result.agentId;
}
