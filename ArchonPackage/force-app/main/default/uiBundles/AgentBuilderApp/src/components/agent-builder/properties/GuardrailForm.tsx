import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AgentNode, GuardrailNodeConfig, GuardrailRule } from '@/types/agent';

export interface GuardrailFormProps {
  node: AgentNode;
  onConfigChange: (patch: Partial<GuardrailNodeConfig>) => void;
}

const RULE_KINDS: Array<{ value: GuardrailRule['kind']; label: string; desc: string }> = [
  { value: 'bannedWords', label: 'Banned words', desc: 'Words or phrases that must never reach the customer — violations are rewritten or scrubbed before sending.' },
  { value: 'numberLimit', label: 'Price limit', desc: 'The deal’s allowed prices are computed from your products; a lower offer can never go out.' },
];

function ChipInput({ values, placeholder, onChange }: { values: string[]; placeholder: string; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const v = draft.trim();
    if (!v || values.includes(v)) { setDraft(''); return; }
    onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px]">
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter(x => x !== v))}>
              <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
            </button>
          </span>
        ))}
      </div>
      <Input
        value={draft}
        placeholder={placeholder}
        className="h-8 text-xs"
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); } }}
        onBlur={commit}
      />
    </div>
  );
}

/** The single Guardrails node's editor: a LIST of restriction rules
 *  ("must never / only this"). Enforced by the server in code — none of
 *  this becomes prompt text. Data work (capture, stage updates) lives on
 *  Automation nodes instead, deliberately not here. */
export function GuardrailForm({ node, onConfigChange }: GuardrailFormProps) {
  const rules = ((node.config ?? {}) as GuardrailNodeConfig).rules ?? [];
  const setRules = (next: GuardrailRule[]) => onConfigChange({ rules: next });
  const patchRule = (i: number, patch: Partial<GuardrailRule>) =>
    setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-3.5">
      <p className="text-[10.5px] leading-snug text-muted-foreground">
        Lines of control for this agent — what its replies must never contain and which numbers it may never cross. Generic internal sales vocabulary is always filtered for customer-facing agents; rules here add this agent&rsquo;s own limits.
      </p>

      {rules.map((rule, i) => {
        const kindMeta = RULE_KINDS.find(k => k.value === rule.kind);
        return (
          <div key={i} className="space-y-2.5 rounded-lg border border-border p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold">{kindMeta?.label ?? rule.kind}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setRules(rules.filter((_, j) => j !== i))}
                aria-label="Remove rule"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            {kindMeta && <p className="text-[10.5px] leading-snug text-muted-foreground">{kindMeta.desc}</p>}

            {rule.kind === 'bannedWords' && (
              <ChipInput
                values={rule.bannedWords ?? []}
                placeholder="Type a word, press Enter…"
                onChange={bannedWords => patchRule(i, { bannedWords })}
              />
            )}

            {rule.kind === 'numberLimit' && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-bold">Max discount % field (on Product)</Label>
                  <Input
                    value={rule.maxDiscountField ?? ''}
                    placeholder="e.g. MaxDiscountPercent__c"
                    className="h-8 text-xs font-mono"
                    onChange={e => patchRule(i, { maxDiscountField: e.target.value.trim() })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-bold">First offer % off</Label>
                    <Input type="number" min={0} max={90} value={rule.firstOfferPct ?? 12} className="h-8 text-xs"
                      onChange={e => patchRule(i, { firstOfferPct: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-bold">Default max %</Label>
                    <Input type="number" min={0} max={90} value={rule.defaultMaxPct ?? 15} className="h-8 text-xs"
                      onChange={e => patchRule(i, { defaultMaxPct: Number(e.target.value) })} />
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })}

      <AddRuleButton existing={rules} onAdd={rule => setRules([...rules, rule])} />
    </div>
  );
}

function AddRuleButton({ existing, onAdd }: { existing: GuardrailRule[]; onAdd: (r: GuardrailRule) => void }) {
  const [picking, setPicking] = useState(false);
  if (!picking) {
    return (
      <Button variant="outline" size="sm" className="h-8 w-full gap-1.5 text-xs" onClick={() => setPicking(true)}>
        <Plus className="h-3.5 w-3.5" /> Add rule
      </Button>
    );
  }
  return (
    <Select
      open
      onOpenChange={open => { if (!open) setPicking(false); }}
      onValueChange={v => {
        setPicking(false);
        const kind = v as GuardrailRule['kind'];
        onAdd(kind === 'bannedWords' ? { kind, bannedWords: [] } : { kind, firstOfferPct: 12, defaultMaxPct: 15 });
      }}
    >
      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Which kind of rule?" /></SelectTrigger>
      <SelectContent>
        {RULE_KINDS.map(k => (
          <SelectItem key={k.value} value={k.value} className="text-xs" disabled={k.value === 'numberLimit' && existing.some(r => r.kind === 'numberLimit')}>
            {k.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
