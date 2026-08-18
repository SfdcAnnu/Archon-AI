import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import {
  listConnectionsForEngine,
  bindEngineConnectionToNode,
  type ConnectionSummary,
} from '@/lib/engine-connections-data';

const NODE_SUBTYPE_TO_ENGINE_TYPE: Record<string, string> = {
  claude: 'claude',
  gpt4: 'openai',
  gemini: 'gemini',
};

export interface AiEngineConnectionPickerProps {
  nodeId: string;
  nodeSubType: string;
  currentConnectionId: string | null | undefined;
  onBound: (connectionId: string | null) => void;
}

/** Binds an AiEngineConnection__c credential to this AI/root node — the
 *  same capability the old canvas's aiEngineConnectionPicker LWC gave,
 *  missing entirely from the React canvas until now (see this stage's
 *  plan note on the properties-panel gap). Deliberately a simple select,
 *  not the old LWC's full state-machine card UI — proportional to what's
 *  actually needed here (bind/unbind), full CRUD lives on the standalone
 *  AI Connections admin page. */
export function AiEngineConnectionPicker({ nodeId, nodeSubType, currentConnectionId, onBound }: AiEngineConnectionPickerProps) {
  const engineType = NODE_SUBTYPE_TO_ENGINE_TYPE[nodeSubType] ?? nodeSubType;
  const [options, setOptions] = useState<ConnectionSummary[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [binding, setBinding] = useState(false);

  // A freshly dropped/created node has a local placeholder id ("new_3")
  // until the next Save round-trip returns a real Salesforce Id —
  // bindToNode() would 400 against a fake id, so gate on that instead.
  const isSavedNode = !nodeId.startsWith('new_');

  useEffect(() => {
    setLoadState('loading');
    listConnectionsForEngine(engineType)
      .then(rows => {
        setOptions(rows);
        setLoadState('ready');
      })
      .catch(err => {
        console.error('Failed to load engine connections:', err);
        setLoadState('error');
      });
  }, [engineType]);

  const handleChange = useCallback(
    (value: string) => {
      const connectionId = value === '' ? null : value;
      setBinding(true);
      bindEngineConnectionToNode(nodeId, connectionId)
        .then(() => onBound(connectionId))
        .catch(err => console.error('Failed to bind engine connection:', err))
        .finally(() => setBinding(false));
    },
    [nodeId, onBound]
  );

  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] font-bold">AI connection</Label>
      {loadState === 'loading' && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      )}
      {loadState === 'error' && <p className="text-[11px] text-destructive">Couldn't load connections.</p>}
      {loadState === 'ready' && !isSavedNode && (
        <p className="text-[10.5px] text-muted-foreground">Save the agent first to bind a connection.</p>
      )}
      {loadState === 'ready' && isSavedNode && (
        <select
          className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[12px] disabled:opacity-50"
          value={currentConnectionId ?? ''}
          disabled={binding}
          onChange={e => handleChange(e.target.value)}
        >
          <option value="">Use default (org key)</option>
          {options.map(o => (
            <option key={o.id} value={o.id}>
              {o.label} {o.isMine ? '(Personal)' : o.isPublicShared ? '(Shared)' : ''}
              {o.isActive === false ? ' — inactive' : ''}
            </option>
          ))}
        </select>
      )}
      {loadState === 'ready' && isSavedNode && options.length === 0 && (
        <p className="text-[10.5px] text-muted-foreground">
          No connections configured for this provider yet — this agent uses the org's default key.
        </p>
      )}
    </div>
  );
}
