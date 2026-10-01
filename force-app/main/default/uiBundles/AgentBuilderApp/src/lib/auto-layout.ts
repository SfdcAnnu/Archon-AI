import type { AgentGraph, AgentNode } from '@/types/agent';

/**
 * Tidy up: a layered layout for the canvas, so a generated or hand-built
 * graph reads left to right (automations) or top to bottom (chat agents)
 * with nothing on top of anything else.
 *
 * Each node's rank is the longest path from a source (a trigger, the root);
 * within a rank, nodes sit next to the average position of their parents,
 * pushed apart just enough not to overlap. Tools hanging off a node count
 * as its children, so they land in the next column beside the step they
 * serve. Only positions change; nothing else about the graph.
 */
const NODE_W = 260;
const NODE_H = 100;
const GAP_MAIN = 110;   // between ranks
const GAP_CROSS = 34;   // between siblings

export function autoLayout(graph: AgentGraph): AgentNode[] {
  const nodes = graph.nodes;
  if (nodes.length === 0) return nodes;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const out = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) { out.set(n.id, []); parents.set(n.id, []); indeg.set(n.id, 0); }
  for (const c of graph.connections) {
    if (!byId.has(c.fromNodeId) || !byId.has(c.toNodeId) || c.fromNodeId === c.toNodeId) continue;
    if (out.get(c.fromNodeId)!.includes(c.toNodeId)) continue;
    out.get(c.fromNodeId)!.push(c.toNodeId);
    parents.get(c.toNodeId)!.push(c.fromNodeId);
    indeg.set(c.toNodeId, indeg.get(c.toNodeId)! + 1);
  }

  // Longest-path ranks over a topological order; a node caught in a cycle
  // keeps rank 0 rather than stalling the layout.
  const rank = new Map<string, number>();
  const remaining = new Map(indeg);
  const queue = nodes.filter(n => indeg.get(n.id) === 0).map(n => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    const r = rank.get(id) ?? 0;
    rank.set(id, r);
    for (const t of out.get(id)!) {
      rank.set(t, Math.max(rank.get(t) ?? 0, r + 1));
      remaining.set(t, remaining.get(t)! - 1);
      if (remaining.get(t) === 0) queue.push(t);
    }
  }
  for (const n of nodes) if (!rank.has(n.id)) rank.set(n.id, 0);

  // An automation reads left to right; a chat agent's tree, top to bottom.
  const horizontal = nodes.some(n => n.nodeType === 'trigger' || n.nodeType === 'logic' || n.nodeType === 'action');
  const ranks = new Map<number, AgentNode[]>();
  for (const n of nodes) {
    const r = rank.get(n.id)!;
    if (!ranks.has(r)) ranks.set(r, []);
    ranks.get(r)!.push(n);
  }
  const cross = new Map<string, number>();   // the position across the flow (y when horizontal)
  const stride = (horizontal ? NODE_H : NODE_W) + GAP_CROSS;
  const sorted = [...ranks.keys()].sort((a, b) => a - b);
  for (const r of sorted) {
    const members = ranks.get(r)!;
    // Where each member wants to be: beside its parents, else in its old order.
    const want = members.map(n => {
      const ps = parents.get(n.id)!.filter(p => cross.has(p));
      const wanted = ps.length ? ps.reduce((s, p) => s + cross.get(p)!, 0) / ps.length : (horizontal ? n.positionY : n.positionX);
      return { n, wanted };
    });
    want.sort((a, b) => a.wanted - b.wanted || a.n.sortOrder - b.n.sortOrder);
    // Pack: each member at its wish, or just below the previous one.
    let prev = -Infinity;
    const placed = want.map(w => {
      const at = Math.max(w.wanted, prev === -Infinity ? w.wanted : prev + stride);
      prev = at;
      return { n: w.n, at };
    });
    // Centre the packed run on its collective wish, so a branch fans out around its parent.
    const wishMean = want.reduce((s, w) => s + w.wanted, 0) / want.length;
    const atMean = placed.reduce((s, p) => s + p.at, 0) / placed.length;
    const shift = Number.isFinite(wishMean) && Number.isFinite(atMean) ? wishMean - atMean : 0;
    for (const p of placed) cross.set(p.n.id, p.at + shift);
  }
  // Normalise so the graph starts near the origin.
  const minCross = Math.min(...[...cross.values()]);
  const mainStride = (horizontal ? NODE_W : NODE_H) + GAP_MAIN;
  return nodes.map(n => {
    const main = 40 + rank.get(n.id)! * mainStride;
    const across = 40 + (cross.get(n.id)! - minCross);
    return { ...n, positionX: Math.round(horizontal ? main : across), positionY: Math.round(horizontal ? across : main) };
  });
}
