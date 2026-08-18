import type { AgentGraph, AgentNode, NodeConfig, NodeType, PortName } from '@/types/agent';
import type { CopilotOperation } from './copilot-data';

/** Roots no copilot delete_node call is ever allowed to remove — mirrors
 *  AgentBuilder.tsx's handleDeleteNode guard (chat mode's 'ai' node) plus
 *  the trigger-mode equivalent, since the copilot now edits both. */
const PROTECTED_ROOT_TYPES = new Set(['ai', 'trigger']);

function nodeLabel(graph: AgentGraph, id: string, addedLabels: Map<string, string>): string {
  return addedLabels.get(id) ?? graph.nodes.find(n => n.id === id)?.name ?? id;
}

/** Human-readable one-liner per proposed operation, for the preview list
 *  shown before Apply — resolves real node names where possible so the
 *  user reviews "Add tool 'Look up order'" rather than raw tool-call JSON. */
export function summarizeCopilotOperations(ops: CopilotOperation[], graph: AgentGraph): string[] {
  const addedLabels = new Map<string, string>();
  const lines: string[] = [];

  for (const op of ops) {
    const input = op.input;
    switch (op.tool) {
      case 'add_node': {
        const label = String(input.label ?? 'Untitled node');
        if (typeof input.localId === 'string') addedLabels.set(input.localId, label);
        const type = String(input.nodeType ?? '');
        lines.push(`Add ${type ? `${type} node` : 'node'} "${label}"`);
        break;
      }
      case 'delete_node':
        lines.push(`Delete "${nodeLabel(graph, String(input.nodeId ?? ''), addedLabels)}"`);
        break;
      case 'update_node_config':
        lines.push(`Update config on "${nodeLabel(graph, String(input.nodeId ?? ''), addedLabels)}"`);
        break;
      case 'rename_node':
        lines.push(`Rename "${nodeLabel(graph, String(input.nodeId ?? ''), addedLabels)}" to "${String(input.name ?? '')}"`);
        break;
      case 'add_connection':
        lines.push(
          `Connect "${nodeLabel(graph, String(input.fromNodeId ?? ''), addedLabels)}" -> "${nodeLabel(graph, String(input.toNodeId ?? ''), addedLabels)}"`
        );
        break;
      case 'delete_connection':
        lines.push('Remove a connection');
        break;
      default:
        lines.push(`Unrecognized operation "${op.tool}"`);
    }
  }
  return lines;
}

/** Applies a batch of proposed operations to a graph, returning a NEW
 *  AgentGraph — pure, no side effects. The caller (CopilotPanel, via
 *  AgentBuilder.tsx's handleApplyCopilotOperations) is what actually
 *  commits this to real state; this function never runs until Apply is
 *  clicked (propose/Apply/Discard-by-construction — see CopilotPanel.tsx).
 *
 *  add_node ops assign a real id and register it under their model-given
 *  localId, so LATER ops in the same batch (another add_node's
 *  connectFromNodeId, an add_connection, a rename) can reference a node
 *  that didn't exist before this batch started — same localId->realId
 *  pattern the plan calls for. Ops are applied in array order (the order
 *  Claude emitted the tool_use blocks in), which is what makes same-batch
 *  forward references resolve correctly. */
export function applyCopilotOperations(graph: AgentGraph, ops: CopilotOperation[]): AgentGraph {
  let nodes = [...graph.nodes];
  let connections = [...graph.connections];
  const idMap = new Map<string, string>();
  const resolve = (ref: string): string => idMap.get(ref) ?? ref;
  const stamp = Date.now();

  ops.forEach((op, i) => {
    const input = op.input;
    switch (op.tool) {
      case 'add_node': {
        const localId = String(input.localId ?? `cop_${stamp}_${i}`);
        const realId = `cop_${stamp}_${i}`;
        idMap.set(localId, realId);
        const newNode: AgentNode = {
          id: realId,
          name: String(input.label ?? 'Untitled node'),
          nodeType: String(input.nodeType ?? 'tool') as NodeType,
          nodeSubType: String(input.nodeSubType ?? ''),
          config: (input.config ?? {}) as NodeConfig,
          positionX: 40 + (i % 4) * 220,
          positionY: 400 + Math.floor(i / 4) * 140,
          sortOrder: nodes.length,
          isEnabled: true,
          mcpServer: null,
          mcpTool: null,
          aiEngineConnectionId: null,
        };
        nodes = [...nodes, newNode];
        if (typeof input.connectFromNodeId === 'string') {
          const fromId = resolve(input.connectFromNodeId);
          if (nodes.some(n => n.id === fromId)) {
            connections = [
              ...connections,
              {
                id: `cop_c${stamp}_${i}`,
                fromNodeId: fromId,
                fromPort: String(input.connectFromPort ?? 'out') as PortName,
                toNodeId: realId,
                toPort: 'in',
              },
            ];
          }
        }
        break;
      }
      case 'delete_node': {
        const targetId = resolve(String(input.nodeId ?? ''));
        const target = nodes.find(n => n.id === targetId);
        if (target && !PROTECTED_ROOT_TYPES.has(target.nodeType)) {
          nodes = nodes.filter(n => n.id !== targetId);
          connections = connections.filter(c => c.fromNodeId !== targetId && c.toNodeId !== targetId);
        }
        break;
      }
      case 'update_node_config': {
        const targetId = resolve(String(input.nodeId ?? ''));
        const patch = (input.configPatch ?? {}) as Partial<NodeConfig>;
        nodes = nodes.map(n => (n.id === targetId ? { ...n, config: { ...n.config, ...patch } } : n));
        break;
      }
      case 'rename_node': {
        const targetId = resolve(String(input.nodeId ?? ''));
        const name = String(input.name ?? '');
        if (name) nodes = nodes.map(n => (n.id === targetId ? { ...n, name } : n));
        break;
      }
      case 'add_connection': {
        const fromId = resolve(String(input.fromNodeId ?? ''));
        const toId = resolve(String(input.toNodeId ?? ''));
        if (nodes.some(n => n.id === fromId) && nodes.some(n => n.id === toId)) {
          connections = [
            ...connections,
            {
              id: `cop_c${stamp}_${i}`,
              fromNodeId: fromId,
              fromPort: String(input.fromPort ?? 'out') as PortName,
              toNodeId: toId,
              toPort: String(input.toPort ?? 'in') as PortName,
            },
          ];
        }
        break;
      }
      case 'delete_connection': {
        const connId = String(input.connectionId ?? '');
        connections = connections.filter(c => c.id !== connId);
        break;
      }
      default:
        break;
    }
  });

  return { ...graph, nodes, connections };
}
