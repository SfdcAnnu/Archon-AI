import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentNode, AutomationNodeConfig } from '@/types/agent';
import {
  HANDLE_BASE,
  NODE_CARD_BASE,
  NODE_ICON_SQUARE,
  accentStyle,
  selectedRing,
  accentStripStyle,
} from './node-styles';

export type AutomationFlowNode = { agentNode: AgentNode };

export const AUTOMATION_LABEL: Record<string, string> = {
  dataCapture: 'Data capture',
  followUpAction: 'Follow-up action',
};

function summarize(cfg: AutomationNodeConfig): string | null {
  if (cfg.mechanism === 'dataCapture') return cfg.targetField ? `Saves to ${cfg.targetField}` : null;
  if (cfg.mechanism === 'followUpAction') return cfg.toStage ? `${cfg.fromStage ?? '?'} → ${cfg.toStage}` : null;
  return null;
}

/** System work that happens deterministically alongside the conversation —
 *  "when X happens, the system does Y" (capture mentioned data, move the
 *  stage after an escalation). An n8n-style box, not a restriction; any
 *  number per agent. Enforced server-side, never prompt text. */
export function AutomationNode({ data, selected }: NodeProps & { data: AutomationFlowNode }) {
  const node = data.agentNode;
  const cfg = (node.config ?? {}) as AutomationNodeConfig;
  const summary = summarize(cfg);
  return (
    <div
      className={cn(NODE_CARD_BASE, selectedRing(selected), 'w-[210px] px-3 py-2.5')}
      style={selected ? undefined : accentStripStyle('green')}
    >
      <Handle type="target" id="in" position={Position.Top} className={HANDLE_BASE} />
      <div className="mb-1 text-[8.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--node-green)' }}>
        Automation{cfg.mechanism ? ` · ${AUTOMATION_LABEL[cfg.mechanism] ?? cfg.mechanism}` : ''}
      </div>
      <div className="flex items-start gap-2.5">
        <div className={NODE_ICON_SQUARE} style={accentStyle('green')}>
          <Zap className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-bold leading-tight text-foreground">{node.name}</div>
          <div className="mt-0.5 text-[10.5px] text-muted-foreground">
            {cfg.mechanism ? (summary ?? 'Runs automatically') : 'Pick what it does →'}
          </div>
        </div>
      </div>
    </div>
  );
}
