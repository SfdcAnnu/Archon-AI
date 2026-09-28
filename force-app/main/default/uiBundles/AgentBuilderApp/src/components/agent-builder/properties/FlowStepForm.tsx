import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { AgentConnection, AgentNode, NodeConfig } from '@/types/agent';
import { flowNodeProblems, isAiStep, stepOutputs, type StepOutput } from '@/lib/flow-nodes';
import { loadConnectorDirectory, loadMcpToolsWithRetry, type DirectoryEntry, type RemoteTool } from '@/lib/connectors-data';
import { FieldLabel, Hint, Segmented } from './controls';

/**
 * The form for one automation step — a logic node (if/else, loop, wait,
 * approval, set variable) or an action (record work, Chatter, a connector
 * tool). Every field is a config key the automation engine reads; the hints
 * say how to refer to earlier steps' results.
 */
type Cfg = Record<string, unknown>;

const VARIABLES_HINT = (
  <>
    Use <code>{'{!recordId}'}</code> for the record the run started on, <code>{'{!name.Field}'}</code> for a step whose result you named
    (add a Get record step to read that record’s fields), <code>{'{!item.Field}'}</code> inside a loop, <code>{'{!judge.mood}'}</code> for an AI step’s named output, and <code>{'{!ai.finalText}'}</code> for the agent’s answer.
    {' '}<code>{'{!record.x}'}</code> is only what the trigger was sent. Functions work too: <code>{'{!TODAY}'}</code>, <code>{'{!DAYS_BETWEEN(deal.CloseDate, TODAY)}'}</code>,
    {' '}<code>{'{!ADD_BUSINESS_DAYS(TODAY, 3)}'}</code>, <code>{'{!ADD_MONTHS(opp.CloseDate, 12)}'}</code>, <code>{'{!FORMAT_NUMBER(opp.Amount)}'}</code>, <code>{'{!COUNT(list)}'}</code>, <code>{"{!SUM(list, 'Amount')}"}</code>.
  </>
);

export function FlowStepForm({ node, connections, onConfigChange, onProviderChange }: { node: AgentNode; connections: AgentConnection[]; onConfigChange: (patch: Partial<NodeConfig>) => void; onProviderChange?: (subType: string) => void }) {
  const c = node.config as Cfg;
  const str = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : c[k] == null ? '' : String(c[k]));
  const set = (k: string, v: unknown) => onConfigChange({ [k]: v } as Partial<NodeConfig>);
  const problems = flowNodeProblems(node, connections);

  const text = (k: string, label: string, placeholder: string, hint?: React.ReactNode, mono = false) => (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <Input value={str(k)} onChange={e => set(k, e.target.value)} placeholder={placeholder} className={`h-8 text-xs ${mono ? 'font-mono' : ''}`} />
      {hint && <Hint>{hint}</Hint>}
    </div>
  );
  const area = (k: string, label: string, placeholder: string, hint?: React.ReactNode, rows = 4) => (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <Textarea value={str(k)} onChange={e => set(k, e.target.value)} placeholder={placeholder} rows={rows} className="font-mono text-xs" />
      {hint && <Hint>{hint}</Hint>}
    </div>
  );
  const outputName = text('outputVariable', 'Name this step’s result (optional)', 'e.g. deals', <>Later steps then use <code>{`{!${str('outputVariable') || 'name'}.field}`}</code>.</>, true);

  return (
    <div className="space-y-4">
      {problems.length > 0 && (
        <div className="flex gap-2 rounded-md border border-[color-mix(in_oklab,var(--archon-warning)_40%,transparent)] bg-[var(--archon-warning-tint)] px-2.5 py-2 text-[11px] text-[var(--archon-warning)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>{problems.map(p => <div key={p}>{p}</div>)}</div>
        </div>
      )}

      {isAiStep(node) && (
        <>
          {area('instruction', 'Prompt', "Deal {!deal.Name}, stage {!deal.StageName}, last activity {!deal.LastActivityDate}.\nDecide how likely it is to close this quarter.", <>What the AI reads and what it decides or writes. Put every value it needs in with <code>{'{!…}'}</code>. {VARIABLES_HINT}</>, 5)}
          <OutputsEditor outputs={stepOutputs(node)} onChange={outputs => set('outputs', outputs)} />
          {text('outputVariable', 'Name the result', 'judge', <>Later steps read each output as <code>{`{!${str('outputVariable') || 'judge'}.${stepOutputs(node)[0]?.name ?? 'field'}}`}</code> — branch on it with an If / else.</>, true)}
          {onProviderChange && (
            <div>
              <FieldLabel>Engine</FieldLabel>
              <Segmented value={(node.nodeSubType || 'gpt4') as 'gpt4' | 'claude' | 'gemini'} onChange={v => onProviderChange(v)}
                options={[{ value: 'gpt4', label: 'OpenAI' }, { value: 'claude', label: 'Claude' }, { value: 'gemini', label: 'Gemini' }]} />
              <Hint>Runs on that engine's default model in your org unless the agent sets one.</Hint>
            </div>
          )}
        </>
      )}

      {node.nodeSubType === 'if_else' && (
        <>
          {text('condition', 'Condition', "{!item.Amount} >= 50000 AND {!item.CloseDate} < {!TODAY}", <>Comparisons joined by <b>AND</b> / <b>OR</b>: <code>==</code> <code>!=</code> <code>&gt;</code> <code>&lt;</code> <code>&gt;=</code> <code>&lt;=</code>, <code>contains</code>, <code>is blank</code>, <code>is not blank</code>. Dates compare as dates; text goes in quotes: <code>{"{!acct.Rating} == 'Hot'"}</code>. True follows <b>Yes</b>, false follows <b>No</b>. {VARIABLES_HINT}</>, true)}
        </>
      )}

      {node.nodeSubType === 'loop' && (
        <>
          {text('collectionVar', 'List to go through', '{!deals.records}', <>Usually a Query records step’s result: name that step (for example <code>deals</code>) and use <code>{'{!deals.records}'}</code>.</>, true)}
          {text('iteratorVar', 'Name for each item', 'item', <>Steps on the <b>For each</b> exit read the current one as <code>{`{!${str('iteratorVar') || 'item'}.Field}`}</code>. <b>After all</b> runs once when the list is done.</>, true)}
          <div>
            <FieldLabel>At most</FieldLabel>
            <Input type="number" min={1} max={100} value={str('maxIterations') || '25'} onChange={e => set('maxIterations', Number(e.target.value) || 25)} className="h-8 w-28 text-xs" />
            <Hint>Items past this are skipped (hard limit 100). Wait and Approval steps cannot run inside a loop.</Hint>
          </div>
        </>
      )}

      {node.nodeSubType === 'wait' && (
        <div>
          <FieldLabel>Wait for</FieldLabel>
          <div className="flex items-center gap-2">
            <Input type="number" min={0} value={str('delayValue')} onChange={e => set('delayValue', Number(e.target.value) || 0)} className="h-8 w-24 text-xs" />
            <Segmented value={(str('delayUnit') || 'minutes') as 'seconds' | 'minutes' | 'hours' | 'days'} onChange={v => set('delayUnit', v)}
              options={[{ value: 'minutes', label: 'Minutes' }, { value: 'hours', label: 'Hours' }, { value: 'days', label: 'Days' }]} />
          </div>
          <Hint>Up to a minute waits in place; longer waits pause the run and it resumes on its own when due.</Hint>
        </div>
      )}

      {node.nodeSubType === 'approval' && (
        <>
          {text('processDefinitionId', 'Approval process (optional)', 'Process API name or Id', 'Leave empty to use the record’s default approval process in Salesforce.')}
          {area('comments', 'Comments for the approver', 'Why this needs approval…', VARIABLES_HINT, 3)}
          <div>
            <FieldLabel>Give up after (hours)</FieldLabel>
            <Input type="number" min={0} value={str('timeoutHours')} onChange={e => set('timeoutHours', Number(e.target.value) || 0)} className="h-8 w-28 text-xs" />
            <Hint>The run follows <b>Approved</b> or <b>Rejected</b> once decided; past this time it is treated as rejected.</Hint>
          </div>
        </>
      )}

      {node.nodeSubType === 'set_variable' && (
        <>
          {text('variableName', 'Variable name', 'summary', undefined, true)}
          {area('template', 'Value', 'Deal {!item.Name}: {!item.StageName}', <>Later steps read it as <code>{`{!${str('variableName') || 'name'}.value}`}</code>. {VARIABLES_HINT}</>, 3)}
        </>
      )}

      {node.nodeSubType === 'query_records' && (
        <>
          {area('soql', 'SOQL query', "SELECT Id, Name, Amount, CloseDate, OwnerId FROM Opportunity WHERE AccountId = '{!recordId}' AND IsClosed = false", <>The result is <code>records</code> (a list) and <code>count</code>. {VARIABLES_HINT}</>, 5)}
          {outputName}
        </>
      )}

      {node.nodeSubType === 'get_record' && (
        <>
          {text('objectType', 'Object', 'Account', <>Name it (for example <code>acct</code>) and later steps use <code>{'{!acct.Name}'}</code>.</>, true)}
          {text('recordId', 'Record Id (optional)', '{!opp.AccountId}', <>Which record to read. Leave empty for the record the run started on.</>, true)}
          {text('fields', 'Fields', 'Id,Name,OwnerId', 'Comma-separated API names.', true)}
          {outputName}
        </>
      )}

      {(node.nodeSubType === 'create_record' || node.nodeSubType === 'update_record') && (
        <>
          {text('objectType', 'Object', node.nodeSubType === 'create_record' ? 'Task' : 'Account', undefined, true)}
          {node.nodeSubType === 'update_record' && text('recordId', 'Record Id (optional)', '{!acct.Id}', <>Which record to update — the loop’s current record, a related Account… Leave empty for the record the run started on.</>, true)}
          {area('fieldMappings', 'Fields to write (JSON)', '{\n  "Subject": "Follow up on {!item.Name}",\n  "WhatId": "{!item.Id}"\n}', <>Field API name to value. {VARIABLES_HINT}</>, 6)}
          {outputName}
        </>
      )}

      {node.nodeSubType === 'create_task' && (
        <>
          {text('subject', 'Subject', 'Close date passed — update or close this deal', VARIABLES_HINT)}
          <div>
            <FieldLabel>Priority</FieldLabel>
            <Segmented value={(str('priority') || 'Normal') as 'High' | 'Normal' | 'Low'} onChange={v => set('priority', v)}
              options={[{ value: 'High', label: 'High' }, { value: 'Normal', label: 'Normal' }, { value: 'Low', label: 'Low' }]} />
          </div>
          {text('dueDate', 'Due', 'TODAY+3', <><code>TODAY</code>, <code>TODAY+N</code> or a date. The Task is on the trigger record; for a Task on each looped record use Create record with <code>WhatId</code>.</>, true)}
          {outputName}
        </>
      )}

      {node.nodeSubType === 'post_chatter' && (
        <>
          {area('message', 'Post', 'Risk review done for {!acct.Name}.', <>Posted on the trigger record. {VARIABLES_HINT}</>, 3)}
          {outputName}
        </>
      )}

      {node.nodeSubType === 'call_tool' && <ConnectorToolFields cfg={c} set={set} />}
      {node.nodeSubType === 'call_tool' && outputName}
    </div>
  );
}

/** Pick a connected connector, then one of its tools, then fill the tool's
 *  inputs — each one text with {!variables}. */
function ConnectorToolFields({ cfg, set }: { cfg: Cfg; set: (k: string, v: unknown) => void }) {
  const [directory, setDirectory] = useState<DirectoryEntry[] | null>(null);
  const [tools, setTools] = useState<RemoteTool[] | null>(null);
  const [toolsState, setToolsState] = useState<'idle' | 'loading' | 'waking' | 'error'>('idle');
  const provider = typeof cfg.provider === 'string' ? cfg.provider : '';
  const toolName = typeof cfg.toolName === 'string' ? cfg.toolName : '';
  const params = (cfg.paramValues && typeof cfg.paramValues === 'object' ? cfg.paramValues : {}) as Record<string, string>;

  useEffect(() => {
    let off = false;
    loadConnectorDirectory().then(d => { if (!off) setDirectory(d); }).catch(() => { if (!off) setDirectory([]); });
    return () => { off = true; };
  }, []);
  const connected = (directory ?? []).filter(d => /connected/i.test(d.status) && !/not/i.test(d.status));
  const entry = connected.find(d => d.providerKey === provider) ?? null;

  useEffect(() => {
    if (!provider) return;
    let off = false;
    setToolsState('loading');
    loadMcpToolsWithRetry(provider, entry?.connectorId ?? null, () => { if (!off) setToolsState('waking'); })
      .then(t => { if (!off) { setTools(t); setToolsState('idle'); } })
      .catch(() => { if (!off) setToolsState('error'); });
    return () => { off = true; };
  }, [provider, entry?.connectorId]);

  const tool = (tools ?? []).find(t => t.name === toolName) ?? null;
  const inputs = useMemo(() => {
    try {
      const s = tool?.inputSchema ? JSON.parse(tool.inputSchema) as { properties?: Record<string, { description?: string; type?: string }>; required?: string[] } : null;
      return Object.entries(s?.properties ?? {}).map(([name, p]) => ({ name, description: p.description ?? '', required: (s?.required ?? []).includes(name) }));
    } catch { return []; }
  }, [tool]);

  return (
    <>
      <div>
        <FieldLabel>Connector</FieldLabel>
        {directory === null ? <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Reading connectors…</div> : (
          <select value={provider} onChange={e => { set('provider', e.target.value); set('toolName', ''); set('paramValues', {}); set('connectorId', connected.find(d => d.providerKey === e.target.value)?.connectorId ?? ''); }}
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs">
            <option value="">Choose a connected connector…</option>
            {connected.map(d => <option key={d.providerKey} value={d.providerKey}>{d.displayName}</option>)}
          </select>
        )}
        <Hint>Only connected connectors are listed. Connect Gmail or Outlook on the Connectors page to send email.</Hint>
      </div>
      {provider && (
        <div>
          <FieldLabel>Tool</FieldLabel>
          {toolsState === 'loading' || toolsState === 'waking' ? (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> {toolsState === 'waking' ? 'The connector’s server is waking up…' : 'Reading its tools…'}</div>
          ) : toolsState === 'error' ? (
            <div className="text-[11px] text-destructive">Could not read this connector’s tools. Check it on the Connectors page.</div>
          ) : (
            <select value={toolName} onChange={e => { set('toolName', e.target.value); set('paramValues', {}); }} className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs">
              <option value="">Choose a tool…</option>
              {(tools ?? []).map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          )}
          {tool?.description && <Hint>{tool.description}</Hint>}
        </div>
      )}
      {tool && inputs.map(inp => (
        <div key={inp.name}>
          <FieldLabel meta={inp.required ? 'required' : undefined}>{inp.name}</FieldLabel>
          <Input value={params[inp.name] ?? ''} onChange={e => set('paramValues', { ...params, [inp.name]: e.target.value })} placeholder={inp.description.slice(0, 80)} className="h-8 font-mono text-xs" />
        </div>
      ))}
      {tool && <Hint>{VARIABLES_HINT}</Hint>}
    </>
  );
}

/** An AI step's named outputs: each a field the AI must return, of a type
 *  the engine checks. A choice lists its options; later steps branch on it. */
function OutputsEditor({ outputs, onChange }: { outputs: StepOutput[]; onChange: (o: StepOutput[]) => void }) {
  const update = (i: number, patch: Partial<StepOutput>) => onChange(outputs.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <div>
      <FieldLabel>Outputs</FieldLabel>
      <div className="space-y-2">
        {outputs.map((o, i) => (
          <div key={i} className="rounded-md border border-border p-2">
            <div className="flex items-center gap-1.5">
              <Input value={o.name} onChange={e => update(i, { name: e.target.value.replace(/[^A-Za-z0-9_]/g, '') })} placeholder="mood" className="h-7 flex-1 font-mono text-xs" />
              <select value={o.type} onChange={e => update(i, { type: e.target.value as StepOutput['type'] })} className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs">
                <option value="choice">choice</option>
                <option value="text">text</option>
                <option value="number">number</option>
                <option value="boolean">yes / no</option>
                <option value="date">date</option>
              </select>
              <button type="button" onClick={() => onChange(outputs.filter((_, j) => j !== i))} aria-label={`Remove ${o.name || 'output'}`} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {o.type === 'choice' && (
              <Input value={(o.options ?? []).join(' | ')} onChange={e => update(i, { options: e.target.value.split('|').map(x => x.trim()).filter(Boolean) })} placeholder="interested | cooling off | blocked" className="mt-1.5 h-7 font-mono text-xs" />
            )}
            <Input value={o.description ?? ''} onChange={e => update(i, { description: e.target.value })} placeholder="What it means, e.g. one sentence naming the facts used" className="mt-1.5 h-7 text-xs" />
          </div>
        ))}
        <button type="button" onClick={() => onChange([...outputs, { name: '', type: 'choice', options: [] }])} className="flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground">
          <Plus className="h-3 w-3" /> Add output
        </button>
      </div>
      <Hint>The AI must answer with exactly these fields; the engine checks each one (a choice must be one of its options) and asks once more if it does not fit.</Hint>
    </div>
  );
}
