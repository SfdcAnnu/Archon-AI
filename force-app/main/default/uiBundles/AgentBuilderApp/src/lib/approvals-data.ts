import { apexFetch } from './apex-client';

/** Talks to AgentApprovalRestService.cls, a thin wrapper around
 *  AgentApprovalController — approver-facing pending-approvals list and
 *  the approve/reject decision, which resumes a paused agent run on the
 *  Archon server. Security-sensitive ordering (server-side owner check,
 *  callout-before-DML, ApprovalToken__c never leaving Apex) lives entirely
 *  in AgentApprovalController.decide() — this file never touches it. */
const APPROVALS_BASE = '/services/apexrest/agent-builder/approvals';

export interface ApprovalDto {
  id: string;
  name: string;
  agentApiName: string;
  nodeLabel: string;
  recordId: string | null;
  status: string;
  createdDate: string;
  timeoutAt: string | null;
}

export async function loadPendingApprovals(): Promise<ApprovalDto[]> {
  return apexFetch<ApprovalDto[]>(APPROVALS_BASE, { method: 'GET' });
}

export async function decideApproval(
  approvalId: string,
  decision: 'approved' | 'rejected',
  comments?: string
): Promise<ApprovalDto> {
  return apexFetch<ApprovalDto>(APPROVALS_BASE, {
    method: 'POST',
    body: JSON.stringify({ approvalId, decision, comments: comments ?? '' }),
  });
}
