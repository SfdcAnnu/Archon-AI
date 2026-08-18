import { apexFetch } from './apex-client';

/** Talks to AgentKbRestService.cls, a thin wrapper around AgentKbController
 *  — the RAG knowledge-base pipeline (storage config + document upload/
 *  reindex/delete), all proxied through to the Archon Node server. */
const KB_BASE = '/services/apexrest/agent-builder/kb';

export interface StorageConfig {
  backend: string | null;
  connectionUrlMasked: string | null;
  hasConnectionUrl: boolean;
}

export interface KbDocument {
  id: string;
  title: string;
  sourceType: string;
  status: string;
  chunkCount: number;
  errorMessage: string | null;
}

export async function loadStorageConfig(): Promise<StorageConfig> {
  return apexFetch<StorageConfig>(`${KB_BASE}?resource=storage-config`, { method: 'GET' });
}

export async function saveStorageConfig(backend: string, connectionUrl?: string): Promise<StorageConfig> {
  return apexFetch<StorageConfig>(KB_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'saveStorageConfig', backend, connectionUrl: connectionUrl ?? null }),
  });
}

export async function testKbConnection(connectionUrl: string): Promise<void> {
  await apexFetch<{ success: boolean }>(KB_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'testConnection', connectionUrl }),
  });
}

export async function loadDocuments(agentApiName: string): Promise<KbDocument[]> {
  return apexFetch<KbDocument[]>(`${KB_BASE}?agentApiName=${encodeURIComponent(agentApiName)}`, { method: 'GET' });
}

export async function uploadDocument(input: {
  agentApiName: string;
  title: string;
  text?: string;
  fileBase64?: string;
  fileName?: string;
}): Promise<KbDocument> {
  return apexFetch<KbDocument>(KB_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'uploadDocument', ...input }),
  });
}

export async function reindexDocument(documentId: string): Promise<KbDocument> {
  return apexFetch<KbDocument>(KB_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'reindexDocument', documentId }),
  });
}

export async function deleteDocument(documentId: string): Promise<void> {
  await apexFetch<{ success: boolean }>(`${KB_BASE}?documentId=${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
  });
}
