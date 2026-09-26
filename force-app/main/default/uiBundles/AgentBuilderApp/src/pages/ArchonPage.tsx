import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ArrowLeft, Maximize2, Minimize2, X } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { ChatPanel, type HostedBuild } from '@/components/chat/ChatPanel';
import { BuildWorkspace } from '@/components/chat/BuildWorkspace';
import { ArchonOrb, type OrbPhase } from '@/components/archon/ArchonOrb';
import { ApprovalsSurface, ChartSurface, DashboardSurface, DraftsSurface, FailuresSurface, type SurfaceProps } from '@/components/archon/surfaces';
import { COPILOT } from '@/lib/copilot';
import { setVoicePref } from '@/lib/voice';
import type { ChatActivity, ChatPhase } from '@/lib/chat-activity';
import { editsCurrentBuild, intentOf } from '@/lib/archon-intent';
import { loadArchonData, type ArchonData } from '@/lib/archon-data';
import '@/styles/archon.css';

/**
 * Archon, full screen.
 *
 * One conversation with the built-in agent fills the screen. The screen
 * divides only when an answer needs a surface beside the words — today
 * as a dashboard, a list of failures, drafts or approvals, a chart, or
 * the Architect's build once it starts designing — and closes again when
 * that work is done, so the conversation is always the home position.
 *
 * The conversation itself is the same ChatPanel every other screen uses,
 * in its 'studio' dress: the page draws the header, the greeting and the
 * suggestion chips; the panel keeps the transcript, the composer (the one
 * place to type or talk) and everything a turn can do.
 */
type Surface = 'build' | 'dash' | 'failures' | 'drafts' | 'approvals' | 'chart';
type Message = { text: string; how: 'talk' | 'type' };
interface NavState { message?: Message | null; how?: 'talk' | 'type'; sessionId?: string | null }

const CHIPS: Record<'idle' | Surface, string[]> = {
  idle: ['What happened today?', 'Show the failures', 'What is waiting for approval?', 'Cost by agent as a chart'],
  dash: ['Show the failures', 'Show the approvals', 'Cost by agent as a chart', 'Close'],
  failures: ['What happened today?', 'Show my drafts', 'Close'],
  drafts: ['What happened today?', 'Show the approvals', 'Close'],
  approvals: ['What happened today?', 'Show the failures', 'Close'],
  chart: ['What happened today?', 'Show the failures', 'Close'],
  build: ['What happened today?', 'Close'],
};
const SURFACE_LABEL: Record<Surface, string> = { build: 'Build', dash: 'Dashboard', failures: 'Failures', drafts: 'Drafts', approvals: 'Approvals', chart: 'Chart' };
const STATUS_COPY: Record<OrbPhase, string> = { ready: 'Ready', listen: 'Listening', think: 'Thinking', speak: 'Speaking', build: 'Building' };
const isListSurface = (s: string | null): s is 'dash' | 'failures' | 'drafts' | 'approvals' | 'chart' => s === 'dash' || s === 'failures' || s === 'drafts' || s === 'approvals' || s === 'chart';

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
  const [phase, setPhase] = useState<ChatPhase>('ready');
  const [talking, setTalking] = useState(!!arrival.message || !!arrival.sessionId);
  const [surface, setSurface] = useState<Surface | null>(null);
  const [hosted, setHosted] = useState<HostedBuild | null>(null);
  const [data, setData] = useState<ArchonData | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [command, setCommand] = useState<{ text: string; how: 'talk' | 'type'; seq: number } | null>(null);
  const [chips, setChips] = useState<string[]>(CHIPS.idle);
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  /** A build the person closed: not reopened by its own progress. */
  const dismissedBuildRef = useRef<string | null>(null);
  /** The build whose design already opened the surface once. */
  const autoOpenedRef = useRef<string | null>(null);

  // Arrived by voice: the panel arms the microphone as soon as it is ready.
  useEffect(() => { if (arrival.how === 'talk') setVoicePref(true); }, [arrival.how]);

  // ── the surface ──────────────────────────────────────────────────────
  const refresh = useCallback(() => {
    setDataLoading(true);
    loadArchonData().then(d => { setData(d); setDataLoading(false); });
  }, []);
  const open = useCallback((s: Surface) => {
    setSurface(s);
    setChips(CHIPS[s]);
    if (s !== 'build') refresh();
  }, [refresh]);
  const close = useCallback(() => {
    if (surface === 'build' && hosted) dismissedBuildRef.current = hosted.messageId;
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
      // agent starts as words alone — the graph comes when it is designed.
      if (surface === 'build' && editsCurrentBuild(text)) return;
      if (surface && surface !== 'build') { setSurface(null); setChips(CHIPS.idle); }
      dismissedBuildRef.current = null;
    }
  }, [close, open, hosted, surface]);

  const onActivity = useCallback((e: ChatActivity) => {
    if (e.kind === 'phase') setPhase(e.phase);
    else if (e.kind === 'user') { setTalking(true); route(e.text); }
    else if (e.kind === 'reply') setTalking(true);
  }, [route]);

  // The Architect's build opens the surface by itself the moment it starts
  // designing (or stops for a decision past the first stages) — once per
  // build, so a person who then looks at something else is not pulled back.
  useEffect(() => {
    const v = hosted?.view;
    if (!hosted || !v) return;
    if (dismissedBuildRef.current === hosted.messageId || autoOpenedRef.current === hosted.messageId) return;
    const design = v.steps.find(s => s.key === 'design');
    const designStarted = !!design && design.state !== 'pending';
    const firstOpen = v.steps.findIndex(s => s.state !== 'done' && s.state !== 'warn');
    const stoppedForDecision = (v.status === 'paused' || v.status === 'failed') && firstOpen >= 2;
    if (designStarted || stoppedForDecision || v.status === 'done') {
      autoOpenedRef.current = hosted.messageId;
      setSurface('build');
      setChips(CHIPS.build);
    }
  }, [hosted]);

  const onActivated = useCallback(() => {
    if (hosted) dismissedBuildRef.current = hosted.messageId;
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
    : data ? `read ${new Date(data.loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  const sp: SurfaceProps = { data, loading: dataLoading, now, onGo: href => navigate(href), onAsk: ask, onRefresh: refresh };

  return (
    <AppShell hideRail>
      <div className="ax" data-phase={orbPhase}>
        <header className="ax-hd">
          <button type="button" className="ax-btn ghost" onClick={() => navigate('/home')}><ArrowLeft /> Home</button>
          <div className="ax-title"><ArchonOrb size="sm" phase={orbPhase} />Archon</div>
          <span className="ax-status" data-s={orbPhase} aria-live="polite"><i />{STATUS_COPY[orbPhase]}</span>
          <span className="ax-ctx">{today}</span>
          <span className="sp" />
          <button type="button" className="ax-btn ghost" onClick={toggleFull} title={full ? 'Leave full screen' : 'Use the whole screen'}>
            {full ? <Minimize2 /> : <Maximize2 />} {full ? 'Exit full screen' : 'Full screen'}
          </button>
        </header>

        <div className="ax-area" data-layout={surface ? 'split' : 'full'}>
          <section className={`ax-conv${talking ? ' talking' : ''}`} aria-label="Conversation">
            <div className="ax-orbhead">
              <ArchonOrb size="xl" phase={orbPhase} />
              <div className="ax-greet">
                <h1>Hello. I'm Archon.</h1>
                <p>What are we doing today? Ask for anything, or describe an agent to build.</p>
              </div>
              {working && <span className="ax-working"><i />{working}</span>}
            </div>
            <div className="ax-convhd">Conversation <span className="r">you · {agent.name}</span></div>
            <div className="ax-chat">
              <ChatPanel
                key={`${agent.apiName}-${openSeq}`}
                variant="studio"
                agentApiName={agent.apiName}
                agentName={agent.name}
                initialMessage={initialMessage}
                initialSessionId={sessionSeed}
                command={command}
                buildHost={setHosted}
                onClose={() => navigate('/home')}
                onActivity={onActivity}
                onTransfer={handleTransfer}
                onMove={id => navigate('/new-agent', { state: { sessionId: id } })}
                moveLabel="Open on the New agent page"
              />
            </div>
            <div className="ax-sugg" aria-label="Suggestions">
              {chips.map(c => <button key={c} type="button" className="ax-chip" onClick={() => ask(c)}>{c}</button>)}
            </div>
          </section>

          <section className="ax-surface" data-mode={surface ?? ''} aria-hidden={!surface} aria-label="Answer">
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
