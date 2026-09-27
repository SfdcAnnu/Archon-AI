import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Bolt, Clock, GitBranch, Mail, MessageSquare, Send, Square, Wrench, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentNode, NodeType } from '@/types/agent';
import { HANDLE_BASE, NODE_CARD_BASE, NODE_ICON_SQUARE, accentStripStyle, accentStyle, selectedRing, type NodeAccent } from './node-styles';

const META: Partial<Record<NodeType, { icon: LucideIcon; accent: NodeAccent }>> = {
  trigger: { icon: Bolt, accent: 'blue' },
  logic: { icon: GitBranch, accent: 'purple' },
  action: { icon: Wrench, accent: 'amber' },
  email: { icon: Mail, accent: 'green' },
  sms: { icon: MessageSquare, accent: 'green' },
  storage: { icon: Wrench, accent: 'amber' },
  end: { icon: Send, accent: 'gray' },
};

/** Catch-all for trigger / end / action / logic / email / sms / storage —
 *  the automation-mode step types this build doesn't change the shape of.
 *  Compact single-row pill, icon color follows step category (blue
 *  trigger, purple logic/branch, amber action, green messaging, gray
 *  terminal) — same category-consistent coloring as every other node. */
export function SimpleNode({ data, selected, type }: NodeProps & { data: { agentNode: AgentNode } }) {
  const node = data.agentNode;
  const meta = META[node.nodeType] ?? { icon: Square, accent: 'gray' as NodeAccent };
  const Icon = node.nodeType === 'trigger' && node.nodeSubType === 'schedule' ? Clock : meta.icon;
  const isTrigger = node.nodeType === 'trigger';
  const isEnd = node.nodeType === 'end';
  return (
    <div
      className={cn(NODE_CARD_BASE, selectedRing(selected), 'px-2.5 py-2')}
      style={selected ? undefined : accentStripStyle(meta.accent)}
    >
      {!isTrigger && <Handle type="target" id="in" position={Position.Left} className={HANDLE_BASE} />}
      <div className="flex items-center gap-2.5">
        <div className={NODE_ICON_SQUARE} style={accentStyle(meta.accent)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <div className="whitespace-nowrap text-[12px] font-bold leading-tight text-foreground">
            {node.name}
          </div>
          <div className="text-[10px] capitalize text-muted-foreground">{type}</div>
        </div>
      </div>
      {!isEnd && <Handle type="source" id="out" position={Position.Right} className={HANDLE_BASE} />}
    </div>
  );
}
