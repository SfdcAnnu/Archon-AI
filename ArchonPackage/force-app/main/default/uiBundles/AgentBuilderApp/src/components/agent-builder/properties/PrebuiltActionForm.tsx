import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { loadSchemaObjects, loadSchemaFields, type SchemaField, type SchemaObject } from '@/lib/schema-data';
import type { ToolNodeConfig } from '@/types/agent';

const OPERATIONS: Array<{ value: NonNullable<ToolNodeConfig['operation']> | 'delete' | 'bulk'; label: string; soon?: boolean }> = [
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'get', label: 'Get' },
  { value: 'search', label: 'Search' },
  { value: 'delete', label: 'Delete', soon: true },
  { value: 'bulk', label: 'Bulk', soon: true },
];

/** Fields the record binding can auto-fill from the conversation's anchored
 *  record — offered whenever the object carries them. */
const BINDABLE = new Set(['WhatId', 'WhoId']);

/** Prebuilt Salesforce action editor: operation + object + ticked fields →
 *  the server synthesizes a TYPED tool the AI fills like a form. The AI can
 *  only set ticked fields; bound fields are injected from the conversation's
 *  record and never touch the model at all. */
export function PrebuiltActionForm({
  cfg,
  onConfigChange,
}: {
  cfg: ToolNodeConfig;
  onConfigChange: (patch: Partial<ToolNodeConfig>) => void;
}) {
  const [objects, setObjects] = useState<SchemaObject[] | null>(null);
  const [objectSearch, setObjectSearch] = useState('');
  const [objectListOpen, setObjectListOpen] = useState(false);
  const [fields, setFields] = useState<SchemaField[] | null>(null);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldSearch, setFieldSearch] = useState('');

  const operation = cfg.operation ?? 'create';
  const selected = useMemo(() => new Map((cfg.selectedFields ?? []).map(f => [f.name, f])), [cfg.selectedFields]);
  const bound = useMemo(() => new Set(cfg.boundFields ?? []), [cfg.boundFields]);
  const bindOn = bound.size > 0;

  useEffect(() => {
    loadSchemaObjects().then(setObjects).catch(err => {
      console.error('Failed to load objects:', err);
      setObjects([]);
    });
  }, []);

  useEffect(() => {
    if (!cfg.object) { setFields(null); return; }
    let cancelled = false;
    setFieldsLoading(true);
    loadSchemaFields(cfg.object)
      .then(list => { if (!cancelled) { setFields(list); setFieldsLoading(false); } })
      .catch(err => { console.error('Failed to load fields:', err); if (!cancelled) { setFields([]); setFieldsLoading(false); } });
    return () => { cancelled = true; };
  }, [cfg.object]);

  const relevantFields = useMemo(() => {
    if (!fields) return [];
    const q = fieldSearch.trim().toLowerCase();
    return fields
      .filter(f => (operation === 'create' ? f.createable : operation === 'update' ? f.updateable : true))
      .filter(f => !q || f.name.toLowerCase().includes(q) || f.label.toLowerCase().includes(q));
  }, [fields, operation, fieldSearch]);

  const bindableHere = useMemo(
    () => (fields ?? []).filter(f => BINDABLE.has(f.name)).map(f => f.name),
    [fields]
  );

  const pickObject = (o: SchemaObject) => {
    onConfigChange({
      object: o.name,
      selectedFields: [],
      boundFields: [],
      toolName: `${operation}:${o.name}`,
    });
    setObjectListOpen(false);
    setObjectSearch('');
  };

  const toggleField = (f: SchemaField) => {
    const next = new Map(selected);
    if (next.has(f.name)) next.delete(f.name);
    else next.set(f.name, { name: f.name, label: f.label, type: f.type, required: f.required, picklistValues: f.picklistValues.slice(0, 15) });
    onConfigChange({ selectedFields: [...next.values()] });
  };

  const toggleBinding = (on: boolean) => {
    if (!on) { onConfigChange({ boundFields: [] }); return; }
    const nextBound = operation === 'create' ? bindableHere : ['Id'];
    // Bound fields must also be part of selectedFields so the runtime knows
    // their metadata; add them silently if missing.
    const nextSelected = new Map(selected);
    for (const name of nextBound) {
      const f = (fields ?? []).find(x => x.name === name);
      if (f && !nextSelected.has(name)) {
        nextSelected.set(name, { name: f.name, label: f.label, type: f.type, required: f.required });
      }
    }
    onConfigChange({ boundFields: nextBound, selectedFields: [...nextSelected.values()] });
  };

  const filteredObjects = useMemo(() => {
    if (!objects) return [];
    const q = objectSearch.trim().toLowerCase();
    if (!q) return objects.slice(0, 40);
    return objects.filter(o => o.name.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)).slice(0, 40);
  }, [objects, objectSearch]);

  const paramFields = (cfg.selectedFields ?? []).filter(f => !bound.has(f.name));

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">Operation</Label>
        <div className="flex flex-wrap gap-1.5">
          {OPERATIONS.map(op => (
            <button
              key={op.value}
              type="button"
              disabled={op.soon}
              title={op.soon ? 'Coming soon — waits for approval support on this path' : undefined}
              onClick={() => {
                if (op.soon || operation === op.value) return;
                onConfigChange({
                  operation: op.value as ToolNodeConfig['operation'],
                  boundFields: [],
                  toolName: cfg.object ? `${op.value}:${cfg.object}` : '',
                });
              }}
              className={cn(
                'rounded-md border px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors',
                op.soon
                  ? 'cursor-not-allowed border-border text-muted-foreground/50'
                  : operation === op.value
                    ? 'border-primary bg-accent text-primary'
                    : 'border-border text-muted-foreground hover:bg-secondary'
              )}
            >
              {op.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">Object</Label>
        {objects === null ? (
          <div className="flex items-center gap-1.5 py-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading your org&rsquo;s objects…
          </div>
        ) : objectListOpen || !cfg.object ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <Input
              autoFocus
              value={objectSearch}
              onChange={e => setObjectSearch(e.target.value)}
              placeholder="Search objects…"
              className="h-8 rounded-none border-0 border-b border-border text-xs"
            />
            <div className="max-h-44 overflow-y-auto">
              {filteredObjects.map(o => (
                <button
                  key={o.name}
                  type="button"
                  onClick={() => pickObject(o)}
                  className="flex w-full items-baseline gap-2 border-t border-border px-2.5 py-1.5 text-left first:border-t-0 hover:bg-secondary"
                >
                  <span className="text-[11.5px] font-semibold text-foreground">{o.label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{o.name}</span>
                  {o.custom && <span className="ml-auto text-[9px] font-bold text-primary">CUSTOM</span>}
                </button>
              ))}
              {filteredObjects.length === 0 && (
                <p className="px-3 py-2.5 text-[10.5px] text-muted-foreground">No objects match.</p>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setObjectListOpen(true)}
            className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left hover:bg-secondary"
          >
            <span className="font-mono text-xs font-semibold text-foreground">{cfg.object}</span>
            <span className="text-[10px] text-muted-foreground">change</span>
          </button>
        )}
      </div>

      {cfg.object && (
        <div className="space-y-1.5">
          <Label className="text-[11px] font-bold">
            Fields the AI can {operation === 'get' ? 'read' : operation === 'search' ? 'search & read' : 'set'}
          </Label>
          {fieldsLoading && (
            <div className="flex items-center gap-1.5 py-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading fields from the live schema…
            </div>
          )}
          {!fieldsLoading && fields && (
            <div className="overflow-hidden rounded-lg border border-border">
              <Input
                value={fieldSearch}
                onChange={e => setFieldSearch(e.target.value)}
                placeholder="Filter fields…"
                className="h-8 rounded-none border-0 border-b border-border text-xs"
              />
              <div className="max-h-52 overflow-y-auto">
                {relevantFields.slice(0, 60).map(f => {
                  const isBound = bound.has(f.name);
                  const isOn = selected.has(f.name);
                  return (
                    <button
                      key={f.name}
                      type="button"
                      disabled={isBound}
                      onClick={() => toggleField(f)}
                      className={cn(
                        'flex w-full items-center gap-2 border-t border-border px-2.5 py-1.5 text-left first:border-t-0',
                        isBound ? 'opacity-60' : 'hover:bg-secondary'
                      )}
                    >
                      <span className={cn(
                        'grid h-3.5 w-3.5 shrink-0 place-items-center rounded border text-[9px] text-white',
                        isOn ? 'border-primary bg-primary' : 'border-border'
                      )}>{isOn ? '✓' : ''}</span>
                      <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-foreground">{f.label}</span>
                      {f.required && <span className="text-[8.5px] font-bold tracking-wide text-[var(--archon-warning,var(--archon-warning))]">REQUIRED</span>}
                      {isBound && <span className="rounded-full bg-[var(--archon-success)]/10 px-1.5 text-[9px] font-bold text-[var(--archon-success)]">AUTO-BOUND</span>}
                      <span className="rounded-full bg-secondary px-1.5 text-[9.5px] text-muted-foreground">{f.type}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {cfg.object && (operation !== 'search') && (bindableHere.length > 0 || operation !== 'create') && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <div>
            <div className="text-[11px] font-bold text-foreground">Bind to the conversation&rsquo;s record</div>
            <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">
              {operation === 'create'
                ? 'WhatId = the record this chat is anchored to · WhoId = its Contact. The AI never supplies these Ids.'
                : 'The record Id comes from the conversation automatically — the AI never supplies it.'}
            </p>
          </div>
          <Switch checked={bindOn} onCheckedChange={toggleBinding} />
        </div>
      )}

      {cfg.object && paramFields.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-[11px] font-bold">What the AI sees</Label>
          <div className="overflow-x-auto rounded-lg border border-border bg-secondary/40 p-2.5 font-mono text-[10.5px] leading-relaxed">
            <span className="font-bold text-primary">{cfg.toolName || `${operation}:${cfg.object}`}</span>(
            {paramFields.map((f, i) => (
              <span key={f.name}>{i > 0 && ', '}{f.name}: {f.type ?? 'string'}{operation === 'create' && f.required ? '*' : ''}</span>
            ))}
            )
            {bound.size > 0 && <div className="text-muted-foreground">// {[...bound].join(' & ')} injected from this conversation</div>}
          </div>
        </div>
      )}
    </div>
  );
}
