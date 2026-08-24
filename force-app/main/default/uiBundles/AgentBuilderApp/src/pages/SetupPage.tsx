import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast as notify } from '@/components/ui/sonner';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { getSetupStatus, refreshSetupStatus, startSetup, resetSetup, type SetupStatus } from '@/lib/setup-data';

/** Org-level Archon OAuth connection wizard — admin-only, rarely used
 *  after initial setup. Full-page redirect flow (not a popup): Authorize
 *  navigates the whole tab to Salesforce login/consent, which redirects
 *  back to this same URL with ?synapse_setup=1|0 appended. Ported last
 *  among the admin pages per this stage's plan (highest-stakes, lowest-
 *  frequency surface — a subtle bug here risks locking the org out of
 *  Archon entirely). */
export default function SetupPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const flag = url.searchParams.get('synapse_setup');
    if (flag != null) {
      if (flag === '1') setToast({ kind: 'success', text: 'Salesforce connection authorized.' });
      else setToast({ kind: 'error', text: url.searchParams.get('error') ?? 'Authorization failed.' });
      url.searchParams.delete('synapse_setup');
      url.searchParams.delete('error');
      window.history.replaceState({}, '', url.toString());
    }

    setLoadState('loading');
    refreshSetupStatus()
      .then(s => {
        setStatus(s);
        setLoadState('ready');
      })
      .catch(err => {
        console.error('Failed to refresh setup status, falling back to local status:', err);
        getSetupStatus()
          .then(s => {
            setStatus(s);
            setLoadState('ready');
          })
          .catch(err2 => {
            console.error('Failed to load setup status:', err2);
            setLoadState('error');
          });
      });
  }, []);

  const handleAuthorize = useCallback(() => {
    setBusy(true);
    startSetup(window.location.href)
      .then(result => {
        window.location.assign(result.authorizeUrl);
      })
      .catch(err => {
        console.error('Failed to start setup:', err);
        setBusy(false);
      });
  }, []);

  const handleReset = useCallback(async () => {
    const ok = await confirmDialog({
      title: 'Reset the Archon connection?',
      description: 'You will need to re-authorize before agents can run again.',
      confirmLabel: 'Reset',
      variant: 'destructive',
    });
    if (!ok) return;
    setBusy(true);
    resetSetup()
      .then(() => getSetupStatus())
      .then(s => {
        notify.success('Connection reset.');
        setStatus(s);
        setBusy(false);
      })
      .catch(err => {
        console.error('Failed to reset setup:', err);
        notify.error('Reset failed', { description: err instanceof Error ? err.message : undefined });
        setBusy(false);
      });
  }, []);

  return (
    <AppShell>
      <div className="flex h-full w-full flex-col overflow-y-auto">
        <header className="flex h-14 shrink-0 items-center border-b border-border bg-card px-5">
          <span className="text-[14px] font-bold text-foreground">Setup</span>
        </header>

        <div className="mx-auto w-full max-w-2xl flex-1 p-6">
          {toast && (
            <div
              className="mb-4 rounded-lg border px-3 py-2 text-[12.5px]"
              style={
                toast.kind === 'success'
                  ? { borderColor: 'var(--archon-success)', backgroundColor: 'var(--archon-success-tint)', color: 'var(--archon-success)' }
                  : { borderColor: 'var(--archon-danger, #dc2626)', backgroundColor: 'var(--archon-danger-tint, #fde8e8)', color: 'var(--archon-danger, #dc2626)' }
              }
            >
              {toast.text}
            </div>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[var(--node-blue)]" />
                <CardTitle>Salesforce connection</CardTitle>
              </div>
              <CardDescription>
                Connects this org to the Archon server — required for automation, channel, and
                shared-access agents.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadState === 'loading' && (
                <div className="flex items-center gap-2 py-4 text-[12.5px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                </div>
              )}
              {loadState === 'error' && (
                <p className="text-[12.5px] text-destructive">Couldn't load setup status.</p>
              )}
              {loadState === 'ready' && status && (
                <>
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
                    style={
                      status.configured
                        ? { backgroundColor: 'var(--archon-success-tint)', color: 'var(--archon-success)' }
                        : { backgroundColor: 'var(--node-gray-tint)', color: 'var(--node-gray)' }
                    }
                  >
                    {status.configured ? 'Configured' : 'Not configured'}
                  </span>
                  {status.configured && status.configuredByEmail && (
                    <p className="mt-2 text-[11.5px] text-muted-foreground">
                      Connected as {status.configuredByEmail}
                      {status.configuredAt && ` · ${new Date(status.configuredAt).toLocaleString()}`}
                    </p>
                  )}
                  <div className="mt-4 flex gap-2">
                    <Button size="sm" className="h-8 text-xs" onClick={handleAuthorize} disabled={busy}>
                      {busy && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                      {status.configured ? 'Re-authorize' : 'Authorize'}
                    </Button>
                    {status.configured && (
                      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleReset} disabled={busy}>
                        Reset
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
