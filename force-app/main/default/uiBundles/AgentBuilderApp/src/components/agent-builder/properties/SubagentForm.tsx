import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEngineModels } from '@/lib/use-engine-models';
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
   *  ai node uses; subagents were the only model-running node without an
   *  editable provider until now. */
  onProviderChange: (nodeSubType: string) => void;
}

export function SubagentForm({ node, onConfigChange, onProviderChange }: SubagentFormProps) {
  const cfg = node.config as SubagentNodeConfig;
  const models = useEngineModels(node.nodeSubType);

  return (
    <div className="space-y-4">
      {/* Provider + model live at the TOP — they define what this subagent
          IS; the prompts below define what it does. */}
      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">AI Provider</Label>
        <Select
          value={node.nodeSubType}
          onValueChange={v => {
            if (v === node.nodeSubType) return;
            onProviderChange(v);
            // A model id only exists on its own provider — clearing lets
            // the runtime fall back to the new provider's default until a
            // model is picked below.
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

      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">Model</Label>
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
        <p className="text-[10px] leading-snug text-muted-foreground">
          The list comes from the enabled models on this provider's connection (AI Models page).
        </p>
      </div>

      <div className="rounded-lg border border-border bg-secondary/60 px-3 py-2.5 text-[11px] leading-relaxed text-foreground/80">
        <span className="font-semibold text-foreground">No separate credential needed.</span> A
        subagent runs its own model call using the org's active connection for its provider.
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">Routing condition</Label>
        <Textarea
          value={cfg?.routingDescription ?? ''}
          onChange={e => onConfigChange({ routingDescription: e.target.value })}
          placeholder="When should the root agent hand off to this subagent? e.g. &quot;Customer wants a discount beyond range.&quot;"
          className="min-h-16 text-xs"
        />
        <p className="text-[10.5px] leading-snug text-muted-foreground">
          The root model reads this alongside its other tools when deciding whether to hand off —
          write it like a tool description.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">System prompt</Label>
        <Textarea
          value={cfg?.systemPrompt ?? ''}
          onChange={e => onConfigChange({ systemPrompt: e.target.value })}
          placeholder="Instructions this subagent follows once it takes over the turn…"
          className="min-h-24 text-xs"
        />
      </div>
    </div>
  );
}
