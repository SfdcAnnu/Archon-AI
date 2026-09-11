import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, Bot, CheckCircle2, CheckSquare, Loader2 } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import {
  AttnRow,
  Bar,
  EmptyPanel,
  IconSquare,
  NoteBar,
  SpecCard,
  StatCard,
  StatusBadge,
} from '@/components/spec/blocks';
import { loadAgents, type AgentSummary } from '@/lib/agents-data';
import { listMySessions, type SessionSummary } from '@/lib/conversations-data';
import { loadPendingApprovals, type ApprovalDto } from '@/lib/approvals-data';
import { listChatApprovals, type ChatApproval } from '@/lib/chat-approvals-data';
import { loadExecutionLogs, type ExecutionPage, type RawAgentExecution } from '@/lib/executions-data';

/** Spec screen 01 "Home" — answers "What needs me right now?". Four stat
 *  cards, the 24h activity chart with its finding stated in words, sessions
 *  by agent, and a derived "Needs your attention" queue. Every number on
 *  this page is computed from live platform data at render time — panels
 *  the platform cannot back with real data degrade to honest empty states,
 *  never to fabricated numbers. */

/** How many recent runs we pull to derive "today" client-side — the
 *  executions API pages by offset but has no date filter. */
const EXEC_PAGE_SIZE = 200;

const FAILURE_STATUSES = new Set(['ERROR', 'TIMEOUT']);

interface HomeData {
  execs: ExecutionPage | null;
  execError: string | null;
  sessions: SessionSummary[] | null;
  sessionsError: string | null;
  approvals: ApprovalDto[] | null;
  chatApprovals: ChatApproval[] | null;
  approvalsError: string | null;
  agents: AgentSummary[] | null;
  agentsError: string | null;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function agoLabel(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

interface HourBucket {
  runs: number;
  fails: number;
}

/** Today's runs in twelve 2-hour buckets (00–02 … 22–24). */
function bucketToday(runs: RawAgentExecution[]): HourBucket[] {
  const buckets: HourBucket[] = Array.from({ length: 12 }, () => ({ runs: 0, fails: 0 }));
  for (const r of runs) {
    const i = Math.min(11, Math.floor(new Date(r.CreatedDate).getHours() / 2));
    const b = buckets[i];
    b.runs += 1;
    if (FAILURE_STATUSES.has(r.Status__c)) b.fails += 1;
  }
  return buckets;
}

/** Tiny sparkline for a stat card — real bucket values only. */
function MiniSpark({ values, stroke }: { values: number[]; stroke: string }) {
  const max = Math.max(1, ...values);
  const step = 200 / (values.length - 1);
  const pts = values.map((v, i) => `${Math.round(i * step * 10) / 10},${Math.round((23 - (v / max) * 20) * 10) / 10}`).join(' ');
  return (
    <svg className="mt-1 h-[26px] w-full" viewBox="0 0 200 26" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={2} />
    </svg>
  );
}

/** 24h activity chart — blue area polyline for runs, red bars for
 *  failures, mirroring the approved mock's SVG structure. */
function ActivityChart({ buckets }: { buckets: HourBucket[] }) {
  const maxV = Math.max(1, ...buckets.map(b => b.runs));
  const xs = buckets.map((_, i) => 40 + i * 48);
  const ys = buckets.map(b => Math.round((120 - (b.runs / maxV) * 110) * 10) / 10);
  const line = buckets.map((_, i) => `${xs[i]},${ys[i]}`).join(' ');
  const area = `M${xs[0]} ${ys[0]} ${buckets
    .slice(1)
    .map((_, i) => `L${xs[i + 1]} ${ys[i + 1]}`)
    .join(' ')} L568 120 L40 120 Z`;
  return (
    <svg viewBox="0 0 600 150" className="h-[170px] w-full">
      <g stroke="#eceef1">
        <line x1={30} y1={10} x2={600} y2={10} />
        <line x1={30} y1={65} x2={600} y2={65} />
        <line x1={30} y1={120} x2={600} y2={120} />
      </g>
      <text x={24} y={14} fontSize={9} fill="#8a919e" textAnchor="end" className="font-mono">
        {maxV}
      </text>
      <text x={24} y={69} fontSize={9} fill="#8a919e" textAnchor="end" className="font-mono">
        {Math.round(maxV / 2)}
      </text>
      <text x={24} y={124} fontSize={9} fill="#8a919e" textAnchor="end" className="font-mono">
        0
      </text>
      <path d={area} fill="#0176d3" opacity={0.12} />
      <polyline points={line} fill="none" stroke="#0176d3" strokeWidth={2} />
      <g fill="#ba0517">
        {buckets.map((b, i) => {
          if (b.fails === 0) return null;
          const h = Math.max(3, (b.fails / maxV) * 110);
          return <rect key={i} x={xs[i] - 4} y={120 - h} width={9} height={h} rx={1} />;
        })}
      </g>
      <g fontSize={9} fill="#8a919e" className="font-mono">
        <text x={40} y={140}>00</text>
        <text x={184} y={140}>06</text>
        <text x={328} y={140}>12</text>
        <text x={472} y={140}>18</text>
      </g>
    </svg>
  );
}

const DONUT_COLORS = ['#0176d3', '#9050e9', '#06a59a', '#dd7a01', '#6b7280'];

interface AgentSlice {
  name: string;
  count: number;
}

/** Donut of session counts per agent (real listMySessions data), center
 *  shows the total — the spec's spend donut adapted to data we track. */
function SessionsDonut({ groups, total }: { groups: AgentSlice[]; total: number }) {
  const C = 2 * Math.PI * 47;
  let acc = 0;
  return (
    <svg width={150} height={150} viewBox="0 0 120 120">
      <g transform="rotate(-90 60 60)" fill="none" strokeWidth={13}>
        {groups.map((g, i) => {
          const len = (g.count / total) * C;
          const off = acc;
          acc += len;
          return (
            <circle
              key={g.name}
              cx={60}
              cy={60}
              r={47}
              stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
              strokeDasharray={`${Math.round(len * 100) / 100} ${Math.round(C * 100) / 100}`}
              strokeDashoffset={-Math.round(off * 100) / 100}
            />
          );
        })}
      </g>
      <text x={60} y={58} textAnchor="middle" fontSize={17} fontWeight={600} fill="#16181d" className="font-mono">
        {total}
      </text>
      <text x={60} y={72} textAnchor="middle" fontSize={8.5} fill="#8a919e">
        sessions
      </text>
    </svg>
  );
}

/** Small bordered action button used on attention rows (mock's .btn.sm). */
function RowButton({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-[5px] border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-secondary/60">
      {children}
    </span>
  );
}

export default function HomeDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.allSettled([
      loadExecutionLogs({ pageSize: EXEC_PAGE_SIZE }),
      listMySessions(50),
      loadPendingApprovals(),
      listChatApprovals({ status: 'Pending' }),
      loadAgents(),
    ]).then(([execR, sessR, apprR, chatR, agentsR]) => {
      const bothApprovalsFailed = apprR.status === 'rejected' && chatR.status === 'rejected';
      setData({
        execs: execR.status === 'fulfilled' ? execR.value : null,
        execError: execR.status === 'rejected' ? errMsg(execR.reason) : null,
        sessions: sessR.status === 'fulfilled' ? sessR.value : null,
        sessionsError: sessR.status === 'rejected' ? errMsg(sessR.reason) : null,
        approvals: apprR.status === 'fulfilled' ? apprR.value : null,
        chatApprovals: chatR.status === 'fulfilled' ? chatR.value : null,
        approvalsError: bothApprovalsFailed ? errMsg(apprR.reason) : null,
        agents: agentsR.status === 'fulfilled' ? agentsR.value : null,
        agentsError: agentsR.status === 'rejected' ? errMsg(agentsR.reason) : null,
      });
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Derivations (all from real fetched data) ─────────────────────────
  const execRecords = data?.execs?.records ?? [];
  const todayRuns = execRecords.filter(r => isToday(r.CreatedDate));
  const todayFails = todayRuns.filter(r => FAILURE_STATUSES.has(r.Status__c));
  // The API has no date filter — if the whole fetched page is still
  // "today", the true count may be higher. Say so instead of guessing.
  const todayTruncated = execRecords.length >= EXEC_PAGE_SIZE && todayRuns.length === execRecords.length;
  const buckets = bucketToday(todayRuns);

  const sessions = data?.sessions ?? [];
  const activeSessions = sessions.filter(s => s.status === 'Active');

  const pendingRun = data?.approvals ?? [];
  const pendingChat = data?.chatApprovals ?? [];
  const approvalsAvailable = data != null && (data.approvals != null || data.chatApprovals != null);
  const pendingCount = pendingRun.length + pendingChat.length;
  const oldestPendingIso = [...pendingRun.map(a => a.createdDate), ...pendingChat.map(a => a.createdAt)].sort()[0];

  const agents = data?.agents ?? [];
  const draftAgents = agents.filter(a => a.status !== 'Active');

  // Sessions grouped by agent for the donut (top 4 + Other).
  const byAgent = new Map<string, number>();
  for (const s of sessions) byAgent.set(s.agentName, (byAgent.get(s.agentName) ?? 0) + 1);
  const sortedAgents: AgentSlice[] = [...byAgent.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  const donutGroups: AgentSlice[] =
    sortedAgents.length > 5
      ? [
          ...sortedAgents.slice(0, 4),
          { name: 'Other', count: sortedAgents.slice(4).reduce((s, g) => s + g.count, 0) },
        ]
      : sortedAgents;

  // Activity finding, stated in words from the computed buckets.
  let finding: ReactNode = null;
  let findingTone: 'error' | undefined;
  if (todayFails.length === 0) {
    finding = `No failures today across ${todayRuns.length} run${todayRuns.length === 1 ? '' : 's'}.`;
  } else {
    let peak = 0;
    buckets.forEach((b, i) => {
      if (b.fails > buckets[peak].fails) peak = i;
    });
    const failsByAgent = new Map<string, number>();
    for (const r of todayFails) {
      const name = r['AgentDefinition__r.Name'] || 'an unnamed agent';
      failsByAgent.set(name, (failsByAgent.get(name) ?? 0) + 1);
    }
    const top = [...failsByAgent.entries()].sort((a, b) => b[1] - a[1])[0];
    const win = `${String(peak * 2).padStart(2, '0')}:00 and ${String(peak * 2 + 2).padStart(2, '0')}:00`;
    finding = (
      <>
        Most failures were between {win}. {top[1]} of {todayFails.length} came from <b>{top[0]}</b>.
      </>
    );
    findingTone = 'error';
  }

  // "Needs your attention" — derived, each row navigates somewhere real.
  const attnRows: ReactNode[] = [];
  if (todayFails.length > 0) {
    const failsByAgent = new Map<string, number>();
    for (const r of todayFails) {
      const name = r['AgentDefinition__r.Name'] || 'an unnamed agent';
      failsByAgent.set(name, (failsByAgent.get(name) ?? 0) + 1);
    }
    const top = [...failsByAgent.entries()].sort((a, b) => b[1] - a[1])[0];
    attnRows.push(
      <AttnRow
        key="fails"
        icon={
          <IconSquare bg="var(--archon-error-tint)" color="var(--archon-error)">
            <AlertTriangle className="h-[15px] w-[15px]" />
          </IconSquare>
        }
        title={`${todayFails.length} run${todayFails.length === 1 ? '' : 's'} failed today`}
        sub={`${top[1]} from ${top[0]}`}
        onClick={() => navigate('/executions')}
      >
        <RowButton>Investigate</RowButton>
      </AttnRow>
    );
  }
  if (pendingCount > 0) {
    attnRows.push(
      <AttnRow
        key="approvals"
        icon={
          <IconSquare bg="var(--node-blue-tint)" color="var(--node-blue)">
            <CheckSquare className="h-[15px] w-[15px]" />
          </IconSquare>
        }
        title={`${pendingCount} approval${pendingCount === 1 ? '' : 's'} waiting`}
        sub={oldestPendingIso ? `Oldest has waited ${agoLabel(oldestPendingIso)}` : 'Waiting for your decision'}
        onClick={() => navigate('/approvals')}
      >
        <RowButton>Review</RowButton>
      </AttnRow>
    );
  }
  if (draftAgents.length > 0) {
    attnRows.push(
      <AttnRow
        key="drafts"
        icon={
          <IconSquare bg="var(--node-purple-tint)" color="var(--node-purple)">
            <Bot className="h-[15px] w-[15px]" />
          </IconSquare>
        }
        title={`${draftAgents.length} agent${draftAgents.length === 1 ? '' : 's'} in Draft`}
        sub="Not live yet — review and activate"
        onClick={() => navigate('/')}
      >
        <RowButton>Review</RowButton>
      </AttnRow>
    );
  }
  const attnErrors = data
    ? [
        data.execError && 'runs',
        data.approvalsError && 'approvals',
        data.agentsError && 'agents',
      ].filter((s): s is string => Boolean(s))
    : [];

  return (
    <AppShell title="Home" onRefresh={load}>
      <div className="mx-auto w-full max-w-[1180px] p-5">
        {loading && !data ? (
          <div className="flex items-center gap-2 py-8 text-[12.5px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {/* ── Stat row ─────────────────────────────────────────── */}
            <div className="mb-3.5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Runs today"
                value={data?.execs ? `${todayRuns.length}${todayTruncated ? '+' : ''}` : '—'}
                sub={
                  data?.execs
                    ? todayTruncated
                      ? `in the last ${EXEC_PAGE_SIZE} runs loaded`
                      : `${data.execs.total.toLocaleString('en-US')} all time`
                    : 'unavailable'
                }
              >
                {todayRuns.length > 0 && <MiniSpark values={buckets.map(b => b.runs)} stroke="#0176d3" />}
              </StatCard>
              <StatCard
                label="Failed"
                value={data?.execs ? String(todayFails.length) : '—'}
                valueClass={todayFails.length > 0 ? 'text-[var(--archon-error)]' : undefined}
                sub={
                  data?.execs
                    ? todayFails.length > 0
                      ? `${Math.round((todayFails.length / Math.max(1, todayRuns.length)) * 100)}% of today's runs`
                      : 'no failures today'
                    : 'unavailable'
                }
                subClass={todayFails.length > 0 ? 'text-[var(--archon-error)]' : 'text-[var(--archon-success)]'}
              >
                {todayFails.length > 0 && <MiniSpark values={buckets.map(b => b.fails)} stroke="#ba0517" />}
              </StatCard>
              <StatCard
                label="Active conversations"
                value={data?.sessions ? String(activeSessions.length) : '—'}
                sub={data?.sessions ? `of ${sessions.length} recent sessions` : 'unavailable'}
              >
                {sessions.length > 0 && (
                  <Bar pct={(activeSessions.length / sessions.length) * 100} color="var(--node-blue)" />
                )}
              </StatCard>
              <StatCard
                label="Pending approvals"
                value={approvalsAvailable ? String(pendingCount) : '—'}
                valueClass={pendingCount > 0 ? 'text-[var(--archon-warning)]' : undefined}
                sub={
                  approvalsAvailable
                    ? pendingCount > 0
                      ? 'waiting for your decision'
                      : 'queue is clear'
                    : 'unavailable'
                }
              />
            </div>

            {/* ── Activity + sessions by agent ─────────────────────── */}
            <div className="mb-3.5 grid items-start gap-3.5 lg:grid-cols-[1fr_340px]">
              <SpecCard
                title="Activity"
                muted="last 24 hours"
                right={
                  <span className="text-[10.5px] text-muted-foreground">
                    <span className="text-[var(--node-blue)]">●</span> Runs&nbsp;&nbsp;
                    <span className="text-[var(--archon-error)]">●</span> Failures
                  </span>
                }
              >
                {data?.execError ? (
                  <div className="p-3.5">
                    <EmptyPanel>Couldn't load runs — {data.execError}</EmptyPanel>
                  </div>
                ) : todayRuns.length === 0 ? (
                  <div className="p-3.5">
                    <EmptyPanel>No runs yet today.</EmptyPanel>
                  </div>
                ) : (
                  <>
                    <div className="p-3.5">
                      <ActivityChart buckets={buckets} />
                    </div>
                    <NoteBar tone={findingTone}>{finding}</NoteBar>
                  </>
                )}
              </SpecCard>

              <SpecCard title="Sessions by agent" muted="your recent sessions">
                {data?.sessionsError ? (
                  <div className="p-3.5">
                    <EmptyPanel>Couldn't load sessions — {data.sessionsError}</EmptyPanel>
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="p-3.5">
                    <EmptyPanel>No sessions yet — they appear once agents have conversations.</EmptyPanel>
                  </div>
                ) : (
                  <>
                    <div className="grid place-items-center p-4">
                      <SessionsDonut groups={donutGroups} total={sessions.length} />
                    </div>
                    <div className="px-3.5 pb-3 text-[11.5px]">
                      {donutGroups.map((g, i) => (
                        <div key={g.name} className="flex justify-between py-1">
                          <span className="min-w-0 truncate pr-2">
                            <span style={{ color: DONUT_COLORS[i % DONUT_COLORS.length] }}>●</span> {g.name}
                          </span>
                          <b className="font-mono">{g.count}</b>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </SpecCard>
            </div>

            {/* ── Needs your attention ─────────────────────────────── */}
            <SpecCard
              title="Needs your attention"
              right={
                attnRows.length > 0 ? (
                  <StatusBadge tone="error">
                    {attnRows.length} item{attnRows.length === 1 ? '' : 's'}
                  </StatusBadge>
                ) : undefined
              }
            >
              {attnRows.length > 0 ? (
                attnRows
              ) : (
                <AttnRow
                  icon={
                    <IconSquare bg="var(--archon-success-tint)" color="var(--archon-success)">
                      <CheckCircle2 className="h-[15px] w-[15px]" />
                    </IconSquare>
                  }
                  title="Nothing needs you right now"
                  sub="No failed runs, no waiting approvals, no draft agents."
                />
              )}
              {attnErrors.length > 0 && (
                <div className="border-t border-[#eceef1] px-3.5 py-2 text-[11px] text-muted-foreground">
                  Couldn't check everything — {attnErrors.join(', ')} failed to load.
                </div>
              )}
            </SpecCard>
          </>
        )}
      </div>
    </AppShell>
  );
}
