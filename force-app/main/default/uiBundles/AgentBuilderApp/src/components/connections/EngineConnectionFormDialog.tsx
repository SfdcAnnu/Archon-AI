import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  ENGINE_TYPES,
  fetchProviderModels,
  saveEngineConnection,
  type ConnectionSummary,
} from '@/lib/engine-connections-data';

export interface EngineConnectionFormDialogProps {
  open: boolean;
  defaultEngineType: string;
  editing: ConnectionSummary | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Shared add/edit modal for AiEngineConnection__c — used by the
 *  standalone AI Connections admin page. On edit, the API key field is
 *  left blank; Apex only overwrites ApiKey__c when a non-blank value is
 *  sent (same behavior as the old aiEngineConnectionForm LWC). */
export function EngineConnectionFormDialog({ open, defaultEngineType, editing, onClose, onSaved }: EngineConnectionFormDialogProps) {
  const [engineType, setEngineType] = useState(defaultEngineType);
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [ownershipType, setOwnershipType] = useState<'Personal' | 'Shared'>('Personal');
  const [isPublicShared, setIsPublicShared] = useState(false);
  const [isPreferred, setIsPreferred] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  // Live model list for the Default-model field: uses the key typed above
  // (works before anything is saved), or the saved record's key on edit.
  const canFetchModels = apiKey.trim().length > 9 || !!editing;
  const handleFetchModels = () => {
    setFetchingModels(true);
    setModelsError(null);
    fetchProviderModels(
      apiKey.trim()
        ? { engineType, apiKey: apiKey.trim(), endpoint: endpoint.trim() || undefined }
        : { recordId: editing!.id }
    )
      .then(list => setModels(list))
      .catch(err => setModelsError(err instanceof Error ? err.message : 'Could not fetch models.'))
      .finally(() => setFetchingModels(false));
  };

  useEffect(() => {
    if (!open) return;
    setError(null);
    setApiKey('');
    setModels([]);
    setModelsError(null);
    if (editing) {
      setEngineType(editing.engineType);
      setLabel(editing.label);
      setEndpoint(editing.endpoint ?? '');
      setDefaultModel(editing.defaultModel ?? '');
      setOwnershipType(editing.ownershipType);
      setIsPublicShared(editing.isPublicShared);
      setIsPreferred(editing.isPreferred);
    } else {
      setEngineType(defaultEngineType);
      setLabel('');
      setEndpoint('');
      setDefaultModel('');
      setOwnershipType('Personal');
      setIsPublicShared(false);
      setIsPreferred(false);
    }
  }, [open, editing, defaultEngineType]);

  const handleSave = () => {
    if (!label.trim() || !engineType) return;
    if (!editing && !apiKey.trim()) {
      setError('API key is required for new connections.');
      return;
    }
    setSaving(true);
    setError(null);
    saveEngineConnection({
      recordId: editing?.id ?? null,
      engineType,
      ownershipType,
      label: label.trim(),
      apiKey: apiKey.trim() || undefined,
      endpoint: endpoint.trim() || undefined,
      defaultModel: defaultModel.trim() || undefined,
      isPublicShared,
      isPreferred,
    })
      .then(() => {
        setSaving(false);
        onSaved();
        onClose();
      })
      .catch(err => {
        console.error('Failed to save connection:', err);
        setError(err instanceof Error ? err.message : 'Save failed.');
        setSaving(false);
      });
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit connection' : 'New AI connection'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Engine</Label>
            <select
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[12px]"
              value={engineType}
              onChange={e => setEngineType(e.target.value)}
              disabled={!!editing}
            >
              {ENGINE_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. My Anthropic key" />
          </div>
          <div className="space-y-1.5">
            <Label>API key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={editing ? 'Leave blank to keep existing' : ''}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Endpoint (optional)</Label>
              <Input value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="Custom endpoint" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Default model (optional)</Label>
                <button
                  type="button"
                  onClick={handleFetchModels}
                  disabled={!canFetchModels || fetchingModels}
                  title={canFetchModels ? 'Fetch the live model list from the provider' : 'Enter an API key first'}
                  className="flex items-center gap-1 text-[10.5px] font-semibold text-primary hover:underline disabled:opacity-40"
                >
                  {fetchingModels ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  {fetchingModels ? 'Fetching…' : models.length > 0 ? `${models.length} models` : 'Fetch models'}
                </button>
              </div>
              {models.length > 0 ? (
                <select
                  className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono text-[12px]"
                  value={defaultModel}
                  onChange={e => setDefaultModel(e.target.value)}
                >
                  <option value="">— pick a model —</option>
                  {models.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <Input value={defaultModel} onChange={e => setDefaultModel(e.target.value)} placeholder="or type a model id" />
              )}
            </div>
          </div>
          {modelsError && <p className="text-[10.5px] text-destructive">{modelsError}</p>}
          <div className="space-y-1.5">
            <Label>Ownership</Label>
            <select
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[12px]"
              value={ownershipType}
              onChange={e => setOwnershipType(e.target.value as 'Personal' | 'Shared')}
            >
              <option value="Personal">Personal (only me)</option>
              <option value="Shared">Shared</option>
            </select>
          </div>
          {ownershipType === 'Shared' && (
            <div className="flex items-center justify-between">
              <Label className="text-[12px] font-normal">Visible to everyone (public shared)</Label>
              <Switch checked={isPublicShared} onCheckedChange={setIsPublicShared} />
            </div>
          )}
          <div className="flex items-center justify-between">
            <Label className="text-[12px] font-normal">Preferred for this engine</Label>
            <Switch checked={isPreferred} onCheckedChange={setIsPreferred} />
          </div>
          {error && <p className="text-[11.5px] text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
