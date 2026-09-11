import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ChevronDown, Loader2, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NoteBar, SpecCard, StatCard, StatusBadge, T, type BadgeTone } from '@/components/spec/blocks';
import { DescribeAgentWizard } from '@/components/agent-builder/DescribeAgentWizard';
import { cn } from '@/lib/utils';
import { loadAgents, deleteAgent, createAgent, type AgentSummary } from '@/lib/agents-data';
import { loadExecutionLogs, type RawAgentExecution } from '@/lib/executions-data';

/** Approved spec screen 03 — "Which agents are healthy?" Stat row on top,
 *  then the all-agents table with a success ring, health badge, and a
 *  24-hour activity strip per agent. Numbers derive from the real
 *  execution log where one exists; agents without runs get an honest
 *  grey ring and "No runs yet", never a fabricated percentage. */

const RING_CIRC = 75.4; // 2π·12 — the spec's 28px ring
const EXEC_WINDOW = 250; // most-recent logs fetched for health/activity

type HealthTone = Extract<BadgeTone, 'ok' | 'warn' | 'error' | 'muted'>;

interface AgentRunStats {
  /** 0..1 success rate, or null when the agent has no runs at all. */
  rate: number | null;
  /** Runs for this agent inside the fetched log window. */
  logged: number;
  /** Twelve 2-hour buckets covering the last 24h, oldest first. */
  buckets: number[];
}

function deriveRunStats(agents: AgentSummary[], execs: RawAgentExecution[] | null): Map<string, AgentRunStats> {
  const map = new Map<string, AgentRunStats>();
  const now = Date.now();
  const windowStart = now - 24 * 60 * 60 * 1000;
  const bucketMs = (2 * 60 * 60 * 1000);

  for (const a of agents) {
    const mine = (execs ?? []).filter(e => e['AgentDefinition__r.Name'] === a.name);
    const buckets = new Array<number>(12).fill(0);
    let success = 0;
    let failed = 0;
    for (const e of mine) {
      if (e.Status__c === 'SUCCESS') success++;
      else if (e.Status__c === 'ERROR' || e.Status__c === 'TIMEOUT') failed++;
      const t = new Date(e.CreatedDate).getTime();
      if (t >= windowStart) {
        const idx = Math.min(11, Math.max(0, Math.floor((t - windowStart) / bucketMs)));
        buckets[idx]++;
      }
    }

    let rate: number | null = null;
    if (success + failed > 0) {
      rate = success / (success + failed);
    } else if ((a.totalExecutions ?? 0) > 0 && a.successRate != null) {
      // Server-tracked lifetime rate — used when the log window has no
      // terminal runs for this agent. Field is stored as a percentage.
      rate = a.successRate > 1 ? a.successRate / 100 : a.successRate;
    }
    map.set(a.id, { rate, logged: mine.length, buckets });
  }
  return map;
}

function healthOf(stats: AgentRunStats | undefined, status: string): { tone: HealthTone; label: string } {
  const rate = stats?.rate ?? null;
  if (rate == null) return { tone: 'muted', label: 'No runs yet' };
  const pct = Math.round(rate * 1000) / 10;
  const label = `${pct}% success`;
  if (status !== 'Active') return { tone: 'muted', label };
  if (rate >= 0.98) return { tone: 'ok', label };
  if (rate >= 0.9) return { tone: 'warn', label };
  return { tone: 'error', label };
}

const RING_COLORS: Record<HealthTone, [string, string]> = {
  ok: ['#2e844a', '#d9efe0'],
  warn: ['#dd7a01', '#fcf1e0'],
  error: ['#ba0517', '#f0d3d6'],
  muted: ['#8a919e', '#e0e2e7'],
};

/** 28px success ring — dasharray is rate·75.4 per the spec. A null rate
 *  renders the grey track only (no arc), never a fake 0% or 100%. */
function SuccessRing({ rate, tone }: { rate: number | null; tone: HealthTone }) {
  const [stroke, track] = rate == null ? RING_COLORS.muted : RING_COLORS[tone];
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="12" fill="none" stroke={track} strokeWidth="3.5" />
      {rate != null && (
        <circle
          cx="14"
          cy="14"
          r="12"
          fill="none"
          stroke={stroke}
          strokeWidth="3.5"
          strokeDasharray={`${Math.max(0, Math.min(1, rate)) * RING_CIRC} ${RING_CIRC}`}
          strokeLinecap="round"
          transform="rotate(-90 14 14)"
        />
      )}
    </svg>
  );
}

/** 12-bar 24h activity strip from real run buckets — empty buckets stay
 *  as 2px grey stubs, exactly like the spec's quiet rows. */
function ActivityBars({ buckets }: { buckets: number[] }) {
  const max = Math.max(...buckets, 1);
  return (
    <svg width="110" height="20" viewBox="0 0 110 20" aria-hidden="true">
      {buckets.map((count, i) => {
        const h = count > 0 ? 3 + Math.round((count / max) * 16) : 2;
        return (
          <rect
            key={i}
            x={i * 9}
            y={20 - h}
            width="6"
            height={h}
            rx="1"
            fill={count > 0 ? 'var(--primary)' : '#e0e2e7'}
          />
        );
      })}
    </svg>
  );
}

function statusTone(status: string): BadgeTone {
  if (status === 'Active') return 'ok';
  if (status === 'Draft') return 'blue';
  return 'muted';
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  // undefined = still loading · null = endpoint failed (page degrades honestly)
  const [execs, setExecs] = useState<RawAgentExecution[] | null | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDepartment, setNewDepartment] = useState('Sales');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoadState('loading');
    loadAgents()
      .then(list => {
        setAgents(list);
        setLoadState('ready');
      })
      .catch(err => {
        console.error('Failed to load agents:', err);
        setLoadState('error');
      });
    loadExecutionLogs({ pageSize: EXEC_WINDOW })
      .then(page => setExecs(page.records))
      .catch(err => {
        console.error('Failed to load execution logs (agents page degrades):', err);
        setExecs(null);
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The top bar's "+ New agent" (AppShell) lands on /?new=1 — open the
  // create dialog once, then strip the param so back/close behave.
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowNewAgent(true);
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const runStats = useMemo(() => deriveRunStats(agents, execs ?? null), [agents, execs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      a => a.name.toLowerCase().includes(q) || a.department.toLowerCase().includes(q)
    );
  }, [agents, search]);

  // ── Stat row ──────────────────────────────────────────────────────────
  const activeCount = agents.filter(a => a.status === 'Active').length;
  const draftCount = agents.filter(a => a.status === 'Draft').length;

  const todayExecs = (execs ?? []).filter(e => isToday(e.CreatedDate));
  const failedToday = todayExecs.filter(e => e.Status__c === 'ERROR' || e.Status__c === 'TIMEOUT').length;
  const totalRunsAllTime = agents.reduce((sum, a) => sum + (a.totalExecutions ?? 0), 0);

  const busiest = useMemo(() => {
    if (agents.length === 0) return null;
    if (execs && execs.length > 0) {
      const byLogged = [...agents].sort(
        (a, b) => (runStats.get(b.id)?.logged ?? 0) - (runStats.get(a.id)?.logged ?? 0)
      )[0];
      const logged = runStats.get(byLogged.id)?.logged ?? 0;
      if (logged > 0) return { agent: byLogged, sub: `${logged} of the last ${execs.length} logged runs` };
    }
    const byTotal = [...agents].sort((a, b) => (b.totalExecutions ?? 0) - (a.totalExecutions ?? 0))[0];
    if ((byTotal.totalExecutions ?? 0) > 0) {
      return { agent: byTotal, sub: `${byTotal.totalExecutions} runs all time` };
    }
    const byModified = [...agents].sort((a, b) =>
      (b.lastModifiedDate ?? '').localeCompare(a.lastModifiedDate ?? '')
    )[0];
    return { agent: byModified, sub: 'most recently edited — no runs logged yet' };
  }, [agents, execs, runStats]);

  // ── Existing behaviors, unchanged ─────────────────────────────────────
  const handleCreate = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    createAgent(name, newDepartment.trim() || 'Sales')
      .then(apiName => {
        setShowNewAgent(false);
        setNewName('');
        navigate(`/agent/${apiName}`);
      })
      .catch(err => {
        console.error('Failed to create agent:', err);
        setCreating(false);
      });
  }, [newName, newDepartment, navigate]);

  const handleDelete = useCallback(
    async (e: React.MouseEvent, agent: AgentSummary) => {
      e.stopPropagation();
      const ok = await confirmDialog({
        title: `Delete "${agent.name}"?`,
        description: "The agent, its nodes, and its configuration are removed. This can't be undone.",
        confirmLabel: 'Delete agent',
        variant: 'destructive',
      });
      if (!ok) return;
      setDeletingId(agent.id);
      deleteAgent(agent.id)
        .then(() => {
          toast.success(`"${agent.name}" deleted.`);
          setAgents(list => list.filter(a => a.id !== agent.id));
        })
        .catch(err => {
          console.error('Failed to delete agent:', err);
          toast.error('Delete failed', { description: err instanceof Error ? err.message : 'See console for details.' });
        })
        .finally(() => setDeletingId(null));
    },
    []
  );

  return (
    <AppShell title="Agents" onRefresh={refresh}>
      {showWizard && <DescribeAgentWizard onClose={() => setShowWizard(false)} />}

      <div className="mx-auto w-full max-w-5xl p-5">
        <div className="grid grid-cols-3 gap-3.5">
          <StatCard
            label="Live in production"
            value={loadState === 'ready' ? activeCount : '—'}
            sub={loadState === 'ready' ? `${draftCount} in draft` : '…'}
          />
          {execs !== null ? (
            <StatCard
              label="Runs today"
              value={execs === undefined ? '—' : todayExecs.length.toLocaleString()}
              sub={
                execs === undefined
                  ? '…'
                  : failedToday > 0
                    ? `${failedToday} failed`
                    : 'no failures'
              }
              subClass={failedToday > 0 ? 'text-[var(--archon-error)] font-semibold' : undefined}
            />
          ) : (
            <StatCard
              label="Total runs"
              value={totalRunsAllTime.toLocaleString()}
              sub="all time — today's execution log unavailable"
            />
          )}
          <StatCard
            label="Busiest agent"
            value={busiest ? busiest.agent.name : '—'}
            valueClass="font-sans text-[16px] leading-snug"
            sub={busiest ? busiest.sub : 'no agents yet'}
          />
        </div>

        <SpecCard
          className="mt-3.5"
          title="All agents"
          muted={loadState === 'ready' ? `${agents.length} total` : undefined}
          right={
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-7 w-44 pl-6.5 text-[11.5px]"
                  placeholder="Search agents…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" className="h-7 px-2.5 text-[11.5px]">
                    <Plus className="mr-1 h-3 w-3" /> New <ChevronDown className="ml-1 h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setShowWizard(true)}>
                    <Sparkles className="mr-2 h-3.5 w-3.5 text-primary" /> Describe your agent
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowNewAgent(true)}>
                    <Plus className="mr-2 h-3.5 w-3.5" /> Start blank
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        >
          {loadState === 'loading' && (
            <div className="flex items-center gap-2 px-3.5 py-8 text-[12.5px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading agents…
            </div>
          )}
          {loadState === 'error' && (
            <p className="px-3.5 py-8 text-[12.5px] text-destructive">
              Couldn't load agents. Reload the page to try again.
            </p>
          )}
          {loadState === 'ready' && filtered.length === 0 && (
            <p className="px-3.5 py-12 text-center text-[12.5px] text-muted-foreground">
              {agents.length === 0 ? 'No agents yet — create your first one.' : 'No agents match your search.'}
            </p>
          )}
          {loadState === 'ready' && filtered.length > 0 && (
            <div className="overflow-x-auto rounded-b-lg">
              <table className={T.table}>
                <thead>
                  <tr>
                    <th className={cn(T.th, 'w-10')} />
                    <th className={T.th}>Agent</th>
                    <th className={T.th}>Health</th>
                    <th className={T.th}>Activity 24h</th>
                    <th className={cn(T.th, 'text-right')}>Runs</th>
                    <th className={T.th}>Status</th>
                    <th className={cn(T.th, 'w-10')} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(a => {
                    const stats = runStats.get(a.id);
                    const health = healthOf(stats, a.status);
                    return (
                      <tr
                        key={a.id}
                        className={cn(T.trClick, 'group')}
                        onClick={() => navigate(`/agent/${a.apiName}`)}
                      >
                        <td className={T.td}>
                          <SuccessRing rate={stats?.rate ?? null} tone={health.tone} />
                        </td>
                        <td className={T.td}>
                          <span className="text-[12.5px] font-semibold text-primary">{a.name}</span>
                          <div className="text-[10.5px] text-[var(--archon-faint)]">
                            {a.department || 'No department'}
                            {a.version != null && ` · v${a.version}`}
                          </div>
                        </td>
                        <td className={T.td}>
                          <StatusBadge tone={health.tone}>{health.label}</StatusBadge>
                        </td>
                        <td className={T.td}>
                          <ActivityBars buckets={stats?.buckets ?? new Array<number>(12).fill(0)} />
                        </td>
                        <td className={cn(T.td, 'text-right font-mono')}>
                          {(a.totalExecutions ?? 0).toLocaleString()}
                        </td>
                        <td className={T.td}>
                          <StatusBadge tone={statusTone(a.status)}>{a.status}</StatusBadge>
                        </td>
                        <td className={T.td}>
                          <button
                            type="button"
                            disabled={deletingId === a.id}
                            onClick={e => handleDelete(e, a)}
                            className={cn(
                              'rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50',
                              deletingId === a.id && 'opacity-100'
                            )}
                            aria-label={`Delete ${a.name}`}
                          >
                            {deletingId === a.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {loadState === 'ready' && execs === null && (
            <NoteBar>
              The execution log couldn't be loaded — rings fall back to each agent's lifetime success
              rate and the activity strips stay empty.
            </NoteBar>
          )}
        </SpecCard>
      </div>

      <Dialog open={showNewAgent} onOpenChange={setShowNewAgent}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New agent</DialogTitle>
            <DialogDescription>
              Starts with one AI node and a read-only Salesforce tool — add subagents, tools, and
              more on the canvas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-agent-name">Name</Label>
              <Input
                id="new-agent-name"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Support Triage Agent"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-agent-dept">Department</Label>
              <Input
                id="new-agent-dept"
                value={newDepartment}
                onChange={e => setNewDepartment(e.target.value)}
                placeholder="Sales"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewAgent(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              {creating ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
