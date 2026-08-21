/**
 * THE SIMPLEST POSSIBLE AGENT — run with:  npm run example
 *
 * One tool (get_loan_balance), one question ("What is my loan balance?"),
 * zero API keys (a tiny scripted model stands in for GPT-4o).
 *
 * The point: createReactAgent (renamed `createAgent` in LangChain 1.0) is
 * given ONLY three things — a model, a list of tools, a prompt — and it
 * runs the entire agent loop for you:
 *
 *     ┌────────────────────────────────────────────────┐
 *     │ 1. call model (tools attached)                 │
 *     │ 2. model answered with a TOOL CALL?            │
 *     │      yes → run the tool, append result, goto 1 │
 *     │      no  → plain text = final answer, stop     │
 *     └────────────────────────────────────────────────┘
 *
 * Scroll to main(): there is NO loop in our code. The loop lives inside
 * the library. Compare with Archon's chat-engine.ts, which implements
 * this exact cycle by hand (call adapter → execute tool calls → re-call
 * adapter → repeat).
 */
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BaseChatModelParams,
  type BindToolsInput,
} from '@langchain/core/language_models/chat_models';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import type { BaseMessage, AIMessageChunk } from '@langchain/core/messages';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { Runnable } from '@langchain/core/runnables';

// ── 1. A TOOL ────────────────────────────────────────────────────────
// Defined ONCE: a zod schema (what inputs it takes) + a function (what it
// does). The library converts this to OpenAI's / Anthropic's / Gemini's
// wire format — you never write provider-specific tool JSON.
const getLoanBalance = tool(
  async ({ customerId }) => {
    // In real life: an MCP call or SOQL query. Here: canned data.
    return JSON.stringify({ customerId, product: 'Personal Loan', balance: 250000, currency: 'INR' });
  },
  {
    name: 'get_loan_balance',
    description: "Look up the customer's current loan balance by their customer id.",
    schema: z.object({ customerId: z.string().describe('The customer record id') }),
  }
);

// ── 2. A MODEL ───────────────────────────────────────────────────────
// A 25-line stand-in for GPT-4o so the example runs offline. It follows
// the same contract a real model does:
//   - asked a question it can't answer from memory → returns a TOOL CALL
//   - sees a tool result in the conversation      → returns the ANSWER
// Swap this one object for `new ChatOpenAI({model:'gpt-4o'})` and nothing
// else in the file changes — that is the whole point of the abstraction.
class TinyScriptedModel extends BaseChatModel {
  constructor() {
    super({});
  }
  _llmType() {
    return 'tiny-scripted';
  }
  override bindTools(
    _tools: BindToolsInput[]
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, BaseChatModelCallOptions> {
    return this as unknown as Runnable<BaseLanguageModelInput, AIMessageChunk, BaseChatModelCallOptions>;
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const toolResult = messages.find(m => m instanceof ToolMessage);
    const msg = toolResult
      ? // Second visit: the loop appended the tool's output — now answer.
        new AIMessage(
          `Your Personal Loan balance is ₹2,50,000. (I read this from: ${String(toolResult.content)})`
        )
      : // First visit: no data yet — ask for the tool.
        new AIMessage({
          content: '',
          tool_calls: [{ id: 'call_1', name: 'get_loan_balance', args: { customerId: '003DEMO000001' } }],
        });
    return { generations: [{ message: msg, text: typeof msg.content === 'string' ? msg.content : '' }] };
  }
}

// ── 3. THE AGENT — three inputs, zero loop code ──────────────────────
const agent = createReactAgent({
  llm: new TinyScriptedModel(),
  tools: [getLoanBalance],
  stateModifier: 'You are a loan support assistant. Use tools to fetch real data; never guess numbers.',
});

// ── 4. RUN IT AND PRINT THE PLAY-BY-PLAY ─────────────────────────────
async function main() {
  const result = await agent.invoke({
    messages: [new HumanMessage('What is my loan balance?')],
  });

  console.log('The conversation createReactAgent produced, message by message:\n');
  result.messages.forEach((m, i) => {
    if (m instanceof HumanMessage) {
      console.log(`${i + 1}. [YOU]        ${m.content}`);
    } else if (m instanceof AIMessage && (m.tool_calls?.length ?? 0) > 0) {
      const c = m.tool_calls![0];
      console.log(`${i + 1}. [MODEL]      "I need data" → tool call: ${c.name}(${JSON.stringify(c.args)})`);
    } else if (m instanceof ToolMessage) {
      console.log(`${i + 1}. [TOOL RAN]   ${String(m.content)}     ← the LIBRARY executed this, not our code`);
    } else if (m instanceof AIMessage) {
      console.log(`${i + 1}. [MODEL]      final answer: ${m.content}`);
    }
  });
  console.log(
    '\nNotice: our file contains no loop, no tool dispatch, no "append result and re-call".\n' +
      'createReactAgent did steps 2→3→4 on its own. That loop is what chat-engine.ts hand-writes.'
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
