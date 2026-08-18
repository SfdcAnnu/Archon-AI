import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, TestTube2, Trash2 } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { EngineConnectionFormDialog } from '@/components/connections/EngineConnectionFormDialog';
import {
  ENGINE_TYPES,
  listConnectionsForEngine,
  deleteEngineConnection,
  testEngineConnection,
  saveEngineConnection,
  type ConnectionSummary,
} from '@/lib/engine-connections-data';

function statusPillStyle(status: string | null) {
  if (status === 'Success') return { backgroundColor: 'var(--archon-success-tint)', color: 'var(--archon-success)' };
  if (status === 'Failed') return { backgroundColor: 'var(--archon-danger-tint, #fde8e8)', color: 'var(--archon-danger, #dc2626)' };
  return { backgroundColor: 'var(--node-gray-tint)', color: 'var(--node-gray)' };
}

export default function AiConnectionsPage() {
  const [rows, setRows] = useState<ConnectionSummary[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
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

  const handleDelete = useCallback(
    (row: ConnectionSummary) => {
      if (!window.confirm(`Delete "${row.label}"?`)) return;
      setBusyId(row.id);
      deleteEngineConnection(row.id)
        .then(() => setRows(list => list.filter(r => r.id !== row.id)))
        .catch(err => console.error('Delete failed:', err))
        .finally(() => setBusyId(null));
    },
    []
  );

  const handleTest = useCallback((row: ConnectionSummary) => {
    setBusyId(row.id);
    testEngineConnection(row.id)
      .then(result => window.alert(result.success ? 'Connection OK.' : result.message))
      .catch(err => console.error('Test failed:', err))
      .finally(() => {
        setBusyId(null);
        load();
      });
  }, [load]);

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

  return (
    <AppShell>
      <div className="flex h-full w-full flex-col overflow-y-auto">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-5">
          <span className="text-[14px] font-bold text-foreground">AI Connections</span>
          <Button size="sm" className="h-8 text-xs" onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> New Connection
          </Button>
        </header>

        <div className="mx-auto w-full max-w-4xl flex-1 p-6">
          {loadState === 'loading' && (
            <div className="flex items-center gap-2 py-8 text-[12.5px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          )}
          {loadState === 'error' && (
            <p className="py-8 text-[12.5px] text-destructive">Couldn't load AI connections.</p>
          )}
          {loadState === 'ready' && rows.length === 0 && (
            <div className="rounded-lg border border-dashed border-border py-16 text-center">
              <p className="text-[13px] text-muted-foreground">No AI connections yet — agents use the org's default keys.</p>
            </div>
          )}
          {loadState === 'ready' && rows.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-[12.5px]">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-foreground">Connection</th>
                    <th className="px-3 py-2 text-left font-medium text-foreground">Provider</th>
                    <th className="px-3 py-2 text-left font-medium text-foreground">Default model</th>
                    <th className="px-3 py-2 text-left font-medium text-foreground">Access</th>
                    <th className="px-3 py-2 text-left font-medium text-foreground">Status</th>
                    <th className="px-3 py-2 text-left font-medium text-foreground">Active</th>
                    <th className="px-3 py-2 text-left font-medium text-foreground" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium text-foreground">
                        {r.label} {r.isPreferred && <span className="ml-1 text-[10px] text-muted-foreground">★</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.engineType}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.defaultModel ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.ownershipType}{r.isPublicShared ? ' · Public' : ''}{r.isMine ? ' (mine)' : ''}
                      </td>
                      <td className="px-3 py-2">
                        <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={statusPillStyle(r.validationStatus)}>
                          {r.validationStatus ?? 'Untested'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Switch checked={r.isActive} disabled={busyId === r.id} onCheckedChange={() => handleToggleActive(r)} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => handleTest(r)}
                            className="rounded p-1.5 text-muted-foreground hover:bg-muted"
                            aria-label="Test"
                          >
                            <TestTube2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => { setEditing(r); setDialogOpen(true); }}
                            className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => handleDelete(r)}
                            className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            aria-label="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <EngineConnectionFormDialog
        open={dialogOpen}
        defaultEngineType="claude"
        editing={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={load}
      />
    </AppShell>
  );
}
