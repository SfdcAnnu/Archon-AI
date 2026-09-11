import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Shared controls for the approved inspector design (builder right panel).
 *  Field label · pill-segmented choice · muted hint line. */

export function FieldLabel({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline gap-2 text-[10.5px] font-bold text-muted-foreground">
      {children}
      {meta != null && <span className="font-mono text-[10px] font-normal text-[var(--archon-faint)]">{meta}</span>}
    </div>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-[10.5px] leading-relaxed text-[var(--archon-faint)]">{children}</p>;
}

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
}

/** The mock's pill group — one always-on choice among 2-3 options. */
export function Segmented<V extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: V;
  options: Array<SegmentedOption<V>>;
  onChange: (v: V) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full border px-3 py-[5px] text-[11px] font-semibold transition-colors',
            o.value === value
              ? 'border-[#9ecdf0] bg-[var(--node-blue-tint)] text-primary'
              : 'border-border bg-card text-muted-foreground hover:bg-secondary/60',
            disabled && 'cursor-not-allowed opacity-50'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
