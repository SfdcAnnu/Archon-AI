import { MessageCircle, Workflow, Layers } from 'lucide-react';

/**
 * The kind of agent, in the words a person uses, from the field the
 * platform stores (AgentDefinition__c.ExecuteType__c).
 *
 * The two kinds run on different machinery: a communication agent holds a
 * conversation with a person and stops at every reply; an automation agent
 * takes a record and a payload, works until the goal is met, and hands
 * back a result. The field existed, but nothing on screen said which was
 * which — a list of names, a canvas, and a person guessing.
 */
export type ExecuteType = 'Chat' | 'Trigger' | 'Both';
export type AgentKindKey = 'communication' | 'automation' | 'both';

export interface AgentKind {
  key: AgentKindKey;
  executeType: ExecuteType;
  label: string;
  short: string;
  blurb: string;
  Icon: typeof MessageCircle;
}

export const AGENT_KINDS: AgentKind[] = [
  {
    key: 'communication',
    executeType: 'Chat',
    label: 'Communication agent',
    short: 'Communication',
    blurb: 'Talks with a person — web chat, WhatsApp, the Home copilot. Keeps the conversation, stops at every reply, waits for the next message.',
    Icon: MessageCircle,
  },
  {
    key: 'automation',
    executeType: 'Trigger',
    label: 'Automation agent',
    short: 'Automation',
    blurb: 'Runs in one go from a Flow, Apex or a schedule: takes a record and a payload, works until the goal is met, returns a result (score, priority, reason, output).',
    Icon: Workflow,
  },
  {
    key: 'both',
    executeType: 'Both',
    label: 'Communication + Automation',
    short: 'Both',
    blurb: 'The same agent answers people in a conversation and can also be run in one go from a Flow or Apex.',
    Icon: Layers,
  },
];

export function agentKindOf(executeType: string | null | undefined): AgentKind {
  return AGENT_KINDS.find(k => k.executeType === executeType) ?? AGENT_KINDS[0];
}

export function executeTypeOfKind(key: AgentKindKey): ExecuteType {
  return AGENT_KINDS.find(k => k.key === key)?.executeType ?? 'Chat';
}
