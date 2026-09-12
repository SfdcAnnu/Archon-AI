import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Database,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Bar, EmptyPanel, IconSquare, NoteBar, SpecCard, StatCard, StatusBadge } from '@/components/spec/blocks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { loadAgents, type AgentSummary } from '@/lib/agents-data';
import {
  deleteDocument,
  loadDocuments,
  loadStorageConfig,
  reindexDocument,
  saveStorageConfig,
  searchKb,
  testKbConnection,
  uploadDocument,
  type KbDocument,
  type KbSearchResult,
  type StorageConfig,
} from '@/lib/kb-data';

/** Approved spec screen 05 — Knowledge: "What can agents read, and does
 *  retrieval work?" Knowledge bases are per-agent (kb-data keys documents
 *  by agentApiName), so the left column lists the org's agents with their
 *  document counts; the right side shows the selected agent's indexing
 *  health, per-document source rows, the storage backend, and the
 *  retrieval-test panel, which runs the same retrieval a live turn runs. */

type DocKind = 'ready' | 'indexing' | 'error' | 'other';

function docKind(status: string): DocKind {
  const s = status.toLowerCase();
  if (s === 'ready' || s === 'indexed' || s === 'complete' || s === 'completed') return 'ready';
  if (s === 'indexing' || s === 'pending' || s === 'processing' || s === 'queued') return 'indexing';
  if (s === 'error' || s === 'failed') return 'error';
  return 'other';
}

const SOURCE_GROUPS: Array<{ key: string; label: string; sub: string }> = [
  { key: 'upload', label: 'Uploaded files', sub: 'Added by hand' },
  { key: 'agent_field', label: 'Agent notes (synced)', sub: 'Synced from the agent record' },
];

const BACKENDS: Array<{ value: string; label: string }> = [
  { value: 'archon', label: 'Archon server (built-in)' },
  { value: 'external_pg', label: 'External Postgres' },
  { value: 'salesforce', label: 'Salesforce org storage' },
];

function backendLabel(value: string | null): string {
  if (!value) return 'Not configured';
  return BACKENDS.find(b => b.value === value)?.label ?? value;
}

/* ── document row ─────────────────────────────────────────────────────── */

function DocRow({
  doc,
  groupSub,
  busy,
  onReindex,
  onDelete,
}: {
  doc: KbDocument;
  groupSub: string;
  busy: boolean;
  onReindex: () => void;
  onDelete: () => void;
}) {
  const kind = docKind(doc.status);
  const barPct = kind === 'ready' ? 100 : kind === 'indexing' ? 45 : kind === 'error' ? 100 : 0;
  const barColor =
    kind === 'ready' ? 'var(--primary)' : kind === 'indexing' ? 'var(--node-amber)' : 'var(--archon-error)';
  const barText =
    kind === 'ready'
      ? `${doc.chunkCount} chunk${doc.chunkCount === 1 ? '' : 's'} indexed`
      : kind === 'indexing'
        ? 'indexing…'
        : kind === 'error'
          ? 'indexing failed'
          : doc.status;
  return (
    <div className="flex items-center gap-3 border-b border-[#eceef1] px-3.5 py-2.5 last:border-b-0">
      <IconSquare bg="var(--node-teal-tint)" color="var(--node-teal)">
        <FileText className="h-3.5 w-3.5" />
      </IconSquare>
      <div className="w-[200px] min-w-0 shrink-0">
        <div className="truncate text-[12px] font-bold text-foreground">{doc.title}</div>
        <div className="text-[10.5px] text-[var(--archon-faint)]">{groupSub}</div>
      </div>
      <div className="ml-auto flex min-w-0 max-w-[230px] flex-1 flex-col gap-[3px]">
        <Bar pct={barPct} color={barColor} className="mt-0" />
        <span className="truncate font-mono text-[9.5px] text-[var(--archon-faint)]">{barText}</span>
      </div>
      {kind === 'ready' && <StatusBadge tone="ok">{doc.chunkCount} chunks</StatusBadge>}
      {kind === 'indexing' && <StatusBadge tone="warn">Indexing</StatusBadge>}
      {kind === 'error' && <StatusBadge tone="error">Error</StatusBadge>}
      {kind === 'other' && <StatusBadge tone="muted">{doc.status}</StatusBadge>}
      <div className="flex shrink-0 gap-1">
        <Button variant="outline" size="xs" onClick={onReindex} disabled={busy} title="Reindex">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Reindex
        </Button>
        <Button variant="outline" size="xs" onClick={onDelete} disabled={busy} title="Delete">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

/* ── add-source dialog ────────────────────────────────────────────────── */

function AddSourceDialog({
  agentApiName,
  open,
  onOpenChange,
  onUploaded,
}: {
  agentApiName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUploaded: (doc: KbDocument) => void;
}) {
  const [mode, setMode] = useState<'text' | 'file'>('text');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setMode('text');
      setTitle('');
      setText('');
      setFile(null);
      setSaving(false);
    }
  }, [open]);

  const canSave =
    !saving && (mode === 'text' ? title.trim().length > 0 && text.trim().length > 0 : file != null);

  const handleFile = (f: File | undefined) => {
    if (!f) {
      setFile(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result;
      setFile({ name: f.name, base64 });
      setTitle(t => (t.trim() ? t : f.name));
    };
    reader.readAsDataURL(f);
  };

  const handleSave = () => {
    setSaving(true);
    const input =
      mode === 'text'
        ? { agentApiName, title: title.trim(), text }
        : {
            agentApiName,
            title: title.trim() || file?.name || 'Untitled',
            fileBase64: file?.base64,
            fileName: file?.name,
          };
    uploadDocument(input)
      .then(doc => {
        toast.success(`"${doc.title}" uploaded — indexing started.`);
        onUploaded(doc);
        onOpenChange(false);
      })
      .catch(err => {
        toast.error('Upload failed', { description: err instanceof Error ? err.message : undefined });
        setSaving(false);
      });
  };

  return (
    <Dialog open={open} onOpenChange={v => !saving && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[14px]">Add a knowledge source</DialogTitle>
          <DialogDescription className="text-[12px]">
            Paste text or upload a file — it is chunked and indexed for this agent.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="inline-flex w-fit gap-0.5 rounded-md bg-secondary p-0.5">
            {(['text', 'file'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'rounded-[5px] px-3 py-1 text-[11.5px] font-semibold',
                  mode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                )}
              >
                {m === 'text' ? 'Paste text' : 'Upload file'}
              </button>
            ))}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Title</label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Discount policy v4"
              className="h-8 text-[12.5px]"
            />
          </div>
          {mode === 'text' ? (
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Content</label>
              <Textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={6}
                placeholder="Paste the content the agent should be able to search…"
                className="text-[12.5px]"
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">File</label>
              <input
                type="file"
                accept=".pdf,.txt,.md,.markdown,.csv,.json,.log,application/pdf,text/plain"
                onChange={e => handleFile(e.target.files?.[0])}
                className="block w-full text-[12px] text-muted-foreground file:mr-2 file:rounded-md file:border file:border-border file:bg-card file:px-2.5 file:py-1 file:text-[11.5px] file:font-semibold file:text-primary"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                PDF or plain text (.txt, .md, .csv, .json). Word and Excel can't be read yet — save as PDF, or
                paste the text on the other tab.
              </p>
              {file && <p className="mt-1 text-[11px] text-foreground">{file.name} ready to upload.</p>}
            </div>
          )}
        </div>
        <DialogFooter className="mt-1 bg-transparent p-0">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={handleSave} disabled={!canSave}>
            {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            <Upload className="h-3 w-3" /> Add source
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── storage backend strip ────────────────────────────────────────────── */


/** Runs the SAME retrieval a live turn runs and shows the passages exactly
 *  as the agent receives them. Worth its own panel: a knowledge base that
 *  cannot be queried is one nobody can trust, and finding out that the
 *  answer is missing — or that the wrong passage wins — should not cost a
 *  real conversation. */
function RetrievalTester({ agentApiName }: { agentApiName: string }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<KbSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    searchKb(agentApiName, q)
      .then(setResult)
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  return (
    <SpecCard title="Try a question" muted="see exactly what your agent would receive">
      <div className="flex gap-2 px-3.5 py-3">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && run()}
          placeholder="e.g. What is the enterprise renewal discount cap?"
          className="h-8 flex-1 text-[12.5px]"
        />
        <Button size="sm" className="h-8 text-xs" onClick={run} disabled={busy || !query.trim()}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />} Search
        </Button>
      </div>

      {error && <NoteBar>Couldn't run the search — {error}</NoteBar>}

      {result && result.chunks.length === 0 && (
        <NoteBar>
          {result.note ?? 'Nothing matched. The agent would get no knowledge-base context for this question.'}
        </NoteBar>
      )}

      {result && result.chunks.length > 0 && (
        <div className="grid gap-2.5 px-3.5 pb-3.5 text-[11.5px]">
          <div className="text-[10.5px] text-muted-foreground">
            {result.chunks.length} passage{result.chunks.length === 1 ? '' : 's'} — this is what reaches the prompt
          </div>
          {result.chunks.map((c, i) => (
            <div key={i} className="overflow-hidden rounded-lg border border-border">
              <div className="flex items-center justify-between bg-secondary px-2.5 py-1.5 text-[10px]">
                <span className="font-bold text-foreground">[{i + 1}] {c.documentTitle}</span>
                {c.score != null && (
                  <span className="font-mono text-muted-foreground">score {c.score.toFixed(3)}</span>
                )}
              </div>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-[11px] leading-relaxed">
                {c.content}
              </pre>
            </div>
          ))}
        </div>
      )}
    </SpecCard>
  );
}

function StorageStrip() {
  const [config, setConfig] = useState<StorageConfig | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [backend, setBackend] = useState<string>('archon');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadStorageConfig()
      .then(cfg => {
        if (cancelled) return;
        setConfig(cfg);
        if (cfg.backend) setBackend(cfg.backend);
      })
      .catch(() => !cancelled && setLoadFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const isExternal = backend === 'external_pg';
  const dirty = config != null && (backend !== (config.backend ?? 'archon') || url.trim().length > 0);

  const handleTest = () => {
    setTesting(true);
    testKbConnection(url.trim())
      .then(() => toast.success('Connection works.'))
      .catch(err => toast.error('Connection failed', { description: err instanceof Error ? err.message : undefined }))
      .finally(() => setTesting(false));
  };

  const handleSave = () => {
    setSaving(true);
    saveStorageConfig(backend, isExternal && url.trim() ? url.trim() : undefined)
      .then(cfg => {
        setConfig(cfg);
        setUrl('');
        toast.success('Storage backend saved.');
      })
      .catch(err => toast.error('Save failed', { description: err instanceof Error ? err.message : undefined }))
      .finally(() => setSaving(false));
  };

  return (
    <SpecCard title="Storage backend" muted="where the indexed chunks live">
      {loadFailed ? (
        <p className="px-3.5 py-3 text-[11.5px] text-muted-foreground">Couldn't load the storage configuration.</p>
      ) : !config ? (
        <div className="flex items-center gap-2 px-3.5 py-3 text-[11.5px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 px-3.5 py-3">
          <IconSquare bg="var(--node-blue-tint)" color="var(--node-blue)">
            <Database className="h-3.5 w-3.5" />
          </IconSquare>
          <div className="min-w-0">
            <div className="text-[12px] font-bold text-foreground">{backendLabel(config.backend)}</div>
            <div className="font-mono text-[10px] text-[var(--archon-faint)]">
              {config.hasConnectionUrl ? (config.connectionUrlMasked ?? 'connection URL saved') : 'no connection URL'}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select value={backend} onValueChange={setBackend}>
              <SelectTrigger className="h-8 w-[190px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BACKENDS.map(b => (
                  <SelectItem key={b.value} value={b.value} className="text-xs">
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isExternal && (
              <Input
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder={config.hasConnectionUrl ? 'New connection URL (optional)' : 'postgres://…'}
                className="h-8 w-[220px] font-mono text-[11px]"
              />
            )}
            {isExternal && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={handleTest}
                disabled={testing || url.trim().length === 0}
              >
                {testing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Test connection
              </Button>
            )}
            <Button size="sm" className="h-8 text-xs" onClick={handleSave} disabled={saving || !dirty}>
              {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      )}
    </SpecCard>
  );
}

/* ── page ─────────────────────────────────────────────────────────────── */

export default function KnowledgePage() {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [agentsFailed, setAgentsFailed] = useState(false);
  const [docsByAgent, setDocsByAgent] = useState<Record<string, KbDocument[]>>({});
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadAgents()
      .then(async list => {
        if (cancelled) return;
        setAgents(list);
        if (list.length > 0) setSelected(prev => prev ?? list[0].apiName);
        const results = await Promise.allSettled(list.map(a => loadDocuments(a.apiName)));
        if (cancelled) return;
        const map: Record<string, KbDocument[]> = {};
        list.forEach((a, i) => {
          const r = results[i];
          map[a.apiName] = r && r.status === 'fulfilled' ? r.value : [];
        });
        setDocsByAgent(map);
        setDocsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setAgentsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const docs = useMemo(() => (selected ? (docsByAgent[selected] ?? []) : []), [docsByAgent, selected]);
  const total = docs.length;
  const ready = docs.filter(d => docKind(d.status) === 'ready').length;
  const indexing = docs.filter(d => docKind(d.status) === 'indexing').length;
  const errors = docs.filter(d => docKind(d.status) === 'error').length;
  const chunks = docs.reduce((sum, d) => sum + (d.chunkCount || 0), 0);

  const grouped = useMemo(() => {
    const known = SOURCE_GROUPS.map(g => ({ ...g, docs: docs.filter(d => d.sourceType === g.key) }));
    const other = docs.filter(d => !SOURCE_GROUPS.some(g => g.key === d.sourceType));
    if (other.length > 0) known.push({ key: 'other', label: 'Other sources', sub: 'Source type not recognised', docs: other });
    return known.filter(g => g.docs.length > 0);
  }, [docs]);

  const updateSelectedDocs = (fn: (prev: KbDocument[]) => KbDocument[]) => {
    if (!selected) return;
    setDocsByAgent(prev => ({ ...prev, [selected]: fn(prev[selected] ?? []) }));
  };

  const handleReindex = (doc: KbDocument) => {
    setBusyDocId(doc.id);
    reindexDocument(doc.id)
      .then(updated => {
        updateSelectedDocs(prev => prev.map(d => (d.id === doc.id ? updated : d)));
        toast.success(`Reindex started for "${doc.title}".`);
      })
      .catch(err => toast.error('Reindex failed', { description: err instanceof Error ? err.message : undefined }))
      .finally(() => setBusyDocId(null));
  };

  const handleDelete = async (doc: KbDocument) => {
    const ok = await confirmDialog({
      title: `Delete "${doc.title}"?`,
      description: 'The document and its indexed chunks are removed — agents can no longer retrieve it.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    });
    if (!ok) return;
    setBusyDocId(doc.id);
    deleteDocument(doc.id)
      .then(() => {
        updateSelectedDocs(prev => prev.filter(d => d.id !== doc.id));
        toast.success(`"${doc.title}" deleted.`);
      })
      .catch(err => toast.error('Delete failed', { description: err instanceof Error ? err.message : undefined }))
      .finally(() => setBusyDocId(null));
  };

  const errorDocs = docs.filter(d => docKind(d.status) === 'error' && d.errorMessage);

  return (
    <AppShell title="Knowledge">
      <div className="mx-auto w-full max-w-[1180px] p-5">
        {agentsFailed ? (
          <EmptyPanel>Couldn't load agents — retry with Refresh once the server is reachable.</EmptyPanel>
        ) : !agents ? (
          <div className="flex items-center gap-2 py-8 text-[12px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading knowledge bases…
          </div>
        ) : agents.length === 0 ? (
          <EmptyPanel>No agents yet — create an agent first, then give it knowledge to search here.</EmptyPanel>
        ) : (
          <div className="grid grid-cols-[220px_1fr] items-start gap-3.5">
            {/* left: per-agent knowledge bases */}
            <SpecCard title="Knowledge bases">
              {agents.map(a => {
                const count = docsByAgent[a.apiName]?.length;
                const on = a.apiName === selected;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelected(a.apiName)}
                    className={cn(
                      'block w-full border-b border-[#eceef1] px-3 py-2 text-left last:border-b-0 hover:bg-[#f8fafc]',
                      on && 'bg-[#f4f9fe] shadow-[inset_3px_0_0_var(--primary)]'
                    )}
                  >
                    <div className="truncate text-[12px] font-bold text-foreground">{a.name}</div>
                    <div className="font-mono text-[10.5px] text-[var(--archon-faint)]">
                      {!docsLoaded ? '…' : count === 0 ? 'no documents' : `${count} document${count === 1 ? '' : 's'}`}
                    </div>
                  </button>
                );
              })}
            </SpecCard>

            {/* right: stats · sources · storage · retrieval test */}
            <div className="grid gap-3.5">
              <div className="grid grid-cols-3 gap-3">
                <StatCard
                  label="Indexed and searchable"
                  value={docsLoaded ? ready : '…'}
                  sub={docsLoaded ? `of ${total} document${total === 1 ? '' : 's'}` : 'loading'}
                >
                  {docsLoaded && total > 0 && <Bar pct={(ready / total) * 100} color="var(--primary)" />}
                </StatCard>
                <StatCard
                  label="Documents"
                  value={docsLoaded ? total : '…'}
                  sub={docsLoaded ? `${chunks} chunk${chunks === 1 ? '' : 's'} indexed` : 'loading'}
                />
                <StatCard
                  label="Needs attention"
                  value={docsLoaded ? errors + indexing : '…'}
                  valueClass={errors > 0 ? 'text-[var(--archon-error)]' : indexing > 0 ? 'text-[var(--archon-warning)]' : undefined}
                  sub={
                    !docsLoaded
                      ? 'loading'
                      : errors + indexing === 0
                        ? 'nothing needs attention'
                        : [errors > 0 ? `${errors} failed` : null, indexing > 0 ? `${indexing} still indexing` : null]
                            .filter(Boolean)
                            .join(' · ')
                  }
                  subClass={errors > 0 ? 'text-[var(--archon-error)]' : undefined}
                />
              </div>

              <SpecCard
                title="Where the content comes from"
                right={
                  <Button variant="outline" size="xs" onClick={() => setAddOpen(true)} disabled={!selected}>
                    <Plus className="h-3 w-3" /> Add source
                  </Button>
                }
              >
                {!docsLoaded ? (
                  <div className="flex items-center gap-2 px-3.5 py-4 text-[11.5px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading documents…
                  </div>
                ) : total === 0 ? (
                  <div className="px-3.5 py-6 text-center text-[12px] text-muted-foreground">
                    <BookOpen className="mx-auto mb-2 h-5 w-5 opacity-50" />
                    This agent has no knowledge sources yet — add one and it becomes searchable in chat.
                  </div>
                ) : (
                  <>
                    {grouped.map(g => (
                      <div key={g.key}>
                        <div className="border-b border-border bg-[#f7f8f9] px-3.5 py-1.5 text-[10.5px] font-bold text-muted-foreground">
                          {g.label}{' '}
                          <span className="font-normal">
                            — {g.docs.length} document{g.docs.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        {g.docs.map(d => (
                          <DocRow
                            key={d.id}
                            doc={d}
                            groupSub={g.sub}
                            busy={busyDocId === d.id}
                            onReindex={() => handleReindex(d)}
                            onDelete={() => handleDelete(d)}
                          />
                        ))}
                      </div>
                    ))}
                    {errorDocs.length > 0 && (
                      <NoteBar tone="error">
                        {errorDocs.map(d => `"${d.title}": ${d.errorMessage}`).join(' · ')}
                      </NoteBar>
                    )}
                  </>
                )}
              </SpecCard>

              <StorageStrip />

              {selected && <RetrievalTester agentApiName={selected} />}
            </div>
          </div>
        )}
      </div>

      {selected && (
        <AddSourceDialog
          agentApiName={selected}
          open={addOpen}
          onOpenChange={setAddOpen}
          onUploaded={doc => updateSelectedDocs(prev => [...prev, doc])}
        />
      )}
    </AppShell>
  );
}
