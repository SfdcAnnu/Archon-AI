import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  loadExecutionLogs,
  loadRunSteps,
  STATUS_OPTIONS,
  type RawAgentExecution,
  type RunStepDto,
} from '@/lib/executions-data';

const PAGE_SIZE = 20;

function statusPillStyle(status: string) {
  if (status === 'SUCCESS') return { backgroundColor: 'var(--archon-success-tint)', color: 'var(--archon-success)' };
  if (status === 'ERROR' || status === 'TIMEOUT') return { backgroundColor: 'var(--archon-danger-tint, #fde8e8)', color: 'var(--archon-danger, #dc2626)' };
  if (status === 'RUNNING' || status === 'QUEUED') return { backgroundColor: 'var(--archon-warning-tint, #fef3e0)', color: 'var(--archon-warning, #b45309)' };
  return { backgroundColor: 'var(--node-gray-tint)', color: 'var(--node-gray)' };
}

function scoreColor(score: number | null) {
  if (score == null) return 'var(--node-gray)';
  if (score >= 70) return 'var(--archon-success)';
  if (score >= 40) return 'var(--archon-warning, #b45309)';
  return 'var(--archon-danger, #dc2626)';
}

function toCsv(rows: RawAgentExecution[]): string {
  const headers = ['Agent', 'Department', 'RecordId', 'Score', 'Priority', 'Status', 'ToolsUsed', 'CreatedDate'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    const cells = [
      r['AgentDefinition__r.Name'],
      r.Department__c ?? '',
      r.RecordId__c ?? '',
      r.AgentScore__c ?? '',
      r.AgentPriority__c ?? '',
      r.Status__c,
      r.ToolsUsed__c ?? '',
      r.CreatedDate,
    ];
    lines.push(cells.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','));
  }
  return lines.join('\n');
}

function NodeTrace({ correlationId }: { correlationId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error' | 'not_found'>('idle');
  const [steps, setSteps] = useState<RunStepDto[]>([]);

  const load = useCallback(() => {
    setState('loading');
    loadRunSteps(correlationId)
      .then(result => {
        if (result.status === 'NOT_FOUND') {
          setState('not_found');
          return;
        }
        setSteps(result.steps);
        setState('ready');
      })
      .catch(err => {
        console.error('Failed to load node trace:', err);
        setState('error');
      });
  }, [correlationId]);

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[12.5px] font-semibold text-foreground">Node-by-node trace</h4>
        {state === 'idle' && (
          <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={load}>
            Load trace
          </Button>
        )}
      </div>
      {state === 'loading' && (
        <div className="flex items-center gap-2 py-3 text-[11.5px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      )}
      {state === 'not_found' && (
        <p className="py-3 text-[11.5px] text-muted-foreground">No durable trace found for this run.</p>
      )}
      {state === 'error' && <p className="py-3 text-[11.5px] text-destructive">Couldn't load the trace.</p>}
      {state === 'ready' && (
        <div className="space-y-2">
          {steps.map((s, i) => (
            <div key={`${s.nodeId}-${i}`} className="rounded-lg border border-border p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] font-semibold text-foreground">{s.nodeLabel}</span>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={statusPillStyle(s.success ? 'SUCCESS' : 'ERROR')}
                >
                  {s.success ? 'Success' : 'Error'}
                </span>
              </div>
              {s.errorMsg && <p className="mt-1 text-[11px] text-destructive">{s.errorMsg}</p>}
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <pre className="max-h-32 overflow-auto rounded bg-muted/50 p-1.5 text-[10px]">{s.inputJson}</pre>
                <pre className="max-h-32 overflow-auto rounded bg-muted/50 p-1.5 text-[10px]">{s.outputJson}</pre>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ExecutionLogsPage() {
  const [rows, setRows] = useState<RawAgentExecution[]>([]);
  const [total, setTotal] = useState(0);
  const [pageOffset, setPageOffset] = useState(0);
  const [status, setStatus] = useState<string>('all');
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selected, setSelected] = useState<RawAgentExecution | null>(null);

  useEffect(() => {
    setLoadState('loading');
    loadExecutionLogs({ pageSize: PAGE_SIZE, pageOffset, status: status === 'all' ? undefined : status })
      .then(page => {
        setRows(page.records);
        setTotal(page.total);
        setLoadState('ready');
      })
      .catch(err => {
        console.error('Failed to load execution logs:', err);
        setLoadState('error');
      });
  }, [pageOffset, status]);

  const hasMore = pageOffset + PAGE_SIZE < total;
  const hasPrev = pageOffset > 0;

  const handleExportCsv = useCallback(() => {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'execution-logs.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [rows]);

  return (
    <AppShell>
      <div className="relative flex h-full w-full flex-col overflow-y-auto">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-5">
          <span className="text-[14px] font-bold text-foreground">Executions</span>
          <div className="flex items-center gap-2">
            <Select value={status} onValueChange={v => { setStatus(v); setPageOffset(0); }}>
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_OPTIONS.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleExportCsv} disabled={rows.length === 0}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
            </Button>
          </div>
        </header>

        <div className="mx-auto w-full max-w-5xl flex-1 p-6">
          {loadState === 'loading' && (
            <div className="flex items-center gap-2 py-8 text-[12.5px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          )}
          {loadState === 'error' && (
            <p className="py-8 text-[12.5px] text-destructive">Couldn't load execution logs.</p>
          )}
          {loadState === 'ready' && rows.length === 0 && (
            <div className="rounded-lg border border-dashed border-border py-16 text-center">
              <p className="text-[13px] text-muted-foreground">No runs match this filter.</p>
            </div>
          )}
          {loadState === 'ready' && rows.length > 0 && (
            <>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-foreground">Agent</th>
                      <th className="px-3 py-2 text-left font-medium text-foreground">Department</th>
                      <th className="px-3 py-2 text-left font-medium text-foreground">Record</th>
                      <th className="px-3 py-2 text-left font-medium text-foreground">Score</th>
                      <th className="px-3 py-2 text-left font-medium text-foreground">Priority</th>
                      <th className="px-3 py-2 text-left font-medium text-foreground">Tools used</th>
                      <th className="px-3 py-2 text-left font-medium text-foreground">Status</th>
                      <th className="px-3 py-2 text-left font-medium text-foreground">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr
                        key={r.Id}
                        className="cursor-pointer border-t border-border hover:bg-muted/30"
                        onClick={() => setSelected(r)}
                      >
                        <td className="px-3 py-2 font-medium text-foreground">{r['AgentDefinition__r.Name']}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.Department__c ?? '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.RecordId__c ?? '—'}</td>
                        <td className="px-3 py-2 font-semibold" style={{ color: scoreColor(r.AgentScore__c) }}>
                          {r.AgentScore__c ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{r.AgentPriority__c ?? '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.ToolsUsed__c ?? '—'}</td>
                        <td className="px-3 py-2">
                          <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={statusPillStyle(r.Status__c)}>
                            {r.Status__c}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{new Date(r.CreatedDate).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center justify-between text-[11.5px] text-muted-foreground">
                <span>
                  {pageOffset + 1}–{Math.min(pageOffset + PAGE_SIZE, total)} of {total}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={!hasPrev} onClick={() => setPageOffset(o => Math.max(0, o - PAGE_SIZE))}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={!hasMore} onClick={() => setPageOffset(o => o + PAGE_SIZE)}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {selected && (
          <>
            <div className="absolute inset-0 bg-black/20" onClick={() => setSelected(null)} />
            <div className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto border-l border-border bg-card p-5 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-[15px] font-bold text-foreground">{selected['AgentDefinition__r.Name']}</h3>
                <button type="button" onClick={() => setSelected(null)} className="rounded-md p-1 hover:bg-muted">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-2 text-[12.5px]">
                <div><span className="text-muted-foreground">Correlation ID:</span> {selected.CorrelationId__c ?? '—'}</div>
                <div><span className="text-muted-foreground">Record ID:</span> {selected.RecordId__c ?? '—'}</div>
                <div><span className="text-muted-foreground">Score:</span> <span style={{ color: scoreColor(selected.AgentScore__c) }}>{selected.AgentScore__c ?? '—'}</span></div>
                <div><span className="text-muted-foreground">Priority:</span> {selected.AgentPriority__c ?? '—'}</div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{' '}
                  <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={statusPillStyle(selected.Status__c)}>
                    {selected.Status__c}
                  </span>
                </div>
                <div><span className="text-muted-foreground">Date:</span> {new Date(selected.CreatedDate).toLocaleString()}</div>
              </div>
              {selected.AgentReason__c && (
                <div className="mt-4">
                  <div className="mb-1 text-[11.5px] font-semibold text-foreground">Reasoning</div>
                  <p className="text-[12px] leading-relaxed text-muted-foreground">{selected.AgentReason__c}</p>
                </div>
              )}
              {selected.OutputPayload__c && (
                <div className="mt-4">
                  <div className="mb-1 text-[11.5px] font-semibold text-foreground">Output payload</div>
                  <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-2 text-[10.5px]">{selected.OutputPayload__c}</pre>
                </div>
              )}
              {selected.CorrelationId__c && <NodeTrace correlationId={selected.CorrelationId__c} />}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
