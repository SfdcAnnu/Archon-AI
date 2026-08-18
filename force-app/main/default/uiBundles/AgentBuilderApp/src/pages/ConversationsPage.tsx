import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Loader2, Settings2 } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import {
  listMySessions,
  getSessionDetail,
  type SessionSummary,
  type SessionDetail,
} from '@/lib/conversations-data';

function statusPillStyle(status: string) {
  if (status === 'Active') return { backgroundColor: 'var(--archon-success-tint)', color: 'var(--archon-success)' };
  if (status === 'Expired') return { backgroundColor: 'var(--node-gray-tint)', color: 'var(--node-gray)' };
  return { backgroundColor: 'var(--node-gray-tint)', color: 'var(--node-gray)' };
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
            <pre className="max-h-64 overflow-auto rounded-md bg-muted/60 p-2 text-[10.5px] leading-snug">{requestPayload}</pre>
          )}
          {responsePayload && (
            <pre className="max-h-64 overflow-auto rounded-md bg-muted/60 p-2 text-[10.5px] leading-snug">{responsePayload}</pre>
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
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                  {m.Content__c}
                </pre>
              </div>
            </div>
          );
        }
        const hasTokens = m.TokensIn__c != null || m.TokensOut__c != null;
        return (
          <div key={m.Id}>
            <div className="flex items-baseline gap-2">
              <span className="text-[11.5px] font-semibold text-foreground">
                {m.Role__c === 'User' ? 'User' : 'Assistant'}
              </span>
              <span className="text-[10.5px] text-muted-foreground">
                {new Date(m.CreatedDate).toLocaleString()}
              </span>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground">{m.Content__c}</p>
            {hasTokens && (
              <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                {m.ModelUsed__c ? `${m.ModelUsed__c} · ` : ''}
                {m.TokensIn__c ?? 0} in / {m.TokensOut__c ?? 0} out
              </p>
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
  }, []);

  const openSession = useCallback((id: string) => {
    setSelectedId(id);
    setDetailLoadState('loading');
    getSessionDetail(id)
      .then(d => {
        setDetail(d);
        setDetailLoadState('ready');
      })
      .catch(err => {
        console.error('Failed to load session detail:', err);
        setDetailLoadState('error');
      });
  }, []);

  if (selectedId) {
    return (
      <AppShell>
        <div className="flex h-full w-full flex-col overflow-y-auto">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-5">
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Conversations
            </button>
          </header>
          <div className="mx-auto w-full max-w-2xl flex-1 p-6">
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
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h1 className="text-[16px] font-bold text-foreground">
                      {detail.session.Title__c || detail.session.Name}
                    </h1>
                    <p className="text-[12px] text-muted-foreground">
                      {detail.session['AgentDefinition__r.Name']}
                    </p>
                  </div>
                  <div className="text-right text-[11px] text-muted-foreground">
                    <span
                      className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                      style={statusPillStyle(detail.session.Status__c)}
                    >
                      {detail.session.Status__c}
                    </span>
                    <div className="mt-1">
                      {detail.session.TokensIn__c ?? 0} in / {detail.session.TokensOut__c ?? 0} out
                    </div>
                  </div>
                </div>
                <Transcript detail={detail} />
              </>
            )}
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex h-full w-full flex-col overflow-y-auto">
        <header className="flex h-14 shrink-0 items-center border-b border-border bg-card px-5">
          <span className="text-[14px] font-bold text-foreground">Conversations</span>
        </header>
        <div className="mx-auto w-full max-w-4xl flex-1 p-6">
          {loadState === 'loading' && (
            <div className="flex items-center gap-2 py-8 text-[12.5px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          )}
          {loadState === 'error' && (
            <p className="py-8 text-[12.5px] text-destructive">Couldn't load conversations.</p>
          )}
          {loadState === 'ready' && sessions.length === 0 && (
            <div className="rounded-lg border border-dashed border-border py-16 text-center">
              <p className="text-[13px] text-muted-foreground">No conversations yet.</p>
            </div>
          )}
          {loadState === 'ready' && sessions.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-[12.5px]">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-foreground">Agent</th>
                    <th className="px-3 py-2 text-left font-medium text-foreground">Title</th>
                    <th className="px-3 py-2 text-left font-medium text-foreground">Status</th>
                    <th className="px-3 py-2 text-left font-medium text-foreground">Turns</th>
                    <th className="px-3 py-2 text-left font-medium text-foreground">Tokens</th>
                    <th className="px-3 py-2 text-left font-medium text-foreground">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(s => (
                    <tr
                      key={s.id}
                      className="cursor-pointer border-t border-border hover:bg-muted/30"
                      onClick={() => openSession(s.id)}
                    >
                      <td className="px-3 py-2 font-medium text-foreground">{s.agentName}</td>
                      <td className="px-3 py-2 text-muted-foreground">{s.title || s.name}</td>
                      <td className="px-3 py-2">
                        <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={statusPillStyle(s.status)}>
                          {s.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{s.totalTurns ?? 0}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {(s.tokensIn ?? 0) + (s.tokensOut ?? 0)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {s.lastActivityAt ? new Date(s.lastActivityAt).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
