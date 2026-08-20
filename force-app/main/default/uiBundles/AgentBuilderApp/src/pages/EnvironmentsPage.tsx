import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Cloud, Database, KeyRound, Loader2, Plug, RefreshCw, Server } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { cn } from '@/lib/utils';
import { loadAccessStatus, type AccessStatus } from '@/lib/access-data';
import { loadConnectorDirectoryWithRetry, type DirectoryEntry } from '@/lib/connectors-data';
import { listConnectionsForEngine, type ConnectionSummary } from '@/lib/engine-connections-data';

/** Environments — a read-only status board for the infrastructure this org
 *  runs on: the Salesforce org authorization, the Archon Node server (probed
 *  live via the connector directory call, which doubles as its health
 *  check), every MCP connector's connection state, and the AI engine
 *  connections. Management lives on the dedicated pages (Connectors, AI
 *  Connections, Setup) — this page only shows where everything stands. */

type ServerState = 'checking' | 'waking' | 'online' | 'unreachable';

function StateDot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        ok ? 'bg-[var(--archon-success)]' : warn ? 'bg-[var(--archon-warning,#B45309)]' : 'bg-destructive'
      )}
    />
  );
}

function SectionCard({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: typeof Server;
  title: string;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="flex items-center gap-2 text-[12.5px] font-bold text-foreground">
          <Icon className="h-4 w-4 text-muted-foreground" /> {title}
        </span>
        {action && (
          <button type="button" className="text-[11px] font-semibold text-primary hover:underline" onClick={action.onClick}>
            {action.label} ›
          </button>
        )}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-[11.5px] text-muted-foreground">{label}</span>
      <span className="text-right text-[12px] font-semibold text-foreground">{value}</span>
    </div>
  );
}

export default function EnvironmentsPage() {
  const navigate = useNavigate();
  const [access, setAccess] = useState<AccessStatus | null>(null);
  const [accessError, setAccessError] = useState(false);
  const [directory, setDirectory] = useState<DirectoryEntry[] | null>(null);
  const [serverState, setServerState] = useState<ServerState>('checking');
  const [serverMs, setServerMs] = useState<number | null>(null);
  const [engines, setEngines] = useState<ConnectionSummary[] | null>(null);
  const [refreshSeq, setRefreshSeq] = useState(0);
  const startRef = useRef(0);

  const refresh = useCallback(() => setRefreshSeq(s => s + 1), []);

  useEffect(() => {
    let cancelled = false;
    setAccess(null);
    setAccessError(false);
    setDirectory(null);
    setServerState('checking');
    setServerMs(null);
    setEngines(null);

    loadAccessStatus()
      .then(a => !cancelled && setAccess(a))
      .catch(() => !cancelled && setAccessError(true));

    // The connector directory call traverses Apex → Archon server, so its
    // outcome IS the server health check: success = online (with observed
    // round-trip), SERVER_WAKING retries = waking, exhaustion = unreachable.
    startRef.current = performance.now();
    loadConnectorDirectoryWithRetry(() => !cancelled && setServerState('waking'))
      .then(list => {
        if (cancelled) return;
        setDirectory(list);
        setServerMs(Math.round(performance.now() - startRef.current));
        setServerState('online');
      })
      .catch(() => !cancelled && setServerState('unreachable'));

    Promise.allSettled(['claude', 'openai', 'gemini'].map(t => listConnectionsForEngine(t))).then(results => {
      if (cancelled) return;
      const all = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
      setEngines(all);
    });

    return () => {
      cancelled = true;
    };
  }, [refreshSeq]);

  const connectedCount = (directory ?? []).filter(d => d.status === 'Connected').length;

  return (
    <AppShell>
      <div className="flex h-full w-full flex-col overflow-y-auto">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-5">
          <span className="text-[14px] font-bold text-foreground">Environments</span>
          <button
            type="button"
            onClick={refresh}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="mx-auto w-full max-w-5xl flex-1 space-y-4 p-6">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Salesforce org */}
            <SectionCard
              icon={Cloud}
              title="Salesforce org"
              action={{ label: 'Setup', onClick: () => navigate('/setup') }}
            >
              {accessError ? (
                <p className="text-[11.5px] text-muted-foreground">Couldn't load org status.</p>
              ) : !access ? (
                <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </div>
              ) : (
                <>
                  <Row
                    label="Authorization"
                    value={
                      <span className="inline-flex items-center gap-1.5">
                        <StateDot ok={access.orgStatus.configured} />
                        {access.orgStatus.configured ? 'Connected' : 'Not configured'}
                      </span>
                    }
                  />
                  {access.orgStatus.orgId && <Row label="Org Id" value={access.orgStatus.orgId} />}
                  {access.orgStatus.configuredByEmail && (
                    <Row label="Authorized by" value={access.orgStatus.configuredByEmail} />
                  )}
                  {access.orgStatus.configuredAt && (
                    <Row label="Since" value={new Date(access.orgStatus.configuredAt).toLocaleString()} />
                  )}
                  {access.userConnections.length > 0 && (
                    <div className="mt-3 border-t border-border pt-2">
                      <div className="pb-1 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                        Per-user connections
                      </div>
                      {access.userConnections.map(u => (
                        <div key={u.userEmail} className="flex items-center gap-2 py-1 text-[11.5px]">
                          <StateDot ok={u.status === 'Connected'} warn={u.status !== 'Connected'} />
                          <span className="min-w-0 flex-1 truncate text-foreground">{u.userName}</span>
                          <span className="text-muted-foreground">{u.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </SectionCard>

            {/* Archon server */}
            <SectionCard icon={Server} title="Archon server">
              <Row
                label="Status"
                value={
                  serverState === 'checking' ? (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Checking…
                    </span>
                  ) : serverState === 'waking' ? (
                    <span className="inline-flex items-center gap-1.5">
                      <StateDot ok={false} warn /> Waking from idle…
                    </span>
                  ) : serverState === 'online' ? (
                    <span className="inline-flex items-center gap-1.5">
                      <StateDot ok /> Online
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <StateDot ok={false} /> Unreachable
                    </span>
                  )
                }
              />
              {serverMs != null && <Row label="Round trip" value={`${serverMs} ms`} />}
              <p className="mt-2 text-[10.5px] leading-snug text-muted-foreground">
                Free-tier hosting sleeps after ~15 min idle — the first request after a quiet period can take up to a
                minute while it wakes. Every screen retries automatically during that window.
              </p>
            </SectionCard>
          </div>

          {/* MCP connectors */}
          <SectionCard
            icon={Plug}
            title={`MCP connectors${directory ? ` — ${connectedCount} of ${directory.length} connected` : ''}`}
            action={{ label: 'Manage', onClick: () => navigate('/connectors') }}
          >
            {serverState === 'unreachable' ? (
              <p className="text-[11.5px] text-muted-foreground">
                Connector statuses need the Archon server — retry once it's reachable.
              </p>
            ) : !directory ? (
              <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {serverState === 'waking' ? 'Server waking — retrying…' : 'Loading connectors…'}
              </div>
            ) : (
              <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {directory.map(d => (
                  <div key={d.providerKey} className="flex items-center gap-2 py-1 text-[11.5px]">
                    <StateDot ok={d.status === 'Connected'} warn={d.status !== 'Connected'} />
                    <span className="min-w-0 flex-1 truncate text-foreground">{d.displayName}</span>
                    {d.isCustom && (
                      <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9.5px] font-bold text-muted-foreground">
                        custom
                      </span>
                    )}
                    <span className="text-muted-foreground">{d.status}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* AI engines */}
          <SectionCard
            icon={KeyRound}
            title="AI engine connections"
            action={{ label: 'Manage', onClick: () => navigate('/ai-connections') }}
          >
            {!engines ? (
              <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </div>
            ) : engines.length === 0 ? (
              <p className="text-[11.5px] text-muted-foreground">
                No AI engine connections saved yet — add one under Credentials.
              </p>
            ) : (
              engines.map(c => (
                <div key={c.id} className="flex items-center gap-2 py-1 text-[11.5px]">
                  <StateDot ok={c.isActive} warn={!c.isActive} />
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {c.label || c.name}
                    {c.isPreferred && <span className="ml-1.5 text-[9.5px] font-bold text-primary">preferred</span>}
                  </span>
                  <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9.5px] font-bold text-muted-foreground">
                    {c.engineType}
                  </span>
                  <span className="text-muted-foreground">
                    {c.defaultModel || '—'} · {c.isActive ? 'active' : 'inactive'}
                  </span>
                </div>
              ))
            )}
            <p className="mt-2 flex items-center gap-1.5 text-[10.5px] leading-snug text-muted-foreground">
              <Database className="h-3 w-3 shrink-0" />
              Agents run on the active connection for their node's provider — an inactive connection here is the usual
              cause of "no connection configured" chat errors.
            </p>
          </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}
