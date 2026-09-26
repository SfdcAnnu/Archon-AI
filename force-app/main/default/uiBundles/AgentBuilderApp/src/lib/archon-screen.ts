/**
 * What the copilot's show_on_screen tool asked the screen to draw.
 *
 * The tool's result is JSON followed by a line for the model; the JSON is
 * read here. A usage or cost view carries the per-agent rows the copilot
 * was given, so the surface shows the same numbers the reply quotes.
 */
export type ScreenView = 'dashboard' | 'usage' | 'failures' | 'drafts' | 'approvals' | 'cost' | 'build';
const VIEWS = new Set<string>(['dashboard', 'usage', 'failures', 'drafts', 'approvals', 'cost', 'build']);

export interface UsageRow {
  apiName: string;
  name: string;
  /** null when the rows came from the org's aggregate, which counts only today's turns */
  turns: number | null;
  tokensIn: number;
  tokensOut: number;
}

export interface UsageReport {
  days: number;
  rows: UsageRow[];
  /** 'archon' — the rows the copilot was shown; 'org' — read by the screen itself */
  source: 'archon' | 'org';
}

export interface ScreenRequest {
  view: ScreenView;
  days: number | null;
  agentApiName: string | null;
  usage?: UsageReport;
}

export function parseScreen(output: unknown): ScreenRequest | null {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: { screen?: { view?: unknown; days?: unknown; agentApiName?: unknown }; usage?: { days?: unknown; byAgent?: unknown } } | null = null;
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { parsed = null; }
  const view = parsed?.screen?.view;
  if (typeof view !== 'string' || !VIEWS.has(view)) return null;
  const req: ScreenRequest = {
    view: view as ScreenView,
    days: typeof parsed?.screen?.days === 'number' ? parsed.screen.days : null,
    agentApiName: typeof parsed?.screen?.agentApiName === 'string' ? parsed.screen.agentApiName : null,
  };
  const rows = Array.isArray(parsed?.usage?.byAgent) ? parsed.usage.byAgent : null;
  if (rows) {
    req.usage = {
      days: typeof parsed?.usage?.days === 'number' ? parsed.usage.days : req.days ?? 31,
      source: 'archon',
      rows: rows
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map(r => ({
          apiName: String(r.apiName ?? ''),
          name: String(r.name ?? r.apiName ?? ''),
          turns: typeof r.turns === 'number' ? r.turns : null,
          tokensIn: Number(r.tokensIn ?? 0),
          tokensOut: Number(r.tokensOut ?? 0),
        }))
        .filter(r => r.apiName),
    };
  }
  return req;
}
