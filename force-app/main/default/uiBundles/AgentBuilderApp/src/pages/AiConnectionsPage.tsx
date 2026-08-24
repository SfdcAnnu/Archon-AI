import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Star, TestTube2, Trash2, X } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { EngineConnectionFormDialog } from '@/components/connections/EngineConnectionFormDialog';
import { ModelCombobox } from '@/components/connections/ModelCombobox';
import {
  ENGINE_DEFAULT_MODELS,
  ENGINE_TYPES,
  listConnectionsForEngine,
  deleteEngineConnection,
  fetchProviderModels,
  parseEnabledModels,
  saveConnectionModels,
  testEngineConnection,
  saveEngineConnection,
  type ConnectionSummary,
  type ProviderModel,
} from '@/lib/engine-connections-data';

/** Emma-style two-pane layout: a provider rail on the left (brand chip +
 *  ON badge when at least one active connection exists), the selected
 *  provider's connections on the right — each card carrying key/test/
 *  active controls plus the per-connection model catalog that feeds every
 *  model picker in the canvas (see use-engine-models.ts). */

interface ProviderMeta {
  key: string;
  name: string;
  sub: string;
  glyph: string;
  chipClass: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    key: 'claude',
    name: 'Anthropic',
    sub: 'Claude',
    glyph: 'A',
    chipClass: 'bg-[#F5EDE6] text-[#C15F3C] dark:bg-[#3a2a20] dark:text-[#e08a62]',
  },
  {
    key: 'openai',
    name: 'OpenAI',
    sub: 'GPT · o-series',
    glyph: '◎',
    chipClass: 'bg-[#E6FAF5] text-[#10A37F] dark:bg-[#0e2a24] dark:text-[#3fd6ac]',
  },
  {
    key: 'gemini',
    name: 'Google',
    sub: 'Gemini',
    glyph: 'G',
    chipClass: 'bg-[#EAF2FE] text-[#4285F4] dark:bg-[#16233d] dark:text-[#7ba7f7]',
  },
  {
    key: 'custom',
    name: 'Custom',
    sub: 'OpenAI-compatible',
    glyph: '⌘',
    chipClass: 'bg-secondary text-muted-foreground',
  },
];

function statusPillStyle(status: string | null) {
  if (status === 'Success') return { backgroundColor: 'var(--archon-success-tint)', color: 'var(--archon-success)' };
  if (status === 'Failed') return { backgroundColor: 'var(--archon-danger-tint, #fde8e8)', color: 'var(--archon-danger, #dc2626)' };
  return { backgroundColor: 'var(--node-gray-tint)', color: 'var(--node-gray)' };
}

/** The per-connection model catalog editor — the piece borrowed from Emma:
 *  tick the models this connection may offer, add new ids by hand the day
 *  a provider ships one, no app redeploy involved. */
function ModelCatalog({ conn, onSaved }: { conn: ConnectionSummary; onSaved: (models: string[]) => void }) {
  const defaults = ENGINE_DEFAULT_MODELS[conn.engineType] ?? [];
  const enabled = useMemo(() => parseEnabledModels(conn) ?? defaults, [conn, defaults]);
  const [saving, setSaving] = useState(false);
  const [fetched, setFetched] = useState<ProviderModel[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchSeq, setFetchSeq] = useState(0);

  // The live list loads automatically when the card renders — no manual
  // refresh step. Until (or if) it arrives, the built-in defaults act as
  // the searchable options so the picker is never empty.
  useEffect(() => {
    let cancelled = false;
    setFetching(true);
    setFetchError(null);
    fetchProviderModels({ recordId: conn.id })
      .then(models => !cancelled && setFetched(models))
      .catch(err => !cancelled && setFetchError(err instanceof Error ? err.message : 'Could not reach the provider.'))
      .finally(() => !cancelled && setFetching(false));
    return () => {
      cancelled = true;
    };
  }, [conn.id, fetchSeq]);

  const options = useMemo<ProviderModel[]>(() => {
    const live = fetched ?? defaults.map(id => ({ id, description: null }));
    // Enabled ids missing from the live list (older/custom models) stay
    // selectable so an active choice never silently disappears.
    const known = new Set(live.map(m => m.id));
    return [...live, ...enabled.filter(id => !known.has(id)).map(id => ({ id, description: 'Custom / not in provider list' }))];
  }, [fetched, defaults, enabled]);

  const persist = (next: string[]) => {
    setSaving(true);
    saveConnectionModels(conn.id, next)
      .then(() => onSaved(next))
      .catch(err => console.error('Failed to save models:', err))
      .finally(() => setSaving(false));
  };

  const toggle = (id: string) => {
    persist(enabled.includes(id) ? enabled.filter(x => x !== id) : [...enabled, id]);
  };

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between text-[10.5px]">
        <span className="font-bold text-foreground">
          Enabled models · {enabled.length} — these appear in every model picker
        </span>
        {(saving || fetching) && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      {/* Enabled set as compact chips — remove with ✕ */}
      <div className="flex flex-wrap gap-1.5">
        {enabled.length === 0 && (
          <span className="text-[10.5px] text-muted-foreground">None yet — search below to enable models.</span>
        )}
        {enabled.map(id => (
          <span
            key={id}
            className="flex items-center gap-1 rounded-full border border-border bg-secondary/60 py-0.5 pl-2.5 pr-1 font-mono text-[10.5px] text-foreground"
          >
            {id}
            {id === conn.defaultModel && (
              <span className="rounded-full bg-card px-1.5 text-[8.5px] font-bold text-muted-foreground">default</span>
            )}
            <button
              type="button"
              onClick={() => toggle(id)}
              disabled={saving}
              aria-label={`Remove ${id}`}
              className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      <ModelCombobox
        models={options}
        selectedIds={enabled}
        loading={fetching}
        keepOpenOnSelect
        placeholder={`Search ${options.length} models — click to enable/disable…`}
        onSelect={m => toggle(m.id)}
      />
      {fetchError && (
        <p className="text-[10.5px] text-destructive">
          Couldn't fetch the live list ({fetchError}){' '}
          <button type="button" className="font-semibold underline" onClick={() => setFetchSeq(s => s + 1)}>
            retry
          </button>{' '}
          — showing built-in defaults meanwhile.
        </p>
      )}
    </div>
  );
}

export default function AiConnectionsPage() {
  const [rows, setRows] = useState<ConnectionSummary[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selected, setSelected] = useState<string>('claude');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectionSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadState('loading');
    Promise.all(ENGINE_TYPES.map(t => listConnectionsForEngine(t)))
      .then(results => {
        setRows(results.flat());
        setLoadState('ready');
      })
      .catch(err => {
        console.error('Failed to load AI connections:', err);
        setLoadState('error');
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const providerRows = rows.filter(r => r.engineType === selected);
  const providerMeta = PROVIDERS.find(p => p.key === selected)!;
  const hasActive = (key: string) => rows.some(r => r.engineType === key && r.isActive);

  const handleDelete = useCallback((row: ConnectionSummary) => {
    if (!window.confirm(`Delete "${row.label}"?`)) return;
    setBusyId(row.id);
    deleteEngineConnection(row.id)
      .then(() => setRows(list => list.filter(r => r.id !== row.id)))
      .catch(err => console.error('Delete failed:', err))
      .finally(() => setBusyId(null));
  }, []);

  const handleTest = useCallback(
    (row: ConnectionSummary) => {
      setBusyId(row.id);
      testEngineConnection(row.id)
        .then(result => window.alert(result.success ? 'Connection OK.' : result.message))
        .catch(err => console.error('Test failed:', err))
        .finally(() => {
          setBusyId(null);
          load();
        });
    },
    [load]
  );

  const handleToggleActive = useCallback(
    (row: ConnectionSummary) => {
      setBusyId(row.id);
      saveEngineConnection({
        recordId: row.id,
        engineType: row.engineType,
        ownershipType: row.ownershipType,
        label: row.label,
        isActive: !row.isActive,
      })
        .then(() => load())
        .catch(err => console.error('Toggle failed:', err))
        .finally(() => setBusyId(null));
    },
    [load]
  );

  const handleModelsSaved = useCallback((connId: string, models: string[]) => {
    setRows(list =>
      list.map(r => (r.id === connId ? { ...r, availableModels: JSON.stringify(models) } : r))
    );
  }, []);

  return (
    <AppShell>
      <div className="flex h-full w-full flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-5">
          <span className="text-[14px] font-bold text-foreground">AI Models</span>
          <Button size="sm" className="h-8 text-xs" onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> New Connection
          </Button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* ── Provider rail ── */}
          <aside className="w-60 shrink-0 overflow-y-auto border-r border-border bg-card p-3">
            <div className="px-2 pb-2 pt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Providers
            </div>
            {PROVIDERS.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => setSelected(p.key)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                  selected === p.key ? 'bg-accent' : 'hover:bg-secondary/70'
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold',
                    p.chipClass
                  )}
                >
                  {p.glyph}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-foreground">{p.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{p.sub}</span>
                </span>
                {hasActive(p.key) && (
                  <span className="rounded-full bg-[var(--archon-success)]/10 px-1.5 py-0.5 text-[9px] font-extrabold text-[var(--archon-success)]">
                    ON
                  </span>
                )}
              </button>
            ))}
          </aside>

          {/* ── Provider detail ── */}
          <div className="min-w-0 flex-1 overflow-y-auto p-6">
            <div className="mx-auto max-w-2xl">
              <div className="mb-4 flex items-center gap-3">
                <span
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-xl text-[16px] font-bold',
                    providerMeta.chipClass
                  )}
                >
                  {providerMeta.glyph}
                </span>
                <div className="flex-1">
                  <div className="text-[15px] font-bold text-foreground">{providerMeta.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {providerRows.length === 0
                      ? 'No connections yet'
                      : `${providerRows.length} connection${providerRows.length === 1 ? '' : 's'} · ${providerRows.filter(r => r.isActive).length} active`}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => { setEditing(null); setDialogOpen(true); }}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add {providerMeta.name} key
                </Button>
              </div>

              {loadState === 'loading' && (
                <div className="flex items-center gap-2 py-8 text-[12.5px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                </div>
              )}
              {loadState === 'error' && (
                <p className="py-8 text-[12.5px] text-destructive">Couldn't load AI connections.</p>
              )}
              {loadState === 'ready' && providerRows.length === 0 && (
                <div className="rounded-lg border border-dashed border-border py-14 text-center">
                  <p className="text-[13px] text-muted-foreground">
                    No {providerMeta.name} connection yet — add an API key to run agents on {providerMeta.sub}.
                  </p>
                </div>
              )}

              {loadState === 'ready' &&
                providerRows.map(r => (
                  <div key={r.id} className="mb-4 rounded-lg border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[13px] font-bold text-foreground">
                          <span className="truncate">{r.label}</span>
                          {r.isPreferred && <Star className="h-3.5 w-3.5 shrink-0 fill-current text-[var(--node-amber,#D98324)]" />}
                        </div>
                        <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                          {r.ownershipType}
                          {r.isPublicShared ? ' · Public' : ''}
                          {r.isMine ? ' · mine' : r.userName ? ` · ${r.userName}` : ''}
                          {r.endpoint ? ` · ${r.endpoint}` : ''}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                          style={statusPillStyle(r.validationStatus)}
                        >
                          {r.validationStatus ?? 'Untested'}
                        </span>
                        <Switch checked={r.isActive} disabled={busyId === r.id} onCheckedChange={() => handleToggleActive(r)} />
                      </div>
                    </div>

                    <ModelCatalog conn={r} onSaved={models => handleModelsSaved(r.id, models)} />

                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        disabled={busyId === r.id}
                        onClick={() => handleTest(r)}
                      >
                        {busyId === r.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <TestTube2 className="mr-1 h-3 w-3" />}
                        Test
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        onClick={() => { setEditing(r); setDialogOpen(true); }}
                      >
                        Edit
                      </Button>
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => handleDelete(r)}
                        className="ml-auto rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      <EngineConnectionFormDialog
        open={dialogOpen}
        defaultEngineType={selected}
        editing={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={load}
      />
    </AppShell>
  );
}
