import { apexFetch } from './apex-client';

/** Talks to AgentConnectorRestService.cls, a thin wrapper around
 *  AgentConnectorController.getDirectory() — the same directory data the
 *  LWC canvas's Connectors tab already shows. */
const CONNECTORS_BASE = '/services/apexrest/agent-builder/connectors';

export interface DirectoryEntry {
  providerKey: string;
  displayName: string;
  description: string | null;
  category: string | null;
  iconStaticResource: string | null;
  brandColor: string | null;
  authType: string | null;
  mapsToCatalogType: string | null;
  isPopular: boolean | null;
  mcpServerUrl: string | null;
  connectorId: string | null;
  status: string;
  accountEmail: string | null;
  lastConnectedAt: string | null;
  lastErrorMessage: string | null;
  isCustom: boolean | null;
}

export async function loadConnectorDirectory(): Promise<DirectoryEntry[]> {
  return apexFetch<DirectoryEntry[]>(CONNECTORS_BASE, { method: 'GET' });
}

/** The directory endpoint returns a retryable SERVER_WAKING error while the
 *  idle Archon server cold-starts (Render free tier, ~30-60s) instead of
 *  silently reporting every connector "Not connected" — which is what the
 *  UI used to render mid-wake. This wrapper absorbs that window: retry on
 *  SERVER_WAKING every few seconds, telling the caller (via onWaking) to
 *  show a "waking up" state rather than wrong statuses. */
export async function loadConnectorDirectoryWithRetry(
  onWaking?: () => void,
  attempts = 6,
  delayMs = 8000
): Promise<DirectoryEntry[]> {
  for (let i = 0; ; i++) {
    try {
      return await loadConnectorDirectory();
    } catch (err) {
      const waking = err instanceof Error && err.message.includes('SERVER_WAKING');
      if (!waking || i >= attempts - 1) throw err;
      onWaking?.();
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

// ── Live MCP tool listing ────────────────────────────────────────────

/** Talks to AgentMcpToolsRestService.cls → AgentConnectorController.
 *  getMcpToolSchemas — an authenticated, live tools/list against the
 *  provider's actual MCP server (works for standard connectors AND custom
 *  MCP servers). Slower than a static catalog, so callers should cache per
 *  provider for the life of the panel. */
const MCP_TOOLS_BASE = '/services/apexrest/agent-builder/mcp-tools/';
// The MCP server may be cold-starting on its host — give the round-trip
// more headroom than apexFetch's 15s default.
const MCP_TOOLS_TIMEOUT_MS = 45000;

export interface RemoteTool {
  name: string;
  description: string | null;
  /** JSON-encoded input schema — present but unused by the pickers. */
  inputSchema: string | null;
}

export async function loadMcpTools(providerKey: string, connectorId?: string | null): Promise<RemoteTool[]> {
  const params = new URLSearchParams({ provider: providerKey });
  if (connectorId) params.set('connectorId', connectorId);
  return apexFetch<RemoteTool[]>(`${MCP_TOOLS_BASE}?${params.toString()}`, { method: 'GET' }, MCP_TOOLS_TIMEOUT_MS);
}

/** Same SERVER_WAKING auto-retry treatment as the directory loader — the
 *  tool listing traverses TWO free-tier Render services (Archon server →
 *  the provider's MCP server), either of which may be cold-starting; the
 *  Apex layer maps both cases to a retryable SERVER_WAKING error. */
export async function loadMcpToolsWithRetry(
  providerKey: string,
  connectorId?: string | null,
  onWaking?: () => void,
  attempts = 6,
  delayMs = 8000
): Promise<RemoteTool[]> {
  for (let i = 0; ; i++) {
    try {
      return await loadMcpTools(providerKey, connectorId);
    } catch (err) {
      const waking = err instanceof Error && err.message.includes('SERVER_WAKING');
      if (!waking || i >= attempts - 1) throw err;
      onWaking?.();
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

/** Heuristic write-action flag for a tool name — drives the "write action"
 *  badge next to tools that likely mutate data, nudging the user toward
 *  enabling requires-approval. Display-only; never used for enforcement. */
export function isWriteTool(name: string): boolean {
  return /(create|update|delete|upsert|send|post|write|upload|move|share|add|remove|reply|forward)/i.test(name);
}

// ── In-platform custom actions (invocable Apex + autolaunched Flows) ──

/** Talks to AgentCustomActionsRestService.cls → the Node server's
 *  /api/sf/custom-actions — the org's own invocable Apex actions and
 *  autolaunched Flows, via Salesforce's standard invocable-actions API.
 *  Powers the Tool panel's Apex/Flow pickers. */
const CUSTOM_ACTIONS_BASE = '/services/apexrest/agent-builder/custom-actions/';
const CUSTOM_ACTIONS_TIMEOUT_MS = 45000;

export interface CustomActionSummary {
  type: 'apex' | 'flow';
  name: string;
  label: string;
}

/** Parameter shape from Salesforce's invocable-actions describe — fields
 *  beyond `name` vary by action type, so everything else is optional. */
export interface CustomActionParam {
  name: string;
  label?: string;
  type?: string;
  required?: boolean;
  description?: string | null;
  maxOccurs?: number;
}

export interface CustomActionDetail {
  type: 'apex' | 'flow';
  name: string;
  label: string;
  description: string | null;
  inputs: CustomActionParam[];
  outputs: CustomActionParam[];
}

export async function loadCustomActions(): Promise<CustomActionSummary[]> {
  const body = await apexFetch<{ actions: CustomActionSummary[] }>(
    `${CUSTOM_ACTIONS_BASE}?mode=list`,
    { method: 'GET' },
    CUSTOM_ACTIONS_TIMEOUT_MS
  );
  return body.actions ?? [];
}

export async function describeCustomAction(type: 'apex' | 'flow', name: string): Promise<CustomActionDetail> {
  const params = new URLSearchParams({ mode: 'describe', type, name });
  return apexFetch<CustomActionDetail>(
    `${CUSTOM_ACTIONS_BASE}?${params.toString()}`,
    { method: 'GET' },
    CUSTOM_ACTIONS_TIMEOUT_MS
  );
}
