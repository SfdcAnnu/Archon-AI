import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProviderModel } from '@/lib/engine-connections-data';

export interface ModelComboboxProps {
  models: ProviderModel[];
  /** Ids to mark with a check (already enabled / currently selected). */
  selectedIds?: string[];
  placeholder?: string;
  loading?: boolean;
  disabled?: boolean;
  /** Keep the list open after a pick (multi-add flows). */
  keepOpenOnSelect?: boolean;
  onSelect: (model: ProviderModel) => void;
}

/** Searchable model picker — a text filter over the provider's LIVE model
 *  list, each option showing the id plus its one-line description. Shared
 *  by the AI Models page (adding to a connection's enabled set) and the
 *  connection dialog (choosing the default model). Plain input+listbox
 *  rather than a nested Radix Select so typing-to-filter works naturally. */
export function ModelCombobox({
  models,
  selectedIds = [],
  placeholder = 'Search models…',
  loading = false,
  disabled = false,
  keepOpenOnSelect = false,
  onSelect,
}: ModelComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      m => m.id.toLowerCase().includes(q) || (m.description ?? '').toLowerCase().includes(q)
    );
  }, [models, query]);

  // Close on any click outside the component (standard combobox behavior).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <div
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-md border border-input bg-transparent px-2',
          disabled && 'opacity-50'
        )}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <input
          value={query}
          disabled={disabled}
          onChange={e => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={loading ? 'Fetching models from provider…' : placeholder}
          className="h-full w-full bg-transparent text-[12px] outline-none placeholder:text-muted-foreground"
        />
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </div>

      {open && !disabled && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-card shadow-lg">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2.5 text-[11.5px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Fetching the live model list…
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="px-3 py-2.5 text-[11.5px] text-muted-foreground">
              No models match “{query}”.
            </div>
          )}
          {!loading &&
            filtered.map(m => {
              const isSelected = selectedIds.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onSelect(m);
                    if (!keepOpenOnSelect) {
                      setOpen(false);
                      setQuery('');
                    }
                  }}
                  className={cn(
                    'flex w-full items-start gap-2 border-t border-border px-3 py-2 text-left first:border-t-0',
                    isSelected ? 'bg-accent/50' : 'hover:bg-secondary/60'
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center',
                      isSelected ? 'text-[var(--archon-success)]' : 'text-transparent'
                    )}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-mono text-[11.5px] font-semibold text-foreground">{m.id}</span>
                    {m.description && (
                      <span className="mt-0.5 block text-[10.5px] leading-snug text-muted-foreground">
                        {m.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
