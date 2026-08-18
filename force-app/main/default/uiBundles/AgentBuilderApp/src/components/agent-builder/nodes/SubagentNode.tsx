import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Waypoints } from 'lucide-react';
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

export type SubagentFlowNode = { agentNode: AgentNode };

/** A Level-2 domain-expert node — the root agent hands off to this via a
 *  callable "tool" the model itself selects (see server/src/chat/
 *  subagent-router.ts). Uses the same per-provider accent as an ai-root
 *  node (it IS an independent model call), with a routing/handoff icon
 *  rather than a generic branch glyph. */
export function SubagentNode({ data, selected }: NodeProps & { data: SubagentFlowNode }) {
  const node = data.agentNode;
  const cfg = node.config as SubagentNodeConfig;
  return (
    <div
      className={cn(NODE_CARD_BASE, selectedRing(selected), 'w-[260px] border-[1.5px] px-3 pt-2.5 pb-5')}
      style={selected ? undefined : typeStripStyle('ai')}
    >
      <Handle type="target" id="in" position={Position.Top} className={HANDLE_BASE} />
      <div className="mb-1 text-[8.5px] font-bold uppercase tracking-wide text-primary">Subagent</div>
      <div className="flex items-start gap-2.5">
        <div className={NODE_ICON_SQUARE} style={accentStyle(providerAccent(node.nodeSubType))}>
          <Waypoints className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-bold leading-tight text-foreground">{node.name}</div>
          <div className="mt-0.5 text-[10.5px] text-muted-foreground">
            Subagent &middot; {node.nodeSubType}
          </div>
        </div>
      </div>
      {cfg?.routingDescription && (
        <div className="mt-1.5 line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">
          {cfg.routingDescription}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[8.5px] font-bold uppercase tracking-wide text-muted-foreground">
        Tools
      </div>
      <Handle type="source" id="tool" position={Position.Bottom} className={TOOL_HANDLE} />
    </div>
  );
}
