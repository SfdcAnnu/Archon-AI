import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { PageBody } from '@/components/shell/PageBody';
import { Bar, EmptyPanel, NoteBar, SpecCard, StatCard } from '@/components/spec/blocks';
import { listMySessions, parseModelUsage, type SessionSummary } from '@/lib/conversations-data';

/** Spec screen 13 "Cost" — answers "Where is the usage going?".
 *
 *  Dollar spend is deliberately not shown: pricing is per-model and per-org
 *  (negotiated rates differ), and inventing a number from list prices would
 *  be worse than showing none. What this screen does report is exact —
 *  tokens, split BY MODEL, plus response time.
 *
 *  Per-model is the part that has to be right. One turn can span the
 *  router's model, a specialist subagent's, and cheap utility passes, so
 *  the single ModelUsed__c column cannot attribute tokens correctly. These
 *  numbers come from ChatSession__c.UsageByModelJson__c, the running
 *  per-model totals the server reports for every turn. */

const SESSION_LIMIT = 50;

const AGENT_BAR_COLORS = ['var(--primary)', 'var(--node-purple)', 'var(--node-teal)', 'var(--node-amber)', 'var(--node-gray)'];

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtMs(ms: number): string {
  if (ms < 950) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function inCurrentMonth(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
}

function tokensOf(s: SessionSummary): number {
  return (s.tokensIn ?? 0) + (s.tokensOut ?? 0);
}

export default function CostPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listMySessions(SESSION_LIMIT)
      .then(s => setSessions(s))
      .catch(e => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Derivations — all real sums over session token counters ──────────
  const all = sessions ?? [];
  const monthSessions = all.filter(s => inCurrentMonth(s.lastActivityAt));
  const totalTokens = monthSessions.reduce((sum, s) => sum + tokensOf(s), 0);
  const totalIn = monthSessions.reduce((sum, s) => sum + (s.tokensIn ?? 0), 0);
  const totalOut = monthSessions.reduce((sum, s) => sum + (s.tokensOut ?? 0), 0);
  const perSession = monthSessions.length > 0 ? Math.round(totalTokens / monthSessions.length) : 0;
  // The API returns the most recent N sessions — if every one of them is
  // still inside this month, older in-month sessions may be cut off.
  const monthTruncated = all.length >= SESSION_LIMIT && monthSessions.length === all.length;
  const plus = monthTruncated ? '+' : '';

  const byAgent = new Map<string, number>();
  for (const s of monthSessions) byAgent.set(s.agentName, (byAgent.get(s.agentName) ?? 0) + tokensOf(s));
  const agentRows = [...byAgent.entries()]
    .map(([name, tokens]) => ({ name, tokens }))
    .sort((a, b) => b.tokens - a.tokens);
  const maxAgentTokens = Math.max(1, ...agentRows.map(r => r.tokens));

  // ── Per-model usage — the accurate split, not an approximation from
  // whichever model happened to produce each reply.
  const byModel = new Map<string, { tokensIn: number; tokensOut: number; cacheRead: number; calls: number }>();
  for (const s of monthSessions) {
    for (const u of parseModelUsage(s.usageByModelJson)) {
      const acc = byModel.get(u.model) ?? { tokensIn: 0, tokensOut: 0, cacheRead: 0, calls: 0 };
      acc.tokensIn += u.tokensIn;
      acc.tokensOut += u.tokensOut;
      acc.cacheRead += u.cacheRead;
      acc.calls += u.calls;
      byModel.set(u.model, acc);
    }
  }
  const modelRows = [...byModel.entries()]
    .map(([model, v]) => ({ model, ...v, total: v.tokensIn + v.tokensOut }))
    .sort((a, b) => b.total - a.total);
  const maxModelTokens = Math.max(1, ...modelRows.map(r => r.total));
  // Sessions predating per-model tracking still count toward the token
  // totals — say so rather than letting the two panels silently disagree.
  const unattributed = Math.max(0, totalTokens - modelRows.reduce((n, r) => n + r.total, 0));

  const totalCached = monthSessions.reduce((sum, s) => sum + (s.cachedTokens ?? 0), 0);
  const cachedPct = totalIn > 0 ? Math.round((totalCached / totalIn) * 100) : 0;

  const timedSessions = monthSessions.filter(s => (s.latencyMsTotal ?? 0) > 0 && (s.totalTurns ?? 0) > 0);
  const totalMs = timedSessions.reduce((sum, s) => sum + (s.latencyMsTotal ?? 0), 0);
  const totalTimedTurns = timedSessions.reduce((sum, s) => sum + (s.totalTurns ?? 0), 0);
  const avgMs = totalTimedTurns > 0 ? totalMs / totalTimedTurns : null;

  const outPct = totalIn + totalOut > 0 ? Math.round((totalOut / (totalIn + totalOut)) * 100) : 0;
  const rwFinding =
    outPct >= 55 ? (
      <>
        Most tokens go to <b>writing</b> replies ({outPct}%). Shorter replies save more than shorter instructions.
      </>
    ) : outPct <= 45 ? (
      <>
        Most tokens go to <b>reading</b> input ({100 - outPct}%). Trimming prompts and record context saves the most.
      </>
    ) : (
      <>Reading and writing are roughly even ({100 - outPct}% vs {outPct}%) — no single lever dominates.</>
    );

  const noSessions = sessions != null && all.length === 0;
  const noMonthData = sessions != null && all.length > 0 && monthSessions.length === 0;

  return (
    <AppShell title="Cost" onRefresh={load}>
      <PageBody width="wide">
        {loading && sessions == null && !error ? (
          <div className="flex items-center gap-2 py-8 text-[12.5px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : error ? (
          <EmptyPanel>Couldn't load sessions — {error}</EmptyPanel>
        ) : (
          <>
            <div className="mb-3 text-[11.5px] text-muted-foreground">
              Usage is tracked per model — one turn can span the lead agent, a specialist and utility
              passes, each on its own model. Dollar amounts aren't shown because token prices differ per
              model and per contract.
            </div>

            {/* ── Stat row ─────────────────────────────────────────── */}
            <div className="mb-3.5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Tokens this month"
                value={`${fmt(totalTokens)}${plus}`}
                sub={`in + out, across your last ${all.length} sessions`}
              />
              <StatCard
                label="Sessions"
                value={`${fmt(monthSessions.length)}${plus}`}
                sub="with activity this month"
              />
              <StatCard
                label="Tokens per session"
                value={monthSessions.length > 0 ? fmt(perSession) : '—'}
                sub={monthSessions.length > 0 ? 'average, this month' : 'no sessions this month'}
              />
              <StatCard
                label="Avg response time"
                value={avgMs != null ? fmtMs(avgMs) : '—'}
                valueClass={avgMs == null ? 'text-[var(--archon-faint)]' : undefined}
                sub={
                  avgMs != null
                    ? `per turn, across ${fmt(totalTimedTurns)} timed turn${totalTimedTurns === 1 ? '' : 's'}`
                    : 'no turns with timing recorded yet'
                }
              />
            </div>

            {noSessions ? (
              <EmptyPanel>
                No sessions yet — cost data appears here once your agents have conversations.
              </EmptyPanel>
            ) : noMonthData ? (
              <EmptyPanel>
                No session activity this month yet — usage breakdowns appear with the first conversation.
              </EmptyPanel>
            ) : (
              <div className="grid items-start gap-3.5 lg:grid-cols-2">
                {/* ── Usage by model ─────────────────────────────────── */}
                <SpecCard title="Usage by model" muted="tokens, this month">
                  {modelRows.length === 0 ? (
                    <div className="p-3.5">
                      <EmptyPanel>
                        No per-model usage recorded yet — it's captured from the first turn of each new
                        conversation.
                      </EmptyPanel>
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-2.5 px-3.5 py-3 text-[11.5px]">
                        {modelRows.map((r, i) => (
                          <div key={r.model}>
                            <div className="flex justify-between">
                              <span className="min-w-0 truncate pr-2 font-semibold">{r.model}</span>
                              <b className="font-mono">{fmt(r.total)}</b>
                            </div>
                            <Bar
                              pct={(r.total / maxModelTokens) * 100}
                              color={AGENT_BAR_COLORS[i % AGENT_BAR_COLORS.length]}
                            />
                            <div className="mt-0.5 flex justify-between text-[10.5px] text-muted-foreground">
                              <span>
                                {fmt(r.calls)} call{r.calls === 1 ? '' : 's'} · {fmt(r.tokensIn)} in ·{' '}
                                {fmt(r.tokensOut)} out
                              </span>
                              {r.cacheRead > 0 && <span>{fmt(r.cacheRead)} cached</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                      {unattributed > 0 && (
                        <NoteBar>
                          {fmt(unattributed)} tokens aren't attributed to a model — they come from
                          conversations that ran before per-model tracking.
                        </NoteBar>
                      )}
                    </>
                  )}
                </SpecCard>

                {/* ── Usage by agent ─────────────────────────────────── */}
                <SpecCard title="Usage by agent" muted="tokens, this month">
                  {totalTokens === 0 ? (
                    <div className="p-3.5">
                      <EmptyPanel>No token counts recorded on this month's sessions yet.</EmptyPanel>
                    </div>
                  ) : (
                    <div className="grid gap-2.5 px-3.5 py-3 text-[11.5px]">
                      {agentRows.map((r, i) => (
                        <div key={r.name}>
                          <div className="flex justify-between">
                            <button
                              type="button"
                              onClick={() => navigate('/conversations')}
                              className="min-w-0 truncate pr-2 text-left font-semibold text-primary hover:underline"
                            >
                              {r.name}
                            </button>
                            <b className="font-mono">{fmt(r.tokens)}</b>
                          </div>
                          <Bar
                            pct={(r.tokens / maxAgentTokens) * 100}
                            color={AGENT_BAR_COLORS[i % AGENT_BAR_COLORS.length]}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </SpecCard>

                {/* ── Reading vs writing ─────────────────────────────── */}
                <SpecCard title="Reading vs writing" muted="tokens in vs out, this month">
                  {totalIn + totalOut === 0 ? (
                    <div className="p-3.5">
                      <EmptyPanel>No token counts recorded on this month's sessions yet.</EmptyPanel>
                    </div>
                  ) : (
                    <>
                      <div className="p-3.5">
                        <div className="flex h-4 overflow-hidden rounded-full">
                          <i
                            className="block h-full"
                            style={{ width: `${100 - outPct}%`, background: 'var(--primary)' }}
                          />
                          <i className="block h-full" style={{ width: `${outPct}%`, background: 'var(--node-purple)' }} />
                        </div>
                        <div className="mt-3 text-[11.5px]">
                          <div className="flex justify-between py-0.5">
                            <span>
                              <span className="text-primary">●</span> Reading — tokens in
                            </span>
                            <b className="font-mono">{fmt(totalIn)}</b>
                          </div>
                          <div className="flex justify-between py-0.5">
                            <span>
                              <span className="text-[var(--node-purple)]">●</span> Writing — tokens out
                            </span>
                            <b className="font-mono">{fmt(totalOut)}</b>
                          </div>
                          {totalCached > 0 && (
                            <div className="flex justify-between py-0.5 text-muted-foreground">
                              <span>of which served from cache</span>
                              <b className="font-mono">
                                {fmt(totalCached)} ({cachedPct}%)
                              </b>
                            </div>
                          )}
                        </div>
                      </div>
                      <NoteBar>{rwFinding}</NoteBar>
                    </>
                  )}
                </SpecCard>
              </div>
            )}
          </>
        )}
      </PageBody>
    </AppShell>
  );
}
