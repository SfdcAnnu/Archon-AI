import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEngineModels } from '@/lib/use-engine-models';
import { AiEngineConnectionPicker } from './AiEngineConnectionPicker';
import type { AgentNode, AiNodeConfig } from '@/types/agent';

const PROVIDERS = [
  { value: 'claude', label: 'Claude (Anthropic)' },
  { value: 'gpt4', label: 'GPT-4 (OpenAI)' },
  { value: 'gemini', label: 'Gemini (Google)' },
];

export interface AiRootFormProps {
  node: AgentNode;
  onConfigChange: (patch: Partial<AiNodeConfig>) => void;
  onProviderChange: (nodeSubType: string) => void;
  onConnectionBound: (connectionId: string | null) => void;
}

/** The top-level 'ai' node's editable form — was entirely read-only until
 *  this stage (see ReadOnlySummary.tsx's own TODO comment: "Editable
 *  config for 'ai' nodes... wired up alongside the Step 2 data-layer
 *  work" — never followed up on until now). */
export function AiRootForm({ node, onConfigChange, onProviderChange, onConnectionBound }: AiRootFormProps) {
  const cfg = node.config as AiNodeConfig;
  const models = useEngineModels(node.nodeSubType);

  return (
    <div className="space-y-4">
      {/* Provider + model together at the top — they define WHAT runs;
          the prompt below defines what it does. */}
      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">AI Provider</Label>
        <Select
          value={node.nodeSubType}
          onValueChange={v => {
            if (v === node.nodeSubType) return;
            onProviderChange(v);
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

      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">System prompt</Label>
        <Textarea
          value={cfg?.systemPrompt ?? ''}
          onChange={e => onConfigChange({ systemPrompt: e.target.value })}
          placeholder="You are... Your job is to... Use tools to look up real data before answering."
          className="min-h-24 text-xs"
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
