import { apexFetch } from './apex-client';
import { saveAgentGraph } from './salesforce-data';
import type { AgentGraph } from '@/types/agent';

/** Talks to AgentListRestService.cls, a thin wrapper around
 *  AgentBuilderController's list/delete/status-toggle methods — the same
 *  data the old agentHome LWC's "Home" agent list already used. */
const AGENTS_BASE = '/services/apexrest/agent-builder/agents';

interface RawAgentSummary {
  Id: string;
  Name: string;
  ApiName__c: string;
  Department__c: string;
  Description__c: string | null;
  Status__c: string;
  Version__c: number | null;
  TotalExecutions__c: number | null;
  SuccessRate__c: number | null;
  CreatedDate: string;
  LastModifiedDate: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  apiName: string;
  department: string;
  description: string;
  status: string;
  version: number | null;
  totalExecutions: number | null;
  successRate: number | null;
  createdDate: string;
  lastModifiedDate: string;
}

function fromRaw(r: RawAgentSummary): AgentSummary {
  return {
    id: r.Id,
    name: r.Name,
    apiName: r.ApiName__c,
    department: r.Department__c,
    description: r.Description__c ?? '',
    status: r.Status__c,
    version: r.Version__c,
    totalExecutions: r.TotalExecutions__c,
    successRate: r.SuccessRate__c,
    createdDate: r.CreatedDate,
    lastModifiedDate: r.LastModifiedDate,
  };
}

export async function loadAgents(): Promise<AgentSummary[]> {
  const raw = await apexFetch<RawAgentSummary[]>(AGENTS_BASE, { method: 'GET' });
  return raw.map(fromRaw);
}

export async function deleteAgent(agentId: string): Promise<void> {
  await apexFetch<{ success: boolean }>(`${AGENTS_BASE}?agentId=${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
  });
}

export async function updateAgentStatus(agentId: string, status: string): Promise<void> {
  await apexFetch<{ success: boolean }>(`${AGENTS_BASE}?agentId=${encodeURIComponent(agentId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function slugify(name: string): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (base || 'new_agent') + '_' + Date.now().toString(36);
}

/** Scaffolds the minimum a new agent needs — same two-node shape
 *  agentEditor.js's createAgent() and agentCanvas.js already build for a
 *  brand-new agent (one AI node + one read-only-by-default Salesforce
 *  catalog node) — then saves it via the existing saveAgentGraph path.
 *  Returns the generated apiName (not the Salesforce Id) — that's what
 *  the canvas route navigates by. */
export async function createAgent(name: string, department: string): Promise<string> {
  const apiName = slugify(name);
  const graph: AgentGraph = {
    agent: {
      id: '',
      apiName,
      name,
      department,
      description: '',
      knowledgeBase: '',
      status: 'Draft',
      executeType: 'Chat',
      accessMode: 'Org',
      setupChecklist: [],
    },
    nodes: [
      {
        id: 'new_0',
        name: 'Assistant',
        nodeType: 'ai',
        nodeSubType: 'claude',
        config: { model: 'claude-sonnet-4-6', systemPrompt: '' },
        positionX: 0,
        positionY: 0,
        sortOrder: 0,
        isEnabled: true,
        mcpServer: null,
        mcpTool: null,
        aiEngineConnectionId: null,
      },
      {
        id: 'new_1',
        name: 'Salesforce Tools',
        nodeType: 'catalog',
        nodeSubType: 'salesforce_crm_tools',
        config: {
          provider: 'salesforce_mcp',
          allowedTools: ['soqlQuery', 'getObjectSchema', 'getRelatedRecords', 'getUserInfo'],
          connectorId: '',
          description: 'Read Salesforce records, run SOQL queries, describe schemas.',
        },
        positionX: 260,
        positionY: 0,
        sortOrder: 1,
        isEnabled: true,
        mcpServer: null,
        mcpTool: null,
        aiEngineConnectionId: null,
      },
    ],
    connections: [{ id: 'c1', fromNodeId: 'new_0', fromPort: 'out', toNodeId: 'new_1', toPort: 'in' }],
  };
  await saveAgentGraph(graph);
  return apiName;
}
