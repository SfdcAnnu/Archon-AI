import { apexFetch } from './apex-client';

/**
 * Talks to AgentIdentityRestService.cls — the admin side of WHOSE account
 * a connector runs as: the org's shared connection, a group's (bound to a
 * Permission Set, Public Group or Department), or each person's own.
 *
 * Every read is the Archon server's own JSON passed through Apex, except
 * the roster, which Apex composes because who MUST connect is a
 * Salesforce question (the agents people used, and the users behind them).
 */
const BASE = '/services/apexrest/agent-builder/identity/';
/** These calls cross to the Archon server, which sleeps when idle. */
const TIMEOUT_MS = 45000;

export type RunAs = 'user' | 'group' | 'org';
export type GroupKeyType = 'permissionSet' | 'publicGroup' | 'department';

export interface IdentityPolicy {
  defaultRunAs: RunAs;
  defaultFallback: 'none' | 'org';
  blockOrgFallbackForChat: boolean;
  groupKeyType: GroupKeyType;
  sfJwtEnabled: boolean;
  allowedDomains: string[];
  reminderEveryDays: number;
  reminderMax: number;
}

export interface PolicyResponse {
  policy: IdentityPolicy;
  sfJwt: { configured: boolean; enabled: boolean };
}

export async function loadIdentityPolicy(): Promise<PolicyResponse> {
  return apexFetch<PolicyResponse>(`${BASE}?resource=policy`, { method: 'GET' }, TIMEOUT_MS);
}

export async function saveIdentityPolicy(policy: Partial<IdentityPolicy>): Promise<PolicyResponse> {
  return apexFetch<PolicyResponse>(BASE, { method: 'POST', body: JSON.stringify({ action: 'savePolicy', policy }) }, TIMEOUT_MS);
}

/** The org default, cached for the page's life — the builder's Identity
 *  tab reads it to say what "org default" resolves to. */
let policyPromise: Promise<PolicyResponse> | null = null;
export function cachedIdentityPolicy(): Promise<PolicyResponse> {
  if (!policyPromise) policyPromise = loadIdentityPolicy().catch(err => { policyPromise = null; throw err; });
  return policyPromise;
}

// ── who has connected, per provider ────────────────────────────────

export interface ProviderSummary {
  org: boolean;
  groups: number;
  users: { connected: number; expired: number; total: number };
}

export async function loadIdentitySummary(): Promise<Record<string, ProviderSummary>> {
  const body = await apexFetch<{ providers: Record<string, ProviderSummary> }>(`${BASE}?resource=summary`, { method: 'GET' }, TIMEOUT_MS);
  return body.providers ?? {};
}

/** A connection as the pages see it — never its tokens. */
export interface ConnectionRow {
  id: string;
  providerKey: string;
  status: string;
  principalType: RunAs;
  subjectType: string | null;
  subjectKey: string | null;
  subjectLabel: string | null;
  accountEmail: string | null;
  configuredBy: string | null;
  lastConnectedAt: string | null;
  lastErrorMessage: string | null;
  tokenExpiresAt: string | null;
  hasRefreshToken: boolean;
}

export interface ServerOverride {
  mcpServerUrl: string;
  authStyle: string;
  hasApiKey: boolean;
  updatedAt: string | null;
  updatedBy?: string | null;
}

export interface ConnectorDetail {
  providerKey: string;
  org: ConnectionRow | null;
  groups: ConnectionRow[];
  users: { connected: number; pending: number; error: number; expired: number; total: number };
  override: ServerOverride | null;
  policy: { blockOrgFallbackForChat: boolean; groupKeyType: GroupKeyType };
  salesforce: { jwtConfigured: boolean; jwtEnabled: boolean } | null;
}

export async function loadConnectorDetail(providerKey: string): Promise<ConnectorDetail> {
  return apexFetch<ConnectorDetail>(`${BASE}?resource=detail&providerKey=${encodeURIComponent(providerKey)}`, { method: 'GET' }, TIMEOUT_MS);
}

// ── the roster: who must connect, who did ──────────────────────────

export type RosterStatus = 'connected' | 'pending' | 'error' | 'expired' | 'notConnected' | 'viaGroup';

export interface RosterUser {
  userId: string;
  name: string | null;
  email: string | null;
  status: RosterStatus;
  accountEmail: string | null;
  lastConnectedAt: string | null;
  lastErrorMessage: string | null;
  neededBy: string[];
  remindedCount: number;
  remindedAt: string | null;
  connectionId: string | null;
}

export interface Roster {
  providerKey: string;
  users: RosterUser[];
  mustConnect: number;
  connected: number;
  notConnected: number;
  expired: number;
  agentsNeeding: string[];
  serverUnreachable: boolean;
}

export async function loadRoster(providerKey: string): Promise<Roster> {
  return apexFetch<Roster>(`${BASE}?resource=roster&providerKey=${encodeURIComponent(providerKey)}`, { method: 'GET' }, TIMEOUT_MS);
}

export async function sendConnectionReminders(providerKey: string, userIds: string[], agentApiName?: string | null): Promise<number> {
  const body = await apexFetch<{ sent: number }>(BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'sendReminders', providerKey, userIds, agentApiName: agentApiName ?? null }),
  }, TIMEOUT_MS);
  return body.sent;
}

// ── groups to bind a group connection to ───────────────────────────

export interface GroupOption {
  key: string;
  label: string;
  type: GroupKeyType;
  members?: number | null;
}

export async function loadGroups(type: GroupKeyType): Promise<GroupOption[]> {
  const body = await apexFetch<{ groups: GroupOption[] }>(`${BASE}?resource=groups&type=${encodeURIComponent(type)}`, { method: 'GET' }, TIMEOUT_MS);
  return body.groups ?? [];
}

/** The provider's sign-in page for a connection the ORG or a GROUP owns.
 *  The browser opens it; the server's callback stores the tokens on that
 *  principal's row. */
export async function startPrincipalOAuth(input: {
  providerKey: string;
  displayName: string;
  returnUrl: string;
  principalType: 'org' | 'group';
  subjectType?: string | null;
  subjectKey?: string | null;
  subjectLabel?: string | null;
}): Promise<{ connectorId: string; authorizeUrl: string }> {
  return apexFetch<{ connectorId: string; authorizeUrl: string }>(BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'startPrincipalOAuth', ...input }),
  }, TIMEOUT_MS);
}

// ── the MCP server behind a connector ──────────────────────────────

export const AUTH_STYLES: Array<[string, string]> = [
  ['provider-token', "The connection's own token (Google, Microsoft, Salesforce…)"],
  ['mcp-oauth', 'OAuth discovered from the server (MCP spec)'],
  ['api-key', 'A shared API key'],
  ['salesforce-session', "The org's Salesforce session"],
  ['none', 'No authentication'],
];

export async function loadServerOverride(providerKey: string): Promise<ServerOverride | null> {
  const body = await apexFetch<{ override: ServerOverride | null }>(`${BASE}?resource=server&providerKey=${encodeURIComponent(providerKey)}`, { method: 'GET' }, TIMEOUT_MS);
  return body.override;
}

export async function saveServerOverride(input: { providerKey: string; mcpServerUrl: string; authStyle: string; apiKey?: string | null }): Promise<ServerOverride> {
  const body = await apexFetch<{ override: ServerOverride }>(BASE, {
    method: 'POST',
    body: JSON.stringify({ action: 'saveServerOverride', ...input }),
  }, TIMEOUT_MS);
  return body.override;
}

export async function deleteServerOverride(providerKey: string): Promise<void> {
  await apexFetch<{ ok: boolean }>(BASE, { method: 'POST', body: JSON.stringify({ action: 'deleteServerOverride', providerKey }) }, TIMEOUT_MS);
}

export interface ServerTestResult {
  ok: boolean;
  ms?: number;
  count?: number;
  tools?: string[];
  error?: string;
  message?: string;
}

/** Lists the server's tools with the org's identity. A failure is an
 *  answer, not an exception — the dialog shows it. */
export async function testServer(input: { providerKey: string; mcpServerUrl: string; authStyle: string; apiKey?: string | null }): Promise<ServerTestResult> {
  return apexFetch<ServerTestResult>(BASE, { method: 'POST', body: JSON.stringify({ action: 'testServer', ...input }) }, 95000);
}

// ── labels ─────────────────────────────────────────────────────────

export const RUN_AS_LABEL: Record<RunAs, string> = { user: 'Each person', group: 'A group', org: 'The org' };

export const GROUP_TYPE_LABEL: Record<GroupKeyType, string> = {
  permissionSet: 'Permission Set',
  publicGroup: 'Public Group',
  department: 'Department',
};

/** "as you · ann@acme.com" / "as Sales · sales@acme.com" / "as the org". */
export function ranAsLabel(r: { type: RunAs; subjectLabel?: string | null; accountEmail?: string | null; via?: string | null }, me = true): string {
  const who = r.type === 'user' ? (me ? 'you' : r.subjectLabel ?? 'the person') : r.type === 'group' ? (r.subjectLabel ?? 'a group') : 'the org';
  const via = r.via === 'jwt' ? ' · automatic' : '';
  return `as ${who}${r.accountEmail && r.type !== 'org' ? ` · ${r.accountEmail}` : ''}${via}`;
}
