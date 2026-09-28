import type { AgentConnection, AgentNode, PortName } from '@/types/agent';

/**
 * The automation step nodes — logic and actions — and the exits each one
 * has. These mirror what the automation engine actually does
 * (server-langchain/src/orchestrator/engine.ts and src/nodes/*):
 *
 *   if_else   → yes / no          (the condition's result)
 *   loop      → each / done       (each item runs the "each" branch, then "done")
 *   approval  → approved / rejected (the decision the run resumes with)
 *   everything else → out
 *
 * One place, so the canvas handles, the connection check and the Architect
 * all agree on which exits a node has.
 */
export interface FlowPort { id: string; label: string }

const PORTS: Record<string, FlowPort[]> = {
  if_else: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
  loop: [{ id: 'each', label: 'For each' }, { id: 'done', label: 'After all' }],
  approval: [{ id: 'approved', label: 'Approved' }, { id: 'rejected', label: 'Rejected' }],
};

export function outputPortsFor(nodeSubType: string): FlowPort[] {
  return PORTS[nodeSubType] ?? [{ id: 'out', label: '' }];
}

/** An AI step in an automation: an AI node with its own prompt and named
 *  outputs, drawn and edited as a step (not the agent's root). */
export function isAiStep(node: Pick<AgentNode, 'nodeType' | 'config'>): boolean {
  return node.nodeType === 'ai' && (node.config as { step?: unknown }).step === true;
}

export interface StepOutput { name: string; type: 'text' | 'number' | 'boolean' | 'date' | 'choice'; description?: string; options?: string[] }

/** An AI step's declared outputs, as saved. */
export function stepOutputs(node: Pick<AgentNode, 'config'>): StepOutput[] {
  const raw = (node.config as { outputs?: unknown }).outputs;
  return Array.isArray(raw) ? (raw as StepOutput[]).filter(o => o && typeof o.name === 'string') : [];
}

/** A short line under the node's name: what it is set to do. */
export function flowNodeSummary(node: AgentNode): string {
  const c = node.config as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  if (isAiStep(node)) {
    const outs = stepOutputs(node);
    return outs.length ? `→ ${s(c.outputVariable) || 'result'} { ${outs.map(o => o.name).join(', ')} }` : 'Write the prompt and its outputs';
  }
  switch (node.nodeSubType) {
    case 'if_else': return s(c.condition) || 'Set a condition';
    case 'loop': return s(c.collectionVar) ? `Each ${s(c.iteratorVar) || 'item'} in ${s(c.collectionVar)}` : 'Pick the list to go through';
    case 'wait': return c.delayValue ? `Wait ${c.delayValue} ${s(c.delayUnit) || 'minutes'}` : 'Set how long to wait';
    case 'approval': return s(c.processDefinitionId) ? `Approval process ${s(c.processDefinitionId)}` : 'Default approval process';
    case 'set_variable': return s(c.variableName) ? `${s(c.variableName)} = ${s(c.template).slice(0, 40)}` : 'Name the variable';
    case 'get_record': return s(c.objectType) ? `Read ${s(c.objectType)}` : 'Pick the object';
    case 'query_records': return s(c.soql) ? s(c.soql).slice(0, 48) : 'Write the query';
    case 'create_record': return s(c.objectType) ? `Create ${s(c.objectType)}` : 'Pick the object';
    case 'update_record': return s(c.objectType) ? `Update ${s(c.objectType)}` : 'Pick the object';
    case 'create_task': return s(c.subject) ? `Task: ${s(c.subject).slice(0, 40)}` : 'Write the subject';
    case 'post_chatter': return s(c.message) ? s(c.message).slice(0, 44) : 'Write the post';
    case 'call_tool': return s(c.toolName) ? `${s(c.provider)} · ${s(c.toolName)}` : 'Pick a connector and a tool';
    default: return node.nodeSubType;
  }
}

/** What is missing before this node can run — shown on the node and in the
 *  panel. Empty when it is ready. */
export function flowNodeProblems(node: AgentNode, connections: AgentConnection[]): string[] {
  const c = node.config as Record<string, unknown>;
  const has = (k: string) => typeof c[k] === 'string' ? (c[k] as string).trim() !== '' : c[k] != null && c[k] !== 0;
  const out: string[] = [];
  const need = (k: string, msg: string) => { if (!has(k)) out.push(msg); };
  if (isAiStep(node)) {
    need('instruction', 'No prompt');
    if (stepOutputs(node).length === 0) out.push('No outputs declared');
    need('outputVariable', 'Name the result so later steps can read it');
    for (const o of stepOutputs(node)) if (o.type === 'choice' && (o.options?.length ?? 0) < 2) out.push(`"${o.name}" needs two or more choices`);
    return out;
  }
  switch (node.nodeSubType) {
    case 'if_else': need('condition', 'No condition set'); break;
    case 'loop': need('collectionVar', 'No list to go through'); break;
    case 'wait': need('delayValue', 'No wait time'); break;
    case 'set_variable': need('variableName', 'No variable name'); break;
    case 'get_record': case 'update_record': need('objectType', 'No object picked'); break;
    case 'create_record': need('objectType', 'No object picked'); if (!hasMappings(c.fieldMappings)) out.push('No fields to write'); break;
    case 'query_records': need('soql', 'No query written'); break;
    case 'create_task': need('subject', 'No task subject'); break;
    case 'post_chatter': need('message', 'No post text'); break;
    case 'call_tool': need('provider', 'No connector picked'); need('toolName', 'No tool picked'); break;
  }
  const wired = new Set(connections.filter(x => x.fromNodeId === node.id).map(x => x.fromPort as string));
  if (node.nodeSubType === 'if_else' && !wired.has('yes') && !wired.has('no')) out.push('Connect the Yes or No exit');
  if (node.nodeSubType === 'loop' && !wired.has('each')) out.push('Connect the For each exit to the steps to repeat');
  return out;
}

/** A field map counts only when it is JSON with at least one field. */
function hasMappings(v: unknown): boolean {
  try { const o = JSON.parse(String(v ?? '')); return !!o && typeof o === 'object' && Object.keys(o).length > 0; } catch { return false; }
}

export const isFlowPort = (p: string): p is PortName => ['out', 'yes', 'no', 'each', 'done', 'approved', 'rejected'].includes(p);
