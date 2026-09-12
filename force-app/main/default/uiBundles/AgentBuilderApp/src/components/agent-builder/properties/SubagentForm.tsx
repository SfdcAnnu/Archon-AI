import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEngineModels } from '@/lib/use-engine-models';
import { FieldLabel, Hint, Segmented } from './controls';
import { PromptAssist } from './PromptAssist';
import type { AgentNode, SubagentNodeConfig } from '@/types/agent';

const PROVIDERS = [
  { value: 'claude', label: 'Claude (Anthropic)' },
  { value: 'gpt4', label: 'GPT (OpenAI)' },
  { value: 'gemini', label: 'Gemini (Google)' },
];

export interface SubagentFormProps {
  node: AgentNode;
  onConfigChange: (patch: Partial<SubagentNodeConfig>) => void;
  /** Changes the node's provider (NodeSubType__c) — same handler the root
   *  ai node uses. */
  onProviderChange: (nodeSubType: string) => void;
}

/** Sub-agent inspector, per the approved builder design: how it answers
 *  (call/return vs handoff) as a pill choice, when to use it, what it can
 *  see, then its own model. */
export function SubagentForm({ node, onConfigChange, onProviderChange }: SubagentFormProps) {
  const cfg = node.config as SubagentNodeConfig;
  const { models, currentIsDisabled, noConnection } = useEngineModels(node.nodeSubType, cfg?.model);
  const mode = cfg?.mode ?? 'transfer';

  return (
    <div className="space-y-[15px]">
      <div>
        <FieldLabel>How it answers</FieldLabel>
        <Segmented
          value={mode}
          options={[
            { value: 'call', label: 'Returns a value' },
            { value: 'transfer', label: 'Hands off' },
          ]}
          onChange={v => onConfigChange({ mode: v as SubagentNodeConfig['mode'] })}
        />
        <Hint>
          {mode === 'call'
            ? 'The lead agent gives it a task, gets the result back, and keeps control of the reply. Several of these in one turn run in parallel.'
            : 'It takes over the conversation and replies to the customer itself; control does not come back. The default, and fastest for conversation.'}
        </Hint>
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="text-[10.5px] font-bold text-muted-foreground">When to use it</span>
          <div className="ml-auto">
            <PromptAssist
              draft={cfg?.routingDescription ?? ''}
              role="tool"
              modelId={cfg?.model ?? ''}
              agentName={node.name}
              onAccept={text => onConfigChange({ routingDescription: text })}
            />
          </div>
        </div>
        <Textarea
          value={cfg?.routingDescription ?? ''}
          onChange={e => onConfigChange({ routingDescription: e.target.value })}
          placeholder='e.g. "Customer states a target price, asks for a discount, or says the price is too high."'
          className="min-h-[74px] text-xs"
        />
        <Hint>The lead model reads this like a tool description when deciding to use this specialist.</Hint>
      </div>

      {mode === 'call' && (
        <div>
          <FieldLabel>What it can see</FieldLabel>
          <Select
            value={cfg?.contextPolicy ?? 'isolated'}
            onValueChange={v => onConfigChange({ contextPolicy: v as SubagentNodeConfig['contextPolicy'] })}
          >
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="isolated" className="text-xs">Only what it is given</SelectItem>
              <SelectItem value="windowed" className="text-xs">Last few turns</SelectItem>
              <SelectItem value="full" className="text-xs">The whole conversation</SelectItem>
            </SelectContent>
          </Select>
          <Hint>
            "Only what it is given" keeps token cost flat no matter how many specialists run — it still knows
            which record the conversation is about.
          </Hint>
        </div>
      )}

      <div>
        <FieldLabel>Provider</FieldLabel>
        <Select
          value={node.nodeSubType}
          onValueChange={v => {
            if (v === node.nodeSubType) return;
            onProviderChange(v);
            // A model id only exists on its own provider.
            onConfigChange({ model: '' });
          }}
        >
          <SelectTrigger className="h-8 w-full text-xs">
            <SelectValue placeholder="Select a provider…" />
          </SelectTrigger>
          <SelectContent>
            {PROVIDERS.map(p => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <FieldLabel>Model</FieldLabel>
        <Select value={cfg?.model ?? ''} onValueChange={v => onConfigChange({ model: v })}>
          <SelectTrigger className="h-8 w-full font-mono text-xs">
            <SelectValue placeholder="Provider default" />
          </SelectTrigger>
          <SelectContent>
            {models.map(m => (
              <SelectItem key={m} value={m} className="font-mono text-xs">{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Hint>
          {currentIsDisabled
            ? `${cfg?.model} is no longer enabled for this provider on the AI Models page. It still runs, but pick another model or re-enable it there.`
            : noConnection
              ? "No active key for this provider yet — these are its standard models. Add a key on the AI Models page to choose what's available here."
              : "Runs its own model call on the org's active connection for this provider — no separate credential needed. Only models enabled on the AI Models page appear here."}
        </Hint>
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="text-[10.5px] font-bold text-muted-foreground">Instructions</span>
          <div className="ml-auto">
            <PromptAssist
              draft={cfg?.systemPrompt ?? ''}
              role="subagent"
              modelId={cfg?.model ?? ''}
              agentName={node.name}
              onAccept={text => onConfigChange({ systemPrompt: text })}
            />
          </div>
        </div>
        <Textarea
          value={cfg?.systemPrompt ?? ''}
          onChange={e => onConfigChange({ systemPrompt: e.target.value })}
          placeholder="Instructions this specialist follows once it takes the task…"
          className="min-h-28 font-mono text-[11.5px] leading-relaxed"
        />
      </div>
    </div>
  );
}
