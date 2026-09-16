import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, Send, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { askArchon, OPERATION_LABEL, type CopilotOperation } from '@/lib/architect-data';
import type { AgentGraph, NodeConfig } from '@/types/agent';

/**
 * Ask Archon — the master agent, in the builder.
 *
 * It knows the org (read-only discovery) and the agent currently open, so
 * it can answer "can my org do X?", explain what a node does, and make
 * configuration changes on request. Changes are always PROPOSED: they show
 * as a small diff you Apply or Dismiss, and Apply only touches the canvas —
 * Save in the top bar is still what persists them.
 *
 * It cannot invent a tool, and it cannot change anything you have not seen.
 */
interface Turn {
  role: 'user' | 'assistant';
  content: string;
  operations?: CopilotOperation[];
  applied?: boolean;
}

const SUGGESTIONS = [
  'What can this agent do right now?',
  'Can my org send WhatsApp messages?',
  'Make the instructions shorter and warmer',
  'Should any of these actions need approval?',
];

export interface ArchonCopilotProps {
  graph: AgentGraph;
  onApplyOperations: (ops: CopilotOperation[]) => void;
  onClose: () => void;
}

export function ArchonCopilot({ graph, onApplyOperations, onClose }: ArchonCopilotProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  }, [turns, busy]);

  const send = useCallback(
    (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setInput('');
      const history = turns.map(t => ({ role: t.role, content: t.content }));
      setTurns(t => [...t, { role: 'user', content: message }]);
      setBusy(true);
      askArchon({
        message,
        history,
        agent: {
          apiName: graph.agent.apiName,
          name: graph.agent.name,
          department: graph.agent.department,
          nodes: graph.nodes.map(n => ({
            id: n.id,
            name: n.name,
            nodeType: n.nodeType,
            nodeSubType: n.nodeSubType,
            config: n.config as Record<string, unknown>,
          })),
        },
      })
        .then(res =>
          setTurns(t => [...t, { role: 'assistant', content: res.reply, operations: res.operations }]),
        )
        .catch(err =>
          setTurns(t => [
            ...t,
            {
              role: 'assistant',
              content:
                err instanceof Error ? err.message : "Something went wrong and I couldn't answer that.",
            },
          ]),
        )
        .finally(() => setBusy(false));
    },
    [busy, turns, graph],
  );

  const apply = (index: number, ops: CopilotOperation[]) => {
    onApplyOperations(ops);
    setTurns(t => t.map((turn, i) => (i === index ? { ...turn, applied: true } : turn)));
    toast.success(`${ops.length} change${ops.length === 1 ? '' : 's'} applied to the canvas`, {
      description: 'Save in the top bar to keep them.',
    });
  };

  const nodeName = (id: string) => graph.nodes.find(n => n.id === id)?.name ?? 'this step';

  return (
    <aside className="absolute inset-y-0 right-0 z-50 flex w-[400px] max-w-[92vw] flex-col border-l border-border bg-card shadow-2xl">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <div className="grid h-7 w-7 place-items-center rounded-[7px] bg-[var(--node-purple)] text-white">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-bold text-foreground">Ask Archon</div>
          <div className="truncate text-[11px] text-muted-foreground">Knows your org and this agent</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-secondary" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={listRef} className="flex-1 space-y-3.5 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Ask what this agent does, whether your org can support something, or tell me what to change —
              I'll show you the change before anything happens.
            </p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-lg border border-border px-3 py-2 text-left text-[12px] text-muted-foreground hover:border-primary hover:bg-[var(--node-blue-tint)] hover:text-primary"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-xl rounded-br-sm bg-primary px-3 py-2 text-[12.5px] leading-relaxed text-primary-foreground">
                {t.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex gap-2.5">
              <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[var(--node-purple-tint)] text-[var(--node-purple)]">
                <Sparkles className="h-3 w-3" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground">{t.content}</p>
                {t.operations && t.operations.length > 0 && (
                  <div className="mt-2 rounded-lg border border-border bg-secondary p-2.5">
                    <div className="mb-1.5 text-[11px] font-bold text-foreground">
                      {t.applied ? 'Applied to the canvas' : `${t.operations.length} proposed change${t.operations.length === 1 ? '' : 's'}`}
                    </div>
                    <ul className="space-y-1.5">
                      {t.operations.map((op, oi) => (
                        <li key={oi} className="text-[11.5px] leading-snug">
                          <span className="font-semibold text-foreground">
                            {OPERATION_LABEL[op.kind]} · {nodeName(op.nodeId)}
                          </span>
                          <div className="text-muted-foreground">{op.why}</div>
                          {typeof op.value === 'string' && op.value.length > 0 && (
                            <div className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-card p-1.5 font-mono text-[10.5px] text-muted-foreground">
                              {op.value.slice(0, 600)}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                    {!t.applied && (
                      <div className="mt-2 flex gap-1.5">
                        <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => apply(i, t.operations!)}>
                          <Check className="mr-1 h-3 w-3" /> Apply
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => setTurns(ts => ts.map((x, xi) => (xi === i ? { ...x, operations: [] } : x)))}
                        >
                          Dismiss
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ),
        )}

        {busy && (
          <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
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
                send(input);
              }
            }}
            rows={1}
            placeholder="Ask, or tell me what to change"
            className="max-h-28 min-h-[38px] flex-1 resize-none rounded-lg border border-border bg-card px-3 py-2 text-[12.5px] outline-none focus:border-primary"
          />
          <Button size="icon" className="h-9 w-9 shrink-0" disabled={busy || !input.trim()} onClick={() => send(input)}>
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </aside>
  );
}

/** Apply proposed operations to a graph — pure, so Dismiss is a
 *  structural guarantee rather than an undo. */
export function applyCopilotOperations(graph: AgentGraph, ops: CopilotOperation[]): AgentGraph {
  if (ops.length === 0) return graph;
  const patches = new Map<string, Partial<NodeConfig>>();
  for (const op of ops) {
    const patch = (patches.get(op.nodeId) ?? {}) as Record<string, unknown>;
    if (op.kind === 'setInstructions') patch.systemPrompt = op.value;
    if (op.kind === 'setDescription') patch.description = op.value;
    if (op.kind === 'setRoutingDescription') patch.routingDescription = op.value;
    if (op.kind === 'setModel') patch.model = op.value;
    if (op.kind === 'setApproval') patch.requiresApproval = op.value;
    if (op.kind === 'setContextPolicy') patch.contextPolicy = op.value;
    if (op.kind === 'setMode') patch.mode = op.value;
    patches.set(op.nodeId, patch as Partial<NodeConfig>);
  }
  return {
    ...graph,
    nodes: graph.nodes.map(n =>
      patches.has(n.id) ? { ...n, config: { ...n.config, ...patches.get(n.id) } } : n,
    ),
  };
}
