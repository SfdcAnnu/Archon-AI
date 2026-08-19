import { useEffect, useState } from 'react';
import { ChevronLeft, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { AgentGraph, NodeConfig } from '@/types/agent';
import { SubagentForm } from './properties/SubagentForm';
import { ToolForm } from './properties/ToolForm';
import { CatalogForm } from './properties/CatalogForm';
import { AiRootForm } from './properties/AiRootForm';
import { ReadOnlySummary } from './properties/ReadOnlySummary';
import { EmptyPanel } from './properties/EmptyPanel';

const KICKER: Record<string, string> = {
  trigger: 'Trigger',
  end: 'Response',
  ai: 'AI Agent · Root',
  subagent: 'Subagent',
  tool: 'Tool',
  catalog: 'Tool Catalog',
};

export interface PropertiesPanelProps {
  graph: AgentGraph;
  selectedNodeId: string | null;
  onDeselect: () => void;
  onRenameNode: (id: string, name: string) => void;
  onConfigChange: (id: string, patch: Partial<NodeConfig>) => void;
  onProviderChange: (id: string, nodeSubType: string) => void;
  onConnectionBound: (id: string, connectionId: string | null) => void;
  onDeleteNode: (id: string) => void;
  /** AutomationReviewView (Trigger-mode) — view only, no rename/delete, and
   *  every node type renders via ReadOnlySummary regardless of its usual
   *  editable form (a Trigger-mode "ai" step node must never hit the
   *  chat-mode-specific AiRootForm, which reads a different config shape). */
  readOnly?: boolean;
}

/** Collapses to a 22px edge tab when nothing needs it — no longer a
 *  permanent 280px column. Selecting a node (or clicking the tab) slides
 *  it in as an overlay over the canvas; must live inside a `relative`
 *  ancestor (AgentBuilder.tsx's canvas row) for the absolute positioning
 *  below to dock to the right canvas edge, not the whole viewport. */
export function PropertiesPanel({
  graph,
  selectedNodeId,
  onDeselect,
  onRenameNode,
  onConfigChange,
  onProviderChange,
  onConnectionBound,
  onDeleteNode,
  readOnly = false,
}: PropertiesPanelProps) {
  const node = graph.nodes.find(n => n.id === selectedNodeId) ?? null;
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (selectedNodeId) setExpanded(true);
  }, [selectedNodeId]);

  const handleDelete = () => {
    if (!node) return;
    if (!window.confirm(`Remove "${node.name}" from this agent?`)) return;
    onDeleteNode(node.id);
  };

  const handleClose = () => {
    onDeselect();
    setExpanded(false);
  };

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
          'absolute inset-y-0 right-0 z-40 w-[280px] overflow-y-auto border-l border-border bg-card p-4 shadow-2xl transition-transform duration-200',
          expanded ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {!node ? (
          <>
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
          </>
        ) : (
          <>
            <div className="mb-3.5 flex items-start justify-between gap-2">
              <div>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-primary">
                  {KICKER[node.nodeType] ?? node.nodeType}
                </div>
                <div className="text-[15px] font-bold leading-tight text-foreground">{node.name}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {!readOnly && node.nodeType !== 'ai' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded-md bg-secondary text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={handleDelete}
                    aria-label="Delete node"
                    title="Delete node"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
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

            {!readOnly && (node.nodeType === 'subagent' || node.nodeType === 'tool') && (
              <div className="mb-4 space-y-1.5">
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
                  <SubagentForm node={node} onConfigChange={patch => onConfigChange(node.id, patch)} />
                )}
                {node.nodeType === 'tool' && (
                  <ToolForm node={node} onConfigChange={patch => onConfigChange(node.id, patch)} />
                )}
                {node.nodeType === 'catalog' && (
                  <CatalogForm node={node} onConfigChange={patch => onConfigChange(node.id, patch)} />
                )}
                {node.nodeType === 'ai' && (
                  <AiRootForm
                    node={node}
                    onConfigChange={patch => onConfigChange(node.id, patch)}
                    onProviderChange={nodeSubType => onProviderChange(node.id, nodeSubType)}
                    onConnectionBound={connectionId => onConnectionBound(node.id, connectionId)}
                  />
                )}
                {node.nodeType !== 'subagent' && node.nodeType !== 'tool' && node.nodeType !== 'ai' && node.nodeType !== 'catalog' && (
                  <ReadOnlySummary node={node} />
                )}
              </>
            )}
          </>
        )}
      </aside>
    </>
  );
}
