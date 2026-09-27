import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
  type ProviderModel,
} from '@/lib/engine-connections-data';
import { ModelCombobox } from './ModelCombobox';

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
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  // Live model list for the Default-model picker — fetched AUTOMATICALLY:
  // on edit-open using the saved record's key, and while adding, shortly
  // after the user finishes typing an API key (debounced so we don't hit
  // the provider on every keystroke of the paste-in).
  useEffect(() => {
    if (!open) return;
    const key = apiKey.trim();
    if (key.length < 10 && !editing) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setFetchingModels(true);
      setModelsError(null);
      fetchProviderModels(
        key.length >= 10
          ? { engineType, apiKey: key, endpoint: endpoint.trim() || undefined }
          : { recordId: editing!.id }
      )
        .then(list => !cancelled && setModels(list))
        .catch(err => !cancelled && setModelsError(err instanceof Error ? err.message : 'Could not fetch models.'))
        .finally(() => !cancelled && setFetchingModels(false));
    }, key.length >= 10 ? 800 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, editing, engineType, apiKey, endpoint]);

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
              <div className="flex items-center justify-between gap-2">
                <Label>Default model (optional)</Label>
                {defaultModel && (
                  <code className="truncate font-mono text-[10px] text-[var(--archon-success)]">{defaultModel}</code>
                )}
              </div>
              {models.length > 0 || fetchingModels ? (
                <ModelCombobox
                  models={models}
                  selectedIds={defaultModel ? [defaultModel] : []}
                  loading={fetchingModels}
                  placeholder={defaultModel || 'Search models…'}
                  onSelect={m => setDefaultModel(m.id)}
                />
              ) : (
                <Input
                  value={defaultModel}
                  onChange={e => setDefaultModel(e.target.value)}
                  placeholder="Enter an API key above to load the list"
                />
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
