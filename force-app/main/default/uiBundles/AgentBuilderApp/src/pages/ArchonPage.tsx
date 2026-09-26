import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ArrowLeft, History, Maximize2, Minimize2, Plus, X } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { ChatPanel, type HostedBuild } from '@/components/chat/ChatPanel';
import { BuildWorkspace } from '@/components/chat/BuildWorkspace';
import { SessionTranscript } from '@/components/chat/SessionTranscript';
import { ArchonOrb, type OrbPhase } from '@/components/archon/ArchonOrb';
import { ApprovalsSurface, ChartSurface, DashboardSurface, DraftsSurface, FailuresSurface, UsageSurface, type SurfaceProps } from '@/components/archon/surfaces';
import { COPILOT } from '@/lib/copilot';
import { setVoicePref } from '@/lib/voice';
import type { ChatActivity, ChatPhase } from '@/lib/chat-activity';
import { editsCurrentBuild, intentOf } from '@/lib/archon-intent';
import { loadArchonData, type ArchonData } from '@/lib/archon-data';
import { loadHomeStats } from '@/lib/home-stats-data';
import type { ScreenRequest, ScreenView, UsageReport } from '@/lib/archon-screen';
import { listMySessions, type SessionSummary } from '@/lib/conversations-data';
import { formatLastTurn, groupSessionsByDay, sessionsForAgent } from '@/lib/chat-list';
import '@/styles/archon.css';

/**
 * Archon, full screen.
 *
 * One conversation with the built-in agent fills the screen, and it is a
 * NEW conversation every time the screen opens; the earlier ones sit in
 * the Recent rail, the copilot's own and nobody else's, to read back.
 *
 * The screen divides only when an answer needs a surface beside the
 * words — today as a dashboard, the usage report, a list of failures,
 * drafts or approvals, a chart, or the Architect's build — and closes
 * again when that work is done, so the conversation is always the home
 * position. Two things open a surface: the person's own words (a small
 * phrase match on every send) and the copilot itself, which calls
 * show_on_screen when asked to show or visualise something.
 *
 * The conversation is the same ChatPanel every other screen uses, in its
 * 'studio' dress: the page draws the header, the greeting and the
 * suggestion chips; the panel keeps the transcript, the composer (the one
 * place to type or talk) and everything a turn can do.
 */
type Surface = 'build' | 'dash' | 'usage' | 'failures' | 'drafts' | 'approvals' | 'chart';
type Message = { text: string; how: 'talk' | 'type' };
interface NavState { message?: Message | null; how?: 'talk' | 'type'; sessionId?: string | null }

const CHIPS: Record<'idle' | Surface, string[]> = {
  idle: ['What happened today?', 'Show the failures', 'What is waiting for approval?', 'Show the usage report'],
  dash: ['Show the failures', 'Show the approvals', 'Show the usage report', 'Close'],
  usage: ['Cost by agent as a chart', 'What happened today?', 'Close'],
  failures: ['What happened today?', 'Show my drafts', 'Close'],
  drafts: ['What happened today?', 'Show the approvals', 'Close'],
  approvals: ['What happened today?', 'Show the failures', 'Close'],
  chart: ['Show the usage report', 'What happened today?', 'Close'],
  build: ['What happened today?', 'Close'],
};
const SURFACE_LABEL: Record<Surface, string> = { build: 'Build', dash: 'Dashboard', usage: 'Usage', failures: 'Failures', drafts: 'Drafts', approvals: 'Approvals', chart: 'Chart' };
const STATUS_COPY: Record<OrbPhase, string> = { ready: 'Ready', listen: 'Listening', think: 'Thinking', speak: 'Speaking', build: 'Building' };
const VIEW_TO_SURFACE: Record<ScreenView, Surface> = { dashboard: 'dash', usage: 'usage', failures: 'failures', drafts: 'drafts', approvals: 'approvals', cost: 'chart', build: 'build' };
/** A build's 'moment': which build, and whether it is running, waiting for the person, finished or failed. */
const buildMoment = (b: HostedBuild): string => `${b.messageId}:${b.view?.status === 'paused' || b.view?.status === 'done' || b.view?.status === 'failed' ? b.view.status : 'live'}`;
const isListSurface = (s: string | null): s is Exclude<Surface, 'build'> => s === 'dash' || s === 'usage' || s === 'failures' || s === 'drafts' || s === 'approvals' || s === 'chart';

export default function ArchonPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // How we arrived, read once: the state is a message, not a setting.
  const [arrival] = useState(() => {
    const s = (location.state as NavState | null) ?? null;
    return { message: s?.message ?? null, how: s?.how ?? 'type', sessionId: s?.sessionId ?? null };
  });
  const [agent, setAgent] = useState<{ apiName: string; name: string }>(COPILOT);
  const [openSeq, setOpenSeq] = useState(0);
  const [initialMessage, setInitialMessage] = useState<Message | null>(arrival.message);
  const [sessionSeed, setSessionSeed] = useState<string | null>(arrival.sessionId);
  const [liveSessionId, setLiveSessionId] = useState<string | null>(arrival.sessionId);
  const [phase, setPhase] = useState<ChatPhase>('ready');
  const [talking, setTalking] = useState(!!arrival.message || !!arrival.sessionId);
  const [surface, setSurface] = useState<Surface | null>(null);
  const [hosted, setHosted] = useState<HostedBuild | null>(null);
  const [data, setData] = useState<ArchonData | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [command, setCommand] = useState<{ text: string; how: 'talk' | 'type'; seq: number } | null>(null);
  const [chips, setChips] = useState<string[]>(CHIPS.idle);
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  // Recent: the copilot's own conversations, and the one being read back.
  const [recentOpen, setRecentOpen] = useState(false);
  const [recent, setRecent] = useState<SessionSummary[]>([]);
  const [viewing, setViewing] = useState<SessionSummary | null>(null);
  /** A build the person closed: not reopened by its own progress. */
  const dismissedBuildRef = useRef<string | null>(null);
  /** The build whose current moment already opened the surface. */
  const autoOpenedRef = useRef<string | null>(null);

  // Arrived by voice: the panel arms the microphone as soon as it is ready.
  useEffect(() => { if (arrival.how === 'talk') setVoicePref(true); }, [arrival.how]);

  // ── recent conversations ─────────────────────────────────────────────
  const refreshRecent = useCallback(() => {
    listMySessions(200).then(list => setRecent(sessionsForAgent(list, COPILOT.apiName))).catch(() => { /* the rail stays as it was */ });
  }, []);
  useEffect(() => { refreshRecent(); }, [refreshRecent]);
  const groups = useMemo(() => groupSessionsByDay(recent), [recent]);
  const onSessionChange = useCallback((info: { sessionId: string | null; ended: boolean }) => {
    if (info.sessionId && !info.ended) setLiveSessionId(info.sessionId);
    refreshRecent();
  }, [refreshRecent]);

  // ── the surface ──────────────────────────────────────────────────────
  const refresh = useCallback(() => {
    setDataLoading(true);
    loadArchonData().then(d => { setData(d); setDataLoading(false); });
  }, []);
  /** The usage report from the org's aggregate — used when the person
   *  asked in their own words; rows the copilot sent take precedence. */
  const loadUsage = useCallback((days: number) => {
    loadHomeStats(days)
      .then(st => setReport(cur => (cur && cur.source === 'archon' && cur.days === days) ? cur : {
        days,
        source: 'org',
        rows: st.byAgent
          .map(a => ({ apiName: a.apiName, name: a.name, turns: days === 1 ? a.turnsToday + a.runsToday : null, tokensIn: a.tokensIn, tokensOut: a.tokensOut }))
          .sort((a, b) => (b.tokensIn + b.tokensOut) - (a.tokensIn + a.tokensOut)),
      }))
      .catch(() => { /* the surface says it has nothing */ });
  }, []);
  const open = useCallback((s: Surface, opts?: { days?: number | null; usage?: UsageReport }) => {
    setSurface(s);
    setChips(CHIPS[s]);
    if (opts?.usage) setReport(opts.usage);
    else if (s === 'usage' || s === 'chart') loadUsage(opts?.days ?? 31);
    if (s !== 'build') refresh();
  }, [refresh, loadUsage]);
  // A data surface re-reads the org every minute while it is open.
  useEffect(() => {
    if (!surface || surface === 'build' || surface === 'usage' || surface === 'chart') return;
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [surface, refresh]);
  const close = useCallback(() => {
    if (surface === 'build' && hosted) dismissedBuildRef.current = buildMoment(hosted);
    setSurface(null);
    setChips(CHIPS.idle);
  }, [surface, hosted]);

  /** What the person just said decides whether the screen divides. */
  const route = useCallback((text: string) => {
    const it = intentOf(text);
    if (it === 'close') { close(); return; }
    if (isListSurface(it)) { open(it); return; }
    if (it === 'build-back') { if (hosted) { dismissedBuildRef.current = null; open('build'); } return; }
    if (it === 'build') {
      // A change to the agent being built keeps the build in view; a new
      // agent starts as words — its build shows itself the moment it exists.
      if (surface === 'build' && editsCurrentBuild(text)) return;
      if (surface && surface !== 'build') { setSurface(null); setChips(CHIPS.idle); }
      dismissedBuildRef.current = null;
    }
  }, [close, open, hosted, surface]);

  /** The copilot asked for a view itself (show_on_screen). Its choice wins
   *  over the phrase match, and its rows travel with it. */
  const onShow = useCallback((s: ScreenRequest) => {
    const target = VIEW_TO_SURFACE[s.view];
    if (target === 'build') { if (!hosted) return; dismissedBuildRef.current = null; }
    open(target, { days: s.days, usage: s.usage });
  }, [open, hosted]);

  const onActivity = useCallback((e: ChatActivity) => {
    if (e.kind === 'phase') setPhase(e.phase);
    else if (e.kind === 'user') { setTalking(true); route(e.text); }
    else if (e.kind === 'reply') setTalking(true);
  }, [route]);

  // The Architect's build shows itself: the moment it exists (the stage
  // rail is the only honest progress indicator), and again each time it
  // stops for the person or finishes. Each such moment opens once, so a
  // person who closed it and went to look at something else is not
  // pulled back until the build has something new to say.
  useEffect(() => {
    if (!hosted?.view) return;
    const moment = buildMoment(hosted);
    if (dismissedBuildRef.current === moment || autoOpenedRef.current === moment) return;
    autoOpenedRef.current = moment;
    setSurface('build');
    setChips(CHIPS.build);
  }, [hosted]);

  const onActivated = useCallback(() => {
    if (hosted) dismissedBuildRef.current = buildMoment(hosted);
    setSurface(null);
    setChips(['How is it doing?', 'What happened today?', 'Show my drafts']);
  }, [hosted]);

  // ── words the page puts in the person's mouth ────────────────────────
  const ask = useCallback((text: string) => setCommand({ text, how: 'type', seq: Date.now() }), []);
  const handleTransfer = useCallback((t: { agentApiName: string; agentName: string; message: string }) => {
    setAgent({ apiName: t.agentApiName, name: t.agentName });
    setSessionSeed(null);
    setInitialMessage({ text: t.message, how: 'type' });
    setOpenSeq(n => n + 1);
  }, []);
  /** A new conversation: the panel remounts on a fresh session; the one
   *  just left stays in Recent. */
  const newConversation = useCallback(() => {
    setViewing(null);
    setAgent(COPILOT);
    setSessionSeed(null);
    setLiveSessionId(null);
    setInitialMessage(null);
    setTalking(false);
    setSurface(null);
    setChips(CHIPS.idle);
    setHosted(null);
    setOpenSeq(n => n + 1);
    refreshRecent();
  }, [refreshRecent]);
  /** Read an earlier conversation back. The live one is simply returned to. */
  const openRecent = useCallback((s: SessionSummary) => {
    if (s.id === liveSessionId) { setViewing(null); return; }
    setSurface(null);
    setViewing(s);
  }, [liveSessionId]);

  // ── full screen and keys ─────────────────────────────────────────────
  useEffect(() => {
    const h = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);
  const toggleFull = () => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    } catch { /* not allowed in this host */ }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && surface && !document.fullscreenElement) close(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [surface, close]);

  // ── derived ──────────────────────────────────────────────────────────
  const building = !!hosted?.view && (hosted.view.status === 'running' || hosted.view.status === 'queued');
  const orbPhase: OrbPhase = building && phase === 'ready' ? 'build' : phase;
  const working = useMemo(() => {
    const s = hosted?.view?.steps.find(x => x.state === 'running');
    return s ? (s.detail || s.label) : '';
  }, [hosted]);
  const now = useMemo(() => new Date(), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  const meta = surface === 'build'
    ? hosted?.view ? `$${hosted.view.costUsd.toFixed(2)} of $${hosted.view.maxCostUsd.toFixed(2)} · ${Math.round(hosted.view.elapsedMs / 1000)}s` : ''
    : surface === 'usage' || surface === 'chart'
      ? report ? `last ${report.days} day${report.days === 1 ? '' : 's'}${report.source === 'archon' ? ' · as Archon reported it' : ''}` : ''
      : data ? `read ${new Date(data.loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  const sp: SurfaceProps = { data, loading: dataLoading, now, report, onGo: href => navigate(href), onAsk: ask, onRefresh: refresh };

  return (
    <AppShell hideRail>
      <div className="ax" data-phase={orbPhase}>
        <header className="ax-hd">
          <button type="button" className="ax-btn ghost" onClick={() => navigate('/home')}><ArrowLeft /> Home</button>
          <div className="ax-title"><ArchonOrb size="sm" phase={orbPhase} />Archon</div>
          <span className="ax-status" data-s={orbPhase} aria-live="polite"><i />{STATUS_COPY[orbPhase]}</span>
          <span className="ax-ctx">{today}</span>
          <button type="button" className={`ax-btn ghost${recentOpen ? ' on' : ''}`} onClick={() => { setRecentOpen(o => !o); refreshRecent(); }} aria-pressed={recentOpen} title="Earlier conversations with Archon">
            <History /> Recent{recent.length ? ` · ${recent.length}` : ''}
          </button>
          <button type="button" className="ax-btn ghost" onClick={newConversation} title="Start a new conversation"><Plus /> New</button>
          <span className="sp" />
          <button type="button" className="ax-btn ghost" onClick={toggleFull} title={full ? 'Leave full screen' : 'Use the whole screen'}>
            {full ? <Minimize2 /> : <Maximize2 />} {full ? 'Exit full screen' : 'Full screen'}
          </button>
        </header>

        <div className="ax-area" data-layout={surface && !viewing ? 'split' : 'full'}>
          <section className={`ax-conv${talking || viewing ? ' talking' : ''}${recentOpen ? ' with-recent' : ''}`} aria-label="Conversation">
            {recentOpen && (
              <aside className="ax-recent" aria-label="Recent conversations with Archon">
                <div className="ax-recent-hd">Recent <span className="n">Archon only</span></div>
                <button type="button" className="ax-btn sm ax-recent-new" onClick={newConversation}><Plus /> New conversation</button>
                <div className="ax-recent-list">
                  {recent.length === 0 && <div className="ax-empty">No earlier conversations yet.</div>}
                  {groups.map(g => (
                    <div key={g.label}>
                      <div className="ax-recent-group">{g.label}</div>
                      {g.sessions.map(s => {
                        const on = viewing ? viewing.id === s.id : s.id === liveSessionId;
                        return (
                          <button key={s.id} type="button" className={`ax-recent-item${on ? ' on' : ''}`} onClick={() => openRecent(s)} aria-current={on ? 'true' : undefined}>
                            <span className="t"><b>{s.title || 'New conversation'}</b><small>{formatLastTurn(s.lastActivityAt)}</small></span>
                            <span className="s"><i className={s.status === 'Active' ? 'on' : ''} />{s.id === liveSessionId ? 'this conversation' : s.status}{s.totalTurns ? ` · ${s.totalTurns} turn${s.totalTurns === 1 ? '' : 's'}` : ''}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </aside>
            )}
            <div className="ax-convmain">
              {/* The orb is the room's light, not a fixture: a faint glow
                  behind the words that takes no space of its own. */}
              <div className="ax-orbhead" aria-hidden="true">
                <ArchonOrb size="xl" phase={orbPhase} />
                <div className="ax-greet">
                  <h1>Hello. I'm Archon.</h1>
                  <p>What are we doing today? Ask for anything, or describe an agent to build.</p>
                </div>
              </div>
              {working && <div className="ax-workline"><span className="ax-working"><i />{working}</span></div>}
              <div className="ax-convhd">Conversation <span className={`r${working ? ' live' : ''}`}>{working ? <><i />{working}</> : `you · ${agent.name}`}</span></div>
              {viewing ? (
                <div className="ax-transcript">
                  <SessionTranscript session={viewing} agentName={COPILOT.name} onNewChat={newConversation} />
                </div>
              ) : (
                <>
                  <div className="ax-chat">
                    <ChatPanel
                      key={`${agent.apiName}-${openSeq}`}
                      variant="studio"
                      agentApiName={agent.apiName}
                      agentName={agent.name}
                      initialMessage={initialMessage}
                      initialSessionId={sessionSeed}
                      freshSession
                      command={command}
                      buildHost={setHosted}
                      onShow={onShow}
                      onClose={() => navigate('/home')}
                      onActivity={onActivity}
                      onSessionChange={onSessionChange}
                      onTransfer={handleTransfer}
                      onMove={id => navigate('/new-agent', { state: { sessionId: id } })}
                      moveLabel="Open on the New agent page"
                    />
                  </div>
                  <div className="ax-sugg" aria-label="Suggestions">
                    {/* "Close" is the page's own action, never words sent to the copilot. */}
              {chips.map(c => <button key={c} type="button" className="ax-chip" onClick={() => (c === 'Close' ? close() : ask(c))}>{c}</button>)}
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="ax-surface" data-mode={surface ?? ''} aria-hidden={!surface || !!viewing} aria-label="Answer">
            <div className="ax-shd">
              <span className="ax-mode">{surface ? SURFACE_LABEL[surface] : ''}</span>
              <span className="meta">{meta}</span>
              <span className="sp" />
              <button type="button" className="ax-btn ghost sm" onClick={close} title="Back to the conversation"><X /> Close</button>
            </div>
            <div className="ax-sbody">
              {surface === 'build' && hosted && (
                <BuildWorkspace
                  requirement={hosted.requirement}
                  jobId={hosted.jobId}
                  view={hosted.view}
                  interrupted={hosted.interrupted}
                  isError={hosted.isError}
                  onSend={hosted.send}
                  onActivated={onActivated}
                />
              )}
              {surface === 'build' && !hosted && <div className="ax-empty">No build yet — describe the agent you want and the Architect starts.</div>}
              {surface === 'dash' && <DashboardSurface {...sp} />}
              {surface === 'usage' && <UsageSurface {...sp} />}
              {surface === 'failures' && <FailuresSurface {...sp} />}
              {surface === 'drafts' && <DraftsSurface {...sp} />}
              {surface === 'approvals' && <ApprovalsSurface {...sp} />}
              {surface === 'chart' && <ChartSurface {...sp} />}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
