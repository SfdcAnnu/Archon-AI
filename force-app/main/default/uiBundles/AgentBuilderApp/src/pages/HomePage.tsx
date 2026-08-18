import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronDown, Loader2, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/button';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DescribeAgentWizard } from '@/components/agent-builder/DescribeAgentWizard';
import { loadAgents, deleteAgent, createAgent, type AgentSummary } from '@/lib/agents-data';

function statusPillStyle(status: string) {
  if (status === 'Active') {
    return { backgroundColor: 'var(--archon-success-tint)', color: 'var(--archon-success)' };
  }
  return { backgroundColor: 'var(--node-gray-tint)', color: 'var(--node-gray)' };
}

export default function HomePage() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
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
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      a => a.name.toLowerCase().includes(q) || a.department.toLowerCase().includes(q)
    );
  }, [agents, search]);

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
    (e: React.MouseEvent, agent: AgentSummary) => {
      e.stopPropagation();
      if (!window.confirm(`Delete "${agent.name}"? This can't be undone.`)) return;
      setDeletingId(agent.id);
      deleteAgent(agent.id)
        .then(() => setAgents(list => list.filter(a => a.id !== agent.id)))
        .catch(err => {
          console.error('Failed to delete agent:', err);
          window.alert('Delete failed — see console for details.');
        })
        .finally(() => setDeletingId(null));
    },
    []
  );

  return (
    <AppShell>
      <div className="flex h-full w-full flex-col overflow-y-auto">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-5">
          <span className="text-[14px] font-bold text-foreground">Workflows</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="h-8 text-xs">
                <Plus className="mr-1.5 h-3.5 w-3.5" /> New Agent <ChevronDown className="ml-1.5 h-3 w-3" />
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
        </header>

        {showWizard && <DescribeAgentWizard onClose={() => setShowWizard(false)} />}

        <div className="mx-auto w-full max-w-4xl flex-1 p-6">
          <div className="mb-4 flex items-center gap-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-8 pl-8 text-xs"
                placeholder="Search agents…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {loadState === 'loading' && (
            <div className="flex items-center gap-2 py-8 text-[12.5px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading agents…
            </div>
          )}
          {loadState === 'error' && (
            <p className="py-8 text-[12.5px] text-destructive">
              Couldn't load agents. Reload the page to try again.
            </p>
          )}
          {loadState === 'ready' && filtered.length === 0 && (
            <div className="rounded-lg border border-dashed border-border py-16 text-center">
              <p className="text-[13px] text-muted-foreground">
                {agents.length === 0 ? 'No agents yet — create your first one.' : 'No agents match your search.'}
              </p>
            </div>
          )}
          {loadState === 'ready' && filtered.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Executions</TableHead>
                    <TableHead>Last modified</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(a => (
                    <TableRow
                      key={a.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/agent/${a.apiName}`)}
                    >
                      <TableCell className="font-medium text-foreground">{a.name}</TableCell>
                      <TableCell className="text-muted-foreground">{a.department}</TableCell>
                      <TableCell>
                        <span
                          className="rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
                          style={statusPillStyle(a.status)}
                        >
                          {a.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{a.totalExecutions ?? 0}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(a.lastModifiedDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          disabled={deletingId === a.id}
                          onClick={e => handleDelete(e, a)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                          aria-label={`Delete ${a.name}`}
                        >
                          {deletingId === a.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
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
