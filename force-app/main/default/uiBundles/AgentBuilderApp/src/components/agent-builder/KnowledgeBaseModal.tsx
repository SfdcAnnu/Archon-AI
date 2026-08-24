import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  loadStorageConfig,
  saveStorageConfig,
  testKbConnection,
  loadDocuments,
  uploadDocument,
  reindexDocument,
  deleteDocument,
  type StorageConfig,
  type KbDocument,
} from '@/lib/kb-data';

export interface KnowledgeBaseModalProps {
  agentApiName: string;
  notesValue: string;
  onNotesChange: (value: string) => void;
  onClose: () => void;
}

function statusBadgeStyle(status: string) {
  if (status === 'Ready') return { backgroundColor: 'var(--archon-success-tint)', color: 'var(--archon-success)' };
  if (status === 'Error') return { backgroundColor: 'var(--archon-danger-tint, #fde8e8)', color: 'var(--archon-danger, #dc2626)' };
  return { backgroundColor: 'var(--archon-warning-tint, #fef3e0)', color: 'var(--archon-warning, #b45309)' };
}

const BACKEND_OPTIONS = [
  { value: 'archon', label: 'Archon-managed (default)' },
  { value: 'external_pg', label: 'Your own Postgres (pgvector)' },
  { value: 'salesforce', label: 'Salesforce-native storage' },
];

export function KnowledgeBaseModal({ agentApiName, notesValue, onNotesChange, onClose }: KnowledgeBaseModalProps) {
  const [tab, setTab] = useState<'notes' | 'documents'>('notes');

  const [config, setConfig] = useState<StorageConfig | null>(null);
  const [configLoadState, setConfigLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [backendDraft, setBackendDraft] = useState('archon');
  const [connUrlDraft, setConnUrlDraft] = useState('');
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [configSaving, setConfigSaving] = useState(false);

  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [docsLoadState, setDocsLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [newTitle, setNewTitle] = useState('');
  const [newText, setNewText] = useState('');
  const [newFile, setNewFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadStorageConfig()
      .then(cfg => {
        setConfig(cfg);
        setBackendDraft(cfg.backend ?? 'archon');
        setConfigLoadState('ready');
      })
      .catch(err => {
        console.error('Failed to load KB storage config:', err);
        setConfigLoadState('error');
      });
  }, []);

  const loadDocs = useCallback(() => {
    setDocsLoadState('loading');
    loadDocuments(agentApiName)
      .then(list => {
        setDocs(list);
        setDocsLoadState('ready');
      })
      .catch(err => {
        console.error('Failed to load KB documents:', err);
        setDocsLoadState('error');
      });
  }, [agentApiName]);

  useEffect(() => {
    if (tab === 'documents') loadDocs();
  }, [tab, loadDocs]);

  const handleTestConnection = useCallback(() => {
    setTestState('testing');
    testKbConnection(connUrlDraft)
      .then(() => setTestState('ok'))
      .catch(err => {
        console.error('KB connection test failed:', err);
        setTestState('error');
      });
  }, [connUrlDraft]);

  const handleSaveConfig = useCallback(() => {
    setConfigSaving(true);
    saveStorageConfig(backendDraft, connUrlDraft || undefined)
      .then(cfg => {
        setConfig(cfg);
        setConfigSaving(false);
      })
      .catch(err => {
        console.error('Failed to save KB storage config:', err);
        setConfigSaving(false);
      });
  }, [backendDraft, connUrlDraft]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setNewFile(file);
    if (file && !newTitle) setNewTitle(file.name.replace(/\.[^.]+$/, ''));
  }, [newTitle]);

  const canUpload = newTitle.trim().length > 0 && (newText.trim().length > 0 || newFile != null);

  const handleUpload = useCallback(() => {
    if (!canUpload) return;
    setUploading(true);
    const finish = (fileBase64?: string) => {
      uploadDocument({
        agentApiName,
        title: newTitle.trim(),
        text: newFile ? undefined : newText,
        fileBase64,
        fileName: newFile?.name,
      })
        .then(() => {
          setNewTitle('');
          setNewText('');
          setNewFile(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
          setUploading(false);
          loadDocs();
        })
        .catch(err => {
          console.error('Upload failed:', err);
          setUploading(false);
        });
    };
    if (newFile) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        finish(dataUrl.split(',')[1]);
      };
      reader.readAsDataURL(newFile);
    } else {
      finish();
    }
  }, [canUpload, agentApiName, newTitle, newText, newFile, loadDocs]);

  const handleReindex = useCallback(
    (docId: string) => {
      setBusyDocId(docId);
      reindexDocument(docId)
        .then(() => loadDocs())
        .catch(err => console.error('Reindex failed:', err))
        .finally(() => setBusyDocId(null));
    },
    [loadDocs]
  );

  const handleDelete = useCallback(
    async (docId: string) => {
      if (!(await confirmDialog({ title: 'Delete this document?', description: 'It is removed from the knowledge base and search index.', confirmLabel: 'Delete', variant: 'destructive' }))) return;
      setBusyDocId(docId);
      deleteDocument(docId)
        .then(() => {
          toast.success('Document deleted.');
          setDocs(list => list.filter(d => d.id !== docId));
        })
        .catch(err => {
          console.error('Delete failed:', err);
          toast.error('Delete failed', { description: err instanceof Error ? err.message : undefined });
        })
        .finally(() => setBusyDocId(null));
    },
    []
  );

  return (
    <>
      <div className="absolute inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 z-50 flex w-[420px] max-w-[92vw] flex-col border-l border-border bg-card shadow-2xl">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <span className="text-[13.5px] font-bold text-foreground">Knowledge Base</span>
          <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex shrink-0 gap-1 border-b border-border px-3 pt-2">
          <button
            type="button"
            onClick={() => setTab('notes')}
            className={`rounded-t-md px-3 py-1.5 text-[12px] font-medium ${tab === 'notes' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'}`}
          >
            Notes
          </button>
          <button
            type="button"
            onClick={() => setTab('documents')}
            className={`rounded-t-md px-3 py-1.5 text-[12px] font-medium ${tab === 'documents' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'}`}
          >
            Documents
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'notes' && (
            <div className="space-y-2">
              <Label htmlFor="kb-notes">Notes</Label>
              <Textarea
                id="kb-notes"
                rows={12}
                className="text-[12.5px]"
                value={notesValue}
                onChange={e => onNotesChange(e.target.value)}
                placeholder="Business rules and knowledge this agent should always apply..."
              />
              <p className="text-[11px] text-muted-foreground">
                Saved along with the rest of the agent — click Save on the canvas topbar.
              </p>
            </div>
          )}

          {tab === 'documents' && (
            <div className="space-y-5">
              <div className="rounded-lg border border-border p-3">
                <div className="mb-2 text-[12px] font-semibold text-foreground">Storage backend</div>
                {configLoadState === 'loading' && (
                  <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                  </div>
                )}
                {configLoadState === 'ready' && config && (
                  <div className="space-y-2">
                    <select
                      className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[12px]"
                      value={backendDraft}
                      onChange={e => setBackendDraft(e.target.value)}
                    >
                      {BACKEND_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    {backendDraft === 'external_pg' && (
                      <div className="space-y-1.5">
                        <Input
                          className="h-8 text-[12px]"
                          placeholder={config.connectionUrlMasked ?? 'postgres://...'}
                          value={connUrlDraft}
                          onChange={e => setConnUrlDraft(e.target.value)}
                        />
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={handleTestConnection} disabled={testState === 'testing' || !connUrlDraft}>
                            {testState === 'testing' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                            Test connection
                          </Button>
                          {testState === 'ok' && <span className="text-[11px] text-[var(--archon-success)]">Connected</span>}
                          {testState === 'error' && <span className="text-[11px] text-destructive">Failed</span>}
                        </div>
                      </div>
                    )}
                    <Button size="sm" className="h-7 text-[11px]" onClick={handleSaveConfig} disabled={configSaving}>
                      {configSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      Save
                    </Button>
                  </div>
                )}
                {configLoadState === 'error' && <p className="text-[11.5px] text-destructive">Couldn't load storage config.</p>}
              </div>

              <div className="rounded-lg border border-border p-3">
                <div className="mb-2 text-[12px] font-semibold text-foreground">Add document</div>
                <div className="space-y-2">
                  <Input
                    className="h-8 text-[12px]"
                    placeholder="Title"
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                  />
                  {!newFile && (
                    <Textarea
                      rows={3}
                      className="text-[12px]"
                      placeholder="Paste text…"
                      value={newText}
                      onChange={e => setNewText(e.target.value)}
                    />
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.txt,.md"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                    <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="mr-1 h-3 w-3" /> {newFile ? newFile.name : 'Choose file'}
                    </Button>
                    {newFile && (
                      <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => { setNewFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}>
                        Clear
                      </button>
                    )}
                  </div>
                  <Button size="sm" className="h-7 text-[11px]" disabled={!canUpload || uploading} onClick={handleUpload}>
                    {uploading && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    {uploading ? 'Uploading…' : 'Upload'}
                  </Button>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-foreground">Documents</span>
                  <button type="button" onClick={loadDocs} className="text-muted-foreground hover:text-foreground">
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </div>
                {docsLoadState === 'loading' && (
                  <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                  </div>
                )}
                {docsLoadState === 'error' && <p className="text-[11.5px] text-destructive">Couldn't load documents.</p>}
                {docsLoadState === 'ready' && docs.length === 0 && (
                  <p className="text-[11.5px] text-muted-foreground">No documents indexed yet.</p>
                )}
                {docsLoadState === 'ready' && docs.length > 0 && (
                  <div className="space-y-2">
                    {docs.map(d => (
                      <div key={d.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] font-medium text-foreground">{d.title}</div>
                          <div className="text-[10.5px] text-muted-foreground">{d.chunkCount} chunks</div>
                        </div>
                        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={statusBadgeStyle(d.status)}>
                          {d.status}
                        </span>
                        <button type="button" onClick={() => handleReindex(d.id)} disabled={busyDocId === d.id} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted">
                          <RefreshCw className="h-3 w-3" />
                        </button>
                        <button type="button" onClick={() => handleDelete(d.id)} disabled={busyDocId === d.id} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
