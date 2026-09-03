import { useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { AgentNode, GuardrailNodeConfig } from '@/types/agent';

export interface GuardrailFormProps {
  node: AgentNode;
  onConfigChange: (patch: Partial<GuardrailNodeConfig>) => void;
}

/** Guardrail node editor — one generic mechanism per node, configured with
 *  plain language and field names. The server enforces these in code
 *  (deterministic); nothing here becomes prompt text. Mechanisms marked
 *  "coming soon" are part of the design but not yet wired to an engine —
 *  they are not selectable, so the UI never promises unenforced protection. */
const MECHANISMS: Array<{ value: GuardrailNodeConfig['mechanism']; label: string; desc: string; soon?: boolean }> = [
  { value: 'replyRule', label: 'Reply rule', desc: 'Words or phrases that must never reach the customer — violations are rewritten or scrubbed.' },
  { value: 'numberLimit', label: 'Number limit (deal pricing)', desc: 'Computes the deal’s allowed prices from products and blocks any lower offer.' },
  { value: 'dataCapture', label: 'Data capture', desc: 'When the customer mentions something you care about, it’s extracted and saved automatically.' },
  { value: 'followUpAction', label: 'Follow-up action', desc: 'When the agent books a Task/Event, the system updates the record’s stage deterministically.' },
  { value: 'liveFacts', label: 'Live facts', desc: 'Inject real-time values from any query into the agent’s context.', soon: true },
  { value: 'customLogic', label: 'Custom logic (Apex/Flow)', desc: 'Run your own Apex class or Flow as a check or action.', soon: true },
];

function ChipListEditor({
  label,
  hint,
  values,
  placeholder,
  onChange,
}: {
  label: string;
  hint?: string;
  values: string[];
  placeholder: string;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const v = draft.trim();
    if (!v || values.includes(v)) { setDraft(''); return; }
    onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] font-bold">{label}</Label>
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
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
        }}
        onBlur={commit}
      />
      {hint && <p className="text-[10.5px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NumField({ label, value, fallback, onChange }: { label: string; value: number | undefined; fallback: number; onChange: (n: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] font-bold">{label}</Label>
      <Input
        type="number"
        min={0}
        max={90}
        value={value ?? fallback}
        className="h-8 text-xs"
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function GuardrailForm({ node, onConfigChange }: GuardrailFormProps) {
  const cfg = (node.config ?? {}) as GuardrailNodeConfig;
  const mech = MECHANISMS.find(m => m.value === cfg.mechanism);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">Mechanism</Label>
        <Select value={cfg.mechanism || undefined} onValueChange={v => onConfigChange({ mechanism: v as GuardrailNodeConfig['mechanism'] })}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="What should this guardrail enforce?" />
          </SelectTrigger>
          <SelectContent>
            {MECHANISMS.map(m => (
              <SelectItem key={m.value} value={m.value} disabled={m.soon} className="text-xs">
                {m.label}{m.soon ? ' — coming soon' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {mech && <p className="text-[10.5px] leading-snug text-muted-foreground">{mech.desc}</p>}
      </div>

      {cfg.mechanism === 'replyRule' && (
        <ChipListEditor
          label="Banned words & phrases"
          hint="Generic internal sales vocabulary (floor price, concession, …) is always filtered for customer-facing agents — this list adds your own terms on top."
          values={cfg.bannedWords ?? []}
          placeholder="Type a word, press Enter…"
          onChange={bannedWords => onConfigChange({ bannedWords })}
        />
      )}

      {cfg.mechanism === 'numberLimit' && (
        <>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-bold">Max discount % field (on Product)</Label>
            <Input
              value={cfg.maxDiscountField ?? ''}
              placeholder="e.g. MaxDiscountPercent__c"
              className="h-8 text-xs font-mono"
              onChange={e => onConfigChange({ maxDiscountField: e.target.value.trim() })}
            />
            <p className="text-[10.5px] leading-snug text-muted-foreground">
              A percent field on Product2. The server computes each deal&rsquo;s floor from its line items and injects the exact allowed prices — the agent never does discount math.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <NumField label="First offer % off" value={cfg.firstOfferPct} fallback={12} onChange={firstOfferPct => onConfigChange({ firstOfferPct })} />
            <NumField label="Default max %" value={cfg.defaultMaxPct} fallback={15} onChange={defaultMaxPct => onConfigChange({ defaultMaxPct })} />
          </div>
        </>
      )}

      {cfg.mechanism === 'dataCapture' && (
        <>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-bold">Listen for (plain language)</Label>
            <Textarea
              value={cfg.listenFor ?? ''}
              placeholder="e.g. The customer mentions a competing vendor, their price, or what their offer includes."
              className="min-h-[64px] text-xs"
              onChange={e => onConfigChange({ listenFor: e.target.value })}
            />
            <p className="text-[10.5px] leading-snug text-muted-foreground">
              A small model watches every customer message for this — saving never depends on the agent remembering.
            </p>
          </div>
          <ChipListEditor
            label="Extract"
            values={cfg.extract ?? []}
            placeholder="e.g. Vendor — press Enter…"
            onChange={extract => onConfigChange({ extract })}
          />
          <div className="space-y-1.5">
            <Label className="text-[11px] font-bold">Save to field (on the anchored record)</Label>
            <Input
              value={cfg.targetField ?? ''}
              placeholder="e.g. CompetitorIntel__c"
              className="h-8 text-xs font-mono"
              onChange={e => onConfigChange({ targetField: e.target.value.trim() })}
            />
          </div>
          <ChipListEditor
            label="Trigger keywords (optional)"
            hint="Only messages containing one of these run the extraction — keeps AI cost near zero. Leave empty to check every message."
            values={cfg.keywords ?? []}
            placeholder="e.g. vendor, price, offer…"
            onChange={keywords => onConfigChange({ keywords })}
          />
        </>
      )}

      {cfg.mechanism === 'followUpAction' && (
        <>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-bold">Stage field (on the anchored record)</Label>
            <Input
              value={cfg.stageField ?? ''}
              placeholder="e.g. StageName"
              className="h-8 text-xs font-mono"
              onChange={e => onConfigChange({ stageField: e.target.value.trim() })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold">From stage</Label>
              <Input
                value={cfg.fromStage ?? ''}
                placeholder="e.g. Closed Lost"
                className="h-8 text-xs"
                onChange={e => onConfigChange({ fromStage: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold">To stage</Label>
              <Input
                value={cfg.toStage ?? ''}
                placeholder="e.g. Negotiation/Review"
                className="h-8 text-xs"
                onChange={e => onConfigChange({ toStage: e.target.value })}
              />
            </div>
          </div>
          <p className="text-[10.5px] leading-snug text-muted-foreground">
            When a turn creates a follow-up Task or Event, the system moves a record still in &ldquo;From stage&rdquo; to &ldquo;To stage&rdquo; — even if the agent forgets.
          </p>
        </>
      )}
    </div>
  );
}
