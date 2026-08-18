import { apexFetch } from './apex-client';

/** Talks to AgentChatRestService.cls — session lifecycle (start/send/end),
 *  attachments, and the PerUser connect gate. See that class's doc-comment
 *  for why this goes through AgentChatController (HTTP) rather than the
 *  WebSocket gateway. */
const CHAT_BASE = '/services/apexrest/agent-builder/chat/';

export interface ChatAgentSummary {
  apiName: string;
  name: string;
  department: string;
  description: string | null;
}

export interface RawChatSession {
  Id: string;
  Name: string;
  Title__c: string | null;
  Status__c: string;
  'AgentDefinition__r.Name': string;
  TokensIn__c: number | null;
  TokensOut__c: number | null;
}

export interface RawChatMessage {
  Id: string;
  Role__c: 'User' | 'Assistant' | 'Tool' | 'System';
  Content__c: string | null;
  ToolCallsJson__c: string | null;
  ModelUsed__c: string | null;
  TokensIn__c: number | null;
  TokensOut__c: number | null;
  SequenceNumber__c: number;
  CreatedDate: string;
}

export interface SessionWithMessages {
  session: RawChatSession;
  messages: RawChatMessage[];
}

export interface TurnResult {
  status: 'complete' | 'error';
  session: RawChatSession;
  newMessages: RawChatMessage[];
}

export interface AttachmentInput {
  contentDocumentId: string;
  contentVersionId: string;
  fileName: string;
  mimeType: string;
  fileExtension: string;
}

export interface ConnectionGate {
  accessMode: 'Org' | 'PerUser';
  connected: boolean;
  accountEmail: string | null;
}

export async function listChatEnabledAgents(filter?: string): Promise<ChatAgentSummary[]> {
  return apexFetch<ChatAgentSummary[]>(`${CHAT_BASE}?filter=${encodeURIComponent(filter ?? '')}`, { method: 'GET' });
}

export async function getConnectionGate(agentApiName: string): Promise<ConnectionGate> {
  return apexFetch<ConnectionGate>(`${CHAT_BASE}?resource=gate&agentApiName=${encodeURIComponent(agentApiName)}`, {
    method: 'GET',
  });
}

export async function startChatSession(
  agentApiName: string,
  recordContextId?: string | null,
  recordContextType?: string | null
): Promise<SessionWithMessages> {
  return apexFetch<SessionWithMessages>(CHAT_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'startSession', agentApiName, recordContextId, recordContextType }),
  });
}

export async function sendChatTurn(
  sessionId: string,
  userText: string,
  attachments: AttachmentInput[]
): Promise<TurnResult> {
  return apexFetch<TurnResult>(CHAT_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'sendTurn', sessionId, userText, attachments }),
  });
}

export async function endChatSession(sessionId: string): Promise<void> {
  await apexFetch<{ success: boolean }>(CHAT_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'endSession', sessionId }),
  });
}

export async function uploadChatFile(
  sessionId: string,
  fileName: string,
  mimeType: string,
  base64: string
): Promise<{ contentDocumentId: string; contentVersionId: string }> {
  return apexFetch<{ contentDocumentId: string; contentVersionId: string }>(CHAT_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'uploadChatFile', sessionId, fileName, mimeType, base64 }),
  });
}

export async function startMyConnection(returnUrl: string): Promise<{ authorizeUrl: string }> {
  return apexFetch<{ authorizeUrl: string }>(CHAT_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'startMyConnection', returnUrl }),
  });
}
