import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentNode, SubagentNodeConfig } from '@/types/agent';
import {
  HANDLE_BASE,
  NODE_CARD_BASE,
  NODE_ICON_SQUARE,
  TOOL_HANDLE,
  accentStyle,
  providerAccent,
  selectedRing,
  typeStripStyle,
} from './node-styles';

export type AiRootFlowNode = { agentNode: AgentNode };

/** The root 'ai' orchestrator node — the top of the graph. Structural flow
 *  continues from the right ('out'); everything it can call (catalogs,
 *  subagents, tools) attaches from the bottom ('tool') — same anchor
 *  concept the approved mockup uses, now driven by real @xyflow/react
 *  handles instead of hand-rolled SVG. */
export function AiRootNode({ data, selected }: NodeProps & { data: AiRootFlowNode }) {
  const node = data.agentNode;
  const cfg = node.config as SubagentNodeConfig;
  return (
    <div
      className={cn(NODE_CARD_BASE, selectedRing(selected), 'w-[280px] border-2 px-3.5 pt-3 pb-5')}
      style={selected ? undefined : typeStripStyle('ai')}
    >
      <Handle type="target" id="in" position={Position.Left} className={HANDLE_BASE} />
      <div className="flex items-start gap-2.5">
        <div className={NODE_ICON_SQUARE} style={accentStyle(providerAccent(node.nodeSubType))}>
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-bold leading-tight text-foreground">{node.name}</div>
          <div className="mt-0.5 text-[10.5px] text-muted-foreground">
            AI Agent &middot; {node.nodeSubType}
          </div>
        </div>
      </div>
      {cfg?.systemPrompt && (
        <div className="mt-1.5 line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">
          {cfg.systemPrompt}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[8.5px] font-bold uppercase tracking-wide text-muted-foreground">
        Tools
      </div>
      <Handle type="source" id="out" position={Position.Right} className={HANDLE_BASE} />
      <Handle type="source" id="tool" position={Position.Bottom} className={TOOL_HANDLE} />
    </div>
  );
}
