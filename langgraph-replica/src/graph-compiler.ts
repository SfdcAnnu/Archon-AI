/**
 * graph-compiler — the replica's core. Takes the SAME graph the canvas
 * saves to Salesforce (nodes + fromPort:'tool' connections) and compiles
 * it into a LangGraph StateGraph.
 *
 * Side-by-side with the hand-rolled server:
 *
 *   server/src/chat/chat-engine.ts   → compileAgentGraph() + graph.invoke()
 *   server/src/chat/subagent-router.ts → handoff tools + Command routing below
 *   adapters/runOpenAiAdapter etc.   → getChatModel() (model-provider.ts)
 *   ChatSession__c/ChatMessage__c history → checkpointer thread (thread_id)
 *   approval pause/resume plumbing   → interrupt() inside withApproval()
 *
 * Runtime semantics preserved from Archon:
 *   - subagent/tool children attach ONLY via fromPort === 'tool'
 *   - catalog attachment is port-agnostic (adjacency only)
 *   - subagents are one level deep; a subagent answers the user directly
 *     (its reply is the turn's reply — same as subagent-router.ts)
 */
import {
  Annotation,
  Command,
  END,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { ToolNode, createReactAgent } from '@langchain/langgraph/prebuilt';
import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { z } from 'zod';
import type { AgentGraphSpec, AgentNodeSpec } from './types.js';
import { getChatModel } from './model-provider.js';
import { buildToolRegistry, withApproval } from './tools.js';

const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
});

/** Children of `parentId` reachable per Archon's port rules. */
function childrenOf(spec: AgentGraphSpec, parentId: string): AgentNodeSpec[] {
  return spec.connections
    .filter(c => c.from === parentId)
    .filter(c => {
      const child = spec.nodes.find(n => n.id === c.to);
      if (!child) return false;
      // The load-bearing Archon rule: subagents/tools are invisible at
      // runtime unless wired from the 'tool' port; catalogs attach on any
      // port. Enforced here identically so both runtimes agree on what a
      // given saved graph MEANS.
      return child.nodeType === 'catalog' || c.fromPort === 'tool';
    })
    .map(c => spec.nodes.find(n => n.id === c.to)!)
    .filter(n => n.nodeType !== 'ai');
}

/** Resolve a node's callable tools: its own tool children + every catalog
 *  child's allowedTools, all looked up in the registry. Approval-gated
 *  tool nodes get the interrupt() wrapper. */
function resolveTools(spec: AgentGraphSpec, parentId: string): StructuredToolInterface[] {
  const registry = buildToolRegistry();
  const out: StructuredToolInterface[] = [];
  for (const child of childrenOf(spec, parentId)) {
    if (child.nodeType === 'tool' && child.config.toolName) {
      const base = registry.get(child.config.toolName);
      if (!base) continue; // unresolvable binding — Archon's validators reject these at generation time
      out.push(child.config.requiresApproval ? withApproval(base) : base);
    } else if (child.nodeType === 'catalog') {
      for (const name of child.config.allowedTools ?? []) {
        const t = registry.get(name);
        if (t) out.push(t);
      }
    }
  }
  return out;
}

export function compileAgentGraph(spec: AgentGraphSpec) {
  const root = spec.nodes.find(n => n.nodeType === 'ai');
  if (!root) throw new Error('Graph has no root ai node.');

  const subagents = childrenOf(spec, root.id).filter(n => n.nodeType === 'subagent');
  const rootTools = resolveTools(spec, root.id);

  // ── Handoff tools: one per subagent, built from routingDescription —
  // the literal same mechanism as subagent-router.ts (subagents ARE tools
  // in the router's eyes; the model's own reasoning picks one).
  const handoffTools = subagents.map(sub =>
    tool(async () => `Handing off to ${sub.label}.`, {
      name: `handoff_${sub.id}`,
      description: sub.config.routingDescription ?? sub.label,
      schema: z.object({ reason: z.string().describe('Why this specialist fits the request') }),
    })
  );

  const rootBase = getChatModel(root.nodeSubType, root.config.model);
  if (!rootBase.bindTools) throw new Error(`Provider "${root.nodeSubType}" does not support tool binding.`);
  const routerModel = rootBase.bindTools([...rootTools, ...handoffTools]);
  const rootPrompt = [spec.agent.systemPrompt, root.config.systemPrompt].filter(Boolean).join('\n\n');

  // ── Router node. Three outcomes, expressed as Command targets:
  //   plain answer → END; regular tool call → root_tools (then back);
  //   handoff_<id> → that subagent's node (with a ToolMessage appended
  //   first — providers require every tool_call to get a result before
  //   the conversation continues; forgetting this exact rule caused the
  //   hand-rolled generator's 500 bug).
  const routerNode = async (state: typeof AgentState.State) => {
    const response = (await routerModel.invoke([
      new SystemMessage(rootPrompt),
      ...state.messages,
    ])) as AIMessage;

    const calls = response.tool_calls ?? [];
    const handoff = calls.find(c => c.name.startsWith('handoff_'));
    if (handoff) {
      const targetId = handoff.name.replace(/^handoff_/, '');
      return new Command({
        goto: `sub_${targetId}`,
        update: {
          messages: [
            response,
            new ToolMessage({ content: `Transferred to ${targetId}.`, tool_call_id: handoff.id! }),
          ],
        },
      });
    }
    if (calls.length > 0) {
      return new Command({ goto: 'root_tools', update: { messages: [response] } });
    }
    return new Command({ goto: END, update: { messages: [response] } });
  };

  const builder = new StateGraph(AgentState)
    .addNode('router', routerNode, {
      ends: [END, 'root_tools', ...subagents.map(s => `sub_${s.id}`)],
    })
    .addNode('root_tools', new ToolNode(rootTools))
    .addEdge(START, 'router')
    .addEdge('root_tools', 'router'); // tool results loop back for the next model step

  // ── Subagent nodes: each is a prebuilt ReAct agent (its own model,
  // prompt and tool set — the "domain expert with its own toolbox" from
  // the Archon tiering rules), run as ONE node of the parent graph. Its
  // answer ends the turn, matching Archon's handoff semantics.
  // Node names here are computed from the user's saved graph, which
  // LangGraph's static typing can't know about — the untyped view below
  // is confined to this loop; the wiring itself mirrors the typed calls
  // above exactly.
  const dynamicBuilder = builder as unknown as {
    addNode(name: string, fn: (state: typeof AgentState.State) => Promise<unknown>): void;
    addEdge(from: string, to: string): void;
  };
  for (const sub of subagents) {
    const agent = createReactAgent({
      llm: getChatModel(sub.nodeSubType, sub.config.model),
      tools: resolveTools(spec, sub.id),
      stateModifier: [spec.agent.systemPrompt, sub.config.systemPrompt].filter(Boolean).join('\n\n'),
    });
    dynamicBuilder.addNode(`sub_${sub.id}`, async (state: typeof AgentState.State) => {
      const result = await agent.invoke({ messages: state.messages });
      return { messages: result.messages.slice(state.messages.length) };
    });
    dynamicBuilder.addEdge(`sub_${sub.id}`, END);
  }

  // MemorySaver = in-process checkpointing (history + interrupt state per
  // thread_id). Swapping in PostgresSaver — one line — is what makes runs
  // durable across restarts; kept in-memory here so the demo is standalone.
  return builder.compile({ checkpointer: new MemorySaver() });
}
