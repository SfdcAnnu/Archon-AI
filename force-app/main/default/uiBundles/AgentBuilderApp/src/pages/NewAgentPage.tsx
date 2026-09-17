import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleDot,
  Loader2,
  Mic,
  Paperclip,
  Plug,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { PageBody } from '@/components/shell/PageBody';
import { Button } from '@/components/ui/button';
import { NoteBar, SpecCard, StatusBadge } from '@/components/spec/blocks';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import {
  startArchitectBuild,
  resumeArchitectBuild,
  listResumableBuilds,
  discardArchitectBuild,
  getArchitectBuild,
  ASSIGNEE_LABEL,
  type BuildJobView,
  type ResumableBuild,
} from '@/lib/architect-data';

/**
 * The creation flow: choose → describe → building → review.
 *
 * The happy path deliberately shows NO graph. The agent comes back as
 * numbered sentences with the outstanding setup as a checklist; the canvas
 * lives behind "Open the advanced view" for people who want to verify.
 */

type Phase = 'choose' | 'describe' | 'building' | 'review';

const EXAMPLES = [
  'Answer support questions from our help articles',
  'Chase renewals 90 days out',
  'Qualify inbound leads and book meetings',
  'Summarise a call and update the opportunity',
];

/** Files we can read in the browser. PDFs and Word need server extraction
 *  we have not wired here yet — say so rather than failing silently. */
const READABLE = /\.(txt|md|markdown|csv|json|log)$/i;

export default function NewAgentPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('choose');
  const [text, setText] = useState('');
  // Home hands over a requirement captured in chat: land on "describe"
  // with it already filled in, instead of making the person retype it.
  const handoff = (useLocation().state as { requirement?: string } | null)?.requirement;
  useEffect(() => {
    if (handoff) {
      setText(handoff);
      setPhase('describe');
    }
  }, [handoff]);
  const [attachment, setAttachment] = useState<{ name: string; content: string } | null>(null);
  const [listening, setListening] = useState(false);
  const [job, setJob] = useState<BuildJobView | null>(null);
  const [starting, setStarting] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resumable, setResumable] = useState<ResumableBuild[]>([]);
  const [discarding, setDiscarding] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<InstanceType<NonNullable<Window['SpeechRecognition']>> | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceSupported =
    typeof window !== 'undefined' && !!(window.SpeechRecognition ?? window.webkitSpeechRecognition);

  useEffect(
    () => () => {
      if (pollRef.current) clearTimeout(pollRef.current);
      recognitionRef.current?.stop();
    },
    [],
  );

  // Unfinished work is the first thing worth knowing on this screen — a
  // fresh page otherwise invites paying to rebuild what is already saved.
  // A failure here is silent: not being offered a resume is a missing
  // convenience, not a reason to block creating an agent.
  useEffect(() => {
    listResumableBuilds()
      .then(setResumable)
      .catch(() => setResumable([]));
  }, []);

  // ── Voice dictation — appends to whatever is typed ─────────────────
  const toggleVoice = useCallback(() => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';
    rec.onresult = e => {
      let heard = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) heard += e.results[i][0].transcript;
      }
      if (heard.trim()) setText(t => (t ? `${t} ${heard.trim()}` : heard.trim()));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }, [listening]);

  // ── Document attachment ────────────────────────────────────────────
  const handleFile = useCallback((file: File | undefined) => {
    if (!file) return;
    if (!READABLE.test(file.name)) {
      toast.info('I can read text files today', {
        description: 'For a PDF or Word document, paste the relevant part into the box for now.',
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAttachment({ name: file.name, content: String(reader.result ?? '').slice(0, 180_000) });
    };
    reader.readAsText(file);
  }, []);

  // ── Start + poll ───────────────────────────────────────────────────
  const poll = useCallback((jobId: string) => {
    getArchitectBuild(jobId)
      .then(view => {
        setJob(view);
        if (view.status === 'done') {
          setPhase('review');
          return;
        }
        // `paused` is a resting state with a button, not a step on the way
        // somewhere — polling it forever would just burn requests.
        if (view.status === 'failed' || view.status === 'paused') return;
        pollRef.current = setTimeout(() => poll(jobId), 2500);
      })
      .catch(() => {
        // A transient read failure must not kill the build — keep polling.
        pollRef.current = setTimeout(() => poll(jobId), 4000);
      });
  }, []);

  const build = useCallback(() => {
    const requirement = text.trim();
    if (requirement.length < 20) {
      toast.info('Tell me a little more', { description: 'A sentence or two about what the agent should do.' });
      return;
    }
    setStarting(true);
    startArchitectBuild({ requirement, attachmentText: attachment?.content })
      .then(jobId => {
        setPhase('building');
        setJob(null);
        poll(jobId);
      })
      .catch(err => {
        toast.error("Couldn't start the build", {
          description: err instanceof Error ? err.message : undefined,
        });
      })
      .finally(() => setStarting(false));
  }, [text, attachment, poll]);

  /**
   * Continue a build that stopped early. The server restores every finished
   * stage from its checkpoint, so this pays only for the stages that never
   * ran — the new ceiling is what has already been spent plus $2 of
   * headroom, so resuming can never cost more than starting fresh would.
   */
  const resumeById = useCallback(
    (jobId: string, alreadySpent: number) => {
      setResuming(true);
      resumeArchitectBuild(jobId, Number((alreadySpent + 2).toFixed(2)))
        .then(newJobId => {
          setPhase('building');
          setJob(null);
          poll(newJobId);
        })
        .catch(err => {
          toast.error("Couldn't resume the build", {
            description: err instanceof Error ? err.message : undefined,
          });
        })
        .finally(() => setResuming(false));
    },
    [poll],
  );

  const resume = useCallback(() => {
    if (job) resumeById(job.jobId, job.costUsd);
  }, [job, resumeById]);

  /** Forget a saved build. Removed from the list immediately — the row is
   *  gone either way, and leaving it on screen after the user asked for it
   *  to go reads as the button not working. */
  const discard = useCallback((jobId: string) => {
    setDiscarding(jobId);
    discardArchitectBuild(jobId)
      .then(() => setResumable(list => list.filter(b => b.jobId !== jobId)))
      .catch(err => {
        toast.error("Couldn't discard that build", {
          description: err instanceof Error ? err.message : undefined,
        });
      })
      .finally(() => setDiscarding(null));
  }, []);

  // ── Choose ─────────────────────────────────────────────────────────
  if (phase === 'choose') {
    return (
      <AppShell title="New agent">
        <PageBody width="read">
          <h1 className="text-[26px] font-bold tracking-tight text-foreground">How do you want to build this?</h1>
          <p className="mb-6 mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
            Either way works, and you can switch at any point. Most people start by describing it.
          </p>

          {/* Work already paid for, still finishable. Offered before the two
              build options on purpose: starting over is the expensive
              mistake, and it is the one a fresh page invites. */}
          {resumable.length > 0 && (
            <div className="mb-6 rounded-xl border border-[var(--archon-warning)] bg-[var(--archon-warning-tint)] p-4">
              <div className="text-[14px] font-bold text-foreground">
                You have {resumable.length === 1 ? 'a build' : `${resumable.length} builds`} you can finish
              </div>
              <p className="mb-3 mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                Everything {resumable.length === 1 ? 'it' : 'they'} finished is saved. Picking up where it
                stopped costs only the stages that never ran.
              </p>
              <div className="flex flex-col gap-2">
                {resumable.map(b => (
                  <div
                    key={b.jobId}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
                  >
                    <div className="min-w-[12rem] flex-1">
                      <div className="truncate text-[12.5px] font-medium text-foreground">{b.requirement}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-[var(--archon-faint)]">
                        {b.stagesDone}/{b.stagesTotal} stages done · ${b.costUsd.toFixed(2)} already spent
                      </div>
                      {/* A saved design is only as good as the rules it was
                          built under. Resuming an old one rebuilds the agent
                          those rules produced, which is rarely what someone
                          coming back to it wants. */}
                      {b.stale && (
                        <div className="mt-1 text-[11px] leading-snug text-[var(--archon-warning)]">
                          Built before the latest improvements — finishing it rebuilds the older design.
                          Starting fresh is usually better.
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant={b.stale ? 'outline' : 'default'}
                      onClick={() => resumeById(b.jobId, b.costUsd)}
                      disabled={resuming || discarding === b.jobId}
                    >
                      {resuming ? 'Resuming…' : 'Finish this'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => discard(b.jobId)}
                      disabled={discarding === b.jobId}
                    >
                      {discarding === b.jobId ? 'Discarding…' : 'Discard'}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col rounded-xl border border-primary bg-card p-5 shadow-[0_0_0_2px_var(--node-blue-tint)]">
              <div className="mb-3.5 flex items-center gap-2.5">
                <div className="grid h-10 w-10 place-items-center rounded-[10px] bg-[var(--node-purple)] text-white">
                  <Sparkles className="h-5 w-5" />
                </div>
                <StatusBadge tone="blue" className="ml-auto">Recommended</StatusBadge>
              </div>
              <div className="text-[17px] font-bold">Describe what you need</div>
              <p className="mb-4 mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                Tell me in plain language. I check what your Salesforce org can already do, design the agent,
                write every instruction, and tell you exactly what setup is still outstanding.
              </p>
              <ul className="mb-5 space-y-2 text-[12.5px] text-muted-foreground">
                {['About two minutes of your time', 'No Salesforce knowledge needed', 'Comes back with a cost estimate'].map(l => (
                  <li key={l} className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-[var(--archon-success)]" /> {l}
                  </li>
                ))}
              </ul>
              <Button className="mt-auto w-full" onClick={() => setPhase('describe')}>
                Describe it <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="flex flex-col rounded-xl border border-border bg-card p-5">
              <div className="mb-3.5 flex items-center gap-2.5">
                <div className="grid h-10 w-10 place-items-center rounded-[10px] bg-[var(--archon-faint)] text-white">
                  <Settings2 className="h-5 w-5" />
                </div>
              </div>
              <div className="text-[17px] font-bold">Build it yourself</div>
              <p className="mb-4 mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                Start from a blank canvas and place every step by hand. You pick the model, wire the tools, set
                the context policies and budgets. Full control, nothing decided for you.
              </p>
              <ul className="mb-5 space-y-2 text-[12.5px] text-muted-foreground">
                {['Takes longer', 'Assumes you know your org', 'You test it yourself'].map(l => (
                  <li key={l} className="flex items-center gap-2">
                    <CircleDot className="h-3 w-3 text-[var(--archon-faint)]" /> {l}
                  </li>
                ))}
              </ul>
              <Button variant="outline" className="mt-auto w-full" onClick={() => navigate('/?new=1')}>
                Open the canvas <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="mt-5 flex items-start gap-3 rounded-lg border border-dashed border-border bg-card px-4 py-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-[12.5px] leading-relaxed text-foreground">
              <b>Archon is in both.</b> On the canvas you can still ask it to fill in a step, explain a node, or
              check whether your org supports something. Describing first doesn't lock you out of the canvas either.
            </p>
          </div>
        </PageBody>
      </AppShell>
    );
  }

  // ── Describe ───────────────────────────────────────────────────────
  if (phase === 'describe') {
    return (
      <AppShell title="Describe it">
        <PageBody width="read">
          <button
            type="button"
            onClick={() => setPhase('choose')}
            className="mb-3.5 flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Choose a different way
          </button>
          <h1 className="text-[26px] font-bold tracking-tight text-foreground">What should this agent do?</h1>
          <p className="mb-6 mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
            Describe it the way you'd explain it to a colleague. I'll look at what your Salesforce org can
            already do and build the rest.
          </p>

          <div className="rounded-xl border border-border bg-card p-4">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="For example: when a deal goes cold, message the customer on WhatsApp and try to bring it back"
              className="min-h-[96px] w-full resize-none border-0 bg-transparent text-[15.5px] leading-relaxed outline-none placeholder:text-[var(--archon-faint)]"
            />

            {attachment && (
              <div className="mb-2 flex items-center gap-2">
                <StatusBadge tone="blue">
                  <Paperclip className="h-3 w-3" /> {attachment.name}
                  <button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment">
                    <X className="ml-0.5 h-3 w-3" />
                  </button>
                </StatusBadge>
                <span className="text-[11.5px] text-[var(--archon-faint)]">I'll read this along with what you type.</span>
              </div>
            )}

            <div className="flex items-center gap-2 border-t border-border pt-3">
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept=".txt,.md,.markdown,.csv,.json,.log"
                onChange={e => {
                  handleFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                title="Attach a requirements document"
                onClick={() => fileRef.current?.click()}
                className={cn(
                  'rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground',
                  attachment && 'text-primary',
                )}
              >
                <Paperclip className="h-4 w-4" />
              </button>
              {voiceSupported && (
                <button
                  type="button"
                  title={listening ? 'Stop dictating' : 'Dictate it instead of typing'}
                  onClick={toggleVoice}
                  className={cn(
                    'rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground',
                    listening && 'bg-destructive/10 text-destructive',
                  )}
                >
                  <Mic className="h-4 w-4" />
                </button>
              )}
              {listening && (
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-destructive">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" /> Listening… tap the mic to stop
                </span>
              )}
              <StatusBadge tone="muted" className="ml-auto">
                <Plug className="h-3 w-3" /> Salesforce connected
              </StatusBadge>
              <Button onClick={build} disabled={starting}>
                {starting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Build it <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <p className="mt-2 px-1 text-[12px] text-[var(--archon-faint)]">
            Type it, dictate it with the mic, or attach a requirements document — or any mix of the three.
          </p>

          <h3 className="mb-2.5 mt-7 text-[14px] font-bold">Or start from something common</h3>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map(e => (
              <button
                key={e}
                type="button"
                onClick={() => setText(e)}
                className="rounded-full border border-border bg-card px-3.5 py-1.5 text-[12.5px] text-muted-foreground hover:border-primary hover:bg-[var(--node-blue-tint)] hover:text-primary"
              >
                {e}
              </button>
            ))}
          </div>
        </PageBody>
      </AppShell>
    );
  }

  // ── Building ───────────────────────────────────────────────────────
  if (phase === 'building') {
    // A failure the server can still continue from — it kept the design, and
    // the repair for a late-gate rejection ships in code rather than in the
    // model's next attempt. Re-buying the survey and the design to pick that
    // up would be the same waste the checkpoint exists to end.
    const recoverable = job?.resumable === true;
    const failed = job?.status === 'failed';
    const paused = job?.status === 'paused';
    const canResume = paused || (failed && recoverable);
    const doneStages = (job?.steps ?? []).filter(s => s.state === 'done' || s.state === 'warn').length;
    return (
      <AppShell title="Building">
        <PageBody width="read">
          <h1 className="text-[26px] font-bold tracking-tight text-foreground">
            {paused
              ? 'Paused at your cost ceiling'
              : failed
                ? recoverable
                  ? 'Stopped at the last step'
                  : "I couldn't finish this one"
                : 'Building your agent'}
          </h1>
          <p className="mb-6 mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
            {canResume
              ? `The ${doneStages} stage${doneStages === 1 ? '' : 's'} below are finished and saved. Resuming picks up from there — you won't be charged for them again. If you close this tab, it is waiting for you under New agent.`
              : failed
                ? 'Here is what happened, in full.'
                : 'This takes a couple of minutes and runs in the background — you can leave this page and come back.'}
          </p>

          <SpecCard>
            {(job?.steps ?? []).map(s => (
              <div key={s.key} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                <span
                  className={cn(
                    'grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[11px] font-bold',
                    s.state === 'done' && 'bg-[var(--archon-success-tint)] text-[var(--archon-success)]',
                    s.state === 'warn' && 'bg-[var(--archon-warning-tint)] text-[var(--archon-warning)]',
                    s.state === 'running' && 'bg-[var(--node-blue-tint)] text-primary',
                    s.state === 'failed' && 'bg-[var(--archon-error-tint)] text-[var(--archon-error)]',
                    s.state === 'pending' && 'bg-secondary text-[var(--archon-faint)]',
                  )}
                >
                  {s.state === 'done' || s.state === 'warn' ? (
                    <Check className="h-3 w-3" />
                  ) : s.state === 'running' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : s.state === 'failed' ? (
                    <X className="h-3 w-3" />
                  ) : (
                    <CircleDot className="h-2.5 w-2.5" />
                  )}
                </span>
                <span className="flex-1 text-[13.5px]">{s.label}</span>
                {/* What this stage cost, so the expensive one is visible
                    rather than inferred from a single total. A reused stage
                    says so instead — it is the whole point of resuming. */}
                {s.reused ? (
                  <span className="font-mono text-[11px] text-[var(--archon-success)]">already paid</span>
                ) : s.costUsd != null && s.costUsd > 0 ? (
                  <span className="font-mono text-[11px] tabular-nums text-[var(--archon-faint)]">
                    ${s.costUsd.toFixed(3)}
                    {s.ms != null && s.ms > 1000 ? ` · ${Math.round(s.ms / 1000)}s` : ''}
                  </span>
                ) : null}
                {s.detail && (
                  <StatusBadge tone={s.state === 'warn' ? 'warn' : 'muted'}>{s.detail}</StatusBadge>
                )}
              </div>
            ))}
            {!job && (
              <div className="flex items-center gap-2 px-4 py-6 text-[12.5px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting…
              </div>
            )}
            <div className="flex gap-7 border-t border-border bg-secondary px-4 py-3.5">
              <div>
                <div className="text-[11px] text-[var(--archon-faint)]">So far</div>
                <div className="font-mono text-[19px] font-semibold">
                  {job ? `${Math.floor(job.elapsedMs / 60000)}m ${Math.floor((job.elapsedMs % 60000) / 1000)}s` : '—'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--archon-faint)]">Build cost</div>
                <div className="font-mono text-[19px] font-semibold">${(job?.costUsd ?? 0).toFixed(2)}</div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--archon-faint)]">Ceiling</div>
                <div className="font-mono text-[19px] font-semibold">${(job?.maxCostUsd ?? 2).toFixed(2)}</div>
              </div>
            </div>
            {(failed || paused) && job?.error && (
              <NoteBar tone={canResume ? 'warn' : 'error'}>{job.error}</NoteBar>
            )}
          </SpecCard>

          {canResume && (
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <Button onClick={resume} disabled={resuming}>
                {resuming ? 'Resuming…' : `Resume · up to $${((job?.costUsd ?? 0) + 2).toFixed(2)} total`}
              </Button>
              <Button variant="outline" onClick={() => setPhase('describe')}>
                Start over with a different description
              </Button>
            </div>
          )}

          {failed && !recoverable && (
            <div className="mt-4 flex gap-2.5">
              <Button onClick={() => setPhase('describe')}>Change what I asked for</Button>
              <Button variant="outline" onClick={build}>
                Try again
              </Button>
            </div>
          )}
        </PageBody>
      </AppShell>
    );
  }

  // ── Review ─────────────────────────────────────────────────────────
  const r = job?.result;
  if (!r) return null;
  const blocking = r.prerequisites.filter(p => p.blocking);
  return (
    <AppShell title="Review">
      <PageBody width="read">
        <h1 className="text-[26px] font-bold tracking-tight text-foreground">Here's what I built</h1>
        <p className="mb-6 mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
          Read it in plain English. If anything's wrong, tell me and I'll change it — you don't need to edit
          anything by hand.
        </p>

        <SpecCard
          title={r.apiName}
          right={
            blocking.length > 0 ? (
              <StatusBadge tone="warn">Waiting on {blocking.length}</StatusBadge>
            ) : (
              <StatusBadge tone="ok">Ready</StatusBadge>
            )
          }
        >
          {r.summarySteps.map((s, i) => (
            <div key={i} className="flex gap-3.5 border-b border-border px-4 py-3 last:border-b-0">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--node-blue-tint)] text-[12px] font-bold text-primary">
                {i + 1}
              </span>
              <span className="text-[13.5px] leading-relaxed">{s}</span>
            </div>
          ))}
          <div className="flex gap-7 border-t border-border bg-secondary px-4 py-3.5">
            <div>
              <div className="text-[11px] text-[var(--archon-faint)]">Per conversation</div>
              <div className="font-mono text-[19px] font-semibold">${r.estimate.costPerRunUsd.toFixed(3)}</div>
            </div>
            <div>
              <div className="text-[11px] text-[var(--archon-faint)]">Replies in</div>
              <div className="font-mono text-[19px] font-semibold">{r.estimate.latencySeconds}s</div>
            </div>
            <div>
              <div className="text-[11px] text-[var(--archon-faint)]">Build cost</div>
              <div className="font-mono text-[19px] font-semibold">${(job?.costUsd ?? 0).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[11px] text-[var(--archon-faint)]">Shape</div>
              <div className="text-[19px] font-semibold">{r.shape}</div>
            </div>
          </div>
        </SpecCard>

        {r.prerequisites.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-lg border border-[var(--node-amber)]">
            <div className="bg-[var(--archon-warning-tint)] px-4 py-3">
              <div className="text-[14px] font-bold text-[var(--archon-warning)]">
                {blocking.length > 0
                  ? `${blocking.length} thing${blocking.length === 1 ? '' : 's'} before this can go live`
                  : 'Optional setup'}
              </div>
              <div className="text-[12px] text-[var(--archon-warning)]">
                I can't create these for you — your org, your rules
              </div>
            </div>
            {r.prerequisites.map((p, i) => (
              <div key={p.id} className="flex gap-3.5 border-t border-border bg-card px-4 py-3.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--archon-warning-tint)] text-[12px] font-bold text-[var(--archon-warning)]">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold">{p.title}</div>
                  <div className="text-[11.5px] text-[var(--archon-faint)]">
                    {ASSIGNEE_LABEL[p.assignee] ?? p.assignee}
                    {p.estimatedEffort ? ` · about ${p.estimatedEffort}` : ''}
                    {p.blocking ? '' : ' · optional'}
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{p.why}</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-4 text-[12.5px] leading-relaxed text-muted-foreground">
                    {p.steps.map((st, si) => (
                      <li key={si}>{st}</li>
                    ))}
                  </ol>
                </div>
              </div>
            ))}
          </div>
        )}

        {(r.assumptions.length > 0 || r.notes.length > 0 || r.confidence) && (
          <SpecCard className="mt-4" title="What I'm least sure about">
            <div className="space-y-2 px-4 py-3.5 text-[12.5px] leading-relaxed text-muted-foreground">
              <p>{r.confidence}</p>
              {r.assumptions.map((a, i) => (
                <p key={`a${i}`}>· {a}</p>
              ))}
              {r.notes.map((n, i) => (
                <p key={`n${i}`}>· {n}</p>
              ))}
            </div>
          </SpecCard>
        )}

        <div className="mt-5 flex items-center gap-2.5">
          <Button onClick={() => navigate(`/agent/${r.apiName}`)}>Open the advanced view</Button>
          <Button variant="outline" onClick={() => navigate('/')}>
            Back to agents
          </Button>
          <Button variant="ghost" className="ml-auto" onClick={() => setPhase('describe')}>
            Change something
          </Button>
        </div>
      </PageBody>
    </AppShell>
  );
}
