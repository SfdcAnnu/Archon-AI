import { useEffect, useState } from 'react';
import {
  Bolt, ChevronLeft, GitBranch, Plug, ShieldCheck, Sparkles, Square, Trash2, Waypoints, Wrench, X, Zap,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import type { AgentGraph, NodeConfig } from '@/types/agent';
import { SubagentForm } from './properties/SubagentForm';
import { ToolForm } from './properties/ToolForm';
import { CatalogForm } from './properties/CatalogForm';
import { AiRootForm } from './properties/AiRootForm';
import { GuardrailForm } from './properties/GuardrailForm';
import { AutomationForm } from './properties/AutomationForm';
import { ReadOnlySummary } from './properties/ReadOnlySummary';
import { EmptyPanel } from './properties/EmptyPanel';

/** Per-node-type identity for the panel header — kicker text, icon and the
 *  colored chip, matching the canvas cards' own accent language. */
const NODE_META: Record<string, { kicker: string; icon: LucideIcon; chipClass: string; chipStyle?: React.CSSProperties }> = {
  trigger: { kicker: 'Trigger', icon: Bolt, chipClass: 'bg-secondary text-muted-foreground' },
  end: { kicker: 'Response', icon: Square, chipClass: 'bg-secondary text-muted-foreground' },
  ai: { kicker: 'AI Agent · Root', icon: Sparkles, chipClass: 'bg-[color-mix(in_oklab,var(--primary)_14%,transparent)] text-primary' },
  subagent: { kicker: 'Subagent', icon: Waypoints, chipClass: 'bg-[color-mix(in_oklab,var(--primary)_14%,transparent)] text-primary' },
  tool: { kicker: 'Tool', icon: Wrench, chipClass: '', chipStyle: { backgroundColor: 'var(--node-purple-tint)', color: 'var(--node-purple)' } },
  catalog: { kicker: 'Tool Catalog', icon: Plug, chipClass: '', chipStyle: { backgroundColor: 'var(--node-green-tint)', color: 'var(--node-green)' } },
  guardrail: { kicker: 'Guardrails', icon: ShieldCheck, chipClass: '', chipStyle: { backgroundColor: 'var(--node-amber-tint)', color: 'var(--node-amber)' } },
  automation: { kicker: 'Automation', icon: Zap, chipClass: '', chipStyle: { backgroundColor: 'var(--node-green-tint)', color: 'var(--node-green)' } },
  logic: { kicker: 'Logic', icon: GitBranch, chipClass: 'bg-secondary text-muted-foreground' },
};

const RENAMABLE = new Set(['subagent', 'tool', 'guardrail', 'automation']);

export interface PropertiesPanelProps {
  graph: AgentGraph;
  selectedNodeId: string | null;
  onDeselect: () => void;
  onRenameNode: (id: string, name: string) => void;
  onConfigChange: (id: string, patch: Partial<NodeConfig>) => void;
  onProviderChange: (id: string, nodeSubType: string) => void;
  onConnectionBound: (id: string, connectionId: string | null) => void;
  onDeleteNode: (id: string) => void;
  /** ToolForm multi-select: create extra tool nodes next to the given one. */
  onAddSiblingTools?: (sourceNodeId: string, connectorId: string, tools: Array<{ name: string; description: string | null }>) => void;
  /** AutomationReviewView (Trigger-mode) — view only, no rename/delete, and
   *  every node type renders via ReadOnlySummary regardless of its usual
   *  editable form (a Trigger-mode "ai" step node must never hit the
   *  chat-mode-specific AiRootForm, which reads a different config shape). */
  readOnly?: boolean;
}

/** Collapses to a 22px edge tab when nothing needs it — no longer a
 *  permanent column. Selecting a node (or clicking the tab) slides it in as
 *  an overlay over the canvas; must live inside a `relative` ancestor
 *  (AgentBuilder.tsx's canvas row) for the absolute positioning below to
 *  dock to the right canvas edge, not the whole viewport. */
export function PropertiesPanel({
  graph,
  selectedNodeId,
  onDeselect,
  onRenameNode,
  onConfigChange,
  onProviderChange,
  onConnectionBound,
  onDeleteNode,
  onAddSiblingTools,
  readOnly = false,
}: PropertiesPanelProps) {
  const node = graph.nodes.find(n => n.id === selectedNodeId) ?? null;
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (selectedNodeId) setExpanded(true);
  }, [selectedNodeId]);

  const handleDelete = async () => {
    if (!node) return;
    const ok = await confirmDialog({
      title: `Remove "${node.name}" from this agent?`,
      description: 'Its connections are removed too. Unsaved canvas changes stay until you save.',
      confirmLabel: 'Remove node',
      variant: 'destructive',
    });
    if (ok) onDeleteNode(node.id);
  };

  const handleClose = () => {
    onDeselect();
    setExpanded(false);
  };

  const meta = node ? (NODE_META[node.nodeType] ?? { kicker: node.nodeType, icon: Wrench, chipClass: 'bg-secondary text-muted-foreground' }) : null;
  const Icon = meta?.icon ?? Wrench;

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label="Open properties panel"
        title="Properties"
        className={cn(
          'absolute inset-y-0 right-0 z-30 flex w-[22px] items-center justify-center border-l border-border bg-card text-muted-foreground shadow-[-2px_0_8px_rgba(16,18,30,.04)] transition-opacity hover:text-foreground',
          expanded ? 'pointer-events-none opacity-0' : 'opacity-100'
        )}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>

      <aside
        className={cn(
          'absolute inset-y-0 right-0 z-40 flex w-[420px] flex-col rounded-l-2xl border-l border-border bg-card shadow-2xl transition-transform duration-200',
          expanded ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {!node ? (
          <div className="p-4">
            <div className="mb-3.5 flex items-center justify-end">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-md bg-secondary text-muted-foreground hover:text-foreground"
                onClick={() => setExpanded(false)}
                aria-label="Collapse"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <EmptyPanel />
          </div>
        ) : (
          <>
            {/* Identity header — the body below scrolls on its own. */}
            <div className="shrink-0 border-b border-border bg-card px-4 pb-3.5 pt-4">
              <div className="flex items-start gap-3">
                <div
                  className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]', meta!.chipClass)}
                  style={meta!.chipStyle}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    {meta!.kicker}
                  </div>
                  <div className="truncate text-[15px] font-bold leading-snug text-foreground">{node.name}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded-md bg-secondary text-muted-foreground hover:text-foreground"
                    onClick={handleClose}
                    aria-label="Deselect"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {!readOnly && RENAMABLE.has(node.nodeType) && (
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-bold">Node label</Label>
                  <Input
                    value={node.name}
                    onChange={e => onRenameNode(node.id, e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              )}

              {readOnly ? (
                <ReadOnlySummary node={node} />
              ) : (
                <>
                  {node.nodeType === 'subagent' && (
                    <SubagentForm
                      node={node}
                      onConfigChange={patch => onConfigChange(node.id, patch)}
                      onProviderChange={subType => onProviderChange(node.id, subType)}
                    />
                  )}
                  {node.nodeType === 'tool' && (
                    <ToolForm
                      node={node}
                      onConfigChange={patch => onConfigChange(node.id, patch)}
                      onAddSiblingTools={
                        onAddSiblingTools
                          ? tools => onAddSiblingTools(node.id, (node.config as { connectorId?: string }).connectorId ?? '', tools)
                          : undefined
                      }
                    />
                  )}
                  {node.nodeType === 'catalog' && (
                    <CatalogForm node={node} onConfigChange={patch => onConfigChange(node.id, patch)} />
                  )}
                  {node.nodeType === 'guardrail' && (
                    <GuardrailForm node={node} onConfigChange={patch => onConfigChange(node.id, patch)} />
                  )}
                  {node.nodeType === 'automation' && (
                    <AutomationForm node={node} onConfigChange={patch => onConfigChange(node.id, patch)} />
                  )}
                  {node.nodeType === 'ai' && (
                    <AiRootForm
                      node={node}
                      onConfigChange={patch => onConfigChange(node.id, patch)}
                      onProviderChange={nodeSubType => onProviderChange(node.id, nodeSubType)}
                      onConnectionBound={connectionId => onConnectionBound(node.id, connectionId)}
                    />
                  )}
                  {!['subagent', 'tool', 'ai', 'catalog', 'guardrail', 'automation'].includes(node.nodeType) && (
                    <ReadOnlySummary node={node} />
                  )}
                </>
              )}
            </div>

            {/* Footer — per the approved inspector. Edits apply to the
                canvas live; the top bar's Save persists the agent. */}
            {!readOnly && (
              <div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-3">
                <span className="text-[10px] leading-snug text-[var(--archon-faint)]">
                  Changes apply to the canvas — Save in the top bar persists them.
                </span>
                {node.nodeType !== 'ai' && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="ml-auto flex shrink-0 items-center gap-1 text-[11.5px] font-semibold text-destructive hover:underline"
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}
