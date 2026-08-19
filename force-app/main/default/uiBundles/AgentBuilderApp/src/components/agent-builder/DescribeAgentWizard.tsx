import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Check, CheckCircle2, CircleHelp, Info, Loader2, Mic, MicOff, Sparkles, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { saveAgentGraph } from '@/lib/salesforce-data';
import {
  analyzeRequirement,
  generateAgentFromRequirement,
  generatedResponseToGraph,
  verifyCapabilityAnswer,
  type AnalyzeResponse,
  type Capability,
  type CapabilityResolution,
  type GeneratorMode,
  type ResolvedCapability,
} from '@/lib/agent-generator-data';
import type { AgentGraph, ToolNodeConfig } from '@/types/agent';

export interface DescribeAgentWizardProps {
  onClose: () => void;
}

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function readFileAsBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(f);
  });
}

type Step = 'input' | 'analyzing' | 'review' | 'generating' | 'preview';

/** Per-question capability answer state. `final` is set once the capability
 *  has a concrete resolution (option picked, or "Other" verified). */
interface AnswerState {
  selectedOptionId: string | null; // '__other__' = free text
  otherText: string;
  final: CapabilityResolution | null;
  finalSummary: string | null;
  /** Round-2 follow-up returned by verify — replaces the original question
   *  in the UI for this capability. Round 2 always finalizes server-side. */
  followup: NonNullable<Capability['question']> | null;
  followupSelectedId: string | null;
  followupOtherText: string;
  verifying: boolean;
  error: string | null;
}

function describeResolution(r: CapabilityResolution): string {
  switch (r.kind) {
    case 'catalog': return `Catalog on ${r.provider}: ${r.allowedTools.join(', ')}`;
    case 'mcp_tool': return `MCP tool ${r.toolName} on ${r.provider}`;
    case 'apex_tool': return `Apex action ${r.name}`;
    case 'flow_tool': return `Flow ${r.name}`;
    case 'instruction': return 'Handled in the agent’s instructions (no node)';
    case 'deferred': return `Connect later — checklist: ${r.checklistTitle}`;
  }
}

/**
 * "Describe your agent" v2 — the guided, grounded generation flow:
 * Describe -> Analyze (server inspects live MCP tools, org Apex/Flows,
 * objects) -> Review & answer (every capability resolved or questioned;
 * free-text "Other" answers verified server-side, max ONE follow-up
 * round) -> Preview (every node explained) -> Create.
 */
export function DescribeAgentWizard({ onClose }: DescribeAgentWizardProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<GeneratorMode>('chat');
  const [requirementText, setRequirementText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [step, setStep] = useState<Step>('input');
  const [errorMessage, setErrorMessage] = useState('');
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [removedTools, setRemovedTools] = useState<Record<string, string[]>>({});
  // Per-capability sign-off on auto-resolved bindings: nothing the analyzer
  // bound (a Flow, an Apex action, a tool) is accepted silently — the user
  // confirms each one, or writes a correction that gets re-verified against
  // the org and rebound.
  const [resolvedConfirmed, setResolvedConfirmed] = useState<Record<string, boolean>>({});
  const [commentOpen, setCommentOpen] = useState<Record<string, boolean>>({});
  const [resolvedComment, setResolvedComment] = useState<Record<string, string>>({});
  const [resolvedOverride, setResolvedOverride] = useState<Record<string, { resolution: CapabilityResolution; summary: string }>>({});
  const [resolvedVerifying, setResolvedVerifying] = useState<Record<string, boolean>>({});
  const [resolvedError, setResolvedError] = useState<Record<string, string | null>>({});
  const [generated, setGenerated] = useState<{ graph: AgentGraph; contract: ResolvedCapability[] } | null>(null);
  const [creating, setCreating] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Voice dictation (unchanged from v1) ───────────────────────────
  const toggleRecording = useCallback(() => {
    if (recording) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setErrorMessage('Voice dictation is not supported in this browser — try Chrome or Edge, or type/upload instead.');
      return;
    }
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = event => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      setRequirementText(prev => (prev.trim() ? prev.trim() + ' ' : '') + transcript);
    };
    recognition.onerror = () => setRecording(false);
    recognition.onend = () => setRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  }, [recording]);

  // ── Step 1 -> 2: analyze ──────────────────────────────────────────
  const runAnalyze = useCallback(async () => {
    setStep('analyzing');
    setErrorMessage('');
    try {
      const fileBase64 = file ? await readFileAsBase64(file) : undefined;
      const resp = await analyzeRequirement(requirementText, mode, { fileBase64, fileName: file?.name });
      const initial: Record<string, AnswerState> = {};
      for (const c of resp.plan.capabilities) {
        if (c.status === 'question') {
          initial[c.id] = {
            selectedOptionId: c.question?.recommendedId ?? null,
            otherText: '',
            final: null,
            finalSummary: null,
            followup: null,
            followupSelectedId: null,
            followupOtherText: '',
            verifying: false,
            error: null,
          };
        }
      }
      setAnswers(initial);
      setAnalysis(resp);
      setStep('review');
    } catch (err) {
      console.error('Analyze failed:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Analysis failed.');
      setStep('input');
    }
  }, [file, requirementText, mode]);

  // ── Review helpers ────────────────────────────────────────────────
  const questionCaps = useMemo(
    () => (analysis?.plan.capabilities ?? []).filter(c => c.status === 'question'),
    [analysis]
  );
  const resolvedCaps = useMemo(
    () => (analysis?.plan.capabilities ?? []).filter(c => c.status === 'resolved'),
    [analysis]
  );

  const pendingCount = useMemo(
    () =>
      questionCaps.filter(c => {
        const a = answers[c.id];
        if (!a) return true;
        if (a.final) return false;
        if (a.followup) return !(a.followupSelectedId && (a.followupSelectedId !== '__other__' || a.followupOtherText.trim()));
        return !(a.selectedOptionId && (a.selectedOptionId !== '__other__' || a.otherText.trim()));
      }).length,
    [questionCaps, answers]
  );

  const unconfirmedCount = useMemo(
    () => resolvedCaps.filter(c => !resolvedConfirmed[c.id]).length,
    [resolvedCaps, resolvedConfirmed]
  );

  /** "This binding is wrong, use X instead" — the comment goes through the
   *  same org-verification pass as any Other answer, at round 2 semantics
   *  so it ALWAYS finalizes (bind or defer) — no follow-up loops from a
   *  correction. The user still explicitly confirms the rebind. */
  const handleVerifyResolvedComment = useCallback(
    async (cap: Capability) => {
      const text = (resolvedComment[cap.id] ?? '').trim();
      if (!text || !analysis) return;
      setResolvedVerifying(prev => ({ ...prev, [cap.id]: true }));
      setResolvedError(prev => ({ ...prev, [cap.id]: null }));
      try {
        const result = await verifyCapabilityAnswer(cap, text, 2, mode, analysis.grounding);
        if (result.kind === 'resolved') {
          setResolvedOverride(prev => ({ ...prev, [cap.id]: { resolution: result.resolution, summary: result.userSummary } }));
          setCommentOpen(prev => ({ ...prev, [cap.id]: false }));
        }
      } catch (err) {
        setResolvedError(prev => ({ ...prev, [cap.id]: err instanceof Error ? err.message : 'Could not verify the note.' }));
      } finally {
        setResolvedVerifying(prev => ({ ...prev, [cap.id]: false }));
      }
    },
    [resolvedComment, analysis, mode]
  );

  const effectiveCatalogTools = useCallback(
    (cap: Capability): string[] => {
      if (cap.resolution?.kind !== 'catalog') return [];
      const removed = removedTools[cap.id] ?? [];
      return cap.resolution.allowedTools.filter(t => !removed.includes(t));
    },
    [removedTools]
  );

  const buildContract = useCallback((): ResolvedCapability[] => {
    if (!analysis) return [];
    const contract: ResolvedCapability[] = [];
    for (const c of analysis.plan.capabilities) {
      if (c.status === 'resolved' && c.resolution) {
        const override = resolvedOverride[c.id];
        const resolution = override
          ? override.resolution
          : c.resolution.kind === 'catalog'
            ? { ...c.resolution, allowedTools: effectiveCatalogTools(c) }
            : c.resolution;
        contract.push({ title: c.title, requirementQuote: c.requirementQuote, domain: c.domain, resolution });
      } else if (c.status === 'no_node') {
        contract.push({
          title: c.title,
          requirementQuote: c.requirementQuote,
          domain: c.domain,
          resolution: { kind: 'instruction', note: c.explanation ?? c.title },
        });
      } else if (c.status === 'question') {
        const a = answers[c.id];
        if (a?.final) {
          contract.push({ title: c.title, requirementQuote: c.requirementQuote, domain: c.domain, resolution: a.final });
        }
      }
    }
    return contract;
  }, [analysis, answers, effectiveCatalogTools, resolvedOverride]);

  // ── Step 2 -> 3: resolve answers (verify "Other"s), then generate ──
  const runGenerate = useCallback(
    async (contract: ResolvedCapability[]) => {
      if (!analysis) return;
      setStep('generating');
      setErrorMessage('');
      try {
        const resp = await generateAgentFromRequirement(analysis.requirementText, mode, {
          resolvedCapabilities: contract,
          grounding: analysis.grounding,
        });
        if (resp.kind === 'questions') {
          // Contract flow never asks — defensive only.
          throw new Error('Unexpected clarifying questions after review.');
        }
        setGenerated({ graph: generatedResponseToGraph(resp, mode), contract });
        setStep('preview');
      } catch (err) {
        console.error('Generation failed:', err);
        setErrorMessage(err instanceof Error ? err.message : 'Generation failed.');
        setStep('review');
      }
    },
    [analysis, mode]
  );

  const handleReviewContinue = useCallback(async () => {
    if (!analysis) return;
    setErrorMessage('');
    // Resolve every question capability that isn't final yet. Options are
    // instant; "Other" free text goes through the verify pass (round 1 may
    // return ONE follow-up; a follow-up's own answer is round 2 = always
    // final server-side).
    const next: Record<string, AnswerState> = { ...answers };
    let followupRaised = false;
    for (const cap of questionCaps) {
      const a = next[cap.id];
      if (!a || a.final) continue;

      const activeQuestion = a.followup ?? cap.question!;
      const selectedId = a.followup ? a.followupSelectedId : a.selectedOptionId;
      const otherText = a.followup ? a.followupOtherText : a.otherText;
      const round = a.followup ? 2 : 1;

      if (selectedId && selectedId !== '__other__') {
        const opt = activeQuestion.options.find(o => o.id === selectedId);
        if (opt) next[cap.id] = { ...a, final: opt.resolution, finalSummary: opt.description };
        continue;
      }
      if (selectedId === '__other__' && otherText.trim()) {
        next[cap.id] = { ...a, verifying: true, error: null };
        setAnswers({ ...next });
        try {
          const result = await verifyCapabilityAnswer(cap, otherText.trim(), round, mode, analysis.grounding);
          if (result.kind === 'resolved') {
            next[cap.id] = { ...next[cap.id], verifying: false, final: result.resolution, finalSummary: result.userSummary };
          } else {
            followupRaised = true;
            next[cap.id] = {
              ...next[cap.id],
              verifying: false,
              followup: result.question,
              followupSelectedId: result.question.recommendedId ?? null,
              followupOtherText: '',
            };
          }
        } catch (err) {
          next[cap.id] = {
            ...next[cap.id],
            verifying: false,
            error: err instanceof Error ? err.message : 'Could not verify the answer.',
          };
        }
        setAnswers({ ...next });
      }
    }
    setAnswers(next);

    const unresolved = questionCaps.some(c => !next[c.id]?.final);
    if (followupRaised || unresolved) return; // stay on review — follow-ups (or errors) to address

    const contract: ResolvedCapability[] = [];
    for (const c of analysis.plan.capabilities) {
      if (c.status === 'question') {
        const a = next[c.id];
        if (a?.final) contract.push({ title: c.title, requirementQuote: c.requirementQuote, domain: c.domain, resolution: a.final });
      }
    }
    // Merge with resolved/no_node built from current chip edits.
    const full = buildContract().filter(rc => !contract.some(x => x.title === rc.title));
    await runGenerate([...full, ...contract]);
  }, [analysis, answers, questionCaps, mode, buildContract, runGenerate]);

  // ── Step 4: create ────────────────────────────────────────────────
  const handleCreate = useCallback(() => {
    if (!generated) return;
    setCreating(true);
    saveAgentGraph(generated.graph)
      .then(() => {
        onClose();
        navigate(`/agent/${generated.graph.agent.apiName}`);
      })
      .catch(err => {
        console.error('Save failed:', err);
        setErrorMessage(err instanceof Error ? err.message : 'Save failed.');
        setCreating(false);
      });
  }, [generated, navigate, onClose]);

  const canAnalyze = requirementText.trim().length > 0 || file !== null;

  // Accidental dismissal protection: an outside click or Escape must NEVER
  // discard the flow (found live: a stray click mid-generation wiped the
  // whole analyze/review/build session). Closing is only via the ✕ — and
  // past the first step it asks; while building it refuses outright.
  const busy = step === 'analyzing' || step === 'generating' || creating;
  const handleRequestClose = useCallback(() => {
    if (busy) return;
    if (step !== 'input' && !window.confirm('Discard this agent draft? Your answers and plan will be lost.')) return;
    onClose();
  }, [busy, step, onClose]);

  const crumbs = (
    <div className="flex gap-1.5 text-[10px] font-semibold text-muted-foreground">
      {(['Describe', 'Review', 'Preview', 'Create'] as const).map((label, i) => {
        const active =
          (label === 'Describe' && (step === 'input' || step === 'analyzing')) ||
          (label === 'Review' && (step === 'review' || step === 'generating')) ||
          (label === 'Preview' && step === 'preview');
        return (
          <span key={label} className={cn(active && 'text-primary')}>
            {i > 0 && <span className="mr-1.5 text-muted-foreground">·</span>}
            {label}
          </span>
        );
      })}
    </div>
  );

  // ── Render helpers ────────────────────────────────────────────────
  const renderQuestionBlock = (cap: Capability) => {
    const a = answers[cap.id];
    if (!a) return null;

    if (a.final) {
      return (
        <div className="rounded-lg border border-[var(--archon-success,#1F9D61)]/40 bg-[var(--archon-success-tint,#E7F6EE)]/50 p-2.5">
          <div className="flex items-start gap-1.5 text-[11px] text-foreground">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--archon-success,#1F9D61)]" />
            <div>
              <span className="font-semibold">{describeResolution(a.final)}</span>
              {a.finalSummary && <div className="mt-0.5 text-[10.5px] text-muted-foreground">{a.finalSummary}</div>}
              <button
                type="button"
                className="mt-1 text-[10px] font-semibold text-primary hover:underline"
                onClick={() =>
                  setAnswers(prev => ({
                    ...prev,
                    [cap.id]: { ...prev[cap.id], final: null, finalSummary: null, followup: null },
                  }))
                }
              >
                Change answer
              </button>
            </div>
          </div>
        </div>
      );
    }

    const activeQuestion = a.followup ?? cap.question!;
    const selectedId = a.followup ? a.followupSelectedId : a.selectedOptionId;
    const otherText = a.followup ? a.followupOtherText : a.otherText;
    const setSelected = (id: string) =>
      setAnswers(prev => ({
        ...prev,
        [cap.id]: a.followup ? { ...prev[cap.id], followupSelectedId: id } : { ...prev[cap.id], selectedOptionId: id },
      }));
    const setOther = (text: string) =>
      setAnswers(prev => ({
        ...prev,
        [cap.id]: a.followup ? { ...prev[cap.id], followupOtherText: text } : { ...prev[cap.id], otherText: text },
      }));

    return (
      <div>
        {a.followup && (
          <p className="mb-1.5 text-[10px] font-semibold text-[var(--archon-warning,#B45309)]">
            One follow-up to finalize this — last question, promise:
          </p>
        )}
        <p className="mb-2 text-[11.5px] font-semibold text-foreground">{activeQuestion.text}</p>
        <div className="space-y-1.5">
          {activeQuestion.options.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setSelected(opt.id)}
              className={cn(
                'flex w-full items-start gap-2 rounded-lg border p-2.5 text-left',
                selectedId === opt.id ? 'border-primary bg-accent' : 'border-border hover:bg-secondary'
              )}
            >
              <span className={cn('mt-0.5 h-3 w-3 shrink-0 rounded-full border-2', selectedId === opt.id ? 'border-[4px] border-primary' : 'border-border')} />
              <span>
                <span className="block text-[11.5px] font-semibold text-foreground">
                  {opt.label}
                  {activeQuestion.recommendedId === opt.id && (
                    <span className="ml-1.5 rounded-full bg-[var(--archon-success-tint,#E7F6EE)] px-1.5 text-[8.5px] font-bold text-[var(--archon-success,#1F9D61)]">RECOMMENDED</span>
                  )}
                </span>
                <span className="mt-0.5 block text-[10.5px] leading-snug text-muted-foreground">{opt.description}</span>
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelected('__other__')}
            className={cn(
              'flex w-full items-start gap-2 rounded-lg border p-2.5 text-left',
              selectedId === '__other__' ? 'border-primary bg-accent' : 'border-border hover:bg-secondary'
            )}
          >
            <span className={cn('mt-0.5 h-3 w-3 shrink-0 rounded-full border-2', selectedId === '__other__' ? 'border-[4px] border-primary' : 'border-border')} />
            <span className="text-[11.5px] font-semibold text-foreground">Other — describe it yourself</span>
          </button>
          {selectedId === '__other__' && (
            <Textarea
              value={otherText}
              onChange={e => setOther(e.target.value)}
              placeholder='e.g. "we already have an autolaunched flow called OTP_Verification that sends and checks the OTP"'
              className="min-h-16 text-xs"
            />
          )}
        </div>
        {a.verifying && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Checking your description against the org…
          </p>
        )}
        {a.error && <p className="mt-1.5 text-[10.5px] text-destructive">{a.error}</p>}
      </div>
    );
  };

  const renderReview = () => {
    if (!analysis) return null;
    const caps = analysis.plan.capabilities;
    const domains = [...new Set(caps.map(c => c.domain).filter(Boolean))] as string[];
    return (
      <>
        <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
          {domains.length > 0 && (
            <div className="flex items-start gap-1.5 rounded-lg bg-accent/60 p-2.5 text-[10.5px] text-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>
                This agent is big enough to split into specialists: <b>{domains.join(' · ')}</b>. Each becomes a
                subagent owning its own tools — the main agent routes to them.
              </span>
            </div>
          )}
          {caps.map(cap => (
            <div key={cap.id} className="rounded-xl border border-border">
              <div className="flex items-start gap-2.5 p-3">
                <span
                  className={cn(
                    'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg',
                    cap.status === 'resolved' && 'bg-[var(--archon-success-tint,#E7F6EE)]',
                    cap.status === 'question' && 'bg-[var(--archon-warning-tint,#FEF3E0)]',
                    cap.status === 'no_node' && 'bg-secondary'
                  )}
                >
                  {cap.status === 'resolved' ? (
                    <Check className="h-3.5 w-3.5 text-[var(--archon-success,#1F9D61)]" />
                  ) : cap.status === 'question' ? (
                    <CircleHelp className="h-3.5 w-3.5 text-[var(--archon-warning,#B45309)]" />
                  ) : (
                    <Info className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12.5px] font-bold text-foreground">{cap.title}</span>
                    {cap.domain && (
                      <span className="rounded-full bg-[var(--node-purple-tint,#F3EEFD)] px-2 py-0.5 text-[8.5px] font-bold text-[var(--node-purple,#7C3AED)]">
                        {cap.domain}
                      </span>
                    )}
                    <span
                      className={cn(
                        'ml-auto rounded-full px-2 py-0.5 text-[8.5px] font-bold',
                        cap.status === 'resolved' && 'bg-[var(--archon-success-tint,#E7F6EE)] text-[var(--archon-success,#1F9D61)]',
                        cap.status === 'question' && 'bg-[var(--archon-warning-tint,#FEF3E0)] text-[var(--archon-warning,#B45309)]',
                        cap.status === 'no_node' && 'bg-secondary text-muted-foreground'
                      )}
                    >
                      {cap.status === 'resolved' ? 'RESOLVED' : cap.status === 'question' ? 'NEEDS YOUR ANSWER' : 'NO NODE NEEDED'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] italic text-muted-foreground">"{cap.requirementQuote}"</p>
                </div>
              </div>
              <div className="border-t border-dashed border-border px-3 py-2.5">
                {cap.status === 'resolved' && cap.resolution && (
                  <>
                    {resolvedOverride[cap.id] && (
                      <div className="mb-2 rounded-lg border border-primary/30 bg-accent/50 p-2 text-[11px]">
                        <span className="font-semibold text-primary">Rebound per your note:</span>{' '}
                        {describeResolution(resolvedOverride[cap.id].resolution)}
                        {resolvedOverride[cap.id].summary && (
                          <div className="mt-0.5 text-[10px] text-muted-foreground">{resolvedOverride[cap.id].summary}</div>
                        )}
                      </div>
                    )}
                    {!resolvedOverride[cap.id] && cap.resolution.kind === 'catalog' ? (
                      <>
                        <p className="text-[10.5px] text-muted-foreground">Only the tools this needs — click one to remove it:</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {effectiveCatalogTools(cap).map(t => (
                            <button
                              key={t}
                              type="button"
                              onClick={() =>
                                setRemovedTools(prev => ({ ...prev, [cap.id]: [...(prev[cap.id] ?? []), t] }))
                              }
                              className="rounded-full border border-primary bg-accent px-2.5 py-0.5 font-mono text-[10px] font-semibold text-primary hover:opacity-70"
                              title="Remove"
                            >
                              {t} ✕
                            </button>
                          ))}
                          {(removedTools[cap.id]?.length ?? 0) > 0 && (
                            <button
                              type="button"
                              className="text-[10px] font-semibold text-primary hover:underline"
                              onClick={() => setRemovedTools(prev => ({ ...prev, [cap.id]: [] }))}
                            >
                              restore removed
                            </button>
                          )}
                        </div>
                        <p className="mt-1.5 flex items-center gap-1 text-[9.5px] font-bold text-[var(--archon-success,#1F9D61)]">
                          <span className="h-1.5 w-1.5 rounded-full bg-[var(--archon-success,#1F9D61)]" /> verified against the live server just now
                        </p>
                      </>
                    ) : !resolvedOverride[cap.id] ? (
                      <p className="text-[11px] text-foreground">{describeResolution(cap.resolution)}
                        {cap.resolution.kind !== 'instruction' && (
                          <span className="ml-1.5 text-[9.5px] font-bold text-[var(--archon-success,#1F9D61)]">✓ exists in your org</span>
                        )}
                      </p>
                    ) : null}

                    {/* Per-binding sign-off: confirm it, or write what to use instead. */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      {resolvedConfirmed[cap.id] ? (
                        <span className="flex items-center gap-1 text-[10.5px] font-bold text-[var(--archon-success,#1F9D61)]">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Confirmed
                          <button
                            type="button"
                            className="ml-1 font-semibold text-primary hover:underline"
                            onClick={() => setResolvedConfirmed(prev => ({ ...prev, [cap.id]: false }))}
                          >
                            undo
                          </button>
                        </span>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 border-[var(--archon-success,#1F9D61)]/50 text-[10.5px] text-[var(--archon-success,#1F9D61)]"
                            onClick={() => setResolvedConfirmed(prev => ({ ...prev, [cap.id]: true }))}
                          >
                            <Check className="mr-1 h-3 w-3" /> Confirm
                          </Button>
                          <button
                            type="button"
                            className="text-[10px] font-semibold text-primary hover:underline"
                            onClick={() => setCommentOpen(prev => ({ ...prev, [cap.id]: !prev[cap.id] }))}
                          >
                            Not right? Tell me what to use instead
                          </button>
                        </>
                      )}
                    </div>
                    {commentOpen[cap.id] && !resolvedConfirmed[cap.id] && (
                      <div className="mt-2 space-y-1.5">
                        <Textarea
                          value={resolvedComment[cap.id] ?? ''}
                          onChange={e => setResolvedComment(prev => ({ ...prev, [cap.id]: e.target.value }))}
                          placeholder='e.g. "wrong flow — use Send_OTP_v2" or "this should call our Apex action VerifyCustomer instead"'
                          className="min-h-14 text-xs"
                        />
                        <Button
                          size="sm"
                          className="h-6 text-[10.5px]"
                          disabled={!(resolvedComment[cap.id] ?? '').trim() || resolvedVerifying[cap.id]}
                          onClick={() => handleVerifyResolvedComment(cap)}
                        >
                          {resolvedVerifying[cap.id] && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                          {resolvedVerifying[cap.id] ? 'Checking against your org…' : 'Verify my note'}
                        </Button>
                        {resolvedError[cap.id] && <p className="text-[10px] text-destructive">{resolvedError[cap.id]}</p>}
                      </div>
                    )}
                  </>
                )}
                {cap.status === 'no_node' && (
                  <p className="text-[10.5px] text-muted-foreground">{cap.explanation ?? 'Handled by the agent’s instructions.'}</p>
                )}
                {cap.status === 'question' && renderQuestionBlock(cap)}
              </div>
            </div>
          ))}
        </div>
        {errorMessage && <p className="mt-2 text-[11px] text-destructive">{errorMessage}</p>}
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10.5px] font-semibold text-[var(--archon-warning,#B45309)]">
            {[
              pendingCount > 0 ? `${pendingCount} question${pendingCount === 1 ? '' : 's'}` : null,
              unconfirmedCount > 0 ? `${unconfirmedCount} confirmation${unconfirmedCount === 1 ? '' : 's'}` : null,
            ].filter(Boolean).join(' · ')}
            {pendingCount + unconfirmedCount > 0 ? ' remaining' : ''}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setStep('input')}>
              <ArrowLeft className="mr-1 h-3 w-3" /> Back
            </Button>
            <Button size="sm" onClick={handleReviewContinue} disabled={pendingCount > 0 || unconfirmedCount > 0}>
              Continue to preview
            </Button>
          </div>
        </div>
      </>
    );
  };

  const renderPreview = () => {
    if (!generated) return null;
    const { graph, contract } = generated;
    const deferred = contract.filter(c => c.resolution.kind === 'deferred');
    const byId = new Map(graph.nodes.map(n => [n.id, n]));
    const parentOf = new Map<string, string>();
    for (const c of graph.connections) {
      if (!parentOf.has(c.toNodeId)) parentOf.set(c.toNodeId, c.fromNodeId);
    }
    const bindingOf = (nodeId: string): string => {
      const n = byId.get(nodeId)!;
      if (n.nodeType === 'ai') return `${n.nodeSubType} — full system prompt on the canvas`;
      if (n.nodeType === 'subagent') return 'Specialist subagent — own prompt & tools';
      if (n.nodeType === 'catalog') {
        const cfg = n.config as { provider?: string; allowedTools?: string[] };
        return `${(cfg.allowedTools ?? []).join(', ')} on ${cfg.provider ?? 'server'}`;
      }
      const cfg = n.config as ToolNodeConfig & { deferred?: boolean };
      if (cfg.deferred) return 'Connect later (Setup Checklist)';
      return `${cfg.actionType}: ${cfg.toolName}${cfg.actionType === 'MCP' ? ` on ${cfg.connectorId}` : ''}`;
    };
    return (
      <>
        <div className="mb-2.5 flex items-center gap-1.5 rounded-lg bg-[var(--archon-success-tint,#E7F6EE)] px-3 py-2 text-[11.5px] font-bold text-[var(--archon-success,#1F9D61)]">
          <CheckCircle2 className="h-4 w-4" /> Every node below is fully wired — no blank nodes.
        </div>
        <div className="max-h-[48vh] overflow-y-auto rounded-lg border border-border">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-secondary text-left text-[9px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2.5 py-1.5">Node</th>
                <th className="px-2.5 py-1.5">Why it exists</th>
                <th className="px-2.5 py-1.5">How it runs</th>
              </tr>
            </thead>
            <tbody>
              {graph.nodes.map(n => {
                const match = contract.find(
                  c =>
                    (c.resolution.kind === 'mcp_tool' && (n.config as ToolNodeConfig)?.toolName === c.resolution.toolName) ||
                    ((c.resolution.kind === 'apex_tool' || c.resolution.kind === 'flow_tool') &&
                      (n.config as ToolNodeConfig)?.toolName === c.resolution.name) ||
                    (c.resolution.kind === 'catalog' && n.nodeType === 'catalog')
                );
                const parent = parentOf.get(n.id);
                const parentName = parent ? byId.get(parent)?.name : null;
                return (
                  <tr key={n.id} className="border-t border-border align-top">
                    <td className="px-2.5 py-2">
                      <span className="font-bold text-foreground">{n.name}</span>
                      <div className="text-[9px] text-muted-foreground">
                        {n.nodeType}
                        {parentName && n.nodeType !== 'ai' ? ` · under ${parentName}` : ''}
                      </div>
                    </td>
                    <td className="px-2.5 py-2 text-muted-foreground">
                      {n.nodeType === 'ai'
                        ? 'The conversation brain — your requirement’s journey rules.'
                        : match
                          ? `${match.title} ("${match.requirementQuote}")`
                          : ((n.config as { routingDescription?: string; description?: string })?.routingDescription ??
                             (n.config as { description?: string })?.description ??
                             '')}
                    </td>
                    <td className="px-2.5 py-2">
                      <span className="font-mono text-[10px] text-foreground">{bindingOf(n.id)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Deferred to Setup Checklist: {deferred.length > 0 ? deferred.map(d => d.title).join(', ') : 'none'}
        </p>
        {errorMessage && <p className="mt-1 text-[11px] text-destructive">{errorMessage}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setStep('review')} disabled={creating}>
            <ArrowLeft className="mr-1 h-3 w-3" /> Back to review
          </Button>
          <Button size="sm" onClick={handleCreate} disabled={creating}>
            {creating && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
            {creating ? 'Creating…' : 'Create agent'}
          </Button>
        </div>
      </>
    );
  };

  return (
    <Dialog open onOpenChange={open => !open && handleRequestClose()}>
      <DialogContent
        className={cn(step === 'review' || step === 'preview' ? 'sm:max-w-2xl' : 'sm:max-w-lg')}
        onInteractOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              {analysis?.plan.agentName ?? 'Describe your agent'}
            </span>
            {crumbs}
          </DialogTitle>
          {step === 'input' && (
            <DialogDescription>
              Tell Archon what it should do — it inspects your org (live tools, Apex, Flows, objects), asks only
              what it can't answer itself, and shows you every node before anything is created.
            </DialogDescription>
          )}
        </DialogHeader>

        {(step === 'input' || step === 'analyzing') && (
          <div className="space-y-4">
            <div className="flex gap-1.5 rounded-lg bg-secondary p-1">
              {(['chat', 'trigger'] as GeneratorMode[]).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  disabled={step === 'analyzing'}
                  className={cn(
                    'flex-1 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors',
                    mode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {m === 'chat' ? 'Chat agent' : 'Automation agent'}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label>What should it do?</Label>
              <Textarea
                value={requirementText}
                onChange={e => setRequirementText(e.target.value)}
                placeholder="e.g. When a Lead goes cold for 14 days, message them on WhatsApp offering a discount, and escalate to a human if they ask a question we can't answer."
                className="min-h-28 text-xs"
                disabled={step === 'analyzing'}
              />
            </div>

            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" accept=".txt,.md,.pdf" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
              <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => fileInputRef.current?.click()} disabled={step === 'analyzing'}>
                <Upload className="mr-1.5 h-3 w-3" /> {file ? file.name : 'Attach a document'}
              </Button>
              {file && (
                <button type="button" onClick={() => setFile(null)} className="text-muted-foreground hover:text-foreground" aria-label="Remove attached file">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <Button type="button" variant={recording ? 'destructive' : 'outline'} size="sm" className="h-7 text-[11px]" onClick={toggleRecording} disabled={step === 'analyzing'}>
                {recording ? <MicOff className="mr-1.5 h-3 w-3" /> : <Mic className="mr-1.5 h-3 w-3" />}
                {recording ? 'Stop' : 'Voice note'}
              </Button>
            </div>

            {errorMessage && <p className="text-[11.5px] text-destructive">{errorMessage}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={onClose} disabled={step === 'analyzing'}>
                Cancel
              </Button>
              <Button size="sm" onClick={runAnalyze} disabled={!canAnalyze || step === 'analyzing'}>
                {step === 'analyzing' && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                {step === 'analyzing' ? 'Inspecting your org…' : 'Analyze requirement'}
              </Button>
            </div>
            {step === 'analyzing' && (
              <p className="text-[10.5px] text-muted-foreground">
                Checking live MCP tools, your Apex actions &amp; Flows, and org objects — usually under a minute.
              </p>
            )}
          </div>
        )}

        {(step === 'review' || step === 'generating') && (step === 'generating' ? (
          <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-[12px]">Building the agent from your approved plan…</p>
          </div>
        ) : (
          renderReview()
        ))}

        {step === 'preview' && renderPreview()}
      </DialogContent>
    </Dialog>
  );
}
