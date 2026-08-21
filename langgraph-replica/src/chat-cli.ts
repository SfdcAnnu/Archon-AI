/**
 * Terminal chat harness for the compiled graph — the replica's stand-in
 * for ChatPanel + the WS gateway. Two modes:
 *
 *   npm run chat   — interactive REPL (type messages; y/n on approvals)
 *   npm run demo   — scripted: sends one message, auto-approves the
 *                    interrupt, prints the full transcript. Runs offline
 *                    with PROVIDER=demo (the default in .env.example).
 *
 * The part worth reading closely is the interrupt round-trip: invoke()
 * returns with `__interrupt__` instead of finishing, the process could
 * even exit here (with a Postgres checkpointer), and a later invoke of
 * `new Command({ resume: decision })` on the same thread_id continues
 * INSIDE the paused tool. That is Archon's whole approval feature —
 * ApprovalToken__c, the resume endpoint, ApprovalsPage plumbing — in
 * one primitive.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { Command } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { compileAgentGraph } from './graph-compiler.js';
import type { AgentGraphSpec } from './types.js';

const specPath = process.argv[2];
const scripted = process.argv.includes('--scripted');
if (!specPath) {
  console.error('Usage: tsx src/chat-cli.ts <agent-graph.json> [--scripted]');
  process.exit(1);
}

const spec = JSON.parse(readFileSync(specPath, 'utf8')) as AgentGraphSpec;
const graph = compileAgentGraph(spec);
// thread_id = Archon's ChatSession__c Id: all history + any paused
// interrupt state for this conversation lives under this key.
const config = { configurable: { thread_id: `cli-${Date.now()}` } };

function printNewMessages(before: number, messages: BaseMessage[]) {
  for (const m of messages.slice(before)) {
    if (m instanceof AIMessage) {
      for (const c of m.tool_calls ?? []) console.log(`  ⚙ tool call → ${c.name}(${JSON.stringify(c.args)})`);
      if (typeof m.content === 'string' && m.content.trim()) console.log(`  🤖 ${m.content}`);
    } else if (m instanceof ToolMessage) {
      console.log(`  ⚙ tool result ← ${String(m.content).slice(0, 200)}`);
    }
  }
}

interface InterruptRecord {
  value: { kind: string; toolName: string; args: Record<string, unknown> };
}

/** A paused run reports its pending interrupt(s) on the checkpointed
 *  state's tasks (getState), and newer versions also mirror them onto the
 *  invoke() result as __interrupt__ — read both so the harness works
 *  across LangGraph minor versions. */
async function pendingInterrupts(result: Record<string, unknown>): Promise<InterruptRecord[]> {
  const onResult = result.__interrupt__ as InterruptRecord[] | undefined;
  if (onResult?.length) return onResult;
  const state = await graph.getState(config);
  return (state.tasks ?? []).flatMap(t => (t.interrupts ?? []) as InterruptRecord[]);
}

async function runTurn(input: { messages: HumanMessage[] } | Command, ask: (q: string) => Promise<string>) {
  let before = (await graph.getState(config)).values.messages?.length ?? 0;
  let result = await graph.invoke(input, config);
  printNewMessages(before, result.messages);

  // Keep resolving interrupts until the turn actually finishes — a turn
  // may pause more than once if several gated tools fire.
  for (;;) {
    const pending = await pendingInterrupts(result as Record<string, unknown>);
    if (!pending.length) break;
    const req = pending[0].value;
    console.log(`\n  ⏸ APPROVAL REQUIRED — ${req.toolName}(${JSON.stringify(req.args)})`);
    const answer = (await ask('  approve? [y/n] ')).trim().toLowerCase();
    const decision = { approved: answer === 'y' || answer === 'yes', comment: '' };
    console.log(`  ▶ resuming with approved=${decision.approved}\n`);
    before = (await graph.getState(config)).values.messages?.length ?? 0;
    result = await graph.invoke(new Command({ resume: decision }), config);
    printNewMessages(before, result.messages);
  }
}

async function main() {
  console.log(`Agent: ${spec.agent.name} (provider mode: ${process.env.PROVIDER ?? 'per-node'})`);

  if (scripted) {
    console.log('\n— scripted demo: "Hi, I want to verify my identity" —');
    await runTurn({ messages: [new HumanMessage('Hi, I want to verify my identity')] }, async () => 'y');
    console.log('\n— demo complete: handoff → approval interrupt → resume → answer all exercised —');
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (;;) {
    const line = (await rl.question('\nyou> ')).trim();
    if (!line || line === 'exit') break;
    await runTurn({ messages: [new HumanMessage(line)] }, q => rl.question(q));
  }
  rl.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
