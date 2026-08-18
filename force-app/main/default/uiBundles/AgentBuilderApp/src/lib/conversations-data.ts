import { apexFetch } from './apex-client';

/** Talks to AgentConversationsRestService.cls, a thin wrapper around
 *  AgentChatController's listMySessions/getSession — the same read-only
 *  session history the old agentHome LWC's inline Conversations view used. */
const CONVERSATIONS_BASE = '/services/apexrest/agent-builder/conversations/';

export interface SessionSummary {
  id: string;
  name: string;
  agentName: string;
  agentApiName: string;
  title: string | null;
  status: string;
  lastActivityAt: string | null;
  expiresAt: string | null;
  totalTurns: number | null;
  recordContextId: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

interface RawChatSession {
  Id: string;
  Name: string;
  Title__c: string | null;
  Status__c: string;
  'AgentDefinition__r.Name': string;
  TokensIn__c: number | null;
  TokensOut__c: number | null;
}

interface RawChatMessage {
  Id: string;
  Role__c: 'User' | 'Assistant' | 'Tool';
  Content__c: string | null;
  ToolCallsJson__c: string | null;
  ToolResultsJson__c: string | null;
  ModelUsed__c: string | null;
  TokensIn__c: number | null;
  TokensOut__c: number | null;
  SequenceNumber__c: number;
  RequestPayload__c: string | null;
  ResponsePayload__c: string | null;
  CreatedDate: string;
}

export interface SessionDetail {
  session: RawChatSession;
  messages: RawChatMessage[];
}

export async function listMySessions(limit = 50): Promise<SessionSummary[]> {
  return apexFetch<SessionSummary[]>(`${CONVERSATIONS_BASE}?limit=${limit}`, { method: 'GET' });
}

export async function getSessionDetail(sessionId: string): Promise<SessionDetail> {
  return apexFetch<SessionDetail>(`${CONVERSATIONS_BASE}?sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'GET',
  });
}
