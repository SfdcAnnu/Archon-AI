import type { CSSProperties } from 'react';

/** Shared style fragments for the custom React Flow node renderers — kept
 *  in one place so the "selected" / border / shadow treatment stays
 *  consistent across node kinds, matching the approved canvas mockup. */
export const NODE_CARD_BASE =
  'rounded-[var(--radius)] bg-card border shadow-[0_1px_2px_rgba(16,18,30,.07),0_4px_10px_rgba(16,18,30,.05)] ' +
  'transition-[box-shadow,transform] hover:shadow-[0_2px_6px_rgba(16,18,30,.10),0_12px_26px_rgba(16,18,30,.10)] ' +
  'hover:-translate-y-px cursor-pointer select-none';

export function selectedRing(selected: boolean | undefined) {
  return selected ? 'border-primary ring-4 ring-primary/15' : 'border-border';
}

export const HANDLE_BASE =
  '!w-2.5 !h-2.5 !rounded-full !border-2 !border-primary !bg-card';

export const TOOL_HANDLE =
  '!w-2.5 !h-2.5 !rounded-sm !rotate-45 !border-2 !border-primary !bg-card';

/** Compact rounded-square icon chip — the reference's node style uses a
 *  small colored square (not a circle) as the type/provider indicator,
 *  denser than the earlier circular-badge treatment. */
export const NODE_ICON_SQUARE = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px]';

export type NodeAccent = 'blue' | 'purple' | 'amber' | 'green' | 'gray';

const ACCENT_VARS: Record<NodeAccent, { bg: string; fg: string }> = {
  blue: { bg: 'var(--node-blue-tint)', fg: 'var(--node-blue)' },
  purple: { bg: 'var(--node-purple-tint)', fg: 'var(--node-purple)' },
  amber: { bg: 'var(--node-amber-tint)', fg: 'var(--node-amber)' },
  green: { bg: 'var(--node-green-tint)', fg: 'var(--node-green)' },
  gray: { bg: 'var(--node-gray-tint)', fg: 'var(--node-gray)' },
};

export function accentStyle(accent: NodeAccent): CSSProperties {
  const v = ACCENT_VARS[accent];
  return { backgroundColor: v.bg, color: v.fg };
}

/** Same left-strip treatment as typeStripStyle, but keyed off an existing
 *  NodeAccent directly — used by SimpleNode, which already computes a
 *  per-step-kind accent (trigger/logic/action/...) and just needs it on
 *  the border-left instead of a second kind taxonomy. */
export function accentStripStyle(accent: NodeAccent): CSSProperties {
  return { borderLeftWidth: 4, borderLeftColor: ACCENT_VARS[accent].fg };
}

/** Provider -> accent, so a Claude subagent and a Claude root node read as
 *  the same "kind of thing" at a glance, same idea as the reference's
 *  category-consistent icon coloring (blue trigger, purple logic, ...). */
export function providerAccent(nodeSubType: string): NodeAccent {
  if (nodeSubType === 'claude') return 'purple';
  if (nodeSubType === 'gpt4') return 'green';
  if (nodeSubType === 'gemini') return 'blue';
  return 'gray';
}

/** Left-edge color strip = structural ROLE in the graph (independent of the
 *  icon chip's own provider/action-type accent) — lets "what kind of node
 *  is this" read at a glance across a dense canvas without relying on
 *  border color, which used to be forced blue on every unselected ai/
 *  subagent node and made selection invisible. Selection now owns
 *  border-color exclusively (see selectedRing); this owns border-LEFT only. */
export type NodeKind = 'ai' | 'catalog' | 'tool';

const KIND_STRIP_COLOR: Record<NodeKind, string> = {
  ai: 'var(--node-blue)',
  catalog: 'var(--node-green)',
  tool: 'var(--node-purple)',
};

export function typeStripStyle(kind: NodeKind): CSSProperties {
  return { borderLeftWidth: 4, borderLeftColor: KIND_STRIP_COLOR[kind] };
}
