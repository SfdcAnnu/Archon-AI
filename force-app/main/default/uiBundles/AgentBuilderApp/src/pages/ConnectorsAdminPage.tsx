import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plug, Plus, Trash2 } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { loadConnectorDirectory, type DirectoryEntry } from '@/lib/connectors-data';
import {
  loadCustomMcpServers,
  saveCustomMcpServer,
  deleteCustomMcpServer,
  disconnectConnector,
  type CustomMcpServer,
} from '@/lib/connector-admin-data';

function statusPillStyle(status: string) {
  if (status === 'Connected') return { backgroundColor: 'var(--archon-success-tint)', color: 'var(--archon-success)' };
  if (status === 'Error') return { backgroundColor: 'var(--archon-danger-tint, #fde8e8)', color: 'var(--archon-danger, #dc2626)' };
  return { backgroundColor: 'var(--node-gray-tint)', color: 'var(--node-gray)' };
}

function CustomMcpDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
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
      setServerName('');
      setMcpServerUrl('');
      setDescription('');
      setCategory('Other');
      setCatalogType('custom_mcp_tools');
    }
  }, [open]);

  const handleSave = () => {
    if (!serverName.trim() || !mcpServerUrl.trim()) return;
    setSaving(true);
    saveCustomMcpServer({ serverName, mcpServerUrl, description, category, catalogType })
      .then(() => {
        setSaving(false);
        onSaved();
        onClose();
      })
      .catch(err => {
        console.error('Failed to save custom MCP server:', err);
        setSaving(false);
      });
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New custom MCP server</DialogTitle>
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
  const [customServers, setCustomServers] = useState<CustomMcpServer[]>([]);
  const [customLoadState, setCustomLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCustomDialog, setShowCustomDialog] = useState(false);

  const loadDirectory = useCallback(() => {
    setDirLoadState('loading');
    loadConnectorDirectory()
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

  const handleConnect = useCallback((entry: DirectoryEntry) => {
    if (entry.providerKey === 'salesforce_mcp') {
      window.alert(
        "Already connected via Setup — the org-wide Salesforce connection is managed on the Setup page, not here. Per-user access for PerUser-mode agents connects itself from inside a chat session."
      );
      return;
    }
    window.alert(`${entry.displayName} isn't wired up yet — coming soon.`);
  }, []);

  const handleDisconnect = useCallback(
    (entry: DirectoryEntry) => {
      if (!entry.connectorId) return;
      if (!window.confirm(`Disconnect ${entry.displayName}?`)) return;
      setBusyId(entry.connectorId);
      disconnectConnector(entry.connectorId)
        .then(() => loadDirectory())
        .catch(err => console.error('Disconnect failed:', err))
        .finally(() => setBusyId(null));
    },
    [loadDirectory]
  );

  const handleDeleteCustom = useCallback(
    (row: CustomMcpServer) => {
      if (!window.confirm(`Delete "${row.Name}"?`)) return;
      setBusyId(row.Id);
      deleteCustomMcpServer(row.Id)
        .then(() => setCustomServers(list => list.filter(r => r.Id !== row.Id)))
        .catch(err => console.error('Delete failed:', err))
        .finally(() => setBusyId(null));
    },
    []
  );

  return (
    <AppShell>
      <div className="flex h-full w-full flex-col overflow-y-auto">
        <header className="flex h-14 shrink-0 items-center border-b border-border bg-card px-5">
          <span className="text-[14px] font-bold text-foreground">Connectors</span>
        </header>

        <div className="mx-auto w-full max-w-4xl flex-1 space-y-6 p-6">
          <div>
            <h2 className="mb-3 text-[13px] font-semibold text-foreground">Directory</h2>
            {dirLoadState === 'loading' && (
              <div className="flex items-center gap-2 py-4 text-[12.5px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </div>
            )}
            {dirLoadState === 'error' && <p className="text-[12.5px] text-destructive">Couldn't load the directory.</p>}
            {dirLoadState === 'ready' && (
              <div className="grid grid-cols-2 gap-3">
                {directory.map(entry => (
                  <div key={entry.providerKey} className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
                      style={{ backgroundColor: entry.brandColor ?? 'var(--node-gray)' }}
                    >
                      <Plug className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium text-foreground">{entry.displayName}</div>
                      <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={statusPillStyle(entry.status)}>
                        {entry.status}
                      </span>
                    </div>
                    {entry.status === 'Connected' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 text-[11px]"
                        disabled={busyId === entry.connectorId}
                        onClick={() => handleDisconnect(entry)}
                      >
                        Disconnect
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" className="h-7 shrink-0 text-[11px]" onClick={() => handleConnect(entry)}>
                        Connect
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-foreground">Custom MCP servers</h2>
              <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setShowCustomDialog(true)}>
                <Plus className="mr-1 h-3 w-3" /> Add server
              </Button>
            </div>
            {customLoadState === 'loading' && (
              <div className="flex items-center gap-2 py-4 text-[12.5px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </div>
            )}
            {customLoadState === 'error' && <p className="text-[12.5px] text-destructive">Couldn't load custom servers.</p>}
            {customLoadState === 'ready' && customServers.length === 0 && (
              <p className="text-[12.5px] text-muted-foreground">No custom MCP servers configured yet.</p>
            )}
            {customLoadState === 'ready' && customServers.length > 0 && (
              <div className="space-y-2">
                {customServers.map(s => (
                  <div key={s.Id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium text-foreground">{s.Name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{s.McpServerUrl__c}</div>
                    </div>
                    <button
                      type="button"
                      disabled={busyId === s.Id}
                      onClick={() => handleDeleteCustom(s)}
                      className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <CustomMcpDialog open={showCustomDialog} onClose={() => setShowCustomDialog(false)} onSaved={loadCustom} />
    </AppShell>
  );
}
