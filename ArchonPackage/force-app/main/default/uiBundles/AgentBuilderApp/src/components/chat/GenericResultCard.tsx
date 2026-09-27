import { useState, type ReactNode } from 'react';
import { renderMarkdown } from '@/lib/render-markdown';

/**
 * A tool result drawn by its SHAPE, for any tool on any agent: a list of
 * records becomes a table, one record a key/value card, a list of values
 * chips, prose renders as markdown, and anything else is a folded JSON
 * block. Nothing here knows a tool by name — the named cards in
 * ToolResultCards sit on top of this for the vocabularies they know.
 */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const isRow = (v: unknown): v is Json => isObj(v) && Object.keys(v).length > 0;

/** MCP servers wrap results as { content: [{ type: 'text', text }] }; the
 *  text is often JSON again. Unwrap until a real value appears. */
export function unwrapResult(v: unknown, depth = 0): unknown {
  if (depth > 3) return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if ((t.startsWith('{') || t.startsWith('[')) && t.length < 2_000_000) {
      try { return unwrapResult(JSON.parse(t), depth + 1); } catch { return v; }
    }
    return v;
  }
  if (isObj(v) && Array.isArray(v.content) && v.content.every(c => isObj(c) && typeof c.text === 'string')) {
    const parts = (v.content as Json[]).map(c => String(c.text));
    return parts.length === 1 ? unwrapResult(parts[0], depth + 1) : parts.join('\n\n');
  }
  return v;
}

/** The one list of rows inside a result, if a result is really a list:
 *  the array itself, or the only array-of-objects value of an envelope
 *  such as { records, totalSize, done }. */
export function findRows(v: unknown): { rows: Json[]; meta: Json | null; key: string | null } | null {
  if (Array.isArray(v) && v.length && v.every(isRow)) return { rows: v as Json[], meta: null, key: null };
  if (!isObj(v)) return null;
  const arrays = Object.entries(v).filter(([, x]) => Array.isArray(x) && (x as unknown[]).length > 0 && (x as unknown[]).every(isRow));
  if (arrays.length !== 1) return null;
  const [key, rows] = arrays[0];
  const meta: Json = {};
  // The runtime's spill envelope (artifact id, note) is plumbing, not data.
  for (const [k, x] of Object.entries(v)) if (k !== key && k !== 'artifact' && k !== 'note' && (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean')) meta[k] = x;
  return { rows: rows as Json[], meta: Object.keys(meta).length ? meta : null, key };
}

const SF_ID = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;
const humanize = (s: string) => s.replace(/__c$/, '').replace(/__r\./g, ' › ').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');

/** Flatten one level of nested objects (Account.Name) and drop the
 *  Salesforce `attributes` envelope, so every row shares one column set. */
function flatten(row: Json): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'attributes') continue;
    if (isObj(v) && !('attributes' in v && Object.keys(v).length === 1)) {
      let n = 0;
      for (const [k2, v2] of Object.entries(v)) { if (k2 === 'attributes') continue; if (n++ >= 6) break; out[`${k}.${k2}`] = v2; }
      if (n === 0) out[k] = null;
    } else out[k] = v;
  }
  return out;
}

function cell(v: unknown): ReactNode {
  if (v == null || v === '') return <span className="gr-null">—</span>;
  if (typeof v === 'boolean') return <span className={`gr-bool ${v ? 'y' : 'n'}`}>{v ? 'yes' : 'no'}</span>;
  if (typeof v === 'number') return <span className="gr-num">{Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>;
  if (typeof v === 'string') {
    if (SF_ID.test(v) && v.length === 18) return <a className="gr-link" href={`/${v}`} target="_blank" rel="noreferrer" title="Open in Salesforce">{v.slice(0, 15)}…</a>;
    if (/^https?:\/\//.test(v)) return <a className="gr-link" href={v} target="_blank" rel="noreferrer">{v.length > 40 ? `${v.slice(0, 40)}…` : v}</a>;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) { const d = new Date(v); if (!isNaN(d.getTime())) return <span title={v}>{d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>; }
    return v.length > 80 ? <span title={v}>{v.slice(0, 80)}…</span> : v;
  }
  const s = JSON.stringify(v);
  return <span className="gr-json" title={s}>{s.length > 60 ? `${s.slice(0, 60)}…` : s}</span>;
}

export function RecordsTable({ rows, initial = 15 }: { rows: Json[]; initial?: number }) {
  const [all, setAll] = useState(false);
  const flat = rows.map(flatten);
  const cols: string[] = [];
  for (const r of flat) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  // Id first, then the rest in first-seen order, capped so the table stays readable.
  const ordered = [...cols.filter(c => /^(Id|id)$/.test(c)), ...cols.filter(c => !/^(Id|id)$/.test(c))].slice(0, 12);
  const type = typeof (rows[0]?.attributes as Json | undefined)?.type === 'string' ? String((rows[0].attributes as Json).type) : null;
  const shown = all ? flat : flat.slice(0, initial);
  return (
    <div className="gr-table-wrap">
      {type && <div className="gr-badge">{type}</div>}
      <table className="gr-table">
        <thead><tr>{ordered.map(c => <th key={c} title={c}>{humanize(c)}</th>)}</tr></thead>
        <tbody>{shown.map((r, i) => <tr key={i}>{ordered.map(c => <td key={c}>{cell(r[c])}</td>)}</tr>)}</tbody>
      </table>
      <div className="gr-foot">
        <span>{rows.length} row{rows.length === 1 ? '' : 's'}{cols.length > ordered.length ? ` · ${cols.length - ordered.length} more column${cols.length - ordered.length === 1 ? '' : 's'} not shown` : ''}</span>
        {rows.length > initial && <button type="button" className="gr-link-btn" onClick={() => setAll(a => !a)}>{all ? 'show fewer' : `show all ${rows.length}`}</button>}
      </div>
    </div>
  );
}

export function KeyValues({ obj }: { obj: Json }) {
  const entries = Object.entries(flatten(obj)).filter(([k]) => k !== 'attributes').slice(0, 40);
  return <dl className="gr-kv">{entries.map(([k, v]) => <div key={k}><dt title={k}>{humanize(k)}</dt><dd>{cell(v)}</dd></div>)}</dl>;
}

function Folded({ text, lines = 12 }: { text: string; lines?: number }) {
  const [open, setOpen] = useState(false);
  const all = text.split('\n');
  const long = all.length > lines || text.length > 1200;
  return (
    <div className="gr-fold">
      <pre className="gr-code">{open || !long ? text : `${all.slice(0, lines).join('\n').slice(0, 1200)}\n…`}</pre>
      {long && <button type="button" className="gr-link-btn" onClick={() => setOpen(o => !o)}>{open ? 'show less' : `show all (${all.length} lines)`}</button>}
    </div>
  );
}

const looksRich = (s: string) => /(^|\n)\s*(#{1,6}\s|[-*]\s|\d+\.\s|\|.*\|)|\*\*|`|<\/?(p|ul|ol|li|table|b|strong|em|h[1-6]|a)\b/i.test(s);

/** The body of a generic card for any result value. */
export function GenericBody({ value }: { value: unknown }): ReactNode {
  const v = unwrapResult(value);
  if (v == null) return <div className="gr-null">nothing returned</div>;
  const list = findRows(v);
  if (list) {
    return (
      <>
        {list.meta && <div className="gr-meta">{Object.entries(list.meta).map(([k, x]) => `${humanize(k)}: ${String(x)}`).join(' · ')}</div>}
        <RecordsTable rows={list.rows} />
      </>
    );
  }
  if (Array.isArray(v)) {
    if (!v.length) return <div className="gr-null">empty list</div>;
    if (v.every(x => typeof x === 'string' || typeof x === 'number')) return <div className="gr-chips">{v.slice(0, 60).map((x, i) => <span key={i} className="gr-chip">{String(x)}</span>)}{v.length > 60 && <span className="gr-chip muted">+{v.length - 60}</span>}</div>;
    return <Folded text={JSON.stringify(v, null, 2)} />;
  }
  if (isObj(v)) {
    const scalarish = Object.values(v).every(x => x == null || typeof x !== 'object' || (isObj(x) && Object.values(x).every(y => typeof y !== 'object')));
    if (scalarish && Object.keys(v).length <= 40) return <KeyValues obj={v} />;
    return <Folded text={JSON.stringify(v, null, 2)} />;
  }
  if (typeof v === 'string') {
    if (looksRich(v)) return <div className="prose-chat gr-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(v) }} />;
    return <Folded text={v} />;
  }
  return <div>{String(v)}</div>;
}

/** One line that says what a result is, for a card's subtitle. */
export function describeShape(value: unknown): string {
  const v = unwrapResult(value);
  const list = findRows(v);
  if (list) return `${list.rows.length} row${list.rows.length === 1 ? '' : 's'}`;
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  if (isObj(v)) return `${Object.keys(v).length} field${Object.keys(v).length === 1 ? '' : 's'}`;
  if (typeof v === 'string') return `${v.length.toLocaleString()} chars`;
  return '';
}
