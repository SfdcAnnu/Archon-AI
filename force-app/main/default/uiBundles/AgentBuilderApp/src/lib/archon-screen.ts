/**
 * What the copilot's show_on_screen tool asked the screen to draw.
 *
 * The tool's result is JSON followed by a line for the model; the JSON is
 * read here. A usage or cost view carries the per-agent rows the copilot
 * was given; failures, drafts and approvals carry their rows too, so the
 * surface shows the same data the reply quotes.
 */
import type { RawAgentExecution } from './executions-data';
import type { AgentSummary } from './agents-data';
import type { ApprovalDto } from './approvals-data';
import type { ChatApproval } from './chat-approvals-data';
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

/** The rows the copilot's tool read for a list view, in the shapes the
 *  screen already draws: the surface shows these first, labelled as what
 *  Archon reported, and the org read keeps them fresh afterwards. */
export interface ReportedRows {
  runs?: RawAgentExecution[];
  agents?: AgentSummary[];
  approvals?: ApprovalDto[];
  chatApprovals?: ChatApproval[];
}

export interface ScreenRequest {
  view: ScreenView;
  days: number | null;
  agentApiName: string | null;
  usage?: UsageReport;
  reported?: ReportedRows;
}

const rowsOf = <T,>(v: unknown): T[] | undefined =>
  (Array.isArray(v) ? v.filter((r): r is T => !!r && typeof r === 'object') : undefined);

export function parseScreen(output: unknown): ScreenRequest | null {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: {
    screen?: { view?: unknown; days?: unknown; agentApiName?: unknown };
    usage?: { days?: unknown; byAgent?: unknown };
    runs?: unknown; agents?: unknown; approvals?: unknown; chatApprovals?: unknown;
  } | null = null;
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { parsed = null; }
  const view = parsed?.screen?.view;
  if (typeof view !== 'string' || !VIEWS.has(view)) return null;
  const req: ScreenRequest = {
    view: view as ScreenView,
    days: typeof parsed?.screen?.days === 'number' ? parsed.screen.days : null,
    agentApiName: typeof parsed?.screen?.agentApiName === 'string' ? parsed.screen.agentApiName : null,
  };
  const reported: ReportedRows = {};
  const runs = rowsOf<RawAgentExecution>(parsed?.runs);
  const agents = rowsOf<AgentSummary>(parsed?.agents);
  const approvals = rowsOf<ApprovalDto>(parsed?.approvals);
  const chatApprovals = rowsOf<ChatApproval>(parsed?.chatApprovals);
  if (runs) reported.runs = runs;
  if (agents) reported.agents = agents;
  if (approvals) reported.approvals = approvals;
  if (chatApprovals) reported.chatApprovals = chatApprovals;
  if (Object.keys(reported).length) req.reported = reported;
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
