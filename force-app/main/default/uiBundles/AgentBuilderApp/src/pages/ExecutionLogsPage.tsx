import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  EmptyPanel,
  IconSquare,
  NoteBar,
  SpecCard,
  StatCard,
  StatusBadge,
  type BadgeTone,
} from '@/components/spec/blocks';
import {
  loadExecutionLogs,
  loadRunSteps,
  STATUS_OPTIONS,
  type RawAgentExecution,
  type RunStepDto,
} from '@/lib/executions-data';

const PAGE_SIZE = 20;

/** Short chip labels for the raw status values. */
const STATUS_LABELS: Record<string, string> = {
  SUCCESS: 'Success',
  ERROR: 'Failed',
  QUEUED: 'Queued',
  RUNNING: 'Running',
  WAITING: 'Waiting',
  WAITING_APPROVAL: 'Approval',
  TIMEOUT: 'Timeout',
};

function isFailedStatus(status: string): boolean {
  return status === 'ERROR' || status === 'TIMEOUT';
}

function statusTone(status: string): BadgeTone {
  if (status === 'SUCCESS') return 'ok';
  if (isFailedStatus(status)) return 'error';
  if (status === 'RUNNING' || status === 'QUEUED') return 'warn';
  return 'muted';
}

function scoreColor(score: number | null) {
  if (score == null) return 'var(--node-gray)';
  if (score >= 70) return 'var(--archon-success)';
  if (score >= 40) return 'var(--archon-warning)';
  return 'var(--archon-error)';
}

function parseTs(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function fmtMs(ms: number): string {
  if (ms < 950) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 90) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

/** List-row timestamp: time of day for today's runs, short date otherwise. */
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function stepDurationMs(s: RunStepDto): number | null {
  const start = parseTs(s.startedAt);
  const end = parseTs(s.finishedAt);
  if (start == null || end == null || end < start) return null;
  return end - start;
}

/** One plain sentence from a step's output JSON — real values only, trimmed. */
function summarize(json: string | null, max = 110): string | null {
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    parsed = json;
  }
  if (parsed == null) return null;
  let text: string;
  if (typeof parsed === 'string') text = parsed;
  else if (Array.isArray(parsed)) text = `${parsed.length} item${parsed.length === 1 ? '' : 's'}`;
  else if (typeof parsed === 'object') {
    const entries = Object.entries(parsed as Record<string, unknown>);
    const parts = entries
      .filter(([, v]) => v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${String(v)}`);
    text = parts.length > 0 ? parts.join(' · ') : entries.slice(0, 5).map(([k]) => k).join(', ');
  } else text = String(parsed);
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function inputKeys(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return Object.keys(parsed);
  } catch {
    /* not JSON — no keys to list */
  }
  return [];
}

/** Icon square by node type, matching the builder's node accent colors. */
function stepIcon(sub: string, failed: boolean): { bg: string; color: string; glyph: string } {
  if (failed) return { bg: '#ffffff', color: 'var(--archon-error)', glyph: '⚠' };
  const s = (sub || '').toLowerCase();
  if (s === 'claude' || s === 'gpt4' || s === 'gemini' || s.includes('agent') || s.includes('llm'))
    return { bg: 'var(--node-purple-tint)', color: 'var(--node-purple)', glyph: '♟' };
  if (s.includes('approval')) return { bg: 'var(--archon-warning-tint)', color: 'var(--node-amber)', glyph: '☑' };
  if (s.includes('webhook') || s.includes('trigger') || s.includes('record'))
    return { bg: 'var(--node-gray-tint)', color: 'var(--node-gray)', glyph: '⚡' };
  if (s.includes('knowledge') || s.includes('catalog'))
    return { bg: 'var(--node-teal-tint)', color: 'var(--node-teal)', glyph: '▤' };
  if (s.includes('tool') || s.includes('salesforce') || s.includes('apex') || s.includes('flow'))
    return { bg: 'var(--node-blue-tint)', color: 'var(--node-blue)', glyph: '☁' };
  if (s === 'end') return { bg: 'var(--node-gray-tint)', color: 'var(--node-gray)', glyph: '◼' };
  return { bg: 'var(--node-gray-tint)', color: 'var(--node-gray)', glyph: '⌕' };
}

interface TimelineRow {
  step: RunStepDto;
  leftPct: number;
  widthPct: number;
}

/** Horizontal per-step timeline — only when EVERY step carries real start
 *  and finish timestamps. Otherwise return null and the page skips the
 *  Gantt entirely rather than inventing offsets. */
function buildTimeline(steps: RunStepDto[]): { totalMs: number; rows: TimelineRow[] } | null {
  if (steps.length === 0) return null;
  const spans: { start: number; end: number; step: RunStepDto }[] = [];
  for (const s of steps) {
    const start = parseTs(s.startedAt);
    const end = parseTs(s.finishedAt);
    if (start == null || end == null) return null;
    spans.push({ start, end: Math.max(end, start), step: s });
  }
  const t0 = Math.min(...spans.map(x => x.start));
  const t1 = Math.max(...spans.map(x => x.end));
  const totalMs = t1 - t0;
  if (totalMs <= 0) return null;
  return {
    totalMs,
    rows: spans.map(x => ({
      step: x.step,
      leftPct: ((x.start - t0) / totalMs) * 100,
      widthPct: Math.max(((x.end - x.start) / totalMs) * 100, 1.5),
    })),
  };
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[#eceef1] px-3.5 py-[7px] text-[11.5px] last:border-b-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right text-foreground">{children}</span>
    </div>
  );
}

type StepsState = 'none' | 'loading' | 'ready' | 'not_found' | 'error';

export default function ExecutionLogsPage() {
  const [rows, setRows] = useState<RawAgentExecution[]>([]);
  const [total, setTotal] = useState(0);
  const [pageOffset, setPageOffset] = useState(0);
  const [status, setStatus] = useState<string>('all');
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [steps, setSteps] = useState<RunStepDto[]>([]);
  const [stepsState, setStepsState] = useState<StepsState>('none');

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

  const selected = useMemo(
    () => rows.find(r => r.Id === selectedId) ?? rows[0] ?? null,
    [rows, selectedId]
  );

  // Per-run step detail (loadRunSteps) — fetched as soon as a run is picked.
  const corr = selected?.CorrelationId__c ?? null;
  useEffect(() => {
    if (!corr) {
      setStepsState('none');
      setSteps([]);
      return;
    }
    let cancelled = false;
    setStepsState('loading');
    setSteps([]);
    loadRunSteps(corr)
      .then(result => {
        if (cancelled) return;
        if (result.status === 'NOT_FOUND') {
          setStepsState('not_found');
          return;
        }
        setSteps(result.steps);
        setStepsState('ready');
      })
      .catch(err => {
        console.error('Failed to load run steps:', err);
        if (!cancelled) setStepsState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [corr]);

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

  const hasMore = pageOffset + PAGE_SIZE < total;
  const hasPrev = pageOffset > 0;

  const runFailed = selected != null && isFailedStatus(selected.Status__c);
  const timeline = useMemo(() => (stepsState === 'ready' ? buildTimeline(steps) : null), [steps, stepsState]);
  const firstFailIdx = useMemo(() => steps.findIndex(s => !s.success), [steps]);
  const failStep = firstFailIdx >= 0 ? steps[firstFailIdx] : null;

  // "Took" — ExecutionMs__c when the run recorded it, else the span of the
  // step timestamps; never an invented number.
  const runDurationMs = useMemo(() => {
    if (!selected) return null;
    if (selected.ExecutionMs__c != null && selected.ExecutionMs__c > 0) return selected.ExecutionMs__c;
    if (stepsState !== 'ready') return null;
    const starts = steps.map(s => parseTs(s.startedAt)).filter((n): n is number => n != null);
    const ends = steps.map(s => parseTs(s.finishedAt)).filter((n): n is number => n != null);
    if (starts.length === 0 || ends.length === 0) return null;
    const span = Math.max(...ends) - Math.min(...starts);
    return span > 0 ? span : null;
  }, [selected, steps, stepsState]);

  const reachedStep = firstFailIdx >= 0 ? firstFailIdx + 1 : steps.length;

  return (
    <AppShell title="Runs">
      <div className="mx-auto w-full max-w-[1180px] p-5">
        <div className="grid items-start gap-3.5 md:grid-cols-[240px_1fr]">
          {/* ── Left: runs list ─────────────────────────────── */}
          <SpecCard
            title="Runs"
            muted={loadState === 'ready' ? `${total} total` : undefined}
            right={
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[10.5px]"
                onClick={handleExportCsv}
                disabled={rows.length === 0}
                title="Export this page as CSV"
              >
                <Download className="mr-1 h-3 w-3" /> CSV
              </Button>
            }
          >
            <div className="flex flex-wrap gap-1 border-b border-border px-2.5 py-2">
              {['all', ...STATUS_OPTIONS].map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setStatus(s);
                    setPageOffset(0);
                    setSelectedId(null);
                  }}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[9.5px] font-bold',
                    status === s
                      ? 'bg-primary text-white'
                      : 'bg-[var(--node-gray-tint)] text-muted-foreground hover:bg-[#e4e7ec]'
                  )}
                >
                  {s === 'all' ? 'All' : STATUS_LABELS[s] ?? s}
                </button>
              ))}
            </div>

            {loadState === 'loading' && (
              <div className="flex items-center gap-2 px-3.5 py-6 text-[11.5px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </div>
            )}
            {loadState === 'error' && (
              <p className="px-3.5 py-6 text-[11.5px] text-muted-foreground">The runs list could not be loaded.</p>
            )}
            {loadState === 'ready' && rows.length === 0 && (
              <p className="px-3.5 py-6 text-[11.5px] text-muted-foreground">No runs match this filter.</p>
            )}
            {loadState === 'ready' &&
              rows.map(r => {
                const sel = selected?.Id === r.Id;
                return (
                  <button
                    key={r.Id}
                    type="button"
                    onClick={() => setSelectedId(r.Id)}
                    className={cn(
                      'flex w-full items-center gap-2 border-b border-[#eceef1] px-3 py-2 text-left last:border-b-0',
                      sel ? 'bg-[#f4f9fe] shadow-[inset_3px_0_0_var(--primary)]' : 'hover:bg-[#f8fafc]'
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[11.5px] font-bold text-foreground">{r.Name}</div>
                      <div className="truncate text-[10.5px] text-[var(--archon-faint)]">
                        {fmtWhen(r.CreatedDate)} · {r['AgentDefinition__r.Name']}
                      </div>
                    </div>
                    {isFailedStatus(r.Status__c) && (
                      <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--archon-error)]" />
                    )}
                  </button>
                );
              })}

            <div className="flex items-center justify-between rounded-b-lg border-t border-border px-3 py-2 text-[10.5px] text-muted-foreground">
              <span className="font-mono">
                {total === 0 ? '0' : `${pageOffset + 1}–${Math.min(pageOffset + PAGE_SIZE, total)}`} of {total}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  disabled={!hasPrev}
                  onClick={() => {
                    setPageOffset(o => Math.max(0, o - PAGE_SIZE));
                    setSelectedId(null);
                  }}
                >
                  ‹ Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  disabled={!hasMore}
                  onClick={() => {
                    setPageOffset(o => o + PAGE_SIZE);
                    setSelectedId(null);
                  }}
                >
                  Next ›
                </Button>
              </div>
            </div>
          </SpecCard>

          {/* ── Right: the selected run ─────────────────────── */}
          {selected == null ? (
            loadState === 'ready' ? (
              <EmptyPanel>Select a run on the left to see what happened.</EmptyPanel>
            ) : (
              <div />
            )
          ) : (
            <div className="grid gap-3.5">
              <div className="grid grid-cols-3 gap-3">
                <StatCard
                  label="Took"
                  value={runDurationMs != null ? fmtMs(runDurationMs) : '—'}
                  sub={runDurationMs != null ? 'start to finish' : 'no timing recorded'}
                />
                <StatCard label="Cost" value="—" sub="not tracked yet" />
                <StatCard
                  label="Got to step"
                  value={stepsState === 'ready' && steps.length > 0 ? `${reachedStep} of ${steps.length}` : '—'}
                  valueClass={firstFailIdx >= 0 ? 'text-[var(--archon-error)]' : undefined}
                  sub={
                    stepsState === 'ready' && steps.length > 0
                      ? firstFailIdx >= 0
                        ? firstFailIdx === steps.length - 1
                          ? 'failed at the last one'
                          : `failed at step ${firstFailIdx + 1}`
                        : 'every step finished'
                      : stepsState === 'loading'
                        ? 'loading the trace…'
                        : 'no trace recorded'
                  }
                />
              </div>

              <SpecCard
                title="What happened"
                muted={selected.Name}
                right={<StatusBadge tone={statusTone(selected.Status__c)}>{selected.Status__c}</StatusBadge>}
              >
                {stepsState === 'loading' && (
                  <div className="flex items-center gap-2 px-3.5 py-5 text-[11.5px] text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the step-by-step trace…
                  </div>
                )}
                {stepsState === 'none' && (
                  <p className="px-3.5 py-5 text-[11.5px] text-muted-foreground">
                    This run has no correlation id, so no step-by-step trace exists for it.
                  </p>
                )}
                {stepsState === 'not_found' && (
                  <p className="px-3.5 py-5 text-[11.5px] text-muted-foreground">
                    No durable trace was recorded for this run.
                  </p>
                )}
                {stepsState === 'error' && (
                  <p className="px-3.5 py-5 text-[11.5px] text-muted-foreground">The trace could not be loaded.</p>
                )}
                {stepsState === 'ready' && steps.length === 0 && (
                  <p className="px-3.5 py-5 text-[11.5px] text-muted-foreground">The trace for this run is empty.</p>
                )}

                {timeline && (
                  <div className="px-3.5 pb-2 pt-3.5">
                    {timeline.rows.map((row, i) => (
                      <div key={`${row.step.nodeId}-${i}`} className="relative my-[5px] h-[18px] rounded bg-[#f4f5f7]">
                        <span
                          className={cn(
                            'absolute left-2 top-[2px] z-[2] truncate text-[9.5px] font-bold',
                            row.leftPct <= 5
                              ? 'text-white [text-shadow:0_1px_2px_rgba(0,0,0,.25)]'
                              : 'text-muted-foreground'
                          )}
                          style={{ maxWidth: '70%' }}
                        >
                          {row.step.nodeLabel}
                        </span>
                        <i
                          className="absolute bottom-[2px] top-[2px] block rounded-[3px]"
                          style={{
                            left: `${row.leftPct}%`,
                            width: `${row.widthPct}%`,
                            background: row.step.success ? '#0176d3' : 'var(--archon-error)',
                            opacity: row.step.success ? 0.85 : 1,
                          }}
                        />
                      </div>
                    ))}
                    <div className="mt-1 flex justify-between font-mono text-[9.5px] text-[var(--archon-faint)]">
                      <span>0s</span>
                      <span>{fmtMs(timeline.totalMs / 2)}</span>
                      <span>{fmtMs(timeline.totalMs)}</span>
                    </div>
                  </div>
                )}

                {stepsState === 'ready' && steps.length > 0 && (
                  <div className={timeline ? 'border-t border-border' : undefined}>
                    {steps.map((s, i) => {
                      const failed = !s.success;
                      const icon = stepIcon(s.nodeSubType, failed);
                      const dur = stepDurationMs(s);
                      const sub = failed ? s.errorMsg ?? 'This step failed.' : summarize(s.outputJson);
                      return (
                        <div
                          key={`${s.nodeId}-${i}`}
                          className="flex items-center gap-3 border-b border-[#eceef1] px-3.5 py-2.5 last:border-b-0"
                          style={failed ? { background: 'var(--archon-error-tint)' } : undefined}
                        >
                          <IconSquare bg={icon.bg} color={icon.color} size={20}>
                            <span className="text-[11px] leading-none">{icon.glyph}</span>
                          </IconSquare>
                          <div className="min-w-0 flex-1">
                            <b className={cn('block text-[12px]', failed ? 'text-[var(--archon-error)]' : 'text-foreground')}>
                              {s.nodeLabel}
                            </b>
                            {sub && (
                              <span
                                className={cn(
                                  'block text-[10.5px]',
                                  failed ? 'break-words text-[var(--archon-error)]' : 'truncate text-[var(--archon-faint)]'
                                )}
                              >
                                {sub}
                              </span>
                            )}
                          </div>
                          {dur != null && (
                            <span
                              className={cn(
                                'shrink-0 font-mono text-[11px]',
                                failed ? 'text-[var(--archon-error)]' : 'text-[var(--archon-faint)]'
                              )}
                            >
                              {fmtMs(dur)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {runFailed && <NoteBar tone="error">The run stopped here.</NoteBar>}
              </SpecCard>

              {/* Spec's could-see / could-not-see panel: the runtime does not
                  yet return context-policy data for these runs, so the left
                  column lists only what the failing step actually received
                  and the right stays an honest empty panel. */}
              {runFailed && failStep && (
                <SpecCard title="Why it failed" muted="what the failing step received">
                  <div className="grid gap-3 p-3.5 sm:grid-cols-2">
                    <div className="overflow-hidden rounded-[7px] border border-[#cfe8d6]">
                      <div className="bg-[var(--archon-success-tint)] px-3 py-[7px] text-[11px] font-bold text-[var(--archon-success)]">
                        The failing step received
                      </div>
                      {inputKeys(failStep.inputJson).length > 0 ? (
                        inputKeys(failStep.inputJson).map(k => (
                          <div
                            key={k}
                            className="border-t border-[#eef0f3] px-3 py-[7px] font-mono text-[11px] text-[var(--archon-success)]"
                          >
                            ✓ {k}
                          </div>
                        ))
                      ) : (
                        <div className="border-t border-[#eef0f3] px-3 py-[7px] text-[11.5px] text-muted-foreground">
                          No input was recorded for this step.
                        </div>
                      )}
                    </div>
                    <EmptyPanel style={{ minHeight: 110 }}>
                      Context-visibility inspection arrives with the runtime's span capture.
                    </EmptyPanel>
                  </div>
                </SpecCard>
              )}

              <SpecCard title="Run record" muted="what Salesforce stored for this run">
                <Field label="Agent">{selected['AgentDefinition__r.Name']}</Field>
                <Field label="Department">{selected.Department__c ?? '—'}</Field>
                <Field label="Record">
                  <span className="font-mono">{selected.RecordId__c ?? '—'}</span>
                </Field>
                <Field label="Correlation id">
                  <span className="font-mono">{selected.CorrelationId__c ?? '—'}</span>
                </Field>
                <Field label="Score">
                  <span className="font-mono font-semibold" style={{ color: scoreColor(selected.AgentScore__c) }}>
                    {selected.AgentScore__c ?? '—'}
                  </span>
                </Field>
                <Field label="Priority">{selected.AgentPriority__c ?? '—'}</Field>
                <Field label="Tools used">{selected.ToolsUsed__c ?? '—'}</Field>
                <Field label="Status">
                  <StatusBadge tone={statusTone(selected.Status__c)}>{selected.Status__c}</StatusBadge>
                </Field>
                <Field label="Date">{new Date(selected.CreatedDate).toLocaleString()}</Field>
                {selected.AgentReason__c && (
                  <div className="border-t border-[#eceef1] px-3.5 py-3">
                    <div className="mb-1 text-[10.5px] font-semibold text-[var(--archon-faint)]">Reasoning</div>
                    <p className="text-[12px] leading-relaxed text-muted-foreground">{selected.AgentReason__c}</p>
                  </div>
                )}
                {selected.OutputPayload__c && (
                  <div className="border-t border-[#eceef1] px-3.5 py-3">
                    <div className="mb-1 text-[10.5px] font-semibold text-[var(--archon-faint)]">Output payload</div>
                    <pre className="max-h-56 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[10.5px]">
                      {selected.OutputPayload__c}
                    </pre>
                  </div>
                )}
              </SpecCard>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
