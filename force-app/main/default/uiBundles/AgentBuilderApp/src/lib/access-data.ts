import { apexFetch } from './apex-client';

/** Talks to AgentAccessRestService.cls — read-only Salesforce Access
 *  status dashboard (org connection + per-user PerUser-mode connections). */
const ACCESS_BASE = '/services/apexrest/agent-builder/salesforce-access';

interface RawOrgStatus {
  configured: boolean;
  configuredAt: string | null;
  configuredByEmail: string | null;
  orgId: string | null;
}

interface RawUserConnection {
  userName: string;
  userEmail: string;
  status: string;
  accountEmail: string | null;
  lastConnectedAt: string | null;
  lastErrorMessage: string | null;
}

export interface AccessStatus {
  orgStatus: RawOrgStatus;
  userConnections: RawUserConnection[];
}

export async function loadAccessStatus(): Promise<AccessStatus> {
  return apexFetch<AccessStatus>(ACCESS_BASE, { method: 'GET' });
}
