import { Sparkles } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { MODEL_OPTIONS } from '@/data/node-catalog';
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
  const models = MODEL_OPTIONS[node.nodeSubType] ?? MODEL_OPTIONS.claude;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">Provider</Label>
        <select
          className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[12px]"
          value={node.nodeSubType}
          onChange={e => onProviderChange(e.target.value)}
        >
          {PROVIDERS.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
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

      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">Model</Label>
        <div className="flex flex-col gap-1.5">
          {models.map(m => {
            const selected = m === cfg?.model;
            return (
              <button
                key={m}
                type="button"
                onClick={() => onConfigChange({ model: m })}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                  selected ? 'border-primary bg-accent' : 'border-border hover:bg-secondary'
                )}
              >
                <span
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 rounded-full border-2',
                    selected ? 'border-[4px] border-primary' : 'border-border'
                  )}
                />
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-accent text-primary">
                  <Sparkles className="h-3 w-3" />
                </span>
                <span className="text-xs font-semibold text-foreground">{m}</span>
              </button>
            );
          })}
        </div>
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
