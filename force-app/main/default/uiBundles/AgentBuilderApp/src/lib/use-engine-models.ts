import { useEffect, useState } from 'react';
import { MODEL_OPTIONS } from '@/data/node-catalog';
import { listConnectionsForEngine, parseEnabledModels } from './engine-connections-data';

/** Node subtypes name providers in canvas vocabulary ('gpt4'); connections
 *  store engine types in admin vocabulary ('openai'). Same mismatch
 *  AiEngineConnectionController.normalizeEngineType handles Apex-side. */
function engineTypeForSubtype(subType: string): string {
  return subType === 'gpt4' ? 'openai' : subType;
}

/** Model list for a canvas node's provider — the connection's enabled-models
 *  catalog (managed on the AI Models page) when one exists, else the built-in
 *  defaults. Keeps model pickers current without an app redeploy: enable a
 *  newly released model on the connection and it appears here. */
export function useEngineModels(nodeSubType: string): string[] {
  const fallback = MODEL_OPTIONS[nodeSubType] ?? MODEL_OPTIONS.claude;
  const [models, setModels] = useState<string[]>(fallback);

  useEffect(() => {
    let cancelled = false;
    setModels(MODEL_OPTIONS[nodeSubType] ?? MODEL_OPTIONS.claude);
    listConnectionsForEngine(engineTypeForSubtype(nodeSubType))
      .then(conns => {
        if (cancelled) return;
        // Same precedence as runtime resolution: preferred first, then any active.
        const best = conns.find(c => c.isActive && c.isPreferred) ?? conns.find(c => c.isActive);
        const enabled = parseEnabledModels(best);
        if (enabled && enabled.length > 0) setModels(enabled);
      })
      .catch(() => {
        /* offline/unauthorized → fallback list already set */
      });
    return () => {
      cancelled = true;
    };
  }, [nodeSubType]);

  return models;
}
