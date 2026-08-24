import { Sparkles } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useEngineModels } from '@/lib/use-engine-models';
import type { AgentNode, SubagentNodeConfig } from '@/types/agent';

export interface SubagentFormProps {
  node: AgentNode;
  onConfigChange: (patch: Partial<SubagentNodeConfig>) => void;
}

export function SubagentForm({ node, onConfigChange }: SubagentFormProps) {
  const cfg = node.config as SubagentNodeConfig;
  const models = useEngineModels(node.nodeSubType);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-secondary/60 px-3 py-2.5 text-[11px] leading-relaxed text-foreground/80">
        <span className="font-semibold text-foreground">No separate credential needed.</span> A
        subagent runs its own model call using the root agent&rsquo;s connection.
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
    </div>
  );
}
