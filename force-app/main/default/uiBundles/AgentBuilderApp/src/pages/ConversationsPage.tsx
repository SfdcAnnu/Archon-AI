import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Loader2, MessageSquare, Settings2, ShieldAlert } from 'lucide-react';
import { useHref } from 'react-router';
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

function sessionTone(status: string): 'ok' | 'muted' {
  return status === 'Active' ? 'ok' : 'muted';
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
        return (
          <div key={m.Id}>
            <div className="flex items-baseline gap-2">
              <span className="text-[11.5px] font-semibold text-foreground">
                {m.Role__c === 'User' ? 'User' : 'Assistant'}
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
                <div className="p-4">
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
