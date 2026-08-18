import { useCallback, useRef, useState } from 'react';
import { Bot, Check, Loader2, Send, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { askCopilot, type CopilotOperation, type CopilotTurn } from '@/lib/copilot-data';
import { summarizeCopilotOperations } from '@/lib/copilot-apply';
import type { GeneratorMode } from '@/lib/agent-generator-data';
import type { AgentGraph } from '@/types/agent';

export interface CopilotPanelProps {
  graph: AgentGraph;
  mode: GeneratorMode;
  onApply: (ops: CopilotOperation[]) => void;
  onClose: () => void;
}

interface DisplayMessage {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Persistent chat that modifies the CURRENT agent via natural language.
 * Preview-then-confirm by construction: a turn's proposed operations sit in
 * `pendingOps` (this component's own local state) and are only ever handed
 * to `onApply` — which is what actually touches real graph state, see
 * AgentBuilder.tsx's handleApplyCopilotOperations — on an explicit Apply
 * click. Discard just clears local state; the real graph was never touched,
 * so there's nothing to undo. The input is disabled while a proposal is
 * pending so the model is never reasoning against a graph mid-edit from an
 * unresolved earlier turn.
 */
export function CopilotPanel({ graph, mode, onApply, onClose }: CopilotPanelProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingOps, setPendingOps] = useState<CopilotOperation[] | null>(null);
  const [pendingSummary, setPendingSummary] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || loading || pendingOps) return;
    const history: CopilotTurn[] = messages.map(m => ({ role: m.role, text: m.text }));
    setMessages(prev => [...prev, { role: 'user', text }]);
    setInput('');
    setLoading(true);
    setError('');
    scrollToBottom();

    askCopilot(graph, mode, text, history)
      .then(resp => {
        const summary = resp.operations.length > 0 ? summarizeCopilotOperations(resp.operations, graph) : [];
        const replyText =
          resp.assistantText ||
          (resp.operations.length > 0 ? 'Here is what I would change:' : "I didn't find anything to change for that.");
        setMessages(prev => [...prev, { role: 'assistant', text: replyText }]);
        if (resp.operations.length > 0) {
          setPendingOps(resp.operations);
          setPendingSummary(summary);
        }
      })
      .catch(err => {
        console.error('Copilot request failed:', err);
        setError(err instanceof Error ? err.message : 'Copilot request failed.');
      })
      .finally(() => {
        setLoading(false);
        scrollToBottom();
      });
  }, [input, loading, pendingOps, messages, graph, mode, scrollToBottom]);

  const handleApply = useCallback(() => {
    if (!pendingOps) return;
    onApply(pendingOps);
    setMessages(prev => [...prev, { role: 'assistant', text: `Applied ${pendingOps.length} change${pendingOps.length === 1 ? '' : 's'}.` }]);
    setPendingOps(null);
    setPendingSummary([]);
    scrollToBottom();
  }, [pendingOps, onApply, scrollToBottom]);

  const handleDiscard = useCallback(() => {
    setMessages(prev => [...prev, { role: 'assistant', text: 'Discarded — nothing changed.' }]);
    setPendingOps(null);
    setPendingSummary([]);
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    <div className="absolute inset-y-0 right-0 z-50 flex w-[400px] max-w-[92vw] flex-col border-l border-border bg-card shadow-2xl">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="flex items-center gap-1.5 text-[13.5px] font-bold text-foreground">
          <Sparkles className="h-4 w-4 text-primary" /> Copilot
        </span>
        <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-muted" aria-label="Close copilot">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <Bot className="h-6 w-6" />
            <p className="max-w-[220px] text-[12px] leading-relaxed">
              Ask me to add a tool, rewire a connection, change a step's instructions — anything on this
              agent. I'll show you the change before it's applied.
            </p>
          </div>
        )}
        <div className="space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-lg px-3 py-2 text-[12.5px] leading-relaxed',
                  m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'
                )}
              >
                {m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
            </div>
          )}
          {error && <p className="text-[11.5px] text-destructive">{error}</p>}
        </div>

        {pendingOps && pendingOps.length > 0 && (
          <div className="mt-3 rounded-lg border border-primary/30 bg-accent/40 p-3">
            <div className="mb-2 text-[10.5px] font-bold uppercase tracking-wide text-primary">
              Proposed changes
            </div>
            <ul className="mb-3 space-y-1">
              {pendingSummary.map((line, i) => (
                <li key={i} className="text-[12px] leading-relaxed text-foreground/90">
                  • {line}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={handleDiscard}>
                Discard
              </Button>
              <Button size="sm" className="h-7 text-[11px]" onClick={handleApply}>
                <Check className="mr-1 h-3 w-3" /> Apply
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={pendingOps ? 'Apply or discard the proposal above first…' : 'Describe a change…'}
            disabled={loading || Boolean(pendingOps)}
            rows={2}
            className="min-h-[40px] flex-1 resize-none rounded-md border border-input bg-transparent px-2.5 py-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          />
          <Button
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleSend}
            disabled={loading || Boolean(pendingOps) || !input.trim()}
            aria-label="Send"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
