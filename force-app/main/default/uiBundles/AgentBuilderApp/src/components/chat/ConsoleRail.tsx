import { useEffect, useMemo, useRef } from 'react';
import type { ChatActivity, ChatPhase } from '@/lib/chat-activity';

/**
 * The console beside the full-page chat: the HUD's core ring, what this
 * turn is doing, and the running activity log. Purely a reading of the
 * activity stream the ChatPanel emits — it holds no chat state of its own,
 * so it can never disagree with the transcript.
 */

const PHASE_COPY: Record<ChatPhase, [string, string]> = {
  listen: ['LISTENING', 'just talk — or type'],
  think: ['WORKING', 'deciding what this needs'],
  speak: ['SPEAKING', 'reading the answer aloud'],
  ready: ['READY', 'type or talk'],
};

function fmtTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function ConsoleRail({ events, agentName }: { events: ChatActivity[]; agentName: string }) {
  // Everything below is derived from the stream, newest-wins.
  const view = useMemo(() => {
    let phase: ChatPhase = 'ready';
    let how: 'talk' | 'type' | null = null;
    let reply: Extract<ChatActivity, { kind: 'reply' }> | null = null;
    // the current turn = everything since the last 'user' event
    let turnStart = -1;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.kind === 'phase') phase = e.phase;
      if (e.kind === 'user') { how = e.how; turnStart = i; reply = null; }
      if (e.kind === 'reply') reply = e;
    }
    const turn = turnStart >= 0 ? events.slice(turnStart) : [];
    const sawThinking = turn.some(e => e.kind === 'thinking');
    const tools = turn.filter(e => e.kind === 'tool') as Extract<ChatActivity, { kind: 'tool' }>[];
    const sawReply = turn.some(e => e.kind === 'reply' || e.kind === 'error');
    const steps: Array<{ label: string; lines: string[]; state: 'off' | 'on' | 'done' }> = [
      { label: 'Router', lines: how ? [`heard by: ${how === 'talk' ? 'voice' : 'keyboard'}`] : [], state: !how ? 'off' : sawThinking ? 'done' : 'on' },
      { label: 'Tools', lines: tools.map(t => `${t.name}${t.note ? ' — ' + t.note : ''}`), state: tools.length ? (sawReply ? 'done' : 'on') : sawThinking && !sawReply ? 'on' : 'off' },
      { label: 'Reply', lines: reply ? [`tokens : ${reply.tokensIn ?? '—'} in · ${reply.tokensOut ?? '—'} out`, `latency : ${reply.latencyMs != null ? (reply.latencyMs / 1000).toFixed(1) + 's' : '—'}`] : [], state: reply ? 'done' : sawThinking ? 'on' : 'off' },
      { label: 'Voice', lines: reply ? [reply.aloud ? 'read aloud — you spoke' : 'text only — you typed'] : [], state: reply ? 'done' : 'off' },
    ];
    return { phase, how, reply, steps };
  }, [events]);

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events.length]);

  const [phaseName, phaseSub] = PHASE_COPY[view.phase];

  return (
    <aside className="con-rail" aria-label="Agent console">
      <div className="con-panel">
        <div className="con-core">
          <div className="con-ring" data-phase={view.phase}>
            <svg viewBox="0 0 150 150" aria-hidden="true">
              <circle className="con-arc a1" cx="75" cy="75" r="70" />
              <circle className="con-arc a2" cx="75" cy="75" r="60" />
              <circle className="con-arc a3" cx="75" cy="75" r="52" />
            </svg>
            <div className="con-disc">
              <div>
                <b>{phaseName}</b>
                <span>{phaseSub}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="con-tiles">
          <div className="con-tile"><div className="k">You asked by</div><div className={'v ' + (view.how === 'talk' ? 'g' : 'c')}>{view.how === 'talk' ? 'talking' : view.how === 'type' ? 'typing' : '—'}</div></div>
          <div className="con-tile"><div className="k">Reply</div><div className={'v ' + (view.reply?.aloud ? 'a' : '')}>{view.reply ? (view.reply.aloud ? 'text + speech' : 'text only') : '—'}</div></div>
          <div className="con-tile"><div className="k">Tokens</div><div className="v">{view.reply ? `${view.reply.tokensIn ?? '—'} / ${view.reply.tokensOut ?? '—'}` : '—'}</div></div>
          <div className="con-tile"><div className="k">Latency</div><div className="v">{view.reply?.latencyMs != null ? (view.reply.latencyMs / 1000).toFixed(1) + 's' : '—'}</div></div>
        </div>
      </div>

      <div className="con-panel">
        <div className="con-hd"><span className="con-eyebrow">This turn</span><span className="con-sub">what {agentName} is doing</span></div>
        <div className="con-steps">
          {view.steps.map(s => (
            <div key={s.label} className={'con-step ' + s.state}>
              <div className="t"><span className="dot">{s.state === 'done' ? '✓' : ''}</span>{s.label}</div>
              {s.lines.length > 0 && <pre>{s.lines.join('\n')}</pre>}
            </div>
          ))}
        </div>
      </div>

      <div className="con-panel con-grow">
        <div className="con-hd"><span className="con-eyebrow">Activity log</span><span className="con-sub">every step, as it happens</span></div>
        <div className="con-log" ref={logRef}>
          {events.length === 0 && <div className="sys">SYS: Console ready.</div>}
          {events.map((e, i) => {
            const t = fmtTime(e.at);
            switch (e.kind) {
              case 'sys': return <div key={i} className="sys">{t} SYS: {e.text}</div>;
              case 'user': return <div key={i} className="you">{t} You{e.how === 'talk' ? ' 🎙' : ''}: {e.text}</div>;
              case 'thinking': return <div key={i} className="sys">{t} SYS: Turn started.</div>;
              case 'tool': return <div key={i} className="sys">{t} TOOL: {e.name}{e.note ? ` · ${e.note}` : ''}</div>;
              case 'reply': return <div key={i} className="ai">{t} {agentName}: {e.text}{e.aloud ? ' 🔊' : ''}</div>;
              case 'approval': return <div key={i} className="ok">{t} SYS: An action is waiting for approval — nothing written yet.</div>;
              case 'error': return <div key={i} className="err">{t} ERR: {e.text}</div>;
              default: return null;
            }
          })}
        </div>
      </div>
    </aside>
  );
}
