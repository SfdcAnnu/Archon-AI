import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Bolt, ChevronRight, GitBranch, GripVertical, Plug, ShieldCheck, Sparkles, Square, Wrench, Zap, type LucideIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { NODE_PALETTE, type PaletteItem } from '@/data/node-catalog';
import { loadConnectorDirectory, type DirectoryEntry } from '@/lib/connectors-data';
import type { NodeType } from '@/types/agent';

const ICON_BY_TYPE: Record<NodeType, LucideIcon> = {
  trigger: Bolt,
  ai: Sparkles,
  subagent: GitBranch,
  tool: Wrench,
  catalog: Plug,
  action: Wrench,
  logic: GitBranch,
  email: Wrench,
  sms: Wrench,
  storage: Wrench,
  end: Square,
  guardrail: ShieldCheck,
  automation: Zap,
};

/** A palette category header that collapses its items — keeps the default
 *  view from stacking every category's items at once (the "messy" left
 *  side feedback), without hiding anything the user hasn't chosen to hide. */
function PaletteSection({
  title,
  badge,
  open,
  onToggle,
  children,
}: {
  title: string;
  badge?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onToggle}>
      <CollapsibleTrigger className="flex w-full items-center gap-1 rounded-md px-1.5 py-1.5 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground hover:bg-secondary/60 hover:text-foreground">
        <ChevronRight className={cn('h-3 w-3 shrink-0 text-muted-foreground/70 transition-transform', open && 'rotate-90')} />
        <span className="flex-1 text-left">{title}</span>
        {badge}
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function Palette() {
  const [tab, setTab] = useState<'nodes' | 'tools'>('nodes');
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [connectors, setConnectors] = useState<DirectoryEntry[] | null>(null);
  const [connectorsError, setConnectorsError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const q = search.trim().toLowerCase();

  const toggleCategory = (category: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  useEffect(() => {
    if (tab !== 'tools' || connectors !== null) return;
    loadConnectorDirectory()
      .then(setConnectors)
      .catch(err => setConnectorsError(err instanceof Error ? err.message : String(err)));
  }, [tab, connectors]);

  const sections = NODE_PALETTE.map(cat => ({
    ...cat,
    items: q ? cat.items.filter(i => i.label.toLowerCase().includes(q)) : cat.items,
  })).filter(cat => cat.items.length > 0);



  function handleNodeDragStart(e: React.DragEvent, item: PaletteItem) {
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({ kind: 'node', nodeType: item.nodeType, nodeSubType: item.nodeSubType })
    );
    e.dataTransfer.effectAllowed = 'copy';
  }

  function handleConnectorDragStart(e: React.DragEvent, entry: DirectoryEntry) {
    if (entry.status !== 'Connected') {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('application/json', JSON.stringify({ kind: 'connector', entry }));
    e.dataTransfer.effectAllowed = 'copy';
  }

  return (
    <aside className="flex h-full w-[210px] shrink-0 flex-col border-r border-border bg-card">
      <div className="flex gap-1 border-b border-border p-1.5">
        <button
          onClick={() => setTab('nodes')}
          className={cn(
            'flex-1 rounded-md py-1.5 text-[11px] font-semibold transition-colors',
            tab === 'nodes' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Nodes
        </button>
        <button
          onClick={() => setTab('tools')}
          className={cn(
            'flex-1 rounded-md py-1.5 text-[11px] font-semibold transition-colors',
            tab === 'tools' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Tools
        </button>
      </div>
      <div className="border-b border-border px-2.5 py-2">
        <Input
          placeholder={tab === 'nodes' ? 'Search nodes…' : 'Search tools…'}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-8 text-xs"
        />
      </div>

      {tab === 'nodes' && (
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4 pt-1.5">
          {sections.map(cat => (
            <PaletteSection
              key={cat.category}
              title={cat.category}
              open={q ? true : !collapsed.has(cat.category)}
              onToggle={() => toggleCategory(cat.category)}
              badge={
                cat.isNew && (
                  <span className="rounded-full bg-accent px-1.5 py-px text-[8px] font-bold tracking-wide text-primary">
                    NEW
                  </span>
                )
              }
            >
              {cat.items.map(item => {
                const Icon = ICON_BY_TYPE[item.nodeType];
                return (
                  <div
                    key={`${item.nodeType}:${item.nodeSubType}`}
                    draggable
                    onDragStart={e => handleNodeDragStart(e, item)}
                    className="flex cursor-grab items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-secondary active:cursor-grabbing"
                  >
                    <div className={cn('flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-lg', item.iconClass)}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold leading-tight text-foreground">{item.label}</div>
                      {item.sub && <div className="text-[10px] text-muted-foreground">{item.sub}</div>}
                    </div>
                  </div>
                );
              })}
            </PaletteSection>
          ))}
        </div>
      )}

      {tab === 'tools' && (
        <div className="flex-1 space-y-2 overflow-y-auto px-2.5 pb-4 pt-2">
          <div className="px-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Directory</div>
          {connectorsError && (
            <p className="px-0.5 text-[10.5px] leading-snug text-destructive">
              Couldn&rsquo;t load tools: {connectorsError}
            </p>
          )}
          {!connectors && !connectorsError && (
            <p className="px-0.5 text-[10.5px] text-muted-foreground">Loading…</p>
          )}
          {(connectors ?? [])
            .filter(c => !q || c.displayName.toLowerCase().includes(q) || c.providerKey.toLowerCase().includes(q))
            .map(entry => {
              const connected = entry.status === 'Connected';
              return (
                <div
                  key={entry.providerKey}
                  draggable={connected}
                  onDragStart={e => handleConnectorDragStart(e, entry)}
                  className={cn(
                    'rounded-xl border border-border bg-card p-2.5',
                    connected && 'cursor-grab hover:border-primary/40 hover:shadow-sm active:cursor-grabbing'
                  )}
                  title={connected ? 'Drag onto the canvas to give an agent these tools' : undefined}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-white"
                      style={{ backgroundColor: entry.brandColor ?? 'var(--muted-foreground)' }}
                    >
                      <Plug className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-bold leading-tight text-foreground">{entry.displayName}</div>
                      <span
                        className="mt-0.5 inline-block rounded-full px-1.5 py-px text-[9px] font-bold"
                        style={connected
                          ? { backgroundColor: 'var(--archon-success-tint,#E7F6EE)', color: 'var(--archon-success,#1F9D61)' }
                          : { backgroundColor: 'var(--muted,#F1F2F6)', color: 'var(--muted-foreground)' }}
                      >
                        {connected ? 'Connected' : 'Not configured'}
                      </span>
                    </div>
                    {connected ? (
                      <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                    ) : (
                      <button
                        type="button"
                        onClick={() => navigate('/connectors')}
                        className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[10.5px] font-bold text-foreground hover:bg-secondary"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                  {connected && entry.accountEmail && (
                    <div className="mt-1 truncate pl-[42px] text-[10px] text-muted-foreground">{entry.accountEmail}</div>
                  )}
                </div>
              );
            })}
          <div className="pt-1.5 px-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Custom MCP servers</div>
          <button
            type="button"
            onClick={() => navigate('/connectors')}
            className="w-full rounded-xl border border-dashed border-border px-3 py-2.5 text-left text-[11.5px] font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            + Add server
          </button>
          <p className="px-0.5 text-[10px] leading-snug text-muted-foreground">
            Pre-integrated tool servers — authorize once, then drag onto any agent. Connected ones are draggable.
          </p>
        </div>
      )}
    </aside>
  );
}
