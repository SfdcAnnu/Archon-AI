import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Activity, BookOpen, Bot, CheckSquare, CircleDollarSign, LayoutGrid, Layers, Loader2,
  MessageCircle, MessageSquare, Mic, Plug, Send, Sparkles, Sun, X,
} from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ConsoleRail } from '@/components/chat/ConsoleRail';
import { PhaseRing, type VoicePhase } from '@/components/chat/VoiceStrip';
import { CoreRing, type CorePhase } from '@/components/home/CoreRing';
import { OrbitTabs, type OrbitTab } from '@/components/home/OrbitTabs';
import type { ChatActivity } from '@/lib/chat-activity';
import { getVoicePref, setVoicePref } from '@/lib/voice';
import { introMode } from '@/lib/home-prefs';
import { loadAgents, type AgentSummary } from '@/lib/agents-data';
import { listMySessions, type SessionSummary } from '@/lib/conversations-data';
import { loadPendingApprovals, type ApprovalDto } from '@/lib/approvals-data';
import { listChatApprovals, type ChatApproval } from '@/lib/chat-approvals-data';
import { loadHomeStats, type HomeStats } from '@/lib/home-stats-data';
import '@/styles/home.css';

/**
 * Home — the command center. Archon's core sits in the middle with the
 * app's tabs in orbit around it; the platform's numbers sit either side.
 * The first message you send takes the chat to full screen and the
 * dashboard recedes behind it; a plain answer hands the screen back.
 *
 * The copilot here is always Archon itself — the Architect's assistant,
 * which knows this platform and the org and can build an agent from a
 * requirement, drawing every stage on this same screen. Agents built on
 * the portal are talked to on the Chat page, never here.
 *
 * Activity counts both kinds of work the platform does — automation runs
 * and chat turns — org-wide, from one aggregate request. Every number is
 * live; anything the platform cannot back with real data says so instead
 * of inventing it.
 */

const WINDOW_DAYS = 7;

interface HomeData {
  stats: HomeStats | null;
  statsError: string | null;
  sessions: SessionSummary[] | null;
  approvals: ApprovalDto[] | null;
  chatApprovals: ChatApproval[] | null;
  agents: AgentSummary[] | null;
  agentsError: string | null;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n);
}
function pct(ok: number, total: number): string {
  return total ? `${((ok / total) * 100).toFixed(1)}%` : '—';
}
function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short' });
}

const PHASE_COPY: Record<CorePhase, string> = {
  off: 'standby',
  ready: 'how can I help?',
  listen: 'listening…',
  think: 'working on it',
  speak: 'answering',
  build: 'building',
};
const STATUS_COPY: Record<CorePhase, string> = {
  off: 'Waking up…',
  ready: 'Ready — type or talk, the answer comes back the same way',
  listen: 'Listening — it sends when you pause',
  think: 'Working on it…',
  speak: 'Speaking — talk or type to interrupt',
  build: 'Building…',
};
const SUGGESTIONS = ['What failed today?', 'Which agents need attention?', 'What can my org do with Gmail?', 'Create an agent for lead qualification'];
const WANTS_AGENT = /\b(create|build|make|set up|new)\s+(an?\s+)?agent\b/i;
const COPILOT = { apiName: 'archon_copilot', name: 'Archon' } as const;

export default function HomeDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.allSettled([
      loadHomeStats(WINDOW_DAYS),
      listMySessions(50),
      loadPendingApprovals(),
      listChatApprovals({ status: 'Pending' }),
      loadAgents(),
    ]).then(([statsR, sessR, apprR, chatR, agentsR]) => {
      setData({
        stats: statsR.status === 'fulfilled' ? statsR.value : null,
        statsError: statsR.status === 'rejected' ? errMsg(statsR.reason) : null,
        sessions: sessR.status === 'fulfilled' ? sessR.value : null,
        approvals: apprR.status === 'fulfilled' ? apprR.value : null,
        chatApprovals: chatR.status === 'fulfilled' ? chatR.value : null,
        agents: agentsR.status === 'fulfilled' ? agentsR.value : null,
        agentsError: agentsR.status === 'rejected' ? errMsg(agentsR.reason) : null,
      });
      setLoading(false);
    });
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // ── Derivations, all from what was actually fetched ─────────────────
  const stats = data?.stats ?? null;
  const week = useMemo(() => {
    const days = (stats?.byDay ?? []).map(d => ({
      key: d.day,
      label: dayLabel(d.day),
      ok: d.runsOk + d.turnsOk,
      fail: d.runsFailed + d.turnsFailed,
      other: d.runsOther,
    }));
    return { days, ok: days.reduce((s, d) => s + d.ok, 0), fail: days.reduce((s, d) => s + d.fail, 0) };
  }, [stats]);
  const today = week.days[week.days.length - 1] ?? null;
  const todayTotal = today ? today.ok + today.fail + today.other : 0;

  const sessions = data?.sessions ?? [];
  const activeSessions = sessions.filter(s => s.status === 'Active');
  // Reply time is only tracked on chat turns, and only your sessions carry
  // the rollup we can read here — say so on the tile.
  const avgReplyS = (() => {
    const turns = sessions.reduce((s, x) => s + (x.totalTurns ?? 0), 0);
    const ms = sessions.reduce((s, x) => s + (x.latencyMsTotal ?? 0), 0);
    return turns && ms ? ms / turns / 1000 : null;
  })();
  const pendingCount = (data?.approvals?.length ?? 0) + (data?.chatApprovals?.length ?? 0);
  const approvalsAvailable = data != null && (data.approvals != null || data.chatApprovals != null);

  const agents = data?.agents ?? [];
  const agentRows = useMemo(() => {
    const by = new Map((stats?.byAgent ?? []).map(a => [a.apiName, a]));
    const rank = (st: string) => (st === 'Active' ? 0 : st === 'Draft' ? 1 : 2);
    return agents
      .map(a => {
        const c = by.get(a.apiName);
        const total = c ? c.runsToday + c.turnsToday : 0;
        const fail = c ? c.runsFailedToday + c.turnsFailedToday : 0;
        return { a, total, ok: total - fail, fail, tokens: c ? c.tokensIn + c.tokensOut : 0 };
      })
      .sort((x, y) => rank(x.a.status) - rank(y.a.status) || y.total - x.total || x.a.name.localeCompare(y.a.name));
  }, [agents, stats]);
  const counts = { active: agents.filter(a => a.status === 'Active').length, draft: agents.filter(a => a.status === 'Draft').length };
  const inactive = agents.length - counts.active - counts.draft;
  const failingAgents = (stats?.byAgent ?? [])
    .map(a => ({ name: a.name, fail: a.runsFailedToday + a.turnsFailedToday }))
    .filter(a => a.fail > 0)
    .sort((a, b) => b.fail - a.fail);
  const todayFailed = today?.fail ?? 0;
  // Failures go to the page that can show them: runs to Runs, chat turns
  // to Conversations.
  const todayRaw = stats?.byDay[stats.byDay.length - 1];
  const failuresAreChat = !!todayRaw && todayRaw.runsFailed === 0 && todayRaw.turnsFailed > 0;
  const drafts = agents.filter(a => a.status === 'Draft');

  // ── The entrance ────────────────────────────────────────────────────
  const [stage, setStage] = useState<'dark' | 'fly' | 'set' | 'live'>('dark');
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    const short = introMode() === 'short';
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = (ms: number) => (reduced ? 0 : short ? Math.round(ms * 0.45) : ms);
    const timers = [
      setTimeout(() => setStage('fly'), t(120)),
      setTimeout(() => setBurst(b => b + 1), t(1250)),
      setTimeout(() => setStage('set'), t(1600)),
      setTimeout(() => setStage('live'), t(1950)),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // ── What Archon is looking at ───────────────────────────────────────
  // The same numbers the tiles show, in a compact shape the copilot can
  // quote from. Bounded, so a large org never turns a question into a
  // wall of context.
  const snapshot = useMemo<Record<string, unknown>>(() => ({
    windowDays: WINDOW_DAYS,
    today: today ? { activity: todayTotal, succeeded: today.ok, failed: today.fail, other: today.other, successRate: pct(today.ok, today.ok + today.fail) } : null,
    lastDays: stats ? { succeeded: week.ok, failed: week.fail, tokensIn: stats.tokensIn, tokensOut: stats.tokensOut } : null,
    failingAgentsToday: failingAgents.slice(0, 10),
    approvalsWaiting: approvalsAvailable ? pendingCount : null,
    agents: data?.agents
      ? {
          total: agents.length, active: counts.active, draft: counts.draft, inactive,
          list: agentRows.slice(0, 15).map(r => ({ name: r.a.name, status: r.a.status, department: r.a.department ?? null, today: r.total, failedToday: r.fail })),
        }
      : null,
    chats: data?.sessions ? { active: activeSessions.length, recent: sessions.length, avgReplySeconds: avgReplyS != null ? Number(avgReplyS.toFixed(1)) : null } : null,
    notTracked: ['per-agent cost in currency', 'user-level activity'],
  }), [today, todayTotal, stats, week, failingAgents, approvalsAvailable, pendingCount, data, agents, counts, inactive, agentRows, activeSessions, sessions, avgReplyS]);
  const platformSnapshot = useCallback(() => snapshot, [snapshot]);

  // ── Focus: the chat takes the screen ────────────────────────────────
  const [focus, setFocus] = useState<{ message: { text: string; how: 'talk' | 'type' } | null } | null>(null);
  const [events, setEvents] = useState<ChatActivity[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [input, setInput] = useState('');

  const chatPhase = useMemo<VoicePhase>(() => {
    let p: VoicePhase = 'ready';
    for (const e of events) if (e.kind === 'phase') p = e.phase;
    return p;
  }, [events]);
  const phase: CorePhase = stage !== 'live' ? 'off' : focus ? chatPhase : 'ready';

  const exitFocus = useCallback(() => {
    setFocus(null);
    setCountdown(null);
  }, [setFocus, setCountdown]);
  const openFocus = (message: { text: string; how: 'talk' | 'type' } | null) => {
    setCountdown(null);
    setFocus({ message });
  };

  useEffect(() => {
    document.body.classList.toggle('home-lock', !!focus);
    return () => document.body.classList.remove('home-lock');
  }, [focus]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && focus) exitFocus(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [focus, exitFocus]);

  // A plain answer hands the screen back after a moment. A question from
  // the agent, or an open mic, means the conversation is still going.
  useEffect(() => {
    if (!focus) return;
    const last = events[events.length - 1];
    if (!last) return;
    if (last.kind === 'reply' && !/\?\s*$/.test(last.text.trim()) && !getVoicePref()) setCountdown(15);
    else setCountdown(null);
  }, [events, focus]);
  useEffect(() => {
    if (countdown == null) return;
    if (countdown <= 0) { exitFocus(); return; }
    const t = setTimeout(() => setCountdown(c => (c == null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, exitFocus]);

  const handleActivity = useCallback((e: ChatActivity) => {
    setEvents(list => (list.length >= 200 ? [...list.slice(-199), e] : [...list, e]));
  }, []);
  // Archon has no session to track; "ended" means the person cleared the
  // thread, which hands the screen back and refreshes the numbers (a build
  // may have added an agent).
  const handleSessionChange = useCallback((info: { sessionId: string | null; ended: boolean }) => {
    if (info.ended) { setEvents([]); setFocus(null); load(); }
  }, [load]);

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    openFocus({ text, how: 'type' });
  };
  const talk = () => {
    setVoicePref(true);
    openFocus(null);
  };
  const lastUserText = [...events].reverse().find(e => e.kind === 'user')?.text ?? '';
  const wantsAgent = WANTS_AGENT.test(lastUserText);

  // ── Tabs ─────────────────────────────────────────────────────────────
  const tabs: OrbitTab[] = [
    { key: 'new', label: 'New agent', group: 'build', href: '/new-agent', icon: <Sparkles /> },
    { key: 'models', label: 'AI Models', group: 'build', href: '/ai-connections', icon: <Layers /> },
    { key: 'agents', label: 'Agents', group: 'build', href: '/', icon: <Bot /> },
    { key: 'knowledge', label: 'Knowledge', group: 'build', href: '/knowledge', icon: <BookOpen /> },
    { key: 'connectors', label: 'Connectors', group: 'build', href: '/connectors', icon: <Plug /> },
    { key: 'templates', label: 'Templates', group: 'build', href: '/templates', icon: <LayoutGrid /> },
    { key: 'chat', label: 'Chat', group: 'build', href: '/chat', icon: <MessageCircle /> },
    { key: 'runs', label: 'Runs', group: 'monitor', href: '/executions', icon: <Activity /> },
    { key: 'conversations', label: 'Conversations', group: 'monitor', href: '/conversations', icon: <MessageSquare /> },
    { key: 'approvals', label: 'Approvals', group: 'monitor', href: '/approvals', icon: <CheckSquare />, badge: pendingCount || undefined },
    { key: 'cost', label: 'Cost', group: 'manage', href: '/cost', icon: <CircleDollarSign /> },
    { key: 'setup', label: 'Setup', group: 'manage', href: '/setup', icon: <Sun /> },
  ];

  const weekMax = Math.max(1, ...week.days.map(d => d.ok + d.fail + d.other));
  const tokensByAgent = agentRows.filter(r => r.tokens > 0).sort((a, b) => b.tokens - a.tokens);
  const tokMax = tokensByAgent[0]?.tokens ?? 1;
  const attnCount = (todayFailed ? 1 : 0) + (pendingCount ? 1 : 0) + (drafts.length ? 1 : 0);

  return (
    <AppShell title="Home" onRefresh={load} hideRail>
      <div className={`home ${stage}`} data-focus={focus ? '1' : '0'}>
        {/* ── left ─────────────────────────────────────────────────── */}
        <aside className="home-col">
          <div className="home-panel">
            <div className="home-hd"><span className="home-eyebrow">Today</span><span className="sub">{loading && !data ? 'loading…' : stats ? 'runs + chat turns · org' : 'live'}</span></div>
            <div className="home-tiles">
              <Tile k="Activity" v={stats ? String(todayTotal) : '—'} small={stats ? 'runs + chat turns' : data?.statsError ? 'unavailable' : undefined} />
              <Tile k="Succeeded · failed" v={stats && today ? <><span className="g">{today.ok}</span><small>·</small><span className={today.fail ? 'r' : ''}>{today.fail}</span></> : '—'} />
              <Tile k="Success rate" v={stats && today ? pct(today.ok, today.ok + today.fail) : '—'} tone="g" small={stats && today ? `${today.ok} of ${today.ok + today.fail}` : undefined} />
              <Tile k="Avg reply" v={avgReplyS != null ? avgReplyS.toFixed(1) : '—'} small={avgReplyS != null ? 's · your sessions' : 'no timed turns'} />
              <Tile k="Tokens in / out" v={stats ? fmtK(stats.tokensIn) : '—'} tone="c" small={stats ? `/ ${fmtK(stats.tokensOut)} · ${WINDOW_DAYS} days` : undefined} />
              <Tile k="Active chats" v={data?.sessions ? String(activeSessions.length) : '—'} small={data?.sessions ? `of ${sessions.length} recent` : undefined} />
              <Tile k="Approvals waiting" v={approvalsAvailable ? String(pendingCount) : '—'} tone={pendingCount ? 'a' : undefined} />
              <Tile k="Agents" v={data?.agents ? String(counts.active) : '—'} small={data?.agents ? `active · ${counts.draft} draft · ${inactive} off` : undefined} />
            </div>
          </div>
          <div className="home-panel">
            <div className="home-hd"><span className="home-eyebrow">Agents</span><span className="sub">{data?.agents ? `${agents.length} total · ${counts.active} active · ${counts.draft} draft · ${inactive} inactive` : ''}</span></div>
            <div className="home-agents">
              {data?.agentsError && <div className="home-empty">Couldn't load agents — {data.agentsError}</div>}
              {data?.agents && agents.length === 0 && <div className="home-empty">No agents yet — build one from the orbit.</div>}
              {agentRows.map(({ a, total, ok, fail, tokens }) => {
                const cls = a.status === 'Active' ? '' : a.status === 'Draft' ? 'd' : 'x';
                return (
                  <button key={a.id} type="button" className="home-ag" onClick={() => navigate(`/agent/${encodeURIComponent(a.apiName)}`)}>
                    <i className={cls} />
                    <span className="n" title={a.apiName}>{a.name}</span>
                    <span className={`s ${cls}`}>{a.status.toUpperCase()}</span>
                    <span className="m">
                      {total > 0 ? (
                        <>
                          <span><b>{total}</b> today</span>
                          <span className={fail ? 'bad' : 'ok'}>{ok} ok · {fail} failed</span>
                          <span className={fail ? '' : 'ok'}>{pct(ok, ok + fail)}</span>
                        </>
                      ) : a.totalExecutions ? (
                        <span className="q">{a.totalExecutions} runs all-time{a.successRate != null ? ` · ${Math.round(a.successRate)}% ok` : ''} · nothing today</span>
                      ) : (
                        <span className="q">{a.status === 'Draft' ? 'not yet activated' : a.status === 'Active' ? 'nothing today' : 'switched off'}</span>
                      )}
                      {tokens > 0 && <span><b>{fmtK(tokens)}</b> tok · {WINDOW_DAYS}d</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* ── centre ───────────────────────────────────────────────── */}
        <section className="home-center">
          <div className="home-field">
            <div className="home-glow" />
            <div className={`home-flash${burst ? ' go' : ''}`} key={`f${burst}`} />
            <OrbitTabs tabs={tabs} state={stage === 'dark' ? 'far' : stage === 'fly' ? 'fly' : 'set'} dim={!!focus} onPick={href => navigate(href)} />
            <CoreRing phase={phase} label="ARCHON" sub={PHASE_COPY[phase]} burst={burst} />
            <div className={`home-burst${burst ? ' go' : ''}`} key={`b${burst}`} />
          </div>

          <div className="home-panel home-ask">
            <div className="home-ask-head">
              <span className="home-eyebrow">Copilot</span>
              <span className="sub"><b>Archon</b> answers here — the platform, your org, and building agents · your own agents are on <button type="button" className="link" onClick={() => navigate('/chat')}>Chat</button></span>
            </div>
            <div className="home-chips">
              {SUGGESTIONS.map(s => (
                <button key={s} type="button" className="home-chip" onClick={() => openFocus({ text: s, how: 'type' })}>{s}</button>
              ))}
            </div>
            <div className="home-inrow">
              <button type="button" className="home-mic" onClick={talk} aria-label="Talk to the copilot" title="Talk"><Mic /></button>
              <input
                id="home-ask-input"
                className="home-in"
                type="text"
                placeholder="Type here, or just talk"
                autoComplete="off"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
              />
              <button type="button" className="home-send" onClick={submit} disabled={!input.trim()}><Send /> Send</button>
            </div>
            <div className="home-status" data-phase={phase}><span className="dot" />{STATUS_COPY[phase]}</div>
          </div>
        </section>

        {/* ── right ────────────────────────────────────────────────── */}
        <aside className="home-col">
          <div className="home-panel">
            <div className="home-hd"><span className="home-eyebrow">Needs attention</span><span className="sub">{attnCount} item{attnCount === 1 ? '' : 's'}</span></div>
            <div className="home-att">
              {todayFailed > 0 && (
                <button type="button" onClick={() => navigate(failuresAreChat ? '/conversations' : '/executions')}><span className="bar r" /><span className="t">{todayFailed} failed today<small>{failingAgents.slice(0, 3).map(f => `${f.name} ×${f.fail}`).join(' · ')}</small></span><span className="go">Open →</span></button>
              )}
              {pendingCount > 0 && (
                <button type="button" onClick={() => navigate('/approvals')}><span className="bar a" /><span className="t">{pendingCount} approval{pendingCount === 1 ? '' : 's'} waiting<small>nothing is written until someone signs off</small></span><span className="go">Approvals →</span></button>
              )}
              {drafts.length > 0 && (
                <button type="button" onClick={() => navigate('/')}><span className="bar c" /><span className="t">{drafts.length} agent{drafts.length === 1 ? '' : 's'} in Draft<small>{drafts.slice(0, 3).map(d => d.name).join(' · ')}</small></span><span className="go">Agents →</span></button>
              )}
              {attnCount === 0 && <div className="home-empty">Nothing needs you right now.</div>}
            </div>
          </div>

          <div className="home-panel">
            <div className="home-hd"><span className="home-eyebrow">Success · failure</span><span className="sub">runs + chat turns · last {WINDOW_DAYS} days</span></div>
            <div className="home-bd">
              {data?.statsError ? (
                <div className="home-empty">Couldn't load activity — {data.statsError}</div>
              ) : !stats ? (
                <div className="home-empty"><Loader2 className="spin" /> Loading…</div>
              ) : week.ok + week.fail === 0 ? (
                <div className="home-empty">No finished runs or chat turns in the last {WINDOW_DAYS} days.</div>
              ) : (
                <>
                  <div className="home-sf-sum"><b>{pct(week.ok, week.ok + week.fail)}</b><span>{week.ok} of {week.ok + week.fail} succeeded · <em>{week.fail} failed</em></span></div>
                  <svg className="home-chart" viewBox="0 0 296 118" aria-label="Succeeded and failed runs and chat turns per day">
                    {week.days.map((d, i) => {
                      const l = 6, r = 6, t = 16, b = 30, gap = 8, W = 296, H = 118;
                      const bw = (W - l - r - gap * (week.days.length - 1)) / week.days.length;
                      const y = (v: number) => t + (H - t - b) * (1 - v / weekMax);
                      const x = l + i * (bw + gap);
                      const total = d.ok + d.fail;
                      const yTop = y(total), yOk = y(d.ok), base = H - b;
                      return (
                        <g key={d.key}>
                          {d.ok > 0 && <rect x={x} y={yOk} width={bw} height={base - yOk} rx={2} className="ok" opacity={i === week.days.length - 1 ? 1 : 0.75}><title>{d.ok} succeeded</title></rect>}
                          {d.fail > 0 && <rect x={x} y={yTop} width={bw} height={Math.max(2, yOk - yTop)} className="fail"><title>{d.fail} failed</title></rect>}
                          {total > 0 && <text x={x + bw / 2} y={yTop - 4} textAnchor="middle" className="n">{total}</text>}
                          <text x={x + bw / 2} y={H - 18} textAnchor="middle" className="d">{d.label}</text>
                          <text x={x + bw / 2} y={H - 6} textAnchor="middle" className={d.fail ? 'p warn' : 'p'}>{total ? pct(d.ok, total) : ''}</text>
                        </g>
                      );
                    })}
                  </svg>
                  <div className="home-legend"><span><i className="g" />succeeded</span><span><i className="r" />failed</span><span className="right">% = success rate that day</span></div>
                </>
              )}
            </div>
          </div>

          <div className="home-panel">
            <div className="home-hd"><span className="home-eyebrow">Tokens by agent</span><span className="sub">org · {WINDOW_DAYS} days · {stats ? fmtK(stats.tokensIn + stats.tokensOut) : '—'} total</span></div>
            <div className="home-bd home-bars">
              {tokensByAgent.length === 0 && <div className="home-empty">{stats ? `No token usage in the last ${WINDOW_DAYS} days.` : 'unavailable'}</div>}
              {tokensByAgent.map(({ a, tokens }) => (
                <div key={a.id} className="home-bar-row"><span title={a.apiName}>{a.name}</span><span className="tr"><b style={{ width: `${(tokens / tokMax) * 100}%` }} /></span><span className="n">{fmtK(tokens)}</span></div>
              ))}
            </div>
          </div>
        </aside>

        {/* ── focus: the chat takes the screen ─────────────────────── */}
        {focus && (
          <div className="home-focus" onPointerDown={() => setCountdown(null)}>
            <div className="home-focus-head">
              <PhaseRing phase={chatPhase} />
              <div className="ft"><b>{COPILOT.name}</b><span>{STATUS_COPY[chatPhase]}</span></div>
              {countdown != null && <span className="home-count">Answered — back to the dashboard in {countdown}s. Say or type anything to stay.</span>}
              {wantsAgent && (
                <button type="button" className="home-btn" onClick={() => navigate('/new-agent', { state: { requirement: lastUserText } })}><Sparkles /> Open in Architect</button>
              )}
              <button type="button" className="home-btn ghost" onClick={exitFocus}><X /> Back to dashboard</button>
            </div>
            <div className="home-focus-body">
              <div className="home-focus-chat">
                <ChatPanel
                  key="archon-copilot"
                  variant="full"
                  transport="copilot"
                  agentApiName={COPILOT.apiName}
                  agentName={COPILOT.name}
                  copilotPlatform={platformSnapshot}
                  initialMessage={focus.message}
                  onClose={exitFocus}
                  onSessionChange={handleSessionChange}
                  onActivity={handleActivity}
                />
              </div>
              <ConsoleRail events={events} agentName={COPILOT.name} />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Tile({ k, v, small, tone }: { k: string; v: React.ReactNode; small?: string; tone?: 'g' | 'r' | 'a' | 'c' }) {
  return (
    <div className="home-tile">
      <div className="k">{k}</div>
      <div className={`v${tone ? ' ' + tone : ''}`}>{v}{small ? <small>{small}</small> : null}</div>
    </div>
  );
}
