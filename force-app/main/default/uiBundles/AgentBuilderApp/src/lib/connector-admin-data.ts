import { apexFetch } from './apex-client';

/** Talks to AgentConnectorAdminRestService.cls — custom MCP server CRUD,
 *  disconnect, and OAuth start for the React "Connectors" admin page.
 *  Deliberately separate from connectors-data.ts's read-only directory
 *  endpoint (a different, already-deployed Apex class). */
const BASE = '/services/apexrest/agent-builder/connectors-admin/';

export interface CustomMcpServer {
  Id: string;
  Name: string;
  McpServerUrl__c: string;
  Description__c: string | null;
  Category__c: string | null;
  CatalogType__c: string | null;
  IsActive__c: boolean;
}

export async function loadCustomMcpServers(): Promise<CustomMcpServer[]> {
  return apexFetch<CustomMcpServer[]>(BASE, { method: 'GET' });
}

export async function saveCustomMcpServer(input: {
  recordId?: string | null;
  serverName: string;
  mcpServerUrl: string;
  description?: string;
  category: string;
  catalogType: string;
}): Promise<string> {
  const result = await apexFetch<{ id: string }>(BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'saveCustomMcpServer', ...input }),
  });
  return result.id;
}

export async function deleteCustomMcpServer(recordId: string): Promise<void> {
  await apexFetch<{ success: boolean }>(`${BASE}?resource=custom-mcp&recordId=${encodeURIComponent(recordId)}`, {
    method: 'DELETE',
  });
}

export async function disconnectConnector(connectorId: string): Promise<void> {
  await apexFetch<{ success: boolean }>(`${BASE}?connectorId=${encodeURIComponent(connectorId)}`, {
    method: 'DELETE',
  });
}
