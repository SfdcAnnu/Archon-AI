import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEngineModels } from '@/lib/use-engine-models';
import { AiEngineConnectionPicker } from './AiEngineConnectionPicker';
import { FieldLabel, Hint, Segmented } from './controls';
import { PromptAssist } from './PromptAssist';
import type { AgentNode, AiNodeConfig } from '@/types/agent';

const PROVIDERS = [
  { value: 'claude', label: 'Claude (Anthropic)' },
  { value: 'gpt4', label: 'GPT (OpenAI)' },
  { value: 'gemini', label: 'Gemini (Google)' },
];

export interface AiRootFormProps {
  node: AgentNode;
  onConfigChange: (patch: Partial<AiNodeConfig>) => void;
  onProviderChange: (nodeSubType: string) => void;
  onConnectionBound: (connectionId: string | null) => void;
}

/** The root AI agent's inspector, per the approved builder design:
 *  provider/model, fallback (disabled until the runtime supports it),
 *  answer style, thinking effort, longest reply, then instructions. The
 *  three new knobs persist into ConfigJson — client-owned config the
 *  runtime reads generically, same pattern as `budgets`. */
export function AiRootForm({ node, onConfigChange, onProviderChange, onConnectionBound }: AiRootFormProps) {
  const cfg = node.config as AiNodeConfig;
  const models = useEngineModels(node.nodeSubType);

  return (
    <div className="space-y-[15px]">
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
        <Hint>Only models enabled on this provider's connection appear here.</Hint>
      </div>

      <div>
        <FieldLabel>If this model fails</FieldLabel>
        <Select disabled value="none">
          <SelectTrigger className="h-8 w-full text-xs opacity-60">
            <SelectValue placeholder="No fallback yet" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No fallback yet</SelectItem>
          </SelectContent>
        </Select>
        <Hint>Model fallback arrives with the runtime's next update — a rejected key will degrade quality instead of failing the turn.</Hint>
      </div>

      <div>
        <FieldLabel>Answer style</FieldLabel>
        <Segmented
          value={cfg?.answerStyle ?? 'balanced'}
          options={[
            { value: 'precise', label: 'Precise' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'exploratory', label: 'Exploratory' },
          ]}
          onChange={v => onConfigChange({ answerStyle: v })}
        />
      </div>

      <div>
        <FieldLabel>Thinking effort</FieldLabel>
        <Segmented
          value={cfg?.thinkingEffort ?? 'standard'}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'standard', label: 'Standard' },
            { value: 'deep', label: 'Deep' },
          ]}
          onChange={v => onConfigChange({ thinkingEffort: v })}
        />
      </div>

      <div>
        <FieldLabel>Longest reply</FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={64}
            step={64}
            value={cfg?.maxReplyTokens ?? ''}
            placeholder="1024"
            onChange={e => {
              const n = Number(e.target.value);
              onConfigChange({ maxReplyTokens: Number.isFinite(n) && n > 0 ? n : undefined });
            }}
            className="h-8 w-28 font-mono text-xs"
          />
          <span className="text-[11px] text-muted-foreground">tokens</span>
        </div>
        <Hint>Replies are about half your bill. This cap moves cost more than shortening instructions.</Hint>
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="text-[10.5px] font-bold text-muted-foreground">Instructions</span>
          <div className="ml-auto">
            <PromptAssist
              draft={cfg?.systemPrompt ?? ''}
              role="agent"
              modelId={cfg?.model ?? ''}
              agentName={node.name}
              onAccept={text => onConfigChange({ systemPrompt: text })}
            />
          </div>
        </div>
        <Textarea
          value={cfg?.systemPrompt ?? ''}
          onChange={e => onConfigChange({ systemPrompt: e.target.value })}
          placeholder="Write it however you like — rough notes or your own language. Then press Improve and I'll rewrite it properly for this model."
          className="min-h-32 font-mono text-[11.5px] leading-relaxed"
        />
      </div>

      <AiEngineConnectionPicker
        nodeId={node.id}
        nodeSubType={node.nodeSubType}
        currentConnectionId={node.aiEngineConnectionId}
        onBound={onConnectionBound}
      />
    </div>
  );
}
