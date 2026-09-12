import { useEffect, useState } from 'react';
import {
  ENGINE_DEFAULT_MODELS,
  effectiveEnabledModels,
  listConnectionsForEngine,
} from './engine-connections-data';

/** Node subtypes name providers in canvas vocabulary ('gpt4'); connections
 *  store engine types in admin vocabulary ('openai'). Same mismatch
 *  AiEngineConnectionController.normalizeEngineType handles Apex-side. */
function engineTypeForSubtype(subType: string): string {
  return subType === 'gpt4' ? 'openai' : subType;
}

export interface EngineModels {
  /** What the picker offers. */
  models: string[];
  /** True when the node's saved model is no longer among the enabled ones —
   *  it is still offered (so opening a node never silently blanks its
   *  model) but the form warns about it. */
  currentIsDisabled: boolean;
  /** No active connection for this provider: the list is provider defaults
   *  rather than anything an admin actually enabled. */
  noConnection: boolean;
}

// One connection lookup per provider per ~2 minutes — pickers mount every
// time the inspector opens, and this is a plain Salesforce read.
const connCache = new Map<string, { models: string[]; noConnection: boolean; fetchedAt: number }>();
const CACHE_TTL_MS = 2 * 60 * 1000;

/** Drop the cache so a just-changed enabled set shows up immediately. */
export function invalidateEngineModelsCache(): void {
  connCache.clear();
}

/**
 * The models a canvas node may choose from — exactly the ones enabled for
 * that provider on the AI Models page, and nothing else.
 *
 * The provider's LIVE catalogue is deliberately not consulted here. It is
 * still what the AI Models page lists for an admin to enable ("Refresh
 * list"), but offering it on the canvas meant a builder could pick a model
 * the admin had never turned on — and made the page's own "models enabled"
 * count wrong about what the pickers showed.
 *
 * With several keys on one provider, the union of their enabled sets is
 * offered: any of them can serve the node at runtime.
 */
export function useEngineModels(nodeSubType: string, currentModel?: string): EngineModels {
  const engineType = engineTypeForSubtype(nodeSubType);
  const fallback = ENGINE_DEFAULT_MODELS[engineType] ?? [];
  const [state, setState] = useState<{ models: string[]; noConnection: boolean }>({
    models: fallback,
    noConnection: true,
  });

  useEffect(() => {
    let cancelled = false;
    const type = engineTypeForSubtype(nodeSubType);
    const defaults = ENGINE_DEFAULT_MODELS[type] ?? [];

    const cached = connCache.get(type);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setState({ models: cached.models, noConnection: cached.noConnection });
      return;
    }
    setState({ models: defaults, noConnection: true });

    listConnectionsForEngine(type)
      .then(conns => {
        if (cancelled) return;
        // Inactive keys cannot serve a turn, so what they enable is not
        // actually available to this node.
        const active = conns.filter(c => c.isActive);
        const union: string[] = [];
        for (const c of active) {
          for (const m of effectiveEnabledModels(c)) {
            if (!union.includes(m)) union.push(m);
          }
        }
        // No usable connection yet: offer the provider defaults so the
        // picker is never empty while an org is still being set up. The
        // node still fails at runtime with the existing clear message.
        const resolved = union.length > 0 ? union : defaults;
        const noConnection = union.length === 0;
        connCache.set(type, { models: resolved, noConnection, fetchedAt: Date.now() });
        setState({ models: resolved, noConnection });
      })
      .catch(() => {
        /* offline / no access — the provider defaults are already set */
      });

    return () => {
      cancelled = true;
    };
  }, [nodeSubType]);

  const saved = (currentModel ?? '').trim();
  const currentIsDisabled = saved.length > 0 && !state.models.includes(saved);
  return {
    // Keep a now-disabled saved model selectable. Dropping it would render
    // the select blank and quietly rewrite the node's model on next save.
    models: currentIsDisabled ? [...state.models, saved] : state.models,
    currentIsDisabled,
    noConnection: state.noConnection,
  };
}
