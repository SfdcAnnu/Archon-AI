import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Cloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentNode, CatalogNodeConfig } from '@/types/agent';
import { HANDLE_BASE, NODE_CARD_BASE, NODE_ICON_SQUARE, accentStyle, selectedRing, typeStripStyle } from './node-styles';

/** A whole connector's tool list exposed in bulk (today's "Salesforce
 *  Tools" node) — the stacked-card look distinguishes "a group of tools"
 *  from a single named Tool node at a glance. Blue accent = MCP connector,
 *  matching the tool-node color convention. */
export function CatalogNode({ data, selected }: NodeProps & { data: { agentNode: AgentNode } }) {
  const node = data.agentNode;
  const cfg = node.config as CatalogNodeConfig;
  const count = cfg?.allowedTools?.length ?? 0;
  return (
    <div className="relative">
      <div className="absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-[var(--radius)] border border-border bg-secondary" />
      <div className="absolute inset-0 translate-x-3 translate-y-3 rounded-[var(--radius)] border border-border bg-secondary opacity-70" />
      <div
        className={cn(NODE_CARD_BASE, selectedRing(selected), 'relative w-[200px] px-3 py-2.5')}
        style={selected ? undefined : typeStripStyle('catalog')}
      >
        <Handle type="target" id="in" position={Position.Top} className={HANDLE_BASE} />
        <span className="absolute right-2.5 top-2.5 rounded-full bg-[var(--node-blue-tint)] px-2 py-0.5 text-[9px] font-bold text-[var(--node-blue)]">
          {count} tools
        </span>
        <div className="flex items-start gap-2.5 pr-8">
          <div className={NODE_ICON_SQUARE} style={accentStyle('blue')}>
            <Cloud className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-bold leading-tight text-foreground">
              {node.name}
            </div>
            <div className="truncate text-[10px] text-muted-foreground">{cfg?.description}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
