import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { AgentGraph } from '@/types/agent';

/** The agent's description + node-count summary — used to live inline in
 *  the properties panel by default (cluttering it even when a node was
 *  selected); now opt-in behind this icon so the default view stays quiet. */
export function AgentInfoPopover({ graph }: { graph: AgentGraph }) {
  // Chat and Trigger agents use different node vocabularies (see
  // server/src/agent-generator/spec.ts) — counting chat-only types against
  // a Trigger-mode agent would show an all-zero, misleading summary.
  const isChatMode = graph.agent.executeType === 'Chat';
  const catalogs = graph.nodes.filter(n => n.nodeType === 'catalog').length;
  const stats = isChatMode
    ? [
        ['Root agent', graph.nodes.filter(n => n.nodeType === 'ai').length],
        ['Subagents', graph.nodes.filter(n => n.nodeType === 'subagent').length],
        ['Tools', graph.nodes.filter(n => n.nodeType === 'tool').length],
        ['Tool catalogs', catalogs],
      ]
    : [
        ['Trigger', graph.nodes.filter(n => n.nodeType === 'trigger').length],
        ['AI steps', graph.nodes.filter(n => n.nodeType === 'ai').length],
        ['Logic + action steps', graph.nodes.filter(n => n.nodeType === 'logic' || n.nodeType === 'action').length],
        ['Tool catalogs', catalogs],
      ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="Agent info"
          title="Agent info"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="mb-1 text-[13px] font-bold text-foreground">{graph.agent.name}</div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{graph.agent.description}</p>
        <div className="grid grid-cols-2 gap-2">
          {stats.map(([label, count]) => (
            <div key={label} className="rounded-lg border border-border bg-secondary/60 px-3 py-2.5">
              <div className="text-lg font-bold text-primary">{count}</div>
              <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
