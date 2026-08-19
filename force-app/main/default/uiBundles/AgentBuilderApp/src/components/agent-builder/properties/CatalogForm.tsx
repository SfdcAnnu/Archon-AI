import { useEffect, useMemo, useState } from 'react';
import { Loader2, PenLine, RefreshCw } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  isWriteTool,
  loadConnectorDirectoryWithRetry,
  loadMcpToolsWithRetry,
  type DirectoryEntry,
  type RemoteTool,
} from '@/lib/connectors-data';
import type { AgentNode, CatalogNodeConfig } from '@/types/agent';

export interface CatalogFormProps {
  node: AgentNode;
  onConfigChange: (patch: Partial<CatalogNodeConfig>) => void;
}

/** Catalog node editor — the multi-tool counterpart to ToolForm's single
 *  named action: a catalog grants the owning agent a SET of tools from one
 *  MCP server, so this renders the server's live tool list as CHECKBOXES
 *  (config.allowedTools is the checked subset). A tool node picks one
 *  action; a catalog node picks many — this form is what makes the "many"
 *  side actually editable instead of read-only chips. */
export function CatalogForm({ node, onConfigChange }: CatalogFormProps) {
  const cfg = node.config as CatalogNodeConfig;
  const provider = cfg?.provider ?? '';
  const allowed = useMemo(() => cfg?.allowedTools ?? [], [cfg?.allowedTools]);

  const [directory, setDirectory] = useState<DirectoryEntry[] | null>(null);
  const [directoryWaking, setDirectoryWaking] = useState(false);
  const [tools, setTools] = useState<RemoteTool[] | null>(null);
  const [toolsState, setToolsState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [toolsWaking, setToolsWaking] = useState(false);
  const [refreshSeq, setRefreshSeq] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadConnectorDirectoryWithRetry(() => !cancelled && setDirectoryWaking(true))
      .then(list => !cancelled && setDirectory(list))
      .catch(() => !cancelled && setDirectory([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const connectorOptions = useMemo(
    () => (directory ?? []).filter(d => d.status === 'Connected'),
    [directory]
  );

  useEffect(() => {
    if (!provider || !directory) {
      setToolsState(provider ? 'loading' : 'idle');
      return;
    }
    const entry = directory.find(d => d.providerKey === provider);
    let cancelled = false;
    setToolsState('loading');
    setToolsWaking(false);
    loadMcpToolsWithRetry(provider, entry?.connectorId, () => !cancelled && setToolsWaking(true))
      .then(list => {
        if (cancelled) return;
        setTools(list);
        setToolsState('ready');
        setToolsWaking(false);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load catalog tools:', err);
        setToolsState('error');
        setToolsWaking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, directory, refreshSeq]);

  const toggleTool = (name: string) => {
    const next = allowed.includes(name) ? allowed.filter(t => t !== name) : [...allowed, name];
    onConfigChange({ allowedTools: next });
  };

  // Tools saved on the node but no longer reported by the server (renamed,
  // removed) — shown so stale entries are visible and removable rather
  // than silently dead.
  const staleSelected = useMemo(
    () => (toolsState === 'ready' && tools ? allowed.filter(a => !tools.some(t => t.name === a)) : []),
    [toolsState, tools, allowed]
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">Description (shown to the AI)</Label>
        <Textarea
          value={cfg?.description ?? ''}
          onChange={e => onConfigChange({ description: e.target.value })}
          placeholder="What this toolset is for and when to use it."
          className="min-h-16 text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">MCP server</Label>
        {directory === null ? (
          <div className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {directoryWaking ? 'Archon server is waking up from idle — fetching connectors…' : 'Loading connectors…'}
          </div>
        ) : (
          <Select
            value={provider}
            onValueChange={v => {
              const entry = connectorOptions.find(d => d.providerKey === v);
              // Tools belong to ONE server — a provider switch invalidates
              // every previously ticked name, same rule as ToolForm's
              // action-type switch clearing toolName.
              onConfigChange({ provider: v, connectorId: entry?.connectorId ?? '', allowedTools: [] });
            }}
          >
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue placeholder="Select an MCP server…" />
            </SelectTrigger>
            <SelectContent>
              {connectorOptions.map(c => (
                <SelectItem key={c.providerKey} value={c.providerKey}>
                  {c.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {directory !== null && connectorOptions.length === 0 && (
          <p className="text-[10px] text-muted-foreground">
            No connected MCP servers found — connect one on the Connectors page first.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">
          Allowed tools <span className="font-medium text-muted-foreground">— tick every tool this agent may use</span>
        </Label>
        {!provider && (
          <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-[10.5px] text-muted-foreground">
            Select an MCP server above to see its available tools.
          </p>
        )}
        {provider && toolsState === 'loading' && (
          <div className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {toolsWaking ? 'MCP server is waking up from idle — retrying automatically…' : `Fetching tools from ${provider}…`}
          </div>
        )}
        {provider && toolsState === 'error' && (
          <div className="rounded-md border border-border px-3 py-2.5 text-[11px] text-muted-foreground">
            Couldn't reach the MCP server.{' '}
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setRefreshSeq(s => s + 1)}>
              Retry
            </button>
          </div>
        )}
        {provider && toolsState === 'ready' && tools && (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center justify-between bg-secondary px-2.5 py-1.5 text-[10px] text-muted-foreground">
              <span className="font-bold text-foreground">
                {allowed.length} of {tools.length} tools selected
              </span>
              <button
                type="button"
                className="flex items-center gap-1 hover:text-foreground"
                onClick={() => setRefreshSeq(s => s + 1)}
                title="Refresh"
              >
                fetched live · <RefreshCw className="h-2.5 w-2.5" /> refresh
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto">
              {tools.map(t => {
                const checked = allowed.includes(t.name);
                return (
                  <label
                    key={t.name}
                    className={cn(
                      'flex w-full cursor-pointer items-start gap-2 border-t border-border px-2.5 py-2 first:border-t-0',
                      checked ? 'bg-accent' : 'hover:bg-secondary'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTool(t.name)}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block font-mono text-[10.5px] font-semibold text-foreground">{t.name}</span>
                      {t.description && (
                        <span className={cn('mt-0.5 block text-[10px] leading-snug', isWriteTool(t.name) ? 'text-[var(--archon-warning,#b45309)]' : 'text-muted-foreground')}>
                          {isWriteTool(t.name) && <PenLine className="mr-1 inline h-2.5 w-2.5" />}
                          {t.description.slice(0, 140)}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
        {staleSelected.length > 0 && (
          <div className="rounded-md border border-[var(--archon-warning,#B45309)]/40 bg-[var(--archon-warning-tint,#FEF3E0)]/50 px-2.5 py-2 text-[10px] text-[var(--archon-warning,#B45309)]">
            Selected but no longer on the server: {staleSelected.join(', ')}{' '}
            <button
              type="button"
              className="font-bold hover:underline"
              onClick={() => onConfigChange({ allowedTools: allowed.filter(a => !staleSelected.includes(a)) })}
            >
              remove them
            </button>
          </div>
        )}
        {(!provider || toolsState === 'error') && allowed.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {allowed.map(t => (
              <span key={t} className="rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] text-foreground/80">
                {t}
              </span>
            ))}
          </div>
        )}
        <p className="text-[10px] leading-snug text-muted-foreground">
          A catalog grants a SET of tools from one server. For a single action with its own description and approval
          gate, use a Tool node instead.
        </p>
      </div>
    </div>
  );
}
