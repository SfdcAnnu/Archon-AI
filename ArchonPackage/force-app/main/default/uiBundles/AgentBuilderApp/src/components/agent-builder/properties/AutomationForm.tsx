import { useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { AgentNode, AutomationNodeConfig } from '@/types/agent';

export interface AutomationFormProps {
  node: AgentNode;
  onConfigChange: (patch: Partial<AutomationNodeConfig>) => void;
}

/** Automation node editor — "when X happens, the system does Y",
 *  deterministically, alongside the conversation. Enforced server-side;
 *  the agent cannot skip it and never has to remember it. */
const MECHANISMS: Array<{ value: AutomationNodeConfig['mechanism']; label: string; desc: string }> = [
  { value: 'dataCapture', label: 'Capture mentioned data', desc: 'When the customer mentions something you care about, it’s extracted and saved to a field automatically — even if the agent forgets.' },
  { value: 'followUpAction', label: 'Update stage after escalation', desc: 'When the agent books a follow-up Task or Event, the record’s stage is updated by the system.' },
];

function ChipListEditor({
  label, hint, values, placeholder, onChange,
}: {
  label: string; hint?: string; values: string[]; placeholder: string; onChange: (next: string[]) => void;
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
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); } }}
        onBlur={commit}
      />
      {hint && <p className="text-[10.5px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function AutomationForm({ node, onConfigChange }: AutomationFormProps) {
  const cfg = (node.config ?? {}) as AutomationNodeConfig;
  const mech = MECHANISMS.find(m => m.value === cfg.mechanism);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-[11px] font-bold">What should the system do?</Label>
        <Select value={cfg.mechanism || undefined} onValueChange={v => onConfigChange({ mechanism: v as AutomationNodeConfig['mechanism'] })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick an automation…" /></SelectTrigger>
          <SelectContent>
            {MECHANISMS.map(m => (
              <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {mech && <p className="text-[10.5px] leading-snug text-muted-foreground">{mech.desc}</p>}
      </div>

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
              <Input value={cfg.fromStage ?? ''} placeholder="e.g. Closed Lost" className="h-8 text-xs"
                onChange={e => onConfigChange({ fromStage: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold">To stage</Label>
              <Input value={cfg.toStage ?? ''} placeholder="e.g. Negotiation/Review" className="h-8 text-xs"
                onChange={e => onConfigChange({ toStage: e.target.value })} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
