import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleDot,
  Mic,
  Paperclip,
  Plug,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { PageBody } from '@/components/shell/PageBody';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/spec/blocks';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import {
  listResumableBuilds,
  discardArchitectBuild,
  type ResumableBuild,
} from '@/lib/architect-data';
import { COPILOT } from '@/lib/copilot';

/**
 * The creation flow: choose → describe → build.
 *
 * "Build" is not a screen of its own any more. It is the Archon
 * conversation — the same component, agent and workspace the Home dock
 * opens — given a page's width. Describing an agent here and asking for
 * one from the dock now run the identical build; this page only supplies
 * the examples, the document attachment and the room.
 */

type Phase = 'choose' | 'describe' | 'building';

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
  const handoff = useLocation().state as { requirement?: string; sessionId?: string | null } | null;
  const carried = handoff?.sessionId ?? null;
  useEffect(() => {
    if (handoff?.requirement) {
      setText(handoff.requirement);
      setPhase('describe');
    }
    // A build moved here from the Home dock: same conversation, more room.
    if (handoff?.sessionId) setPhase('building');
  }, [handoff?.requirement, handoff?.sessionId]);
  const [attachment, setAttachment] = useState<{ name: string; content: string } | null>(null);
  /** What the build session opens with — a requirement to build, or an
   *  instruction to resume. The Architect runs inside the conversation, so
   *  this page and the Home dock show the identical workspace. */
  const [opening, setOpening] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  const [listening, setListening] = useState(false);
  const [resumable, setResumable] = useState<ResumableBuild[]>([]);
  const [discarding, setDiscarding] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<InstanceType<NonNullable<Window['SpeechRecognition']>> | null>(null);
  const voiceSupported =
    typeof window !== 'undefined' && !!(window.SpeechRecognition ?? window.webkitSpeechRecognition);

  useEffect(() => () => recognitionRef.current?.stop(), []);

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

  // ── Start the build ────────────────────────────────────────────────
  const build = useCallback(() => {
    const requirement = text.trim();
    if (requirement.length < 20) {
      toast.info('Tell me a little more', { description: 'A sentence or two about what the agent should do.' });
      return;
    }
    const doc = attachment?.content?.trim();
    setOpening(
      `Build me an agent. Here is what I need:

${requirement}` +
      (doc ? `

From the attached document "${attachment!.name}":
${doc.slice(0, 20_000)}` : ''),
    );
    setSeq(n => n + 1);
    setPhase('building');
  }, [text, attachment]);

  /**
   * Continue a build that stopped early. The server restores every finished
   * stage from its checkpoint, so this pays only for the stages that never
   * ran — the new ceiling is what has already been spent plus $2 of
   * headroom, so resuming can never cost more than starting fresh would.
   */
  const resumeById = useCallback(
    (jobId: string, alreadySpent: number) => {
      setOpening(`Resume the build ${jobId} from where it stopped, with a ceiling of $${(alreadySpent + 2).toFixed(2)}.`);
      setSeq(n => n + 1);
      setPhase('building');
    },
    [],
  );

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
                      disabled={discarding === b.jobId}
                    >
                      Finish this
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
              <Button onClick={build}>
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

  // ── The build session: the same chat and the same workspace the Home
  // dock shows, given a page's width so the design preview and the diff
  // are readable. One component, one mechanism, two placements.
  if (phase === 'building') {
    return (
      <AppShell title="New agent">
        <div className="flex h-full min-h-0 w-full flex-col">
          <div className="flex shrink-0 items-center gap-2 overflow-hidden border-b border-border px-5 py-2 text-[12px] text-muted-foreground max-sm:justify-between">
            <button type="button" className="hover:text-foreground" onClick={() => navigate('/')}>Agents</button>
            <span>/</span>
            <span className="font-semibold text-foreground">New agent</span>
            {/* What is being built, when there is room for it. On a narrow
                screen the way back matters more than the reminder. */}
            <span className="ml-auto hidden min-w-0 truncate pl-4 font-mono text-[11px] sm:block" title={text}>
              {carried ? 'Continued from Home' : text.slice(0, 120)}
            </span>
            <button type="button" className="shrink-0 font-semibold text-primary hover:underline" onClick={() => { setOpening(null); setPhase('describe'); }}>
              Start over
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <ChatPanel
              key={`build-${carried ?? seq}`}
              variant="full"
              agentApiName={COPILOT.apiName}
              agentName={COPILOT.name}
              initialSessionId={carried}
              initialMessage={carried ? null : opening ? { text: opening, how: 'type' } : null}
              onClose={() => navigate('/')}
              onMove={id => navigate('/', { state: { sessionId: id } })}
              moveLabel="Continue on Home"
            />
          </div>
        </div>
      </AppShell>
    );
  }
  return null;
}
