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
  gpt4: 'bg-[var(--brand-openai-tint)] text-[var(--brand-openai)]',
  gemini: 'bg-[var(--brand-gemini-tint)] text-[var(--brand-gemini)]',
};

const LOGIC_ICON = 'bg-[var(--node-purple-tint)] text-[var(--node-purple)]';
const ACTION_ICON = 'bg-[var(--node-amber-tint)] text-[var(--node-amber)]';
const CONNECTOR_ICON = 'bg-[var(--node-green-tint)] text-[var(--node-green)]';

/** Mirrors agentCanvas.js's NODE_PALETTE — same categories, same node
 *  types, plus the two new ones (Subagents, Tools) this build adds. */
export const NODE_PALETTE: PaletteCategory[] = [
  {
    category: 'Triggers',
    // One per executor the automation runtime registers (server/src/nodes/trigger.ts).
    // A run starts at the Trigger node; without one it stops before it begins.
    items: [
      {
        nodeType: 'trigger',
        nodeSubType: 'record',
        label: 'Record / Flow',
        sub: 'Run from a Flow or Apex on a record',
        iconClass: 'bg-secondary text-muted-foreground',
        defaultConfig: {},
      },
      {
        nodeType: 'trigger',
        nodeSubType: 'schedule',
        label: 'Schedule',
        sub: 'Run on a schedule',
        iconClass: 'bg-secondary text-muted-foreground',
        defaultConfig: {},
      },
      {
        nodeType: 'trigger',
        nodeSubType: 'webhook',
        label: 'Webhook',
        sub: 'Run when an HTTP call arrives',
        iconClass: 'bg-secondary text-muted-foreground',
        defaultConfig: {},
      },
      {
        nodeType: 'trigger',
        nodeSubType: 'platform_event',
        label: 'Platform event',
        sub: 'Run when a platform event fires',
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
        label: 'Salesforce CRM Action',
        sub: 'Create / update / get / search — pick object & fields',
        iconClass: 'bg-[color-mix(in_oklab,var(--primary)_12%,transparent)] text-primary',
        defaultConfig: {
          description: '',
          actionType: 'Prebuilt',
          operation: 'create',
          object: '',
          selectedFields: [],
          boundFields: [],
          toolName: '',
          connectorId: '',
          requiresApproval: false,
        },
      },
      {
        nodeType: 'tool',
        nodeSubType: 'tool',
        label: 'MCP Tool',
        sub: 'Pick one tool from a connected MCP server',
        iconClass: 'bg-secondary text-muted-foreground',
        defaultConfig: {
          description: '',
          actionType: 'MCP',
          toolName: '',
          connectorId: '',
          requiresApproval: false,
        },
      },
      {
        nodeType: 'tool',
        nodeSubType: 'tool',
        label: 'Apex Action',
        sub: 'Your org’s invocable Apex, as a callable tool',
        iconClass: 'bg-[var(--node-amber-tint)] text-[var(--node-amber)]',
        defaultConfig: {
          description: '',
          actionType: 'Apex',
          toolName: '',
          connectorId: '',
          requiresApproval: false,
        },
      },
      {
        nodeType: 'tool',
        nodeSubType: 'tool',
        label: 'Flow Action',
        sub: 'An autolaunched Flow, as a callable tool',
        iconClass: 'bg-[var(--node-green-tint)] text-[var(--node-green)]',
        defaultConfig: {
          description: '',
          actionType: 'Flow',
          toolName: '',
          connectorId: '',
          requiresApproval: false,
        },
      },
      {
        nodeType: 'catalog',
        nodeSubType: 'catalog',
        label: 'Tool Catalog',
        sub: 'Many tools from one MCP server',
        iconClass: 'bg-secondary text-muted-foreground',
        defaultConfig: {
          description: '',
          connectorId: '',
          provider: '',
          allowedTools: [],
        },
      },
    ],
  },
  // The automation steps. Every one maps to an executor the automation
  // runtime registers (server-langchain/src/nodes/logic.ts, action.ts,
  // call-tool.ts); the exits each has are in lib/flow-nodes.ts.
  {
    category: 'Logic',
    isNew: true,
    items: [
      { nodeType: 'logic', nodeSubType: 'if_else', label: 'If / else', sub: 'Branch on a condition — Yes or No', iconClass: LOGIC_ICON, defaultConfig: { condition: '' } },
      { nodeType: 'logic', nodeSubType: 'loop', label: 'Loop', sub: 'Repeat steps for each item in a list', iconClass: LOGIC_ICON, defaultConfig: { collectionVar: '', iteratorVar: 'item', maxIterations: 25 } },
      { nodeType: 'logic', nodeSubType: 'wait', label: 'Wait', sub: 'Pause, then continue', iconClass: LOGIC_ICON, defaultConfig: { delayValue: 1, delayUnit: 'hours' } },
      { nodeType: 'logic', nodeSubType: 'approval', label: 'Approval', sub: 'Submit for approval, continue on the decision', iconClass: LOGIC_ICON, defaultConfig: { processDefinitionId: '', comments: '', timeoutHours: 48 } },
      { nodeType: 'logic', nodeSubType: 'set_variable', label: 'Set variable', sub: 'Keep a value for later steps', iconClass: LOGIC_ICON, defaultConfig: { variableName: '', template: '' } },
    ],
  },
  {
    category: 'Actions',
    isNew: true,
    items: [
      { nodeType: 'action', nodeSubType: 'query_records', label: 'Query records', sub: 'Run a SOQL query — a list for a Loop', iconClass: ACTION_ICON, defaultConfig: { soql: '', outputVariable: '' } },
      { nodeType: 'action', nodeSubType: 'get_record', label: 'Get record', sub: 'Read the trigger record', iconClass: ACTION_ICON, defaultConfig: { objectType: '', fields: 'Id,Name', outputVariable: '' } },
      { nodeType: 'action', nodeSubType: 'create_record', label: 'Create record', sub: 'Insert a record with the fields you map', iconClass: ACTION_ICON, defaultConfig: { objectType: '', fieldMappings: '{\n  \n}', outputVariable: '' } },
      { nodeType: 'action', nodeSubType: 'update_record', label: 'Update record', sub: 'Update the trigger record', iconClass: ACTION_ICON, defaultConfig: { objectType: '', fieldMappings: '{\n  \n}', outputVariable: '' } },
      { nodeType: 'action', nodeSubType: 'create_task', label: 'Create task', sub: 'A Task on the trigger record', iconClass: ACTION_ICON, defaultConfig: { subject: '', priority: 'Normal', dueDate: 'TODAY+1', outputVariable: '' } },
      { nodeType: 'action', nodeSubType: 'post_chatter', label: 'Post to Chatter', sub: 'A post on the trigger record', iconClass: ACTION_ICON, defaultConfig: { message: '', outputVariable: '' } },
      { nodeType: 'action', nodeSubType: 'call_tool', label: 'Send email / connector tool', sub: 'Call one tool — Gmail, Outlook, any connector', iconClass: CONNECTOR_ICON, defaultConfig: { provider: '', toolName: '', toolKind: 'standard', paramValues: {}, outputVariable: '' } },
    ],
  },
  // Guardrails/Automations palette entries removed at the user's request
  // (2026-09-03) — the server-side enforcement engines remain and read
  // invisible root-node config; the node types stay renderable so any
  // saved graph that still carries them doesn't break.
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
