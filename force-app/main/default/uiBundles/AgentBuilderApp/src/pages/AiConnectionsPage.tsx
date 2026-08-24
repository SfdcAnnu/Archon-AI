import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Plus, RefreshCw, Star, TestTube2, Trash2 } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { EngineConnectionFormDialog } from '@/components/connections/EngineConnectionFormDialog';
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
  const [customInput, setCustomInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [fetched, setFetched] = useState<string[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Rows to show: the provider's LIVE list once fetched (the built-in
  // defaults until then), plus whatever is already enabled on this
  // connection so a ticked model never disappears from view.
  const allModels = useMemo(() => {
    const set = new Set([...(fetched ?? defaults), ...enabled]);
    return [...set];
  }, [fetched, defaults, enabled]);

  const refreshFromProvider = () => {
    setFetching(true);
    setFetchError(null);
    fetchProviderModels({ recordId: conn.id })
      .then(models => setFetched(models))
      .catch(err => setFetchError(err instanceof Error ? err.message : 'Could not reach the provider.'))
      .finally(() => setFetching(false));
  };

  const persist = (next: string[]) => {
    setSaving(true);
    saveConnectionModels(conn.id, next)
      .then(() => onSaved(next))
      .catch(err => console.error('Failed to save models:', err))
      .finally(() => setSaving(false));
  };

  const toggle = (m: string) => {
    persist(enabled.includes(m) ? enabled.filter(x => x !== m) : [...enabled, m]);
  };

  const addCustom = () => {
    const m = customInput.trim();
    if (!m || enabled.includes(m)) return;
    setCustomInput('');
    persist([...enabled, m]);
  };

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between gap-2 bg-secondary/60 px-3 py-1.5 text-[10.5px]">
        <span className="font-bold text-foreground">
          Models · {enabled.length} enabled — ticked ones appear in every model picker
          {fetched && <span className="ml-1.5 font-medium text-[var(--archon-success)]">· {fetched.length} fetched live</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          <button
            type="button"
            onClick={refreshFromProvider}
            disabled={fetching}
            className="flex items-center gap-1 font-semibold text-primary hover:underline disabled:opacity-50"
          >
            {fetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {fetching ? 'Fetching…' : 'Refresh from provider'}
          </button>
        </span>
      </div>
      {fetchError && (
        <p className="border-t border-border bg-destructive/5 px-3 py-1.5 text-[10.5px] text-destructive">{fetchError}</p>
      )}
      {allModels.map(m => {
        const on = enabled.includes(m);
        return (
          <label
            key={m}
            className={cn(
              'flex cursor-pointer items-center gap-2.5 border-t border-border px-3 py-2',
              on ? 'bg-accent/40' : 'hover:bg-secondary/50'
            )}
          >
            <span
              className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center rounded',
                on ? 'bg-[var(--archon-success)] text-white' : 'border-[1.5px] border-border bg-card'
              )}
            >
              {on && <Check className="h-3 w-3" />}
            </span>
            <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(m)} disabled={saving} />
            <code className="font-mono text-[11.5px] text-foreground">{m}</code>
            {m === conn.defaultModel && (
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9.5px] font-bold text-muted-foreground">
                default
              </span>
            )}
            {!defaults.includes(m) && (
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9.5px] font-bold text-muted-foreground">
                custom
              </span>
            )}
          </label>
        );
      })}
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={customInput}
          onChange={e => setCustomInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addCustom()}
          placeholder="Add a model id manually (e.g. gpt-5-mini)…"
          className="h-7 border-0 px-0 text-[11.5px] shadow-none focus-visible:ring-0"
        />
        {customInput.trim() && (
          <Button size="sm" variant="outline" className="h-6 text-[10.5px]" onClick={addCustom} disabled={saving}>
            Add
          </Button>
        )}
      </div>
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
