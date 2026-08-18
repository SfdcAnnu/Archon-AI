import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Cloud, GitMerge, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentNode, ToolNodeConfig } from '@/types/agent';
import { HANDLE_BASE, NODE_CARD_BASE, NODE_ICON_SQUARE, accentStyle, selectedRing, typeStripStyle, type NodeAccent } from './node-styles';

const ACTION_TYPE_META: Record<ToolNodeConfig['actionType'], { accent: NodeAccent; icon: typeof Cloud; badge: string }> = {
  MCP: { accent: 'blue', icon: Cloud, badge: 'MCP' },
  Apex: { accent: 'amber', icon: Wrench, badge: 'APEX' },
  Flow: { accent: 'green', icon: GitMerge, badge: 'FLOW' },
};

/** One individually-named callable action — a leaf in the graph (no
 *  outgoing port). Icon color follows action type (MCP/Apex/Flow), same
 *  "category tells you what it is at a glance" idea as the reference's
 *  node palette — blue for a connector call, amber for an Apex action,
 *  green for a Flow. */
export function ToolNode({ data, selected }: NodeProps & { data: { agentNode: AgentNode } }) {
  const node = data.agentNode;
  const cfg = node.config as ToolNodeConfig;
  const meta = ACTION_TYPE_META[cfg?.actionType] ?? ACTION_TYPE_META.MCP;
  const Icon = meta.icon;
  return (
    <div
      className={cn(NODE_CARD_BASE, selectedRing(selected), 'w-[210px] border px-2.5 py-2')}
      style={selected ? undefined : typeStripStyle('tool')}
    >
      <Handle type="target" id="in" position={Position.Top} className={HANDLE_BASE} />
      <div className="flex items-center gap-2.5">
        <div className={NODE_ICON_SQUARE} style={accentStyle(meta.accent)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-bold leading-tight text-foreground">{node.name}</div>
          <div className="truncate font-mono text-[9px] text-muted-foreground">
            {cfg?.toolName || '(not configured)'}
          </div>
        </div>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[8px] font-bold"
          style={accentStyle(meta.accent)}
        >
          {meta.badge}
        </span>
      </div>
    </div>
  );
}
