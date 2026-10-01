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
  /** Connectors this agent runs as the person or their group. Absent
   *  from an org whose Apex predates identity, which reads as none. */
  needs?: string[];
  runsAsUser?: boolean;
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
  /** Set on the System row that records a person's decision on a parked action. */
  RequiredApproval__c?: boolean | null;
  /** The whole call as the server reported it (input, output, nested calls). */
  ToolResultsJson__c?: string | null;
  ModelUsed__c: string | null;
  TokensIn__c: number | null;
  TokensOut__c: number | null;
  SequenceNumber__c: number;
  Feedback__c?: string | null;
  CreatedDate: string;
}

/** The System row approval-audit writes when a parked action is decided:
 *  "Approved by Ann · deploy(changeId=…) → Executed — …". */
export function isApprovalOutcomeRow(m: RawChatMessage): boolean {
  return m.Role__c === 'System' && m.RequiredApproval__c === true && /^(Approved|Rejected) by .+ · \w+\(/.test(m.Content__c ?? '');
}

export interface SessionWithMessages {
  session: RawChatSession;
  messages: RawChatMessage[];
  /** Where this agent's chats start: streaming on or off. Absent from an
   *  org that has not taken the field yet, which resolves to off. */
  streamReplies?: boolean;
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

/** One connector the agent runs as the person (or their group), with the
 *  running user's standing on it. */
export type RequirementStatus = 'connected' | 'automatic' | 'needed' | 'expired' | 'wrong_account' | 'needs_group' | 'org' | 'pinned';

export interface ConnectionRequirement {
  provider: string;
  displayName: string;
  runAs: 'user' | 'group' | 'org' | 'connection';
  required: boolean;
  status: RequirementStatus;
  accountEmail: string | null;
  message: string | null;
  connectorId: string | null;
}

export interface ConnectionRequirements {
  requirements: ConnectionRequirement[];
  runsAsUser: boolean;
  /** Nothing required is missing: the chat may start. */
  ready: boolean;
  blocking: string[];
}

/** What the RUNNING user must connect before this agent can act as them —
 *  the chat gate. Crosses to the Archon server, so it gets more time. */
export async function getConnectionRequirements(agentApiName: string): Promise<ConnectionRequirements> {
  return apexFetch<ConnectionRequirements>(`${CHAT_BASE}?resource=requirements&agentApiName=${encodeURIComponent(agentApiName)}`, {
    method: 'GET',
  }, 45000);
}

/** The running user's own connections across providers — My connections. */
export interface MyConnection {
  providerKey: string;
  displayName: string;
  status: string;
  accountEmail: string | null;
  lastConnectedAt: string | null;
  lastErrorMessage: string | null;
  connectionId: string | null;
  /** Active agents that run as the person on this provider. */
  neededBy: string[];
}

export async function loadMyConnections(): Promise<{ providers: MyConnection[]; serverUnreachable: boolean }> {
  return apexFetch<{ providers: MyConnection[]; serverUnreachable: boolean }>(`${CHAT_BASE}?resource=mine`, { method: 'GET' }, 45000);
}

export async function disconnectMyConnection(connectionId: string): Promise<void> {
  await apexFetch<{ success: boolean }>(CHAT_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'disconnectMine', connectionId }),
  }, 45000);
}

/** A large tool result the runtime stored by reference (an `art_…` id in
 *  a tool output). The full text or record list, for drawing a result card;
 *  expired handles come back as an error. */
export interface StoredArtifact {
  id: string;
  kind: 'json-records' | 'text';
  text?: string;
  records?: unknown[];
  totalChars: number;
  truncated: boolean;
}
export async function loadArtifact(id: string): Promise<StoredArtifact> {
  return apexFetch<StoredArtifact>(`${CHAT_BASE}?resource=artifact&id=${encodeURIComponent(id)}`, { method: 'GET' });
}

/** forceNew: never resume the person's last active conversation with this
 *  agent — the Archon screen opens fresh every time; Recent keeps the rest. */
export async function startChatSession(
  agentApiName: string,
  recordContextId?: string | null,
  recordContextType?: string | null,
  forceNew = false,
  sessionId?: string | null
): Promise<SessionWithMessages> {
  return apexFetch<SessionWithMessages>(CHAT_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'startSession', agentApiName, recordContextId, recordContextType, ...(forceNew ? { forceNew: true } : {}), ...(sessionId ? { sessionId } : {}) }),
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

/** Thumbs-up/down on an assistant reply. Fresh WS replies may not have a
 *  record Id client-side (persistence is async server-side), so content is
 *  always sent as the fallback matcher. value '' clears the feedback. */
export async function sendMessageFeedback(
  sessionId: string,
  messageId: string | null,
  contentMatch: string,
  value: 'up' | 'down' | ''
): Promise<{ messageId: string }> {
  return apexFetch<{ messageId: string }>(CHAT_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'feedback', sessionId, messageId, contentMatch, value }),
  });
}

export async function endChatSession(sessionId: string): Promise<void> {
  await apexFetch<{ success: boolean }>(CHAT_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'endSession', sessionId }),
  });
}

/** Closing a chat that never carried a message throws the session away — a
 *  session has to exist from the moment the panel opens (the turn endpoint
 *  and the websocket are keyed on its id), so testing an agent and closing
 *  without typing would otherwise leave an empty conversation behind.
 *  Server-side it is a no-op unless the session is the caller's own and
 *  genuinely has no messages. */
export async function discardChatSessionIfEmpty(sessionId: string): Promise<boolean> {
  const result = await apexFetch<{ discarded: boolean }>(CHAT_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'discardIfEmpty', sessionId }),
  });
  return result.discarded;
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

/** The sign-in page for the running user's OWN account on any provider.
 *  The server's callback stores the tokens on this person's row. */
export async function startMyConnectionFor(returnUrl: string, providerKey: string, displayName?: string | null): Promise<{ authorizeUrl: string }> {
  return apexFetch<{ authorizeUrl: string }>(CHAT_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'startMyConnection', returnUrl, providerKey, displayName: displayName ?? null }),
  }, 45000);
}
