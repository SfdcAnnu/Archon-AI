import { useState } from 'react';
import { Cable, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Database, ShieldCheck, Trash2, X, type LucideIcon } from 'lucide-react';
import type { ChecklistItem } from '@/types/agent';

export interface SetupChecklistPanelProps {
  items: ChecklistItem[];
  /** The list after a tick, an untick or a removal. It is part of the
   *  agent, so Save in the top bar keeps it. */
  onChange: (items: ChecklistItem[]) => void;
  onClose: () => void;
}

const CATEGORY_META: Record<ChecklistItem['category'], { label: string; icon: LucideIcon }> = {
  connector: { label: 'Connect a provider', icon: Cable },
  ai_engine: { label: 'AI engine setup', icon: ShieldCheck },
  review: { label: 'Review before going live', icon: CheckCircle2 },
  knowledge_base: { label: 'Knowledge base', icon: Database },
  other: { label: 'Other', icon: CircleHelp },
};

type Row = { item: ChecklistItem; index: number };

/** Surfaces AgentDefinition__c.SetupChecklistJson__c — mainly populated by
 *  the generator (server/src/agent-generator/generate.ts's setupChecklist
 *  output: providers to connect, things to review before activating).
 *
 *  What is outstanding is the list; what is done drops into a folded
 *  group underneath, where it can be unticked or removed for good. A tick
 *  is written onto the item itself, so it survives closing the panel and,
 *  once the agent is saved, is the same for everyone who opens it. */
export function SetupChecklistPanel({ items, onChange, onClose }: SetupChecklistPanelProps) {
  const [showDone, setShowDone] = useState(false);
  const rows: Row[] = items.map((item, index) => ({ item, index }));
  const open = rows.filter(r => !r.item.done);
  const done = rows.filter(r => r.item.done);

  const setDone = (index: number, value: boolean) => onChange(items.map((it, i) => (i === index ? { ...it, done: value } : it)));
  const remove = (index: number) => onChange(items.filter((_, i) => i !== index));
  const clearDone = () => onChange(items.filter(it => !it.done));

  const grouped = open.reduce<Partial<Record<ChecklistItem['category'], Row[]>>>((acc, row) => {
    (acc[row.item.category] ??= []).push(row);
    return acc;
  }, {});

  return (
    <>
      <div className="absolute inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 z-50 flex w-[400px] max-w-[92vw] flex-col border-l border-border bg-card shadow-2xl">
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
          <div className="min-w-0">
            <span className="text-[13.5px] font-bold text-foreground">Setup checklist</span>
            <span className="ml-2 text-[11px] text-muted-foreground">
              {done.length}/{items.length} done
            </span>
          </div>
          <div className="flex items-center gap-1">
            {done.length > 0 && (
              <button
                type="button"
                onClick={clearDone}
                className="rounded-md px-2 py-1 text-[11.5px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Remove every ticked item from the list"
              >
                Clear done
              </button>
            )}
            <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-muted" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing outstanding — no setup steps were flagged for this agent.</p>
          ) : (
            <div className="space-y-5">
              {open.length === 0 && (
                <div className="flex items-start gap-2.5 rounded-lg border border-[var(--archon-success)]/40 bg-[var(--archon-success)]/10 p-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--archon-success)]" />
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold text-foreground">Everything on this list is done.</div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground">Clear it to take the badge off the toolbar, or keep it here as a record.</div>
                    <button
                      type="button"
                      onClick={clearDone}
                      className="mt-2 rounded-md border border-border bg-card px-2.5 py-1 text-[11.5px] font-semibold text-foreground hover:bg-muted"
                    >
                      Clear the checklist
                    </button>
                  </div>
                </div>
              )}

              {(Object.keys(CATEGORY_META) as ChecklistItem['category'][]).map(cat => {
                const list = grouped[cat];
                if (!list || list.length === 0) return null;
                const meta = CATEGORY_META[cat];
                const Icon = meta.icon;
                return (
                  <div key={cat}>
                    <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" /> {meta.label}
                    </div>
                    <div className="space-y-2">
                      {list.map(({ item, index }) => (
                        <label
                          key={index}
                          className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-secondary/40 p-2.5 hover:bg-secondary/70"
                        >
                          <input type="checkbox" checked={false} onChange={() => setDone(index, true)} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-[12.5px] font-semibold text-foreground">{item.title}</div>
                            <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{item.description}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}

              {done.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowDone(v => !v)}
                    className="mb-2 flex w-full items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                    aria-expanded={showDone}
                  >
                    {showDone ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    Done · {done.length}
                  </button>
                  {showDone && (
                    <div className="space-y-2">
                      {done.map(({ item, index }) => (
                        <div key={index} className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary/20 p-2.5">
                          <input
                            type="checkbox"
                            checked
                            onChange={() => setDone(index, false)}
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                            aria-label={`Put “${item.title}” back on the list`}
                          />
                          <div className="min-w-0 flex-1 opacity-60">
                            <div className="text-[12.5px] font-semibold text-foreground line-through">{item.title}</div>
                            <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{item.description}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => remove(index)}
                            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="Remove from the list"
                            aria-label={`Remove “${item.title}” from the list`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        {items.length > 0 && (
          <div className="shrink-0 border-t border-border px-4 py-2 text-[10.5px] text-muted-foreground">
            Ticks and removals are kept when you save the agent.
          </div>
        )}
      </div>
    </>
  );
}
