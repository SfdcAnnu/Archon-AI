/**
 * Archon itself — the built-in agent behind the Home dock and the New agent
 * page. Both open the same conversation with the same component; only the
 * placement differs, so the name it answers to lives in one place.
 */
export const COPILOT = { apiName: 'archon_copilot', name: 'Archon' } as const;
