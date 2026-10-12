import { apexFetch } from './apex-client';

/** AgentHandoffRestService: the pickers for the handoff node, and the
 *  Conversations page's banner, Return button and reply box. */
const BASE = '/services/apexrest/agent-builder/handoff';

export interface HandoffQueue { id: string; name: string; developerName: string; omni: boolean }
export interface HandoffGroup { id: string; name: string; developerName: string }

export interface HandoffStatus {
  sessionId: string;
  status: string;
  handedOff: boolean;
  assignee: string | null;
  assigneeType: string | null;
  reason: string | null;
  handedOffAt: string | null;
  returnAt: string | null;
  quietHours: number;
  channel: string | null;
  /** A person can reply from here: a WhatsApp conversation with a number. */
  canReply: boolean;
  returnedBy: string | null;
  returnNote: string | null;
  messageId?: string | null;
}

export async function loadHandoffQueues(): Promise<HandoffQueue[]> {
  return apexFetch<HandoffQueue[]>(`${BASE}?resource=queues`, { method: 'GET' });
}

export async function loadHandoffGroups(): Promise<HandoffGroup[]> {
  return apexFetch<HandoffGroup[]>(`${BASE}?resource=groups`, { method: 'GET' });
}

export async function getHandoffStatus(sessionId: string): Promise<HandoffStatus> {
  return apexFetch<HandoffStatus>(`${BASE}?resource=status&sessionId=${encodeURIComponent(sessionId)}`, { method: 'GET' });
}

/** Give the conversation back to the agent; the note is what the agent is told. */
export async function returnToAgent(sessionId: string, note: string): Promise<HandoffStatus> {
  return apexFetch<HandoffStatus>(BASE, { method: 'POST', body: JSON.stringify({ action: 'return', sessionId, note }) });
}

/** A person's reply to the customer. "/agent" hands the conversation back instead. */
export async function replyAsHuman(sessionId: string, text: string): Promise<HandoffStatus> {
  return apexFetch<HandoffStatus>(BASE, { method: 'POST', body: JSON.stringify({ action: 'reply', sessionId, text }) }, 60000);
}
