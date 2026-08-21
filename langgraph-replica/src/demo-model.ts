/**
 * Offline scripted chat model (PROVIDER=demo) — lets you run the full
 * LangGraph pipeline (router handoff → subagent → approval interrupt →
 * tool → final answer) with zero API keys or token spend. It implements
 * the same BaseChatModel contract real providers do, which is itself a
 * demonstration: the graph code cannot tell this isn't GPT-4o.
 *
 * The script keys off conversation shape, not call order, so it stays
 * deterministic across LangGraph's replay-after-interrupt behavior:
 *   - router call (sees handoff tools, no verification context yet)
 *       → tool-calls handoff_sub_verification
 *   - subagent call, no ToolMessage yet → tool-calls send_otp (approval-gated)
 *   - subagent call after the tool result → final text answer
 */
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BaseChatModelParams,
  type BindToolsInput,
} from '@langchain/core/language_models/chat_models';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import type { BaseMessage, AIMessageChunk } from '@langchain/core/messages';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { Runnable } from '@langchain/core/runnables';

export class ScriptedDemoModel extends BaseChatModel {
  private boundToolNames: string[] = [];

  constructor(fields: BaseChatModelParams) {
    super(fields);
  }

  _llmType(): string {
    return 'scripted-demo';
  }

  override bindTools(
    tools: BindToolsInput[]
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, BaseChatModelCallOptions> {
    const clone = new ScriptedDemoModel({});
    clone.boundToolNames = tools.map(t => (t as { name?: string }).name ?? '');
    return clone as unknown as Runnable<BaseLanguageModelInput, AIMessageChunk, BaseChatModelCallOptions>;
  }

  async _generate(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const msg = this.nextScripted(messages);
    return { generations: [{ message: msg, text: typeof msg.content === 'string' ? msg.content : '' }] };
  }

  private nextScripted(messages: BaseMessage[]): AIMessage {
    const canHandoff = this.boundToolNames.some(n => n.startsWith('handoff_'));
    const canSendOtp = this.boundToolNames.includes('send_otp');
    // The handoff transfer note is ALSO a ToolMessage, so "did my OTP tool
    // already run" must match on the OTP result text, not any tool result.
    const otpAttempted = messages.some(
      m =>
        m instanceof ToolMessage &&
        (String(m.content).startsWith('OTP sent') || String(m.content).includes('REJECTED this send_otp'))
    );

    // Router turn: hand off identity questions to the verification subagent.
    if (canHandoff) {
      return new AIMessage({
        content: '',
        tool_calls: [
          {
            id: 'demo_call_handoff',
            name: 'handoff_sub_verification',
            args: { reason: 'Customer asked to verify their identity.' },
          },
        ],
      });
    }

    // Verification subagent, first turn: request the approval-gated OTP tool.
    if (canSendOtp && !otpAttempted) {
      return new AIMessage({
        content: '',
        tool_calls: [
          { id: 'demo_call_otp', name: 'send_otp', args: { mobile: '+91-98xxxxxx21' } },
        ],
      });
    }

    // Subagent after the OTP result (or plain model with no tools): answer.
    const otpResult = [...messages]
      .reverse()
      .find(m => m instanceof ToolMessage && !String(m.content).startsWith('Transferred'));
    return new AIMessage({
      content: otpResult
        ? `Done — ${String((otpResult as ToolMessage).content)} Please share the 6-digit code once you receive it.`
        : 'Hello! I can help you verify your identity or answer questions about your account.',
    });
  }
}
