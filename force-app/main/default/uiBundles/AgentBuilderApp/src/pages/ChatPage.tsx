import { useCallback, useEffect, useState } from 'react';
import { useHref } from 'react-router';
import { Loader2, MessageSquarePlus, PanelLeft, PanelRight, Search } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Input } from '@/components/ui/input';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ConsoleRail } from '@/components/chat/ConsoleRail';
import type { ChatActivity } from '@/lib/chat-activity';
import { listChatEnabledAgents, type ChatAgentSummary } from '@/lib/chat-data';
import { listMySessions, type SessionSummary } from '@/lib/conversations-data';
import '@/styles/chat-page.css';

/**
 * The full-page chat, for every agent, in the same shape as the Home
 * copilot's focus screen: the console on the left (core ring, this turn,
 * the log), the conversation taking everything else. The list of recent
 * conversations is the entry point; once one is open it folds into a
 * drawer so the transcript has the screen.
 *
 * The console is a reading of events the ChatPanel emits, nothing more.
 * The panel is the same component the canvas test-chat and Home use;
 * giving it a narrator here rather than a second implementation is what
 * keeps the surfaces from drifting apart.
 */
const RAIL_PREF = 'archon.chat.console';

export default function ChatPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [agents, setAgents] = useState<ChatAgentSummary[]>([]);
  const [agentFilter, setAgentFilter] = useState('');
  const [agentsLoading, setAgentsLoading] = useState(false);

  const [active, setActive] = useState<{ sessionId: string | null; agentApiName: string; agentName: string } | null>(null);
  const [events, setEvents] = useState<ChatActivity[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const traceHref = useHref(`/trace/${liveSessionId ?? ''}`);
  const [rail, setRail] = useState<boolean>(() => {
    try { return localStorage.getItem(RAIL_PREF) !== 'off'; } catch { return true; }
  });
  const toggleRail = () => setRail(r => { try { localStorage.setItem(RAIL_PREF, r ? 'off' : 'on'); } catch { /* per-viewer nicety */ } return !r; });

  const refreshSessions = useCallback(() => {
    setSessionsLoading(true);
    listMySessions(30)
      .then(list => { setSessions(list); setSessionsLoading(false); })
      .catch(err => { console.error('Failed to load sessions:', err); setSessionsLoading(false); });
  }, []);
  useEffect(() => { refreshSessions(); }, [refreshSessions]);

  const openPicker = useCallback(() => {
    setShowPicker(true);
    setAgentsLoading(true);
    listChatEnabledAgents('')
      .then(list => { setAgents(list); setAgentsLoading(false); })
      .catch(err => { console.error('Failed to load agents:', err); setAgentsLoading(false); });
  }, []);
  useEffect(() => {
    if (!showPicker) return;
    const t = setTimeout(() => {
      listChatEnabledAgents(agentFilter).then(setAgents).catch(err => console.error('Failed to search agents:', err));
    }, 200);
    return () => clearTimeout(t);
  }, [agentFilter, showPicker]);

  const handlePickAgent = useCallback((agent: ChatAgentSummary) => {
    setShowPicker(false);
    setDrawer(false);
    setEvents([]);
    setLiveSessionId(null);
    setActive({ sessionId: null, agentApiName: agent.apiName, agentName: agent.name });
  }, []);
  const handlePickSession = useCallback((s: SessionSummary) => {
    setDrawer(false);
    setEvents([]);
    setLiveSessionId(s.id);
    setActive({ sessionId: s.id, agentApiName: s.agentApiName, agentName: s.agentName });
  }, []);
  const handleSessionChange = useCallback((info: { sessionId: string | null; ended: boolean }) => {
    if (info.ended) { setActive(null); setEvents([]); setLiveSessionId(null); }
    else if (info.sessionId) setLiveSessionId(info.sessionId);
    refreshSessions();
  }, [refreshSessions]);
  // The log is a window, not an archive: the last 200 events are plenty to
  // read a conversation back, and the transcript is the record.
  const handleActivity = useCallback((e: ChatActivity) => {
    setEvents(list => (list.length >= 200 ? [...list.slice(-199), e] : [...list, e]));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && drawer) setDrawer(false); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [drawer]);

  const list = (
    <>
      <div className="cp-list-hd">
        <span>Chat</span>
        <button type="button" onClick={openPicker} className="cp-icon" aria-label="New chat" title="New chat"><MessageSquarePlus /></button>
      </div>
      <div className="cp-list">
        {sessionsLoading && <div className="cp-muted"><Loader2 className="spin" /> Loading…</div>}
        {!sessionsLoading && sessions.length === 0 && <p className="cp-muted">No conversations yet — start a new chat.</p>}
        {sessions.map(s => (
          <button key={s.id} type="button" onClick={() => handlePickSession(s)} className={`cp-session${active?.sessionId === s.id ? ' on' : ''}`}>
            <div className="t">{s.title || s.agentName}</div>
            <div className="s">{s.agentName}{s.totalTurns ? ` · ${s.totalTurns} turns` : ''}{s.status !== 'Active' ? ` · ${s.status}` : ''}</div>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <AppShell title="Chat" hideRail={!!active}>
      <div className="cp" data-focus={active ? '1' : '0'} data-rail={rail ? '1' : '0'}>
        {/* ── no conversation open: the list and an invitation ────── */}
        {!active && (
          <div className="cp-home">
            <aside className="cp-side">{list}</aside>
            <div className="cp-empty">
              <p>Pick a conversation or start a new one — then type, or just talk.</p>
              <button type="button" onClick={openPicker} className="cp-primary">New chat</button>
            </div>
          </div>
        )}

        {/* ── a conversation open: the focus screen ───────────────── */}
        {active && (
          <div className="cp-focus">
            <div className="cp-strip">
              <button type="button" className="cp-icon" onClick={() => setDrawer(true)} aria-label="Conversations" title="Conversations"><PanelLeft /></button>
              <button type="button" className={`cp-icon${rail ? ' on' : ''}`} onClick={toggleRail} aria-label={rail ? 'Hide console' : 'Show console'} title={rail ? 'Hide console' : 'Show console'}><PanelRight /></button>
            </div>
            {rail && <ConsoleRail events={events} agentName={active.agentName} traceHref={liveSessionId ? traceHref : null} />}
            <div className="cp-chat">
              <ChatPanel
                key={active.sessionId ?? active.agentApiName}
                variant="full"
                agentApiName={active.agentApiName}
                agentName={active.agentName}
                initialSessionId={active.sessionId}
                onClose={() => setActive(null)}
                onSessionChange={handleSessionChange}
                onActivity={handleActivity}
              />
            </div>
            {drawer && (
              <>
                <div className="cp-scrim" onClick={() => setDrawer(false)} />
                <aside className="cp-side cp-drawer">{list}</aside>
              </>
            )}
          </div>
        )}

        {showPicker && (
          <>
            <div className="cp-scrim" onClick={() => setShowPicker(false)} />
            <div className="cp-picker">
              <div className="cp-list-hd"><span>Start a new chat</span></div>
              <div className="cp-search">
                <Search className="ico" />
                <Input className="h-8 pl-8 text-xs" placeholder="Search agents…" value={agentFilter} onChange={e => setAgentFilter(e.target.value)} autoFocus />
              </div>
              <div className="cp-list">
                {agentsLoading && <div className="cp-muted"><Loader2 className="spin" /> Loading…</div>}
                {!agentsLoading && agents.length === 0 && <p className="cp-muted">No chat-enabled agents found.</p>}
                {agents.map(a => (
                  <button key={a.apiName} type="button" onClick={() => handlePickAgent(a)} className="cp-session">
                    <div className="t">{a.name}</div>
                    <div className="s">{a.department}</div>
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
