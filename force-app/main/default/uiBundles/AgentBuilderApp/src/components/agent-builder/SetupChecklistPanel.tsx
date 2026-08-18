import { useState } from 'react';
import { Cable, CheckCircle2, CircleHelp, Database, ShieldCheck, X, type LucideIcon } from 'lucide-react';
import type { ChecklistItem } from '@/types/agent';

export interface SetupChecklistPanelProps {
  items: ChecklistItem[];
  onClose: () => void;
}

const CATEGORY_META: Record<ChecklistItem['category'], { label: string; icon: LucideIcon }> = {
  connector: { label: 'Connect a provider', icon: Cable },
  ai_engine: { label: 'AI engine setup', icon: ShieldCheck },
  review: { label: 'Review before going live', icon: CheckCircle2 },
  knowledge_base: { label: 'Knowledge base', icon: Database },
  other: { label: 'Other', icon: CircleHelp },
};

/** Surfaces AgentDefinition__c.SetupChecklistJson__c — mainly populated by
 *  the generator (server/src/agent-generator/generate.ts's setupChecklist
 *  output: providers to connect, things to review before activating). The
 *  "done" checkbox is local-only UI state (nothing to persist server-side
 *  for it — this is a working list for the person setting the agent up,
 *  not a tracked field), reset each time the panel remounts. */
export function SetupChecklistPanel({ items, onClose }: SetupChecklistPanelProps) {
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const toggle = (i: number) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const grouped = items.reduce<Partial<Record<ChecklistItem['category'], Array<{ item: ChecklistItem; index: number }>>>>(
    (acc, item, index) => {
      (acc[item.category] ??= []).push({ item, index });
      return acc;
    },
    {}
  );

  return (
    <>
      <div className="absolute inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 z-50 flex w-[400px] max-w-[92vw] flex-col border-l border-border bg-card shadow-2xl">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <div>
            <span className="text-[13.5px] font-bold text-foreground">Setup checklist</span>
            <span className="ml-2 text-[11px] text-muted-foreground">
              {checked.size}/{items.length} done
            </span>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing outstanding — no setup steps were flagged for this agent.</p>
          ) : (
            <div className="space-y-5">
              {(Object.keys(CATEGORY_META) as ChecklistItem['category'][]).map(cat => {
                const rows = grouped[cat];
                if (!rows || rows.length === 0) return null;
                const meta = CATEGORY_META[cat];
                const Icon = meta.icon;
                return (
                  <div key={cat}>
                    <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" /> {meta.label}
                    </div>
                    <div className="space-y-2">
                      {rows.map(({ item, index }) => (
                        <label
                          key={index}
                          className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-secondary/40 p-2.5 hover:bg-secondary/70"
                        >
                          <input
                            type="checkbox"
                            checked={checked.has(index)}
                            onChange={() => toggle(index)}
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                          />
                          <div className={checked.has(index) ? 'opacity-50' : ''}>
                            <div className="text-[12.5px] font-semibold text-foreground line-through-none">
                              {item.title}
                            </div>
                            <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                              {item.description}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
