import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { BookOpen, Check, ListChecks, Loader2, Play, Plus, Save, Share2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { AppShell } from '@/components/shell/AppShell';
import { NodeQuickAdd } from '@/components/agent-builder/NodeQuickAdd';
import { AgentInfoPopover } from '@/components/agent-builder/AgentInfoPopover';
import { Canvas } from '@/components/agent-builder/Canvas';
import { PropertiesPanel } from '@/components/agent-builder/PropertiesPanel';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { KnowledgeBaseModal } from '@/components/agent-builder/KnowledgeBaseModal';
import { SetupChecklistPanel } from '@/components/agent-builder/SetupChecklistPanel';
import { CopilotPanel } from '@/components/agent-builder/CopilotPanel';
import AutomationReviewView from './AutomationReviewView';
import { MOCK_AGENT_GRAPH } from '@/data/mock-agent';
import { NODE_PALETTE, type PaletteItem } from '@/data/node-catalog';
import { loadAgentGraph, saveAgentGraph } from '@/lib/salesforce-data';
import { applyCopilotOperations } from '@/lib/copilot-apply';
import type { CopilotOperation } from '@/lib/copilot-data';
import type { DirectoryEntry } from '@/lib/connectors-data';
import type { AgentGraph, NodeConfig } from '@/types/agent';

interface QuickAddState {
  canvasX: number;
  canvasY: number;
  screenX: number;
  screenY: number;
}

let nodeSeq = 0;

export default function AgentBuilder() {
  const { apiName } = useParams<{ apiName: string }>();
  const navigate = useNavigate();
  const [graph, setGraph] = useState<AgentGraph>(MOCK_AGENT_GRAPH);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<'loading' | 'live' | 'mock'>('loading');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [chatOpen, setChatOpen] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const addRailBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!apiName) return;
    let cancelled = false;
    setDataSource('loading');
    loadAgentGraph(apiName)
      .then(real => {
        if (cancelled) return;
        setGraph(real);
        setDataSource('live');
      })
      .catch(err => {
        // Expected in local `npm run dev` — the platform SDK has no real
        // Salesforce surface to talk to outside a deployed UI Bundle.
        // Falls back to mock data rather than leaving the canvas blank.
        if (cancelled) return;
        console.warn('Falling back to mock agent data:', err);
        setDataSource('mock');
      });
    return () => {
      cancelled = true;
    };
  }, [apiName]);

  const handleSave = useCallback(() => {
    setSaveState('saving');
    saveAgentGraph(graph)
      .then(() => {
        setSaveState('idle');
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2500);
      })
      .catch(err => {
        console.error('Save failed:', err);
        setSaveState('error');
      });
  }, [graph]);

  const handleMoveNode = useCallback((id: string, x: number, y: number) => {
    setGraph(g => ({
      ...g,
      nodes: g.nodes.map(n => (n.id === id ? { ...n, positionX: x, positionY: y } : n)),
    }));
  }, []);

  const handleConnect = useCallback(
    (fromNodeId: string, fromPort: string, toNodeId: string, toPort: string) => {
      setGraph(g => {
        const exists = g.connections.some(
          c => c.fromNodeId === fromNodeId && c.fromPort === fromPort && c.toNodeId === toNodeId
        );
        if (exists) return g;
        return {
          ...g,
          connections: [
            ...g.connections,
            {
              id: `conn_${Date.now()}`,
              fromNodeId,
              fromPort: fromPort as AgentGraph['connections'][number]['fromPort'],
              toNodeId,
              toPort: toPort as AgentGraph['connections'][number]['toPort'],
            },
          ],
        };
      });
    },
    []
  );

  const handleDropNode = useCallback((nodeType: string, nodeSubType: string, x: number, y: number) => {
    const paletteItem = NODE_PALETTE.flatMap(c => c.items).find(
      i => i.nodeType === nodeType && i.nodeSubType === nodeSubType
    );
    if (!paletteItem) return;
    nodeSeq += 1;
    const id = `new_${nodeSeq}`;
    setGraph(g => ({
      ...g,
      nodes: [
        ...g.nodes,
        {
          id,
          name: paletteItem.label,
          nodeType: paletteItem.nodeType,
          nodeSubType: paletteItem.nodeSubType,
          config: { ...paletteItem.defaultConfig },
          positionX: Math.max(10, Math.round(x - 90)),
          positionY: Math.max(10, Math.round(y - 30)),
          sortOrder: g.nodes.length,
          isEnabled: true,
        },
      ],
    }));
    setSelectedNodeId(id);
  }, []);

  const handleDropConnector = useCallback((entry: DirectoryEntry, x: number, y: number) => {
    nodeSeq += 1;
    const id = `new_${nodeSeq}`;
    setGraph(g => ({
      ...g,
      nodes: [
        ...g.nodes,
        {
          id,
          name: entry.displayName,
          nodeType: 'catalog',
          nodeSubType: entry.mapsToCatalogType || entry.providerKey,
          config: {
            description: entry.description ?? '',
            connectorId: entry.connectorId ?? '',
            provider: entry.providerKey,
            allowedTools: [],
          },
          positionX: Math.max(10, Math.round(x - 100)),
          positionY: Math.max(10, Math.round(y - 40)),
          sortOrder: g.nodes.length,
          isEnabled: true,
        },
      ],
    }));
    setSelectedNodeId(id);
  }, []);

  const handleCanvasDoubleClick = useCallback(
    (canvasX: number, canvasY: number, screenX: number, screenY: number) => {
      setQuickAdd({ canvasX, canvasY, screenX, screenY });
    },
    []
  );

  const openQuickAddFromRail = useCallback(() => {
    const rect = addRailBtnRef.current?.getBoundingClientRect();
    setQuickAdd({
      canvasX: 320,
      canvasY: 220,
      screenX: rect ? rect.right + 8 : 80,
      screenY: rect ? rect.top : 100,
    });
  }, []);

  const openQuickAddFromPill = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setQuickAdd({ canvasX: 320, canvasY: 220, screenX: rect.left, screenY: rect.top - 8 });
  }, []);

  // Inserts from the palette item itself (NOT a NODE_PALETTE re-lookup like
  // handleDropNode does) — the Tools chip offers several presets sharing the
  // same nodeType/nodeSubType that differ only in defaultConfig (Apex vs
  // Flow vs blank), and a lookup would collapse them all into one.
  const handleQuickAddNode = useCallback(
    (item: PaletteItem) => {
      if (!quickAdd) return;
      nodeSeq += 1;
      const id = `new_${nodeSeq}`;
      setGraph(g => ({
        ...g,
        nodes: [
          ...g.nodes,
          {
            id,
            name: item.label,
            nodeType: item.nodeType,
            nodeSubType: item.nodeSubType,
            config: { ...item.defaultConfig },
            positionX: Math.max(10, Math.round(quickAdd.canvasX - 90)),
            positionY: Math.max(10, Math.round(quickAdd.canvasY - 30)),
            sortOrder: g.nodes.length,
            isEnabled: true,
          },
        ],
      }));
      setSelectedNodeId(id);
    },
    [quickAdd]
  );

  const handleQuickAddConnector = useCallback(
    (entry: DirectoryEntry) => {
      if (!quickAdd) return;
      handleDropConnector(entry, quickAdd.canvasX, quickAdd.canvasY);
    },
    [quickAdd, handleDropConnector]
  );

  // MCP section's per-tool insertion: a ready-configured Tool node, wired
  // straight to its owner via fromPort 'tool' — the exact port
  // subagent-router.ts matches on at chat runtime; anything else would look
  // connected but be uncallable. Owner = the selected ai/subagent node when
  // one is selected, else the top-level ai node.
  const handleQuickAddMcpTool = useCallback(
    (entry: DirectoryEntry, tool: { name: string; description: string | null }) => {
      if (!quickAdd) return;
      nodeSeq += 1;
      const id = `new_${nodeSeq}`;
      setGraph(g => {
        const selected = g.nodes.find(n => n.id === selectedNodeId);
        const owner =
          selected && (selected.nodeType === 'ai' || selected.nodeType === 'subagent')
            ? selected
            : g.nodes.find(n => n.nodeType === 'ai');
        return {
          ...g,
          nodes: [
            ...g.nodes,
            {
              id,
              name: tool.name,
              nodeType: 'tool',
              nodeSubType: 'tool',
              config: {
                description: tool.description ?? '',
                actionType: 'MCP',
                toolName: tool.name,
                connectorId: entry.providerKey,
                requiresApproval: false,
              },
              positionX: Math.max(10, Math.round(quickAdd.canvasX - 90)),
              positionY: Math.max(10, Math.round(quickAdd.canvasY - 30)),
              sortOrder: g.nodes.length,
              isEnabled: true,
            },
          ],
          connections: owner
            ? [
                ...g.connections,
                { id: `conn_${Date.now()}`, fromNodeId: owner.id, fromPort: 'tool' as const, toNodeId: id, toPort: 'in' as const },
              ]
            : g.connections,
        };
      });
      setSelectedNodeId(id);
    },
    [quickAdd, selectedNodeId]
  );

  const handleRenameNode = useCallback((id: string, name: string) => {
    setGraph(g => ({ ...g, nodes: g.nodes.map(n => (n.id === id ? { ...n, name } : n)) }));
  }, []);

  // ToolForm's multi-select: the user ticked extra tools in one tool node's
  // live list — spawn one ready-wired sibling Tool node per tool, attached
  // to the SAME parent (found via the node's incoming edge; root ai as the
  // fallback), stacked below the source node. Same fromPort:'tool' rule as
  // every other tool insertion — anything else is invisible at runtime.
  const handleAddSiblingTools = useCallback(
    (sourceNodeId: string, connectorId: string, picked: Array<{ name: string; description: string | null }>) => {
      if (picked.length === 0) return;
      setGraph(g => {
        const source = g.nodes.find(n => n.id === sourceNodeId);
        if (!source) return g;
        const incoming = g.connections.find(c => c.toNodeId === sourceNodeId);
        const ownerId = incoming?.fromNodeId ?? g.nodes.find(n => n.nodeType === 'ai')?.id;
        const newNodes = picked.map((t, i) => {
          nodeSeq += 1;
          return {
            id: `new_${nodeSeq}`,
            name: t.name,
            nodeType: 'tool' as const,
            nodeSubType: 'tool',
            config: {
              description: t.description ?? '',
              actionType: 'MCP' as const,
              toolName: t.name,
              connectorId,
              requiresApproval: false,
            },
            positionX: source.positionX + 40 * (i + 1),
            positionY: source.positionY + 80 * (i + 1),
            sortOrder: g.nodes.length + i,
            isEnabled: true,
          };
        });
        return {
          ...g,
          nodes: [...g.nodes, ...newNodes],
          connections: ownerId
            ? [
                ...g.connections,
                ...newNodes.map((n, i) => ({
                  id: `conn_${Date.now()}_${i}`,
                  fromNodeId: ownerId,
                  fromPort: 'tool' as const,
                  toNodeId: n.id,
                  toPort: 'in' as const,
                })),
              ]
            : g.connections,
        };
      });
    },
    []
  );

  // The 'ai' root node is the one thing every other node attaches to —
  // deleting it would orphan the whole graph, so it's the one node type
  // this doesn't allow (enforced again in PropertiesPanel, which hides the
  // button entirely for it; this is the belt to that suspenders).
  const handleDeleteNode = useCallback(
    (id: string) => {
      setGraph(g => {
        const target = g.nodes.find(n => n.id === id);
        if (!target || target.nodeType === 'ai') return g;
        return {
          ...g,
          nodes: g.nodes.filter(n => n.id !== id),
          connections: g.connections.filter(c => c.fromNodeId !== id && c.toNodeId !== id),
        };
      });
      setSelectedNodeId(current => (current === id ? null : current));
    },
    []
  );

  // Same "real state, not React Flow's own mirror" reasoning as
  // handleDeleteNode above — Canvas re-syncs its internal edges from
  // `graph.connections` on every render, so a deletion has to land here.
  const handleDeleteConnection = useCallback((id: string) => {
    setGraph(g => ({ ...g, connections: g.connections.filter(c => c.id !== id) }));
  }, []);

  // Same real-state-mutation contract as every other handler here — the
  // Copilot (CopilotPanel.tsx) only ever calls this on an explicit Apply
  // click; applyCopilotOperations itself is a pure function with no access
  // to setGraph, so there is no path from "proposed" to "real" that skips
  // this one call site.
  const handleApplyCopilotOperations = useCallback((ops: CopilotOperation[]) => {
    setGraph(g => applyCopilotOperations(g, ops));
  }, []);

  const handleConfigChange = useCallback((id: string, patch: Partial<NodeConfig>) => {
    setGraph(g => ({
      ...g,
      nodes: g.nodes.map(n => (n.id === id ? { ...n, config: { ...n.config, ...patch } } : n)),
    }));
  }, []);

  const handleKnowledgeBaseChange = useCallback((value: string) => {
    setGraph(g => ({ ...g, agent: { ...g.agent, knowledgeBase: value } }));
  }, []);

  const handleProviderChange = useCallback((id: string, nodeSubType: string) => {
    setGraph(g => ({ ...g, nodes: g.nodes.map(n => (n.id === id ? { ...n, nodeSubType } : n)) }));
  }, []);

  // The picker itself already called bindEngineConnectionToNode() against
  // Salesforce (immediate write, since AiEngineConnection__c binding isn't
  // part of the batched agent Save) — this just syncs local state so the
  // canvas reflects it without a full reload.
  const handleConnectionBound = useCallback((id: string, connectionId: string | null) => {
    setGraph(g => ({
      ...g,
      nodes: g.nodes.map(n => (n.id === id ? { ...n, aiEngineConnectionId: connectionId } : n)),
    }));
  }, []);

  const isActiveStatus = graph.agent.status === 'Active';
  const toggleActive = useCallback(() => {
    setGraph(g => ({ ...g, agent: { ...g.agent, status: isActiveStatus ? 'Inactive' : 'Active' } }));
  }, [isActiveStatus]);

  // Trigger-mode agents use a different node vocabulary the drag-and-drop
  // canvas was never built to author (see AutomationReviewView.tsx's doc
  // comment) — reviewed read-only there instead, edited via the Copilot.
  const isAutomationMode = graph.agent.executeType === 'Trigger';

  return (
    <AppShell
      defaultCollapsed
      railExtra={
        isAutomationMode ? undefined : (
          <button
            ref={addRailBtnRef}
            type="button"
            onClick={openQuickAddFromRail}
            title="Add node"
            aria-label="Add node"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--sidebar-accent)] text-[var(--sidebar-primary)] hover:bg-[var(--sidebar-accent)]/70"
          >
            <Plus className="h-4 w-4" />
          </button>
        )
      }
    >
      {isAutomationMode ? (
        <AutomationReviewView
          graph={graph}
          saveState={saveState}
          justSaved={justSaved}
          onSave={handleSave}
          onApplyCopilotOperations={handleApplyCopilotOperations}
        />
      ) : (
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
            <AgentInfoPopover graph={graph} />
            {dataSource === 'loading' && (
              <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </span>
            )}
            {dataSource === 'mock' && (
              <span className="shrink-0 rounded-full bg-[var(--archon-warning-tint)] px-2 py-0.5 text-[10px] font-bold text-[var(--archon-warning)]">
                Mock data
              </span>
            )}
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
              <button
                type="button"
                onClick={handleSave}
                className="text-[11px] font-semibold text-destructive hover:underline"
              >
                Save failed — retry
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSave}
                disabled={dataSource === 'loading'}
                title="Save"
                aria-label="Save"
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <Save className="h-3.5 w-3.5" />
              </button>
            )}
            <Switch checked={isActiveStatus} onCheckedChange={toggleActive} />
            <div className="h-5 w-px bg-border" />
            <button
              type="button"
              title="Share"
              aria-label="Share"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Share2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Knowledge"
              aria-label="Knowledge"
              onClick={() => setKbOpen(v => !v)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <BookOpen className="h-3.5 w-3.5" />
            </button>
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
            <Button size="sm" className="h-8 text-xs" onClick={() => setChatOpen(v => !v)}>
              <Play className="mr-1.5 h-3 w-3 fill-current" /> Test Agent
            </Button>
          </div>
        </header>
        <div className="relative flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            <Canvas
              nodes={graph.nodes}
              connections={graph.connections}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              onMoveNode={handleMoveNode}
              onConnect={handleConnect}
              onDropNode={handleDropNode}
              onDropConnector={handleDropConnector}
              onCanvasDoubleClick={handleCanvasDoubleClick}
              onDeleteConnection={handleDeleteConnection}
            />
            <button
              type="button"
              onClick={openQuickAddFromPill}
              className="absolute bottom-4 left-4 z-20 flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-foreground shadow-[0_1px_2px_rgba(16,18,30,.08),0_6px_16px_rgba(16,18,30,.08)] hover:bg-secondary"
            >
              <Plus className="h-3 w-3 text-primary" /> Add node
              <span className="font-normal text-muted-foreground">· double-click canvas</span>
            </button>
          </div>
          <PropertiesPanel
            graph={graph}
            selectedNodeId={selectedNodeId}
            onDeselect={() => setSelectedNodeId(null)}
            onRenameNode={handleRenameNode}
            onConfigChange={handleConfigChange}
            onProviderChange={handleProviderChange}
            onConnectionBound={handleConnectionBound}
            onDeleteNode={handleDeleteNode}
            onAddSiblingTools={handleAddSiblingTools}
          />
          {quickAdd && (
            <NodeQuickAdd
              anchor={{ x: quickAdd.screenX, y: quickAdd.screenY }}
              onClose={() => setQuickAdd(null)}
              onAddNode={handleQuickAddNode}
              onAddConnector={handleQuickAddConnector}
              onAddMcpTool={handleQuickAddMcpTool}
            />
          )}
        </div>
        {chatOpen && (
          <ChatPanel
            agentApiName={graph.agent.apiName}
            agentName={graph.agent.name}
            onClose={() => setChatOpen(false)}
          />
        )}
        {kbOpen && (
          <KnowledgeBaseModal
            agentApiName={graph.agent.apiName}
            notesValue={graph.agent.knowledgeBase}
            onNotesChange={handleKnowledgeBaseChange}
            onClose={() => setKbOpen(false)}
          />
        )}
        {checklistOpen && (
          <SetupChecklistPanel items={graph.agent.setupChecklist} onClose={() => setChecklistOpen(false)} />
        )}
        {copilotOpen && (
          <CopilotPanel
            graph={graph}
            mode="chat"
            onApply={handleApplyCopilotOperations}
            onClose={() => setCopilotOpen(false)}
          />
        )}
      </div>
      )}
    </AppShell>
  );
}
