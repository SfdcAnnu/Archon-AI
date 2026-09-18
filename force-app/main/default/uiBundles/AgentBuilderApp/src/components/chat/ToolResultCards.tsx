import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ChatToolCallSummary } from '@/lib/ws-chat';
import { loadArtifact } from '@/lib/chat-data';
import '@/styles/chat-cards.css';

/**
 * What the agent did this turn, drawn — one card per tool result, keyed
 * by the tool's name. A specialist's calls are shown under the hand-off
 * that made them. Every card reads only the tool's input and output; a
 * result the runtime stored by reference is fetched in full first.
 *
 * Nothing here knows an agent or a use case: the cards are keyed by the
 * tool vocabulary of the two servers (metadata, platform), and anything
 * else falls back to a plain result card.
 */

type Json = Record<string, unknown>;

/** Root calls in order, each specialist call expanded to its own calls first. */
export function flattenCalls(calls: ChatToolCallSummary[] | undefined): ChatToolCallSummary[] {
  const out: ChatToolCallSummary[] = [];
  for (const c of calls ?? []) {
    if (c.nested?.length) out.push(...c.nested);
    out.push(c);
  }
  return out;
}

function parseOutput(output: unknown): Json | unknown[] | string | null {
  if (output == null) return null;
  if (typeof output !== 'string') return output as Json;
  const t = output.trim();
  if (!t) return null;
  if (t[0] === '{' || t[0] === '[') {
    try { return JSON.parse(t) as Json | unknown[]; } catch { /* not JSON */ }
  }
  return t;
}

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 200): string => (v == null ? '' : String(v).length > max ? `${String(v).slice(0, max)}…` : String(v));

/** Resolves an artifact-preview output into the full result. */
function useFullOutput(call: ChatToolCallSummary): { data: unknown; loading: boolean; failed: string | null } {
  const initial = useMemo(() => parseOutput(call.output), [call.output]);
  const artifactId = isObj(initial) && typeof initial.artifact === 'string' && /^art_/.test(initial.artifact) ? initial.artifact : null;
  const [data, setData] = useState<unknown>(initial);
  const [loading, setLoading] = useState(!!artifactId);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!artifactId) { setData(initial); return; }
    let cancelled = false;
    setLoading(true);
    loadArtifact(artifactId)
      .then(a => {
        if (cancelled) return;
        if (a.kind === 'json-records') setData({ records: a.records ?? [] });
        else setData(parseOutput(a.text ?? ''));
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setFailed(err instanceof Error ? err.message : 'could not load the full result');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [artifactId, initial]);
  return { data, loading, failed };
}

// ── primitives ────────────────────────────────────────────────────────
function Card({ kind, title, sub, children, tone }: { kind: string; title: string; sub?: ReactNode; children?: ReactNode; tone?: 'ok' | 'warn' | 'err' }) {
  return (
    <div className={`tc-card tc-${kind}${tone ? ' tc-tone-' + tone : ''}`}>
      <div className="tc-hd"><span className="tc-title">{title}</span>{sub ? <span className="tc-sub">{sub}</span> : null}</div>
      {children ? <div className="tc-bd">{children}</div> : null}
    </div>
  );
}
function KV({ rows }: { rows: Array<[string, ReactNode]> }) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false);
  return <dl className="tc-kv">{shown.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}
function Chips({ items, tone }: { items: string[]; tone?: string }) {
  return <div className="tc-chips">{items.map((s, i) => <span key={i} className={`tc-chip${tone ? ' ' + tone : ''}`}>{s}</span>)}</div>;
}
function Table({ rows, max = 15 }: { rows: Json[]; max?: number }) {
  if (!rows.length) return <div className="tc-empty">nothing returned</div>;
  const cols = Object.keys(rows[0]).filter(k => !k.startsWith('attributes')).slice(0, 8);
  return (
    <div className="tc-table-wrap">
      <table className="tc-table"><thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{rows.slice(0, max).map((r, i) => <tr key={i}>{cols.map(c => <td key={c} title={str(r[c], 400)}>{typeof r[c] === 'object' ? str(JSON.stringify(r[c]), 60) : str(r[c], 60)}</td>)}</tr>)}</tbody>
      </table>
      {rows.length > max && <div className="tc-more">{rows.length - max} more</div>}
    </div>
  );
}
function Diff({ text }: { text: string }) {
  const [open, setOpen] = useState(text.split('\n').length <= 30);
  const lines = text.split('\n');
  return (
    <div className="tc-diff">
      <button type="button" className="tc-link" onClick={() => setOpen(o => !o)}>{open ? 'hide diff' : `show diff (${lines.length} lines)`}</button>
      {open && <pre>{lines.map((l, i) => <span key={i} className={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@') ? 'hunk' : ''}>{l}{'\n'}</span>)}</pre>}
    </div>
  );
}

// ── metadata: the IR envelope, per type ───────────────────────────────
type Envelope = { type?: string; object?: string; apiName?: string; operation?: string; spec?: Json };

function LayoutGrid({ preview, ops }: { preview: { sections?: Array<{ label: string; style?: string | null; columns: Array<Array<{ field: string; behavior: string }>> }>; relatedLists?: string[] } | null; ops?: Json[] }) {
  // Apply the patch operations visually: added fields highlighted, removed
  // struck through, moved marked — the existing layout stays visible.
  const added = new Map<string, { section: string; behavior?: string }>();
  const removed = new Set<string>();
  const moved = new Map<string, string>();
  const newSections: string[] = [];
  for (const op of ops ?? []) {
    if (op.op === 'addField') added.set(String(op.field), { section: String(op.section), behavior: op.behavior ? String(op.behavior) : undefined });
    if (op.op === 'removeField') removed.add(String(op.field));
    if (op.op === 'moveField') moved.set(String(op.field), String(op.toSection));
    if (op.op === 'addSection') newSections.push(String(op.label));
  }
  const sections = [...(preview?.sections ?? []).map(s => ({ ...s, isNew: false })), ...newSections.map(label => ({ label, style: null, columns: [[], []] as Array<Array<{ field: string; behavior: string }>>, isNew: true }))];
  if (!sections.length) return <div className="tc-empty">no layout preview available</div>;
  return (
    <div className="tc-layout">
      {sections.map((s, si) => {
        const extra = [...added.entries()].filter(([, a]) => a.section === s.label).map(([f, a]) => ({ field: f, behavior: a.behavior ?? 'Edit' }));
        const movedIn = [...moved.entries()].filter(([, to]) => to === s.label).map(([f]) => ({ field: f, behavior: 'Edit' }));
        return (
          <div key={si} className={`tc-section${s.isNew ? ' new' : ''}`}>
            <div className="tc-section-hd">{s.label}{s.isNew && <span className="tc-badge add">new section</span>}</div>
            <div className={`tc-cols c${Math.max(1, s.columns.length)}`}>
              {s.columns.map((col, ci) => (
                <div key={ci} className="tc-col">
                  {col.map((f, fi) => {
                    const gone = removed.has(f.field) || (moved.has(f.field) && moved.get(f.field) !== s.label);
                    return <div key={fi} className={`tc-field${gone ? ' del' : ''}`}><span className="n">{f.field}</span><span className={`b ${f.behavior.toLowerCase()}`}>{f.behavior}</span></div>;
                  })}
                  {ci === 0 && [...extra, ...movedIn].map((f, fi) => <div key={`x${fi}`} className={`tc-field ${moved.has(f.field) ? 'mv' : 'add'}`}><span className="n">{f.field}</span><span className={`b ${f.behavior.toLowerCase()}`}>{f.behavior}</span></div>)}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {preview?.relatedLists?.length ? <div className="tc-related">Related lists: {preview.relatedLists.join(' · ')}</div> : null}
    </div>
  );
}

function FlowGraph({ spec }: { spec: Json }) {
  // Nodes are the flow's elements; an edge is any property whose value names
  // another element (connectors, defaultConnector, targets) — drawn layered
  // from the start.
  const elements = (Array.isArray(spec.elements) ? spec.elements : []) as Json[];
  const start = isObj(spec.start) ? spec.start : null;
  const names = new Set(elements.map(e => String(e.name)));
  const edges: Array<[string, string, string]> = [];
  const collect = (from: string, v: unknown, label: string) => {
    if (typeof v === 'string' && names.has(v)) edges.push([from, v, label]);
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) collect(from, x, k === 'targetReference' ? label : k);
    else if (Array.isArray(v)) v.forEach(x => collect(from, x, label));
  };
  if (start) collect('start', start, '');
  for (const e of elements) for (const [k, v] of Object.entries(e)) if (!['name', 'kind', 'label', 'object'].includes(k)) collect(String(e.name), v, k);
  // layered layout by BFS depth
  const depth = new Map<string, number>([['start', 0]]);
  const queue = ['start'];
  while (queue.length) { const n = queue.shift()!; for (const [f, t] of edges) if (f === n && !depth.has(t)) { depth.set(t, (depth.get(n) ?? 0) + 1); queue.push(t); } }
  elements.forEach(e => { if (!depth.has(String(e.name))) depth.set(String(e.name), 1); });
  const layers = new Map<number, string[]>();
  for (const [n, d] of depth) layers.set(d, [...(layers.get(d) ?? []), n]);
  const W = 560, NW = 150, NH = 40, GX = 170, GY = 74;
  const pos = new Map<string, { x: number; y: number }>();
  for (const [d, ns] of [...layers.entries()].sort((a, b) => a[0] - b[0])) ns.forEach((n, i) => pos.set(n, { x: 20 + i * GX + Math.max(0, (W - 40 - ns.length * GX) / 2), y: 16 + d * GY }));
  const H = 16 + (Math.max(...depth.values()) + 1) * GY;
  const kindOf = (n: string) => n === 'start' ? `start · ${str(start?.kind ?? '', 30)}` : String(elements.find(e => String(e.name) === n)?.kind ?? '');
  return (
    <svg className="tc-flow" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Flow graph">
      {edges.map(([f, t, l], i) => { const a = pos.get(f), b = pos.get(t); if (!a || !b) return null; const x1 = a.x + NW / 2, y1 = a.y + NH, x2 = b.x + NW / 2, y2 = b.y; return <g key={i} className="tc-flow-edge"><path d={`M${x1} ${y1} C${x1} ${y1 + 30},${x2} ${y2 - 30},${x2} ${y2}`} />{l && l !== 'connector' && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 3}>{str(l, 18)}</text>}</g>; })}
      {[...pos.entries()].map(([n, p]) => <g key={n} className={`tc-flow-node k-${kindOf(n).split(' ')[0].toLowerCase()}`} transform={`translate(${p.x},${p.y})`}><rect width={NW} height={NH} rx={6} /><text x={8} y={16} className="k">{kindOf(n)}</text><text x={8} y={31} className="n">{str(n, 22)}</text></g>)}
    </svg>
  );
}

function EnvelopeView({ env, preview }: { env: Envelope; preview: Json | null }) {
  const spec = env.spec ?? {};
  switch (env.type) {
    case 'CustomField':
      return <KV rows={[['Label', str(spec.label)], ['API name', `${env.object}.${env.apiName}`], ['Type', str(spec.type)], ['Length', spec.length as number], ['Precision / scale', spec.precision != null ? `${spec.precision} / ${spec.scale ?? 0}` : undefined], ['Required', spec.required ? 'yes' : undefined], ['Unique', spec.unique ? 'yes' : undefined], ['External id', spec.externalId ? 'yes' : undefined], ['Default', str(spec.defaultValue)], ['Help text', str(spec.inlineHelpText, 160)], ['Description', str(spec.description, 200)]]} />;
    case 'ValidationRule':
      return <><KV rows={[['Rule', `${env.object}.${env.apiName}`], ['Active', spec.active === false ? 'no' : 'yes'], ['Error shown on', str(spec.errorDisplayField) || 'page top'], ['Error message', str(spec.errorMessage, 255)]]} /><div className="tc-label">Error condition (TRUE = invalid)</div><pre className="tc-code">{str(spec.errorConditionFormula, 3900)}</pre></>;
    case 'CustomObject': {
      const fields = (Array.isArray(spec.fields) ? spec.fields : []) as Json[];
      return <><KV rows={[['Label', `${str(spec.label)} / ${str(spec.pluralLabel)}`], ['API name', env.apiName], ['Name field', isObj(spec.nameField) ? `${str(spec.nameField.label)} (${str(spec.nameField.type)})` : undefined], ['Sharing', str(spec.sharingModel)], ['Features', ['enableActivities', 'enableHistory', 'enableReports', 'enableSearch', 'enableFeeds'].filter(k => spec[k]).map(k => k.replace('enable', '')).join(', ') || undefined]]} />{fields.length > 0 && <Table rows={fields.map(f => ({ field: f.apiName ?? f.fullName, label: f.label, type: f.type, required: f.required ? 'yes' : '' }))} />}</>;
    }
    case 'RecordType':
      return <KV rows={[['Record type', `${env.object}.${env.apiName}`], ['Label', str(spec.label)], ['Active', spec.active === false ? 'no' : 'yes'], ['Business process', str(spec.businessProcess)], ['Picklists', Array.isArray(spec.picklistValues) ? <Chips items={(spec.picklistValues as Json[]).map(p => `${p.picklist}: ${(p.values as string[] ?? []).join(', ')}`)} /> : undefined]]} />;
    case 'ListView':
      return <><KV rows={[['List view', `${env.object} · ${str(spec.label)}`], ['Scope', str(spec.filterScope)], ['Columns', Array.isArray(spec.columns) ? <Chips items={spec.columns as string[]} /> : undefined]]} />{Array.isArray(spec.filters) && (spec.filters as Json[]).length > 0 && <Table rows={(spec.filters as Json[]).map(f => ({ field: f.field, operation: f.operation, value: f.value }))} />}</>;
    case 'PermissionSet': {
      const groups: Array<[string, unknown[]]> = [['Objects', spec.objectPermissions as unknown[]], ['Fields', spec.fieldPermissions as unknown[]], ['User permissions', spec.userPermissions as unknown[]], ['Tabs', spec.tabSettings as unknown[]], ['Apex classes', spec.classAccesses as unknown[]], ['Record types', spec.recordTypeVisibilities as unknown[]], ['Apps', spec.applicationVisibilities as unknown[]]];
      return <><KV rows={[['Permission set', `${str(spec.label)} (${env.apiName})`]]} />{groups.filter(([, v]) => Array.isArray(v) && v.length).map(([k, v]) => <div key={k}><div className="tc-label">{k} · {(v as unknown[]).length} change{(v as unknown[]).length === 1 ? '' : 's'}</div><Table rows={v as Json[]} max={12} /></div>)}</>;
    }
    case 'Layout':
      return <LayoutGrid preview={isObj(preview) && isObj(preview.preview) ? (preview.preview as Parameters<typeof LayoutGrid>[0]['preview']) : (preview as Parameters<typeof LayoutGrid>[0]['preview'])} ops={Array.isArray(spec.operations) ? (spec.operations as Json[]) : []} />;
    case 'CompactLayout':
    case 'FieldSet':
      return <KV rows={[['Label', str(spec.label)], ['API name', `${env.object}.${env.apiName}`], ['Fields', Array.isArray(spec.fields) ? <Chips items={(spec.fields as unknown[]).map(f => (isObj(f) ? str(f.field ?? f.apiName) : str(f)))} /> : undefined]]} />;
    case 'Flow':
      return <><KV rows={[['Flow', env.apiName], ['Label', str(spec.label)], ['Template', str(spec.template)], ['Trigger', isObj(spec.start) ? `${str(spec.start.kind)}${spec.start.object ? ' on ' + str(spec.start.object) : ''}` : undefined], ['Elements', Array.isArray(spec.elements) ? String((spec.elements as unknown[]).length) : undefined]]} />{Array.isArray(spec.elements) && (spec.elements as unknown[]).length > 0 && <FlowGraph spec={spec} />}</>;
    default:
      return <pre className="tc-code">{str(JSON.stringify(spec, null, 2), 1500)}</pre>;
  }
}

const TYPE_LABEL: Record<string, string> = { CustomField: 'Field', ValidationRule: 'Validation rule', CustomObject: 'Object', RecordType: 'Record type', ListView: 'List view', PermissionSet: 'Permission set', Layout: 'Page layout', CompactLayout: 'Compact layout', FieldSet: 'Field set', Flow: 'Flow' };

// ── deploy timeline ───────────────────────────────────────────────────
const PIPE_STEPS: Array<[string, string]> = [['validate', 'Validate'], ['serialize', 'Serialize'], ['check_deploy', 'Salesforce check'], ['snapshot', 'Snapshot'], ['deploy', 'Deploy'], ['activate_flow', 'Activate']];
function DeployTimeline({ calls }: { calls: ChatToolCallSummary[] }) {
  const byName = new Map<string, ChatToolCallSummary>();
  for (const c of calls) byName.set(c.name, c);
  const state = (name: string): 'off' | 'done' | 'fail' | 'wait' => {
    const c = byName.get(name); if (!c) return 'off';
    const out = typeof c.output === 'string' ? c.output : JSON.stringify(c.output ?? '');
    if (c.isError || /^\s*Error/.test(out)) return 'fail';
    if (/PENDING_APPROVAL/.test(out)) return 'wait';
    if (name === 'check_deploy' && /"success"\s*:\s*false/.test(out)) return 'fail';
    return 'done';
  };
  const shown = PIPE_STEPS.filter(([n]) => byName.has(n) || ['validate', 'serialize', 'check_deploy', 'deploy'].includes(n));
  const last = [...calls].reverse().find(c => ['check_deploy', 'deploy', 'get_deploy_status', 'rollback', 'activate_flow'].includes(c.name));
  const lastOut = last ? parseOutput(last.output) : null;
  const problems = isObj(lastOut) && Array.isArray(lastOut.problems) ? (lastOut.problems as Json[]) : [];
  return (
    <div className="tc-timeline">
      <div className="tc-steps">{shown.map(([n, label]) => { const s = state(n); return <div key={n} className={`tc-step ${s}`}><span className="dot" />{label}{s === 'wait' && <small>waiting for approval</small>}</div>; })}</div>
      {isObj(lastOut) && (lastOut.deployId || lastOut.status) ? <div className="tc-meta">{lastOut.status ? `status: ${str(lastOut.status)}` : ''}{lastOut.deployId ? ` · deploy ${str(lastOut.deployId, 24)}` : ''}{lastOut.snapshotId ? ` · snapshot ${str(lastOut.snapshotId, 24)}` : ''}</div> : null}
      {problems.length > 0 && <ul className="tc-problems">{problems.slice(0, 8).map((p, i) => <li key={i}><b>{str(p.fullName ?? p.component, 60)}</b> {str(p.problem ?? p.message, 300)}{typeof p.setupUrl === 'string' && <> · <a href={p.setupUrl} target="_blank" rel="noreferrer">open in Setup</a></>}</li>)}</ul>}
    </div>
  );
}

// ── platform cards ────────────────────────────────────────────────────
function StatsCard({ data }: { data: Json }) {
  const days = (Array.isArray(data.byDay) ? data.byDay : []) as Json[];
  const max = Math.max(1, ...days.map(d => Number(d.runsOk ?? 0) + Number(d.runsFailed ?? 0) + Number(d.runsOther ?? 0) + Number(d.turnsOk ?? 0) + Number(d.turnsFailed ?? 0)));
  return (
    <>
      <div className="tc-tiles">
        <div><b>{String(Number(data.runs ?? 0) + Number(data.turns ?? 0))}</b><span>activity · {String(data.days ?? '')} days</span></div>
        <div><b className="err">{String(Number(data.runsFailed ?? 0) + Number(data.turnsFailed ?? 0))}</b><span>failed</span></div>
        <div><b>{fmtK(Number(data.tokensIn ?? 0))} / {fmtK(Number(data.tokensOut ?? 0))}</b><span>tokens in / out</span></div>
      </div>
      {days.length > 0 && <div className="tc-bars">{days.map((d, i) => { const ok = Number(d.runsOk ?? 0) + Number(d.turnsOk ?? 0), fail = Number(d.runsFailed ?? 0) + Number(d.turnsFailed ?? 0); return <div key={i} className="tc-bar" title={`${d.day}: ${ok} ok, ${fail} failed`}><div className="fill"><span className="ok" style={{ height: `${(ok / max) * 100}%` }} /><span className="fail" style={{ height: `${(fail / max) * 100}%` }} /></div><small>{String(d.day).slice(5)}</small></div>; })}</div>}
      {Array.isArray(data.byAgent) && (data.byAgent as Json[]).length > 0 && <Table rows={(data.byAgent as Json[]).map(a => ({ agent: a.name, turns: a.turns, tokensIn: a.tokensIn, tokensOut: a.tokensOut }))} max={8} />}
    </>
  );
}
const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n));

function AgentTree({ data }: { data: Json }) {
  const nodes = (Array.isArray(data.nodes) ? data.nodes : []) as Json[];
  const root = nodes.find(n => n.kind === 'ai'), subs = nodes.filter(n => n.kind === 'subagent'), tools = nodes.filter(n => n.kind === 'tool');
  return (
    <div className="tc-tree">
      {root && <div className="tc-tree-root">{str(root.name)} <small>{str(data.status)} · {str(data.accessMode)}</small></div>}
      {subs.map((s, i) => <div key={i} className="tc-tree-sub">↳ {str(s.name)} <small>{str((s.config as Json | undefined)?.mode ?? '')}</small></div>)}
      <div className="tc-tree-tools">{tools.length} tool node{tools.length === 1 ? '' : 's'}: <Chips items={tools.slice(0, 20).map(t => str(t.name, 30))} /></div>
    </div>
  );
}

// ── the dispatcher ────────────────────────────────────────────────────
const LIST_TOOLS: Record<string, string> = { list_runs: 'runs', list_conversations: 'conversations', list_approvals: 'chatApprovals', list_agents: 'agents', list_connectors: 'catalog', connector_tools: 'tools', list_resumable_builds: 'builds', list_metadata: 'items', list_layouts: 'layouts', list_record_types: 'recordTypes', list_value_sets: 'valueSets', list_flow_versions: 'versions', check_dependencies: 'dependencies', search_reusable_actions: 'actions' };
const BUILD_STAGE = new Set(['analyze_requirement', 'inspect_org', 'find_gaps', 'design_agent', 'write_instructions', 'review_design', 'save_agent', 'resume_build', 'get_build_status']);
const PIPE_NAMES = new Set(PIPE_STEPS.map(s => s[0]).concat(['get_deploy_status', 'rollback']));

function firstArray(d: unknown, preferred?: string): Json[] {
  if (Array.isArray(d)) return d as Json[];
  if (!isObj(d)) return [];
  if (preferred && Array.isArray(d[preferred])) return d[preferred] as Json[];
  for (const v of Object.values(d)) if (Array.isArray(v) && v.length && isObj(v[0])) return v as Json[];
  return [];
}

function ToolCard({ call, all }: { call: ChatToolCallSummary; all: ChatToolCallSummary[] }) {
  const { data, loading, failed } = useFullOutput(call);
  const name = call.name;
  if (call.isError) return <Card kind="error" title={name} tone="err"><div className="tc-empty">{str(typeof call.output === 'string' ? call.output : JSON.stringify(call.output), 400)}</div></Card>;
  if (loading) return <Card kind="loading" title={name} sub="loading the full result…" />;
  if (failed) return <Card kind="error" title={name} tone="warn"><div className="tc-empty">{failed}</div></Card>;

  if (name === 'resolve_object' || name === 'resolve_field') {
    const d = isObj(data) ? data : {};
    const ok = !!d.apiName && (d.resolved !== false);
    return <Card kind="resolve" title={name === 'resolve_object' ? 'Resolved object' : 'Resolved field'} sub={ok ? `${str(d.label ?? call.input.label)} → ${str(d.apiName)}${d.confidence != null ? ` · ${Number(d.confidence).toFixed(2)}` : ''}` : 'needs a choice'} tone={ok ? 'ok' : 'warn'}>{!ok && Array.isArray(d.candidates) && <Chips items={(d.candidates as Json[]).map(c => `${str(c.label ?? c.apiName)} (${str(c.apiName)})`)} />}</Card>;
  }
  if (name === 'describe_object') {
    const rows = firstArray(data, 'fields');
    return <Card kind="describe" title={`Describe ${str(call.input.object)}`} sub={`${rows.length} fields`}><Table rows={rows.map(f => ({ field: f.name, label: f.label, type: f.type, required: f.required ? 'yes' : '' }))} max={20} /></Card>;
  }
  if (name === 'serialize') {
    const env = (isObj(call.input.ir) ? call.input.ir : call.input) as Envelope;
    const out = isObj(data) ? data : {};
    const preview = all.find(c => c.name === 'layout_to_preview_json' && !c.isError);
    const previewData = preview ? parseOutput(preview.output) : null;
    return (
      <Card kind="change" title={`${env.operation === 'modify' ? 'Change' : 'New'} ${TYPE_LABEL[env.type ?? ''] ?? env.type ?? 'component'}`} sub={out.changeId ? `change ${str(out.changeId, 20)}` : undefined}>
        <EnvelopeView env={env} preview={isObj(previewData) ? previewData : null} />
        {typeof out.diff === 'string' && out.diff.trim() && <Diff text={out.diff} />}
      </Card>
    );
  }
  if (name === 'layout_to_preview_json') {
    // Drawn with the change when a serialize follows; alone, the layout as it is.
    if (all.some(c => c.name === 'serialize' && !c.isError)) return null;
    const d = isObj(data) ? data : {};
    return <Card kind="layout" title={`Layout ${str(d.layoutName ?? call.input.layoutName)}`} sub={str(d.object ?? call.input.object)}><LayoutGrid preview={(isObj(d.preview) ? d.preview : d) as Parameters<typeof LayoutGrid>[0]['preview']} /></Card>;
  }
  if (PIPE_NAMES.has(name)) {
    // One timeline for the whole pipeline, drawn at its last step.
    const pipeCalls = all.filter(c => PIPE_NAMES.has(c.name));
    if (pipeCalls[pipeCalls.length - 1] !== call) return null;
    return <Card kind="deploy" title="Deploy pipeline"><DeployTimeline calls={pipeCalls} /></Card>;
  }
  if (name === 'validate_flow_graph' || name === 'validate') {
    const d = isObj(data) ? data : {};
    const v = (Array.isArray(d.violations) ? d.violations : []) as Json[];
    return <Card kind="validate" title={name === 'validate' ? 'Validation' : 'Flow graph check'} sub={v.length ? `${v.length} issue${v.length === 1 ? '' : 's'}` : 'passed'} tone={v.length ? 'warn' : 'ok'}>{v.length > 0 && <ul className="tc-problems">{v.slice(0, 8).map((x, i) => <li key={i}>{str(x.path ?? x.field, 60)} {str(x.message ?? x, 200)}</li>)}</ul>}</Card>;
  }
  if (name === 'compile_formula') {
    const d = isObj(data) ? data : {};
    const ok = d.ok === true || d.valid === true || (!d.error && !d.message);
    return <Card kind="validate" title="Formula check" sub={ok ? 'compiles' : str(d.message ?? d.error, 200)} tone={ok ? 'ok' : 'err'} />;
  }
  if (name === 'home_stats' && isObj(data)) return <Card kind="stats" title="Platform activity"><StatsCard data={data} /></Card>;
  if (name === 'agent_details' && isObj(data)) return <Card kind="agent" title={`Agent · ${str(data.name)}`} sub={str(data.apiName)}><AgentTree data={data} /></Card>;
  if (name in LIST_TOOLS) {
    const rows = firstArray(data, LIST_TOOLS[name]);
    const extra = name === 'list_approvals' && isObj(data) && Array.isArray(data.runApprovals) ? (data.runApprovals as Json[]) : [];
    return <Card kind="list" title={name.replace(/_/g, ' ')} sub={`${rows.length + extra.length}`}><Table rows={rows.length ? rows : extra} /></Card>;
  }
  if (name === 'transfer_to_agent' && isObj(data) && isObj(data.transfer)) return <Card kind="transfer" title={`Handing over to ${str((data.transfer as Json).agentName)}`} sub="the conversation continues there" tone="ok" />;
  if (BUILD_STAGE.has(name)) return null; // the Architect card draws these
  if (name.startsWith('ask_')) {
    const d = isObj(data) ? data : null;
    const label = name.replace(/^ask_/, '').replace(/_[a-z0-9]{6}$/, '').replace(/_/g, ' ');
    return <Card kind="specialist" title={`${label} returned`} sub={d?.status ? str(d.status) : undefined} tone={d?.status === 'failed' ? 'err' : d?.status === 'question' ? 'warn' : undefined}>{d ? <KV rows={[['Change', d.changeId ? str(d.changeId, 20) : undefined], ['Component', d.type ? `${str(d.type)} ${str(d.object)}${d.apiName ? '.' + str(d.apiName) : ''}` : undefined], ['Reason', str(d.reason, 300)], ['Warnings', Array.isArray(d.warnings) && d.warnings.length ? <Chips items={(d.warnings as unknown[]).map(w => str(w, 80))} tone="warn" /> : undefined]]} /> : <div className="tc-empty">{str(typeof call.output === 'string' ? call.output : '', 300)}</div>}</Card>;
  }
  return <Card kind="generic" title={name.replace(/_/g, ' ')}><pre className="tc-code">{str(typeof data === 'string' ? data : JSON.stringify(data, null, 2), 800)}</pre></Card>;
}

export function ToolResultCards({ calls }: { calls: ChatToolCallSummary[] | undefined }) {
  const flat = useMemo(() => flattenCalls(calls), [calls]);
  if (!flat.length) return null;
  // Specialist calls are grouped under the ask_* that made them.
  const groups: Array<{ owner: ChatToolCallSummary | null; calls: ChatToolCallSummary[] }> = [];
  for (const c of calls ?? []) {
    if (c.nested?.length) groups.push({ owner: c, calls: c.nested });
    groups.push({ owner: null, calls: [c] });
  }
  return (
    <div className="tc-cards">
      {groups.map((g, gi) => (
        <div key={gi} className={g.owner ? 'tc-group' : undefined}>
          {g.owner && <div className="tc-group-hd">{g.owner.name.replace(/^ask_/, '').replace(/_[a-z0-9]{6}$/, '').replace(/_/g, ' ')} · what it did</div>}
          {g.calls.map((c, i) => <ToolCard key={c.id || `${gi}-${i}`} call={c} all={g.calls} />)}
        </div>
      ))}
    </div>
  );
}
