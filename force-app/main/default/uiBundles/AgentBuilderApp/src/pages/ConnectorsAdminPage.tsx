import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Loader2, Plug, Plus, Server, Trash2 } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  AccessChip,
  AttnRow,
  EmptyPanel,
  IconSquare,
  NoteBar,
  SpecCard,
  StatCard,
  StatusBadge,
  T,
} from '@/components/spec/blocks';
import { loadConnectorDirectoryWithRetry, type DirectoryEntry } from '@/lib/connectors-data';
import {
  loadCustomMcpServers,
  saveCustomMcpServer,
  deleteCustomMcpServer,
  disconnectConnector,
  type CustomMcpServer,
} from '@/lib/connector-admin-data';
import {
  loadToolCatalog,
  parseToolArgs,
  type CatalogTool,
  type ConnectorToolGroup,
  type ToolAccess,
} from '@/lib/tool-catalog';

/** Connectors — approved spec screens 06/07/08: one page, shared stat
 *  row, segmented Directory / All tools / Tool details views. Directory
 *  and custom-server CRUD talk to the same endpoints as before; the tool
 *  catalog is enumerated LIVE per connected connector via tools/list
 *  (tool-catalog.ts), so every count on this page is real or "—". */

type TabKey = 'dir' | 'all' | 'det';
type AccessFilter = 'all' | ToolAccess;

function SegTabs({ tab, onChange }: { tab: TabKey; onChange: (t: TabKey) => void }) {
  const TABS: Array<[TabKey, string]> = [
    ['dir', 'Directory'],
    ['all', 'All tools'],
    ['det', 'Tool details'],
  ];
  return (
    <div className="mb-3.5 inline-flex gap-0.5 rounded-md bg-[#eef0f3] p-0.5">
      {TABS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            'rounded-[5px] px-3 py-[5px] text-[11.5px] font-semibold transition-colors',
            tab === key ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-[3px] text-[10.5px] font-semibold transition-colors',
        on ? 'border-primary bg-primary text-white' : 'border-border bg-card text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

/** Short access marker for the tool tree ("writes" / "deletes"). */
function MiniAccess({ access }: { access: ToolAccess }) {
  if (access === 'read') return null;
  return (
    <span
      className={cn(
        'ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold',
        access === 'delete'
          ? 'bg-[var(--archon-error-tint)] text-[var(--archon-error)]'
          : 'bg-[var(--archon-warning-tint)] text-[var(--archon-warning)]'
      )}
    >
      {access === 'delete' ? 'deletes' : 'writes'}
    </span>
  );
}

function CustomMcpDialog({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: CustomMcpServer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [serverName, setServerName] = useState('');
  const [mcpServerUrl, setMcpServerUrl] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Other');
  const [catalogType, setCatalogType] = useState('custom_mcp_tools');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setServerName(editing?.Name ?? '');
      setMcpServerUrl(editing?.McpServerUrl__c ?? '');
      setDescription(editing?.Description__c ?? '');
      setCategory(editing?.Category__c ?? 'Other');
      setCatalogType(editing?.CatalogType__c ?? 'custom_mcp_tools');
    }
  }, [open, editing]);

  const handleSave = () => {
    if (!serverName.trim() || !mcpServerUrl.trim()) return;
    setSaving(true);
    saveCustomMcpServer({ recordId: editing?.Id ?? null, serverName, mcpServerUrl, description, category, catalogType })
      .then(() => {
        setSaving(false);
        onSaved();
        onClose();
      })
      .catch(err => {
        console.error('Failed to save custom MCP server:', err);
        toast.error('Save failed', { description: err instanceof Error ? err.message : undefined });
        setSaving(false);
      });
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit custom MCP server' : 'New custom MCP server'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Server name</Label>
            <Input value={serverName} onChange={e => setServerName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>MCP server URL</Label>
            <Input value={mcpServerUrl} onChange={e => setMcpServerUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Input value={category} onChange={e => setCategory(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Catalog type</Label>
              <Input value={catalogType} onChange={e => setCatalogType(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !serverName.trim() || !mcpServerUrl.trim()}>
            {saving && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ConnectorsAdminPage() {
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [dirLoadState, setDirLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dirWaking, setDirWaking] = useState(false);
  const [customServers, setCustomServers] = useState<CustomMcpServer[]>([]);
  const [customLoadState, setCustomLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; editing: CustomMcpServer | null }>({ open: false, editing: null });

  const [tab, setTab] = useState<TabKey>('dir');
  const [dirSearch, setDirSearch] = useState('');
  const [toolGroups, setToolGroups] = useState<ConnectorToolGroup[] | null>(null);
  const [catalogState, setCatalogState] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [toolsWaking, setToolsWaking] = useState(false);
  const [accessFilter, setAccessFilter] = useState<AccessFilter>('all');
  const [connectorFilter, setConnectorFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ providerKey: string; name: string } | null>(null);
  const [treeFilter, setTreeFilter] = useState('');

  const loadDirectory = useCallback(() => {
    setDirLoadState('loading');
    setDirWaking(false);
    loadConnectorDirectoryWithRetry(() => setDirWaking(true))
      .then(entries => {
        setDirectory(entries);
        setDirLoadState('ready');
      })
      .catch(err => {
        console.error('Failed to load connector directory:', err);
        setDirLoadState('error');
      });
  }, []);

  const loadCustom = useCallback(() => {
    setCustomLoadState('loading');
    loadCustomMcpServers()
      .then(rows => {
        setCustomServers(rows);
        setCustomLoadState('ready');
      })
      .catch(err => {
        console.error('Failed to load custom MCP servers:', err);
        setCustomLoadState('error');
      });
  }, []);

  useEffect(() => {
    loadDirectory();
    loadCustom();
  }, [loadDirectory, loadCustom]);

  // One live tools/list per connected connector, kicked off as soon as the
  // directory arrives (the stat row needs the counts, not just the tabs).
  // Cached for the life of the page; Refresh in the top bar re-runs it.
  useEffect(() => {
    if (dirLoadState !== 'ready') return;
    if (!directory.some(d => d.status === 'Connected')) {
      setToolGroups([]);
      setCatalogState('ready');
      return;
    }
    let cancelled = false;
    setCatalogState('loading');
    setToolsWaking(false);
    loadToolCatalog(directory, () => {
      if (!cancelled) setToolsWaking(true);
    })
      .then(groups => {
        if (cancelled) return;
        setToolGroups(groups);
        setCatalogState('ready');
      })
      .catch(() => {
        // loadToolCatalog settles per connector and should never reject;
        // belt-and-braces so the page never wedges in "loading".
        if (cancelled) return;
        setToolGroups([]);
        setCatalogState('ready');
      });
    return () => {
      cancelled = true;
    };
  }, [directory, dirLoadState]);

  const refreshAll = useCallback(() => {
    loadDirectory();
    loadCustom();
  }, [loadDirectory, loadCustom]);

  const handleConnect = useCallback((entry: DirectoryEntry) => {
    if (entry.providerKey === 'salesforce_mcp') {
      toast.info('Already connected via Setup', {
        description:
          'The org-wide Salesforce connection is managed on the Setup page. Per-user access for PerUser-mode agents connects itself from inside a chat session.',
      });
      return;
    }
    toast.info(`${entry.displayName} isn't wired up yet — coming soon.`);
  }, []);

  const handleDisconnect = useCallback(
    async (entry: DirectoryEntry) => {
      if (!entry.connectorId) return;
      if (!(await confirmDialog({ title: `Disconnect ${entry.displayName}?`, confirmLabel: 'Disconnect', variant: 'destructive' }))) return;
      setBusyId(entry.connectorId);
      disconnectConnector(entry.connectorId)
        .then(() => {
          toast.success(`${entry.displayName} disconnected.`);
          loadDirectory();
        })
        .catch(err => {
          console.error('Disconnect failed:', err);
          toast.error('Disconnect failed', { description: err instanceof Error ? err.message : undefined });
        })
        .finally(() => setBusyId(null));
    },
    [loadDirectory]
  );

  const handleDeleteCustom = useCallback(
    async (row: CustomMcpServer) => {
      if (!(await confirmDialog({ title: `Delete "${row.Name}"?`, description: "This can't be undone.", confirmLabel: 'Delete', variant: 'destructive' }))) return;
      setBusyId(row.Id);
      deleteCustomMcpServer(row.Id)
        .then(() => {
          toast.success(`"${row.Name}" deleted.`);
          setCustomServers(list => list.filter(r => r.Id !== row.Id));
        })
        .catch(err => {
          console.error('Delete failed:', err);
          toast.error('Delete failed', { description: err instanceof Error ? err.message : undefined });
        })
        .finally(() => setBusyId(null));
    },
    []
  );

  // ── Derived, all from real payloads — never fabricated ─────────────
  const connectedCount = useMemo(() => directory.filter(d => d.status === 'Connected').length, [directory]);
  const sortedGroups = useMemo(() => {
    const list = [...(toolGroups ?? [])];
    list.sort((a, b) => Number(a.isCustom) - Number(b.isCustom) || a.displayName.localeCompare(b.displayName));
    return list;
  }, [toolGroups]);
  const readyGroups = useMemo(() => sortedGroups.filter(g => g.state === 'ready'), [sortedGroups]);
  const erroredGroups = useMemo(() => sortedGroups.filter(g => g.state === 'error'), [sortedGroups]);
  const totalTools = useMemo(() => readyGroups.reduce((n, g) => n + g.tools.length, 0), [readyGroups]);
  const toolCountByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of readyGroups) map.set(g.providerKey, g.tools.length);
    return map;
  }, [readyGroups]);
  // Custom MCP records surface in the directory as isCustom entries whose
  // display name is the record's Name — the only client-side join we have.
  const customProviderKeyByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of directory) if (d.isCustom) map.set(d.displayName, d.providerKey);
    return map;
  }, [directory]);

  const filteredDirectory = useMemo(() => {
    const q = dirSearch.trim().toLowerCase();
    if (!q) return directory;
    return directory.filter(
      d => d.displayName.toLowerCase().includes(q) || (d.description ?? '').toLowerCase().includes(q)
    );
  }, [directory, dirSearch]);

  // Tool selected in the details tab — falls back to the first listed tool
  // so the tab never opens onto nothing while a catalog exists.
  const selectedResolved = useMemo((): { group: ConnectorToolGroup; tool: CatalogTool } | null => {
    if (selected) {
      for (const g of readyGroups) {
        if (g.providerKey !== selected.providerKey) continue;
        const tool = g.tools.find(t => t.name === selected.name);
        if (tool) return { group: g, tool };
      }
    }
    const first = readyGroups.find(g => g.tools.length > 0);
    const firstTool = first?.tools[0];
    return first && firstTool ? { group: first, tool: firstTool } : null;
  }, [selected, readyGroups]);

  const openDetails = useCallback((group: ConnectorToolGroup, tool: CatalogTool) => {
    setSelected({ providerKey: group.providerKey, name: tool.name });
    setTab('det');
  }, []);

  // ── Stat row (spec: 4 cards, shared across all three views) ────────
  const toolsStat = useMemo((): { value: ReactNode; sub: ReactNode } => {
    if (dirLoadState !== 'ready') return { value: '—', sub: '' };
    if (connectedCount === 0) return { value: 0, sub: 'connect a connector to list tools' };
    if (catalogState !== 'ready') {
      return { value: '—', sub: toolsWaking ? 'tool server is waking up…' : 'listing live from tool servers…' };
    }
    if (readyGroups.length === 0) return { value: '—', sub: 'tool servers did not respond' };
    return {
      value: totalTools,
      sub:
        `across ${readyGroups.length} connector${readyGroups.length === 1 ? '' : 's'}` +
        (erroredGroups.length > 0 ? ` · ${erroredGroups.length} did not respond` : ''),
    };
  }, [dirLoadState, connectedCount, catalogState, toolsWaking, readyGroups, erroredGroups, totalTools]);

  const connectorFilterEntry = connectorFilter ? sortedGroups.find(g => g.providerKey === connectorFilter) ?? null : null;

  const visibleGroups = useMemo(
    () => sortedGroups.filter(g => !connectorFilter || g.providerKey === connectorFilter),
    [sortedGroups, connectorFilter]
  );

  const matchesAccess = useCallback(
    (tool: CatalogTool) => accessFilter === 'all' || tool.access === accessFilter,
    [accessFilter]
  );

  return (
    <AppShell title="Connectors" onRefresh={refreshAll}>
      <div className="mx-auto w-full max-w-[1180px] p-5">
        {/* ── Shared stat row ─────────────────────────────────────── */}
        <div className="mb-3.5 grid grid-cols-4 gap-3">
          <StatCard
            label="Connected"
            value={dirLoadState === 'ready' ? connectedCount : '—'}
            sub={dirLoadState === 'ready' ? `of ${directory.length} in the directory` : dirWaking ? 'server is waking up…' : 'loading…'}
          />
          <StatCard
            label="Available"
            value={dirLoadState === 'ready' ? directory.length - connectedCount : '—'}
            sub={dirLoadState === 'ready' ? 'ready to authorise' : ''}
          />
          <StatCard
            label="Custom servers"
            value={customLoadState === 'ready' ? customServers.length : '—'}
            sub={customLoadState === 'ready' ? 'added by your team' : customLoadState === 'error' ? 'could not load' : 'loading…'}
          />
          <StatCard label="Tools available" value={toolsStat.value} sub={toolsStat.sub} />
        </div>

        <SegTabs tab={tab} onChange={setTab} />

        {/* ════════ 06 DIRECTORY ════════ */}
        {tab === 'dir' && (
          <>
            <SpecCard
              title="Directory"
              muted="pre-integrated, just authorise and go"
              right={
                <Input
                  value={dirSearch}
                  onChange={e => setDirSearch(e.target.value)}
                  placeholder="Search connectors"
                  className="h-7 w-[170px] text-[12px]"
                />
              }
            >
              {dirLoadState === 'loading' && (
                <div className="flex items-center gap-2 px-3.5 py-5 text-[12.5px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {dirWaking ? 'The server is waking up — this can take a minute…' : 'Loading…'}
                </div>
              )}
              {dirLoadState === 'error' && (
                <div className="flex items-center gap-3 px-3.5 py-5 text-[12.5px] text-destructive">
                  Couldn't load the directory.
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={loadDirectory}>
                    Retry
                  </Button>
                </div>
              )}
              {dirLoadState === 'ready' && filteredDirectory.length === 0 && (
                <div className="px-3.5 py-5 text-[12.5px] text-muted-foreground">No connectors match "{dirSearch}".</div>
              )}
              {dirLoadState === 'ready' && filteredDirectory.length > 0 && (
                <div className="grid grid-cols-3">
                  {filteredDirectory.map(entry => {
                    const toolCount = toolCountByKey.get(entry.providerKey);
                    const connected = entry.status === 'Connected';
                    return (
                      <div
                        key={entry.providerKey}
                        className="flex items-start gap-3 border-b border-r border-[#eceef1] p-3.5 [&:nth-child(3n)]:border-r-0"
                      >
                        <IconSquare bg={entry.brandColor ?? 'var(--node-gray)'}>
                          <Plug className="h-4 w-4" />
                        </IconSquare>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12.5px] font-bold text-foreground">{entry.displayName}</div>
                          <div className="mb-1.5 mt-0.5 truncate text-[10.5px] text-[var(--archon-faint)]">
                            {entry.description ?? entry.category ?? 'MCP connector'}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {connected ? (
                              <StatusBadge tone="ok">Connected</StatusBadge>
                            ) : entry.status === 'Error' ? (
                              <StatusBadge tone="error">
                                <span title={entry.lastErrorMessage ?? undefined}>Error</span>
                              </StatusBadge>
                            ) : (
                              <StatusBadge tone="muted">Not connected</StatusBadge>
                            )}
                            {connected && toolCount != null && (
                              <span className="font-mono text-[10px] text-[var(--archon-faint)]">{toolCount} tools</span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col gap-1.5">
                          {connected ? (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 px-2 text-[11px]"
                                onClick={() => {
                                  setConnectorFilter(entry.providerKey);
                                  setAccessFilter('all');
                                  setTab('all');
                                }}
                              >
                                View tools
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 px-2 text-[11px]"
                                disabled={busyId === entry.connectorId}
                                onClick={() => handleDisconnect(entry)}
                              >
                                Disconnect
                              </Button>
                            </>
                          ) : (
                            <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => handleConnect(entry)}>
                              Authorise
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SpecCard>

            {/* Custom MCP servers */}
            <SpecCard
              className="mt-3.5"
              title="Custom MCP servers"
              muted="point at any server that speaks MCP"
              right={
                <Button size="sm" className="h-7 text-[11px]" onClick={() => setDialog({ open: true, editing: null })}>
                  <Plus className="mr-1 h-3 w-3" /> Add server
                </Button>
              }
            >
              {customLoadState === 'loading' && (
                <div className="flex items-center gap-2 px-3.5 py-4 text-[12.5px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                </div>
              )}
              {customLoadState === 'error' && (
                <div className="px-3.5 py-4 text-[12.5px] text-destructive">Couldn't load custom servers.</div>
              )}
              {customLoadState === 'ready' && customServers.length === 0 && (
                <div className="px-3.5 py-4 text-[12px] text-muted-foreground">
                  No custom MCP servers yet — add one to expose its tools to your agents.
                </div>
              )}
              {customLoadState === 'ready' &&
                customServers.map(s => (
                  <AttnRow
                    key={s.Id}
                    icon={
                      <IconSquare bg="var(--node-purple-tint)" color="var(--node-purple)">
                        <Server className="h-3.5 w-3.5" />
                      </IconSquare>
                    }
                    title={s.Name}
                    sub={<span className="font-mono">{s.McpServerUrl__c}</span>}
                  >
                    {(() => {
                      const key = customProviderKeyByName.get(s.Name);
                      const count = key != null ? toolCountByKey.get(key) : undefined;
                      return count != null ? (
                        <span className="font-mono text-[11px] text-muted-foreground">{count} tools</span>
                      ) : null;
                    })()}
                    {s.IsActive__c ? <StatusBadge tone="ok">Active</StatusBadge> : <StatusBadge tone="muted">Off</StatusBadge>}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setDialog({ open: true, editing: s })}
                    >
                      Manage
                    </Button>
                    <button
                      type="button"
                      disabled={busyId === s.Id}
                      onClick={() => handleDeleteCustom(s)}
                      className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </AttnRow>
                ))}
              <NoteBar>
                Servers added here join the directory and the builder's tool pickers. Their tools are listed live from
                the server each time — nothing is cached in Salesforce.
              </NoteBar>
            </SpecCard>
          </>
        )}

        {/* ════════ 07 ALL TOOLS ════════ */}
        {tab === 'all' && (
          <>
            {dirLoadState === 'error' ? (
              <EmptyPanel>Couldn't load the connector directory — use Refresh to try again.</EmptyPanel>
            ) : dirLoadState === 'ready' && connectedCount === 0 ? (
              <EmptyPanel>
                Tools appear here once a connector is connected — authorise one in the Directory tab.
              </EmptyPanel>
            ) : (
              <SpecCard
                title="Tool catalog"
                muted="everything your agents can call"
                right={
                  <div className="flex flex-wrap items-center gap-1.5">
                    {connectorFilterEntry && (
                      <FilterChip on onClick={() => setConnectorFilter(null)}>
                        {connectorFilterEntry.displayName} ✕
                      </FilterChip>
                    )}
                    {(
                      [
                        ['all', 'All'],
                        ['read', 'Read only'],
                        ['write', 'Changes data'],
                        ['delete', 'Deletes data'],
                      ] as Array<[AccessFilter, string]>
                    ).map(([key, label]) => (
                      <FilterChip key={key} on={accessFilter === key} onClick={() => setAccessFilter(key)}>
                        {label}
                      </FilterChip>
                    ))}
                  </div>
                }
              >
                {catalogState !== 'ready' ? (
                  <div className="flex items-center gap-2 px-3.5 py-6 text-[12.5px] text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {toolsWaking
                      ? 'A tool server is waking up — listing can take a minute…'
                      : 'Listing tools live from each connected server…'}
                  </div>
                ) : (
                  <>
                    <table className={T.table}>
                      <thead>
                        <tr>
                          <th className={T.th}>Tool</th>
                          <th className={T.th}>Access</th>
                          <th className={cn(T.th, 'text-right')}>Approval</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleGroups.map(group => {
                          const tools = group.tools.filter(matchesAccess);
                          if (group.state === 'ready' && tools.length === 0 && accessFilter !== 'all') return null;
                          return (
                            <Fragment key={group.providerKey}>
                              <tr>
                                <td
                                  colSpan={3}
                                  className="border-b border-[#eceef1] bg-[#f7f8f9] px-3 py-1.5 text-[10.5px] font-bold text-muted-foreground"
                                >
                                  {group.displayName}{' '}
                                  <span className="font-normal">
                                    — {group.state === 'error'
                                      ? 'could not list tools'
                                      : group.description ?? (group.isCustom ? 'custom MCP server' : 'MCP connector')}
                                  </span>
                                </td>
                              </tr>
                              {group.state === 'error' ? (
                                <tr>
                                  <td colSpan={3} className={cn(T.td, 'text-[11.5px] text-muted-foreground')}>
                                    The tool server didn't respond — use Refresh to try again.
                                  </td>
                                </tr>
                              ) : (
                                tools.map(tool => (
                                  <tr key={tool.name} className={T.trClick} onClick={() => openDetails(group, tool)}>
                                    <td className={T.td}>
                                      <span className="font-mono text-[12px] font-semibold text-primary hover:underline">
                                        {tool.name}
                                      </span>
                                      {tool.description && (
                                        <div className="max-w-[560px] truncate text-[10px] text-[var(--archon-faint)]">
                                          {tool.description}
                                        </div>
                                      )}
                                    </td>
                                    <td className={T.td}>
                                      <AccessChip level={tool.access} />
                                    </td>
                                    {/* Approval rules live on each agent's Tool node
                                        (requiresApproval) — not readable from here, and
                                        delete-tools are NOT platform-blocked. Honest "—". */}
                                    <td className={cn(T.td, 'text-right text-[11px] text-[var(--archon-faint)]')}>—</td>
                                  </tr>
                                ))
                              )}
                            </Fragment>
                          );
                        })}
                        {visibleGroups.every(g => g.state === 'ready' && g.tools.filter(matchesAccess).length === 0) && (
                          <tr>
                            <td colSpan={3} className={cn(T.td, 'text-[12px] text-muted-foreground')}>
                              No tools match this filter.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    <NoteBar>
                      Listed live from each connector's tool server. Access is inferred from the tool's name — a review
                      hint, not an enforcement. Approval is configured per agent on its Tool nodes, so no blanket rule
                      is shown here.
                    </NoteBar>
                  </>
                )}
              </SpecCard>
            )}
          </>
        )}

        {/* ════════ 08 TOOL DETAILS ════════ */}
        {tab === 'det' && (
          <>
            {dirLoadState === 'error' ? (
              <EmptyPanel>Couldn't load the connector directory — use Refresh to try again.</EmptyPanel>
            ) : dirLoadState === 'ready' && connectedCount === 0 ? (
              <EmptyPanel>
                Tools appear here once a connector is connected — authorise one in the Directory tab.
              </EmptyPanel>
            ) : catalogState !== 'ready' ? (
              <div className="flex items-center gap-2 py-6 text-[12.5px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {toolsWaking ? 'A tool server is waking up — listing can take a minute…' : 'Listing tools…'}
              </div>
            ) : (
              <div className="grid grid-cols-[230px_1fr] items-start gap-3.5">
                {/* Left: tool tree grouped by connector */}
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  <div className="p-2.5">
                    <Input
                      value={treeFilter}
                      onChange={e => setTreeFilter(e.target.value)}
                      placeholder="Filter tools"
                      className="h-7 text-[12px]"
                    />
                  </div>
                  {readyGroups.map(group => {
                    const q = treeFilter.trim().toLowerCase();
                    const tools = q ? group.tools.filter(t => t.name.toLowerCase().includes(q)) : group.tools;
                    if (q && tools.length === 0) return null;
                    return (
                      <Fragment key={group.providerKey}>
                        <div className="flex items-center gap-1.5 border-y border-border bg-[#f7f8f9] px-3 py-[7px] text-[10.5px] font-bold text-muted-foreground">
                          <span className="truncate">{group.displayName}</span>
                          <span className="ml-auto font-mono font-normal text-[var(--archon-faint)]">{group.tools.length}</span>
                        </div>
                        {tools.map(tool => {
                          const on =
                            selectedResolved != null &&
                            selectedResolved.group.providerKey === group.providerKey &&
                            selectedResolved.tool.name === tool.name;
                          return (
                            <button
                              key={tool.name}
                              type="button"
                              onClick={() => setSelected({ providerKey: group.providerKey, name: tool.name })}
                              className={cn(
                                'flex w-full items-center border-b border-[#f2f3f5] px-3 py-1.5 text-left font-mono text-[11px] text-primary hover:bg-[#f8fafc]',
                                on && 'bg-[#f4f9fe] font-semibold shadow-[inset_3px_0_0_var(--primary)]'
                              )}
                            >
                              <span className="truncate">{tool.name}</span>
                              <MiniAccess access={tool.access} />
                            </button>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                  {erroredGroups.map(group => (
                    <div key={group.providerKey} className="flex items-center gap-1.5 border-y border-border bg-[#f7f8f9] px-3 py-[7px] text-[10.5px] font-bold text-muted-foreground opacity-60">
                      <span className="truncate">{group.displayName}</span>
                      <StatusBadge tone="muted" className="ml-auto">Offline</StatusBadge>
                    </div>
                  ))}
                  {dirLoadState === 'ready' && directory.length - connectedCount > 0 && (
                    <div className="px-3 py-2 text-[10.5px] text-[var(--archon-faint)]">
                      {directory.length - connectedCount} more not connected ·{' '}
                      <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setTab('dir')}>
                        Open Directory
                      </button>
                    </div>
                  )}
                </div>

                {/* Right: selected tool */}
                {selectedResolved == null ? (
                  <EmptyPanel>No tools listed yet — the connected servers didn't return any.</EmptyPanel>
                ) : (
                  <div className="rounded-lg border border-border bg-card">
                    <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
                      <IconSquare bg={selectedResolved.group.brandColor ?? 'var(--node-gray)'} size={24}>
                        <Plug className="h-3 w-3" />
                      </IconSquare>
                      <b className="font-mono text-[12.5px] text-foreground">{selectedResolved.tool.name}</b>
                      <AccessChip level={selectedResolved.tool.access} />
                      <span className="ml-auto text-[10.5px] text-[var(--archon-faint)]">
                        {selectedResolved.group.displayName}
                      </span>
                    </div>
                    <div className="px-3.5 py-3 text-[12px] text-foreground">
                      {selectedResolved.tool.description ?? (
                        <span className="text-muted-foreground">The tool server provides no description for this tool.</span>
                      )}
                    </div>
                    {(() => {
                      const args = parseToolArgs(selectedResolved.tool.inputSchema);
                      if (args === null) {
                        return (
                          <div className="px-3.5 pb-3.5">
                            <EmptyPanel>Argument details load from the tool server — connect and refresh.</EmptyPanel>
                          </div>
                        );
                      }
                      return (
                        <>
                          <div className="px-3.5 pb-1 pt-1">
                            <div className="text-[10px] font-bold uppercase tracking-[.04em] text-[var(--archon-faint)]">
                              What the agent has to supply
                            </div>
                          </div>
                          {args.length === 0 ? (
                            <div className="border-t border-[#eceef1] px-3.5 py-2.5 text-[11.5px] text-muted-foreground">
                              This tool takes no arguments.
                            </div>
                          ) : (
                            args.map(arg => (
                              <div key={arg.name} className="flex items-center gap-2.5 border-t border-[#eceef1] px-3.5 py-2 text-[11.5px]">
                                <span style={{ color: arg.required ? 'var(--archon-error)' : 'var(--archon-faint)' }}>●</span>
                                <b className="w-[140px] shrink-0 truncate font-mono text-foreground">{arg.name}</b>
                                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                  {arg.description ?? ''}
                                  {arg.type && (
                                    <span className="font-mono text-[10px] text-[var(--archon-faint)]">
                                      {arg.description ? ' · ' : ''}{arg.type}
                                    </span>
                                  )}
                                </span>
                                {arg.required ? (
                                  <StatusBadge tone="error">Required</StatusBadge>
                                ) : (
                                  <StatusBadge tone="muted">Optional</StatusBadge>
                                )}
                              </div>
                            ))
                          )}
                        </>
                      );
                    })()}
                    <NoteBar>
                      Which agents use this tool isn't shown yet — that needs a cross-agent index the platform doesn't
                      keep. Open an agent's Tool nodes in the builder to see its wiring.
                    </NoteBar>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <CustomMcpDialog
        open={dialog.open}
        editing={dialog.editing}
        onClose={() => setDialog({ open: false, editing: null })}
        onSaved={loadCustom}
      />
    </AppShell>
  );
}
