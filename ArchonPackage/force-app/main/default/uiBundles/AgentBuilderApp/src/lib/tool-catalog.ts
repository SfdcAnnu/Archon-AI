import {
  loadMcpToolsWithRetry,
  type DirectoryEntry,
  type RemoteTool,
} from './connectors-data';

/** Shared tool-catalog enumeration for the Connectors screen: one live
 *  tools/list per CONNECTED connector (standard MCP providers and custom
 *  MCP servers alike — both flow through AgentMcpToolsRestService), plus
 *  the presentation-only access classification and input-schema parsing
 *  the All-tools table and Tool-details panel share. */

export type ToolAccess = 'read' | 'write' | 'delete';

/** HEURISTIC, presentation-only (approved spec): a tool name starting with
 *  get/list/find/search/soql/read is shown "Read only"; a name containing
 *  "delete" is shown "Deletes data"; everything else "Changes data".
 *  Nothing enforces this — it is a review hint, never a permission. */
export function classifyToolAccess(name: string): ToolAccess {
  if (/delete/i.test(name)) return 'delete';
  if (/^(get|list|find|search|soql|read)/i.test(name)) return 'read';
  return 'write';
}

export interface CatalogTool {
  name: string;
  description: string | null;
  /** JSON-encoded MCP input schema, verbatim from tools/list (may be null). */
  inputSchema: string | null;
  access: ToolAccess;
}

export interface ConnectorToolGroup {
  providerKey: string;
  displayName: string;
  description: string | null;
  brandColor: string | null;
  isCustom: boolean;
  /** 'error' = this connector's live tools/list call failed; tools is []. */
  state: 'ready' | 'error';
  error: string | null;
  tools: CatalogTool[];
}

function toCatalogTool(tool: RemoteTool): CatalogTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    access: classifyToolAccess(tool.name),
  };
}

/** Live tools/list for every CONNECTED directory entry, in parallel.
 *  Never rejects as a whole — a connector whose server does not answer
 *  becomes a state:'error' group so the rest of the catalog still renders.
 *  onWaking fires if any server reports it is cold-starting. */
export async function loadToolCatalog(
  directory: DirectoryEntry[],
  onWaking?: () => void
): Promise<ConnectorToolGroup[]> {
  const connected = directory.filter(d => d.status === 'Connected');
  const results = await Promise.allSettled(
    connected.map(entry => loadMcpToolsWithRetry(entry.providerKey, entry.connectorId, onWaking))
  );
  return connected.map((entry, i) => {
    const result = results[i];
    const base = {
      providerKey: entry.providerKey,
      displayName: entry.displayName,
      description: entry.description,
      brandColor: entry.brandColor,
      isCustom: entry.isCustom === true,
    };
    if (result.status === 'fulfilled') {
      return { ...base, state: 'ready' as const, error: null, tools: result.value.map(toCatalogTool) };
    }
    const reason: unknown = result.reason;
    return {
      ...base,
      state: 'error' as const,
      error: reason instanceof Error ? reason.message : 'The tool server did not respond.',
      tools: [],
    };
  });
}

// ── Input-schema parsing (Tool details argument rows) ────────────────

export interface ToolArg {
  name: string;
  type: string | null;
  description: string | null;
  required: boolean;
}

/** Parse a tool's JSON-encoded MCP input schema into argument rows.
 *  Returns null when there is no schema (or it is unreadable) — the
 *  caller shows an honest empty state instead. An empty array means the
 *  schema parsed and the tool genuinely takes no arguments. */
export function parseToolArgs(inputSchema: string | null): ToolArg[] | null {
  if (!inputSchema) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(inputSchema);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const schema = parsed as { properties?: unknown; required?: unknown };
  if (typeof schema.properties !== 'object' || schema.properties === null) {
    // A valid schema with no properties block: no declared arguments.
    return 'type' in schema ? [] : null;
  }
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === 'string') : []
  );
  const args: ToolArg[] = Object.entries(schema.properties as Record<string, unknown>).map(([name, def]) => {
    const d = (typeof def === 'object' && def !== null ? def : {}) as {
      type?: unknown;
      description?: unknown;
    };
    return {
      name,
      type: typeof d.type === 'string' ? d.type : null,
      description: typeof d.description === 'string' ? d.description : null,
      required: required.has(name),
    };
  });
  // Required arguments first, original order otherwise (sort is stable).
  return args.sort((a, b) => Number(b.required) - Number(a.required));
}
