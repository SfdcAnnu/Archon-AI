/**
 * THE provider-switching point — the whole reason this replica exists.
 *
 * In the hand-rolled server this is server/src/chat/adapters/*:
 * runClaudeAdapter + runOpenAiAdapter, each ~300 lines that hand-encode
 * that provider's message format, tool-schema shape, streaming frames and
 * continuation contract (the OpenAI function_call_output 500 and the
 * "flat vs nested tools" bugs both lived there).
 *
 * Here, every provider implements LangChain's BaseChatModel contract:
 * same .invoke(messages), same .bindTools(tools), same AIMessage back —
 * so "switching model" is this one lookup, and tool definitions (zod
 * schemas in tools.ts) are written ONCE and translated to each vendor's
 * wire format by the library. Adding a provider = one import + one case.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ScriptedDemoModel } from './demo-model.js';

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-6',
  google: 'gemini-2.5-pro',
};

export function getChatModel(provider: string, model?: string): BaseChatModel {
  // PROVIDER=demo (or an unset key) routes everything to the offline
  // scripted model so the graph mechanics can be watched for free.
  const p = process.env.PROVIDER === 'demo' ? 'demo' : provider;
  switch (p) {
    case 'openai':
      return new ChatOpenAI({ model: model ?? DEFAULT_MODELS.openai, temperature: 0 });
    case 'anthropic':
      return new ChatAnthropic({ model: model ?? DEFAULT_MODELS.anthropic, temperature: 0 });
    case 'google':
      return new ChatGoogleGenerativeAI({ model: model ?? DEFAULT_MODELS.google, temperature: 0 });
    case 'demo':
      return new ScriptedDemoModel({});
    default:
      throw new Error(
        `Unknown provider "${provider}" — add one import and one case here. ` +
          `That single line is the full cost of a new provider.`
      );
  }
}
