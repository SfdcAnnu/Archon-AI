import { useMemo, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { AgentKindBadge } from '@/components/AgentKindBadge';
import { decideApproval } from '@/lib/approvals-data';
import { decideChatApproval } from '@/lib/chat-approvals-data';
import {
  agentHealth, costByAgent, failedRunsToday, runsByHour, todayEvents, todayTotals, USD_PER_M_IN, USD_PER_M_OUT, type ArchonData,
} from '@/lib/archon-data';
import type { ReportedRows, UsageReport, UsageRow } from '@/lib/archon-screen';

/**
 * The shapes an answer can take beside the conversation. Each is a pure
 * view of the data the page loaded — no surface fetches for itself — and
 * every control either navigates or sends words back into the
 * conversation, so the transcript stays the record of what happened.
 */
export interface SurfaceProps {
  data: ArchonData | null;
  loading: boolean;
  now: Date;
  /** The usage report for a period: the rows the copilot sent, or the
   *  org's aggregate when the person asked in their own words. */
  report: UsageReport | null;
  /** The rows the copilot's tool read for a list view: shown first, as
   *  what Archon reported; the org read fills in around them. */
  reported: ReportedRows | null;
  onGo: (href: string) => void;
  /** Put words in the person's mouth: sent into the conversation. */
  onAsk: (text: string) => void;
  /** Something changed in the org (an approval decided): read again. */
  onRefresh: () => void;
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const money = (n: number) => `$${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString()}`;
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const usdOf = (r: Pick<UsageRow, 'tokensIn' | 'tokensOut'>) => (r.tokensIn / 1e6) * USD_PER_M_IN + (r.tokensOut / 1e6) * USD_PER_M_OUT;

function Wait({ text }: { text: string }) {
  return <div className="ax-empty"><Loader2 className="spin" /> {text}</div>;
}

// ── today as a dashboard ───────────────────────────────────────────────
export function DashboardSurface({ data, loading, now, onGo }: SurfaceProps) {
  const totals = useMemo(() => todayTotals(data?.stats ?? null), [data]);
  const hours = useMemo(() => runsByHour(data?.runs ?? [], now), [data, now]);
  const events = useMemo(() => (data ? todayEvents(data, now) : []), [data, now]);
  const health = useMemo(() => agentHealth(data?.stats ?? null, data?.runs ?? [], now), [data, now]);
  const pending = (data?.approvals.length ?? 0) + (data?.chatApprovals.length ?? 0);
  if (loading && !data) return <Wait text="Reading today…" />;
  const sampled = hours.reduce((a, [o, b]) => a + o + b, 0);
  const max = Math.max(1, ...hours.map(([ok, bad]) => ok + bad));
  const W = 560;
  const bw = 18;
  const conversationsToday = (data?.sessions ?? []).filter(s => s.lastActivityAt && new Date(s.lastActivityAt).toDateString() === now.toDateString()).length;
  return (
    <div className="ax-scroll">
      <div className="ax-dtiles">
        <div className="ax-dt in"><div className="k">Runs today</div><div className="v">{totals.runs.toLocaleString()}</div><div className={`s${totals.runsFailed ? ' err' : ''}`}>{totals.runsFailed ? `${totals.runsFailed} failed` : 'no failures'}</div></div>
        <div className="ax-dt in"><div className="k">Chat turns</div><div className="v">{totals.turns.toLocaleString()}</div><div className={`s${totals.turnsFailed ? ' err' : ''}`}>{totals.turnsFailed ? `${totals.turnsFailed} failed · ` : ''}{conversationsToday} conversation{conversationsToday === 1 ? '' : 's'} today</div></div>
        <div className="ax-dt in"><div className="k">Approvals waiting</div><div className="v">{pending}</div><div className={`s${pending ? ' wn' : ''}`}>{pending ? 'waiting on you' : 'nothing waiting'}</div></div>
        <div className="ax-dt in"><div className="k">Spend today</div><div className="v">{money(totals.spendUsd)}</div><div className="s">estimate from tokens</div></div>
      </div>
      <div className="ax-dgrid">
        <div className="ax-dcard in">
          <div className="hd">Runs by hour <span className="m">{sampled ? `failures in red · ${sampled} sampled` : 'automation only'}</span></div>
          {sampled === 0 ? (
            <div className="ax-empty">No automation runs today. Today's activity is chat: {totals.turns.toLocaleString()} turn{totals.turns === 1 ? '' : 's'} across {conversationsToday} conversation{conversationsToday === 1 ? '' : 's'}.</div>
          ) : (
            <div className="ax-chart">
              <svg viewBox={`0 0 ${W} 150`} role="img" aria-label="Runs by hour today">
                <line className="gl" x1="14" y1="118" x2={W - 6} y2="118" />
                <line className="gl" x1="14" y1="68" x2={W - 6} y2="68" strokeDasharray="3 4" />
                {hours.map(([ok, bad], i) => {
                  const x = 14 + i * 22.5;
                  const hOk = (ok / max) * 100;
                  const hBad = (bad / max) * 100;
                  return (
                    <g key={i}>
                      {ok > 0 && <rect className="bar" x={x} y={118 - hOk} width={bw} height={hOk} rx="2" />}
                      {bad > 0 && <rect className="bar er" x={x} y={118 - hOk - hBad} width={bw} height={hBad} rx="2" />}
                    </g>
                  );
                })}
                {[0, 6, 12, 18, 23].map(h => <text key={h} className="ax" x={14 + h * 22.5 + bw / 2} y="134" textAnchor="middle">{String(h).padStart(2, '0')}:00</text>)}
                <text className="ax" x={W - 6} y="64" textAnchor="end">{Math.round(max / 2)}</text>
                <text className="ax" x={W - 6} y="16" textAnchor="end">{max}</text>
              </svg>
            </div>
          )}
        </div>
        <div className="ax-dcard in">
          <div className="hd">What happened <span className="m">latest first</span></div>
          {events.length === 0 ? <div className="ax-empty">Nothing yet today.</div> : (
            <ul className="ax-ev">
              {events.slice(0, 8).map((e, i) => (
                <li key={i}><span className="t">{timeOf(e.at)}</span><span className={`d ${e.tone}`} /><span>{e.text}{e.sub && <small>{e.sub}</small>}</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="ax-dcard in">
        <div className="hd">Agent health <span className="m">today · runs and turns · success · mean run time</span><button type="button" className="ax-link" onClick={() => onGo('/executions')}>Runs <ExternalLink /></button></div>
        {health.length === 0 ? <div className="ax-empty">No activity today.</div> : health.slice(0, 8).map(r => (
          <div className="ax-hbar" key={r.apiName}>
            <span>{r.name}</span>
            <span className="tr"><i style={{ width: `${r.okPct ?? 0}%`, background: r.okPct != null && r.okPct < 95 ? 'var(--archon-warning)' : undefined }} /></span>
            <span className="n">{r.total} · {r.okPct != null ? `${r.okPct}%` : '—'}{r.avgMs != null ? ` · ${(r.avgMs / 1000).toFixed(1)}s` : ''}</span>
          </div>
        ))}
      </div>
      {data?.errors.length ? <div className="ax-empty">Some numbers are missing — {data.errors.join(' · ')}</div> : null}
    </div>
  );
}

// ── the usage report: who used what over a period ─────────────────────
export function UsageSurface({ report, onGo }: SurfaceProps) {
  if (!report) return <Wait text="Reading usage…" />;
  const rows = report.rows;
  const maxTok = Math.max(1, ...rows.map(r => r.tokensIn + r.tokensOut));
  const totalIn = rows.reduce((a, r) => a + r.tokensIn, 0);
  const totalOut = rows.reduce((a, r) => a + r.tokensOut, 0);
  const turnsKnown = rows.length > 0 && rows.every(r => r.turns != null);
  const totalTurns = turnsKnown ? rows.reduce((a, r) => a + (r.turns ?? 0), 0) : null;
  const spend = rows.reduce((a, r) => a + usdOf(r), 0);
  const period = `last ${report.days} day${report.days === 1 ? '' : 's'}`;
  return (
    <div className="ax-scroll">
      <div className="ax-dtiles">
        <div className="ax-dt in"><div className="k">Agents used</div><div className="v">{rows.length}</div><div className="s">{period}</div></div>
        <div className="ax-dt in"><div className="k">Turns</div><div className="v">{totalTurns != null ? totalTurns.toLocaleString() : '—'}</div><div className="s">{totalTurns != null ? 'chat turns answered' : 'not in the org aggregate for this period'}</div></div>
        <div className="ax-dt in"><div className="k">Tokens</div><div className="v">{tokens(totalIn + totalOut)}</div><div className="s">{tokens(totalIn)} in · {tokens(totalOut)} out</div></div>
        <div className="ax-dt in"><div className="k">Spend</div><div className="v">{money(spend)}</div><div className="s">estimate from tokens at blended rates</div></div>
      </div>
      <div className="ax-dcard in">
        <div className="hd">Usage by agent <span className="m">{period} · {report.source === 'archon' ? 'the figures Archon reported' : 'read from the org'}</span><button type="button" className="ax-link" onClick={() => onGo('/cost')}>Cost <ExternalLink /></button></div>
        {rows.length === 0 ? <div className="ax-empty">No usage in this period.</div> : (
          <div className="ax-tablewrap"><table className="ax-table">
            <thead><tr><th>Agent</th><th>Turns</th><th>Tokens in</th><th>Tokens out</th><th>Spend</th><th>Share</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.apiName}>
                  <td>{r.name}<span className="sub">{r.apiName}</span></td>
                  <td className="mono">{r.turns != null ? r.turns.toLocaleString() : '—'}</td>
                  <td className="mono">{r.tokensIn.toLocaleString()}</td>
                  <td className="mono">{r.tokensOut.toLocaleString()}</td>
                  <td className="mono">{money(usdOf(r))}</td>
                  <td style={{ minWidth: 140 }}><span className="tr ax-share"><i style={{ width: `${Math.max(2, ((r.tokensIn + r.tokensOut) / maxTok) * 100)}%` }} /></span></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

// ── what failed today ──────────────────────────────────────────────────
export function FailuresSurface({ data, loading, now, reported, onGo, onAsk }: SurfaceProps) {
  const runs = reported?.runs ?? data?.runs ?? [];
  const failed = useMemo(() => failedRunsToday(runs, now), [runs, now]);
  const turnsFailed = todayTotals(data?.stats ?? null).turnsFailed;
  if (loading && !data && !reported?.runs) return <Wait text="Reading today's runs…" />;
  return (
    <div className="ax-scroll">
      <div className="ax-dcard in">
        <div className="hd">Failed runs today <span className="m">{reported?.runs ? 'the runs Archon reported' : `${failed.length} of the last ${runs.length} runs read`}</span><button type="button" className="ax-link" onClick={() => onGo('/executions')}>All runs <ExternalLink /></button></div>
        {failed.length === 0 ? <div className="ax-empty">No run failed today.</div> : (
          <div className="ax-tablewrap"><table className="ax-table">
            <thead><tr><th>Time</th><th>Agent</th><th>Status</th><th>What the agent said</th><th></th></tr></thead>
            <tbody>
              {failed.map(r => (
                <tr key={r.Id}>
                  <td className="mono">{timeOf(r.CreatedDate)}</td>
                  <td>{r['AgentDefinition__r.Name']}<span className="sub">{r.RecordId__c ?? r.Name}</span></td>
                  <td><span className="ax-st er">{r.Status__c}</span></td>
                  <td>{(r.AgentReason__c ?? '').slice(0, 160) || '—'}</td>
                  <td><button type="button" className="ax-btn sm" onClick={() => onAsk(`Why did ${r['AgentDefinition__r.Name']} fail at ${timeOf(r.CreatedDate)} (run ${r.Name})? Look at the run and tell me what to fix.`)}>Ask why</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
      {turnsFailed > 0 && <div className="ax-dcard in"><div className="hd">Chat turns</div><div className="ax-empty">{turnsFailed} chat turn{turnsFailed === 1 ? '' : 's'} failed today — open Conversations to read them.</div><div className="ax-foot"><button type="button" className="ax-btn sm" onClick={() => onGo('/conversations')}>Conversations <ExternalLink /></button></div></div>}
    </div>
  );
}

// ── drafts ─────────────────────────────────────────────────────────────
export function DraftsSurface({ data, loading, reported, onGo, onAsk }: SurfaceProps) {
  const drafts = (reported?.agents ?? data?.agents ?? []).filter(a => a.status === 'Draft').sort((a, b) => b.lastModifiedDate.localeCompare(a.lastModifiedDate));
  if (loading && !data && !reported?.agents) return <Wait text="Reading your agents…" />;
  return (
    <div className="ax-scroll">
      <div className="ax-dcard in">
        <div className="hd">Drafts <span className="m">{drafts.length} not yet active{reported?.agents ? ' · as Archon reported' : ''}</span><button type="button" className="ax-link" onClick={() => onGo('/')}>All agents <ExternalLink /></button></div>
        {drafts.length === 0 ? <div className="ax-empty">Every agent is active.</div> : (
          <div className="ax-tablewrap"><table className="ax-table">
            <thead><tr><th>Agent</th><th>Type</th><th>Department</th><th>Last change</th><th></th></tr></thead>
            <tbody>
              {drafts.map(a => (
                <tr key={a.id}>
                  <td>{a.name}<span className="sub">{a.apiName}</span></td>
                  <td><AgentKindBadge executeType={a.executeType} /></td>
                  <td>{a.department}</td>
                  <td className="mono">{new Date(a.lastModifiedDate).toLocaleDateString([], { day: 'numeric', month: 'short' })}</td>
                  <td>
                    <button type="button" className="ax-btn sm" onClick={() => onAsk(`Open the draft agent ${a.name} (${a.apiName}) and tell me what is still outstanding before it can go live.`)}>Ask Archon</button>
                    <button type="button" className="ax-btn sm" onClick={() => onGo(`/agent/${encodeURIComponent(a.apiName)}`)}>Open in builder <ExternalLink /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

// ── approvals ──────────────────────────────────────────────────────────
export function ApprovalsSurface({ data, loading, reported, onGo, onRefresh }: SurfaceProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, 'approved' | 'rejected' | 'failed'>>({});
  const runs = reported?.approvals ?? data?.approvals ?? [];
  const chats = reported?.chatApprovals ?? data?.chatApprovals ?? [];
  const decideRun = async (id: string, decision: 'approved' | 'rejected') => {
    setBusy(id);
    try { await decideApproval(id, decision); setDone(d => ({ ...d, [id]: decision })); onRefresh(); }
    catch { setDone(d => ({ ...d, [id]: 'failed' })); }
    finally { setBusy(null); }
  };
  const decideChat = async (id: string, decision: 'approved' | 'rejected') => {
    setBusy(id);
    try { const r = await decideChatApproval(id, decision); setDone(d => ({ ...d, [id]: r.error ? 'failed' : decision })); onRefresh(); }
    catch { setDone(d => ({ ...d, [id]: 'failed' })); }
    finally { setBusy(null); }
  };
  if (loading && !data && !reported) return <Wait text="Reading what is waiting…" />;
  const total = runs.length + chats.length;
  const Acts = ({ id, onDecide }: { id: string; onDecide: (d: 'approved' | 'rejected') => void }) => (
    done[id] ? <span className={`ax-st ${done[id] === 'approved' ? 'ok' : done[id] === 'rejected' ? 'er' : 'wn'}`}>{done[id] === 'failed' ? 'Could not decide' : done[id] === 'approved' ? 'Approved' : 'Rejected'}</span> : (
      <div className="acts">
        <button type="button" className="ax-btn sm p" disabled={busy === id} onClick={() => onDecide('approved')}>{busy === id ? <Loader2 className="spin" /> : null} Approve</button>
        <button type="button" className="ax-btn sm" disabled={busy === id} onClick={() => onDecide('rejected')}>Reject</button>
      </div>
    )
  );
  return (
    <div className="ax-scroll">
      <div className="ax-dcard in">
        <div className="hd">Waiting on you <span className="m">{total ? `${total} · oldest first` : 'nothing'}</span><button type="button" className="ax-link" onClick={() => onGo('/approvals')}>Approvals <ExternalLink /></button></div>
        {total === 0 && <div className="ax-empty">Nothing is waiting for a decision.</div>}
        {runs.map(a => (
          <div className="ax-apv" key={a.id}>
            <div><b>{a.agentApiName} wants to run “{a.nodeLabel}”</b><small>{a.recordId ? `on ${a.recordId} · ` : ''}requested {timeOf(a.createdDate)}{a.timeoutAt ? ` · expires ${timeOf(a.timeoutAt)}` : ''}</small></div>
            <Acts id={a.id} onDecide={d => decideRun(a.id, d)} />
          </div>
        ))}
        {chats.map(a => (
          <div className="ax-apv" key={a.id}>
            <div><b>{a.agentApiName} wants to call {a.toolName}</b><small>{summariseArgs(a.argsJson)} · requested {timeOf(a.createdAt)}</small></div>
            <Acts id={a.id} onDecide={d => decideChat(a.id, d)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function summariseArgs(args: unknown): string {
  try {
    const o = typeof args === 'string' ? JSON.parse(args) : args;
    if (!o || typeof o !== 'object') return '';
    return Object.entries(o as Record<string, unknown>).slice(0, 3).map(([k, v]) => `${k}: ${String(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, 40)}`).join(' · ');
  } catch { return ''; }
}

// ── a chart made for the question: spend per agent ─────────────────────
export function ChartSurface({ data, loading, report, onGo }: SurfaceProps) {
  const rows = useMemo(
    () => (report ? report.rows.map(r => ({ name: r.name, usd: usdOf(r) })).filter(r => r.usd > 0).sort((a, b) => b.usd - a.usd) : costByAgent(data?.stats ?? null)),
    [report, data],
  );
  if (loading && !data && !report) return <Wait text="Reading spend…" />;
  const max = rows[0]?.usd ?? 1;
  const total = rows.reduce((a, r) => a + r.usd, 0);
  const period = report ? `last ${report.days} day${report.days === 1 ? '' : 's'}` : 'today';
  return (
    <div className="ax-scroll">
      <div className="ax-dcard in">
        <div className="hd">Cost by agent <span className="m">{period} · {money(total)} · estimate from tokens at blended rates</span><button type="button" className="ax-link" onClick={() => onGo('/cost')}>Cost <ExternalLink /></button></div>
        {rows.length === 0 ? <div className="ax-empty">No spend recorded in this period.</div> : rows.slice(0, 10).map(r => (
          <div className="ax-hbar" key={r.name}><span>{r.name}</span><span className="tr"><i style={{ width: `${Math.max(2, (r.usd / max) * 100)}%` }} /></span><span className="n">{money(r.usd)}</span></div>
        ))}
      </div>
    </div>
  );
}
