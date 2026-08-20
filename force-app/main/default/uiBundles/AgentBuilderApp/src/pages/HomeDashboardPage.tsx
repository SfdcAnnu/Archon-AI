import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Activity,
  Bot,
  CheckSquare,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { loadAgents, type AgentSummary } from '@/lib/agents-data';
import { listMySessions, type SessionSummary } from '@/lib/conversations-data';
import { loadPendingApprovals, type ApprovalDto } from '@/lib/approvals-data';
import { loadExecutionLogs } from '@/lib/executions-data';

/** Landing dashboard behind the nav's "Home" item — a read-only summary of
 *  everything the other pages manage: agent counts, executions, sessions,
 *  pending approvals, plus the most recent agents/conversations as jump-off
 *  points. Every section loads independently (allSettled) so one failing
 *  endpoint degrades to a dash instead of blanking the whole page. */

interface DashData {
  agents: AgentSummary[] | null;
  sessions: SessionSummary[] | null;
  approvals: ApprovalDto[] | null;
  executionTotal: number | null;
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  onClick,
}: {
  icon: typeof Bot;
  label: string;
  value: string;
  sub?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-border bg-card p-4 text-left',
        onClick && 'transition-colors hover:border-primary/40 hover:bg-accent/40'
      )}
    >
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="text-2xl font-bold text-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </button>
  );
}

function StatusChip({ status }: { status: string }) {
  const active = status === 'Active';
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[10px] font-bold',
        active
          ? 'bg-[var(--archon-success)]/10 text-[var(--archon-success)]'
          : 'bg-secondary text-muted-foreground'
      )}
    >
      {status}
    </span>
  );
}

export default function HomeDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.allSettled([
      loadAgents(),
      listMySessions(50),
      loadPendingApprovals(),
      loadExecutionLogs({ pageSize: 1 }),
    ]).then(([agentsR, sessionsR, approvalsR, execR]) => {
      setData({
        agents: agentsR.status === 'fulfilled' ? agentsR.value : null,
        sessions: sessionsR.status === 'fulfilled' ? sessionsR.value : null,
        approvals: approvalsR.status === 'fulfilled' ? approvalsR.value : null,
        executionTotal: execR.status === 'fulfilled' ? execR.value.total : null,
      });
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const agents = data?.agents ?? [];
  const activeCount = agents.filter(a => a.status === 'Active').length;
  const draftCount = agents.filter(a => a.status !== 'Active').length;
  const recentAgents = [...agents]
    .sort((a, b) => (b.lastModifiedDate ?? '').localeCompare(a.lastModifiedDate ?? ''))
    .slice(0, 5);
  const recentSessions = (data?.sessions ?? []).slice(0, 5);
  const pendingCount = data?.approvals?.length ?? 0;

  return (
    <AppShell>
      <div className="flex h-full w-full flex-col overflow-y-auto">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-5">
          <span className="text-[14px] font-bold text-foreground">Home</span>
          <button
            type="button"
            onClick={load}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="mx-auto w-full max-w-5xl flex-1 p-6">
          {loading && !data ? (
            <div className="flex items-center gap-2 py-8 text-[12.5px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="space-y-6">
              {/* Quick actions */}
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-4">
                <div className="mr-auto">
                  <div className="text-[14px] font-bold text-foreground">Welcome to Archon AI</div>
                  <div className="text-[11.5px] text-muted-foreground">
                    Build an agent from a description, or manage the ones you have.
                  </div>
                </div>
                <Button size="sm" className="h-8 text-[12px]" onClick={() => navigate('/')}>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Generate an agent
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => navigate('/')}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> All workflows
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => navigate('/chat')}>
                  <MessageSquare className="mr-1.5 h-3.5 w-3.5" /> Open chat
                </Button>
              </div>

              {pendingCount > 0 && (
                <button
                  type="button"
                  onClick={() => navigate('/approvals')}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-[var(--archon-warning,#B45309)]/40 bg-[var(--archon-warning-tint,#FEF3E0)]/50 px-4 py-3 text-left text-[12.5px] font-semibold text-[var(--archon-warning,#B45309)] hover:opacity-90"
                >
                  <CheckSquare className="h-4 w-4 shrink-0" />
                  {pendingCount} approval{pendingCount === 1 ? '' : 's'} waiting for your decision — review now ›
                </button>
              )}

              {/* KPI tiles */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile
                  icon={Bot}
                  label="Agents"
                  value={data?.agents ? String(agents.length) : '—'}
                  sub={data?.agents ? `${activeCount} active · ${draftCount} draft` : 'unavailable'}
                  onClick={() => navigate('/')}
                />
                <StatTile
                  icon={Activity}
                  label="Executions"
                  value={data?.executionTotal != null ? String(data.executionTotal) : '—'}
                  sub="automation runs"
                  onClick={() => navigate('/executions')}
                />
                <StatTile
                  icon={MessageSquare}
                  label="Conversations"
                  value={data?.sessions ? String(data.sessions.length) : '—'}
                  sub="your chat sessions"
                  onClick={() => navigate('/conversations')}
                />
                <StatTile
                  icon={CheckSquare}
                  label="Approvals"
                  value={data?.approvals ? String(pendingCount) : '—'}
                  sub="pending your decision"
                  onClick={() => navigate('/approvals')}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {/* Recent agents */}
                <section className="rounded-lg border border-border bg-card">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                    <span className="text-[12.5px] font-bold text-foreground">Recent agents</span>
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-primary hover:underline"
                      onClick={() => navigate('/')}
                    >
                      View all ›
                    </button>
                  </div>
                  {recentAgents.length === 0 ? (
                    <p className="px-4 py-6 text-[11.5px] text-muted-foreground">
                      No agents yet — generate one from a description to get started.
                    </p>
                  ) : (
                    recentAgents.map(a => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => navigate(`/agent/${a.apiName}`)}
                        className="flex w-full items-center gap-3 border-b border-border px-4 py-2.5 text-left last:border-b-0 hover:bg-accent/40"
                      >
                        <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-semibold text-foreground">{a.name}</span>
                          <span className="block truncate text-[10.5px] text-muted-foreground">
                            {a.department || 'No department'} · edited {new Date(a.lastModifiedDate).toLocaleDateString()}
                          </span>
                        </span>
                        <StatusChip status={a.status} />
                      </button>
                    ))
                  )}
                </section>

                {/* Recent conversations */}
                <section className="rounded-lg border border-border bg-card">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                    <span className="text-[12.5px] font-bold text-foreground">Recent conversations</span>
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-primary hover:underline"
                      onClick={() => navigate('/conversations')}
                    >
                      View all ›
                    </button>
                  </div>
                  {recentSessions.length === 0 ? (
                    <p className="px-4 py-6 text-[11.5px] text-muted-foreground">No chat sessions yet.</p>
                  ) : (
                    recentSessions.map(s => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => navigate('/conversations')}
                        className="flex w-full items-center gap-3 border-b border-border px-4 py-2.5 text-left last:border-b-0 hover:bg-accent/40"
                      >
                        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-semibold text-foreground">
                            {s.title || s.name}
                          </span>
                          <span className="block truncate text-[10.5px] text-muted-foreground">
                            {s.agentName}
                            {s.lastActivityAt && ` · ${new Date(s.lastActivityAt).toLocaleString()}`}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-bold',
                            s.status === 'Active'
                              ? 'bg-[var(--archon-success)]/10 text-[var(--archon-success)]'
                              : 'bg-secondary text-muted-foreground'
                          )}
                        >
                          {s.status}
                        </span>
                      </button>
                    ))
                  )}
                </section>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
