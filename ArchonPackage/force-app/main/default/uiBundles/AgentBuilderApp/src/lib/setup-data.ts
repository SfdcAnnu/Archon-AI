import { apexFetch } from './apex-client';

/** Talks to AgentSetupRestService.cls, a thin wrapper around
 *  SynapseSetupController — the org-level Archon OAuth connection wizard.
 *  Still a full-page redirect flow (Salesforce login/consent, then back
 *  to whatever returnUrl this page passes), same as the old LWC. */
const SETUP_BASE = '/services/apexrest/agent-builder/setup';

export interface SetupStatus {
  configured: boolean;
  configuredAt: string | null;
  configuredByEmail: string | null;
  orgId: string | null;
}

export async function getSetupStatus(): Promise<SetupStatus> {
  return apexFetch<SetupStatus>(SETUP_BASE, { method: 'GET' });
}

export async function refreshSetupStatus(): Promise<SetupStatus> {
  return apexFetch<SetupStatus>(SETUP_BASE, { method: 'POST', body: JSON.stringify({ action: 'refresh' }) });
}

export async function startSetup(returnUrl: string): Promise<{ authorizeUrl: string }> {
  return apexFetch<{ authorizeUrl: string }>(SETUP_BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'start', returnUrl }),
  });
}

export async function resetSetup(): Promise<void> {
  await apexFetch<{ success: boolean }>(SETUP_BASE, { method: 'POST', body: JSON.stringify({ action: 'reset' }) });
}
