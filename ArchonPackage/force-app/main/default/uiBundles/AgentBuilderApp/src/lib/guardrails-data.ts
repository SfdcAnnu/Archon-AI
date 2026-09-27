import { apexFetch } from './apex-client';

/** Talks to AgentGuardrailsRestService.cls, a thin wrapper around
 *  AgentGuardrailsController — the org-wide chat token cap (all agents,
 *  all transports: LWC chat widget, WhatsApp bridge, and this app's own
 *  WebSocket chat, which now records its usage the same way — see
 *  server/src/salesforce/guardrails.ts / ws-chat-persistence.ts). */
const GUARDRAILS_BASE = '/services/apexrest/agent-builder/guardrails';

export interface GuardrailsStatus {
  isEnabled: boolean;
  maxTokensPerDay: number | null;
  maxTokensPerMonth: number | null;
  tokensUsedToday: number;
  tokensUsedThisMonth: number;
}

export async function loadGuardrails(): Promise<GuardrailsStatus> {
  return apexFetch<GuardrailsStatus>(GUARDRAILS_BASE, { method: 'GET' });
}

export async function saveGuardrails(input: {
  isEnabled: boolean;
  maxTokensPerDay: number | null;
  maxTokensPerMonth: number | null;
}): Promise<GuardrailsStatus> {
  return apexFetch<GuardrailsStatus>(GUARDRAILS_BASE, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
