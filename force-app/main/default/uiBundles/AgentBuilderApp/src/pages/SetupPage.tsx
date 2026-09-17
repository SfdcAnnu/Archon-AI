import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Cloud, KeyRound, Loader2, ShieldCheck, Sliders, Users, Zap } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { PageBody } from '@/components/shell/PageBody';
import { AttnRow, EmptyPanel, IconSquare, NoteBar, SpecCard, StatusBadge, type BadgeTone } from '@/components/spec/blocks';
import { Button } from '@/components/ui/button';
import { toast as notify } from '@/components/ui/sonner';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { getSetupStatus, refreshSetupStatus, startSetup, resetSetup, type SetupStatus } from '@/lib/setup-data';
import { ENGINE_TYPES, listConnectionsForEngine, type ConnectionSummary } from '@/lib/engine-connections-data';
import { allServices, wakeUntilSettled, type ServiceState, type WakeOutcome, type WakeResult, type WakeStatus } from '@/lib/wake-data';

/** Approved spec screen 14 — Setup: "Environments, people and promotion".
 *  Four cards: AI providers and keys (real connection counts), Environments
 *  (this org's real status, plus "Wake servers" — cold-starts the Archon
 *  server and every MCP server up front so an agent run doesn't pay for
 *  them inside its first tool call), the org-level
 *  Archon OAuth connection wizard (every behavior of the old page kept:
 *  full-page redirect flow via ?synapse_setup=1|0, refresh-then-fallback
 *  status load, authorize/re-authorize/reset), and People (honest empty
 *  state — no client-side user list exists yet). */

const WAKE_TONE: Record<WakeStatus, BadgeTone> = { online: 'ok', waking: 'warn', pending: 'muted', unreachable: 'error' };
const WAKE_LABEL: Record<WakeStatus, string> = { online: 'Online', waking: 'Waking…', pending: 'Waiting', unreachable: 'Unreachable' };

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function WakeServiceRow({ s }: { s: ServiceState }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-1.5 text-[11.5px]">
      <div className="min-w-0 flex-1">
        <span className="font-semibold text-foreground">{s.name}</span>
        <span className="ml-1.5 text-[var(--archon-faint)]">{hostOf(s.url)}</span>
        {s.message && <div className="truncate text-[10.5px] text-muted-foreground">{s.message}</div>}
      </div>
      {s.status === 'online' && s.ms != null && <span className="text-[10.5px] text-muted-foreground">{s.ms} ms</span>}
      <StatusBadge tone={WAKE_TONE[s.status]}>
        {s.status === 'waking' && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
        {WAKE_LABEL[s.status]}
      </StatusBadge>
    </div>
  );
}

const WAKE_OUTCOME_TEXT: Record<WakeOutcome, string> = {
  ready: 'Everything is online — agent runs will start without a cold-start delay.',
  partial: 'Some services did not come up. Agents that only use the online ones will still run.',
  timeout: 'Still not fully up after three minutes. Press Wake again, or check the Environments page.',
  cancelled: '',
};

interface WakeState {
  phase: 'idle' | 'running' | 'done' | 'error';
  result: WakeResult | null;
  outcome: WakeOutcome | null;
  error: string | null;
  startedAt: number;
}

const WAKE_IDLE: WakeState = { phase: 'idle', result: null, outcome: null, error: null, startedAt: 0 };

export default function SetupPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [engines, setEngines] = useState<ConnectionSummary[] | null>(null);
  const [enginesFailed, setEnginesFailed] = useState(false);
  const [wake, setWake] = useState<WakeState>(WAKE_IDLE);
  const [elapsedSec, setElapsedSec] = useState(0);
  // Bumped on every new click (and on unmount) so a superseded poll loop's
  // late answers never overwrite the newer one's rows.
  const wakeRunRef = useRef(0);

  useEffect(
    () => () => {
      wakeRunRef.current += 1;
    },
    []
  );

  // Elapsed-seconds ticker while a wake is in progress.
  useEffect(() => {
    if (wake.phase !== 'running') return;
    const id = setInterval(() => setElapsedSec(Math.round((Date.now() - wake.startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [wake.phase, wake.startedAt]);

  const handleWake = useCallback(() => {
    const run = ++wakeRunRef.current;
    setElapsedSec(0);
    setWake({ ...WAKE_IDLE, phase: 'running', startedAt: Date.now() });
    wakeUntilSettled({
      isCancelled: () => wakeRunRef.current !== run,
      onUpdate: result => setWake(w => ({ ...w, result })),
    })
      .then(outcome => {
        if (wakeRunRef.current !== run || outcome === 'cancelled') return;
        setWake(w => ({ ...w, phase: 'done', outcome }));
        if (outcome === 'ready') notify.success('Servers are awake.');
      })
      .catch(err => {
        if (wakeRunRef.current !== run) return;
        console.error('Wake servers failed:', err);
        setWake(w => ({ ...w, phase: 'error', error: err instanceof Error ? err.message : 'Wake failed.' }));
      });
  }, []);

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
      <PageBody width="read" className="space-y-3.5">
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
              <IconSquare
                bg={wake.phase === 'running' ? 'var(--archon-warning-tint)' : 'var(--node-blue-tint)'}
                color={wake.phase === 'running' ? 'var(--archon-warning)' : 'var(--node-blue)'}
              >
                <Zap className="h-3.5 w-3.5" />
              </IconSquare>
            }
            title="Wake servers before an agent run"
            sub={
              wake.phase === 'running'
                ? `Pinging the Archon server and every MCP server… ${elapsedSec}s`
                : 'Cold-starts the Archon server and every MCP server now, so the first run does not stall'
            }
          >
            <Button size="xs" onClick={handleWake} disabled={wake.phase === 'running'}>
              {wake.phase === 'running' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
              {wake.phase === 'running' ? 'Waking…' : wake.phase === 'idle' ? 'Wake servers' : 'Wake again'}
            </Button>
          </AttnRow>
          {wake.phase !== 'idle' && (
            <div className="border-b border-border bg-secondary/40 py-1.5">
              {wake.phase === 'running' && !wake.result && (
                <div className="flex items-center gap-2 px-3.5 py-1.5 text-[11.5px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Reaching the Archon server…
                </div>
              )}
              {wake.result && allServices(wake.result).map(s => <WakeServiceRow key={s.key} s={s} />)}
              {wake.result && wake.result.targets.length === 0 && (
                <div className="px-3.5 py-1.5 text-[10.5px] text-muted-foreground">
                  No MCP servers are configured for this org yet, so only the Archon server was woken.
                </div>
              )}
              {wake.phase === 'done' && wake.outcome && WAKE_OUTCOME_TEXT[wake.outcome] && (
                <div
                  className="px-3.5 pt-1.5 text-[10.5px]"
                  style={{ color: wake.outcome === 'ready' ? 'var(--archon-success)' : 'var(--archon-warning)' }}
                >
                  {WAKE_OUTCOME_TEXT[wake.outcome]}
                </div>
              )}
              {wake.phase === 'error' && (
                <div className="px-3.5 pt-1.5 text-[10.5px]" style={{ color: 'var(--archon-error)' }}>
                  {wake.error}
                </div>
              )}
            </div>
          )}
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
      </PageBody>
    </AppShell>
  );
}
