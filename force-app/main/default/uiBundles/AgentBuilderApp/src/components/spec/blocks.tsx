import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared building blocks for the approved interface spec (Sep 2026).
 * Every rebuilt screen composes THESE instead of ad-hoc markup so the
 * fourteen screens read as one product. Numbers are always font-mono
 * (IBM Plex Mono, tabular figures — set globally).
 */

/** Top-of-page stat card: label, big mono value, one-line context, and an
 *  optional progress bar or sparkline slot. Three or four per row. */
export function StatCard({
  label,
  value,
  valueClass,
  sub,
  subClass,
  children,
}: {
  label: string;
  value: ReactNode;
  valueClass?: string;
  sub?: ReactNode;
  subClass?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3.5 py-3">
      <div className="text-[10.5px] font-semibold text-[var(--archon-faint)]">{label}</div>
      <div className={cn('mt-0.5 font-mono text-[24px] font-semibold leading-tight text-foreground', valueClass)}>
        {value}
      </div>
      {sub != null && <div className={cn('text-[10.5px] text-muted-foreground', subClass)}>{sub}</div>}
      {children}
    </div>
  );
}

/** Thin progress bar (spec: 5px, pill). Pass a token color. */
export function Bar({ pct, color, className }: { pct: number; color: string; className?: string }) {
  return (
    <div className={cn('mt-2 h-[5px] overflow-hidden rounded-full bg-[#edeef1]', className)}>
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
      />
    </div>
  );
}

/** White card with the standard 11px/14px header row. */
export function SpecCard({
  title,
  muted,
  right,
  children,
  className,
}: {
  title?: ReactNode;
  muted?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-border bg-card', className)}>
      {title != null && (
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
          <b className="text-[12.5px] text-foreground">{title}</b>
          {muted && <span className="text-[10.5px] text-[var(--archon-faint)]">{muted}</span>}
          {right && <div className="ml-auto flex items-center gap-1.5">{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/** Grey caption strip at the bottom of a card — the spec states each
 *  chart/table's finding in words here. `tone="error"` for red findings. */
export function NoteBar({ tone, children }: { tone?: 'error'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-b-lg border-t border-border px-3.5 py-2 text-[11.5px]',
        tone === 'error'
          ? 'bg-[var(--archon-error-tint)] text-[var(--archon-error)]'
          : 'bg-[#f7f8f9] text-muted-foreground'
      )}
    >
      {children}
    </div>
  );
}

export type BadgeTone = 'ok' | 'warn' | 'error' | 'muted' | 'blue' | 'purple';
const BADGE_TONES: Record<BadgeTone, string> = {
  ok: 'bg-[var(--archon-success-tint)] text-[var(--archon-success)]',
  warn: 'bg-[var(--archon-warning-tint)] text-[var(--archon-warning)]',
  error: 'bg-[var(--archon-error-tint)] text-[var(--archon-error)]',
  muted: 'bg-[var(--node-gray-tint)] text-[var(--node-gray)]',
  blue: 'bg-[var(--node-blue-tint)] text-[var(--node-blue)]',
  purple: 'bg-[var(--node-purple-tint)] text-[var(--node-purple)]',
};

/** Status pill (spec: 10px bold, tint background). */
export function StatusBadge({ tone, children, className }: { tone: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold', BADGE_TONES[tone], className)}>
      {children}
    </span>
  );
}

/** Tool-access chip: the three-tier risk model. */
export function AccessChip({ level }: { level: 'read' | 'write' | 'delete' }) {
  const meta = {
    read: ['Read only', 'bg-[var(--node-gray-tint)] text-muted-foreground'],
    write: ['Changes data', 'bg-[var(--archon-warning-tint)] text-[var(--archon-warning)]'],
    delete: ['Deletes data', 'bg-[var(--archon-error-tint)] text-[var(--archon-error)]'],
  }[level];
  return <span className={cn('inline-block rounded px-1.5 py-0.5 text-[10px] font-bold', meta[1])}>{meta[0]}</span>;
}

/** Small colored icon square (30px) used on list rows and cards. */
export function IconSquare({
  bg,
  color,
  children,
  size = 30,
}: {
  bg: string;
  color?: string;
  children: ReactNode;
  size?: number;
}) {
  return (
    <div
      className="grid shrink-0 place-items-center rounded-[7px]"
      style={{ background: bg, color: color ?? '#fff', width: size, height: size }}
    >
      {children}
    </div>
  );
}

/** Row for attention/queue lists: icon · title+sub · trailing extras. */
export function AttnRow({
  icon,
  title,
  sub,
  onClick,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  onClick?: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-[#eceef1] px-3.5 py-2.5 last:border-b-0',
        onClick && 'cursor-pointer hover:bg-[#f8fafc]'
      )}
      onClick={onClick}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-bold text-foreground">{title}</div>
        {sub != null && <div className="text-[11px] text-[var(--archon-faint)]">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

/** Standard table classes — use with plain <table>. */
export const T = {
  table: 'w-full border-collapse text-[12.5px]',
  th: 'bg-[#f7f8f9] border-b border-border px-3 py-2 text-left text-[10.5px] font-bold text-muted-foreground',
  td: 'border-b border-[#eceef1] px-3 py-2 align-middle',
  trClick: 'cursor-pointer hover:bg-[#f8fafc]',
};

/** Honest empty state — shown wherever the platform does not yet track the
 *  data a spec panel calls for. Never fabricate numbers. */
export function EmptyPanel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[12px] text-muted-foreground" style={style}>
      {children}
    </div>
  );
}
