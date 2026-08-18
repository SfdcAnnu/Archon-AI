import type { NodeConfig, NodeType } from '@/types/agent';

export interface PaletteItem {
  nodeType: NodeType;
  nodeSubType: string;
  label: string;
  sub: string;
  /** Tailwind classes for the icon chip background+foreground. */
  iconClass: string;
  defaultConfig: NodeConfig;
}

export interface PaletteCategory {
  category: string;
  isNew?: boolean;
  items: PaletteItem[];
}

const PROVIDER_ICON_CLASS: Record<string, string> = {
  claude: 'bg-[color-mix(in_oklab,var(--primary)_12%,transparent)] text-primary',
  gpt4: 'bg-[#E6FAF5] text-[#10A37F] dark:bg-[#0e2a24] dark:text-[#3fd6ac]',
  gemini: 'bg-[#EAF2FE] text-[#4285F4] dark:bg-[#16233d] dark:text-[#7ba7f7]',
};

/** Mirrors agentCanvas.js's NODE_PALETTE — same categories, same node
 *  types, plus the two new ones (Subagents, Tools) this build adds. */
export const NODE_PALETTE: PaletteCategory[] = [
  {
    category: 'Triggers',
    items: [
      {
        nodeType: 'trigger',
        nodeSubType: 'webhook',
        label: 'Webhook',
        sub: 'Trigger',
        iconClass: 'bg-secondary text-muted-foreground',
        defaultConfig: {},
      },
    ],
  },
  {
    category: 'AI Models',
    items: [
      {
        nodeType: 'ai',
        nodeSubType: 'claude',
        label: 'Claude AI',
        sub: 'Anthropic',
        iconClass: PROVIDER_ICON_CLASS.claude,
        defaultConfig: { model: 'claude-opus-4-7', systemPrompt: '' },
      },
      {
        nodeType: 'ai',
        nodeSubType: 'gpt4',
        label: 'GPT (OpenAI)',
        sub: 'OpenAI',
        iconClass: PROVIDER_ICON_CLASS.gpt4,
        defaultConfig: { model: 'gpt-4o', systemPrompt: '' },
      },
      {
        nodeType: 'ai',
        nodeSubType: 'gemini',
        label: 'Gemini (Google)',
        sub: 'Google',
        iconClass: PROVIDER_ICON_CLASS.gemini,
        defaultConfig: { model: 'gemini-2.5-pro', systemPrompt: '' },
      },
    ],
  },
  {
    category: 'Subagents',
    isNew: true,
    items: [
      {
        nodeType: 'subagent',
        nodeSubType: 'claude',
        label: 'Subagent (Claude)',
        sub: 'Anthropic',
        iconClass: PROVIDER_ICON_CLASS.claude,
        defaultConfig: { routingDescription: '', systemPrompt: '', model: 'claude-sonnet-4-6' },
      },
      {
        nodeType: 'subagent',
        nodeSubType: 'gpt4',
        label: 'Subagent (OpenAI)',
        sub: 'OpenAI',
        iconClass: PROVIDER_ICON_CLASS.gpt4,
        defaultConfig: { routingDescription: '', systemPrompt: '', model: 'gpt-4o' },
      },
      {
        nodeType: 'subagent',
        nodeSubType: 'gemini',
        label: 'Subagent (Gemini)',
        sub: 'Google',
        iconClass: PROVIDER_ICON_CLASS.gemini,
        defaultConfig: { routingDescription: '', systemPrompt: '', model: 'gemini-2.5-pro' },
      },
    ],
  },
  {
    category: 'Tools',
    isNew: true,
    items: [
      {
        nodeType: 'tool',
        nodeSubType: 'tool',
        label: 'Tool',
        sub: 'MCP / Apex / Flow action',
        iconClass: 'bg-secondary text-muted-foreground',
        defaultConfig: {
          description: '',
          actionType: 'MCP',
          toolName: '',
          connectorId: '',
          requiresApproval: false,
        },
      },
    ],
  },
  {
    category: 'End',
    items: [
      {
        nodeType: 'end',
        nodeSubType: 'end',
        label: 'End flow',
        sub: 'End',
        iconClass: 'bg-secondary text-muted-foreground',
        defaultConfig: {},
      },
    ],
  },
];

export const MODEL_OPTIONS: Record<string, string[]> = {
  claude: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  gpt4: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
};
