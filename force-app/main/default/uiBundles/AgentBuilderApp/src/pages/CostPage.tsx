import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Bar, EmptyPanel, NoteBar, SpecCard, StatCard } from '@/components/spec/blocks';
import { listMySessions, type SessionSummary } from '@/lib/conversations-data';

/** Spec screen 13 "Cost" — answers "Where is the money going?". The
 *  platform does not record dollar spend yet, so this screen shows TOKEN
 *  usage as the cost proxy, clearly labeled as such. Every number comes
 *  from real session token counters (TokensIn__c/TokensOut__c) — the
 *  dollar card stays an honest dash until per-model pricing exists. */

const SESSION_LIMIT = 50;

const AGENT_BAR_COLORS = ['#0176d3', '#9050e9', '#06a59a', '#dd7a01', '#6b7280'];

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
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
      <div className="mx-auto w-full max-w-[1180px] p-5">
        {loading && sessions == null && !error ? (
          <div className="flex items-center gap-2 py-8 text-[12.5px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : error ? (
          <EmptyPanel>Couldn't load sessions — {error}</EmptyPanel>
        ) : (
          <>
            <div className="mb-3 text-[11.5px] text-muted-foreground">
              Dollar spend isn't recorded yet — token usage below is the cost proxy until per-model pricing lands.
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
                label="Dollar spend"
                value="—"
                valueClass="text-[var(--archon-faint)]"
                sub="arrives with per-model pricing"
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
                            style={{ width: `${100 - outPct}%`, background: '#0176d3' }}
                          />
                          <i className="block h-full" style={{ width: `${outPct}%`, background: '#9050e9' }} />
                        </div>
                        <div className="mt-3 text-[11.5px]">
                          <div className="flex justify-between py-0.5">
                            <span>
                              <span className="text-[#0176d3]">●</span> Reading — tokens in
                            </span>
                            <b className="font-mono">{fmt(totalIn)}</b>
                          </div>
                          <div className="flex justify-between py-0.5">
                            <span>
                              <span className="text-[#9050e9]">●</span> Writing — tokens out
                            </span>
                            <b className="font-mono">{fmt(totalOut)}</b>
                          </div>
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
      </div>
    </AppShell>
  );
}
