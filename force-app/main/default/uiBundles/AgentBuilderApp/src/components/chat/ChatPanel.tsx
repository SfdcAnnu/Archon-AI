import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, Mic, MicOff, Paperclip, Send, Settings2,
  ThumbsDown, ThumbsUp, Volume1, Volume2, VolumeX, X,
} from 'lucide-react';
import { askArchon, getArchitectBuild, startArchitectBuild, type BuildJobView } from '@/lib/architect-data';
import {
  speak, speakable, stopSpeaking, getSoundPref, setSoundPref, nextSoundPref, SOUND_LABEL,
  getVoicePref, setVoicePref, useSpeaking, type SoundPref,
} from '@/lib/voice';
import { VoiceStrip, PhaseRing, type VoicePhase } from './VoiceStrip';
import type { ChatActivity, ChatActivityInput } from '@/lib/chat-activity';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { renderMarkdown } from '@/lib/render-markdown';
import { openChatSocket, continuationText, type ChatTurnResult, type ChatHistoryEntry, type ChatAttachmentRef, type ChatToolCallSummary } from '@/lib/ws-chat';
import { listChatApprovals, type ChatApproval } from '@/lib/chat-approvals-data';
import { ChatApprovalCard } from './ChatApprovalCard';
import { ToolResultCards, flattenCalls } from './ToolResultCards';
import { BuildWorkspace } from './BuildWorkspace';
import {
  startChatSession,
  getConnectionGate,
  startMyConnection,
  uploadChatFile,
  endChatSession,
  discardChatSessionIfEmpty,
  sendMessageFeedback,
  type RawChatMessage,
  type RawChatSession,
  type ConnectionGate,
} from '@/lib/chat-data';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_TURN = 5;

interface PendingAttachment {
  id: string;
  name: string;
  mimeType: string;
  isImage: boolean;
  previewUrl: string | null;
  contentDocumentId: string | null;
  contentVersionId: string | null;
  fileExtension: string;
  uploading: boolean;
}

interface DisplayMessage {
  id: string;
  /** 'Build' is a copilot-only card: an Architect build in progress, drawn
   *  stage by stage in the transcript itself. */
  role: 'User' | 'Assistant' | 'Tool' | 'Build';
  content: string;
  toolLabel: string | null;
  createdDate: string;
  isError?: boolean;
  isPending?: boolean;
  feedback?: 'up' | 'down' | null;
  buildJobId?: string;
  build?: BuildJobView | null;
  /** The turn's tool calls (a specialist's own calls nested) — drawn as
   *  result cards under the reply. */
  toolCalls?: ChatToolCallSummary[];
  /** The page was left while this build ran — its progress lives on the
   *  New agent page now, not here. */
  buildInterrupted?: boolean;
}

// ── Copilot transport: a conversation that lives in this browser ──────
// Archon on the Home screen is not an agent record with sessions and a
// socket; it is the Architect's assistant, answered over Apex REST. Its
// transcript is kept per browser so leaving Home does not lose the thread.
const COPILOT_STORE_KEY = 'archon:home-copilot';
const COPILOT_KEEP_MESSAGES = 60;

interface CopilotTranscript {
  messages: DisplayMessage[];
  history: ChatHistoryEntry[];
}

function loadCopilotTranscript(): CopilotTranscript {
  try {
    const raw = localStorage.getItem(COPILOT_STORE_KEY);
    if (!raw) return { messages: [], history: [] };
    const parsed = JSON.parse(raw) as Partial<CopilotTranscript>;
    const messages = (Array.isArray(parsed.messages) ? parsed.messages : [])
      .filter(m => m && typeof m.id === 'string' && !m.isPending)
      .map(m =>
        m.role === 'Build' && m.build && (m.build.status === 'queued' || m.build.status === 'running')
          ? { ...m, buildInterrupted: true }
          : m,
      );
    return { messages, history: Array.isArray(parsed.history) ? parsed.history : [] };
  } catch {
    return { messages: [], history: [] };
  }
}

function saveCopilotTranscript(messages: DisplayMessage[], history: ChatHistoryEntry[]): void {
  try {
    const keep = messages.filter(m => !m.isPending).slice(-COPILOT_KEEP_MESSAGES);
    localStorage.setItem(COPILOT_STORE_KEY, JSON.stringify({ messages: keep, history: history.slice(-COPILOT_KEEP_MESSAGES) }));
  } catch {
    /* storage unavailable — the conversation lasts for this page only */
  }
}

function clearCopilotTranscript(): void {
  try {
    localStorage.removeItem(COPILOT_STORE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** What the copilot says once a build stops, so the person hears the
 *  outcome in the transcript and not only in the card. */
function describeBuildOutcome(view: BuildJobView): string {
  const done = view.steps.filter(s => s.state === 'done' || s.state === 'warn').length;
  if (view.status === 'done' && view.result) {
    const r = view.result;
    const prereqs = r.prerequisites.filter(p => p.blocking).length;
    const bits = [
      `The Architect has built **${r.apiName}** as a ${r.shape} and saved it as ${r.status}.`,
      r.summarySteps.length ? `It works like this: ${r.summarySteps.join(' → ')}.` : '',
      prereqs
        ? `${prereqs} blocking prerequisite${prereqs === 1 ? '' : 's'} need${prereqs === 1 ? 's' : ''} someone in your org before it can go live.`
        : 'Nothing in your org stands in its way.',
      `About $${r.estimate.costPerRunUsd.toFixed(3)} per run, roughly ${r.estimate.latencySeconds}s. Open it from the card above to review and activate.`,
    ];
    return bits.filter(Boolean).join(' ');
  }
  if (view.status === 'paused') {
    return `The build paused at its $${view.maxCostUsd.toFixed(2)} cost ceiling after ${done} of ${view.steps.length} stages — everything finished is saved. Continue it from the New agent page with Resume.`;
  }
  return `The build stopped after ${done} of ${view.steps.length} stages: ${view.error ?? 'unknown error'}. Nothing was created.`;
}

function toDisplay(m: RawChatMessage): DisplayMessage | null {
  if (m.Role__c === 'System') return null;
  let toolLabel: string | null = null;
  if (m.Role__c === 'Tool') {
    try {
      toolLabel = (JSON.parse(m.ToolCallsJson__c || '{}').name as string) ?? 'tool';
    } catch {
      toolLabel = 'tool';
    }
  }
  return {
    id: m.Id,
    role: m.Role__c as 'User' | 'Assistant' | 'Tool',
    content: m.Content__c ?? '',
    toolLabel,
    createdDate: m.CreatedDate,
    feedback: m.Feedback__c === 'up' || m.Feedback__c === 'down' ? m.Feedback__c : null,
  };
}

/** Stored Tool rows carry the whole call (ToolResultsJson__c, nested calls
 *  included); reopening a conversation draws the same cards under the reply
 *  that followed them, and the raw Tool rows drop out of the transcript. A
 *  Tool row that fails to parse stays as it was. */
function foldToolRows(display: DisplayMessage[], raw: RawChatMessage[]): DisplayMessage[] {
  const rawById = new Map(raw.map(m => [m.Id, m]));
  const out: DisplayMessage[] = [];
  let pending: ChatToolCallSummary[] = [];
  for (const m of display) {
    if (m.role === 'Tool') {
      const json = rawById.get(m.id)?.ToolResultsJson__c;
      let call: ChatToolCallSummary | null = null;
      try { const c = json ? (JSON.parse(json) as ChatToolCallSummary) : null; if (c && typeof c.name === 'string') call = c; } catch { /* keep the row */ }
      if (call) { pending.push(call); continue; }
      out.push(m);
      continue;
    }
    if (m.role === 'Assistant' && pending.length) { out.push({ ...m, toolCalls: pending }); pending = []; continue; }
    out.push(m);
  }
  return out;
}

export interface ChatPanelProps {
  agentApiName: string;
  agentName: string;
  /** 'overlay' (default): the 420px slide-over card (canvas test chat).
   *  'full': fills its container — the Chat page's main area — with the
   *  transcript centered in a readable column. */
  variant?: 'overlay' | 'full';
  /** Resume a past conversation instead of starting a new one. */
  initialSessionId?: string | null;
  onClose: () => void;
  /** Fired after each successful turn and on end — lets a parent sidebar
   *  refresh its session list, mirroring the old LWC's `sessionchange`. */
  onSessionChange?: (info: { sessionId: string | null; ended: boolean }) => void;
  /** Narration of each turn as it happens — what the full-page console
   *  reads. Optional: the side-panel variant has no console and passes
   *  nothing. */
  onActivity?: (e: ChatActivity) => void;
  /** Sent as the first turn as soon as the socket is open — the Home page
   *  hands the panel the message it captured before opening it. */
  initialMessage?: { text: string; how: 'talk' | 'type' } | null;
  /** 'session' (default): a portal agent — Apex session + WebSocket.
   *  'copilot': Archon itself on the Home screen — the Architect's
   *  assistant over Apex REST, no session, transcript kept per browser,
   *  and "build me an agent" runs the Architect with its stages drawn here. */
  transport?: 'session' | 'copilot';
  /** Copilot only: the dashboard's numbers at the moment of asking, so the
   *  answer matches what is on screen. */
  copilotPlatform?: () => Record<string, unknown> | null;
  /** Replaces the header subtitle while set — the Home page's auto-return
   *  countdown, for instance. */
  headerNote?: string | null;
  /** The agent called transfer_to_agent: the host switches the conversation
   *  to that agent, carrying the message. */
  onTransfer?: (t: { agentApiName: string; agentName: string; message: string }) => void;
}

/** Platform tools that report an Architect build job in their result — the
 *  panel draws the build card and follows the job for each of them. */
const BUILD_TOOLS = new Set(['analyze_requirement', 'inspect_org', 'find_gaps', 'design_agent', 'write_instructions', 'review_design', 'save_agent', 'resume_build', 'get_build_status']);
const jobIdIn = (output: string): string | null => /"jobId"\s*:\s*"([^"]+)"/.exec(output)?.[1] ?? null;

export function ChatPanel({
  agentApiName, agentName, variant = 'overlay', initialSessionId, onClose, onSessionChange, onActivity, initialMessage,
  transport = 'session', copilotPlatform, headerNote, onTransfer,
}: ChatPanelProps) {
  const isFull = variant === 'full';
  const isCopilot = transport === 'copilot';
  const copilotPlatformRef = useRef(copilotPlatform);
  useEffect(() => { copilotPlatformRef.current = copilotPlatform; }, [copilotPlatform]);
  const buildPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  // The copilot's async replies land through the same result handler the
  // socket uses; a ref keeps the build poll loop off its dependency chain.
  const handleTurnResultRef = useRef<(r: ChatTurnResult) => void>(() => {});
  const onTransferRef = useRef(onTransfer);
  useEffect(() => { onTransferRef.current = onTransfer; }, [onTransfer]);
  // Builds started by the agent's own tools: one card per build, its job id
  // moving forward as each stage tool resumes the job under a new id.
  const toolBuildsRef = useRef<{ jobs: Set<string>; seen: Record<string, Record<string, string>>; lastMessageId: string | null }>({ jobs: new Set(), seen: {}, lastMessageId: null });
  const pendingTransferRef = useRef<{ agentApiName: string; agentName: string; message: string } | null>(null);
  useEffect(
    () => () => {
      unmountedRef.current = true;
      if (buildPollRef.current) clearTimeout(buildPollRef.current);
    },
    [],
  );
  const [session, setSession] = useState<RawChatSession | null>(null);
  // The copilot restores the thread this browser kept and is ready at
  // once; a session-backed chat starts empty and loads.
  const [restored] = useState<CopilotTranscript>(() => (isCopilot ? loadCopilotTranscript() : { messages: [], history: [] }));
  const [messages, setMessages] = useState<DisplayMessage[]>(restored.messages);
  const [loading, setLoading] = useState(!isCopilot);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  // 'closed' is the idle state after the server hung up (it does after a
  // quiet spell): nothing is wrong, the next send reopens the socket.
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>(isCopilot ? 'open' : 'connecting');
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  // ── Voice: answer in kind ─────────────────────────────────────────
  // No modes. Whether THIS turn came in by voice is remembered per turn
  // and decides whether the reply is read aloud; the sound preference can
  // override either way. Refs, because the WebSocket handler is created
  // once at bootstrap and must always see the current values.
  const [sound, setSound] = useState<SoundPref>(getSoundPref);
  const soundRef = useRef<SoundPref>(sound);
  useEffect(() => { soundRef.current = sound; }, [sound]);
  const speaking = useSpeaking();
  const lastInputVoiceRef = useRef(false);
  const turnVoiceRef = useRef(false);
  const sendRef = useRef<() => void>(() => {});
  const autoSendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onActivityRef = useRef(onActivity);
  useEffect(() => { onActivityRef.current = onActivity; }, [onActivity]);
  const emit = useCallback((e: ChatActivityInput) => {
    onActivityRef.current?.({ ...e, at: Date.now() } as ChatActivity);
  }, []);
  const turnStartRef = useRef(0);
  const initialSentRef = useRef(false);
  const pendingSendRef = useRef<string | null>(null);
  const [voiceSupported] = useState(
    () => typeof window !== 'undefined' && !!(window.SpeechRecognition ?? window.webkitSpeechRecognition)
  );

  const [gate, setGate] = useState<ConnectionGate>({ accessMode: 'Org', connected: true, accountEmail: null });
  const [connectPolling, setConnectPolling] = useState(false);
  // Suspended agent actions for THIS session (approval-as-suspension) —
  // rendered as inline decision cards in the transcript.
  const [approvals, setApprovals] = useState<ChatApproval[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const historyRef = useRef<ChatHistoryEntry[]>(restored.history);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<InstanceType<NonNullable<Window['SpeechRecognition']>> | null>(null);
  const gatePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Guards against the bootstrap effect re-running just because
  // `initialSessionId` changed as a *side effect* of our own
  // onSessionChange callback firing after every turn. Without this,
  // completing a turn -> parent updates initialSessionId -> effect
  // re-fires -> startChatSession() re-runs -> setMessages(display)
  // wipes out the in-progress conversation (this was the bug: only
  // the first user message survived because every subsequent turn
  // triggered a silent remount-style reset).
  const bootstrappedForRef = useRef<string | null>(null);
  // Read by the unmount cleanup, which must see the CURRENT session and
  // whether anything was ever said — a closure would capture mount-time
  // values and discard a session that has since filled up.
  const sessionRef = useRef<RawChatSession | null>(null);
  const hasContentRef = useRef(false);
  // Tracks the last session id we told the parent about, so we only
  // call onSessionChange when it actually changes rather than on
  // every completed turn.
  const lastReportedSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    // Sticky: once a conversation has content it is never discardable, even
    // if the transcript is cleared from view afterwards.
    if (messages.length > 0 || historyRef.current.length > 0) hasContentRef.current = true;
  }, [messages]);

  /** Drop the session if the chat is being closed without a single message.
   *  Safe to call blind — the server ignores anything that has content. */
  const discardIfNeverUsed = useCallback(() => {
    const current = sessionRef.current;
    if (!current || hasContentRef.current) return;
    sessionRef.current = null;
    discardChatSessionIfEmpty(current.Id).catch(() => {
      /* best effort — listMySessions filters empty sessions out regardless */
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  }, []);

  const reportSessionChange = useCallback(
    (info: { sessionId: string | null; ended: boolean }) => {
      if (!info.ended && info.sessionId === lastReportedSessionIdRef.current) {
        console.log('[ChatPanel] reportSessionChange skipped (unchanged)', info);
        return;
      }
      console.log('[ChatPanel] reportSessionChange firing', {
        from: lastReportedSessionIdRef.current,
        to: info.sessionId,
        ended: info.ended,
      });
      lastReportedSessionIdRef.current = info.sessionId;
      onSessionChange?.(info);
    },
    [onSessionChange]
  );

  // ── Access gate (PerUser agents) ────────────────────────────────
  const refreshGate = useCallback(() => {
    if (isCopilot) return; // Archon runs on the org connection Setup made; there is no per-user gate
    getConnectionGate(agentApiName)
      .then(g => setGate(g))
      .catch(() => setGate({ accessMode: 'Org', connected: true, accountEmail: null }));
  }, [agentApiName, isCopilot]);

  useEffect(() => {
    refreshGate();
  }, [refreshGate]);

  const handleConnectMyAccount = useCallback(() => {
    startMyConnection(window.location.href)
      .then(res => {
        window.open(res.authorizeUrl, 'archon_sf_oauth', 'width=620,height=720,scrollbars=yes');
        setConnectPolling(true);
        let tries = 0;
        if (gatePollRef.current) clearInterval(gatePollRef.current);
        gatePollRef.current = setInterval(() => {
          tries++;
          getConnectionGate(agentApiName).then(g => {
            setGate(g);
            if (g.connected || tries > 60) {
              if (gatePollRef.current) clearInterval(gatePollRef.current);
              setConnectPolling(false);
            }
          });
        }, 3000);
      })
      .catch(err => {
        console.error('Failed to start connection:', err);
        setConnectPolling(false);
      });
  }, [agentApiName]);

  // Approvals are additive UI — a fetch failure must never break the chat.
  const refreshApprovals = useCallback((sessionId: string) => {
    listChatApprovals({ sessionId })
      .then(rows => setApprovals(rows))
      .catch(() => { /* stay with what we have */ });
  }, []);

  // ── Send / receive ───────────────────────────────────────────────
  // Declared before the bootstrap effect below because that effect's
  // ws.onmessage handler references it — defining it after caused an
  // eslint(react-hooks/immutability) "accessed before it is declared"
  // error, since the effect closes over `handleTurnResult` before the
  // function statement is reached in source order.
  const handleTurnResult = useCallback(
    (result: ChatTurnResult) => {
      console.log('[ChatPanel] handleTurnResult received', result);
      // Preserve the user's optimistic/pending message in the UI by
      // unsetting its `isPending` flag instead of removing it entirely.
      // This keeps the user's turn visible while we append the assistant's reply.
      setMessages(list => {
        const next = list.map(m => (m.isPending ? { ...m, isPending: false } : m));
        console.log('[ChatPanel] cleared pending flag', { beforeLen: list.length, afterLen: next.length, next });
        return next;
      });

      if (result.status === 'complete' && result.assistantText != null) {
        // Tool RESULTS must survive into the next turn's history or the
        // model loses every record Id it just looked up — found live: turn
        // 1 finds the opportunity via soqlQuery, turn 2 queries WHERE
        // Id = '006...' (a hallucinated placeholder) because the real Id
        // existed only in a tool output that was never carried forward.
        // Appended to the assistant HISTORY entry only — historyRef is
        // what's sent to the model; the visible message list is separate.
        let toolContext = '';
        if (result.toolCalls && result.toolCalls.length > 0) {
          const summaries = result.toolCalls.slice(0, 6).map(tc => {
            const output = typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output ?? '');
            return `${tc.name}(${JSON.stringify(tc.input ?? {}).slice(0, 200)}) -> ${output.slice(0, 600)}`;
          });
          toolContext = `\n\n[Internal tool results from this turn — reuse exact Ids/values from here in later turns, never invent or truncate them:\n${summaries.join('\n')}]`;
        }
        historyRef.current = [
          ...historyRef.current,
          { role: 'assistant', content: result.assistantText + toolContext },
        ];
        setMessages(list => [
          ...list,
          {
            id: `assistant_${Date.now()}`,
            role: 'Assistant',
            content: result.assistantText ?? '',
            toolLabel: null,
            createdDate: new Date().toISOString(),
            toolCalls: result.toolCalls?.length ? result.toolCalls : undefined,
          },
        ]);
        // Answer in kind: aloud if this turn was spoken, unless the sound
        // preference says otherwise. When the reply finishes, the mic re-arms
        // if voice is on, so a spoken conversation keeps flowing.
        const spoke = turnVoiceRef.current;
        const aloud = soundRef.current === 'always' || (soundRef.current === 'auto' && spoke);
        // A specialist's own calls count too: the console shows the work, and
        // the Architect card follows a build the Agent Builder started.
        for (const tc of flattenCalls(result.toolCalls).filter(c => c.name !== 'read_artifact')) {
          const output = typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output ?? '');
          emit({
            kind: 'tool',
            name: tc.name,
            note: tc.isError ? 'failed' : output.includes('PENDING_APPROVAL') ? 'waiting for approval' : `${output.length} chars back`,
          });
          // A build tool reported a job: draw the Architect card and follow it.
          // The id is read from the text because a long result arrives as a
          // preview handle, and jobId is the first key either way.
          if (BUILD_TOOLS.has(tc.name) && !tc.isError) {
            const jobId = jobIdIn(output);
            if (jobId) {
              const req = (tc.input as { requirement?: unknown } | undefined)?.requirement;
              followToolBuild(jobId, tc.name === 'analyze_requirement', typeof req === 'string' ? req : null);
            }
          }
          if (tc.name === 'transfer_to_agent' && !tc.isError) {
            const m = /"agentApiName"\s*:\s*"([^"]+)"[\s\S]*?"agentName"\s*:\s*"([^"]*)"[\s\S]*?"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(output);
            if (m) pendingTransferRef.current = { agentApiName: m[1], agentName: m[2] || m[1], message: JSON.parse(`"${m[3]}"`) };
          }
        }
        emit({
          kind: 'reply',
          text: result.assistantText,
          aloud,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          model: result.modelUsed,
          latencyMs: turnStartRef.current ? Date.now() - turnStartRef.current : undefined,
        });
        // The agent handed the conversation over: let the reply land, then
        // the host switches agents with the message carried across.
        if (pendingTransferRef.current) {
          const t = pendingTransferRef.current;
          pendingTransferRef.current = null;
          emit({ kind: 'sys', text: `Transferring to ${t.agentName}.` });
          setTimeout(() => onTransferRef.current?.(t), 700);
        }
        const rearm = () => {
          if (!getVoicePref()) return;
          try { recognitionRef.current?.start(); } catch { /* not allowed, or already on */ }
        };
        if (aloud) void speak(speakable(result.assistantText)).then(rearm);
        else if (spoke) rearm();
      } else {
        const errText = result.message ?? result.error ?? 'Unknown error';
        emit({ kind: 'error', text: errText });
        setMessages(list => [
          ...list,
          {
            id: `error_${Date.now()}`,
            role: 'Assistant',
            content: '⚠ ' + errText,
            toolLabel: null,
            createdDate: new Date().toISOString(),
            isError: true,
          },
        ]);
      }
      // A tool result saying PENDING_APPROVAL means the runtime suspended
      // an action this turn — pull the fresh card(s) for this session.
      const suspended = (result.toolCalls ?? []).some(tc => {
        const output = typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output ?? '');
        return output.includes('PENDING_APPROVAL');
      });
      if (suspended && session) refreshApprovals(session.Id);
      if (suspended) emit({ kind: 'approval' });
      setSending(false);
      scrollToBottom();
      if (session) reportSessionChange({ sessionId: session.Id, ended: false });
      console.log('[ChatPanel] handleTurnResult done', { sessionId: session?.Id });
    },
    [session, reportSessionChange, scrollToBottom, refreshApprovals, emit]
  );
  useEffect(() => { handleTurnResultRef.current = handleTurnResult; }, [handleTurnResult]);

  // ── Bootstrap: load/start session, open WS ──────────────────────
  useEffect(() => {
    // Only (re)bootstrap when we're switching to a genuinely different
    // agent/session than the one we already loaded. This intentionally
    // does NOT re-run just because initialSessionId flips from null to
    // a real id after our own onSessionChange call — see refs above.
    const bootstrapKey = isCopilot ? 'copilot' : `${agentApiName}::${initialSessionId ?? ''}`;
    console.log('[ChatPanel] bootstrap effect ran', {
      bootstrapKey,
      previousKey: bootstrappedForRef.current,
      willSkip: bootstrappedForRef.current === bootstrapKey,
    });
    if (bootstrappedForRef.current === bootstrapKey) return;
    bootstrappedForRef.current = bootstrapKey;

    if (isCopilot) {
      // No session, no socket: the thread this browser kept was restored
      // at mount, and the panel is ready as soon as it is on screen.
      emit({ kind: 'sys', text: 'Archon ready — ask about the platform or your org, or describe an agent to build.' });
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    console.log('[ChatPanel] calling startChatSession', { agentApiName, initialSessionId });
    startChatSession(agentApiName, initialSessionId ?? null, null)
      .then(result => {
        if (cancelled) return;
        console.log('[ChatPanel] startChatSession resolved', {
          sessionId: result.session.Id,
          messageCount: result.messages.length,
        });
        setSession(result.session);
        lastReportedSessionIdRef.current = result.session.Id;
        const display = foldToolRows(result.messages.map(toDisplay).filter((m): m is DisplayMessage => m != null), result.messages);
        setMessages(display);
        historyRef.current = result.messages
          .filter(m => m.Role__c !== 'System')
          .map(m => ({ role: m.Role__c.toLowerCase() as ChatHistoryEntry['role'], content: m.Content__c ?? '' }));
        setApprovals([]);
        refreshApprovals(result.session.Id);
        setLoading(false);
        scrollToBottom();

        setWsStatus('connecting');
        return openChatSocket(agentApiName, result.session.Id).then(ws => {
          if (cancelled) {
            ws.close();
            return;
          }
          socketRef.current = ws;
          ws.onopen = () => {
            console.log('[ChatPanel] websocket open');
            setWsStatus('open');
            emit({ kind: 'sys', text: `Connected to ${agentName}.` });
          };
          ws.onerror = e => {
            console.log('[ChatPanel] websocket error', e);
            setWsStatus('error');
          };
          ws.onclose = () => {
            console.log('[ChatPanel] websocket closed');
            setWsStatus(prev => (prev === 'open' ? 'closed' : prev));
          };
          ws.onmessage = ev => {
            console.log('[ChatPanel] websocket message received', ev.data);
            handleTurnResult(JSON.parse(ev.data) as ChatTurnResult);
          };
        });
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to start chat:', err);
        setLoadError(err instanceof Error ? err.message : 'Could not start chat.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
      socketRef.current?.close();
      socketRef.current = null;
      // Navigating away or switching agents counts as closing: a session
      // nobody ever spoke in leaves nothing worth keeping.
      discardIfNeverUsed();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentApiName, initialSessionId]);

  // ── Voice input ──────────────────────────────────────────────────
  useEffect(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    let baseText = '';
    recognition.onstart = () => {
      baseText = input;
      setIsRecording(true);
    };
    recognition.onresult = event => {
      // Hearing anything interrupts the agent, the way it would a person.
      stopSpeaking();
      let transcript = '';
      let sawFinal = false;
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
        if (event.results[i].isFinal) sawFinal = true;
      }
      lastInputVoiceRef.current = true;
      setInput((baseText + (baseText && !baseText.endsWith(' ') ? ' ' : '') + transcript).trimStart());
      // Send when the person pauses, so talking feels like talking rather
      // than dictating into a box and then hunting for the button.
      if (autoSendTimer.current) clearTimeout(autoSendTimer.current);
      if (sawFinal) {
        autoSendTimer.current = setTimeout(() => {
          try { recognition.stop(); } catch { /* already stopped */ }
          sendRef.current();
        }, 1200);
      }
    };
    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);
    recognitionRef.current = recognition;
    return () => {
      stopSpeaking();
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMicClick = useCallback(() => {
    const r = recognitionRef.current;
    if (!r) return;
    if (isRecording) {
      setVoicePref(false);
      try {
        r.stop();
      } catch {
        /* ignore */
      }
    } else {
      stopSpeaking();
      setVoicePref(true);
      try {
        r.start();
      } catch {
        console.warn('Could not start microphone.');
      }
    }
  }, [isRecording]);

  // Voice on by default, once chosen: arm the mic as soon as the panel is
  // ready. Browsers refuse to listen without a gesture on a fresh page, so
  // this can be declined — the strip then reads Ready and waits for a tap.
  useEffect(() => {
    if (wsStatus !== 'open' || (!session && !isCopilot) || !getVoicePref()) return;
    try { recognitionRef.current?.start(); } catch { /* declined — tap the mic */ }
  }, [wsStatus, session, isCopilot]);

  // The copilot's thread outlives this panel: every settled message is
  // written back so returning to Home picks up where it left off.
  useEffect(() => {
    if (!isCopilot) return;
    saveCopilotTranscript(messages, historyRef.current);
  }, [messages, isCopilot]);

  // ── Attachments ──────────────────────────────────────────────────
  const handleFilesPicked = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = '';
      if (!session) return;
      for (const file of files) {
        if (pendingAttachments.length >= MAX_ATTACHMENTS_PER_TURN) break;
        if (file.size > MAX_ATTACHMENT_BYTES) {
          toast.warning(`${file.name} exceeds the 5 MB limit.`);
          continue;
        }
        const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const isImage = /^image\//.test(file.type);
        const previewUrl = isImage ? URL.createObjectURL(file) : null;
        const entry: PendingAttachment = {
          id,
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          isImage,
          previewUrl,
          contentDocumentId: null,
          contentVersionId: null,
          fileExtension: (file.name.split('.').pop() ?? '').toLowerCase(),
          uploading: true,
        };
        setPendingAttachments(list => [...list, entry]);

        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
          uploadChatFile(session.Id, file.name, entry.mimeType, base64)
            .then(res => {
              setPendingAttachments(list =>
                list.map(a => (a.id === id ? { ...a, ...res, uploading: false } : a))
              );
            })
            .catch(err => {
              console.error('Upload failed:', err);
              setPendingAttachments(list => list.filter(a => a.id !== id));
              if (previewUrl) URL.revokeObjectURL(previewUrl);
            });
        };
        reader.readAsDataURL(file);
      }
    },
    [session, pendingAttachments.length]
  );

  const handleRemoveAttachment = useCallback((id: string) => {
    setPendingAttachments(list => {
      const att = list.find(a => a.id === id);
      if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
      return list.filter(a => a.id !== id);
    });
  }, []);

  const sendDisabled =
    sending ||
    wsStatus === 'connecting' ||
    (gate.accessMode === 'PerUser' && !gate.connected) ||
    pendingAttachments.some(a => a.uploading) ||
    (!input.trim() && pendingAttachments.length === 0);

  // ── Copilot: the Architect's assistant, and builds it starts ──────
  // The poll loop re-schedules itself through a ref, so the callback
  // never has to name itself before it exists.
  const pollBuildRef = useRef<(messageId: string, jobId: string, seen: Record<string, string>) => void>(() => {});
  const pollBuild = useCallback(
    (messageId: string, jobId: string, seen: Record<string, string>) => {
      getArchitectBuild(jobId)
        .then(view => {
          if (unmountedRef.current) return;
          // Narrate each stage the moment its state changes — the console
          // rail draws the pipeline from these, the card below from `view`.
          for (const s of view.steps) {
            const sig = `${s.state}|${s.detail ?? ''}`;
            if (seen[s.key] === sig) continue;
            seen[s.key] = sig;
            emit({ kind: 'step', label: s.label, state: s.state, detail: s.detail });
          }
          setMessages(list => list.map(m => (m.id === messageId ? { ...m, build: view } : m)));
          scrollToBottom();
          if (view.status === 'done' || view.status === 'failed' || view.status === 'paused') {
            const stageStop = view.status === 'paused' && /as asked/.test(String((view as { error?: string }).error ?? ''));
            emit({ kind: 'sys', text: view.status === 'done' ? 'Build finished.' : stageStop ? 'Stage finished — waiting for the next step.' : view.status === 'paused' ? 'Build paused at its cost ceiling.' : 'Build failed.' });
            // A build the agent drives through its tools narrates itself; only
            // the copilot's hand-off needs a synthetic reply here.
            if (!toolBuildsRef.current.jobs.has(jobId)) {
              handleTurnResultRef.current({ status: 'complete', assistantText: describeBuildOutcome(view), toolCalls: [] });
            }
            return;
          }
          buildPollRef.current = setTimeout(() => pollBuildRef.current(messageId, jobId, seen), 2500);
        })
        .catch(() => {
          // A transient read failure must not lose the build — keep polling.
          if (unmountedRef.current) return;
          buildPollRef.current = setTimeout(() => pollBuildRef.current(messageId, jobId, seen), 4000);
        });
    },
    [emit, scrollToBottom],
  );
  useEffect(() => { pollBuildRef.current = pollBuild; }, [pollBuild]);

  const followToolBuild = useCallback(
    (jobId: string, fresh: boolean, requirement: string | null) => {
      const st = toolBuildsRef.current;
      if (st.jobs.has(jobId)) return;
      st.jobs.add(jobId);
      st.seen[jobId] = {};
      let messageId = fresh ? null : st.lastMessageId;
      if (!messageId) {
        messageId = `build_${Date.now()}`;
        const id = messageId;
        setMessages(list => [
          ...list,
          { id, role: 'Build', content: requirement ?? 'Architect build', toolLabel: null, createdDate: new Date().toISOString(), build: null, buildJobId: jobId },
        ]);
      } else {
        const id = messageId;
        setMessages(list => list.map(m => (m.id === id ? { ...m, buildJobId: jobId } : m)));
      }
      st.lastMessageId = messageId;
      pollBuildRef.current(messageId, jobId, st.seen[jobId]);
    },
    [],
  );

  const startCopilotBuild = useCallback(
    (requirement: string) => {
      const id = `build_${Date.now()}`;
      setMessages(list => [
        ...list,
        { id, role: 'Build', content: requirement, toolLabel: null, createdDate: new Date().toISOString(), build: null },
      ]);
      emit({ kind: 'sys', text: 'Handing the requirement to the Architect.' });
      scrollToBottom();
      startArchitectBuild({ requirement })
        .then(jobId => {
          if (unmountedRef.current) return;
          setMessages(list => list.map(m => (m.id === id ? { ...m, buildJobId: jobId } : m)));
          pollBuild(id, jobId, {});
        })
        .catch(err => {
          if (unmountedRef.current) return;
          const msg = err instanceof Error ? err.message : 'The build could not start.';
          emit({ kind: 'error', text: msg });
          setMessages(list => list.map(m => (m.id === id ? { ...m, isError: true, content: `${requirement}\n\nCouldn't start the build: ${msg}` } : m)));
        });
    },
    [emit, pollBuild, scrollToBottom],
  );

  const runCopilotTurn = useCallback(
    (text: string) => {
      // The turn just sent is already the last history entry; the copilot
      // takes it as `message` and the rest as conversation.
      const history = historyRef.current
        .slice(0, -1)
        .filter(h => h.role === 'user' || h.role === 'assistant')
        .slice(-12)
        .map(h => ({ role: h.role as 'user' | 'assistant', content: h.content.slice(0, 4000) }));
      askArchon({ message: text, history, mode: 'home', platform: copilotPlatformRef.current?.() ?? undefined })
        .then(res => {
          if (unmountedRef.current) return;
          handleTurnResultRef.current({ status: 'complete', assistantText: res.reply, toolCalls: [] });
          if (res.action?.kind === 'build_agent') startCopilotBuild(res.action.requirement);
        })
        .catch(err => {
          if (unmountedRef.current) return;
          handleTurnResultRef.current({ status: 'error', message: err instanceof Error ? err.message : 'Archon could not answer that.' });
        });
    },
    [startCopilotBuild],
  );

  // Sends a turn over the socket, reopening it first when the server has
  // hung up on a quiet conversation. The ticket is single-use, so every
  // reopen mints a new one. Handlers mirror the ones set at bootstrap.
  const sendOverSocket = useCallback((payload: string): Promise<void> => {
    const live = socketRef.current;
    if (live && live.readyState === WebSocket.OPEN) { live.send(payload); return Promise.resolve(); }
    const sessionId = session?.Id ?? lastReportedSessionIdRef.current;
    if (!sessionId) return Promise.reject(new Error('No conversation to send to.'));
    setWsStatus('connecting');
    return openChatSocket(agentApiName, sessionId).then(ws => new Promise<void>((resolve, reject) => {
      socketRef.current = ws;
      ws.onopen = () => { setWsStatus('open'); emit({ kind: 'sys', text: `Reconnected to ${agentName}.` }); ws.send(payload); resolve(); };
      ws.onerror = () => { setWsStatus('error'); reject(new Error('Could not reconnect to the agent. Try again.')); };
      ws.onclose = () => setWsStatus(prev => (prev === 'open' ? 'closed' : prev));
      ws.onmessage = ev => handleTurnResultRef.current(JSON.parse(ev.data) as ChatTurnResult);
    }));
  }, [session, agentApiName, agentName, emit]);

  // The turn after an approved action ran. The runtime continues the
  // agent's work from the tool's result, so nobody has to type "continue".
  // No user bubble: the history entry carries the same text the server
  // runs on (server: chat/connector-scope.ts), so later turns read what
  // the model was given.
  const continueAfterApproval = useCallback((a: ChatApproval) => {
    if (isCopilot || sending) return;
    const resultText = (a.resultText ?? '').trim();
    setSending(true);
    turnVoiceRef.current = false;
    turnStartRef.current = Date.now();
    emit({ kind: 'sys', text: `Approved — ${a.toolName} ran. Continuing.` });
    emit({ kind: 'thinking' });
    historyRef.current = [...historyRef.current, { role: 'user', content: continuationText(a.toolName, resultText) }];
    sendOverSocket(JSON.stringify({ newUserMessage: '', history: historyRef.current.slice(0, -1), continuation: { toolName: a.toolName, resultText } }))
      .catch(err => handleTurnResultRef.current({ status: 'error', message: err instanceof Error ? err.message : 'Could not send.' }));
    scrollToBottom();
  }, [isCopilot, sending, emit, scrollToBottom, sendOverSocket]);

  const handleSend = useCallback(() => {
    if (sendDisabled || (!isCopilot && !session)) {
      console.log('[ChatPanel] handleSend blocked', { sendDisabled, hasSession: !!session });
      return;
    }
    const text = input.trim();
    console.log('[ChatPanel] handleSend called', { text, attachmentCount: pendingAttachments.length });
    const attachments: ChatAttachmentRef[] = pendingAttachments
      .filter(a => a.contentDocumentId && a.contentVersionId)
      .map(a => ({
        contentDocumentId: a.contentDocumentId!,
        contentVersionId: a.contentVersionId!,
        fileName: a.name,
        mimeType: a.mimeType,
        fileExtension: a.fileExtension,
      }));

    setInput('');
    const attachedThisTurn = pendingAttachments;
    setPendingAttachments([]);
    setSending(true);
    turnVoiceRef.current = lastInputVoiceRef.current;
    lastInputVoiceRef.current = false;
    turnStartRef.current = Date.now();
    emit({ kind: 'user', text: text || `(${attachments.length} attachment${attachments.length === 1 ? '' : 's'})`, how: turnVoiceRef.current ? 'talk' : 'type' });
    emit({ kind: 'thinking' });
    if (autoSendTimer.current) { clearTimeout(autoSendTimer.current); autoSendTimer.current = null; }

    setMessages(list => {
      const next = [
        ...list,
        {
          id: `pending_${Date.now()}`,
          role: 'User' as const,
          content: text || `[${attachedThisTurn.length} attachment${attachedThisTurn.length > 1 ? 's' : ''}]`,
          toolLabel: null,
          createdDate: new Date().toISOString(),
          isPending: true,
        },
      ];
      console.log('[ChatPanel] handleSend added pending user message', {
        prevLen: list.length,
        nextLen: next.length,
        added: next[next.length - 1],
      });
      return next;
    });
    scrollToBottom();

    historyRef.current = [...historyRef.current, { role: 'user', content: text }];
    if (isCopilot) {
      console.log('[ChatPanel] sending to the copilot', { text, historyLen: historyRef.current.length });
      runCopilotTurn(text);
    } else {
      console.log('[ChatPanel] sending over websocket', {
        text,
        historyLen: historyRef.current.length,
        attachments,
      });
      sendOverSocket(JSON.stringify({ newUserMessage: text, history: historyRef.current.slice(0, -1), attachments }))
        .catch(err => handleTurnResultRef.current({ status: 'error', message: err instanceof Error ? err.message : 'Could not send.' }));
    }

    for (const a of attachedThisTurn) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
  }, [sendDisabled, input, pendingAttachments, scrollToBottom, isCopilot, runCopilotTurn, session, sendOverSocket]);
  useEffect(() => { sendRef.current = handleSend; }, [handleSend]);
  // A card's button speaks for the person: the text goes into the box and
  // is sent on the render where it lands, never on a timer — the same path
  // the Home page's first message takes.
  const queueSend = useCallback((text: string) => {
    if (!text.trim()) return;
    lastInputVoiceRef.current = false;
    pendingSendRef.current = text;
    setInput(text);
  }, []);
  // The Home page's first message: queue it once the socket is open, then
  // send on the render where the input actually holds it — never on a timer.
  useEffect(() => {
    if (initialSentRef.current || !initialMessage?.text || wsStatus !== 'open' || (!session && !isCopilot)) return;
    initialSentRef.current = true;
    lastInputVoiceRef.current = initialMessage.how === 'talk';
    pendingSendRef.current = initialMessage.text;
    setInput(initialMessage.text);
  }, [initialMessage, wsStatus, session, isCopilot]);
  useEffect(() => {
    if (pendingSendRef.current != null && input === pendingSendRef.current) {
      pendingSendRef.current = null;
      sendRef.current();
    }
  }, [input]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  /** The X. An unused session is thrown away rather than left behind as an
   *  empty conversation; one with content is simply left open, exactly as
   *  before — closing the window is not the same as ending the chat. */
  const handleClose = useCallback(() => {
    if (sessionRef.current && !hasContentRef.current) {
      discardIfNeverUsed();
      reportSessionChange({ sessionId: null, ended: true });
    }
    onClose();
  }, [discardIfNeverUsed, reportSessionChange, onClose]);

  const handleEnd = useCallback(async () => {
    if (isCopilot) {
      const ok = await confirmDialog({
        title: 'Clear this conversation?',
        description: 'Archon starts fresh next time. A build already running keeps going on the New agent page.',
        confirmLabel: 'Clear',
        variant: 'destructive',
      });
      if (!ok) return;
      if (buildPollRef.current) clearTimeout(buildPollRef.current);
      clearCopilotTranscript();
      historyRef.current = [];
      setMessages([]);
      reportSessionChange({ sessionId: null, ended: true });
      onClose();
      return;
    }
    if (!session) return;
    const ok = await confirmDialog({
      title: 'End this chat?',
      description: 'You will start fresh next time — the conversation stays in your history.',
      confirmLabel: 'End chat',
      variant: 'destructive',
    });
    if (!ok) return;
    endChatSession(session.Id)
      .then(() => {
        reportSessionChange({ sessionId: null, ended: true });
        onClose();
      })
      .catch(err => {
        console.error('Could not end session:', err);
        toast.error('Could not end the session', { description: err instanceof Error ? err.message : undefined });
      });
  }, [session, reportSessionChange, onClose, isCopilot]);

  // Thumbs on an assistant reply. Clicking the same thumb again clears it.
  // Fresh WS replies have a client-generated id ('assistant_…') because
  // persistence happens server-side after the turn — the Apex action then
  // locates the record by exact content match instead.
  const handleFeedback = useCallback(
    (msg: DisplayMessage, value: 'up' | 'down') => {
      if (!session) return;
      const previous = msg.feedback ?? null;
      const next = previous === value ? '' : value;
      setMessages(list => list.map(x => (x.id === msg.id ? { ...x, feedback: next === '' ? null : next } : x)));
      const isRecordId = /^[a-zA-Z0-9]{15,18}$/.test(msg.id);
      sendMessageFeedback(session.Id, isRecordId ? msg.id : null, msg.content, next).catch(err => {
        console.error('Feedback failed:', err);
        setMessages(list => list.map(x => (x.id === msg.id ? { ...x, feedback: previous } : x)));
      });
    },
    [session]
  );

  const needsConnection = gate.accessMode === 'PerUser' && !gate.connected;
  const phase: VoicePhase = speaking ? 'speak' : sending ? 'think' : isRecording ? 'listen' : 'ready';
  useEffect(() => { emit({ kind: 'phase', phase }); }, [phase, emit]);

  return (
    <div
      className={
        isFull
          ? 'flex h-full w-full flex-col bg-card'
          : 'absolute inset-y-0 right-0 z-50 flex w-[420px] max-w-[92vw] flex-col border-l border-border bg-card shadow-2xl'
      }
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 items-center">
          <PhaseRing phase={phase} />
          <div className="min-w-0">
          <div className="truncate text-[13.5px] font-bold text-foreground">{agentName}</div>
          <div className={`text-[10.5px] ${headerNote ? 'text-[var(--archon-warning)]' : 'text-muted-foreground'}`}>
            {headerNote
              ? headerNote
              : isCopilot
                ? 'Copilot — knows this platform and your org'
                : wsStatus === 'open' ? 'Connected' : wsStatus === 'connecting' ? 'Connecting…' : wsStatus === 'closed' ? 'Ready — reconnects when you send' : 'Connection lost — retrying when you send'}
          </div>
        </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { const n = nextSoundPref(sound); setSoundPref(n); setSound(n); if (n === 'off') stopSpeaking(); }}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            title={SOUND_LABEL[sound]}
            aria-label={SOUND_LABEL[sound]}
          >
            {sound === 'off' ? <VolumeX className="h-4 w-4" /> : sound === 'always' ? <Volume2 className="h-4 w-4" /> : <Volume1 className="h-4 w-4" />}
          </button>
          {(session || (isCopilot && messages.length > 0)) && (
            <button type="button" onClick={handleEnd} className="text-[11px] text-muted-foreground hover:text-destructive">
              {isCopilot ? 'Clear' : 'End chat'}
            </button>
          )}
          <button type="button" onClick={handleClose} className="rounded-md p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={listRef}
        className={
          isFull
            ? 'flex-1 space-y-3 overflow-y-auto px-6 py-5'
            : 'flex-1 space-y-3 overflow-y-auto p-4'
        }
      >
        {loading && (
          <div className="flex items-center gap-2 py-6 text-[12.5px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting chat…
          </div>
        )}
        {loadError && <p className="text-[12.5px] text-destructive">{loadError}</p>}
        {!loading && !loadError && messages.length === 0 && (
          <p className="py-6 text-center text-[12px] text-muted-foreground">
            {isCopilot ? 'Ask what is happening on the platform, what your org can do, or describe an agent to build.' : 'Say hello to get started.'}
          </p>
        )}
        {messages.map(m => {
          if (m.role === 'Build') {
            return (
              <BuildWorkspace
                key={m.id}
                requirement={m.content}
                jobId={m.buildJobId}
                view={m.build ?? null}
                interrupted={m.buildInterrupted}
                isError={m.isError}
                onSend={queueSend}
              />
            );
          }
          if (m.role === 'Tool') {
            return (
              <div key={m.id} className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2">
                <Settings2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--node-amber)]" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold text-foreground">{m.toolLabel}</div>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[10.5px] text-muted-foreground">
                    {m.content}
                  </pre>
                </div>
              </div>
            );
          }
          const isUser = m.role === 'User';
          const time = m.createdDate
            ? new Date(m.createdDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '';
          return (
            <div key={m.id} className={isUser ? 'flex flex-col items-end' : 'flex flex-col items-start'}>
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-[12.5px] leading-relaxed ${
                  isUser
                    ? 'bg-primary text-primary-foreground'
                    : m.isError
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-muted text-foreground'
                }`}
              >
                {isUser ? (
                  <span className="whitespace-pre-wrap">{m.content}</span>
                ) : (
                  <div
                    className="prose-chat"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                  />
                )}
              </div>
              {!isUser && m.toolCalls?.length ? <ToolResultCards calls={m.toolCalls} /> : null}
              <div className="mt-1 flex items-center gap-1.5 px-1">
                {!isUser && !m.isError && !isCopilot && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleFeedback(m, 'up')}
                      aria-label="Good response"
                      className={`flex h-5 w-5 items-center justify-center rounded border ${
                        m.feedback === 'up'
                          ? 'border-[var(--archon-success)]/40 bg-[var(--archon-success)]/10 text-[var(--archon-success)]'
                          : 'border-border text-muted-foreground/60 hover:text-foreground'
                      }`}
                    >
                      <ThumbsUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFeedback(m, 'down')}
                      aria-label="Bad response"
                      className={`flex h-5 w-5 items-center justify-center rounded border ${
                        m.feedback === 'down'
                          ? 'border-destructive/40 bg-destructive/10 text-destructive'
                          : 'border-border text-muted-foreground/60 hover:text-foreground'
                      }`}
                    >
                      <ThumbsDown className="h-3 w-3" />
                    </button>
                  </>
                )}
                {time && <span className="text-[9.5px] text-muted-foreground/70">{time}</span>}
              </div>
            </div>
          );
        })}
        {approvals.map(a => (
          <ChatApprovalCard
            key={a.id}
            approval={a}
            onChanged={u => {
              setApprovals(list => list.map(x => (x.id === u.id ? u : x)));
              if (u.status === 'Executed') continueAfterApproval(u);
            }}
          />
        ))}
        {sending && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
          </div>
        )}
      </div>

      {needsConnection ? (
        <div className="border-t border-border p-4 text-center">
          <p className="mb-2 text-[12px] text-muted-foreground">
            This agent uses your own Salesforce access — connect your account to chat.
          </p>
          <Button size="sm" className="h-8 text-xs" onClick={handleConnectMyAccount} disabled={connectPolling}>
            {connectPolling && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
            {connectPolling ? 'Waiting for Salesforce…' : 'Connect my Salesforce'}
          </Button>
        </div>
      ) : (
        <div className={isFull ? 'border-t border-border px-6 py-3' : 'border-t border-border p-3'}>
          {pendingAttachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {pendingAttachments.map(a => (
                <div key={a.id} className="flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[10.5px]">
                  {a.uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
                  <span className="max-w-[100px] truncate">{a.name}</span>
                  <button type="button" onClick={() => handleRemoveAttachment(a.id)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <VoiceStrip phase={phase} voiceSupported={voiceSupported} />
          <div className="mt-2 flex items-end gap-1.5">
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilesPicked} />
            {!isCopilot && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || pendingAttachments.length >= MAX_ATTACHMENTS_PER_TURN}
                className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted disabled:opacity-40"
                aria-label="Attach file"
              >
                <Paperclip className="h-4 w-4" />
              </button>
            )}
            {voiceSupported && (
              <button
                type="button"
                onClick={handleMicClick}
                disabled={sending}
                className={`shrink-0 rounded-md p-2 hover:bg-muted disabled:opacity-40 ${isRecording ? 'chat-mic-on' : 'text-muted-foreground'}`}
                aria-label="Voice input"
              >
                {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            )}
            <textarea
              value={input}
              onChange={e => { lastInputVoiceRef.current = false; stopSpeaking(); setInput(e.target.value); }}
              onKeyDown={handleKeyDown}
              placeholder={voiceSupported ? 'Type here, or just talk…' : 'Type a message…'}
              rows={1}
              className="flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-[12.5px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <Button size="icon" className="h-9 w-9 shrink-0" onClick={handleSend} disabled={sendDisabled} aria-label="Send">
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-1.5 text-center text-[9.5px] text-muted-foreground/60">
            Responses are AI-generated and may be inaccurate.
          </p>
        </div>
      )}
    </div>
  );
}