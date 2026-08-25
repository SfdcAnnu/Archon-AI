import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Loader2, PenLine, RefreshCw } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  describeCustomAction,
  isWriteTool,
  loadConnectorDirectoryWithRetry,
  loadCustomActions,
  loadMcpToolsWithRetry,
  type CustomActionDetail,
  type CustomActionParam,
  type CustomActionSummary,
  type DirectoryEntry,
  type RemoteTool,
} from '@/lib/connectors-data';
import type { AgentNode, ToolNodeConfig } from '@/types/agent';

const ACTION_TYPES: ToolNodeConfig['actionType'][] = ['MCP', 'Apex', 'Flow'];

export interface ToolFormProps {
  node: AgentNode;
  onConfigChange: (patch: Partial<ToolNodeConfig>) => void;
  /** Multi-select support: create one NEW tool node per entry, wired to the
   *  same parent as this node (AgentBuilder implements the graph mutation).
   *  This keeps the one-node-one-tool contract while letting the user pick
   *  several tools in a single visit to this list. */
  onAddSiblingTools?: (tools: Array<{ name: string; description: string | null }>) => void;
}

function ParamList({ title, icon: Icon, params }: { title: string; icon: typeof ArrowDownToLine; params: CustomActionParam[] }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-2.5 w-2.5" /> {title}
      </div>
      {params.length === 0 ? (
        <p className="text-[10.5px] text-muted-foreground">None</p>
      ) : (
        <div className="space-y-1">
          {params.map(p => (
            <div key={p.name} className="flex items-baseline gap-1.5 text-[10.5px]">
              <span className="font-mono font-semibold text-foreground">{p.name}</span>
              {p.type && <span className="text-muted-foreground">{p.type}</span>}
              {p.required && (
                <span className="rounded-full bg-[var(--archon-warning-tint,#FEF3E0)] px-1.5 text-[8.5px] font-bold text-[var(--archon-warning,#B45309)]">
                  required
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tool node config. MCP: real connected-connector dropdown + that server's
 *  ACTIVE tools fetched live. Apex/Flow: a picker over the org's OWN
 *  invocable Apex actions / autolaunched Flows (Salesforce's standard
 *  invocable-actions API via the Node server), showing each action's real
 *  input/output parameters once selected. Existing saved nodes store the
 *  PROVIDER KEY in config.connectorId (e.g. 'salesforce_mcp'), so that
 *  stays the MCP select's value — changing that convention would orphan
 *  every saved tool binding. */
export function ToolForm({ node, onConfigChange, onAddSiblingTools }: ToolFormProps) {
  const cfg = node.config as ToolNodeConfig;
  /** Tool names ticked for "also add as their own nodes" (never includes
   *  this node's own bound tool). */
  const [staged, setStaged] = useState<Set<string>>(new Set());

  const [directory, setDirectory] = useState<DirectoryEntry[] | null>(null);
  const [directoryWaking, setDirectoryWaking] = useState(false);
  const [tools, setTools] = useState<RemoteTool[] | null>(null);
  const [toolsState, setToolsState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [toolsWaking, setToolsWaking] = useState(false);
  const [manualEntry, setManualEntry] = useState(false);
  const [refreshSeq, setRefreshSeq] = useState(0);

  const [actions, setActions] = useState<CustomActionSummary[] | null>(null);
  const [actionsState, setActionsState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [details, setDetails] = useState<Record<string, CustomActionDetail | 'loading' | 'error'>>({});

  const isPlatformAction = cfg?.actionType === 'Apex' || cfg?.actionType === 'Flow';
  const platformType: 'apex' | 'flow' = cfg?.actionType === 'Flow' ? 'flow' : 'apex';

  useEffect(() => {
    let cancelled = false;
    loadConnectorDirectoryWithRetry(() => !cancelled && setDirectoryWaking(true))
      .then(list => {
        if (cancelled) return;
        setDirectory(list);
        setDirectoryWaking(false);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load connector directory:', err);
        setDirectory([]);
        setDirectoryWaking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const connectorOptions = useMemo(
    () => (directory ?? []).filter(d => d.status === 'Connected'),
    [directory]
  );
  const selectedEntry = connectorOptions.find(d => d.providerKey === cfg?.connectorId) ?? null;

  // MCP: live tool list for the selected connector.
  useEffect(() => {
    if (cfg?.actionType !== 'MCP' || !cfg?.connectorId || !directory) {
      setTools(null);
      setToolsState('idle');
      return;
    }
    const entry = directory.find(d => d.providerKey === cfg.connectorId);
    let cancelled = false;
    setToolsState('loading');
    setToolsWaking(false);
    loadMcpToolsWithRetry(cfg.connectorId, entry?.connectorId, () => !cancelled && setToolsWaking(true))
      .then(list => {
        if (cancelled) return;
        setTools(list);
        setToolsState('ready');
        setToolsWaking(false);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load MCP tools:', err);
        setToolsState('error');
        setToolsWaking(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.actionType, cfg?.connectorId, directory, refreshSeq]);

  // Apex/Flow: the org's invocable-actions catalog (one fetch covers both).
  useEffect(() => {
    if (!isPlatformAction || actions !== null || actionsState === 'loading') return;
    let cancelled = false;
    setActionsState('loading');
    loadCustomActions()
      .then(list => {
        if (cancelled) return;
        setActions(list);
        setActionsState('ready');
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load custom actions:', err);
        setActionsState('error');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlatformAction, refreshSeq]);

  const typeActions = useMemo(
    () => (actions ?? []).filter(a => a.type === platformType),
    [actions, platformType]
  );
  const selectedAction = typeActions.find(a => a.name === cfg?.toolName) ?? null;
  const detailKey = selectedAction ? `${selectedAction.type}:${selectedAction.name}` : null;
  const selectedDetail = detailKey ? details[detailKey] : undefined;

  // Describe the selected action (inputs/outputs) — cached per action.
  useEffect(() => {
    if (!selectedAction || !detailKey || details[detailKey]) return;
    setDetails(d => ({ ...d, [detailKey]: 'loading' }));
    describeCustomAction(selectedAction.type, selectedAction.name)
      .then(detail => setDetails(d => ({ ...d, [detailKey]: detail })))
      .catch(err => {
        console.error('Failed to describe custom action:', err);
        setDetails(d => ({ ...d, [detailKey]: 'error' }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailKey]);

  const handlePickTool = (tool: RemoteTool) => {
    const patch: Partial<ToolNodeConfig> = { toolName: tool.name };
    // Fill the AI-facing description only when the user hasn't written one —
    // their own wording always wins over the server's generic blurb.
    if (!cfg?.description?.trim() && tool.description) patch.description = tool.description;
    onConfigChange(patch);
  };

  const handlePickAction = (name: string) => {
    onConfigChange({ toolName: name });
  };

  // Backfill the description from the action's own describe, same
  // only-if-blank rule as MCP tools.
  useEffect(() => {
    if (!selectedDetail || typeof selectedDetail === 'string') return;
    if (!cfg?.description?.trim() && selectedDetail.description) {
      onConfigChange({ description: selectedDetail.description });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDetail]);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">Description (shown to the AI)</Label>
        <Textarea
          value={cfg?.description ?? ''}
          onChange={e => onConfigChange({ description: e.target.value })}
          placeholder="What this tool does and when to use it."
          className="min-h-16 text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">Action type</Label>
        <div className="flex gap-1.5">
          {ACTION_TYPES.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => {
                if (cfg?.actionType === t) return;
                // A tool name never survives an action-type switch — an MCP
                // tool name is meaningless as an Apex action and vice versa.
                onConfigChange({ actionType: t, toolName: '' });
                setManualEntry(false);
              }}
              className={cn(
                'flex-1 rounded-md border px-0 py-1.5 text-center text-[11.5px] font-semibold transition-colors',
                cfg?.actionType === t
                  ? 'border-primary bg-accent text-primary'
                  : 'border-border text-muted-foreground hover:bg-secondary'
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {cfg?.actionType === 'MCP' && (
        <div className="space-y-1.5">
          <Label className="text-[11px] font-bold">Connector</Label>
          {directory === null ? (
            <div className="flex items-center gap-1.5 py-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {directoryWaking ? 'Archon server is waking up from idle — fetching connectors…' : 'Loading connectors…'}
            </div>
          ) : (
            <Select value={cfg?.connectorId ?? ''} onValueChange={v => onConfigChange({ connectorId: v, toolName: '' })}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue placeholder="Select a connector…" />
              </SelectTrigger>
              <SelectContent>
                {connectorOptions.map(c => (
                  <SelectItem key={c.providerKey} value={c.providerKey}>
                    {c.displayName}
                    {c.isCustom ? ' · custom' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {directory !== null && connectorOptions.length === 0 && (
            <p className="text-[10.5px] text-muted-foreground">
              No connected MCP servers yet — connect one in Settings → Connectors.
            </p>
          )}
        </div>
      )}

      {cfg?.actionType === 'MCP' && !manualEntry && (
        <div className="space-y-1.5">
          <Label className="text-[11px] font-bold">
            Tool <span className="font-medium text-muted-foreground">— pick from the server's live list</span>
          </Label>
          {!cfg?.connectorId && (
            <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-[10.5px] text-muted-foreground">
              Select a connector above to see its available tools.
            </p>
          )}
          {cfg?.connectorId && toolsState === 'loading' && (
            <div className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {toolsWaking
                ? 'MCP server is waking up from idle — retrying automatically…'
                : `Fetching tools from ${selectedEntry?.displayName ?? cfg.connectorId}…`}
            </div>
          )}
          {cfg?.connectorId && toolsState === 'error' && (
            <div className="rounded-md border border-border px-3 py-2.5 text-[11px] text-muted-foreground">
              Couldn't reach the MCP server.{' '}
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setRefreshSeq(s => s + 1)}>
                Retry
              </button>{' '}
              or{' '}
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setManualEntry(true)}>
                enter the name manually
              </button>
              .
            </div>
          )}
          {cfg?.connectorId && toolsState === 'ready' && tools && (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="flex items-center justify-between bg-secondary px-2.5 py-1.5 text-[10px] text-muted-foreground">
                <span className="font-bold text-foreground">{tools.length} active tool{tools.length === 1 ? '' : 's'}</span>
                <button
                  type="button"
                  className="flex items-center gap-1 hover:text-foreground"
                  onClick={() => setRefreshSeq(s => s + 1)}
                  title="Refresh"
                >
                  fetched live · <RefreshCw className="h-2.5 w-2.5" /> refresh
                </button>
              </div>
              <div className="max-h-52 overflow-y-auto">
                {tools.length === 0 && (
                  <p className="px-3 py-3 text-[10.5px] text-muted-foreground">This server reports no tools.</p>
                )}
                {tools.map(t => {
                  const selected = t.name === cfg?.toolName;
                  const isStaged = staged.has(t.name);
                  return (
                    <div
                      key={t.name}
                      className={cn(
                        'flex w-full items-start gap-2 border-t border-border px-2.5 py-2 first:border-t-0',
                        selected ? 'bg-accent' : isStaged ? 'bg-[var(--archon-success)]/5' : 'hover:bg-secondary'
                      )}
                    >
                      <button type="button" onClick={() => handlePickTool(t)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                        <span
                          className={cn(
                            'mt-0.5 h-3 w-3 shrink-0 rounded-full border-2',
                            selected ? 'border-[4px] border-primary' : 'border-border'
                          )}
                        />
                        <span className="min-w-0">
                          <span className="block font-mono text-[10.5px] font-semibold text-foreground">{t.name}</span>
                          {t.description && (
                            <span className={cn('mt-0.5 block text-[10px] leading-snug', isWriteTool(t.name) ? 'text-[var(--archon-warning,#b45309)]' : 'text-muted-foreground')}>
                              {isWriteTool(t.name) && <PenLine className="mr-1 inline h-2.5 w-2.5" />}
                              {t.description}
                            </span>
                          )}
                        </span>
                      </button>
                      {/* Multi-select: stage this tool to become its OWN node
                          alongside this one — keeps one-node-one-tool while
                          letting several be picked in one pass. */}
                      {onAddSiblingTools && !selected && (
                        <button
                          type="button"
                          onClick={() =>
                            setStaged(prev => {
                              const next = new Set(prev);
                              if (next.has(t.name)) next.delete(t.name);
                              else next.add(t.name);
                              return next;
                            })
                          }
                          title={isStaged ? 'Remove from the add list' : 'Also add this tool as its own node'}
                          className={cn(
                            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[12px] font-bold leading-none',
                            isStaged
                              ? 'border-[var(--archon-success)]/50 bg-[var(--archon-success)]/10 text-[var(--archon-success)]'
                              : 'border-border text-muted-foreground/70 hover:border-primary/50 hover:text-primary'
                          )}
                        >
                          {isStaged ? '✓' : '+'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {staged.size > 0 && (
                <div className="flex items-center justify-between gap-2 border-t border-border bg-[var(--archon-success)]/5 px-2.5 py-1.5">
                  <span className="text-[10.5px] font-semibold text-foreground">
                    {staged.size} more tool node{staged.size === 1 ? '' : 's'} will be added next to this one
                  </span>
                  <button
                    type="button"
                    className="rounded-md bg-primary px-2.5 py-1 text-[10.5px] font-bold text-primary-foreground hover:opacity-90"
                    onClick={() => {
                      const picked = (tools ?? []).filter(t => staged.has(t.name)).map(t => ({ name: t.name, description: t.description }));
                      onAddSiblingTools?.(picked);
                      setStaged(new Set());
                    }}
                  >
                    Add {staged.size} node{staged.size === 1 ? '' : 's'}
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className="text-[10px] font-semibold text-primary hover:underline"
            onClick={() => setManualEntry(true)}
          >
            Enter a tool name manually instead ›
          </button>
          <p className="text-[10px] leading-snug text-muted-foreground">
            A Tool node runs exactly ONE action (its own description &amp; approval gate) — the radio picks THIS
            node's tool. Want several at once? Tick <b>+</b> on the other tools and each becomes its own node, wired
            to the same parent. For broad access without per-tool settings, a Tool Catalog node does that too.
          </p>
        </div>
      )}

      {isPlatformAction && !manualEntry && (
        <div className="space-y-1.5">
          <Label className="text-[11px] font-bold">
            {cfg?.actionType === 'Apex' ? 'Invocable Apex action' : 'Autolaunched Flow'}
          </Label>
          {actionsState === 'loading' && (
            <div className="flex items-center gap-1.5 py-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading the org's {cfg?.actionType === 'Apex' ? 'invocable Apex actions' : 'flows'}…
            </div>
          )}
          {actionsState === 'error' && (
            <div className="rounded-md border border-border px-3 py-2.5 text-[11px] text-muted-foreground">
              Couldn't load the action catalog.{' '}
              <button
                type="button"
                className="font-semibold text-primary hover:underline"
                onClick={() => {
                  setActions(null);
                  setActionsState('idle');
                  setRefreshSeq(s => s + 1);
                }}
              >
                Retry
              </button>{' '}
              or{' '}
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setManualEntry(true)}>
                enter the name manually
              </button>
              .
            </div>
          )}
          {actionsState === 'ready' && (
            <>
              {typeActions.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-[10.5px] text-muted-foreground">
                  {cfg?.actionType === 'Apex'
                    ? 'No invocable Apex actions found in this org — an Apex class needs an @InvocableMethod to appear here.'
                    : 'No autolaunched Flows found in this org.'}
                </p>
              ) : (
                <Select value={selectedAction?.name ?? ''} onValueChange={handlePickAction}>
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue placeholder={cfg?.actionType === 'Apex' ? 'Select an Apex action…' : 'Select a Flow…'} />
                  </SelectTrigger>
                  <SelectContent>
                    {typeActions.map(a => (
                      <SelectItem key={a.name} value={a.name}>
                        {a.label}
                        {a.label !== a.name ? ` (${a.name})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {selectedAction && selectedDetail === 'loading' && (
                <div className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2.5 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading inputs &amp; outputs…
                </div>
              )}
              {selectedAction && selectedDetail === 'error' && (
                <p className="rounded-md border border-border px-3 py-2.5 text-[10.5px] text-muted-foreground">
                  Couldn't load this action's parameters.
                </p>
              )}
              {selectedAction && selectedDetail && typeof selectedDetail !== 'string' && (
                <div className="space-y-3 rounded-lg border border-border bg-secondary/40 p-3">
                  <ParamList title="Inputs" icon={ArrowDownToLine} params={selectedDetail.inputs} />
                  <ParamList title="Outputs" icon={ArrowUpFromLine} params={selectedDetail.outputs} />
                  <p className="text-[9.5px] leading-snug text-muted-foreground">
                    The AI fills these inputs at call time based on your description and the conversation.
                  </p>
                </div>
              )}
            </>
          )}
          <button
            type="button"
            className="text-[10px] font-semibold text-primary hover:underline"
            onClick={() => setManualEntry(true)}
          >
            Enter a name manually instead ›
          </button>
        </div>
      )}

      {manualEntry && (
        <div className="space-y-1.5">
          <Label className="text-[11px] font-bold">Tool name</Label>
          <Input
            value={cfg?.toolName ?? ''}
            onChange={e => onConfigChange({ toolName: e.target.value })}
            placeholder={cfg?.actionType === 'Apex' ? 'Invocable Apex action name' : cfg?.actionType === 'Flow' ? 'Autolaunched Flow API name' : 'e.g. updateSobjectRecord'}
            className="h-8 font-mono text-xs"
          />
          <button
            type="button"
            className="text-[10px] font-semibold text-primary hover:underline"
            onClick={() => setManualEntry(false)}
          >
            ‹ Back to the picker
          </button>
        </div>
      )}

      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <div>
          <div className="text-[11px] font-bold text-foreground">Requires approval</div>
          <p className="mt-0.5 text-[10.5px] text-muted-foreground">
            Write-type actions pause for human approval before executing.
          </p>
        </div>
        <Switch
          checked={cfg?.requiresApproval ?? false}
          onCheckedChange={v => onConfigChange({ requiresApproval: v })}
        />
      </div>
    </div>
  );
}
