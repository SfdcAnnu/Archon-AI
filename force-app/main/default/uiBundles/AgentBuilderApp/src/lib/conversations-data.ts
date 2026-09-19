import { apexFetch } from './apex-client';

/** Talks to AgentConversationsRestService.cls, a thin wrapper around
 *  AgentChatController's listMySessions/getSession — the same read-only
 *  session history the old agentHome LWC's inline Conversations view used. */
const CONVERSATIONS_BASE = '/services/apexrest/agent-builder/conversations/';

/** One model's share of a session's (or a turn's) tokens.
 *
 *  A turn is not one model call: the router answers on the root node's
 *  model, a specialist runs on its own, and utility passes use a cheap one.
 *  `modelUsed` names only whoever produced the reply, so this breakdown is
 *  the accurate basis for any per-model reporting. */
export interface ModelUsage {
  model: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  /** Prompt-cache hits, already counted inside tokensIn. */
  cacheRead: number;
  /** Present on per-TURN usage only, not on session rollups. */
  stages?: string[];
}

/** Parse a UsageJson__c / UsageByModelJson__c blob. Never throws — usage
 *  reporting must not be able to break a page that also shows real content. */
export function parseModelUsage(json: string | null | undefined): ModelUsage[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is ModelUsage => !!r && typeof (r as ModelUsage).model === 'string')
      .map(r => ({
        model: r.model,
        calls: r.calls ?? 0,
        tokensIn: r.tokensIn ?? 0,
        tokensOut: r.tokensOut ?? 0,
        cacheRead: r.cacheRead ?? 0,
        stages: r.stages,
      }));
  } catch {
    return [];
  }
}

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
  cachedTokens: number | null;
  latencyMsTotal: number | null;
  usageByModelJson: string | null;
}

interface RawChatSession {
  Id: string;
  Name: string;
  Title__c: string | null;
  Status__c: string;
  'AgentDefinition__r.Name': string;
  TotalTurns__c: number | null;
  TokensIn__c: number | null;
  TokensOut__c: number | null;
  CachedTokens__c: number | null;
  LatencyMsTotal__c: number | null;
  UsageByModelJson__c: string | null;
}

interface RawChatMessage {
  Id: string;
  Role__c: 'User' | 'Assistant' | 'Tool' | 'System';
  Content__c: string | null;
  ToolCallsJson__c: string | null;
  ToolResultsJson__c: string | null;
  ModelUsed__c: string | null;
  TokensIn__c: number | null;
  TokensOut__c: number | null;
  CachedTokens__c: number | null;
  LatencyMs__c: number | null;
  UsageJson__c: string | null;
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
