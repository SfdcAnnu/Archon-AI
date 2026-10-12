import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Loader2, MessageSquare, Send, Settings2, ShieldAlert, Undo2, UserRound } from 'lucide-react';
import { useHref, useSearchParams } from 'react-router';
import { getHandoffStatus, replyAsHuman, returnToAgent, type HandoffStatus } from '@/lib/handoff-data';
import { AppShell } from '@/components/shell/AppShell';
import { PageBody } from '@/components/shell/PageBody';
import { IconSquare, SpecCard, StatusBadge, T } from '@/components/spec/blocks';
import { cn } from '@/lib/utils';
import {
  listMySessions,
  getSessionDetail,
  parseModelUsage,
  type SessionSummary,
  type SessionDetail,
} from '@/lib/conversations-data';
import { listChatApprovals, type ChatApproval } from '@/lib/chat-approvals-data';
import { ChatApprovalCard } from '@/components/chat/ChatApprovalCard';

/** Approved spec screen 11 — "Who is talking to my agents?" One sessions
 *  table (Session · Agent · Messages · Tokens · Last activity — the spec's
 *  $ column stays out because dollars aren't tracked; real token totals
 *  are shown instead), and the same detail transcript as before: tool
 *  bubbles, raw request/response toggles, and chat-approval cards. */

function sessionTone(status: string): 'ok' | 'muted' | 'warn' {
  return status === 'Active' ? 'ok' : status === 'Handed off' ? 'warn' : 'muted';
}

/** A handed-off conversation: who has it, the way back to the agent, and
 *  the person's reply box when the customer is on WhatsApp. */
function HandoffBar({ sessionId, onChanged }: { sessionId: string; onChanged: () => void }) {
  const [st, setSt] = useState<HandoffStatus | null>(null);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState<'return' | 'reply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let alive = true;
    getHandoffStatus(sessionId).then(s => { if (alive) setSt(s); }).catch(err => { if (alive) setError(err instanceof Error ? err.message : String(err)); });
    return () => { alive = false; };
  }, [sessionId]);

  const giveBack = async () => {
    setBusy('return'); setError(null);
    try { await returnToAgent(sessionId, note); onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  };
  const send = async () => {
    const text = reply.trim();
    if (!text) return;
    setBusy('reply'); setError(null);
    try {
      const after = await replyAsHuman(sessionId, text);
      setReply('');
      if (!after.handedOff) onChanged();   // "/agent" gave it back
      else { setSt(after); onChanged(); }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  };

  if (!st) return error ? <p className="text-[12px] text-destructive">{error}</p> : null;
  if (!st.handedOff) return null;
  const since = st.handedOffAt ? new Date(st.handedOffAt).toLocaleString() : null;
  const back = st.returnAt ? new Date(st.returnAt).toLocaleString() : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--archon-warning)] bg-[var(--archon-warning-tint)] px-3.5 py-2.5">
        <UserRound className="h-4 w-4 shrink-0 text-[var(--archon-warning)]" />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold text-foreground">
            {st.assignee ? `${st.assignee} has this conversation.` : 'A person has this conversation.'}
            {st.reason && <span className="font-normal text-muted-foreground"> Reason: {st.reason}</span>}
          </div>
          <div className="text-[11px] text-muted-foreground">
            The agent is silent{since ? ` since ${since}` : ''}. It takes the conversation back
            {back ? ` at ${back} if nobody writes before then` : ` after ${st.quietHours} quiet hours`}, or now with the button.
          </div>
        </div>
        {asking ? (
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Anything the agent should know? (optional)"
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2.5 text-[12px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:w-72"
            />
            <button type="button" disabled={busy != null} onClick={giveBack} className="h-8 shrink-0 rounded-md bg-primary px-3 text-[12px] font-semibold text-primary-foreground disabled:opacity-50">
              {busy === 'return' ? 'Returning…' : 'Return now'}
            </button>
            <button type="button" onClick={() => setAsking(false)} className="h-8 shrink-0 rounded-md border border-border px-2.5 text-[12px]">Cancel</button>
          </div>
        ) : (
          <button type="button" onClick={() => setAsking(true)} className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-primary-foreground">
            <Undo2 className="h-3.5 w-3.5" /> Return to agent
          </button>
        )}
      </div>
      {st.canReply && (
        <div className="flex items-end gap-2 rounded-lg border border-border bg-card p-2">
          <textarea
            value={reply}
            onChange={e => setReply(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            rows={2}
            placeholder="Reply to the customer on WhatsApp as yourself… (type /agent to hand it back)"
            className="min-h-[52px] flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-[12.5px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <button type="button" disabled={busy != null || !reply.trim()} onClick={send} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50" aria-label="Send">
            {busy === 'reply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      )}
      {error && <p className="text-[12px] text-destructive">{error}</p>}
    </div>
  );
}

/** The audit a handoff System row carries (ChatSessionHandoffHandler). */
function handoffKind(toolCallsJson: string | null): 'handoff' | 'handoff_return' | null {
  if (!toolCallsJson) return null;
  try {
    const k = (JSON.parse(toolCallsJson) as { kind?: string }).kind;
    return k === 'handoff' || k === 'handoff_return' ? k : null;
  } catch { return null; }
}

function fmtMs(ms: number): string {
  if (ms < 950) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function extractToolName(toolCallsJson: string | null): string {
  if (!toolCallsJson) return 'tool';
  try {
    const parsed = JSON.parse(toolCallsJson);
    return parsed?.name ?? 'tool';
  } catch {
    return 'tool';
  }
}

function MessageDebugToggle({ requestPayload, responsePayload }: { requestPayload: string | null; responsePayload: string | null }) {
  const [open, setOpen] = useState(false);
  if (!requestPayload && !responsePayload) return null;
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        View raw request/response
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {requestPayload && (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[10.5px] leading-snug">{requestPayload}</pre>
          )}
          {responsePayload && (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[10.5px] leading-snug">{responsePayload}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function Transcript({ detail }: { detail: SessionDetail }) {
  return (
    <div className="space-y-3">
      {detail.messages.map(m => {
        if (m.Role__c === 'System') {
          // A handoff, or the way back: the line the person and the agent both read.
          const hk = handoffKind(m.ToolCallsJson__c);
          if (hk) {
            return (
              <div key={m.Id} className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                {hk === 'handoff' ? <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--archon-warning)]" /> : <Undo2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--archon-success)]" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] font-semibold text-foreground">{hk === 'handoff' ? 'Handed off to a person' : 'Back with the agent'}</div>
                  <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-foreground">{m.Content__c}</p>
                  <p className="mt-0.5 text-[10.5px] text-[var(--archon-faint)]">{new Date(m.CreatedDate).toLocaleString()}</p>
                </div>
              </div>
            );
          }
          // An approval decision written into the transcript: who, what, when.
          const isAudit = /"approvalId"/.test(m.ToolCallsJson__c ?? '');
          if (!isAudit) return null;
          return (
            <div key={m.Id} className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--archon-warning)]" />
              <div className="min-w-0 flex-1">
                <div className="text-[11.5px] font-semibold text-foreground">Approval decision</div>
                <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-foreground">{m.Content__c}</p>
                <p className="mt-0.5 text-[10.5px] text-[var(--archon-faint)]">{new Date(m.CreatedDate).toLocaleString()}</p>
              </div>
            </div>
          );
        }
        if (m.Role__c === 'Tool') {
          return (
            <div key={m.Id} className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2">
              <Settings2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--node-amber)]" />
              <div className="min-w-0 flex-1">
                <div className="text-[11.5px] font-semibold text-foreground">{extractToolName(m.ToolCallsJson__c)}</div>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
                  {m.Content__c}
                </pre>
              </div>
            </div>
          );
        }
        const hasTokens = m.TokensIn__c != null || m.TokensOut__c != null;
        // A turn can span several models; UsageJson__c is the real split,
        // ModelUsed__c only names whichever one produced the reply.
        const perModel = parseModelUsage(m.UsageJson__c);
        const multiModel = perModel.length > 1;
        const author = m['AuthorUser__r.Name'] ?? m.AuthorUser__r?.Name ?? null;
        return (
          <div key={m.Id}>
            <div className="flex items-baseline gap-2">
              <span className={cn('text-[11.5px] font-semibold', m.Role__c === 'Human' ? 'text-[var(--node-purple)]' : 'text-foreground')}>
                {m.Role__c === 'User' ? 'User' : m.Role__c === 'Human' ? `${author ?? 'A colleague'} (person)` : 'Assistant'}
              </span>
              <span className="text-[10.5px] text-[var(--archon-faint)]">
                {new Date(m.CreatedDate).toLocaleString()}
              </span>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground">{m.Content__c}</p>
            {hasTokens && (
              <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                {m.ModelUsed__c ? `${m.ModelUsed__c} · ` : ''}
                {m.TokensIn__c ?? 0} in / {m.TokensOut__c ?? 0} out
                {(m.CachedTokens__c ?? 0) > 0 && ` · ${m.CachedTokens__c} cached`}
                {m.LatencyMs__c != null && ` · ${fmtMs(m.LatencyMs__c)}`}
              </p>
            )}
            {multiModel && (
              <div className="mt-1 border-l-2 border-border pl-2">
                <p className="text-[10px] uppercase tracking-wide text-[var(--archon-faint)]">
                  Models used this turn
                </p>
                {perModel.map(u => (
                  <p key={u.model} className="font-mono text-[10.5px] text-muted-foreground">
                    {u.model} · {u.tokensIn} in / {u.tokensOut} out
                    {u.cacheRead > 0 && ` · ${u.cacheRead} cached`}
                    {u.stages?.length ? ` · ${u.stages.join(', ')}` : ''}
                  </p>
                ))}
              </div>
            )}
            <MessageDebugToggle requestPayload={m.RequestPayload__c} responsePayload={m.ResponsePayload__c} />
          </div>
        );
      })}
    </div>
  );
}

export default function ConversationsPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoadState, setDetailLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  // Chat approval-as-suspension: sessions with an action awaiting a human
  // get a chip in the list; the detail view renders the decision cards.
  const [pendingBySession, setPendingBySession] = useState<Set<string>>(new Set());
  const [detailApprovals, setDetailApprovals] = useState<ChatApproval[]>([]);

  useEffect(() => {
    listMySessions(50)
      .then(list => {
        setSessions(list);
        setLoadState('ready');
      })
      .catch(err => {
        console.error('Failed to load conversations:', err);
        setLoadState('error');
      });
    listChatApprovals({ status: 'Pending' })
      .then(rows => setPendingBySession(new Set(rows.map(r => r.sessionId))))
      .catch(() => { /* approvals are additive — never break the list */ });
  }, []);

  const traceBase = useHref('/trace/');
  // A notification or email about a handoff links straight to the conversation.
  const [params] = useSearchParams();
  const linkedSession = params.get('session');
  const openSession = useCallback((id: string) => {
    setSelectedId(id);
    setDetailLoadState('loading');
    setDetailApprovals([]);
    getSessionDetail(id)
      .then(d => {
        setDetail(d);
        setDetailLoadState('ready');
      })
      .catch(err => {
        console.error('Failed to load session detail:', err);
        setDetailLoadState('error');
      });
    listChatApprovals({ sessionId: id })
      .then(setDetailApprovals)
      .catch(() => { /* additive */ });
  }, []);

  useEffect(() => { if (linkedSession) openSession(linkedSession); }, [linkedSession, openSession]);

  // Keep the list chip honest as approvals get decided in the open detail.
  useEffect(() => {
    if (!selectedId) return;
    const hasPending = detailApprovals.some(a => a.status === 'Pending');
    setPendingBySession(prev => {
      if (prev.has(selectedId) === hasPending) return prev;
      const next = new Set(prev);
      if (hasPending) next.add(selectedId);
      else next.delete(selectedId);
      return next;
    });
  }, [detailApprovals, selectedId]);

  if (selectedId) {
    return (
      <AppShell title="Conversations">
        <PageBody width="wide">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="mb-3.5 flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All conversations
          </button>

          {detailLoadState === 'loading' && (
            <div className="flex items-center gap-2 py-8 text-[12.5px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          )}
          {detailLoadState === 'error' && (
            <p className="py-8 text-[12.5px] text-destructive">Couldn't load this conversation.</p>
          )}
          {detailLoadState === 'ready' && detail && (
            <>
              <SpecCard
                title={detail.session.Title__c || detail.session.Name}
                muted={detail.session['AgentDefinition__r.Name']}
                right={
                  <>
                    <span className="font-mono text-[10.5px] text-muted-foreground">
                      {detail.session.TokensIn__c ?? 0} in / {detail.session.TokensOut__c ?? 0} out
                      {(detail.session.CachedTokens__c ?? 0) > 0 &&
                        ` · ${detail.session.CachedTokens__c} cached`}
                      {(detail.session.LatencyMsTotal__c ?? 0) > 0 &&
                        (detail.session.TotalTurns__c ?? 0) > 0 &&
                        ` · ${fmtMs(detail.session.LatencyMsTotal__c! / detail.session.TotalTurns__c!)}/turn`}
                    </span>
                    <StatusBadge tone={sessionTone(detail.session.Status__c)}>
                      {detail.session.Status__c}
                    </StatusBadge>
                    <a
                      href={traceBase + detail.session.Id}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-[5px] border border-border bg-card px-2.5 py-[5px] text-[11.5px] font-semibold text-primary hover:bg-secondary/60"
                      title="Every turn's tool calls and payloads in full, in a new tab"
                    >
                      Full trace ↗
                    </a>
                  </>
                }
              >
                <div className="space-y-4 p-4">
                  {detail.session.Status__c === 'Handed off' && (
                    <HandoffBar sessionId={detail.session.Id} onChanged={() => openSession(detail.session.Id)} />
                  )}
                  <Transcript detail={detail} />
                </div>
              </SpecCard>

              {detailApprovals.length > 0 && (
                <SpecCard className="mt-3.5" title="Agent actions requiring approval">
                  <div className="space-y-3 p-3.5">
                    {detailApprovals.map(a => (
                      <ChatApprovalCard
                        key={a.id}
                        approval={a}
                        onChanged={u => setDetailApprovals(list => list.map(x => (x.id === u.id ? u : x)))}
                      />
                    ))}
                  </div>
                </SpecCard>
              )}
            </>
          )}
        </PageBody>
      </AppShell>
    );
  }

  return (
    <AppShell title="Conversations">
      <PageBody width="wide">
        {loadState === 'loading' && (
          <div className="flex items-center gap-2 py-8 text-[12.5px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        )}
        {loadState === 'error' && (
          <p className="py-8 text-[12.5px] text-destructive">Couldn't load conversations.</p>
        )}
        {loadState !== 'loading' && loadState !== 'error' && (
          <SpecCard title="Chat sessions" muted="people talking to your agents">
            {sessions.length === 0 ? (
              <p className="px-3.5 py-12 text-center text-[12.5px] text-muted-foreground">
                No conversations yet.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-b-lg">
                <table className={T.table}>
                  <thead>
                    <tr>
                      <th className={T.th}>Session</th>
                      <th className={T.th}>Agent</th>
                      {/* TotalTurns__c counts exchanges, not rows — a turn
                          also writes tool results. "Messages" read as a
                          row count and did not match the transcript. */}
                      <th className={cn(T.th, 'text-right')}>Turns</th>
                      <th className={cn(T.th, 'text-right')}>Tokens</th>
                      <th className={cn(T.th, 'text-right')}>Last activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map(s => (
                      <tr key={s.id} className={T.trClick} onClick={() => openSession(s.id)}>
                        <td className={T.td}>
                          <div className="flex items-center gap-2.5">
                            <IconSquare bg="var(--node-blue-tint)" color="var(--node-blue)" size={26}>
                              <MessageSquare className="h-3.5 w-3.5" />
                            </IconSquare>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[12px] font-semibold text-primary">
                                  {s.name}
                                </span>
                                <StatusBadge tone={sessionTone(s.status)}>{s.status}</StatusBadge>
                                {pendingBySession.has(s.id) && (
                                  <StatusBadge tone="warn">
                                    <ShieldAlert className="h-3 w-3" /> Needs approval
                                  </StatusBadge>
                                )}
                              </div>
                              {s.title && (
                                <div className="max-w-[36ch] truncate text-[10.5px] text-[var(--archon-faint)]">
                                  {s.title}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className={cn(T.td, 'text-muted-foreground')}>{s.agentName}</td>
                        <td className={cn(T.td, 'text-right font-mono')}>{s.totalTurns ?? 0}</td>
                        <td className={cn(T.td, 'text-right font-mono font-semibold')}>
                          {((s.tokensIn ?? 0) + (s.tokensOut ?? 0)).toLocaleString()}
                        </td>
                        <td className={cn(T.td, 'text-right font-mono text-[var(--archon-faint)]')}>
                          {s.lastActivityAt ? new Date(s.lastActivityAt).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SpecCard>
        )}
      </PageBody>
    </AppShell>
  );
}
