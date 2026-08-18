import { apexFetch } from './apex-client';

/** Talks to AgentEngineConnectionsRestService.cls, a thin wrapper around
 *  AiEngineConnectionController — used by both the standalone AI
 *  Connections admin page and the canvas properties-panel credential
 *  picker for AI/subagent nodes. */
const ENGINE_CONNECTIONS_BASE = '/services/apexrest/agent-builder/engine-connections/';

export const ENGINE_TYPES = ['claude', 'openai', 'gemini', 'custom'] as const;
export type EngineType = (typeof ENGINE_TYPES)[number];

export interface ConnectionSummary {
  id: string;
  name: string;
  label: string;
  userName: string | null;
  ownershipType: 'Personal' | 'Shared';
  engineType: string;
  endpoint: string | null;
  defaultModel: string | null;
  isActive: boolean;
  isPreferred: boolean;
  isPublicShared: boolean;
  isMine: boolean;
  validationStatus: string | null;
  lastValidatedAt: string | null;
  lastUsedAt: string | null;
}

export async function listConnectionsForEngine(engineType: string): Promise<ConnectionSummary[]> {
  return apexFetch<ConnectionSummary[]>(`${ENGINE_CONNECTIONS_BASE}?engineType=${encodeURIComponent(engineType)}`, {
    method: 'GET',
  });
}

export interface SaveConnectionInput {
  recordId?: string | null;
  engineType: string;
  ownershipType: 'Personal' | 'Shared';
  label: string;
  apiKey?: string;
  endpoint?: string;
  defaultModel?: string;
  isActive?: boolean;
  isPreferred?: boolean;
  isPublicShared?: boolean;
  notes?: string;
}

export async function saveEngineConnection(input: SaveConnectionInput): Promise<string> {
  const result = await apexFetch<{ id: string }>(ENGINE_CONNECTIONS_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'save', ...input }),
  });
  return result.id;
}

export async function deleteEngineConnection(recordId: string): Promise<void> {
  await apexFetch<{ success: boolean }>(ENGINE_CONNECTIONS_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'delete', recordId }),
  });
}

export async function bindEngineConnectionToNode(agentNodeId: string, connectionId: string | null): Promise<void> {
  await apexFetch<{ success: boolean }>(ENGINE_CONNECTIONS_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'bind', agentNodeId, connectionId }),
  });
}

export async function testEngineConnection(recordId: string): Promise<{ success: boolean; message: string }> {
  return apexFetch<{ success: boolean; message: string }>(ENGINE_CONNECTIONS_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'test', recordId }),
  });
}
