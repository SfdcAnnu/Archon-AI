import { useCallback, useEffect, useMemo, useState } from 'react';
import { AGENT_KINDS, executeTypeOfKind, type AgentKindKey } from '@/lib/agent-kind';
import { AgentKindBadge } from '@/components/AgentKindBadge';
import { useNavigate, useSearchParams } from 'react-router';
import { Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { PageBody } from '@/components/shell/PageBody';
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
import { NoteBar, SpecCard, StatCard, StatusBadge, T, type BadgeTone } from '@/components/spec/blocks';
import { cn } from '@/lib/utils';
import { loadAgents, loadAgentActivity, deleteAgent, createAgent, type AgentActivity, type AgentSummary } from '@/lib/agents-data';

/** Approved spec screen 03 — "Which agents are healthy?" Stat row on top,
 *  then the all-agents table with a success ring, health badge, and a
 *  24-hour activity strip per agent. Numbers come from the org's own
 *  automation runs and chat messages (getAgentActivity); agents without
 *  runs get an honest grey ring and "No runs yet", never a made-up
 *  percentage. */

const RING_CIRC = 75.4; // 2π·12 — the spec's 28px ring

type HealthTone = Extract<BadgeTone, 'ok' | 'warn' | 'error' | 'muted'>;

interface AgentRunStats {
  /** 0..1 success rate, or null when nothing has finished or failed yet. */
  rate: number | null;
  /** Automation runs plus chat messages, all time. */
  runs: number;
  automationRuns: number;
  chatTurns: number;
  runs24h: number;
  failed24h: number;
  /** Twelve 2-hour buckets covering the last 24h, oldest first. */
  buckets: number[];
  lastActiveAt: string | null;
}

function toRunStats(a: AgentActivity): AgentRunStats {
  const settled = a.succeeded + a.failed;
  return {
    rate: settled > 0 ? a.succeeded / settled : null,
    runs: a.automationRuns + a.chatTurns,
    automationRuns: a.automationRuns,
    chatTurns: a.chatTurns,
    runs24h: a.buckets.reduce((n, b) => n + b, 0),
    failed24h: a.failed24h,
    buckets: a.buckets,
    lastActiveAt: a.lastActiveAt,
  };
}

function ago(iso: string | null): string {
  if (!iso) return 'Never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} d ago` : new Date(iso).toLocaleDateString();
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
  ok: ['var(--archon-success)', 'var(--archon-success-tint)'],
  warn: ['var(--node-amber)', 'var(--archon-warning-tint)'],
  error: ['var(--archon-error)', 'var(--archon-error-tint)'],
  muted: ['var(--archon-faint)', 'var(--border)'],
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
            fill={count > 0 ? 'var(--primary)' : 'var(--border)'}
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

export default function HomePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  // undefined = still loading · null = endpoint failed (page degrades honestly)
  const [activity, setActivity] = useState<AgentActivity[] | null | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDepartment, setNewDepartment] = useState('Sales');
  const [newKind, setNewKind] = useState<AgentKindKey>('communication');
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
    loadAgentActivity()
      .then(setActivity)
      .catch(err => {
        console.error('Failed to load agent activity (agents page degrades):', err);
        setActivity(null);
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

  const runStats = useMemo(
    () => new Map((activity ?? []).map(x => [x.agentId, toRunStats(x)] as const)),
    [activity],
  );

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

  const all = [...runStats.values()];
  const runs24h = all.reduce((n, x) => n + x.runs24h, 0);
  const failed24h = all.reduce((n, x) => n + x.failed24h, 0);
  const runsAllTime = all.reduce((n, x) => n + x.runs, 0);

  const busiest = useMemo(() => {
    if (agents.length === 0) return null;
    const by = (key: 'runs24h' | 'runs') =>
      [...agents].sort((a, b) => (runStats.get(b.id)?.[key] ?? 0) - (runStats.get(a.id)?.[key] ?? 0))[0];
    const day = by('runs24h');
    const dayRuns = runStats.get(day.id)?.runs24h ?? 0;
    if (dayRuns > 0) return { agent: day, sub: `${dayRuns} runs in the last 24 h` };
    const ever = by('runs');
    const everRuns = runStats.get(ever.id)?.runs ?? 0;
    if (everRuns > 0) return { agent: ever, sub: `${everRuns} runs all time — none in the last 24 h` };
    const byModified = [...agents].sort((a, b) =>
      (b.lastModifiedDate ?? '').localeCompare(a.lastModifiedDate ?? '')
    )[0];
    return { agent: byModified, sub: 'most recently edited — no runs yet' };
  }, [agents, runStats]);

  // ── Existing behaviors, unchanged ─────────────────────────────────────
  const handleCreate = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    createAgent(name, newDepartment.trim() || 'Sales', executeTypeOfKind(newKind))
      .then(apiName => {
        setShowNewAgent(false);
        setNewName('');
        navigate(`/agent/${apiName}`);
      })
      .catch(err => {
        console.error('Failed to create agent:', err);
        setCreating(false);
      });
  }, [newName, newDepartment, newKind, navigate]);

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

      <PageBody width="standard">
        <div className="grid grid-cols-3 gap-3.5">
          <StatCard
            label="Live in production"
            value={loadState === 'ready' ? activeCount : '—'}
            sub={loadState === 'ready' ? `${draftCount} in draft` : '…'}
          />
          <StatCard
            label="Runs · last 24 h"
            value={activity === undefined ? '—' : activity === null ? 'n/a' : runs24h.toLocaleString()}
            sub={
              activity === undefined
                ? '…'
                : activity === null
                  ? 'activity could not be loaded'
                  : failed24h > 0
                    ? `${failed24h} failed · ${runsAllTime.toLocaleString()} all time`
                    : `no failures · ${runsAllTime.toLocaleString()} all time`
            }
            subClass={failed24h > 0 ? 'text-[var(--archon-error)] font-semibold' : undefined}
          />
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
              <Button size="sm" className="h-7 px-2.5 text-[11.5px]" onClick={() => navigate('/new-agent')}>
                <Plus className="mr-1 h-3 w-3" /> New agent
              </Button>
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
                    <th className={T.th}>Agent</th>
                    <th className={T.th}>Type</th>
                    <th className={T.th}>Health</th>
                    <th className={T.th}>Activity 24h</th>
                    <th className={cn(T.th, 'text-right')}>Runs</th>
                    <th className={T.th}>Last active</th>
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
                          <span className="text-[12.5px] font-semibold text-primary">{a.name}</span>
                          {a.isSystem && (
                            <span className="ml-2 rounded-full bg-[var(--node-purple-tint)] px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[var(--node-purple)]" title="Shipped and managed by the platform — read-only; switch it Active or Inactive">
                              Built-in
                            </span>
                          )}
                          <div className="text-[10.5px] text-[var(--archon-faint)]">
                            {a.department || 'No department'}
                            {a.version != null && ` · v${a.version}`}
                          </div>
                        </td>
                        <td className={T.td}>
                          <AgentKindBadge executeType={a.executeType} />
                        </td>
                        <td className={T.td}>
                          <div className="flex items-center gap-2">
                            <SuccessRing rate={stats?.rate ?? null} tone={health.tone} />
                            <StatusBadge tone={health.tone}>{health.label}</StatusBadge>
                          </div>
                        </td>
                        <td className={T.td}>
                          <ActivityBars buckets={stats?.buckets ?? new Array<number>(12).fill(0)} />
                        </td>
                        <td
                          className={cn(T.td, 'text-right font-mono')}
                          title={stats ? `${stats.automationRuns} automation runs · ${stats.chatTurns} chat messages` : undefined}
                        >
                          {(stats?.runs ?? 0).toLocaleString()}
                        </td>
                        <td className={cn(T.td, 'whitespace-nowrap text-[11.5px] text-muted-foreground')}>
                          {ago(stats?.lastActiveAt ?? null)}
                        </td>
                        <td className={T.td}>
                          <StatusBadge tone={statusTone(a.status)}>{a.status}</StatusBadge>
                        </td>
                        <td className={T.td}>
                          {a.isSystem ? (
                            <span className="block text-center text-[10px] text-[var(--archon-faint)]" title="Built-in agents cannot be deleted — open it and switch it Inactive">—</span>
                          ) : (
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
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {loadState === 'ready' && activity === null && (
            <NoteBar>
              Agent activity couldn't be loaded — health, activity and runs stay empty until the page
              is refreshed.
            </NoteBar>
          )}
        </SpecCard>
      </PageBody>

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
              <Label>What kind of agent?</Label>
              <div className="grid gap-2" role="radiogroup" aria-label="Kind of agent">
                {AGENT_KINDS.map(k => (
                  <button
                    key={k.key}
                    type="button"
                    role="radio"
                    aria-checked={newKind === k.key}
                    onClick={() => setNewKind(k.key)}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                      newKind === k.key ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary/60',
                    )}
                  >
                    <k.Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-semibold text-foreground">{k.label}</span>
                      <span className="block text-[11.5px] leading-snug text-muted-foreground">{k.blurb}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
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
