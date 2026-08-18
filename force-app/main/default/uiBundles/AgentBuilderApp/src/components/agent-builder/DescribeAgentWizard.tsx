import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Loader2, Mic, MicOff, Sparkles, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { saveAgentGraph } from '@/lib/salesforce-data';
import {
  generateAgentFromRequirement,
  generatedResponseToGraph,
  type GeneratorMode,
  type QaTurn,
} from '@/lib/agent-generator-data';

export interface DescribeAgentWizardProps {
  onClose: () => void;
}

// SpeechRecognitionLike/Window.SpeechRecognition come from the app-wide
// ambient declaration (src/speech-recognition.d.ts) that ChatPanel.tsx's
// own voice input already uses — no local re-declaration needed here.
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

type Step = 'input' | 'questions' | 'generating' | 'error';

/**
 * "Describe your agent" — text, an attached document, or dictated voice
 * (live browser speech-to-text, no new audio-transcription backend needed)
 * in; a generated, already-saved agent out, opened straight on its real
 * canvas (chat mode) or automation review view (trigger mode — routing is
 * automatic, both land on `/agent/:apiName`, see AgentBuilder.tsx's own
 * executeType branch). One clarifying-question round-trip is handled here
 * if the generator asks (server/src/agent-generator/generate.ts allows at
 * most one) before it commits to a graph.
 */
export function DescribeAgentWizard({ onClose }: DescribeAgentWizardProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<GeneratorMode>('chat');
  const [requirementText, setRequirementText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [step, setStep] = useState<Step>('input');
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const runGenerate = useCallback(
    async (qaHistory: QaTurn[]) => {
      setStep('generating');
      setErrorMessage('');
      try {
        const fileBase64 = file ? await readFileAsBase64(file) : undefined;
        const resp = await generateAgentFromRequirement(requirementText, mode, {
          fileBase64,
          fileName: file?.name,
          qaHistory,
        });
        if (resp.kind === 'questions') {
          setQuestions(resp.questions);
          setAnswers(resp.questions.map(() => ''));
          setStep('questions');
          return;
        }
        const graph = generatedResponseToGraph(resp, mode);
        await saveAgentGraph(graph);
        onClose();
        navigate(`/agent/${graph.agent.apiName}`);
      } catch (err) {
        console.error('Agent generation failed:', err);
        setErrorMessage(err instanceof Error ? err.message : 'Generation failed.');
        setStep('error');
      }
    },
    [file, requirementText, mode, navigate, onClose]
  );

  const handleAnswerSubmit = () => {
    const qaHistory: QaTurn[] = questions.map((q, i) => ({ question: q, answer: answers[i] ?? '' }));
    runGenerate(qaHistory);
  };

  const canGenerate = requirementText.trim().length > 0 || file !== null;
  const showInputForm = step === 'input' || step === 'generating' || step === 'error';

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Describe your agent
          </DialogTitle>
          <DialogDescription>
            Tell Archon what it should do — type it, attach a document, or dictate it — and it builds
            the agent graph for you.
          </DialogDescription>
        </DialogHeader>

        {showInputForm && (
          <div className="space-y-4">
            <div className="flex gap-1.5 rounded-lg bg-secondary p-1">
              {(['chat', 'trigger'] as GeneratorMode[]).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  disabled={step === 'generating'}
                  className={cn(
                    'flex-1 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors',
                    mode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {m === 'chat' ? 'Chat agent' : 'Automation agent'}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {mode === 'chat'
                ? 'A conversational agent — WhatsApp, web chat, Slack.'
                : "A record-triggered automation — runs when a Salesforce record changes. Opens in a review-only view; edit it via the agent's Copilot."}
            </p>

            <div className="space-y-1.5">
              <Label>What should it do?</Label>
              <Textarea
                value={requirementText}
                onChange={e => setRequirementText(e.target.value)}
                placeholder="e.g. When a Lead goes cold for 14 days, message them on WhatsApp offering a discount, and escalate to a human if they ask a question we can't answer."
                className="min-h-28 text-xs"
                disabled={step === 'generating'}
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.pdf"
                className="hidden"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => fileInputRef.current?.click()}
                disabled={step === 'generating'}
              >
                <Upload className="mr-1.5 h-3 w-3" /> {file ? file.name : 'Attach a document'}
              </Button>
              {file && (
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Remove attached file"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <Button
                type="button"
                variant={recording ? 'destructive' : 'outline'}
                size="sm"
                className="h-7 text-[11px]"
                onClick={toggleRecording}
                disabled={step === 'generating'}
              >
                {recording ? <MicOff className="mr-1.5 h-3 w-3" /> : <Mic className="mr-1.5 h-3 w-3" />}
                {recording ? 'Stop' : 'Voice note'}
              </Button>
            </div>

            {errorMessage && <p className="text-[11.5px] text-destructive">{errorMessage}</p>}
          </div>
        )}

        {step === 'questions' && (
          <div className="space-y-4">
            <p className="text-[12px] text-muted-foreground">A couple of quick questions before Archon builds this:</p>
            {questions.map((q, i) => (
              <div key={i} className="space-y-1.5">
                <Label className="text-[11.5px]">{q}</Label>
                <Textarea
                  value={answers[i] ?? ''}
                  onChange={e => setAnswers(prev => prev.map((a, idx) => (idx === i ? e.target.value : a)))}
                  className="min-h-16 text-xs"
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={step === 'generating'}>
            Cancel
          </Button>
          {step === 'questions' ? (
            <Button size="sm" onClick={handleAnswerSubmit} disabled={answers.some(a => !a.trim())}>
              Continue
            </Button>
          ) : (
            <Button size="sm" onClick={() => runGenerate([])} disabled={!canGenerate || step === 'generating'}>
              {step === 'generating' && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              {step === 'generating' ? 'Generating…' : 'Generate agent'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
