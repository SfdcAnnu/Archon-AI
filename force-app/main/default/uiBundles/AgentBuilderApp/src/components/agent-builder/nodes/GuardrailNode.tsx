import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentNode, GuardrailNodeConfig } from '@/types/agent';
import {
  HANDLE_BASE,
  NODE_CARD_BASE,
  NODE_ICON_SQUARE,
  accentStyle,
  selectedRing,
  typeStripStyle,
} from './node-styles';

export type GuardrailFlowNode = { agentNode: AgentNode };

export const MECHANISM_LABEL: Record<string, string> = {
  replyRule: 'Reply rule',
  numberLimit: 'Number limit',
  dataCapture: 'Data capture',
  followUpAction: 'Follow-up action',
  liveFacts: 'Live facts',
  customLogic: 'Custom logic',
};

/** One-line summary of what this guardrail instance enforces — shown on the
 *  card so a dense canvas still reads at a glance. */
function summarize(cfg: GuardrailNodeConfig): string | null {
  switch (cfg.mechanism) {
    case 'replyRule':
      return cfg.bannedWords?.length ? `Blocks: ${cfg.bannedWords.slice(0, 3).join(', ')}${cfg.bannedWords.length > 3 ? '…' : ''}` : null;
    case 'numberLimit':
      return cfg.maxDiscountField ? `Floor from ${cfg.maxDiscountField}` : null;
    case 'dataCapture':
      return cfg.targetField ? `Saves to ${cfg.targetField}` : null;
    case 'followUpAction':
      return cfg.toStage ? `${cfg.fromStage ?? '?'} → ${cfg.toStage}` : null;
    default:
      return null;
  }
}

/** A guardrail instance attached to an AI/subagent node — enforced by the
 *  server in code (deterministic), never "asked" via the prompt. The server
 *  maps every enabled guardrail node onto its enforcement engines; see
 *  server-langchain/src/chat/pricing-guardrails.ts readGuardrailsFromAgent. */
export function GuardrailNode({ data, selected }: NodeProps & { data: GuardrailFlowNode }) {
  const node = data.agentNode;
  const cfg = (node.config ?? {}) as GuardrailNodeConfig;
  const summary = summarize(cfg);
  return (
    <div
      className={cn(NODE_CARD_BASE, selectedRing(selected), 'w-[210px] px-3 py-2.5')}
      style={selected ? undefined : typeStripStyle('guardrail')}
    >
      <Handle type="target" id="in" position={Position.Top} className={HANDLE_BASE} />
      <div className="mb-1 text-[8.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--node-amber)' }}>
        Guardrail{cfg.mechanism ? ` · ${MECHANISM_LABEL[cfg.mechanism] ?? cfg.mechanism}` : ''}
      </div>
      <div className="flex items-start gap-2.5">
        <div className={NODE_ICON_SQUARE} style={accentStyle('amber')}>
          <ShieldCheck className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-bold leading-tight text-foreground">{node.name}</div>
          <div className="mt-0.5 text-[10.5px] text-muted-foreground">
            {cfg.mechanism ? (summary ?? 'Enforced in code') : 'Pick a mechanism →'}
          </div>
        </div>
      </div>
    </div>
  );
}
