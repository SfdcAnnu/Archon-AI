import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageSquarePlus, Search } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Input } from '@/components/ui/input';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { listChatEnabledAgents, type ChatAgentSummary } from '@/lib/chat-data';
import { listMySessions, type SessionSummary } from '@/lib/conversations-data';

/** Standalone chat surface — mirrors the old synapseChat tab: a left rail
 *  of recent sessions + a "New chat" agent picker, ChatPanel on the
 *  right for whichever session is active. Starts with no active session. */
export default function ChatPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [agents, setAgents] = useState<ChatAgentSummary[]>([]);
  const [agentFilter, setAgentFilter] = useState('');
  const [agentsLoading, setAgentsLoading] = useState(false);

  const [active, setActive] = useState<{ sessionId: string | null; agentApiName: string; agentName: string } | null>(null);

  const refreshSessions = useCallback(() => {
    setSessionsLoading(true);
    listMySessions(30)
      .then(list => {
        setSessions(list);
        setSessionsLoading(false);
      })
      .catch(err => {
        console.error('Failed to load sessions:', err);
        setSessionsLoading(false);
      });
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const openPicker = useCallback(() => {
    setShowPicker(true);
    setAgentsLoading(true);
    listChatEnabledAgents('')
      .then(list => {
        setAgents(list);
        setAgentsLoading(false);
      })
      .catch(err => {
        console.error('Failed to load agents:', err);
        setAgentsLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!showPicker) return;
    const t = setTimeout(() => {
      listChatEnabledAgents(agentFilter)
        .then(setAgents)
        .catch(err => console.error('Failed to search agents:', err));
    }, 200);
    return () => clearTimeout(t);
  }, [agentFilter, showPicker]);

  const handlePickAgent = useCallback((agent: ChatAgentSummary) => {
    setShowPicker(false);
    setActive({ sessionId: null, agentApiName: agent.apiName, agentName: agent.name });
  }, []);

  const handlePickSession = useCallback((s: SessionSummary) => {
    setActive({ sessionId: s.id, agentApiName: s.agentApiName, agentName: s.agentName });
  }, []);

  const handleSessionChange = useCallback(
    (info: { sessionId: string | null; ended: boolean }) => {
      if (info.ended) {
        setActive(null);
      }
      refreshSessions();
    },
    [refreshSessions]
  );

  return (
    <AppShell>
      <div className="relative flex h-full w-full">
        <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
            <span className="text-[13.5px] font-bold text-foreground">Chat</span>
            <button
              type="button"
              onClick={openPicker}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="New chat"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {sessionsLoading && (
              <div className="flex items-center gap-2 p-3 text-[11.5px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </div>
            )}
            {!sessionsLoading && sessions.length === 0 && (
              <p className="p-3 text-[11.5px] text-muted-foreground">No conversations yet — start a new chat.</p>
            )}
            {sessions.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => handlePickSession(s)}
                className={`mb-1 block w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                  active?.sessionId === s.id ? 'bg-accent' : 'hover:bg-muted'
                }`}
              >
                <div className="truncate text-[12px] font-medium text-foreground">{s.title || s.agentName}</div>
                <div className="truncate text-[10.5px] text-muted-foreground">
                  {s.agentName}
                  {s.totalTurns ? ` · ${s.totalTurns} turns` : ''}
                  {s.status !== 'Active' ? ` · ${s.status}` : ''}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {!active && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="text-[13px] text-muted-foreground">Pick a conversation or start a new one.</p>
              <button
                type="button"
                onClick={openPicker}
                className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground hover:opacity-90"
              >
                New chat
              </button>
            </div>
          )}
        </div>

        {active && (
          <ChatPanel
            key={active.sessionId ?? active.agentApiName}
            agentApiName={active.agentApiName}
            agentName={active.agentName}
            initialSessionId={active.sessionId}
            onClose={() => setActive(null)}
            onSessionChange={handleSessionChange}
          />
        )}

        {showPicker && (
          <>
            <div className="absolute inset-0 z-40 bg-black/20" onClick={() => setShowPicker(false)} />
            <div className="absolute inset-y-0 right-0 z-50 flex w-[380px] max-w-[92vw] flex-col border-l border-border bg-card shadow-2xl">
              <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
                <span className="text-[13.5px] font-bold text-foreground">Start a new chat</span>
              </div>
              <div className="border-b border-border p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-8 pl-8 text-xs"
                    placeholder="Search agents…"
                    value={agentFilter}
                    onChange={e => setAgentFilter(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {agentsLoading && (
                  <div className="flex items-center gap-2 p-3 text-[11.5px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                  </div>
                )}
                {!agentsLoading && agents.length === 0 && (
                  <p className="p-3 text-[11.5px] text-muted-foreground">No chat-enabled agents found.</p>
                )}
                {agents.map(a => (
                  <button
                    key={a.apiName}
                    type="button"
                    onClick={() => handlePickAgent(a)}
                    className="mb-1 block w-full rounded-lg px-2.5 py-2 text-left hover:bg-muted"
                  >
                    <div className="text-[12.5px] font-medium text-foreground">{a.name}</div>
                    <div className="text-[10.5px] text-muted-foreground">{a.department}</div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
