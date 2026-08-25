import { useEffect, useState } from 'react';
import { MODEL_OPTIONS } from '@/data/node-catalog';
import { fetchProviderModels, listConnectionsForEngine, parseEnabledModels } from './engine-connections-data';

/** Node subtypes name providers in canvas vocabulary ('gpt4'); connections
 *  store engine types in admin vocabulary ('openai'). Same mismatch
 *  AiEngineConnectionController.normalizeEngineType handles Apex-side. */
function engineTypeForSubtype(subType: string): string {
  return subType === 'gpt4' ? 'openai' : subType;
}

// Live-list cache per engine type — model pickers open constantly while
// editing a graph; one provider fetch per ~10 minutes is plenty fresh.
const liveCache = new Map<string, { models: string[]; fetchedAt: number }>();
const LIVE_TTL_MS = 10 * 60 * 1000;

/**
 * Model list for a canvas node's provider, in strict preference order:
 *   1. The models EXPLICITLY enabled on the connection (AI Models page) —
 *      the admin's curated list always wins.
 *   2. The provider's LIVE model list, fetched via the connection's key —
 *      so with no curation saved, pickers still show real current models,
 *      never a hardcoded snapshot.
 *   3. The built-in list — only when the provider is unreachable or no
 *      active connection exists (offline last resort).
 */
export function useEngineModels(nodeSubType: string): string[] {
  const fallback = MODEL_OPTIONS[nodeSubType] ?? MODEL_OPTIONS.claude;
  const [models, setModels] = useState<string[]>(fallback);

  useEffect(() => {
    let cancelled = false;
    const engineType = engineTypeForSubtype(nodeSubType);
    setModels(MODEL_OPTIONS[nodeSubType] ?? MODEL_OPTIONS.claude);

    listConnectionsForEngine(engineType)
      .then(async conns => {
        if (cancelled) return;
        const best = conns.find(c => c.isActive && c.isPreferred) ?? conns.find(c => c.isActive);
        if (!best) return; // no active connection — keep offline fallback

        const enabled = parseEnabledModels(best);
        if (enabled && enabled.length > 0) {
          setModels(enabled);
          return;
        }

        const cached = liveCache.get(engineType);
        if (cached && Date.now() - cached.fetchedAt < LIVE_TTL_MS) {
          setModels(cached.models);
          return;
        }
        const live = await fetchProviderModels({ recordId: best.id });
        if (cancelled || live.length === 0) return;
        const ids = live.map(m => m.id);
        liveCache.set(engineType, { models: ids, fetchedAt: Date.now() });
        setModels(ids);
      })
      .catch(() => {
        /* provider/offline failure → the built-in fallback already set */
      });

    return () => {
      cancelled = true;
    };
  }, [nodeSubType]);

  return models;
}
