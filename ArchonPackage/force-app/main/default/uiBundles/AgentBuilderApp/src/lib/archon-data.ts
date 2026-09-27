import { loadHomeStats, type HomeStats } from './home-stats-data';
import { loadExecutionLogs, type RawAgentExecution } from './executions-data';
import { loadPendingApprovals, type ApprovalDto } from './approvals-data';
import { listChatApprovals, type ChatApproval } from './chat-approvals-data';
import { loadAgents, type AgentSummary } from './agents-data';
import { listMySessions, type SessionSummary } from './conversations-data';

/**
 * What the Archon screen's surfaces are drawn from — the same org reads
 * the Home dashboard makes, gathered once and derived here so a surface
 * is a pure view of this object. Every number is real; the one estimate
 * (spend from tokens) says so wherever it is shown.
 */
export interface ArchonData {
  stats: HomeStats | null;
  runs: RawAgentExecution[];
  approvals: ApprovalDto[];
  chatApprovals: ChatApproval[];
  agents: AgentSummary[];
  sessions: SessionSummary[];
  errors: string[];
  loadedAt: number;
}

/** Blended token prices, the same the Home dashboard's estimate uses. */
export const USD_PER_M_IN = 2.5;
export const USD_PER_M_OUT = 10;

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function loadArchonData(): Promise<ArchonData> {
  const [statsR, runsR, apprR, chatR, agentsR, sessR] = await Promise.allSettled([
    loadHomeStats(1),
    loadExecutionLogs({ pageSize: 200, pageOffset: 0 }),
    loadPendingApprovals(),
    listChatApprovals({ status: 'Pending' }),
    loadAgents(),
    listMySessions(100),
  ]);
  const errors: string[] = [];
  const take = <T,>(r: PromiseSettledResult<T>, fallback: T, what: string): T => {
    if (r.status === 'fulfilled') return r.value;
    errors.push(`${what}: ${errMsg(r.reason)}`);
    return fallback;
  };
  return {
    stats: take(statsR, null as HomeStats | null, 'activity'),
    runs: take(runsR, { records: [], total: 0, pageSize: 0, pageOffset: 0 }, 'runs').records,
    approvals: take(apprR, [] as ApprovalDto[], 'approvals'),
    chatApprovals: take(chatR, [] as ChatApproval[], 'chat approvals'),
    agents: take(agentsR, [] as AgentSummary[], 'agents'),
    sessions: take(sessR, [] as SessionSummary[], 'conversations'),
    errors,
    loadedAt: Date.now(),
  };
}

// ── derivations (pure, tested) ─────────────────────────────────────────

export const isFailedRun = (r: Pick<RawAgentExecution, 'Status__c'>): boolean => /error|timeout|fail/i.test(r.Status__c ?? '');

export function isSameDay(iso: string | null | undefined, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

/** Runs today, per hour of the person's day: [ok, failed] × 24. */
export function runsByHour(runs: RawAgentExecution[], now: Date): Array<[number, number]> {
  const hours: Array<[number, number]> = Array.from({ length: 24 }, () => [0, 0]);
  for (const r of runs) {
    if (!isSameDay(r.CreatedDate, now)) continue;
    const h = new Date(r.CreatedDate).getHours();
    if (isFailedRun(r)) hours[h][1] += 1;
    else hours[h][0] += 1;
  }
  return hours;
}

export interface TodayTotals {
  runs: number;
  runsFailed: number;
  turns: number;
  turnsFailed: number;
  /** estimated from tokens at blended rates */
  spendUsd: number;
}

/** Today's totals from the aggregate; the last day in the window is today. */
export function todayTotals(stats: HomeStats | null): TodayTotals {
  const day = stats?.byDay[stats.byDay.length - 1];
  const tokensIn = stats?.tokensIn ?? 0;
  const tokensOut = stats?.tokensOut ?? 0;
  return {
    runs: day ? day.runsOk + day.runsFailed + day.runsOther : 0,
    runsFailed: day?.runsFailed ?? 0,
    turns: day ? day.turnsOk + day.turnsFailed : 0,
    turnsFailed: day?.turnsFailed ?? 0,
    spendUsd: (tokensIn / 1e6) * USD_PER_M_IN + (tokensOut / 1e6) * USD_PER_M_OUT,
  };
}

export interface AgentHealthRow {
  apiName: string;
  name: string;
  total: number;
  failed: number;
  /** 0–100, null when nothing ran */
  okPct: number | null;
  /** mean run time from today's sampled runs, null when none */
  avgMs: number | null;
  spendUsd: number;
}

export function agentHealth(stats: HomeStats | null, runs: RawAgentExecution[], now: Date): AgentHealthRow[] {
  const ms = new Map<string, { sum: number; n: number }>();
  for (const r of runs) {
    if (!isSameDay(r.CreatedDate, now) || r.ExecutionMs__c == null) continue;
    const k = r['AgentDefinition__r.Name'];
    const cur = ms.get(k) ?? { sum: 0, n: 0 };
    ms.set(k, { sum: cur.sum + r.ExecutionMs__c, n: cur.n + 1 });
  }
  return (stats?.byAgent ?? [])
    .map(a => {
      const total = a.runsToday + a.turnsToday;
      const failed = a.runsFailedToday + a.turnsFailedToday;
      const m = ms.get(a.name);
      return {
        apiName: a.apiName,
        name: a.name,
        total,
        failed,
        okPct: total ? Math.round(((total - failed) / total) * 100) : null,
        avgMs: m && m.n ? Math.round(m.sum / m.n) : null,
        spendUsd: (a.tokensIn / 1e6) * USD_PER_M_IN + (a.tokensOut / 1e6) * USD_PER_M_OUT,
      };
    })
    .sort((x, y) => y.total - x.total || x.name.localeCompare(y.name));
}

export interface TodayEvent {
  at: string;
  text: string;
  sub: string;
  tone: 'ok' | 'bad' | 'warn';
}

/** What happened today, newest first: runs, conversations, approvals. */
export function todayEvents(d: Pick<ArchonData, 'runs' | 'sessions' | 'approvals' | 'chatApprovals'>, now: Date): TodayEvent[] {
  const out: TodayEvent[] = [];
  for (const r of d.runs) {
    if (!isSameDay(r.CreatedDate, now)) continue;
    const bad = isFailedRun(r);
    out.push({ at: r.CreatedDate, text: `${r['AgentDefinition__r.Name']} ${bad ? 'failed' : 'ran'}`, sub: (r.AgentReason__c ?? r.Status__c ?? '').slice(0, 90), tone: bad ? 'bad' : 'ok' });
  }
  for (const s of d.sessions) {
    if (!isSameDay(s.lastActivityAt, now)) continue;
    out.push({ at: s.lastActivityAt!, text: `${s.agentName}: ${s.title ?? 'conversation'}`, sub: s.totalTurns ? `${s.totalTurns} turn${s.totalTurns === 1 ? '' : 's'} · ${s.status}` : s.status, tone: 'ok' });
  }
  for (const a of d.approvals) {
    if (!isSameDay(a.createdDate, now)) continue;
    out.push({ at: a.createdDate, text: 'Approval requested', sub: `${a.agentApiName} · ${a.nodeLabel}`, tone: 'warn' });
  }
  for (const a of d.chatApprovals) {
    if (!isSameDay(a.createdAt, now)) continue;
    out.push({ at: a.createdAt, text: 'Approval requested', sub: `${a.agentApiName} · ${a.toolName}`, tone: 'warn' });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export function failedRunsToday(runs: RawAgentExecution[], now: Date): RawAgentExecution[] {
  return runs.filter(r => isSameDay(r.CreatedDate, now) && isFailedRun(r)).sort((a, b) => b.CreatedDate.localeCompare(a.CreatedDate));
}

export interface CostRow {
  name: string;
  usd: number;
}

/** Spend per agent over the window, largest first — an estimate from tokens. */
export function costByAgent(stats: HomeStats | null): CostRow[] {
  return (stats?.byAgent ?? [])
    .map(a => ({ name: a.name, usd: (a.tokensIn / 1e6) * USD_PER_M_IN + (a.tokensOut / 1e6) * USD_PER_M_OUT }))
    .filter(r => r.usd > 0)
    .sort((a, b) => b.usd - a.usd);
}
