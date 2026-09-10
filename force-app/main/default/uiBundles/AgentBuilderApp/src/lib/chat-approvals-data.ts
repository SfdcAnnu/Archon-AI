import { apexFetch } from './apex-client';

const BASE = '/services/apexrest/agent-builder/chat-approvals';

/** One suspended chat-mode tool call awaiting a human decision. Rows live
 *  in the Archon server's database (ChatApproval), proxied through
 *  AgentChatApprovalsRestService. */
export interface ChatApproval {
  id: string;
  agentApiName: string;
  planVersion?: string | null;
  sessionId: string;
  userId: string;
  toolName: string;
  argsJson: unknown;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Executed' | 'Failed' | 'Expired' | string;
  resultText?: string | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
  timeoutAt: string;
  createdAt: string;
}

export interface ChatApprovalDecision {
  status: string;
  resultText?: string;
  error?: string;
}

export async function listChatApprovals(
  opts: { sessionId?: string; status?: string } = {}
): Promise<ChatApproval[]> {
  const params = new URLSearchParams();
  if (opts.sessionId) params.set('sessionId', opts.sessionId);
  if (opts.status) params.set('status', opts.status);
  const qs = params.toString();
  const res = await apexFetch<{ approvals: ChatApproval[] }>(`${BASE}${qs ? `?${qs}` : ''}`, { method: 'GET' });
  return (res.approvals ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Approve executes the stored tool call on the server right away, so this
 *  can take as long as the tool itself — the Apex callout allows 120s. */
export async function decideChatApproval(
  approvalId: string,
  decision: 'approved' | 'rejected'
): Promise<ChatApprovalDecision> {
  return apexFetch<ChatApprovalDecision>(
    BASE,
    { method: 'POST', body: JSON.stringify({ approvalId, decision }) },
    125000
  );
}
