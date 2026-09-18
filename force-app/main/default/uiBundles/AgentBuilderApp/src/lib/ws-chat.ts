import { apexFetch } from './apex-client';

/**
 * Client half of the ephemeral-ticket pattern (see AgentWebSocketController.cls
 * and server/src/ws/gateway.ts for the other two legs). This module never
 * sees SessionKey__c — only the one-time ticket AgentWebSocketController
 * hands back after its own server-to-server callout to Archon-Server.
 */
const WS_TICKET_BASE = '/services/apexrest/agent-builder/ws-ticket';

interface TicketResponse {
  ticket: string;
  wsUrl: string;
  expiresInSeconds: number;
}

export async function mintChatTicket(agentApiName: string, sessionId: string): Promise<TicketResponse> {
  return apexFetch<TicketResponse>(WS_TICKET_BASE, {
    method: 'POST',
    body: JSON.stringify({ agentApiName, sessionId }),
  });
}

export interface ChatHistoryEntry {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolCallsJson?: string | null;
  toolResultsJson?: string | null;
  toolCallId?: string | null;
}

export interface ChatAttachmentRef {
  contentDocumentId: string;
  contentVersionId?: string;
  fileName?: string;
  mimeType?: string;
  fileExtension?: string;
}

export interface ChatTurnMessage {
  newUserMessage: string;
  history: ChatHistoryEntry[];
  attachments?: ChatAttachmentRef[];
  debugMode?: boolean;
  /** The turn after an approved action ran: no user text, the tool's result.
   *  The runtime continues the agent's work from it. */
  continuation?: { toolName: string; resultText: string };
}

/** The text a continuation turn runs on — the server composes the same
 *  string (chat/connector-scope.ts), so the history the browser keeps reads
 *  exactly what the model was given. */
export function continuationText(toolName: string, resultText: string): string {
  const result = (resultText ?? '').trim();
  return `[Approved action executed] ${toolName}: ${result.length > 4000 ? `${result.slice(0, 4000)} …` : result || '(no output)'}\n\n` +
    'Continue from where you left off. Do not repeat what was already said or done.';
}

export interface ChatToolCallSummary {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  isError?: boolean;
  /** For a call into a specialist (ask_*): the calls the specialist made
   *  in its own turn — the work behind the hand-off. */
  nested?: ChatToolCallSummary[];
}

export interface ChatTurnResult {
  status: 'complete' | 'error';
  assistantText?: string;
  toolCalls?: ChatToolCallSummary[];
  modelUsed?: string;
  tokensIn?: number;
  tokensOut?: number;
  activeTopicName?: string;
  error?: string;
  message?: string;
}

/** Mints a ticket, then opens the WebSocket to Archon-Server using it —
 *  the ticket is single-use and short-lived (~45s), so this must be
 *  called right before each connection, not cached. */
export async function openChatSocket(agentApiName: string, sessionId: string): Promise<WebSocket> {
  const { ticket, wsUrl } = await mintChatTicket(agentApiName, sessionId);
  return new WebSocket(`${wsUrl}?ticket=${encodeURIComponent(ticket)}`);
}
