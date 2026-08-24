import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Check, ListChecks, Loader2, Save, Sparkles } from 'lucide-react';
import { Canvas } from '@/components/agent-builder/Canvas';
import { PropertiesPanel } from '@/components/agent-builder/PropertiesPanel';
import { AgentInfoPopover } from '@/components/agent-builder/AgentInfoPopover';
import { SetupChecklistPanel } from '@/components/agent-builder/SetupChecklistPanel';
import { CopilotPanel } from '@/components/agent-builder/CopilotPanel';
import type { CopilotOperation } from '@/lib/copilot-data';
import type { AgentGraph } from '@/types/agent';

export interface AutomationReviewViewProps {
  graph: AgentGraph;
  saveState: 'idle' | 'saving' | 'error';
  justSaved: boolean;
  onSave: () => void;
  onApplyCopilotOperations: (ops: CopilotOperation[]) => void;
}

/**
 * Trigger-mode agents (AgentDefinition__c.ExecuteType__c = 'Trigger') use a
 * different node vocabulary (trigger/ai-step/logic/action/catalog — see
 * server/src/agent-generator/spec.ts's NODE_SPEC) than the chat-mode canvas
 * was built to author (ai/subagent/tool/catalog). Rather than build a
 * second full drag-and-drop authoring surface for it, this renders the same
 * Canvas/PropertiesPanel components in read-only mode — nodes and wiring
 * are real (loaded the same way AgentBuilder.tsx loads a chat agent), just
 * not directly editable. The intended edit path is the Copilot (natural-
 * language request -> preview -> apply), not manual manipulation.
 */
export default function AutomationReviewView({
  graph,
  saveState,
  justSaved,
  onSave,
  onApplyCopilotOperations,
}: AutomationReviewViewProps) {
  const navigate = useNavigate();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const isActiveStatus = graph.agent.status === 'Active';

  return (
    <div className="relative flex h-full w-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-baseline gap-1.5 truncate">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:underline"
            >
              Agents /
            </button>
            <span className="truncate text-[14px] font-bold text-foreground">{graph.agent.name}</span>
          </div>
          <span className="shrink-0 rounded-full bg-[var(--node-blue-tint)] px-2.5 py-0.5 text-[10.5px] font-semibold text-[var(--node-blue)]">
            {graph.agent.department}
          </span>
          <span
            className="shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
            style={{
              backgroundColor: isActiveStatus ? 'var(--archon-success-tint)' : 'var(--node-gray-tint)',
              color: isActiveStatus ? 'var(--archon-success)' : 'var(--node-gray)',
            }}
          >
            {graph.agent.status}
          </span>
          <span className="shrink-0 rounded-full bg-secondary px-2.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
            Automation · Review only
          </span>
          <AgentInfoPopover graph={graph} />
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {saveState === 'saving' ? (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </span>
          ) : justSaved ? (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--archon-success)]">
              <Check className="h-3 w-3" /> Saved
            </span>
          ) : saveState === 'error' ? (
            <button type="button" onClick={onSave} className="text-[11px] font-semibold text-destructive hover:underline">
              Save failed — retry
            </button>
          ) : (
            <button
              type="button"
              onClick={onSave}
              title="Save"
              aria-label="Save"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Save className="h-3.5 w-3.5" />
            </button>
          )}
          {graph.agent.setupChecklist.length > 0 && (
            <button
              type="button"
              title="Setup checklist"
              aria-label="Setup checklist"
              onClick={() => setChecklistOpen(v => !v)}
              className="relative flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <ListChecks className="h-3.5 w-3.5" />
              <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--archon-warning,#b45309)] px-0.5 text-[8.5px] font-bold text-white">
                {graph.agent.setupChecklist.length}
              </span>
            </button>
          )}
          <button
            type="button"
            title="Copilot"
            aria-label="Copilot"
            onClick={() => setCopilotOpen(v => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Sparkles className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <Canvas
            nodes={graph.nodes}
            connections={graph.connections}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onMoveNode={() => {}}
            onConnect={() => {}}
            onDropNode={() => {}}
            onDropConnector={() => {}}
            readOnly
          />
        </div>
        <PropertiesPanel
          graph={graph}
          selectedNodeId={selectedNodeId}
          onDeselect={() => setSelectedNodeId(null)}
          onRenameNode={() => {}}
          onConfigChange={() => {}}
          onProviderChange={() => {}}
          onConnectionBound={() => {}}
          onDeleteNode={() => {}}
          readOnly
        />
      </div>
      {checklistOpen && (
        <SetupChecklistPanel items={graph.agent.setupChecklist} onClose={() => setChecklistOpen(false)} />
      )}
      {copilotOpen && (
        <CopilotPanel
          graph={graph}
          mode="trigger"
          onApply={onApplyCopilotOperations}
          onClose={() => setCopilotOpen(false)}
        />
      )}
    </div>
  );
}
