import { useEffect, useState, type ReactNode } from 'react';
import { Bolt, ChevronRight, GitBranch, Plug, Sparkles, Square, Wrench, type LucideIcon } from 'lucide-react';
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
};

const CATEGORY_ORDER = ['CRM', 'Storage', 'Email', 'Channels', 'Other'];

function connectorCategory(entry: DirectoryEntry): string {
  const t = entry.mapsToCatalogType ?? '';
  if (t.includes('crm')) return 'CRM';
  if (t.includes('storage')) return 'Storage';
  if (t.includes('email')) return 'Email';
  if (t.includes('channel')) return 'Channels';
  return entry.category || 'Other';
}

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
  const [tab, setTab] = useState<'nodes' | 'connectors'>('nodes');
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
    if (tab !== 'connectors' || connectors !== null) return;
    loadConnectorDirectory()
      .then(setConnectors)
      .catch(err => setConnectorsError(err instanceof Error ? err.message : String(err)));
  }, [tab, connectors]);

  const sections = NODE_PALETTE.map(cat => ({
    ...cat,
    items: q ? cat.items.filter(i => i.label.toLowerCase().includes(q)) : cat.items,
  })).filter(cat => cat.items.length > 0);

  const connectorGroups = (() => {
    if (!connectors) return [];
    const filtered = q
      ? connectors.filter(c => c.displayName.toLowerCase().includes(q) || c.providerKey.toLowerCase().includes(q))
      : connectors;
    const byCategory = new Map<string, DirectoryEntry[]>();
    for (const c of filtered) {
      const cat = connectorCategory(c);
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(c);
    }
    return CATEGORY_ORDER.filter(c => byCategory.has(c)).map(c => ({ category: c, items: byCategory.get(c)! }));
  })();

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
          onClick={() => setTab('connectors')}
          className={cn(
            'flex-1 rounded-md py-1.5 text-[11px] font-semibold transition-colors',
            tab === 'connectors' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Connectors
        </button>
      </div>
      <div className="border-b border-border px-2.5 py-2">
        <Input
          placeholder={tab === 'nodes' ? 'Search nodes…' : 'Search connectors…'}
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

      {tab === 'connectors' && (
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4 pt-1.5">
          {connectorsError && (
            <p className="px-1.5 pt-3 text-[10.5px] leading-snug text-destructive">
              Couldn&rsquo;t load connectors: {connectorsError}
            </p>
          )}
          {!connectors && !connectorsError && (
            <p className="px-1.5 pt-3 text-[10.5px] text-muted-foreground">Loading…</p>
          )}
          {connectorGroups.map(group => (
            <PaletteSection
              key={group.category}
              title={group.category}
              open={q ? true : !collapsed.has(group.category)}
              onToggle={() => toggleCategory(group.category)}
            >
              {group.items.map(entry => {
                const connected = entry.status === 'Connected';
                return (
                  <div
                    key={entry.providerKey}
                    draggable={connected}
                    onDragStart={e => handleConnectorDragStart(e, entry)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-1.5 py-1.5',
                      connected ? 'cursor-grab hover:bg-secondary active:cursor-grabbing' : 'opacity-50'
                    )}
                    title={connected ? undefined : 'Not connected — set up this provider first'}
                  >
                    <div
                      className="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-lg text-white"
                      style={{ backgroundColor: entry.brandColor ?? 'var(--muted-foreground)' }}
                    >
                      <Plug className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold leading-tight text-foreground">
                        {entry.displayName}
                      </div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {entry.accountEmail || (connected ? 'Connected' : 'Not connected')}
                      </div>
                    </div>
                    {connected && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--archon-success)]" />
                    )}
                  </div>
                );
              })}
            </PaletteSection>
          ))}
        </div>
      )}
    </aside>
  );
}
