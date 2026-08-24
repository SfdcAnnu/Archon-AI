import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, MicOff, Paperclip, Send, Settings2, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { renderMarkdown } from '@/lib/render-markdown';
import { openChatSocket, type ChatTurnResult, type ChatHistoryEntry, type ChatAttachmentRef } from '@/lib/ws-chat';
import {
  startChatSession,
  getConnectionGate,
  startMyConnection,
  uploadChatFile,
  endChatSession,
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
  role: 'User' | 'Assistant' | 'Tool';
  content: string;
  toolLabel: string | null;
  createdDate: string;
  isError?: boolean;
  isPending?: boolean;
  feedback?: 'up' | 'down' | null;
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

export interface ChatPanelProps {
  agentApiName: string;
  agentName: string;
  /** Resume a past conversation instead of starting a new one. */
  initialSessionId?: string | null;
  onClose: () => void;
  /** Fired after each successful turn and on end — lets a parent sidebar
   *  refresh its session list, mirroring the old LWC's `sessionchange`. */
  onSessionChange?: (info: { sessionId: string | null; ended: boolean }) => void;
}

export function ChatPanel({ agentApiName, agentName, initialSessionId, onClose, onSessionChange }: ChatPanelProps) {
  const [session, setSession] = useState<RawChatSession | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'error'>('connecting');
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceSupported] = useState(
    () => typeof window !== 'undefined' && !!(window.SpeechRecognition ?? window.webkitSpeechRecognition)
  );

  const [gate, setGate] = useState<ConnectionGate>({ accessMode: 'Org', connected: true, accountEmail: null });
  const [connectPolling, setConnectPolling] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const historyRef = useRef<ChatHistoryEntry[]>([]);
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
  // Tracks the last session id we told the parent about, so we only
  // call onSessionChange when it actually changes rather than on
  // every completed turn.
  const lastReportedSessionIdRef = useRef<string | null>(null);

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
    getConnectionGate(agentApiName)
      .then(g => setGate(g))
      .catch(() => setGate({ accessMode: 'Org', connected: true, accountEmail: null }));
  }, [agentApiName]);

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
          },
        ]);
      } else {
        const errText = result.message ?? result.error ?? 'Unknown error';
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
      setSending(false);
      scrollToBottom();
      if (session) reportSessionChange({ sessionId: session.Id, ended: false });
      console.log('[ChatPanel] handleTurnResult done', { sessionId: session?.Id });
    },
    [session, reportSessionChange, scrollToBottom]
  );

  // ── Bootstrap: load/start session, open WS ──────────────────────
  useEffect(() => {
    // Only (re)bootstrap when we're switching to a genuinely different
    // agent/session than the one we already loaded. This intentionally
    // does NOT re-run just because initialSessionId flips from null to
    // a real id after our own onSessionChange call — see refs above.
    const bootstrapKey = `${agentApiName}::${initialSessionId ?? ''}`;
    console.log('[ChatPanel] bootstrap effect ran', {
      bootstrapKey,
      previousKey: bootstrappedForRef.current,
      willSkip: bootstrappedForRef.current === bootstrapKey,
    });
    if (bootstrappedForRef.current === bootstrapKey) return;
    bootstrappedForRef.current = bootstrapKey;

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
        const display = result.messages.map(toDisplay).filter((m): m is DisplayMessage => m != null);
        setMessages(display);
        historyRef.current = result.messages
          .filter(m => m.Role__c !== 'System')
          .map(m => ({ role: m.Role__c.toLowerCase() as ChatHistoryEntry['role'], content: m.Content__c ?? '' }));
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
          };
          ws.onerror = e => {
            console.log('[ChatPanel] websocket error', e);
            setWsStatus('error');
          };
          ws.onclose = () => {
            console.log('[ChatPanel] websocket closed');
            setWsStatus(prev => (prev === 'open' ? 'error' : prev));
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
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      setInput((baseText + (baseText && !baseText.endsWith(' ') ? ' ' : '') + transcript).trimStart());
    };
    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);
    recognitionRef.current = recognition;
    return () => {
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
      try {
        r.stop();
      } catch {
        /* ignore */
      }
    } else {
      try {
        r.start();
      } catch {
        console.warn('Could not start microphone.');
      }
    }
  }, [isRecording]);

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
    wsStatus !== 'open' ||
    (gate.accessMode === 'PerUser' && !gate.connected) ||
    pendingAttachments.some(a => a.uploading) ||
    (!input.trim() && pendingAttachments.length === 0);

  const handleSend = useCallback(() => {
    if (sendDisabled || !socketRef.current) {
      console.log('[ChatPanel] handleSend blocked', { sendDisabled, hasSocket: !!socketRef.current });
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
    console.log('[ChatPanel] sending over websocket', {
      text,
      historyLen: historyRef.current.length,
      attachments,
    });
    socketRef.current.send(
      JSON.stringify({ newUserMessage: text, history: historyRef.current.slice(0, -1), attachments })
    );

    for (const a of attachedThisTurn) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
  }, [sendDisabled, input, pendingAttachments, scrollToBottom]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleEnd = useCallback(async () => {
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
  }, [session, reportSessionChange, onClose]);

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

  return (
    <div className="absolute inset-y-0 right-0 z-50 flex w-[420px] max-w-[92vw] flex-col border-l border-border bg-card shadow-2xl">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-bold text-foreground">{agentName}</div>
          <div className="text-[10.5px] text-muted-foreground">
            {wsStatus === 'open' ? 'Connected' : wsStatus === 'connecting' ? 'Connecting…' : 'Connection error'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {session && (
            <button type="button" onClick={handleEnd} className="text-[11px] text-muted-foreground hover:text-destructive">
              End chat
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {loading && (
          <div className="flex items-center gap-2 py-6 text-[12.5px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting chat…
          </div>
        )}
        {loadError && <p className="text-[12.5px] text-destructive">{loadError}</p>}
        {!loading && !loadError && messages.length === 0 && (
          <p className="py-6 text-center text-[12px] text-muted-foreground">Say hello to get started.</p>
        )}
        {messages.map(m => {
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
              <div className="mt-1 flex items-center gap-1.5 px-1">
                {!isUser && !m.isError && (
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
        <div className="border-t border-border p-3">
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
          <div className="flex items-end gap-1.5">
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilesPicked} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || pendingAttachments.length >= MAX_ATTACHMENTS_PER_TURN}
              className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted disabled:opacity-40"
              aria-label="Attach file"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            {voiceSupported && (
              <button
                type="button"
                onClick={handleMicClick}
                disabled={sending}
                className={`shrink-0 rounded-md p-2 hover:bg-muted disabled:opacity-40 ${isRecording ? 'text-destructive' : 'text-muted-foreground'}`}
                aria-label="Voice input"
              >
                {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            )}
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message…"
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