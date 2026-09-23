import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { ChevronDown, Layers, Loader2, Mic, Plus, RefreshCw, Send, Zap } from 'lucide-react';
import { AppShell, NAV_ICON_BY_HREF } from '@/components/shell/AppShell';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { COPILOT } from '@/lib/copilot';
import { resolveStreaming, setStreamOverride, STREAM_LABEL } from '@/lib/stream-pref';
import type { VoicePhase } from '@/components/chat/VoiceStrip';
import type { CorePhase } from '@/components/home/CoreRing';
import type { ChatActivity } from '@/lib/chat-activity';
import { setVoicePref } from '@/lib/voice';
import { loadAgents, type AgentSummary } from '@/lib/agents-data';
import { listMySessions, type SessionSummary } from '@/lib/conversations-data';
import { loadPendingApprovals, type ApprovalDto } from '@/lib/approvals-data';
import { listChatApprovals, type ChatApproval } from '@/lib/chat-approvals-data';
import { loadHomeStats, type HomeStats } from '@/lib/home-stats-data';
import { loadExecutionLogs, type RawAgentExecution } from '@/lib/executions-data';
import { loadConnectorDirectory, type DirectoryEntry } from '@/lib/connectors-data';
import '@/styles/home.css';

/**
 * Home — the command center. Four numbers across the top (what the agents
 * saved, handled, how many are live, how often they succeed), Archon's
 * voice agent in the middle with what it did today beside it, and what
 * needs a person on the right. Sending a message fades the dashboard out
 * and the chat in over it; a plain answer fades it back.
 *
 * Every number comes from the org: activity runs and chat turns from one
 * aggregate request, approvals, agents, recent runs and sessions, the
 * connector directory. The one derived figure — cost saved — is an
 * estimate built from those counts, and says so on the tile.
 */

type Range = 1 | 7 | 30;
const RANGE_LABEL: Record<Range, string> = { 1: 'Today', 7: 'Last 7 days', 30: 'Last 30 days' };
/** The savings estimate: minutes of a person's time each handled task
 *  would have taken, an hourly rate for that time, and blended token
 *  prices for the AI spend. Shown on the tile as an estimate. */
const MINUTES_PER_TASK = 9;
const HOURLY_RATE_USD = 35;
const USD_PER_M_IN = 2.5;
const USD_PER_M_OUT = 10;

interface HomeData {
  stats: HomeStats | null;
  statsError: string | null;
  sessions: SessionSummary[] | null;
  approvals: ApprovalDto[] | null;
  chatApprovals: ChatApproval[] | null;
  agents: AgentSummary[] | null;
  agentsError: string | null;
  runs: RawAgentExecution[] | null;
  loadedAt: number;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const fmtN = (n: number): string => n.toLocaleString();
const fmtMoney = (n: number): string => `$${Math.round(n).toLocaleString()}`;
function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short' });
}
function delta(now: number, before: number): { text: string; tone: 'up' | 'down' | 'flat' } | null {
  if (!before) return null;
  const p = Math.round(((now - before) / before) * 100);
  return { text: `${p > 0 ? '+' : ''}${p}%`, tone: p > 0 ? 'up' : p < 0 ? 'down' : 'flat' };
}
function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const isToday = (iso: string | null) => !!iso && new Date(iso).toDateString() === new Date().toDateString();

const PHASE_COPY: Record<CorePhase, string> = { off: 'Standby', ready: 'Ready · voice on', listen: 'Listening…', think: 'Working on it', speak: 'Answering', build: 'Building the agent' };

const NAV: Array<{ label: string; href: string; key: 'command' | 'chat' | 'fleet' | 'inbox' | 'review' | 'log' }> = [
  { label: 'Command Center', href: '/home', key: 'command' },
  { label: 'Agent Chat', href: '/chat', key: 'chat' },
  { label: 'Agent Fleet', href: '/', key: 'fleet' },
  { label: 'Customer Inbox', href: '/conversations', key: 'inbox' },
  { label: 'Review Queue', href: '/approvals', key: 'review' },
  { label: 'Activity Log', href: '/executions', key: 'log' },
];
const MORE: Array<{ label: string; href: string }> = [
  { label: 'Knowledge', href: '/knowledge' }, { label: 'Connectors', href: '/connectors' }, { label: 'Templates', href: '/templates' },
  { label: 'AI Models', href: '/ai-connections' }, { label: 'Cost', href: '/cost' }, { label: 'Setup', href: '/setup' },
];

function MoreMenu({ open, setOpen, pending, onGo, label = 'More' }: { open: boolean; setOpen: (f: (o: boolean) => boolean) => void; pending: number; onGo: (href: string) => void; label?: string }) {
  return (
    <div className="cc-more">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}>{label} <ChevronDown /></button>
      {open && (
        <>
          <div className="cc-more-scrim" onClick={() => setOpen(() => false)} />
          <div className="cc-more-menu">
            {NAV.map(n => <button key={n.key} type="button" className="nav-only" onClick={() => { setOpen(() => false); onGo(n.href); }}>{n.label}{n.key === 'review' && pending > 0 && <span className="cc-badge">{pending}</span>}</button>)}
            {MORE.map(m => <button key={m.href} type="button" onClick={() => { setOpen(() => false); onGo(m.href); }}>{m.label}</button>)}
          </div>
        </>
      )}
    </div>
  );
}

export default function HomeDashboardPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>(7);
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectors, setConnectors] = useState<DirectoryEntry[] | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    // Twice the window, so the previous period gives the "vs last" delta.
    Promise.allSettled([
      loadHomeStats(range * 2),
      listMySessions(50),
      loadPendingApprovals(),
      listChatApprovals({ status: 'Pending' }),
      loadAgents(),
      loadExecutionLogs({ pageSize: 25, pageOffset: 0 }),
    ]).then(([statsR, sessR, apprR, chatR, agentsR, runsR]) => {
      setData({
        stats: statsR.status === 'fulfilled' ? statsR.value : null,
        statsError: statsR.status === 'rejected' ? errMsg(statsR.reason) : null,
        sessions: sessR.status === 'fulfilled' ? sessR.value : null,
        approvals: apprR.status === 'fulfilled' ? apprR.value : null,
        chatApprovals: chatR.status === 'fulfilled' ? chatR.value : null,
        agents: agentsR.status === 'fulfilled' ? agentsR.value : null,
        agentsError: agentsR.status === 'rejected' ? errMsg(agentsR.reason) : null,
        runs: runsR.status === 'fulfilled' ? runsR.value.records : null,
        loadedAt: Date.now(),
      });
      setLoading(false);
    });
  }, [range]);
  useEffect(() => { load(); }, [load]);
  // The connector directory is a proxy hop to the server; it fills in on
  // its own so a slow server never holds the numbers back.
  useEffect(() => {
    let cancelled = false;
    loadConnectorDirectory().then(list => { if (!cancelled) setConnectors(list); }).catch(() => { if (!cancelled) setConnectors([]); });
    return () => { cancelled = true; };
  }, []);

  // ── Derivations ──────────────────────────────────────────────────────
  const stats = data?.stats ?? null;
  const period = useMemo(() => {
    const all = (stats?.byDay ?? []).map(d => ({ key: d.day, label: dayLabel(d.day), runs: d.runsOk + d.runsFailed + d.runsOther, turns: d.turnsOk + d.turnsFailed, ok: d.runsOk + d.turnsOk, fail: d.runsFailed + d.turnsFailed }));
    const cur = all.slice(-range);
    const prev = all.slice(Math.max(0, all.length - range * 2), all.length - range);
    const sum = (rows: typeof all) => rows.reduce((a, d) => ({ runs: a.runs + d.runs, turns: a.turns + d.turns, ok: a.ok + d.ok, fail: a.fail + d.fail }), { runs: 0, turns: 0, ok: 0, fail: 0 });
    return { days: cur, now: sum(cur), before: sum(prev) };
  }, [stats, range]);
  const total = period.now.runs + period.now.turns;
  const totalBefore = period.before.runs + period.before.turns;
  // Tokens are reported for the whole (doubled) window; halve for the period.
  const tokensIn = stats ? stats.tokensIn / 2 : 0;
  const tokensOut = stats ? stats.tokensOut / 2 : 0;
  const spend = (tokensIn / 1e6) * USD_PER_M_IN + (tokensOut / 1e6) * USD_PER_M_OUT;
  const hours = (total * MINUTES_PER_TASK) / 60;
  const hoursBefore = (totalBefore * MINUTES_PER_TASK) / 60;
  const saved = Math.max(0, hours * HOURLY_RATE_USD - spend);
  const savedBefore = Math.max(0, hoursBefore * HOURLY_RATE_USD - spend);
  const ret = spend > 0 ? (hours * HOURLY_RATE_USD) / spend : null;
  const okShare = period.now.ok + period.now.fail ? Math.round((period.now.ok / (period.now.ok + period.now.fail)) * 100) : null;
  const successPct = period.now.ok + period.now.fail ? ((period.now.ok / (period.now.ok + period.now.fail)) * 100).toFixed(1) : null;
  const dayMax = Math.max(1, ...period.days.map(d => d.ok + d.fail));

  const agents = data?.agents ?? [];
  const active = agents.filter(a => a.status === 'Active');
  /** Every agent with what it did today, live first, busiest first — the fleet
   *  at a glance, from the same aggregate the tiles use. */
  const agentRows = useMemo(() => {
    const by = new Map((stats?.byAgent ?? []).map(x => [x.apiName, x]));
    const rank = (st: string) => (st === 'Active' ? 0 : st === 'Draft' ? 1 : 2);
    return agents
      .map(a => {
        const cnt = by.get(a.apiName);
        const total = cnt ? cnt.runsToday + cnt.turnsToday : 0;
        const fail = cnt ? cnt.runsFailedToday + cnt.turnsFailedToday : 0;
        return { a, total, fail };
      })
      .sort((x, y) => rank(x.a.status) - rank(y.a.status) || y.total - x.total || x.a.name.localeCompare(y.a.name));
  }, [agents, stats]);
  const byDept = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of active) m.set(a.department || 'Other', (m.get(a.department || 'Other') ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [active]);

  const pendingCount = (data?.approvals?.length ?? 0) + (data?.chatApprovals?.length ?? 0);
  const failingAgents = (stats?.byAgent ?? []).map(a => ({ name: a.name, fail: a.runsFailedToday + a.turnsFailedToday, runs: a.runsFailedToday })).filter(a => a.fail > 0).sort((a, b) => b.fail - a.fail);
  const drafts = agents.filter(a => a.status === 'Draft');
  const brokenConnectors = (connectors ?? []).filter(c => c.connectorId && /error|expired|disconnected|revoked/i.test(c.status) );
  const attention = [
    ...(pendingCount ? [{ kind: 'a', title: `${pendingCount} ${pendingCount === 1 ? 'reply' : 'replies'} waiting for approval`, sub: [...(data?.approvals ?? []).map(a => a.nodeLabel), ...(data?.chatApprovals ?? []).map(a => a.toolName)].slice(0, 2).join(' · ') || 'nothing is written until someone signs off', action: 'Review', href: '/approvals' }] : []),
    ...failingAgents.slice(0, 2).map(f => ({ kind: 'r', title: `${f.name} failed ${f.fail} ${f.fail === 1 ? 'run' : 'runs'} today`, sub: 'open the runs to see the error', action: 'View runs', href: f.runs ? '/executions' : '/conversations' })),
    ...brokenConnectors.slice(0, 2).map(c => ({ kind: 'c', title: `${c.displayName} connection needs attention`, sub: c.lastErrorMessage ?? c.status, action: 'Reconnect', href: '/connectors' })),
    ...(drafts.length ? [{ kind: 'b', title: `${drafts.length} ${drafts.length === 1 ? 'agent' : 'agents'} still in Draft`, sub: drafts.slice(0, 3).map(d => d.name).join(' · '), action: 'Open', href: '/' }] : []),
  ];

  const doneToday = useMemo(() => {
    const items: Array<{ at: string; text: string; ok: boolean }> = [];
    for (const r of data?.runs ?? []) if (isToday(r.CreatedDate)) items.push({ at: r.CreatedDate, text: `${r['AgentDefinition__r.Name']} · ${r.AgentReason__c?.slice(0, 60) || r.Status__c}`, ok: !/fail|error/i.test(r.Status__c) });
    for (const s of data?.sessions ?? []) if (isToday(s.lastActivityAt)) items.push({ at: s.lastActivityAt!, text: `${s.agentName}: ${s.title ?? 'conversation'}${s.totalTurns ? ` · ${s.totalTurns} turns` : ''}`, ok: true });
    return items.sort((a, b) => b.at.localeCompare(a.at));
  }, [data]);

  // ── Focus: the chat takes the screen ────────────────────────────────
  const [stage, setStage] = useState<'dark' | 'live'>('dark');
  useEffect(() => { const t = setTimeout(() => setStage('live'), 80); return () => clearTimeout(t); }, []);
  const [focus, setFocus] = useState<{ message: { text: string; how: 'talk' | 'type' } | null; sessionId?: string | null } | null>(null);
  const [copilotAgent, setCopilotAgent] = useState<{ apiName: string; name: string }>(COPILOT);
  const [events, setEvents] = useState<ChatActivity[]>([]);
  const [input, setInput] = useState('');
  const [openSeq, setOpenSeq] = useState(0);
  /** Streaming, settable BEFORE anything is asked. The drawer reads the
   *  same per-agent preference when it opens, so choosing here decides how
   *  the first reply arrives rather than the second. */
  const [streaming, setStreaming] = useState(() => resolveStreaming(COPILOT.apiName, undefined));
  const toggleStreaming = () => {
    setStreaming(prev => {
      const next = !prev;
      setStreamOverride(copilotAgent.apiName, next);
      return next;
    });
  };
  const homeRef = useRef<HTMLDivElement>(null);
  const chatPhase = useMemo<VoicePhase>(() => { let p: VoicePhase = 'ready'; for (const e of events) if (e.kind === 'phase') p = e.phase; return p; }, [events]);
  const phase: CorePhase = stage !== 'live' ? 'off' : focus ? chatPhase : 'ready';
  const exitFocus = useCallback(() => { setFocus(null); setCopilotAgent(COPILOT); }, []);
  // A hand-off changes who the dock is talking to, and streaming is a
  // per-agent choice: show that agent's, not the one we just left.
  useEffect(() => { setStreaming(resolveStreaming(copilotAgent.apiName, undefined)); }, [copilotAgent.apiName]);
  const handleTransfer = useCallback((t: { agentApiName: string; agentName: string; message: string }) => {
    setCopilotAgent({ apiName: t.agentApiName, name: t.agentName }); setOpenSeq(n => n + 1); setFocus({ message: { text: t.message, how: 'type' } });
  }, []);
  /** Open the drawer, optionally with a first message to send. The dashboard
   *  stays exactly where it is: a drawer is beside the work, not over it. */
  const openFocus = (message: { text: string; how: 'talk' | 'type' } | null, sessionId?: string | null) => { setOpenSeq(n => n + 1); setFocus({ message, sessionId }); };
  /** Coming back from the New agent page: reopen the drawer on the same
   *  conversation, so moving between the two surfaces never costs a turn. */
  const returned = (useLocation().state as { sessionId?: string | null } | null)?.sessionId;
  useEffect(() => { if (returned) { setOpenSeq(n => n + 1); setFocus({ message: null, sessionId: returned }); } }, [returned]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMoreOpen(false); if (focus) exitFocus(); }
      // ⌘J / Ctrl+J is the one keystroke that reaches Archon from anywhere on Home.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); if (!focus) openFocus(null); document.getElementById('home-ask-input')?.focus(); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [focus, exitFocus]);
  const handleActivity = useCallback((e: ChatActivity) => { setEvents(list => (list.length >= 200 ? [...list.slice(-199), e] : [...list, e])); }, []);
  const handleSessionChange = useCallback((info: { sessionId: string | null; ended: boolean }) => { if (info.ended) { setEvents([]); exitFocus(); load(); } }, [load, exitFocus]);
  const submit = () => { const text = input.trim(); if (!text) return; setInput(''); openFocus({ text, how: 'type' }); };
  const talk = () => { setVoicePref(true); openFocus(null); };

  const today = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  const savedDelta = delta(saved, savedBefore);
  const totalDelta = delta(total, totalBefore);

  return (
    <AppShell hideRail>
      <div ref={homeRef} className={`home cc ${stage}`}>
        {/* ── top bar ───────────────────────────────────────────────── */}
        <header className="cc-top">
          <div className="cc-brand"><span className="cc-logo"><Layers /></span>Archon</div>
          {/* Every section as the icon the navigation rail draws it with,
              its name as the tooltip: twelve icons fit where six words and
              a More menu did not. */}
          <nav className="cc-nav" aria-label="Sections">
            {[...NAV, ...MORE].map(n => {
              const Icon = NAV_ICON_BY_HREF[n.href];
              const on = n.href === '/home';
              const badge = n.href === '/approvals' && pendingCount > 0;
              return (
                <button key={n.href} type="button" className={on ? 'on' : ''} onClick={() => navigate(n.href)} aria-label={n.label} title={n.label} aria-current={on ? 'page' : undefined}>
                  {Icon ? <Icon /> : n.label}
                  {badge && <span className="cc-badge">{pendingCount}</span>}
                </button>
              );
            })}
          </nav>
          {/* On a narrow screen the sections fold into one menu. */}
          <div className="cc-more cc-menu-btn"><MoreMenu open={moreOpen} setOpen={setMoreOpen} pending={pendingCount} onGo={navigate} label="Menu" /></div>
          <div className="cc-top-r">
            <span className="cc-env"><i /> Production</span>
            <button type="button" className="cc-create" onClick={() => navigate('/new-agent')}><Plus /> Create agent</button>
          </div>
        </header>

        <div className="cc-main">
          {/* ── date row ─────────────────────────────────────────────── */}
          <div className="cc-date">
            <b>{today}</b>
            <span className="cc-upd">{loading && !data ? 'loading…' : data ? `Updated ${ago(data.loadedAt)}` : ''}</span>
            <div className="cc-range">
              {([1, 7, 30] as Range[]).map(r => <button key={r} type="button" className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r === 1 ? 'Today' : `${r} days`}</button>)}
            </div>
            <button type="button" className="cc-refresh" onClick={load} aria-label="Refresh" title="Refresh"><RefreshCw className={loading ? 'spin' : ''} /></button>
          </div>

          {/* ── the four tiles ───────────────────────────────────────── */}
          <div className="cc-tiles">
            <div className="cc-tile">
              <div className="cc-th"><span>Cost saved</span><span className="sub">{RANGE_LABEL[range]}</span></div>
              <div className="cc-big">{stats ? fmtMoney(saved) : '—'}{savedDelta && <span className={`cc-delta ${savedDelta.tone}`}>{savedDelta.text}</span>}<span className="cc-vs">{savedDelta ? `vs previous ${range === 1 ? 'day' : `${range} days`}` : 'estimate'}</span></div>
              <div className="cc-sub3">
                <div><b>{stats ? Math.round(hours) : '—'} <small>h</small></b><span>Work automated</span></div>
                <div><b>{stats ? fmtMoney(spend) : '—'}</b><span>AI spend</span></div>
                <div><b className="g">{ret != null ? `${Math.round(ret)}×` : '—'}</b><span>Return</span></div>
              </div>
              <div className="cc-note" title={`${MINUTES_PER_TASK} minutes of a person's time per handled task at $${HOURLY_RATE_USD}/h, less the AI spend from tokens at blended rates.`}>estimate · {MINUTES_PER_TASK} min per task · ${HOURLY_RATE_USD}/h</div>
            </div>

            <div className="cc-tile">
              <div className="cc-th"><span>Transactions handled</span><span className="sub">{RANGE_LABEL[range]}</span></div>
              <div className="cc-big">{stats ? fmtN(total) : '—'}{totalDelta && <span className={`cc-delta ${totalDelta.tone}`}>{totalDelta.text}</span>}<span className="cc-vs">{okShare != null ? `${okShare}% succeeded` : ''}</span></div>
              <div className="cc-bar">{total > 0 && <><i className="c" style={{ width: `${(period.now.runs / total) * 100}%` }} /><i className="v" style={{ width: `${(period.now.turns / total) * 100}%` }} /></>}</div>
              <div className="cc-sub3">
                <div><b>{stats ? fmtN(period.now.runs) : '—'}</b><span><i className="dot c" />Salesforce runs</span></div>
                <div><b>{stats ? fmtN(period.now.turns) : '—'}</b><span><i className="dot v" />Chat turns</span></div>
                <div><b>{stats ? fmtN(period.now.fail) : '—'}</b><span><i className="dot r" />Failed</span></div>
              </div>
            </div>

            <div className="cc-tile">
              <div className="cc-th"><span>Active agents</span><span className="sub live"><i />Right now</span></div>
              <div className="cc-big">{data?.agents ? active.length : '—'}<span className="cc-vs">of {agents.length} {agents.length === 1 ? 'agent' : 'agents'}</span></div>
              <div className="cc-segs">{agents.map(a => <i key={a.id} className={a.status === 'Active' ? 'on' : a.status === 'Draft' ? 'd' : ''} title={`${a.name} · ${a.status}`} />)}</div>
              <div className="cc-sub3">
                {byDept.length ? byDept.map(([d, n], i) => <div key={d}><b>{n}</b><span><i className={`dot ${['c', 'a', 'v'][i]}`} />{d}</span></div>) : <div><b>{drafts.length}</b><span>in Draft</span></div>}
              </div>
            </div>

            <div className="cc-tile">
              <div className="cc-th"><span>Success and failure</span><span className="sub">{RANGE_LABEL[range]}</span></div>
              <div className="cc-sf">
                <div className="cc-sf-l">
                  <div className="cc-big g">{successPct != null ? `${successPct}%` : '—'}</div>
                  <div className="cc-sf-c"><span>{stats ? fmtN(period.now.ok) : '—'} succeeded</span><span className="r">{stats ? fmtN(period.now.fail) : '—'} failed</span></div>
                </div>
                <div className="cc-days">
                  {period.days.map(d => (
                    <div key={d.key} className="cc-day" title={`${d.label}: ${d.ok} succeeded, ${d.fail} failed`}>
                      <div className="col"><i className="f" style={{ height: `${(d.fail / dayMax) * 100}%` }} /><i className="o" style={{ height: `${(d.ok / dayMax) * 100}%` }} /></div>
                      {range <= 7 && <small>{d.label}</small>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── fleet + attention ────────────────────────────────────── */}
          <div className="cc-row">
            <section className="cc-pane">
              <div className="cc-ah"><span>Agent fleet</span>{agents.length > 0 && <span className="cc-count">{agents.length}</span>}<button type="button" className="link" onClick={() => navigate('/')}>Agents</button></div>
              <div className="cc-fleet">
                {loading && !data && <div className="cc-empty"><Loader2 className="spin" /> Loading…</div>}
                {data?.agentsError && <div className="cc-empty">Couldn't load agents — {data.agentsError}</div>}
                {data?.agents && agents.length === 0 && <div className="cc-empty">No agents yet — ask Archon to build one.</div>}
                {agentRows.map(({ a, total, fail }) => (
                  <button key={a.id} type="button" className="cc-ag" onClick={() => navigate(`/agent/${encodeURIComponent(a.apiName)}`)} title={a.apiName}>
                    <span className="n"><i className={a.status === 'Active' ? '' : a.status === 'Draft' ? 'd' : 'x'} />{a.name}</span>
                    <small>{total > 0 ? `${total} today${fail ? ` · ${fail} failed` : ''}` : a.status === 'Draft' ? 'draft · not activated' : a.status === 'Active' ? 'nothing today' : 'switched off'}</small>
                  </button>
                ))}
              </div>
              <div className="cc-ah cc-ah2"><span>Done by Archon today</span>{doneToday.length > 0 && <span className="cc-count">{doneToday.length}</span>}<button type="button" className="link" onClick={() => navigate('/executions')}>Activity Log</button></div>
              <div className="cc-dl">
                {loading && !data && <div className="cc-empty"><Loader2 className="spin" /> Loading…</div>}
                {data && doneToday.length === 0 && <div className="cc-empty">Nothing yet today.</div>}
                {doneToday.slice(0, 5).map((it, i) => <div key={i} className="cc-di"><i className={it.ok ? 'ok' : 'bad'}>{it.ok ? '✓' : '!'}</i><span>{it.text}</span><small>{timeOf(it.at)}</small></div>)}
              </div>
            </section>

            <aside className="cc-att">
              <div className="cc-ah"><span>Needs attention</span>{attention.length > 0 && <span className="cc-count">{attention.length}</span>}<button type="button" className="link" onClick={() => navigate('/approvals')}>Review Queue</button></div>
              <div className="cc-al">
                {loading && !data && <div className="cc-empty"><Loader2 className="spin" /> Loading…</div>}
                {data && attention.length === 0 && <div className="cc-empty">Nothing needs you right now.</div>}
                {attention.map((a, i) => (
                  <div key={i} className="cc-ai">
                    <span className={`ic ${a.kind}`}>{a.kind === 'a' ? '✓' : a.kind === 'r' ? '!' : a.kind === 'c' ? '⚡' : '✎'}</span>
                    <div className="t"><b>{a.title}</b><small>{a.sub}</small></div>
                    <button type="button" className="cc-act" onClick={() => navigate(a.href)}>{a.action}</button>
                  </div>
                ))}
                {data?.statsError && <div className="cc-empty">Activity unavailable — {data.statsError}</div>}
              </div>
            </aside>
          </div>

          {/* ── the dock: Archon is always here, and never covers the page ── */}
          <div className="dk" data-phase={phase} data-waiting={pendingCount > 0 ? '1' : '0'}>
            <button type="button" className="dk-core" onClick={() => openFocus(null)} aria-label="Open Archon">
              <svg viewBox="0 0 60 60" aria-hidden="true"><circle className="tk" cx="30" cy="30" r="26" /><circle className="ar" cx="30" cy="30" r="29" /><circle className="ar b" cx="30" cy="30" r="22" /></svg>
              <span className="dk-disc"><b>ARCHON</b></span>
            </button>
            <div className="dk-who"><b>Archon</b><span><i />{pendingCount > 0 && phase === 'ready' ? `Waiting for your OK · ${pendingCount} task${pendingCount === 1 ? '' : 's'}` : PHASE_COPY[phase]}</span></div>
            <input
              id="home-ask-input"
              className="dk-in"
              type="text"
              placeholder="Ask Archon anything — or just start talking"
              autoComplete="off"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            />
            <button
              type="button"
              className={`dk-live${streaming ? ' on' : ''}`}
              onClick={toggleStreaming}
              aria-pressed={streaming}
              aria-label={streaming ? STREAM_LABEL.on : STREAM_LABEL.off}
              title={streaming ? STREAM_LABEL.on : STREAM_LABEL.off}
            >
              <Zap /> {streaming ? 'Live' : 'Live off'}
            </button>
            <button type="button" className="dk-b mic" onClick={talk} aria-label="Talk to Archon" title="Talk"><Mic /></button>
            <button type="button" className="dk-b" onClick={submit} disabled={!input.trim()} aria-label="Send"><Send /></button>
            {pendingCount > 0 && (
              <button type="button" className="dk-wait" onClick={() => navigate('/approvals')}>
                <span className="n">{pendingCount}</span><span className="t">waiting for your OK</span><span className="go">Review</span>
              </button>
            )}
            <span className="dk-kbd">⌘J</span>
          </div>
        </div>

        {/* ── the drawer: the same chat, beside the dashboard ─────── */}
        {focus && (
          <>
            <div className="dk-scrim" onClick={exitFocus} />
            <aside className="dk-drawer" aria-label={`${copilotAgent.name} chat`}>
              <ChatPanel
                key={`${copilotAgent.apiName}-${openSeq}`}
                variant="drawer"
                agentApiName={copilotAgent.apiName}
                agentName={copilotAgent.name}
                initialMessage={focus?.message ?? null}
                initialSessionId={focus?.sessionId ?? null}
                onClose={exitFocus}
                onMove={id => navigate('/new-agent', { state: { sessionId: id } })}
                moveLabel="Open as page"
                onSessionChange={handleSessionChange}
                onActivity={handleActivity}
                onTransfer={handleTransfer}
              />
            </aside>
          </>
        )}
      </div>
    </AppShell>
  );
}
