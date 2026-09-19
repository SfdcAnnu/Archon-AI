import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHref, useNavigate } from 'react-router';
import { ChevronDown, Layers, Loader2, Mic, Plus, RefreshCw, Send } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ConsoleRail } from '@/components/chat/ConsoleRail';
import type { VoicePhase } from '@/components/chat/VoiceStrip';
import { CoreRing, type CorePhase } from '@/components/home/CoreRing';
import type { ChatActivity } from '@/lib/chat-activity';
import { getVoicePref, setVoicePref } from '@/lib/voice';
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

const PHASE_COPY: Record<CorePhase, string> = { off: 'standby', ready: 'Ready', listen: 'Listening…', think: 'Working on it', speak: 'Answering', build: 'Building' };
const STATUS_COPY: Record<CorePhase, string> = {
  off: 'Waking up…',
  ready: 'Ready — type or talk, the answer comes back the same way.',
  listen: 'Listening — it sends when you pause.',
  think: 'Working on it…',
  speak: 'Speaking — talk or type to interrupt.',
  build: 'Building…',
};
const FOCUS_MS = 1600;
const SUGGESTIONS = ['What failed today, and why?', 'Which agents need attention?', 'How much did we save this month?', 'Create an agent for lead qualification'];
const COPILOT = { apiName: 'archon_copilot', name: 'Archon' } as const;

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
  const [focus, setFocus] = useState<{ message: { text: string; how: 'talk' | 'type' } | null } | null>(null);
  const [copilotAgent, setCopilotAgent] = useState<{ apiName: string; name: string }>(COPILOT);
  const [events, setEvents] = useState<ChatActivity[]>([]);
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const traceHref = useHref(`/trace/${liveSessionId ?? ''}`);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [openSeq, setOpenSeq] = useState(0);
  const homeRef = useRef<HTMLDivElement>(null);
  const chatPhase = useMemo<VoicePhase>(() => { let p: VoicePhase = 'ready'; for (const e of events) if (e.kind === 'phase') p = e.phase; return p; }, [events]);
  const phase: CorePhase = stage !== 'live' ? 'off' : focus ? chatPhase : 'ready';
  const exitFocus = useCallback(() => { setFocus(null); setCountdown(null); setLeaving(true); setCopilotAgent(COPILOT); }, []);
  const handleTransfer = useCallback((t: { agentApiName: string; agentName: string; message: string }) => {
    setCopilotAgent({ apiName: t.agentApiName, name: t.agentName }); setCountdown(null); setOpenSeq(n => n + 1); setFocus({ message: { text: t.message, how: 'type' } });
  }, []);
  useEffect(() => { if (!leaving) return; const t = setTimeout(() => setLeaving(false), FOCUS_MS); return () => clearTimeout(t); }, [leaving]);
  const openFocus = (message: { text: string; how: 'talk' | 'type' } | null) => {
    setCountdown(null); setLeaving(false); setOpenSeq(n => n + 1); setFocus({ message });
    homeRef.current?.parentElement?.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const overlayMounted = !!focus || leaving;
  useEffect(() => { document.body.classList.toggle('home-lock', !!focus); return () => document.body.classList.remove('home-lock'); }, [focus]);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && focus) exitFocus(); if (e.key === 'Escape') setMoreOpen(false); }; addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey); }, [focus, exitFocus]);
  useEffect(() => {
    if (!focus) return;
    const last = events[events.length - 1];
    if (!last) return;
    if (last.kind === 'reply' && !/\?\s*$/.test(last.text.trim()) && !getVoicePref()) setCountdown(15); else setCountdown(null);
  }, [events, focus]);
  useEffect(() => { if (countdown == null) return; if (countdown <= 0) { exitFocus(); return; } const t = setTimeout(() => setCountdown(c => (c == null ? null : c - 1)), 1000); return () => clearTimeout(t); }, [countdown, exitFocus]);
  const handleActivity = useCallback((e: ChatActivity) => { setEvents(list => (list.length >= 200 ? [...list.slice(-199), e] : [...list, e])); }, []);
  const handleSessionChange = useCallback((info: { sessionId: string | null; ended: boolean }) => { if (info.ended) { setEvents([]); setLiveSessionId(null); exitFocus(); load(); } else if (info.sessionId) setLiveSessionId(info.sessionId); }, [load, exitFocus]);
  const submit = () => { const text = input.trim(); if (!text) return; setInput(''); openFocus({ text, how: 'type' }); };
  const talk = () => { setVoicePref(true); openFocus(null); };

  const today = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  const savedDelta = delta(saved, savedBefore);
  const totalDelta = delta(total, totalBefore);

  return (
    <AppShell hideRail>
      <div ref={homeRef} className={`home cc ${stage}`} data-focus={focus ? '1' : '0'} data-overlay={overlayMounted ? '1' : '0'}>
        {/* ── top bar ───────────────────────────────────────────────── */}
        <header className="cc-top">
          <div className="cc-brand"><span className="cc-logo"><Layers /></span>Archon</div>
          <nav className="cc-nav">
            {NAV.map(n => (
              <button key={n.key} type="button" className={n.key === 'command' ? 'on' : ''} onClick={() => navigate(n.href)}>
                {n.label}{n.key === 'review' && pendingCount > 0 && <span className="cc-badge">{pendingCount}</span>}
              </button>
            ))}
            <MoreMenu open={moreOpen} setOpen={setMoreOpen} pending={pendingCount} onGo={navigate} />
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

          {/* ── voice agent + attention ──────────────────────────────── */}
          <div className="cc-row">
            <section className="cc-voice">
              <div className="cc-vh">
                <span className="cc-vt">Archon voice agent</span>
                <span className={`cc-pill ${pendingCount ? 'a' : 'g'}`}><i />{pendingCount ? 'Waiting for your OK' : PHASE_COPY[phase]}</span>
                {pendingCount > 0 ? <button type="button" className="cc-open" onClick={() => navigate('/approvals')}>Open current task</button> : <button type="button" className="cc-open quiet" onClick={() => navigate('/chat')}>Open Agent Chat</button>}
              </div>
              <div className="cc-vb">
                <div className="cc-try">
                  <div className="cc-label">Try saying</div>
                  {SUGGESTIONS.map(s => <button key={s} type="button" className="cc-say" onClick={() => openFocus({ text: s, how: 'type' })}>“{s}”</button>)}
                </div>
                <div className="cc-core">
                  <div className="cc-core-scale"><CoreRing phase={phase} label="ARCHON" sub={pendingCount ? 'Waiting for your OK' : PHASE_COPY[phase]} burst={0} /></div>
                  <div className="cc-inrow">
                    <button type="button" className="home-mic cc-mic" onClick={talk} aria-label="Talk to Archon" title="Talk"><Mic /></button>
                    <input id="home-ask-input" className="home-in" type="text" placeholder="Or type a request" autoComplete="off" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
                    <button type="button" className="cc-send" onClick={submit} disabled={!input.trim()} aria-label="Send"><Send /></button>
                  </div>
                  <div className="cc-status" data-phase={phase}>{pendingCount ? 'A task is waiting for your OK.' : STATUS_COPY[phase]}</div>
                </div>
                <div className="cc-done">
                  <div className="cc-dh"><span>Done by Archon today</span><span className="n">{data ? `${doneToday.length} ${doneToday.length === 1 ? 'task' : 'tasks'}` : ''}</span></div>
                  <div className="cc-dl">
                    {loading && !data && <div className="cc-empty"><Loader2 className="spin" /> Loading…</div>}
                    {data && doneToday.length === 0 && <div className="cc-empty">Nothing yet today.</div>}
                    {doneToday.slice(0, 6).map((it, i) => <div key={i} className="cc-di"><i className={it.ok ? 'ok' : 'bad'}>{it.ok ? '✓' : '!'}</i><span>{it.text}</span><small>{timeOf(it.at)}</small></div>)}
                  </div>
                  <button type="button" className="link cc-log" onClick={() => navigate('/executions')}>Open Activity Log</button>
                </div>
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
        </div>

        {/* ── focus: the chat fades in over the dashboard ─────────── */}
        {overlayMounted && (
          <div className="home-focus" onPointerDown={() => setCountdown(null)}>
            <ConsoleRail events={events} agentName={copilotAgent.name} traceHref={liveSessionId ? traceHref : null} />
            <div className="home-focus-chat">
              <ChatPanel
                key={`${copilotAgent.apiName}-${openSeq}`}
                variant="full"
                headerNote={countdown != null ? `Answered — back to the dashboard in ${countdown}s. Say or type anything to stay.` : null}
                agentApiName={copilotAgent.apiName}
                agentName={copilotAgent.name}
                initialMessage={focus?.message ?? null}
                onClose={exitFocus}
                onSessionChange={handleSessionChange}
                onActivity={handleActivity}
                onTransfer={handleTransfer}
              />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
