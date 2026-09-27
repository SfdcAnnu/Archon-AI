import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentNode, GuardrailNodeConfig, GuardrailRule } from '@/types/agent';
import {
  HANDLE_BASE,
  NODE_CARD_BASE,
  NODE_ICON_SQUARE,
  accentStyle,
  selectedRing,
  typeStripStyle,
} from './node-styles';

export type GuardrailFlowNode = { agentNode: AgentNode };

function ruleLabel(r: GuardrailRule): string {
  if (r.kind === 'bannedWords') return `Blocks ${r.bannedWords?.length ?? 0} word${(r.bannedWords?.length ?? 0) === 1 ? '' : 's'}`;
  if (r.kind === 'numberLimit') return 'Price floor';
  return r.kind;
}

/** THE agent's guardrails — a single node per agent holding its restriction
 *  rules ("must never / only this"), enforced by the server in code. Data
 *  work (capture, stage updates) is NOT a guardrail — see AutomationNode. */
export function GuardrailNode({ data, selected }: NodeProps & { data: GuardrailFlowNode }) {
  const node = data.agentNode;
  const rules = ((node.config ?? {}) as GuardrailNodeConfig).rules ?? [];
  return (
    <div
      className={cn(NODE_CARD_BASE, selectedRing(selected), 'w-[220px] px-3 py-2.5')}
      style={selected ? undefined : typeStripStyle('guardrail')}
    >
      <Handle type="target" id="in" position={Position.Top} className={HANDLE_BASE} />
      <div className="mb-1 text-[8.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--node-amber)' }}>
        Guardrails
      </div>
      <div className="flex items-start gap-2.5">
        <div className={NODE_ICON_SQUARE} style={accentStyle('amber')}>
          <ShieldCheck className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-bold leading-tight text-foreground">{node.name}</div>
          <div className="mt-0.5 text-[10.5px] text-muted-foreground">
            {rules.length === 0 ? 'No rules yet →' : `${rules.length} rule${rules.length === 1 ? '' : 's'}`}
          </div>
        </div>
      </div>
      {rules.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {rules.slice(0, 3).map((r, i) => (
            <div key={i} className="truncate text-[10px] leading-snug text-muted-foreground">• {ruleLabel(r)}</div>
          ))}
          {rules.length > 3 && <div className="text-[10px] text-muted-foreground">+{rules.length - 3} more</div>}
        </div>
      )}
    </div>
  );
}
