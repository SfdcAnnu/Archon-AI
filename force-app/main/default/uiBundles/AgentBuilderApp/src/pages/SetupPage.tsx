import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Cloud, KeyRound, Loader2, ShieldCheck, Sliders, Users } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { AttnRow, EmptyPanel, IconSquare, NoteBar, SpecCard, StatusBadge } from '@/components/spec/blocks';
import { Button } from '@/components/ui/button';
import { toast as notify } from '@/components/ui/sonner';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { getSetupStatus, refreshSetupStatus, startSetup, resetSetup, type SetupStatus } from '@/lib/setup-data';
import { ENGINE_TYPES, listConnectionsForEngine, type ConnectionSummary } from '@/lib/engine-connections-data';

/** Approved spec screen 14 — Setup: "Environments, people and promotion".
 *  Four cards: AI providers and keys (real connection counts), Environments
 *  (this org's real status — no invented version numbers), the org-level
 *  Archon OAuth connection wizard (every behavior of the old page kept:
 *  full-page redirect flow via ?synapse_setup=1|0, refresh-then-fallback
 *  status load, authorize/re-authorize/reset), and People (honest empty
 *  state — no client-side user list exists yet). */
export default function SetupPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [engines, setEngines] = useState<ConnectionSummary[] | null>(null);
  const [enginesFailed, setEnginesFailed] = useState(false);

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

  // Cheap fan-out: one GET per engine type; failures collapse to zero rows
  // rather than blocking the page (the wizard below is the critical path).
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled(ENGINE_TYPES.map(t => listConnectionsForEngine(t))).then(results => {
      if (cancelled) return;
      if (results.every(r => r.status === 'rejected')) {
        setEnginesFailed(true);
        return;
      }
      setEngines(results.flatMap(r => (r.status === 'fulfilled' ? r.value : [])));
    });
    return () => {
      cancelled = true;
    };
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

  const providerCount = engines ? new Set(engines.map(c => c.engineType)).size : 0;
  const keyCount = engines?.length ?? 0;
  const inactiveCount = engines?.filter(c => !c.isActive).length ?? 0;

  return (
    <AppShell title="Setup">
      <div className="mx-auto w-full max-w-3xl space-y-3.5 p-5">
        {toast && (
          <div
            className="rounded-lg border px-3 py-2 text-[12.5px]"
            style={
              toast.kind === 'success'
                ? { borderColor: 'var(--archon-success)', backgroundColor: 'var(--archon-success-tint)', color: 'var(--archon-success)' }
                : { borderColor: 'var(--archon-error)', backgroundColor: 'var(--archon-error-tint)', color: 'var(--archon-error)' }
            }
          >
            {toast.text}
          </div>
        )}

        {/* 1 · AI providers and keys */}
        <SpecCard title="AI providers and keys">
          {enginesFailed ? (
            <AttnRow
              icon={
                <IconSquare bg="var(--node-gray-tint)" color="var(--node-gray)">
                  <KeyRound className="h-3.5 w-3.5" />
                </IconSquare>
              }
              title="Couldn't load connection counts"
              sub="Manage keys, enable models and set fallbacks"
            >
              <Button variant="outline" size="xs" onClick={() => navigate('/ai-connections')}>
                Open AI Models
              </Button>
            </AttnRow>
          ) : !engines ? (
            <div className="flex items-center gap-2 px-3.5 py-3 text-[11.5px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Counting connections…
            </div>
          ) : (
            <AttnRow
              icon={
                <IconSquare
                  bg={inactiveCount > 0 ? 'var(--archon-error-tint)' : 'var(--node-blue-tint)'}
                  color={inactiveCount > 0 ? 'var(--archon-error)' : 'var(--node-blue)'}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                </IconSquare>
              }
              title={
                keyCount === 0
                  ? 'No AI connections yet'
                  : `${providerCount} provider${providerCount === 1 ? '' : 's'}, ${keyCount} key${keyCount === 1 ? '' : 's'}${
                      inactiveCount > 0 ? `, ${inactiveCount} inactive` : ''
                    }`
              }
              sub="Manage keys, enable models and set fallbacks"
              onClick={() => navigate('/ai-connections')}
            >
              <Button variant="outline" size="xs" onClick={() => navigate('/ai-connections')}>
                Open AI Models
              </Button>
            </AttnRow>
          )}
        </SpecCard>

        {/* 2 · Environments — real status only; this platform has no
            dev/staging/prod version promotion yet, so no invented versions. */}
        <SpecCard title="Environments" muted="where this org's infrastructure stands">
          <AttnRow
            icon={
              <IconSquare
                bg={status?.configured ? 'var(--archon-success-tint)' : 'var(--node-gray-tint)'}
                color={status?.configured ? 'var(--archon-success)' : 'var(--node-gray)'}
              >
                <Cloud className="h-3.5 w-3.5" />
              </IconSquare>
            }
            title="This org"
            sub={status?.orgId ? `Org ${status.orgId}` : 'Salesforce org authorization'}
          >
            {loadState === 'loading' ? (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            ) : status?.configured ? (
              <StatusBadge tone="ok">Connected</StatusBadge>
            ) : (
              <StatusBadge tone="muted">Not configured</StatusBadge>
            )}
          </AttnRow>
          <AttnRow
            icon={
              <IconSquare bg="var(--node-teal-tint)" color="var(--node-teal)">
                <Sliders className="h-3.5 w-3.5" />
              </IconSquare>
            }
            title="Server, connector and engine health"
            sub="Live status of everything this org runs on"
            onClick={() => navigate('/environments')}
          >
            <Button variant="outline" size="xs" onClick={() => navigate('/environments')}>
              Manage environments
            </Button>
          </AttnRow>
        </SpecCard>

        {/* 3 · Archon OAuth connection wizard — every existing behavior kept */}
        <SpecCard
          title={
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-[var(--node-blue)]" /> Connection to Archon server
            </span>
          }
          muted="admin-only, rarely needed after first setup"
        >
          <div className="px-3.5 py-3">
            {loadState === 'loading' && (
              <div className="flex items-center gap-2 py-2 text-[12.5px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </div>
            )}
            {loadState === 'error' && (
              <p className="text-[12.5px] text-destructive">Couldn't load setup status.</p>
            )}
            {loadState === 'ready' && status && (
              <>
                <StatusBadge tone={status.configured ? 'ok' : 'muted'}>
                  {status.configured ? 'Configured' : 'Not configured'}
                </StatusBadge>
                {status.configured && status.configuredByEmail && (
                  <p className="mt-2 text-[11.5px] text-muted-foreground">
                    Connected as {status.configuredByEmail}
                    {status.configuredAt && ` · ${new Date(status.configuredAt).toLocaleString()}`}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
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
          </div>
          <NoteBar>
            Connects this org to the Archon server — required for automation, channel, and shared-access
            agents. Authorize opens the Salesforce consent screen and returns here.
          </NoteBar>
        </SpecCard>

        {/* 4 · People — no client-side user roster exists yet */}
        <SpecCard title="People">
          <div className="px-3.5 pt-3">
            <EmptyPanel>Roles and publishing permissions arrive with multi-user workspaces.</EmptyPanel>
          </div>
          <AttnRow
            icon={
              <IconSquare bg="var(--node-purple-tint)" color="var(--node-purple)">
                <Users className="h-3.5 w-3.5" />
              </IconSquare>
            }
            title="Org settings & guardrails"
            sub="AI usage limits and Salesforce access for everyone"
            onClick={() => navigate('/settings')}
          >
            <Button variant="outline" size="xs" onClick={() => navigate('/settings')}>
              Open Settings
            </Button>
          </AttnRow>
        </SpecCard>
      </div>
    </AppShell>
  );
}
