import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bolt, ChevronDown, ChevronRight, GitBranch, Loader2, PenLine, Play, Plug, Sparkles, Square, Wrench, Zap, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NODE_PALETTE, type PaletteItem } from '@/data/node-catalog';
import {
  isWriteTool,
  loadConnectorDirectoryWithRetry,
  loadMcpToolsWithRetry,
  type DirectoryEntry,
  type RemoteTool,
} from '@/lib/connectors-data';
import type { NodeType, ToolNodeConfig } from '@/types/agent';

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

const CHIPS = ['All', 'Nodes', 'MCP', 'Tools', 'Connectors'] as const;
type Chip = (typeof CHIPS)[number];

/** The in-platform ("built-in") tool flavors shown under the Tools chip —
 *  same tool node type, pre-set actionType so the properties panel opens
 *  straight into the right mode. */
const TOOL_PRESETS: PaletteItem[] = [
  {
    nodeType: 'tool',
    nodeSubType: 'tool',
    label: 'Apex Tool',
    sub: 'Call an invocable Apex method',
    iconClass: 'bg-[var(--archon-warning-tint,#FEF3E0)] text-[var(--archon-warning,#B45309)]',
    defaultConfig: { description: '', actionType: 'Apex', toolName: '', connectorId: '', requiresApproval: false } satisfies ToolNodeConfig,
  },
  {
    nodeType: 'tool',
    nodeSubType: 'tool',
    label: 'Flow Tool',
    sub: 'Run an autolaunched Flow',
    iconClass: 'bg-[var(--archon-success-tint,#E7F6EE)] text-[var(--archon-success,#1F9D61)]',
    defaultConfig: { description: '', actionType: 'Flow', toolName: '', connectorId: '', requiresApproval: false } satisfies ToolNodeConfig,
  },
  {
    nodeType: 'tool',
    nodeSubType: 'tool',
    label: 'Custom Tool (blank)',
    sub: 'Configure connector & tool yourself',
    iconClass: 'bg-secondary text-muted-foreground',
    defaultConfig: { description: '', actionType: 'MCP', toolName: '', connectorId: '', requiresApproval: false } satisfies ToolNodeConfig,
  },
];

/** Node categories shown under the Nodes chip — everything except the old
 *  'Tools' category (whose single generic item is superseded by
 *  TOOL_PRESETS above and the MCP section's per-tool insertion). */
const NODE_CATEGORIES = new Set(['Triggers', 'AI Models', 'Subagents', 'End']);

interface Item {
  key: string;
  kind: 'node' | 'connector';
  chip: Chip;
  label: string;
  sub: string;
  iconClass: string;
  icon: LucideIcon;
  node?: PaletteItem;
  connector?: DirectoryEntry;
}

export interface NodeQuickAddProps {
  /** Screen position (viewport px) to anchor the popover near. */
  anchor: { x: number; y: number };
  onClose: () => void;
  onAddNode: (item: PaletteItem) => void;
  onAddConnector: (entry: DirectoryEntry) => void;
  /** MCP section: click a server's tool → insert a ready-configured Tool
   *  node (connector + toolName + description pre-filled). */
  onAddMcpTool: (entry: DirectoryEntry, tool: RemoteTool) => void;
}

/** Search-first "add a node" command palette. Sections: Nodes (triggers/
 *  AI/subagents/end), MCP (every MCP server — standard + custom — with its
 *  live tool list expandable inline), Tools (built-in Apex/Flow/blank tool
 *  flavors), Connectors (catalog attachments). */
export function NodeQuickAdd({ anchor, onClose, onAddNode, onAddConnector, onAddMcpTool }: NodeQuickAddProps) {
  const [search, setSearch] = useState('');
  const [chip, setChip] = useState<Chip>('All');
  const [highlighted, setHighlighted] = useState(0);
  const [connectors, setConnectors] = useState<DirectoryEntry[] | null>(null);
  const [serverWaking, setServerWaking] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [toolsByProvider, setToolsByProvider] = useState<Record<string, RemoteTool[] | 'loading' | 'waking' | 'error'>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadConnectorDirectoryWithRetry(() => !cancelled && setServerWaking(true))
      .then(list => {
        if (cancelled) return;
        setConnectors(list);
        setServerWaking(false);
      })
      .catch(() => {
        if (cancelled) return;
        setConnectors([]);
        setServerWaking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [onClose]);

  const toggleServer = useCallback(
    (entry: DirectoryEntry) => {
      const key = entry.providerKey;
      setExpandedProvider(current => (current === key ? null : key));
      setToolsByProvider(current => {
        if (current[key]) return current; // cached (or in flight) — don't refetch
        loadMcpToolsWithRetry(key, entry.connectorId, () =>
          setToolsByProvider(m => (Array.isArray(m[key]) ? m : { ...m, [key]: 'waking' }))
        )
          .then(tools => setToolsByProvider(m => ({ ...m, [key]: tools })))
          .catch(() => setToolsByProvider(m => ({ ...m, [key]: 'error' })));
        return { ...current, [key]: 'loading' };
      });
    },
    []
  );

  const allItems = useMemo<Item[]>(() => {
    const nodeItems: Item[] = NODE_PALETTE.filter(cat => NODE_CATEGORIES.has(cat.category)).flatMap(cat =>
      cat.items.map(item => ({
        key: `node:${item.nodeType}:${item.nodeSubType}:${item.label}`,
        kind: 'node' as const,
        chip: 'Nodes' as Chip,
        label: item.label,
        sub: item.sub,
        iconClass: item.iconClass,
        icon: ICON_BY_TYPE[item.nodeType],
        node: item,
      }))
    );
    const toolItems: Item[] = TOOL_PRESETS.map(item => ({
      key: `tool:${item.label}`,
      kind: 'node' as const,
      chip: 'Tools' as Chip,
      label: item.label,
      sub: item.sub,
      iconClass: item.iconClass,
      icon: item.label.startsWith('Apex') ? Zap : item.label.startsWith('Flow') ? Play : Wrench,
      node: item,
    }));
    const connectorItems: Item[] = (connectors ?? [])
      .filter(c => c.status === 'Connected')
      .map(c => ({
        key: `connector:${c.providerKey}`,
        kind: 'connector' as const,
        chip: 'Connectors' as Chip,
        label: c.displayName,
        sub: c.accountEmail || 'Connected',
        iconClass: '',
        icon: Plug,
        connector: c,
      }));
    return [...nodeItems, ...toolItems, ...connectorItems];
  }, [connectors]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter(item => {
      if (chip !== 'All' && item.chip !== chip) return false;
      if (!q) return true;
      return item.label.toLowerCase().includes(q) || item.sub.toLowerCase().includes(q);
    });
  }, [allItems, chip, search]);

  const mcpServers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (connectors ?? []).filter(c => !q || c.displayName.toLowerCase().includes(q) || c.providerKey.toLowerCase().includes(q));
    const rank = (c: DirectoryEntry) => (c.status === 'Connected' ? 0 : 1);
    return {
      standard: list.filter(c => !c.isCustom).sort((a, b) => rank(a) - rank(b)),
      custom: list.filter(c => Boolean(c.isCustom)).sort((a, b) => rank(a) - rank(b)),
    };
  }, [connectors, search]);

  useEffect(() => {
    setHighlighted(0);
  }, [filtered.length, search, chip]);

  const commit = useCallback(
    (item: Item | undefined) => {
      if (!item) return;
      if (item.kind === 'node' && item.node) onAddNode(item.node);
      else if (item.kind === 'connector' && item.connector) onAddConnector(item.connector);
      onClose();
    },
    [onAddNode, onAddConnector, onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (chip === 'MCP') {
        return; // MCP view is mouse-driven (expandable rows)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlighted(i => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlighted(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        commit(filtered[highlighted]);
      }
    },
    [filtered, highlighted, commit, onClose, chip]
  );

  // Clamp so the popover never renders off the right/bottom edge.
  const style = useMemo(() => {
    const width = 330;
    const maxHeight = 420;
    const left = Math.min(anchor.x, window.innerWidth - width - 12);
    const top = Math.min(anchor.y, window.innerHeight - maxHeight - 12);
    return { left: Math.max(8, left), top: Math.max(8, top), width };
  }, [anchor]);

  const renderServerRow = (entry: DirectoryEntry) => {
    const connected = entry.status === 'Connected';
    const expanded = expandedProvider === entry.providerKey;
    const tools = toolsByProvider[entry.providerKey];
    return (
      <div key={entry.providerKey}>
        <div
          role="button"
          tabIndex={-1}
          onClick={() => connected && toggleServer(entry)}
          className={cn(
            'flex items-center gap-2.5 rounded-lg px-2 py-1.5',
            connected ? 'cursor-pointer hover:bg-secondary' : 'cursor-default opacity-55'
          )}
        >
          <div
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg text-white"
            style={{ backgroundColor: entry.brandColor ?? 'var(--muted-foreground)' }}
          >
            <Plug className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold leading-tight text-foreground">{entry.displayName}</div>
            <div className="truncate text-[10px] text-muted-foreground">
              {connected ? entry.accountEmail || 'Connected' : 'Connect it in Settings → Connectors'}
            </div>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[8.5px] font-bold',
              connected
                ? 'bg-[var(--archon-success-tint,#E7F6EE)] text-[var(--archon-success,#1F9D61)]'
                : 'bg-secondary text-muted-foreground'
            )}
          >
            {connected ? 'Connected' : 'Not connected'}
          </span>
          {connected && (expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />)}
        </div>
        {expanded && (
          <div className="mb-1 ml-[21px] border-l-2 border-accent">
            {(tools === 'loading' || tools === 'waking') && (
              <div className="flex items-center gap-1.5 px-3 py-2 text-[10.5px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {tools === 'waking' ? 'MCP server is waking up from idle — retrying automatically…' : 'Fetching tools…'}
              </div>
            )}
            {tools === 'error' && (
              <div className="px-3 py-2 text-[10.5px] text-muted-foreground">
                Couldn't reach this server.{' '}
                <button
                  type="button"
                  className="font-semibold text-primary hover:underline"
                  onClick={() => {
                    setToolsByProvider(m => {
                      const next = { ...m };
                      delete next[entry.providerKey];
                      return next;
                    });
                    toggleServer(entry);
                    setExpandedProvider(entry.providerKey);
                  }}
                >
                  Retry
                </button>
              </div>
            )}
            {Array.isArray(tools) && tools.length === 0 && (
              <div className="px-3 py-2 text-[10.5px] text-muted-foreground">This server reports no tools.</div>
            )}
            {Array.isArray(tools) &&
              tools.map(t => (
                <div
                  key={t.name}
                  role="button"
                  tabIndex={-1}
                  onClick={() => {
                    onAddMcpTool(entry, t);
                    onClose();
                  }}
                  className="group flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-secondary"
                >
                  <code className="shrink-0 font-mono text-[10.5px] font-semibold text-foreground">{t.name}</code>
                  {isWriteTool(t.name) && <PenLine className="h-2.5 w-2.5 shrink-0 text-[var(--archon-warning,#B45309)]" />}
                  <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">{t.description ?? ''}</span>
                  <span className="shrink-0 text-[12px] font-bold text-primary opacity-0 group-hover:opacity-100">+</span>
                </div>
              ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      className="fixed z-50 flex max-h-[420px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      style={style}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <svg className="h-3.5 w-3.5 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search nodes, tools, connectors…"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
        />
        <button type="button" onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border px-2.5 py-2">
        {CHIPS.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setChip(c)}
            className={cn(
              'rounded-full px-2.5 py-1 text-[10.5px] font-semibold transition-colors',
              chip === c ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
            )}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-1.5">
        {chip === 'MCP' ? (
          <>
            {connectors === null && (
              <div className="flex items-center gap-1.5 px-2.5 py-4 text-[11.5px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {serverWaking
                  ? 'Archon server is waking up from idle — fetching live statuses…'
                  : 'Loading MCP servers…'}
              </div>
            )}
            {connectors !== null && mcpServers.standard.length === 0 && mcpServers.custom.length === 0 && (
              <p className="px-2.5 py-4 text-center text-[11.5px] text-muted-foreground">No MCP servers found.</p>
            )}
            {mcpServers.standard.length > 0 && (
              <>
                <div className="px-2.5 pb-0.5 pt-2 text-[9.5px] font-bold tracking-wider text-muted-foreground">STANDARD MCP SERVERS</div>
                {mcpServers.standard.map(renderServerRow)}
              </>
            )}
            {mcpServers.custom.length > 0 && (
              <>
                <div className="px-2.5 pb-0.5 pt-2 text-[9.5px] font-bold tracking-wider text-muted-foreground">CUSTOM MCP SERVERS</div>
                {mcpServers.custom.map(renderServerRow)}
              </>
            )}
            <p className="border-t border-dashed border-border px-2.5 py-2 text-[10px] text-muted-foreground">
              Clicking a tool drops a ready-made Tool node — connector, tool name and description pre-filled, wired to your agent.
            </p>
          </>
        ) : (
          <>
            {filtered.length === 0 && (
              <p className="px-2.5 py-4 text-center text-[11.5px] text-muted-foreground">No matches.</p>
            )}
            {filtered.map((item, i) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.key}
                  role="button"
                  tabIndex={-1}
                  onMouseEnter={() => setHighlighted(i)}
                  onClick={() => commit(item)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5',
                    i === highlighted ? 'bg-accent' : 'hover:bg-secondary'
                  )}
                >
                  <div
                    className={cn('flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg', item.iconClass || 'bg-secondary text-muted-foreground')}
                    style={item.kind === 'connector' ? { backgroundColor: item.connector?.brandColor ?? 'var(--muted-foreground)', color: '#fff' } : undefined}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold leading-tight text-foreground">{item.label}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{item.sub}</div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-border bg-secondary/40 px-3 py-1.5 text-[9.5px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <kbd className="rounded border border-border bg-card px-1 py-0.5 font-sans">↑↓</kbd> navigate
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded border border-border bg-card px-1 py-0.5 font-sans">Enter</kbd> add
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded border border-border bg-card px-1 py-0.5 font-sans">Esc</kbd> close
        </span>
      </div>
    </div>
  );
}
