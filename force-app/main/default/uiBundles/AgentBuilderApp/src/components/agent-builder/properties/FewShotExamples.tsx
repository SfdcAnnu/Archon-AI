import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Hint } from './controls';

import type { FewShotExample } from '@/types/agent';

/**
 * Worked examples for an agent or specialist.
 *
 * The reason this exists as a field rather than "just put them in the
 * instructions": examples do more for output SHAPE than any amount of
 * prose, and an author who cannot describe the format they want can almost
 * always show one. Keeping them structured means the runtime can label
 * them as illustrations rather than letting them blur into the rules, and
 * means a half-written pair is visibly half-written instead of silently
 * changing how the agent reads its own instructions.
 *
 * Per node on purpose: a specialist should demonstrate its own narrow job,
 * not inherit the lead agent's conversational style.
 */
export function FewShotExamples({
  value,
  onChange,
  subjectLabel = 'the agent',
}: {
  value: FewShotExample[] | undefined;
  onChange: (next: FewShotExample[]) => void;
  subjectLabel?: string;
}) {
  const examples = Array.isArray(value) ? value : [];

  const update = (i: number, patch: Partial<FewShotExample>) =>
    onChange(examples.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));

  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[10.5px] font-bold text-muted-foreground">Examples</span>
        <span className="text-[10.5px] text-[var(--archon-faint)]">optional</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-[11px]"
          onClick={() => onChange([...examples, { input: '', output: '' }])}
        >
          <Plus className="mr-1 h-3 w-3" /> Add example
        </Button>
      </div>

      {examples.length === 0 ? (
        <Hint>
          Show {subjectLabel} one or two good answers and it will copy the shape. Usually faster than
          describing the format in words.
        </Hint>
      ) : (
        <div className="flex flex-col gap-2.5">
          {examples.map((ex, i) => {
            // A pair with only one half written does nothing at runtime, so
            // say so here rather than letting it look active on the canvas.
            const incomplete = !ex.input.trim() || !ex.output.trim();
            return (
              <div key={i} className="rounded-lg border border-border bg-card p-2.5">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--archon-faint)]">
                    Example {i + 1}
                  </span>
                  {incomplete && (
                    <span className="text-[10px] text-[var(--archon-warning)]">
                      needs both halves to be used
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove example ${i + 1}`}
                    className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    onClick={() => onChange(examples.filter((_, idx) => idx !== i))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>

                <label className="mb-0.5 block text-[10px] font-bold text-muted-foreground">
                  Someone asks
                </label>
                <Textarea
                  value={ex.input}
                  onChange={e => update(i, { input: e.target.value })}
                  placeholder="How many open deals do I have?"
                  className="mb-2 min-h-12 text-[11.5px] leading-relaxed"
                />

                <label className="mb-0.5 block text-[10px] font-bold text-muted-foreground">
                  A good answer
                </label>
                <Textarea
                  value={ex.output}
                  onChange={e => update(i, { output: e.target.value })}
                  placeholder="You have 14 open opportunities worth $2.3M. Three close this month."
                  className="min-h-14 text-[11.5px] leading-relaxed"
                />
              </div>
            );
          })}
          <Hint>
            These are shown as illustrations of style, never as facts — the agent is told not to reuse
            their content as data.
          </Hint>
        </div>
      )}
    </div>
  );
}
