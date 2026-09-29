import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { KeyRound, Loader2, Plug } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { PageBody } from '@/components/shell/PageBody';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { IconSquare, NoteBar, StatusBadge, type BadgeTone } from '@/components/spec/blocks';
import { disconnectMyConnection, loadMyConnections, startMyConnectionFor, type MyConnection } from '@/lib/chat-data';

/**
 * My connections — the running user's own accounts, one row per provider
 * an agent runs as them on. Nothing here is anyone else's: the Apex behind
 * it acts on the caller only, and a chat user has no access to the admin
 * class. A reminder deep-links here with #connect-<provider>.
 */
function tone(status: string): BadgeTone {
  if (status === 'Connected') return 'ok';
  if (status === 'Error') return 'error';
  if (status === 'Pending') return 'warn';
  return 'muted';
}

export default function MyConnectionsPage() {
  const location = useLocation();
  const [rows, setRows] = useState<MyConnection[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [unreachable, setUnreachable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const highlight = /^#connect-(.+)$/.exec(location.hash)?.[1] ?? null;

  const load = useCallback(() => {
    setState(s => (s === 'ready' ? s : 'loading'));
    return loadMyConnections()
      .then(r => { setRows(r.providers); setUnreachable(r.serverUnreachable); setState('ready'); return r.providers; })
      .catch(err => { console.error('Failed to load my connections:', err); setState('error'); return [] as MyConnection[]; });
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!highlight || state !== 'ready') return;
    document.getElementById(`connect-${highlight}`)?.scrollIntoView({ block: 'center' });
  }, [highlight, state]);

  const connect = useCallback((p: MyConnection) => {
    const popup = window.open('about:blank', `archon_oauth_${p.providerKey}`, 'width=620,height=720,scrollbars=yes');
    const startedAt = Date.now();
    setBusy(p.providerKey);
    startMyConnectionFor(window.location.href.replace(/#.*$/, ''), p.providerKey, `${p.displayName} (my account)`)
      .then(({ authorizeUrl }) => {
        if (popup) popup.location.href = authorizeUrl;
        else window.open(authorizeUrl, `archon_oauth_${p.providerKey}`, 'width=620,height=720,scrollbars=yes');
        toast.info(`Sign in to ${p.displayName} in the window that opened`, { description: 'This page updates by itself once you have allowed access.' });
        const until = Date.now() + 180_000;
        const poll = () => {
          load().then(list => {
            const now = list.find(x => x.providerKey === p.providerKey);
            const at = now?.lastConnectedAt ? Date.parse(now.lastConnectedAt) : 0;
            if (now && now.status === 'Connected' && at >= startedAt - 60_000) {
              setBusy(null);
              toast.success(`${p.displayName} connected${now.accountEmail ? ` as ${now.accountEmail}` : ''}.`);
              return;
            }
            if (Date.now() < until) setTimeout(poll, 3000);
            else { setBusy(null); toast.info(`${p.displayName} is not connected yet`, { description: 'If you finished signing in, press Refresh.' }); }
          });
        };
        setTimeout(poll, 4000);
      })
      .catch(err => {
        popup?.close();
        setBusy(null);
        toast.error(`Could not start the ${p.displayName} sign-in`, { description: err instanceof Error ? err.message : undefined });
      });
  }, [load]);

  const disconnect = useCallback(async (p: MyConnection) => {
    if (!p.connectionId) return;
    if (!(await confirmDialog({ title: `Disconnect your ${p.displayName}?`, description: p.neededBy.length ? `${p.neededBy.join(', ')} will ask you to connect it again.` : undefined, confirmLabel: 'Disconnect', variant: 'destructive' }))) return;
    setBusy(p.providerKey);
    disconnectMyConnection(p.connectionId)
      .then(() => { toast.success(`${p.displayName} disconnected.`); return load(); })
      .catch(err => toast.error('Disconnect failed', { description: err instanceof Error ? err.message : undefined }))
      .finally(() => setBusy(null));
  }, [load]);

  return (
    <AppShell title="My connections" onRefresh={load}>
      <PageBody width="read" className="space-y-4">
        <div className="flex items-start gap-3">
          <IconSquare bg="var(--node-blue-tint)" color="var(--node-blue)" size={36}><KeyRound className="h-4 w-4" /></IconSquare>
          <div>
            <h1 className="text-[16px] font-bold text-foreground">My connections</h1>
            <p className="text-[12.5px] text-muted-foreground">Accounts agents use on your behalf. When an agent runs as you, every action carries your own access and your name in the audit trail. Only you can see or change what is here.</p>
          </div>
        </div>

        {state === 'loading' && <div className="flex items-center gap-2 py-6 text-[12.5px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>}
        {state === 'error' && <p className="text-[12.5px] text-destructive">Couldn't load your connections. Use Refresh to try again.</p>}
        {state === 'ready' && unreachable && <NoteBar tone="warn">The Archon server did not answer, so statuses may be stale — it sleeps when idle. Refresh in a moment.</NoteBar>}
        {state === 'ready' && rows.length === 0 && (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[12px] text-muted-foreground">No agent runs as you yet, and you have connected nothing. When one does, it appears here.</div>
        )}
        {state === 'ready' && rows.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {rows.map(p => {
              const connected = p.status === 'Connected';
              const hl = highlight === p.providerKey;
              return (
                <div key={p.providerKey} id={`connect-${p.providerKey}`} className={cn('flex items-start gap-3 border-b border-border p-3.5 last:border-b-0', hl && 'bg-accent shadow-[inset_3px_0_0_var(--primary)]')}>
                  <IconSquare bg="var(--node-gray-tint)" color="var(--node-gray)"><Plug className="h-4 w-4" /></IconSquare>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-bold text-foreground">{p.displayName}</span>
                      <StatusBadge tone={tone(p.status)}>{connected ? 'Connected' : p.status === 'NotConnected' ? 'Not connected' : p.status}</StatusBadge>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {connected ? <>{p.accountEmail ?? 'Your account'}{p.lastConnectedAt ? ` · connected ${new Date(p.lastConnectedAt).toLocaleDateString()}` : ''}</> : p.lastErrorMessage ? <span className="text-[var(--archon-error)]">{p.lastErrorMessage}</span> : 'Sign in once; agents then act as you here.'}
                    </div>
                    {p.neededBy.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10.5px] text-muted-foreground">
                        Used by {p.neededBy.map(a => <span key={a} className="rounded-full border border-border bg-secondary px-1.5 py-0.5 font-semibold text-foreground">{a}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <Button size="sm" className="h-7 text-[11px]" disabled={busy === p.providerKey} onClick={() => connect(p)}>
                      {busy === p.providerKey ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Waiting…</> : connected ? 'Reconnect' : `Connect my ${p.displayName}`}
                    </Button>
                    {connected && p.connectionId && (
                      <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={busy === p.providerKey} onClick={() => disconnect(p)}>Disconnect</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PageBody>
    </AppShell>
  );
}
