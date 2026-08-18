import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BaseEdge,
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  EdgeLabelRenderer,
  MiniMap,
  ReactFlow,
  getBezierPath,
  getSmoothStepPath,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  type OnNodeDrag,
  type ReactFlowInstance,
} from '@xyflow/react';
import { HelpCircle, X } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import type { AgentConnection, AgentNode } from '@/types/agent';
import type { DirectoryEntry } from '@/lib/connectors-data';
import { AiRootNode } from './nodes/AiRootNode';
import { SubagentNode } from './nodes/SubagentNode';
import { ToolNode } from './nodes/ToolNode';
import { CatalogNode } from './nodes/CatalogNode';
import { SimpleNode } from './nodes/SimpleNode';
import { CanvasLegend } from './CanvasLegend';

const NODE_TYPES: NodeTypes = {
  aiRoot: AiRootNode,
  subagent: SubagentNode,
  tool: ToolNode,
  catalog: CatalogNode,
  simple: SimpleNode,
};

interface DeletableEdgeData extends Record<string, unknown> {
  pathType: 'bezier' | 'smoothstep';
  onDelete: (id: string) => void;
}

/** A single custom edge type replaces React Flow's built-in 'bezier'/
 *  'smoothstep' strings so every connection can carry a delete button —
 *  the path SHAPE (bezier for tool attachments, smoothstep for
 *  structural flow) now lives in `data.pathType` instead of the edge's
 *  own `type`, since a custom edge component owns rendering entirely. */
function DeletableEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  style, markerEnd, selected, data,
}: EdgeProps<Edge<DeletableEdgeData>>) {
  const pathFn = data?.pathType === 'bezier' ? getBezierPath : getSmoothStepPath;
  const [edgePath, labelX, labelY] = pathFn({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {selected && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <button
              type="button"
              onClick={() => data?.onDelete(id)}
              aria-label="Delete connection"
              title="Delete connection"
              className="flex h-5 w-5 items-center justify-center rounded-full border border-destructive bg-card text-destructive shadow-sm hover:bg-destructive hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const EDGE_TYPES: EdgeTypes = { deletable: DeletableEdge };

function flowTypeFor(node: AgentNode): keyof typeof NODE_TYPES {
  if (node.nodeType === 'ai') return 'aiRoot';
  if (node.nodeType === 'subagent') return 'subagent';
  if (node.nodeType === 'tool') return 'tool';
  if (node.nodeType === 'catalog') return 'catalog';
  return 'simple';
}

function toFlowNodes(agentNodes: AgentNode[], selectedId: string | null): Node[] {
  return agentNodes.map(n => ({
    id: n.id,
    type: flowTypeFor(n),
    position: { x: n.positionX, y: n.positionY },
    data: { agentNode: n },
    selected: n.id === selectedId,
    draggable: true,
  }));
}

/**
 * Edge visual language (matches the approved mockup): SOLID = structural
 * flow (trigger -> agent -> next step); light DASHED = a plain attachment
 * (tool/catalog); bold DASHED = a subagent handoff — a real independent
 * model call, not just a resource attachment, so it reads differently at
 * a glance. Driven off sourceHandle + the TARGET node's real nodeType,
 * not a style flag stored on the connection itself.
 */
function toFlowEdges(
  connections: AgentConnection[],
  agentNodes: AgentNode[],
  selectedEdgeId: string | null,
  onDelete: (id: string) => void
): Edge[] {
  const byId = new Map(agentNodes.map(n => [n.id, n]));
  return connections.map(c => {
    const isToolPort = c.fromPort === 'tool';
    const targetNode = byId.get(c.toNodeId);
    const isSubagentHandoff = isToolPort && targetNode?.nodeType === 'subagent';
    const selected = c.id === selectedEdgeId;

    let stroke = selected ? 'var(--destructive)' : 'var(--muted-foreground)';
    let strokeWidth = selected ? 2.4 : 1.6;
    let strokeDasharray: string | undefined;
    let opacity = 1;

    if (!selected && isSubagentHandoff) {
      stroke = 'rgba(var(--archon-accent-rgb), .8)';
      strokeWidth = 2;
      strokeDasharray = '4.5 3.5';
    } else if (!selected && isToolPort) {
      stroke = 'var(--primary)';
      strokeWidth = 1.3;
      strokeDasharray = '3 4';
      opacity = 0.6;
    } else if (selected && isSubagentHandoff) {
      strokeDasharray = '4.5 3.5';
    } else if (selected && isToolPort) {
      strokeDasharray = '3 4';
    }

    return {
      id: c.id,
      source: c.fromNodeId,
      sourceHandle: c.fromPort,
      target: c.toNodeId,
      targetHandle: c.toPort,
      type: 'deletable',
      selected,
      data: { pathType: isToolPort ? 'bezier' : 'smoothstep', onDelete } satisfies DeletableEdgeData,
      style: { stroke, strokeWidth, strokeDasharray, opacity },
      markerEnd: isToolPort ? undefined : { type: 'arrowclosed' as const, color: stroke, width: 16, height: 16 },
    };
  });
}

/** React Flow's <Background> resolves `color` through an SVG attribute
 *  path that does not reliably read CSS custom properties (var(...)) in
 *  every browser — pass a literal value instead.
 *
 *  Deliberately checks the ACTUAL rendered theme (the .dark class on
 *  <html>), not the OS's prefers-color-scheme — this app doesn't wire up
 *  a dark-mode toggle yet, so it always renders the light palette
 *  regardless of OS setting. Reading prefers-color-scheme directly was a
 *  real bug: on a browser/OS set to dark mode, it picked the light-
 *  colored dot (meant for a dark background) and rendered it against the
 *  actual light background, which is close to invisible. */
function dotColor(): string {
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  return isDark ? 'rgba(147, 163, 255, 0.35)' : 'rgba(56, 84, 224, 0.35)';
}

export interface CanvasProps {
  nodes: AgentNode[];
  connections: AgentConnection[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  onConnect: (fromNodeId: string, fromPort: string, toNodeId: string, toPort: string) => void;
  onDropNode: (nodeType: string, nodeSubType: string, x: number, y: number) => void;
  onDropConnector: (entry: DirectoryEntry, x: number, y: number) => void;
  /** Empty-canvas double-click — opens NodeQuickAdd anchored at the click.
   *  canvasX/Y are container-relative (same space onDropNode/onDropConnector
   *  already use); screenX/Y are viewport-relative, for positioning the
   *  popover itself (which renders outside this component's DOM subtree). */
  onCanvasDoubleClick?: (canvasX: number, canvasY: number, screenX: number, screenY: number) => void;
  /** Click a wire, then the trash button (or Backspace/Delete) removes it. */
  onDeleteConnection?: (id: string) => void;
  /** Trigger-mode review view (see AutomationReviewView.tsx) — the canvas
   *  is a read surface only there, edited via the Copilot instead of direct
   *  manipulation. Disables drag/connect/quick-add/wire-delete; node
   *  selection (to view read-only details in the properties panel) still
   *  works. */
  readOnly?: boolean;
}

export function Canvas({
  nodes,
  connections,
  selectedNodeId,
  onSelectNode,
  onMoveNode,
  onConnect,
  onDropNode,
  onDropConnector,
  onCanvasDoubleClick,
  onDeleteConnection,
  readOnly = false,
}: CanvasProps) {
  // React Flow owns node/edge state internally (useNodesState/useEdgesState)
  // so dragging is smooth — handled entirely inside the library with no
  // round-trip through this app's own state on every mouse-move tick. The
  // external `nodes`/`connections` props are the source of truth for
  // anything that happens OUTSIDE direct canvas interaction (a palette
  // drop, a property-panel edit, the initial data load) and get synced in
  // via the effects below; a drag's OWN in-progress motion never goes
  // through them until it actually ends (onNodeDragStop).
  const [flowNodes, setFlowNodes, onNodesChangeInternal] = useNodesState<Node>([]);
  const [flowEdges, setFlowEdges, onEdgesChangeInternal] = useEdgesState<Edge>([]);
  const [legendOpen, setLegendOpen] = useState(false);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);

  const handleInit = useCallback((instance: ReactFlowInstance) => {
    rfInstanceRef.current = instance;
  }, []);

  const handleDeleteConnection = useCallback(
    (id: string) => {
      onDeleteConnection?.(id);
      setSelectedEdgeId(current => (current === id ? null : current));
    },
    [onDeleteConnection]
  );

  useEffect(() => {
    setFlowNodes(toFlowNodes(nodes, selectedNodeId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, selectedNodeId]);

  useEffect(() => {
    setFlowEdges(toFlowEdges(connections, nodes, selectedEdgeId, handleDeleteConnection));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections, nodes, selectedEdgeId, handleDeleteConnection]);

  // Backspace/Delete removes the selected wire — matches how node
  // deletion already feels. Skipped while a text input/textarea has
  // focus (properties panel fields, the quick-add search box, etc.) so
  // normal editing/backspacing text is never intercepted.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (readOnly || !selectedEdgeId || (e.key !== 'Backspace' && e.key !== 'Delete')) return;
      const active = document.activeElement;
      const tag = active?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (active as HTMLElement | null)?.isContentEditable) return;
      e.preventDefault();
      handleDeleteConnection(selectedEdgeId);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedEdgeId, handleDeleteConnection, readOnly]);

  // The declarative `fitView` prop only ever fires once, on Canvas's very
  // first mount — which happens with AgentBuilder's MOCK_AGENT_GRAPH
  // placeholder, before loadAgentGraph's real data arrives. Without this,
  // the viewport stays fitted to the MOCK graph's node coordinates forever;
  // once the real graph replaces it, its nodes can land anywhere relative
  // to that stale viewport, including clipped above the canvas's own
  // overflow:hidden boundary. Re-fit explicitly whenever the real node set
  // changes, one frame after the DOM commit so layout has settled first.
  // maxZoom 1: fitView on a SMALL graph (e.g. a freshly-generated 3-node
  // agent) otherwise zooms IN until the cluster fills the viewport — up to
  // the canvas's 1.8x ceiling, which reads as comically magnified. Fitting
  // may zoom out as far as needed for big graphs, but never past 100% in.
  useEffect(() => {
    if (!rfInstanceRef.current || nodes.length === 0) return;
    const raf = requestAnimationFrame(() => {
      rfInstanceRef.current?.fitView({ padding: 0.25, maxZoom: 1 });
    });
    return () => cancelAnimationFrame(raf);
  }, [nodes]);

  const backgroundColor = useMemo(() => dotColor(), []);

  const handleNodeDragStop = useCallback<OnNodeDrag>(
    (_, node) => {
      onMoveNode(node.id, node.position.x, node.position.y);
    },
    [onMoveNode]
  );

  const handleConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || !conn.sourceHandle || !conn.targetHandle) return;
      onConnect(conn.source, conn.sourceHandle, conn.target, conn.targetHandle);
    },
    [onConnect]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (readOnly) return;
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return;
      const payload = JSON.parse(raw) as
        | { kind: 'node'; nodeType: string; nodeSubType: string }
        | { kind: 'connector'; entry: DirectoryEntry };
      const bounds = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - bounds.left;
      const y = e.clientY - bounds.top;
      if (payload.kind === 'connector') {
        onDropConnector(payload.entry, x, y);
      } else {
        onDropNode(payload.nodeType, payload.nodeSubType, x, y);
      }
    },
    [onDropNode, onDropConnector, readOnly]
  );

  return (
    <div
      className="relative h-full w-full bg-background"
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
      onDoubleClick={e => {
        if (readOnly || !onCanvasDoubleClick || (e.target as HTMLElement).closest('.react-flow__node')) return;
        const bounds = e.currentTarget.getBoundingClientRect();
        onCanvasDoubleClick(e.clientX - bounds.left, e.clientY - bounds.top, e.clientX, e.clientY);
      }}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        onNodesChange={onNodesChangeInternal}
        onEdgesChange={onEdgesChangeInternal}
        onNodeDragStop={handleNodeDragStop}
        onConnect={handleConnect}
        onNodeClick={(_, node) => {
          setSelectedEdgeId(null);
          onSelectNode(node.id);
        }}
        onEdgeClick={(_, edge) => {
          onSelectNode(null);
          if (!readOnly) setSelectedEdgeId(edge.id);
        }}
        onPaneClick={() => {
          onSelectNode(null);
          setSelectedEdgeId(null);
        }}
        onInit={handleInit}
        zoomOnDoubleClick={false}
        minZoom={0.3}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={2} color={backgroundColor} />
        <MiniMap
          pannable
          zoomable
          maskColor="rgba(0,0,0,0.06)"
          className="!h-[70px] !w-[110px] !border !border-border/60 !bg-card/55 !backdrop-blur-[2px]"
          style={{ borderRadius: 8 }}
        />
        <Controls showInteractive={false} position="top-right">
          <ControlButton onClick={() => setLegendOpen(v => !v)} title="Legend">
            <HelpCircle />
          </ControlButton>
        </Controls>
      </ReactFlow>
      {legendOpen && <CanvasLegend onClose={() => setLegendOpen(false)} />}
    </div>
  );
}
