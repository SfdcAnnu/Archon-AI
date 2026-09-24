import { agentKindOf } from '@/lib/agent-kind';

/**
 * One small pill that says what kind of agent this is, wherever an agent
 * is named: the list, the builder's title bar, the chat picker, the info
 * popover. Same colours as the rest of the app's tokens; the icon carries
 * the meaning when the label is hidden.
 */
export function AgentKindBadge({ executeType, size = 'sm', showLabel = true, className = '' }: {
  executeType: string | null | undefined;
  size?: 'sm' | 'md';
  showLabel?: boolean;
  className?: string;
}) {
  const kind = agentKindOf(executeType);
  const tone = kind.key === 'communication' ? 'var(--primary)' : kind.key === 'automation' ? 'var(--archon-warning)' : 'var(--archon-success)';
  const pad = size === 'md' ? 'px-2.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-[10.5px]';
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full font-semibold ${pad} ${className}`}
      style={{ color: tone, backgroundColor: `color-mix(in srgb, ${tone} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${tone} 35%, transparent)` }}
      title={`${kind.label} — ${kind.blurb}`}
      aria-label={kind.label}
    >
      <kind.Icon className={size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3'} aria-hidden="true" />
      {showLabel && kind.short}
    </span>
  );
}
