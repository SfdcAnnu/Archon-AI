import type { AgentGraph } from '@/types/agent';

/**
 * Local stand-in for the real WhatsApp Lost-Opportunity Revival agent
 * (AgentDefinition__c a00g500000ouqVNAAY) — same shape the Salesforce data
 * layer will eventually return, so swapping the mock for a live GraphQL/
 * Apex-REST call later is a drop-in replacement, not a rewrite.
 */
export const MOCK_AGENT_GRAPH: AgentGraph = {
  agent: {
    id: 'a00g500000ouqVNAAY',
    apiName: 'whatsapp_lost_opportunity_revival',
    name: 'WhatsApp Lost-Opportunity Revival',
    department: 'Sales',
    description:
      'Reconnects with WhatsApp leads whose Opportunities have gone cold, negotiates on price within guardrails, and hands off to a human when needed.',
    knowledgeBase: '',
    status: 'Active',
    executeType: 'Chat',
    accessMode: 'Org',
    setupChecklist: [],
  },
  nodes: [
    {
      id: 'trigger1',
      name: 'Incoming WhatsApp Message',
      nodeType: 'trigger',
      nodeSubType: 'webhook',
      config: {},
      positionX: 40,
      positionY: 160,
      sortOrder: 0,
      isEnabled: true,
    },
    {
      id: 'root',
      name: 'Revival Conversation',
      nodeType: 'ai',
      nodeSubType: 'claude',
      config: {
        model: 'claude-opus-4-7',
        systemPrompt:
          'You are the revival conversation agent for GenWatt Generators. Re-engage the customer warmly, understand why the deal went cold, and route to a specialist subagent when the conversation needs it.',
      },
      positionX: 340,
      positionY: 100,
      sortOrder: 1,
      isEnabled: true,
      aiEngineConnectionId: 'conn_claude_1',
    },
    {
      id: 'output1',
      name: 'Send WhatsApp Reply',
      nodeType: 'end',
      nodeSubType: 'end',
      config: {},
      positionX: 760,
      positionY: 160,
      sortOrder: 2,
      isEnabled: true,
    },
    {
      id: 'catalog1',
      name: 'Salesforce Tools',
      nodeType: 'catalog',
      nodeSubType: 'salesforce_crm_tools',
      config: {
        description: 'Always-on read tools',
        connectorId: 'conn_sf_1',
        provider: 'salesforce_mcp',
        allowedTools: ['soqlQuery', 'getObjectSchema', 'getRelatedRecords', 'getUserInfo'],
      },
      positionX: 340,
      positionY: 340,
      sortOrder: 3,
      isEnabled: true,
    },
    {
      id: 'sub1',
      name: 'Price Negotiation',
      nodeType: 'subagent',
      nodeSubType: 'claude',
      config: {
        routingDescription:
          'Customer is discussing price, negotiating, or pushing back on cost.',
        systemPrompt:
          'You handle price negotiation for GenWatt Generators. Stay within the approved discount range (0-12%). If the customer pushes for more, hand the conversation back by explaining a manager needs to review — do not approve anything outside range yourself.',
        model: 'claude-sonnet-4-6',
      },
      positionX: 620,
      positionY: 340,
      sortOrder: 4,
      isEnabled: true,
    },
    {
      id: 'sub2',
      name: 'Escalation / Human Handoff',
      nodeType: 'subagent',
      nodeSubType: 'claude',
      config: {
        routingDescription:
          'Customer wants a discount beyond the approved range, or explicitly asks to speak with a human / requests a callback.',
        systemPrompt:
          'Acknowledge the request, apologize for any friction, and either create a follow-up Task for a human rep or schedule a meeting — whichever the customer prefers. Do not attempt to resolve the pricing question yourself.',
        model: 'claude-opus-4-7',
      },
      positionX: 960,
      positionY: 340,
      sortOrder: 5,
      isEnabled: true,
    },
    {
      id: 'tool1',
      name: 'Update Opportunity Stage',
      nodeType: 'tool',
      nodeSubType: 'tool',
      config: {
        description: 'Moves the Opportunity stage as the negotiation progresses.',
        actionType: 'MCP',
        toolName: 'updateSobjectRecord',
        connectorId: 'conn_sf_1',
        requiresApproval: false,
      },
      positionX: 620,
      positionY: 560,
      sortOrder: 6,
      isEnabled: true,
    },
    {
      id: 'tool2a',
      name: 'Escalate to Human',
      nodeType: 'tool',
      nodeSubType: 'tool',
      config: {
        description: 'Creates a Task for a human to follow up.',
        actionType: 'MCP',
        toolName: 'createSobjectRecord',
        connectorId: 'conn_sf_1',
        requiresApproval: true,
      },
      positionX: 900,
      positionY: 560,
      sortOrder: 7,
      isEnabled: true,
    },
    {
      id: 'tool2b',
      name: 'Schedule Meeting',
      nodeType: 'tool',
      nodeSubType: 'tool',
      config: {
        description:
          'Creates a Salesforce Event when the customer wants to schedule a meeting with a manager.',
        actionType: 'MCP',
        toolName: 'createSobjectRecord',
        connectorId: 'conn_sf_1',
        requiresApproval: false,
      },
      positionX: 1160,
      positionY: 560,
      sortOrder: 8,
      isEnabled: true,
    },
  ],
  connections: [
    { id: 'c1', fromNodeId: 'trigger1', fromPort: 'out', toNodeId: 'root', toPort: 'in' },
    { id: 'c2', fromNodeId: 'root', fromPort: 'out', toNodeId: 'output1', toPort: 'in' },
    { id: 'c3', fromNodeId: 'root', fromPort: 'tool', toNodeId: 'catalog1', toPort: 'in' },
    { id: 'c4', fromNodeId: 'root', fromPort: 'tool', toNodeId: 'sub1', toPort: 'in' },
    { id: 'c5', fromNodeId: 'root', fromPort: 'tool', toNodeId: 'sub2', toPort: 'in' },
    { id: 'c6', fromNodeId: 'sub1', fromPort: 'tool', toNodeId: 'tool1', toPort: 'in' },
    { id: 'c7', fromNodeId: 'sub2', fromPort: 'tool', toNodeId: 'tool2a', toPort: 'in' },
    { id: 'c8', fromNodeId: 'sub2', fromPort: 'tool', toNodeId: 'tool2b', toPort: 'in' },
  ],
};
