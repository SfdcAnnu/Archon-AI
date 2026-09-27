import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHref } from 'react-router';
import { ChevronDown, Loader2, PanelRight, Plus, Search } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ConsoleRail } from '@/components/chat/ConsoleRail';
import { SessionTranscript } from '@/components/chat/SessionTranscript';
import { AgentKindBadge } from '@/components/AgentKindBadge';
import type { ChatActivity } from '@/lib/chat-activity';
import { listChatEnabledAgents, type ChatAgentSummary } from '@/lib/chat-data';
import { loadAgents } from '@/lib/agents-data';
import { listMySessions, type SessionSummary } from '@/lib/conversations-data';
import { agentStats, formatLastTurn, groupSessionsByDay, initials, sessionsForAgent, sortAgentsForPicker } from '@/lib/chat-list';
import '@/styles/chat-page.css';

/**
 * The Chat page, agent first.
 *
 * Opening Chat asks who you want to talk to. Once an agent is chosen the
 * page belongs to it: the sidebar is that agent's conversations, newest
 * first, each with its status and the time of its last turn, with New
 * chat on top — the sidebar people know from Claude and ChatGPT, scoped
 * to one agent. The app's own navigation folds to its icon rail while an
 * agent is chosen so the conversation has the width.
 *
 * The live conversation is the same ChatPanel the canvas test-chat and
 * Home use, with the console rail as its narrator. An ended conversation
 * is read back as a transcript: the panel has no read-only mode and Apex
 * refuses a turn on an ended session, so a composer there could not send.
 */
const RAIL_PREF = 'archon.chat.console';
const AGENT_PREF = 'archon.chat.agent';

interface PickerAgent extends ChatAgentSummary {
  isSystem: boolean;
  status: string;
  executeType: string;
}

type Active =
  | { kind: 'live'; sessionId: string | null }
  | { kind: 'ended'; session: SessionSummary };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function ChatPage() {
  const [agents, setAgents] = useState<PickerAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [agent, setAgent] = useState<PickerAgent | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const [events, setEvents] = useState<ChatActivity[]>([]);
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const traceHref = useHref(`/trace/${liveSessionId ?? ''}`);
  const [rail, setRail] = useState<boolean>(() => {
    try { return localStorage.getItem(RAIL_PREF) !== 'off'; } catch { return true; }
  });
  const toggleRail = () => setRail(r => { try { localStorage.setItem(RAIL_PREF, r ? 'off' : 'on'); } catch { /* per-viewer nicety */ } return !r; });

  const refreshSessions = useCallback(() => {
    setSessionsLoading(true);
    listMySessions(200)
      .then(list => { setSessions(list); setSessionsLoading(false); })
      .catch(err => { console.error('Failed to load sessions:', err); setSessionsLoading(false); });
  }, []);
  // The chat endpoint says which agents can be chatted with; the agents
  // endpoint says which are built-in and what state they are in. Joined
  // here so the picker needs no new Apex.
  const refreshAgents = useCallback(() => {
    setAgentsLoading(true);
    Promise.all([listChatEnabledAgents(''), loadAgents().catch(() => [])])
      .then(([chat, all]) => {
        const byApi = new Map(all.map(a => [a.apiName, a]));
        setAgents(chat.map(a => ({ ...a, isSystem: byApi.get(a.apiName)?.isSystem ?? false, status: byApi.get(a.apiName)?.status ?? 'Active', executeType: byApi.get(a.apiName)?.executeType ?? 'Chat' })));
        setAgentsLoading(false);
      })
      .catch(err => { console.error('Failed to load agents:', err); setAgentsLoading(false); });
  }, []);
  useEffect(() => { refreshSessions(); refreshAgents(); }, [refreshSessions, refreshAgents]);

  // Come back to the agent you were talking to last time. A per-viewer
  // convenience: it lives in this browser and nowhere else.
  useEffect(() => {
    if (agent || agents.length === 0) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem(AGENT_PREF); } catch { /* fine */ }
    if (!saved) return;
    const found = agents.find(a => a.apiName === saved);
    if (found) setAgent(found);
  }, [agents, agent]);

  const stats = useMemo(() => agentStats(sessions), [sessions]);
  const picker = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const hit = q ? agents.filter(a => `${a.name} ${a.department} ${a.description ?? ''}`.toLowerCase().includes(q)) : agents;
    return sortAgentsForPicker(hit, stats);
  }, [agents, filter, stats]);
  const mine = useMemo(() => (agent ? sessionsForAgent(sessions, agent.apiName) : []), [sessions, agent]);
  const groups = useMemo(() => groupSessionsByDay(mine), [mine]);

  const pickAgent = useCallback((a: PickerAgent) => {
    setAgent(a); setActive(null); setEvents([]); setLiveSessionId(null);
    try { localStorage.setItem(AGENT_PREF, a.apiName); } catch { /* fine */ }
  }, []);
  const switchAgent = useCallback(() => {
    setAgent(null); setActive(null); setEvents([]); setLiveSessionId(null); setFilter('');
    try { localStorage.removeItem(AGENT_PREF); } catch { /* fine */ }
  }, []);
  const newChat = useCallback(() => {
    setEvents([]); setLiveSessionId(null); setActive({ kind: 'live', sessionId: null });
  }, []);
  const pickSession = useCallback((s: SessionSummary) => {
    setEvents([]);
    if (s.status === 'Active') { setLiveSessionId(s.id); setActive({ kind: 'live', sessionId: s.id }); }
    else { setLiveSessionId(null); setActive({ kind: 'ended', session: s }); }
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

  const activeSessionId =
    active?.kind === 'live' ? (liveSessionId ?? active.sessionId)
    : active?.kind === 'ended' ? active.session.id
    : null;

  return (
    <AppShell title="Chat" forceCollapsed={!!agent} onRefresh={() => { refreshSessions(); refreshAgents(); }}>
      <div className="cp">

        {/* ── 1 · who do you want to chat with? ─────────────────── */}
        {!agent && (
          <section className="cp-pick" aria-labelledby="cp-pick-title">
            <div className="cp-pick-hd">
              <h2 id="cp-pick-title">Who do you want to chat with?</h2>
              <p>Pick an agent. Its conversations and a new chat are one step away.</p>
            </div>
            <div className="cp-pick-search">
              <Search className="ico" aria-hidden="true" />
              <label htmlFor="cp-agent-search" className="sr-only">Search agents</label>
              <input id="cp-agent-search" type="search" placeholder="Search agents" value={filter} onChange={e => setFilter(e.target.value)} autoComplete="off" />
            </div>
            {agentsLoading && <div className="cp-muted"><Loader2 className="spin" /> Loading agents…</div>}
            {!agentsLoading && picker.length === 0 && (
              <p className="cp-muted">{filter ? 'No agent matches that.' : 'No chat-enabled agents yet.'}</p>
            )}
            <div className="cp-cards">
              {picker.map(a => {
                const st = stats.get(a.apiName);
                return (
                  <button key={a.apiName} type="button" className="cp-card" onClick={() => pickAgent(a)}>
                    <div className="cp-card-hd">
                      <div className="cp-avatar" aria-hidden="true">{initials(a.name)}</div>
                      <div className="who">
                        <div className="n">{a.name}</div>
                        <div className="d">{a.department}</div>
                      </div>
                      {a.isSystem ? <span className="cp-tag">Built-in</span> : <AgentKindBadge executeType={a.executeType} showLabel={false} />}
                    </div>
                    <p>{a.description || 'No description yet.'}</p>
                    <div className="cp-card-ft">
                      <span className={`cp-dot${a.status === 'Active' ? ' on' : ''}`} aria-hidden="true" />
                      {a.status}
                      <span className="r">
                        {st ? `${plural(st.count, 'chat')}${st.last ? ` · last ${formatLastTurn(st.last)}` : ''}` : 'No chats yet'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── 2 · an agent chosen: its chats, and the chat ───────── */}
        {agent && (
          <div className="cp-agent">
            <aside className="cp-side" aria-label={`Chats with ${agent.name}`}>
              <div className="cp-side-hd">
                <div className="cp-avatar" aria-hidden="true">{initials(agent.name)}</div>
                <div className="who">
                  <div className="n">{agent.name}</div>
                  <div className="d">{agent.department}{mine.length ? ` · ${plural(mine.length, 'chat')}` : ''}</div>
                </div>
                <button type="button" className="cp-switch" onClick={switchAgent} aria-label="Switch agent" title="Switch agent"><ChevronDown /></button>
              </div>
              <button type="button" className="cp-new" onClick={newChat}><Plus />New chat</button>
              <div className="cp-list">
                {sessionsLoading && mine.length === 0 && <div className="cp-muted"><Loader2 className="spin" /> Loading…</div>}
                {!sessionsLoading && mine.length === 0 && <p className="cp-muted">No chats with this agent yet.</p>}
                {groups.map(g => (
                  <div key={g.label}>
                    <div className="cp-group">{g.label}</div>
                    {g.sessions.map(s => {
                      const on = activeSessionId === s.id;
                      return (
                        <button key={s.id} type="button" className={`cp-session${on ? ' on' : ''}`} onClick={() => pickSession(s)} aria-current={on ? 'true' : undefined}>
                          <div className="row">
                            <span className="t">{s.title || 'New chat'}</span>
                            <span className="w">{formatLastTurn(s.lastActivityAt)}</span>
                          </div>
                          <div className="s">
                            <span className={`cp-dot${s.status === 'Active' ? ' on' : ''}`} aria-hidden="true" />
                            {s.status}
                            {s.totalTurns ? <><span>·</span><span>{plural(s.totalTurns, 'turn')}</span></> : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </aside>

            <div className="cp-main" data-rail={rail ? '1' : '0'}>
              {!active && (
                <div className="cp-empty">
                  <div className="cp-avatar" aria-hidden="true">{initials(agent.name)}</div>
                  <h2>{agent.name}</h2>
                  {agent.description && <p>{agent.description}</p>}
                  <p className="hint">Type or talk — both are live.</p>
                  <button type="button" className="cp-primary" onClick={newChat}><Plus />New chat</button>
                </div>
              )}

              {active?.kind === 'live' && (
                <div className="cp-focus">
                  <div className="cp-strip">
                    <button type="button" className={`cp-icon${rail ? ' on' : ''}`} onClick={toggleRail} aria-label={rail ? 'Hide console' : 'Show console'} title={rail ? 'Hide console' : 'Show console'}><PanelRight /></button>
                  </div>
                  {rail && <ConsoleRail events={events} agentName={agent.name} traceHref={liveSessionId ? traceHref : null} />}
                  <div className="cp-chat">
                    <ChatPanel
                      key={active.sessionId ?? `new:${agent.apiName}`}
                      variant="full"
                      agentApiName={agent.apiName}
                      agentName={agent.name}
                      initialSessionId={active.sessionId}
                      onClose={() => setActive(null)}
                      onSessionChange={handleSessionChange}
                      onActivity={handleActivity}
                    />
                  </div>
                </div>
              )}

              {active?.kind === 'ended' && (
                <SessionTranscript session={active.session} agentName={agent.name} onNewChat={newChat} />
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
