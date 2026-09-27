/**
 * Phase 4 — model tiering. Classifies any model id into Fast / Balanced /
 * Best by name pattern (provider-agnostic, works on live-fetched lists),
 * so pickers can group options and clients choose latency vs quality
 * deliberately instead of by vibes.
 *
 * The platform guidance the tiers encode:
 *   FAST     — routing-heavy thin roots, extraction, high-volume simple
 *              replies. Lowest latency and cost.
 *   BALANCED — the default for customer-facing conversation.
 *   BEST     — deep multi-step reasoning where quality is worth latency.
 */
export type ModelTier = 'fast' | 'balanced' | 'best';

const FAST_RE = /mini|nano|lite|flash|haiku|small/i;
const BEST_RE = /opus|ultra|(^|[^a-z])o[134]([^a-z]|$)|gpt-5|-pro($|[^a-z])/i;

export function tierForModel(modelId: string): ModelTier {
  if (FAST_RE.test(modelId)) return 'fast';
  if (BEST_RE.test(modelId)) return 'best';
  return 'balanced';
}

export const TIER_ORDER: ModelTier[] = ['fast', 'balanced', 'best'];

export const TIER_META: Record<ModelTier, { label: string; hint: string; badgeClass: string }> = {
  fast: {
    label: 'Fast',
    hint: 'Lowest latency & cost — routing, extraction, high-volume simple replies',
    badgeClass: 'bg-[var(--archon-success-tint,var(--archon-success-tint))] text-[var(--archon-success,var(--archon-success))]',
  },
  balanced: {
    label: 'Balanced',
    hint: 'The default for customer-facing conversation',
    badgeClass: 'bg-[color-mix(in_oklab,var(--primary)_12%,transparent)] text-primary',
  },
  best: {
    label: 'Best',
    hint: 'Highest quality, slowest — deep multi-step reasoning',
    badgeClass: 'bg-[var(--node-purple-tint)] text-[var(--node-purple)]',
  },
};
