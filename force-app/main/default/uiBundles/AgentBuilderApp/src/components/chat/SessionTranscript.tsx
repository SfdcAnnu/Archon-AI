import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Loader2, Plus } from 'lucide-react';
import { getSessionDetail, type SessionDetail, type SessionSummary } from '@/lib/conversations-data';
import { formatLastTurn, initials } from '@/lib/chat-list';

/**
 * An ended conversation, read back. The live ChatPanel has no read-only
 * mode and Apex refuses a turn on an ended session, so opening one from
 * the sidebar shows the transcript as it was and offers a new chat with
 * the same agent instead of a composer that could not send.
 *
 * Tool rows are folded into one "N tools run" line ahead of the reply
 * they produced, closed until asked for — the same posture the live panel
 * takes with tool results.
 */
type Row = SessionDetail['messages'][number];

interface Block {
  key: string;
  kind: 'user' | 'agent';
  text: string;
  when: string;
  tools: Array<{ name: string; result: string | null }>;
}

function toolName(row: Row): string {
  try { return String(JSON.parse(row.ToolCallsJson__c || '{}').name ?? 'tool'); } catch { return 'tool'; }
}

function toolResult(row: Row): string | null {
  const raw = (row as { ToolResultsJson__c?: string | null }).ToolResultsJson__c ?? row.Content__c;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { output?: unknown };
    const out = typeof parsed.output === 'string' ? parsed.output : raw;
    return out.length > 240 ? out.slice(0, 240) + '…' : out;
  } catch {
    return raw.length > 240 ? raw.slice(0, 240) + '…' : raw;
  }
}

/** User and assistant turns in order; each run of tool rows attaches to
 *  the assistant reply that follows it. */
export function toBlocks(rows: Row[]): Block[] {
  const blocks: Block[] = [];
  let pending: Block['tools'] = [];
  for (const r of [...rows].sort((a, b) => a.SequenceNumber__c - b.SequenceNumber__c)) {
    if (r.Role__c === 'Tool') { pending.push({ name: toolName(r), result: toolResult(r) }); continue; }
    if (r.Role__c === 'System') continue;
    if (r.Role__c === 'User') {
      blocks.push({ key: r.Id, kind: 'user', text: r.Content__c ?? '', when: formatLastTurn(r.CreatedDate), tools: [] });
      continue;
    }
    blocks.push({ key: r.Id, kind: 'agent', text: r.Content__c ?? '', when: formatLastTurn(r.CreatedDate), tools: pending });
    pending = [];
  }
  return blocks;
}

export function SessionTranscript({ session, agentName, onNewChat }: {
  session: SessionSummary;
  agentName: string;
  onNewChat: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let alive = true;
    setRows(null); setError(null);
    getSessionDetail(session.id)
      .then(d => { if (alive) setRows(d.messages); })
      .catch(err => { if (alive) setError(err instanceof Error ? err.message : String(err)); });
    return () => { alive = false; };
  }, [session.id]);

  const blocks = useMemo(() => (rows ? toBlocks(rows) : []), [rows]);
  const toggle = (key: string) => setOpen(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const mark = initials(agentName);

  return (
    <>
      <header className="cp-ended-hd">
        <div className="who">
          <div className="n">{session.title || 'Chat'}</div>
          <div className="d">{agentName}</div>
        </div>
        <span className="cp-pill"><span className="cp-dot" />{session.status}</span>
        {session.lastActivityAt && <span className="cp-when">Last turn {formatLastTurn(session.lastActivityAt)}</span>}
      </header>

      <section className="cp-transcript" aria-label="Transcript">
        {rows === null && !error && <div className="cp-muted"><Loader2 className="spin" /> Loading the conversation…</div>}
        {error && <p className="cp-muted">This conversation could not be loaded: {error}</p>}
        {blocks.map(b => b.kind === 'user' ? (
          <div key={b.key} className="cp-msg user">
            <div className="txt">{b.text}</div>
            <div className="ts">{b.when}</div>
          </div>
        ) : (
          <div key={b.key} className="cp-msg agent">
            <div className="cp-avatar" aria-hidden="true">{mark}</div>
            <div className="body">
              {b.text && <div className="txt">{b.text}</div>}
              {b.tools.length > 0 && (
                <>
                  <button type="button" className="cp-tools" aria-expanded={open.has(b.key)} onClick={() => toggle(b.key)}>
                    <ChevronRight />
                    <b>{b.tools.length} tool{b.tools.length === 1 ? '' : 's'} run</b>
                    <span>{b.tools.map(t => t.name).join(', ')}</span>
                  </button>
                  {open.has(b.key) && (
                    <div className="cp-tools-list">
                      {b.tools.map((t, i) => (
                        <div key={i}>
                          <div className="name">{t.name}</div>
                          {t.result && <div className="out">{t.result}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              <div className="ts">{b.when}</div>
            </div>
          </div>
        ))}
      </section>

      <div className="cp-ended">
        <span>This chat has ended. Start a new one to continue with {agentName}.</span>
        <button type="button" className="cp-primary" onClick={onNewChat}><Plus />New chat</button>
      </div>
      <div className="cp-foot">Responses are AI-generated and may be inaccurate.</div>
    </>
  );
}
