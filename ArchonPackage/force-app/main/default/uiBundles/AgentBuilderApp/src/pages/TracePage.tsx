import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ChevronDown, ChevronRight, Copy, Loader2, RefreshCw } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { getSessionDetail, type SessionDetail } from '@/lib/conversations-data';
import { renderMarkdown } from '@/lib/render-markdown';
import '@/styles/trace.css';

/**
 * The trace of one conversation, full width: every turn as it actually
 * ran — what the person sent, each tool the agent called with its whole
 * input and output (a specialist's own calls nested under the hand-off),
 * the reply with model, tokens and latency, and, when the agent's Debug
 * Mode captured them, the raw request sent to the model and the raw
 * response. Nothing is summarised: this is the page to open when a turn
 * did something unexpected and the chat itself is too narrow to read.
 */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
function parse(text: string | null | undefined): unknown {
  if (!text) return null;
  const t = text.trim();
  if (t[0] === '{' || t[0] === '[') { try { return JSON.parse(t); } catch { /* raw */ } }
  return text;
}
function pretty(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') { const p = parse(v); return typeof p === 'string' ? p : JSON.stringify(p, null, 2); }
  return JSON.stringify(v, null, 2);
}
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtMs = (ms: number | null | undefined) => (ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);

interface Call { id?: string; name: string; input?: unknown; output?: unknown; isError?: boolean; nested?: Call[]; serverName?: string }
interface Turn {
  n: number;
  at: string;
  user: SessionDetail['messages'][number] | null;
  calls: Call[];
  assistant: SessionDetail['messages'][number] | null;
  /** Approval decisions written into the transcript after this turn. */
  audits: SessionDetail['messages'][number][];
}

/** Messages come flat and ordered: user, its tool rows, its reply. */
function toTurns(msgs: SessionDetail['messages']): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  const start = (m: SessionDetail['messages'][number] | null, at: string) => { cur = { n: turns.length + 1, at, user: m, calls: [], assistant: null, audits: [] }; turns.push(cur); };
  for (const m of msgs) {
    if (m.Role__c === 'System') { if (/"approvalId"/.test(m.ToolCallsJson__c ?? '')) (turns[turns.length - 1] ?? (start(null, m.CreatedDate), turns[turns.length - 1])).audits.push(m); continue; }
    if (m.Role__c === 'User') { start(m, m.CreatedDate); continue; }
    if (!cur) start(null, m.CreatedDate);
    if (m.Role__c === 'Tool') {
      let call: Call | null = null;
      try { const c = m.ToolResultsJson__c ? (JSON.parse(m.ToolResultsJson__c) as Call) : null; if (c && typeof c.name === 'string') call = c; } catch { /* truncated at the field limit */ }
      if (!call) {
        let name = 'tool';
        try { name = String((JSON.parse(m.ToolCallsJson__c ?? '{}') as { name?: string }).name ?? 'tool'); } catch { /* keep */ }
        call = { name, output: m.Content__c };
      }
      cur!.calls.push(call);
      continue;
    }
    if (m.Role__c === 'Assistant') { cur!.assistant = m; if (cur!.user == null) cur!.at = m.CreatedDate; cur = null; }
  }
  return turns;
}

function Block({ title, text, open: initial = false, tone }: { title: string; text: string; open?: boolean; tone?: 'err' }) {
  const [open, setOpen] = useState(initial);
  const [copied, setCopied] = useState(false);
  const lines = text.split('\n').length;
  const copy = () => { navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => { /* clipboard blocked */ }); };
  return (
    <div className={`tr-block${tone ? ' ' + tone : ''}`}>
      <div className="tr-block-hd">
        <button type="button" className="tr-toggle" onClick={() => setOpen(o => !o)}>{open ? <ChevronDown /> : <ChevronRight />}{title}<small>{lines} line{lines === 1 ? '' : 's'} · {text.length.toLocaleString()} chars</small></button>
        <button type="button" className="tr-copy" onClick={copy}><Copy />{copied ? 'Copied' : 'Copy'}</button>
      </div>
      {open && <pre className="tr-pre">{text}</pre>}
    </div>
  );
}

function CallView({ call, depth = 0, openAll }: { call: Call; depth?: number; openAll: boolean }) {
  const out = call.output;
  const outText = typeof out === 'string' ? (typeof parse(out) === 'string' ? out : pretty(out)) : pretty(out);
  const isErr = call.isError || /^\s*Error\b/.test(outText);
  const stored = isObj(parse(typeof out === 'string' ? out : JSON.stringify(out ?? ''))) && typeof (parse(typeof out === 'string' ? out : '') as Json)?.artifact === 'string';
  return (
    <div className={`tr-call${isErr ? ' err' : ''}`} style={{ marginLeft: depth * 18 }}>
      <div className="tr-call-hd">
        <span className={`tr-dot${isErr ? ' err' : ''}`} />
        <b>{call.name}</b>
        {call.serverName && <span className="tr-tag">{call.serverName}</span>}
        {call.nested?.length ? <span className="tr-tag v">{call.nested.length} nested call{call.nested.length === 1 ? '' : 's'}</span> : null}
        {stored && <span className="tr-tag a">stored result · preview shown</span>}
        {isErr && <span className="tr-tag r">error</span>}
      </div>
      {call.nested?.length ? <div className="tr-nested">{call.nested.map((c, i) => <CallView key={c.id ?? i} call={c} depth={depth + 1} openAll={openAll} />)}</div> : null}
      <Block title="Input" text={pretty(call.input ?? {})} open={openAll || depth === 0} />
      <Block title="Output" text={outText || '(no output)'} open={openAll || depth === 0} tone={isErr ? 'err' : undefined} />
    </div>
  );
}

export default function TracePage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [openAll, setOpenAll] = useState(false);
  const load = useCallback(() => {
    if (!sessionId) return;
    setState('loading');
    getSessionDetail(sessionId).then(d => { setDetail(d); setState('ready'); }).catch(() => setState('error'));
  }, [sessionId]);
  useEffect(() => { load(); }, [load]);
  const turns = useMemo(() => (detail ? toTurns(detail.messages) : []), [detail]);
  const s = detail?.session;
  const totalCalls = turns.reduce((n, t) => n + t.calls.reduce((m, c) => m + 1 + (c.nested?.length ?? 0), 0), 0);
  const anyDebug = (detail?.messages ?? []).some(m => m.RequestPayload__c || m.ResponsePayload__c);

  return (
    <AppShell title="Trace" onRefresh={load} actions={<button type="button" className="tr-btn" onClick={() => setOpenAll(o => !o)}>{openAll ? 'Collapse all' : 'Expand all'}</button>}>
      <div className="tr">
        {state === 'loading' && <div className="tr-empty"><Loader2 className="spin" /> Loading the trace…</div>}
        {state === 'error' && <div className="tr-empty err">Couldn't load this conversation. <button type="button" className="tr-btn" onClick={load}><RefreshCw /> Try again</button></div>}
        {state === 'ready' && s && (
          <>
            <div className="tr-head">
              <div>
                <div className="tr-eyebrow">Conversation trace</div>
                <h1>{s.Title__c || s.Name}</h1>
                <div className="tr-sub">{s['AgentDefinition__r.Name']} · {s.Status__c} · {s.Name}</div>
              </div>
              <div className="tr-stats">
                <div><b>{turns.length}</b><span>turns</span></div>
                <div><b>{totalCalls}</b><span>tool calls</span></div>
                <div><b>{(s.TokensIn__c ?? 0).toLocaleString()}</b><span>tokens in</span></div>
                <div><b>{(s.TokensOut__c ?? 0).toLocaleString()}</b><span>tokens out</span></div>
                <div><b>{(s.CachedTokens__c ?? 0).toLocaleString()}</b><span>cached</span></div>
                <div><b>{s.LatencyMsTotal__c && s.TotalTurns__c ? fmtMs(s.LatencyMsTotal__c / s.TotalTurns__c) : '—'}</b><span>per turn</span></div>
              </div>
              <div className="tr-actions">
                <button type="button" className="tr-btn" onClick={() => navigate('/conversations')}>All conversations</button>
              </div>
            </div>
            {!anyDebug && <div className="tr-note">The raw model request and response are captured only when the agent's <b>Debug Mode</b> is on. Turn it on in the builder to see them for future turns; tool inputs and outputs are always recorded.</div>}

            {turns.map(t => {
              const a = t.assistant;
              const usage = a?.UsageJson__c ? (parse(a.UsageJson__c) as Array<Json> | null) : null;
              return (
                <section key={t.n} className="tr-turn">
                  <div className="tr-turn-hd"><span className="tr-n">Turn {t.n}</span><span className="tr-time">{fmtTime(t.at)}</span>{a && <span className="tr-meta">{a.ModelUsed__c ?? ''}{a.ModelUsed__c ? ' · ' : ''}{(a.TokensIn__c ?? 0).toLocaleString()} in · {(a.TokensOut__c ?? 0).toLocaleString()} out · {fmtMs(a.LatencyMs__c)}</span>}</div>
                  {t.user && <div className="tr-msg you"><div className="tr-role">Person</div><div className="tr-text">{t.user.Content__c}</div></div>}
                  {t.calls.length > 0 && (
                    <div className="tr-calls">
                      <div className="tr-role">Tool calls · {t.calls.length}{t.calls.some(c => c.nested?.length) ? ' (specialist calls nested)' : ''}</div>
                      {t.calls.map((c, i) => <CallView key={c.id ?? i} call={c} openAll={openAll} />)}
                    </div>
                  )}
                  {a && (
                    <div className="tr-msg ai">
                      <div className="tr-role">Reply</div>
                      <div className="prose-chat tr-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.Content__c) }} />
                      {Array.isArray(usage) && usage.length > 0 && <div className="tr-usage">{usage.map((u, i) => <span key={i}>{String(u.model ?? '')}: {String(u.calls ?? '')} call{Number(u.calls) === 1 ? '' : 's'} · {Number(u.tokensIn ?? 0).toLocaleString()} in · {Number(u.tokensOut ?? 0).toLocaleString()} out{u.stages ? ` · ${(u.stages as string[]).join(', ')}` : ''}</span>)}</div>}
                      {a.RequestPayload__c && <Block title="Raw request to the model" text={pretty(a.RequestPayload__c)} open={openAll} />}
                      {a.ResponsePayload__c && <Block title="Raw response from the model" text={pretty(a.ResponsePayload__c)} open={openAll} />}
                    </div>
                  )}
                  {!a && t.user && <div className="tr-empty">No reply was recorded for this turn.</div>}
                  {t.audits.map(m => (
                    <div key={m.Id} className="tr-msg audit">
                      <div className="tr-role">Approval decision · {fmtTime(m.CreatedDate)}</div>
                      <div className="tr-text">{m.Content__c}</div>
                      <Block title="Decision record" text={pretty(m.ToolCallsJson__c)} open={openAll} />
                    </div>
                  ))}
                </section>
              );
            })}
            {turns.length === 0 && <div className="tr-empty">This conversation has no messages yet.</div>}
          </>
        )}
      </div>
    </AppShell>
  );
}
