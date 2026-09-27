import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, RotateCw, Star, TestTube2, Trash2 } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { PageBody } from '@/components/shell/PageBody';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  EmptyPanel,
  IconSquare,
  NoteBar,
  SpecCard,
  StatCard,
  StatusBadge,
  T,
} from '@/components/spec/blocks';
import { EngineConnectionFormDialog } from '@/components/connections/EngineConnectionFormDialog';
import { ModelCombobox } from '@/components/connections/ModelCombobox';
import { TIER_META, tierForModel } from '@/lib/model-tiers';
import { invalidateEngineModelsCache } from '@/lib/use-engine-models';
import {
  ENGINE_DEFAULT_MODELS,
  ENGINE_TYPES,
  effectiveEnabledModels,
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

/** Screen 02 of the approved spec — "Which providers and keys are
 *  working?": stat strip up top, provider rail on the left, and per-key
 *  cards + the enabled-models table + routing defaults on the right.
 *  Same data layer and handlers as before — this is the spec skin. */

interface ProviderMeta {
  key: string;
  name: string;
  sub: string;
}

const PROVIDERS: ProviderMeta[] = [
  { key: 'claude', name: 'Anthropic', sub: 'Claude' },
  { key: 'openai', name: 'OpenAI', sub: 'GPT · o-series' },
  { key: 'gemini', name: 'Google', sub: 'Gemini' },
  { key: 'custom', name: 'Custom endpoint', sub: 'OpenAI compatible' },
];

/** Status dot: green = last test passed, red = last test failed,
 *  grey = never tested. */
function connDotColor(status: string | null): string {
  if (status === 'Success') return 'var(--archon-success)';
  if (status === 'Failed') return 'var(--archon-error)';
  return 'var(--border)';
}

function providerDotColor(pRows: ConnectionSummary[]): string | null {
  if (pRows.length === 0) return null;
  if (pRows.some(r => r.validationStatus === 'Failed')) return 'var(--archon-error)';
  if (pRows.some(r => r.validationStatus === 'Success' || r.isActive)) return 'var(--archon-success)';
  return 'var(--border)';
}

function KeyStatusBadge({ status }: { status: string | null }) {
  if (status === 'Success') return <StatusBadge tone="ok">Working</StatusBadge>;
  if (status === 'Failed') return <StatusBadge tone="error">Rejected</StatusBadge>;
  return <StatusBadge tone="muted">Untested</StatusBadge>;
}

function fmtWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The spec's four routing defaults. The platform stores no routing
 *  configuration yet, so the selects render disabled — no fake
 *  persistence. */
const ROUTE_ROWS = [
  {
    glyph: '♟',
    bg: 'var(--node-purple-tint)',
    color: 'var(--node-purple)',
    title: 'Main agents',
    sub: 'Planning and customer-facing replies',
  },
  {
    glyph: '⑂',
    bg: 'var(--node-blue-tint)',
    color: 'var(--node-blue)',
    title: 'Sub-agents',
    sub: 'Specialist work with a clear job',
  },
  {
    glyph: '✦',
    bg: 'var(--node-teal-tint)',
    color: 'var(--node-teal)',
    title: 'Routing and classifying',
    sub: 'Short decisions between a few options',
  },
  {
    glyph: '⚠',
    bg: 'var(--archon-warning-tint)',
    color: 'var(--archon-warning)',
    title: 'If the first choice fails',
    sub: 'Used when a key is rejected or rate limited',
  },
] as const;

/** Enabled-models card for the selected connection: the spec's toggle-row
 *  table over the saved set, plus the searchable live-list combobox to
 *  enable more. Same fetch/persist logic the old ModelCatalog used. */
function ModelsCard({
  conn,
  onSaved,
}: {
  conn: ConnectionSummary;
  onSaved: (models: string[]) => void;
}) {
  const defaults = ENGINE_DEFAULT_MODELS[conn.engineType] ?? [];
  const enabled = useMemo(() => parseEnabledModels(conn) ?? defaults, [conn, defaults]);
  const [saving, setSaving] = useState(false);
  const [fetched, setFetched] = useState<ProviderModel[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchSeq, setFetchSeq] = useState(0);

  // The live list loads automatically for the selected connection; until
  // (or if) it arrives, the built-in defaults act as the options so the
  // picker is never empty.
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
    // toggleable so an active choice never silently disappears.
    const known = new Set(live.map(m => m.id));
    return [...live, ...enabled.filter(id => !known.has(id)).map(id => ({ id, description: 'Custom / not in provider list' }))];
  }, [fetched, defaults, enabled]);

  const byId = useMemo(() => new Map(options.map(m => [m.id, m])), [options]);

  const persist = (next: string[]) => {
    setSaving(true);
    saveConnectionModels(conn.id, next)
      .then(() => {
        // The canvas pickers offer exactly this set — make them re-read it
        // instead of serving a stale list for the rest of the session.
        invalidateEngineModelsCache();
        onSaved(next);
      })
      .catch(err => console.error('Failed to save models:', err))
      .finally(() => setSaving(false));
  };

  const toggle = (id: string) => {
    persist(enabled.includes(id) ? enabled.filter(x => x !== id) : [...enabled, id]);
  };

  return (
    <SpecCard
      title="Models"
      muted={`via ${conn.label} · ${enabled.length} enabled`}
      right={
        <>
          {(saving || fetching) && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          <button
            type="button"
            onClick={() => setFetchSeq(s => s + 1)}
            className="flex items-center gap-1 rounded-[5px] border border-border px-2 py-1 text-[10.5px] font-semibold text-muted-foreground hover:bg-secondary/60"
          >
            <RotateCw className="h-3 w-3" /> Refresh list
          </button>
        </>
      }
    >
      {enabled.length === 0 ? (
        <div className="px-3.5 py-5 text-[12px] text-muted-foreground">
          No models enabled on this key yet — search below to enable some.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className={T.table}>
            <thead>
              <tr>
                <th className={T.th}>Model</th>
                <th className={T.th}>Tier</th>
                <th className={cn(T.th, 'text-right')}>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {enabled.map(id => {
                const tier = tierForModel(id);
                const meta = byId.get(id);
                return (
                  <tr key={id}>
                    <td className={T.td}>
                      <div className="flex items-center gap-1.5">
                        <b className="font-mono text-[12px] text-foreground">{id}</b>
                        {id === conn.defaultModel && (
                          <span className="rounded-full bg-secondary px-1.5 py-px text-[8.5px] font-bold text-muted-foreground">
                            default
                          </span>
                        )}
                      </div>
                      <span className="text-[10.5px] text-[var(--archon-faint)]">
                        {meta?.description ?? TIER_META[tier].hint}
                      </span>
                    </td>
                    <td className={T.td}>
                      <span className={cn('inline-block rounded-full px-2 py-0.5 text-[10px] font-bold', TIER_META[tier].badgeClass)}>
                        {TIER_META[tier].label}
                      </span>
                    </td>
                    <td className={cn(T.td, 'text-right')}>
                      <Switch checked disabled={saving} onCheckedChange={() => toggle(id)} aria-label={`Disable ${id}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-border px-3.5 py-2.5">
        <ModelCombobox
          models={options}
          selectedIds={enabled}
          loading={fetching}
          keepOpenOnSelect
          placeholder={`Search ${options.length} models — click to enable or disable…`}
          onSelect={m => toggle(m.id)}
        />
        {fetchError && (
          <p className="mt-1.5 text-[10.5px] text-destructive">
            Couldn't fetch the live list ({fetchError}){' '}
            <button type="button" className="font-semibold underline" onClick={() => setFetchSeq(s => s + 1)}>
              retry
            </button>{' '}
            — showing built-in defaults meanwhile.
          </p>
        )}
      </div>
      <NoteBar>Only enabled models appear when building an agent.</NoteBar>
    </SpecCard>
  );
}

export default function AiConnectionsPage() {
  const [rows, setRows] = useState<ConnectionSummary[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selected, setSelected] = useState<string>('claude');
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null);
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
  const selectedConn = providerRows.find(r => r.id === selectedConnId) ?? providerRows[0] ?? null;
  const failingHere = providerRows.filter(r => r.validationStatus === 'Failed').length;

  // ── Stat strip, computed from real data only ──
  const providersConnected = PROVIDERS.filter(p => rows.some(r => r.engineType === p.key)).length;
  const failedKeys = rows.filter(r => r.validationStatus === 'Failed').length;
  const modelsEnabled = rows.reduce((n, r) => n + effectiveEnabledModels(r).length, 0);

  const openCreate = useCallback(() => {
    setEditing(null);
    setDialogOpen(true);
  }, []);

  const handleDelete = useCallback(async (row: ConnectionSummary) => {
    const ok = await confirmDialog({
      title: `Delete "${row.label}"?`,
      description: 'Agents using this connection will fall back to another active one, or fail.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    });
    if (!ok) return;
    setBusyId(row.id);
    deleteEngineConnection(row.id)
      .then(() => {
        toast.success(`"${row.label}" deleted.`);
        setRows(list => list.filter(r => r.id !== row.id));
      })
      .catch(err => {
        console.error('Delete failed:', err);
        toast.error('Delete failed', { description: err instanceof Error ? err.message : undefined });
      })
      .finally(() => setBusyId(null));
  }, []);

  const handleTest = useCallback(
    (row: ConnectionSummary) => {
      setBusyId(row.id);
      testEngineConnection(row.id)
        .then(result =>
          result.success
            ? toast.success('Connection OK.')
            : toast.error('Connection test failed', { description: result.message })
        )
        .catch(err => {
          console.error('Test failed:', err);
          toast.error('Connection test failed', { description: err instanceof Error ? err.message : undefined });
        })
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
    <AppShell title="AI Models" onRefresh={load}>
      <PageBody width="standard">
        {/* ── Stat strip ── */}
        <div className="mb-3.5 grid grid-cols-4 gap-3">
          <StatCard
            label="Providers connected"
            value={providersConnected}
            sub={`of ${PROVIDERS.length} available`}
          />
          <StatCard
            label="Keys in use"
            value={rows.length}
            sub={failedKeys > 0 ? `${failedKeys} rejected` : 'none failing'}
            subClass={failedKeys > 0 ? 'text-[var(--archon-error)]' : undefined}
          />
          <StatCard
            label="Models enabled"
            value={modelsEnabled}
            sub="these appear in every picker"
          />
          <StatCard
            label="Model spend"
            value="—"
            valueClass="text-[var(--archon-faint)]"
            sub="arrives with per-model pricing"
          />
        </div>

        <div className="grid grid-cols-[230px_1fr] items-start gap-3.5">
          {/* ── Provider rail ── */}
          <SpecCard title="Providers" className="overflow-hidden">
            {PROVIDERS.map(p => {
              const pRows = rows.filter(r => r.engineType === p.key);
              const dot = providerDotColor(pRows);
              const pModels = pRows.reduce((n, r) => n + effectiveEnabledModels(r).length, 0);
              const none = pRows.length === 0;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setSelected(p.key)}
                  className={cn(
                    'grid w-full grid-cols-[1fr_auto] items-center border-b border-border px-3.5 py-2.5 text-left last:border-b-0',
                    selected === p.key
                      ? 'bg-accent shadow-[inset_3px_0_0_var(--primary)]'
                      : 'hover:bg-secondary'
                  )}
                >
                  <b className={cn('text-[12px]', none ? 'text-[var(--archon-faint)]' : 'text-foreground')}>
                    {p.name}
                  </b>
                  {dot && <span className="row-span-2 h-[7px] w-[7px] rounded-full" style={{ background: dot }} />}
                  <span className="col-start-1 text-[10.5px] text-[var(--archon-faint)]">
                    {none
                      ? 'Not connected'
                      : `${pRows.length} key${pRows.length === 1 ? '' : 's'} · ${pModels} model${pModels === 1 ? '' : 's'}`}
                  </span>
                </button>
              );
            })}
            <div className="p-2.5">
              <Button variant="outline" size="sm" className="h-8 w-full justify-center text-xs" onClick={openCreate}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add provider
              </Button>
            </div>
          </SpecCard>

          {/* ── Provider detail ── */}
          <div className="grid min-w-0 gap-3.5">
            {/* Keys */}
            <SpecCard
              title={providerMeta.name}
              muted={providerMeta.sub}
              right={
                <>
                  {failingHere > 0 && (
                    <StatusBadge tone="error">
                      {failingHere} key{failingHere === 1 ? '' : 's'} failing
                    </StatusBadge>
                  )}
                  <Button size="sm" className="h-7 text-[11px]" onClick={openCreate}>
                    <Plus className="mr-1 h-3 w-3" /> Add key
                  </Button>
                </>
              }
            >
              <div className="grid gap-2.5 p-3.5">
                {loadState === 'loading' && (
                  <div className="flex items-center gap-2 py-4 text-[12.5px] text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                  </div>
                )}
                {loadState === 'error' && (
                  <p className="py-4 text-[12.5px] text-destructive">
                    Couldn't load AI connections.{' '}
                    <button type="button" className="font-semibold underline" onClick={load}>
                      Retry
                    </button>
                  </p>
                )}
                {loadState === 'ready' && providerRows.length === 0 && (
                  <EmptyPanel>
                    No {providerMeta.name} key yet — add an API key to run agents on {providerMeta.sub}.
                  </EmptyPanel>
                )}

                {loadState === 'ready' &&
                  providerRows.map(r => {
                    const failed = r.validationStatus === 'Failed';
                    const isSel = selectedConn?.id === r.id;
                    const metaBits = [
                      r.isMine ? 'mine' : r.userName,
                      r.endpoint,
                      r.defaultModel ? `default ${r.defaultModel}` : null,
                      `${effectiveEnabledModels(r).length} models enabled`,
                      fmtWhen(r.lastValidatedAt) ? `Last tested ${fmtWhen(r.lastValidatedAt)}` : null,
                      fmtWhen(r.lastUsedAt) ? `Last used ${fmtWhen(r.lastUsedAt)}` : null,
                    ].filter((x): x is string => Boolean(x));
                    return (
                      <div
                        key={r.id}
                        onClick={() => setSelectedConnId(r.id)}
                        className={cn(
                          'cursor-pointer rounded-lg border px-[13px] py-[11px]',
                          failed ? 'border-[var(--archon-error)] bg-[var(--archon-error-tint)]' : 'border-border bg-card',
                          isSel && 'ring-1 ring-[var(--primary)]'
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: connDotColor(r.validationStatus) }}
                          />
                          <b className="text-[12.5px] text-foreground">{r.label}</b>
                          {r.isPreferred && (
                            <Star className="h-3.5 w-3.5 shrink-0 fill-current text-[var(--node-amber)]" />
                          )}
                          <StatusBadge tone="muted">{r.ownershipType}</StatusBadge>
                          {r.isPublicShared && <StatusBadge tone="blue">Public</StatusBadge>}
                          <span className="ml-auto flex items-center gap-2">
                            <KeyStatusBadge status={r.validationStatus} />
                            <Switch
                              checked={r.isActive}
                              disabled={busyId === r.id}
                              onCheckedChange={() => handleToggleActive(r)}
                              aria-label="Active — available to agents"
                            />
                          </span>
                        </div>

                        <div className="mt-1.5 text-[10.5px] text-muted-foreground">
                          {metaBits.join(' · ')}
                        </div>

                        {failed && (
                          <div className="mt-1.5 text-[11.5px] text-[var(--archon-error)]">
                            The provider refused this key on the last test — it has most likely been
                            rotated or revoked. Edit it to paste a new key, or test again.
                          </div>
                        )}

                        <div className="mt-2.5 flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            disabled={busyId === r.id}
                            onClick={() => handleTest(r)}
                          >
                            {busyId === r.id ? (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            ) : (
                              <TestTube2 className="mr-1 h-3 w-3" />
                            )}
                            {failed ? 'Test again' : 'Test'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            onClick={() => {
                              setEditing(r);
                              setDialogOpen(true);
                            }}
                          >
                            Edit
                          </Button>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => handleDelete(r)}
                            className="ml-auto flex items-center gap-1 rounded p-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Remove ${r.label}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </SpecCard>

            {/* Enabled models for the selected key */}
            {selectedConn ? (
              <ModelsCard conn={selectedConn} onSaved={models => handleModelsSaved(selectedConn.id, models)} />
            ) : (
              <SpecCard title="Models" muted="only enabled models appear when building an agent">
                <div className="px-3.5 py-5 text-[12px] text-muted-foreground">
                  Add a key first — models are enabled per connection.
                </div>
                <NoteBar>Only enabled models appear when building an agent.</NoteBar>
              </SpecCard>
            )}

            {/* Routing defaults — not stored by the platform yet, so the
                selects are disabled and nothing pretends to persist. */}
            <SpecCard title="Which model runs what" muted="defaults for new agents, overridable per step">
              {ROUTE_ROWS.map(route => (
                <div
                  key={route.title}
                  className="flex items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0"
                >
                  <IconSquare bg={route.bg} color={route.color}>
                    {route.glyph}
                  </IconSquare>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-bold text-foreground">{route.title}</div>
                    <div className="text-[10.5px] text-[var(--archon-faint)]">{route.sub}</div>
                  </div>
                  <select
                    disabled
                    className="h-8 w-[190px] rounded-[5px] border border-input bg-secondary/50 px-2 font-mono text-[11.5px] text-muted-foreground opacity-70"
                  >
                    <option>Not configured yet</option>
                  </select>
                </div>
              ))}
              <NoteBar>
                Routing defaults aren't stored yet — they arrive in an upcoming release. Putting short
                decisions on the cheapest model is usually the single biggest saving available, because
                routing is most of your calls and almost none of your thinking.
              </NoteBar>
            </SpecCard>

            {/* Spend by model — no usage metering yet, so no chart. */}
            <EmptyPanel>Per-model spend arrives with usage metering.</EmptyPanel>
          </div>
        </div>
      </PageBody>

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
