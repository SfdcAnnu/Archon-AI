import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { rewritePrompt, type RewriteResult } from '@/lib/architect-data';

/**
 * The ✦ on an instructions box. Write the instruction however you like —
 * rough notes, another language — and Archon rewrites it as a proper
 * prompt FOR THE MODEL THIS NODE RUNS ON: a reasoning model gets a short
 * goal-shaped instruction with no "think step by step"; a gpt-4-class
 * model gets structure; Claude gets prose and a clear role.
 *
 * Nothing is replaced until you accept it — your original stays on screen
 * next to the suggestion.
 */
export interface PromptAssistProps {
  draft: string;
  role: 'agent' | 'subagent' | 'tool';
  modelId: string;
  agentName?: string;
  department?: string;
  toolNames?: string[];
  onAccept: (text: string) => void;
}

export function PromptAssist({ draft, role, modelId, agentName, department, toolNames, onAccept }: PromptAssistProps) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RewriteResult | null>(null);

  const run = () => {
    if (!draft.trim()) {
      toast.info('Write something first', {
        description: 'Even rough notes in your own words are enough — I rewrite from what you give me.',
      });
      return;
    }
    setBusy(true);
    rewritePrompt({ draft, role, modelId, agentName, department, toolNames })
      .then(setResult)
      .catch(err =>
        toast.error("Couldn't rewrite that", { description: err instanceof Error ? err.message : undefined }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        title={modelId ? `Rewrite this for ${modelId}` : 'Rewrite this as a proper prompt'}
        className={cn(
          'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold text-primary transition-colors hover:bg-[var(--node-blue-tint)]',
          busy && 'opacity-60',
        )}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        {busy ? 'Rewriting…' : 'Improve'}
      </button>

      {result && (
        <div className="mt-2 rounded-lg border border-primary/40 bg-[var(--node-blue-tint)]/40 p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-primary" />
            <span className="text-[11px] font-bold text-primary">
              Rewritten{modelId ? ` for ${modelId}` : ''}
            </span>
          </div>
          <div className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-card p-2 font-mono text-[11px] leading-relaxed">
            {result.instructions}
          </div>
          {result.changed.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[10.5px] leading-snug text-muted-foreground">
              {result.changed.map((c, i) => (
                <li key={i}>· {c}</li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex gap-1.5">
            <Button
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => {
                onAccept(result.instructions);
                setResult(null);
              }}
            >
              Use this
            </Button>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setResult(null)}>
              Keep mine
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
