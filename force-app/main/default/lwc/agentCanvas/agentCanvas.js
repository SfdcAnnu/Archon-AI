import { LightningElement, track, api, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getAgentWithNodes from '@salesforce/apex/AgentBuilderController.getAgentWithNodes';
import saveAgentWithNodes from '@salesforce/apex/AgentBuilderController.saveAgentWithNodes';
import getDirectory from '@salesforce/apex/AgentConnectorController.getDirectory';
import startOAuth from '@salesforce/apex/AgentConnectorController.startOAuth';

// Tool defaults come from each MCP server's live GET /tools catalog
// (read-only tools pre-selected by the properties panel) — no hardcoded
// tool-name lists here; they drift from the real MCP tool names.

// ── Node palette definition — every available node type ─────────────
const NODE_PALETTE = [
    {
        category: 'Triggers',
        nodes: [
            { type: 'trigger', subType: 'record',    label: 'Record trigger',   icon: 'utility:database',    color: '#0176d3', mcpServer: 'salesforce-crm',  mcpTool: 'record_trigger' },
            { type: 'trigger', subType: 'schedule',  label: 'Schedule',         icon: 'utility:clock',       color: '#0176d3', mcpServer: 'salesforce-crm',  mcpTool: 'schedule_trigger' },
            { type: 'trigger', subType: 'webhook',   label: 'Webhook',          icon: 'utility:connected_apps', color: '#0176d3', mcpServer: null, mcpTool: 'webhook' },
            { type: 'trigger', subType: 'platform_event', label: 'Platform event', icon: 'utility:events', color: '#0176d3', mcpServer: 'salesforce-crm', mcpTool: 'platform_event' },
        ]
    },
    {
        category: 'AI Models',
        nodes: [
            { type: 'ai', subType: 'claude',    label: 'Claude AI',   icon: 'utility:einstein',    color: '#7c4dff', mcpServer: 'anthropic',           mcpTool: 'claude_complete' },
            { type: 'ai', subType: 'gpt4',      label: 'GPT (OpenAI)', icon: 'utility:einstein',   color: '#10a37f', mcpServer: 'openai',              mcpTool: 'gpt_complete' },
            { type: 'ai', subType: 'gemini',    label: 'Gemini (Google)', icon: 'utility:einstein', color: '#4285f4', mcpServer: 'gemini',              mcpTool: 'gemini_complete' },
            { type: 'ai', subType: 'einstein',  label: 'Einstein AI', icon: 'utility:Einstein_GPT', color: '#7c4dff', mcpServer: 'salesforce-einstein', mcpTool: 'einstein_predict' },
            { type: 'ai', subType: 'sentiment', label: 'Sentiment',   icon: 'utility:sentiment_positive', color: '#7c4dff', mcpServer: 'anthropic',           mcpTool: 'sentiment_analyze' },
            { type: 'ai', subType: 'embed',     label: 'Embeddings',  icon: 'utility:matrix',      color: '#7c4dff', mcpServer: 'openai',              mcpTool: 'embed_text' },
        ]
    },
    // Connector-backed capabilities (Salesforce tools, storage, email, channels)
    // live in the Connectors tab — drag a connected provider onto the canvas.
    {
        category: 'Logic',
        nodes: [
            { type: 'logic', subType: 'if_else',  label: 'If / Else',     icon: 'utility:flow', color: '#5c6bc0', mcpServer: null, mcpTool: 'if_else' },
            { type: 'logic', subType: 'loop',     label: 'Loop',           icon: 'utility:repeat', color: '#5c6bc0', mcpServer: null, mcpTool: 'loop' },
            { type: 'logic', subType: 'wait',     label: 'Wait / Delay',   icon: 'utility:pause', color: '#5c6bc0', mcpServer: null, mcpTool: 'wait' },
            { type: 'logic', subType: 'approval', label: 'Approval gate',  icon: 'utility:approval', color: '#5c6bc0', mcpServer: null, mcpTool: 'approval' },
        ]
    },
    {
        category: 'End',
        nodes: [
            { type: 'end', subType: 'end', label: 'End flow', icon: 'utility:stop', color: '#78909c', mcpServer: null, mcpTool: 'end' },
        ]
    }
];

// ── Default config per node sub-type ────────────────────────────────
const DEFAULT_CONFIG = {
    record:       { objectType: 'Lead', triggerOn: 'Create' },
    schedule:     { cronExpression: '0 0 8 * * ?' },
    // ── AI model nodes — orchestrators with full reasoning config ──
    claude:       {
        model: 'claude-opus-4-7',
        instruction: '',
        systemPrompt: '',
        useKnowledgeBase: true,
        fewShotExamples: [],
        dispatchMode: 'two_tier',
        maxToolCalls: 12,
        captureReasoning: true,
        effort: 'high',
        adaptiveThinking: true,
        maxTokens: 16000
    },
    gpt4: {
        model: 'gpt-4o',
        instruction: '',
        systemPrompt: '',
        useKnowledgeBase: true,
        fewShotExamples: [],
        dispatchMode: 'two_tier',
        maxToolCalls: 12,
        captureReasoning: true,
        temperature: 0.3,
        maxTokens: 4000
    },
    gemini: {
        model: 'gemini-2.5-flash',
        instruction: '',
        systemPrompt: '',
        useKnowledgeBase: true,
        fewShotExamples: [],
        dispatchMode: 'two_tier',
        maxToolCalls: 12,
        captureReasoning: true,
        temperature: 0.3,
        maxTokens: 4000
    },
    einstein:     { modelType: 'predict' },
    // ── Tool catalog nodes — declarations, consumed by upstream AI orchestrator ──
    salesforce_crm_tools: {
        connectorId: '',
        allowedTools: ['list_sobjects', 'describe_sobject', 'get_record', 'query_records'],
        description: 'Read Salesforce records, run SOQL queries, describe schemas.'
    },
    storage_tools: {
        connectorId: '',
        allowedTools: ['list_files', 'read_file'],
        description: 'List, read, and write files in cloud storage.'
    },
    email_tools: {
        connectorId: '',
        allowedTools: ['send_email'],
        description: 'Send transactional emails to record contacts.'
    },
    channel_tools: {
        connectorId: '',
        allowedTools: ['post_message'],
        description: 'Post messages to chat channels (Slack, Teams, SMS, WhatsApp).'
    },
    get_record:   { objectType: 'Lead', fields: [] },
    update_record:{ objectType: 'Lead', fieldMappings: {} },
    create_record:{ objectType: 'Task', fieldMappings: {} },
    query_records:{ soql: 'SELECT Id FROM Lead WHERE Id = \'{!recordId}\'' },
    create_task:  { subject: '', dueDate: 'TODAY+1', priority: 'Normal' },
    post_chatter: { message: '' },
    outlook:      { to: '{!record.Email}', subject: '', body: '' },
    gmail:        { to: '{!record.Email}', subject: '', body: '' },
    sendgrid:     { to: '{!record.Email}', templateId: '' },
    twilio:       { to: '{!record.Phone}', message: '' },
    whatsapp:     { to: '{!record.Phone}', message: '' },
    slack:        { channel: '#general', message: '' },
    teams:        { webhook: '', message: '' },
    if_else:      { condition: '', truePort: 'yes', falsePort: 'no' },
    loop:         { collectionVar: '', iteratorVar: 'item' },
    wait:         { delayMs: 5000 },
    approval:     { approverField: 'OwnerId', timeoutHours: 24 },
    sharepoint:   { siteUrl: '', filePath: '' },
    gdrive:       { folderId: '', fileName: '' },
    end:          { logExecution: true }
};

let nodeIdCounter = 1;

export default class AgentCanvas extends LightningElement {
    @api agentId;

    @track agentDef       = { Name: 'New Agent', Department__c: 'Sales', Status__c: 'Draft', Description__c: '', KnowledgeBase__c: '' };
    @track nodes          = [];          // { id, label, type, subType, x, y, config, mcpServer, mcpTool, isEnabled }
    @track connections    = [];          // { id, fromNodeId, fromPort, toNodeId, toPort }
    @track selectedNodeId = null;
    @track isSaving       = false;
    @track paletteSearch  = '';
    @track scale          = 1;
    @track showKbModal    = false;
    @track showConnectorsModal = false;
    @track _connectorTiles = [];
    @track _directoryAll   = [];
    @track leftTab         = 'nodes';    // 'nodes' | 'connectors'
    @track connectorsStartProvider = null;   // provider to auto-connect when directory opens

    // Drag state — class fields are reactive in LWC
    _draggingNodeId   = null;
    _dragOffsetX      = 0;
    _dragOffsetY      = 0;
    _connectingFrom   = null;  // { nodeId, port }
    _connectMouseX    = 0;
    _connectMouseY    = 0;
    // Palette-drag payload. Lightning Web Security wipes custom dataTransfer
    // entries between dragstart and drop, so for same-component drags we
    // carry the payload in memory and treat dataTransfer as best-effort.
    _dragPayload      = null;

    // ── Wire: connector directory (all providers, any status) ───────
    @wire(getDirectory)
    wiredConnectorTiles({ data }) {
        if (!data) return;
        this._directoryAll = data.map(e => ({
            connectorId:        e.connectorId,
            providerKey:        e.providerKey,
            displayName:        e.displayName,
            accountEmail:       e.accountEmail,
            iconStaticResource: e.iconStaticResource,
            brandColor:         e.brandColor,
            mapsToCatalogType:  e.mapsToCatalogType,
            sortOrder:          e.sortOrder || 100,
            status:             e.status
        }));
        this._connectorTiles = this._directoryAll.filter(e => e.status === 'Connected');
    }

    // ── Wire: load existing agent ────────────────────────────────────
    @wire(getAgentWithNodes, { agentId: '$agentId' })
    wiredAgent({ data, error }) {
        // New-agent case — agentId is null; skip silently
        if (!this.agentId) return;
        if (data) {
            this.agentDef = { ...data.agent };
            const loadedNodes = data.nodes.map(n => ({
                id:                    n.Id,
                label:                 n.Name,
                type:                  n.NodeType__c,
                subType:               n.NodeSubType__c,
                x:                     n.PositionX__c || 0,
                y:                     n.PositionY__c || 0,
                config:                n.ConfigJson__c ? JSON.parse(n.ConfigJson__c) : {},
                mcpServer:             n.McpServer__c,
                mcpTool:               n.McpTool__c,
                isEnabled:             n.IsEnabled__c,
                aiEngineConnectionId:  n.AiEngineConnection__c || null
            }));
            this.nodes = loadedNodes;

            // Restore connections from CanvasJson__c — connections are stored
            // as node-index references because node IDs change on each save
            // (delete + reinsert). Map indices back to current node IDs.
            if (data.agent.CanvasJson__c) {
                try {
                    const canvas = JSON.parse(data.agent.CanvasJson__c);
                    const raw = canvas.connections || [];
                    this.connections = raw.map((c, i) => {
                        if (typeof c.fromIndex === 'number' && typeof c.toIndex === 'number') {
                            const fromNode = loadedNodes[c.fromIndex];
                            const toNode   = loadedNodes[c.toIndex];
                            if (!fromNode || !toNode) return null;
                            return {
                                id:         c.id || `conn_${Date.now()}_${i}`,
                                fromNodeId: fromNode.id,
                                fromPort:   c.fromPort || 'out',
                                toNodeId:   toNode.id,
                                toPort:     c.toPort   || 'in'
                            };
                        }
                        // Legacy id-based connection — drop, IDs are stale
                        return null;
                    }).filter(Boolean);
                } catch(e) { /* ignore */ }
            }
        }
        if (error) this.showError(error);
    }

    // ── Left panel tabs ──────────────────────────────────────────────
    get showNodesTab()      { return this.leftTab === 'nodes'; }
    get showConnectorsTab() { return this.leftTab === 'connectors'; }
    get nodesTabClass()      { return this.leftTab === 'nodes'      ? 'ptab ptab--on' : 'ptab'; }
    get connectorsTabClass() { return this.leftTab === 'connectors' ? 'ptab ptab--on' : 'ptab'; }
    handleTabNodes()      { this.leftTab = 'nodes'; }
    handleTabConnectors() { this.leftTab = 'connectors'; }

    handleNavLogs() {
        this.showToast('info', 'Execution logs live on the Agents home page.');
    }

    get statusPillClass() {
        const s = this.agentDef?.Status__c;
        return s === 'Active' ? 'status-pill status-pill--active' : 'status-pill';
    }

    /** Icon chip tint per node identity — mirrors the mockup's ic-* classes. */
    iconChipClassFor(type, subType) {
        if (type === 'ai') {
            if (subType === 'gpt4')   return 'nicon ic-teal';
            if (subType === 'gemini') return 'nicon ic-blue';
            return 'nicon ic-purple';
        }
        const byType = {
            trigger: 'nicon ic-gray',  catalog: 'nicon ic-blue',
            action:  'nicon ic-blue',  email:   'nicon ic-coral',
            sms:     'nicon ic-teal',  logic:   'nicon ic-amber',
            storage: 'nicon ic-green', end:     'nicon ic-gray'
        };
        return byType[type] || 'nicon ic-gray';
    }

    // ── Computed: Nodes tab sections ─────────────────────────────────
    get paletteNodeSections() {
        const q = this.paletteSearch.toLowerCase();
        const AI_VENDOR = { claude: 'Anthropic', gpt4: 'OpenAI', gemini: 'Google', einstein: 'Salesforce' };
        const decorate = nodes => nodes.map(n => ({
            ...n,
            iconChipClass: this.iconChipClassFor(n.type, n.subType),
            sub: n.type === 'ai' ? (AI_VENDOR[n.subType] || '') : null
        }));
        if (!q) return NODE_PALETTE.map(cat => ({ ...cat, nodes: decorate(cat.nodes) }));
        return NODE_PALETTE.map(cat => ({
            ...cat,
            nodes: decorate(cat.nodes.filter(n =>
                n.label.toLowerCase().includes(q) ||
                n.subType.toLowerCase().includes(q)
            ))
        })).filter(cat => cat.nodes.length > 0);
    }

    // ── Computed: Connectors tab sections ────────────────────────────
    get connectorSections() {
        const q = this.paletteSearch.toLowerCase();
        const CATALOG_LABELS = {
            salesforce_crm_tools: 'CRM',
            storage_tools:        'Storage',
            email_tools:          'Email',
            channel_tools:        'Channels'
        };
        const grouped = new Map();
        for (const t of this._directoryAll) {
            if (q &&
                !(t.displayName || '').toLowerCase().includes(q) &&
                !(t.providerKey || '').toLowerCase().includes(q) &&
                !(t.accountEmail || '').toLowerCase().includes(q)) continue;
            const cat = CATALOG_LABELS[t.mapsToCatalogType] || 'Other';
            if (!grouped.has(cat)) grouped.set(cat, []);
            const isConnected = t.status === 'Connected';
            grouped.get(cat).push({
                key:          t.connectorId || t.providerKey,
                connectorId:  t.connectorId,
                providerKey:  t.providerKey,
                label:        t.displayName,
                accountEmail: t.accountEmail || '',
                catalogType:  t.mapsToCatalogType,
                brandColor:   t.brandColor || '#0176d3',
                iconUrl:      t.iconStaticResource ? `/resource/${t.iconStaticResource}` : null,
                isConnected,
                // draggable is an ENUMERATED attribute — it needs the literal
                // string 'true'/'false'; a boolean binding renders as "" (auto)
                // which makes divs non-draggable.
                dragAttr:     isConnected ? 'true' : 'false',
                sub:          isConnected
                                  ? (t.accountEmail || `${cat} · MCP`)
                                  : `${cat} · MCP`,
                sortOrder:    t.sortOrder
            });
        }
        const order = ['CRM', 'Storage', 'Email', 'Channels', 'Other'];
        return order
            .filter(cat => grouped.has(cat))
            .map(cat => ({
                category: cat,
                items: grouped.get(cat).sort((a, b) => a.sortOrder - b.sortOrder)
            }));
    }

    get selectedNode() {
        return this.nodes.find(n => n.id === this.selectedNodeId) || null;
    }

    get nodeCount()       { return this.nodes.length; }
    get connectionCount() { return this.connections.length; }

    get canvasTransform() {
        return `scale(${this.scale})`;
    }

    get zoomLabel() {
        return `${Math.round(this.scale * 100)}%`;
    }

    get isEmpty() {
        return this.nodes.length === 0;
    }

    get isSelectMode() { return true; }

    // Nodes enriched with display properties for HTML
    get canvasNodes() {
        const NODE_ICONS = {
            trigger: 'utility:connected_apps', ai: 'utility:einstein',
            action:  'utility:edit',           email: 'utility:email',
            sms:     'utility:sms',            logic: 'utility:flow',
            storage: 'utility:file',           end:   'utility:stop',
            catalog: 'utility:bundle_config'
        };
        const TYPE_LABELS = {
            trigger: 'TRIGGER',  ai: 'AI MODEL', action: 'ACTION',
            email:   'EMAIL',    sms: 'CHANNEL', logic:  'LOGIC',
            storage: 'STORAGE',  end: 'END',     catalog: 'CONNECTOR'
        };
        const prettify = t => String(t).replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

        return this.nodes.map(n => {
            const connectorTile = (n.type === 'catalog' && n.config?.connectorId)
                ? this._connectorTiles.find(t => t.connectorId === n.config.connectorId)
                : null;
            const iconUrl = connectorTile?.iconStaticResource
                ? `/resource/${connectorTile.iconStaticResource}`
                : n.connectorIconUrl;

            const isIfElse = n.subType === 'if_else';
            const isAiNode = n.type === 'ai';
            const isCatalog = n.type === 'catalog';

            // Second line under the type label
            let subTitle;
            if (isAiNode)        subTitle = n.config?.model || n.subType;
            else if (isCatalog)  subTitle = connectorTile?.accountEmail || n.mcpServer || n.subType;
            else {
                const cfgVals = Object.values(n.config || {}).filter(v => v && typeof v === 'string');
                subTitle = cfgVals[0] ? String(cfgVals[0]).substring(0, 30) : prettify(n.subType);
            }

            // Tool chips (catalog nodes) — first 3 allowed tools + "+N"
            const allowed = isCatalog && Array.isArray(n.config?.allowedTools) ? n.config.allowedTools : [];
            const toolChips = allowed.slice(0, 3).map(prettify);
            const moreCount = Math.max(0, allowed.length - 3);

            // Status dot: AI → engine cred bound; catalog → connector bound
            const showStatusDot = isAiNode || isCatalog;
            const isOk = isAiNode ? !!n.aiEngineConnectionId : !!n.config?.connectorId;

            return {
                ...n,
                icon:           NODE_ICONS[n.type] || 'utility:settings',
                iconChipClass:  `cnicon ${this.iconChipClassFor(n.type, n.subType)}`,
                positionStyle:  `left: ${n.x}px; top: ${n.y}px`,
                cardClass:      `cnode${this.selectedNodeId === n.id ? ' cnode--sel' : ''}`,
                typeLabel:      TYPE_LABELS[n.type] || n.type.toUpperCase(),
                subTitle,
                hasInputPort:   n.type !== 'trigger',
                hasOutputPort:  !isIfElse && n.type !== 'end',
                isIfElse,
                isConnectorBound: !!(isCatalog && n.config?.connectorId),
                connectorIconUrl: iconUrl,
                connectorAccount: connectorTile?.accountEmail || n.connectorAccount,
                isAiNode,
                toolChips,
                hasToolChips:   toolChips.length > 0,
                moreToolsLabel: moreCount > 0 ? `+${moreCount}` : null,
                showStatusDot,
                statusDotClass: isOk ? 'cndot cndot--ok' : 'cndot',
                statusDotTitle: isAiNode
                    ? (isOk ? 'Engine credential bound' : 'API key required')
                    : (isOk ? 'Connector bound' : 'No connector selected')
            };
        });
    }

    get deptOptions() {
        return ['Sales','Service','Marketing','Finance','HR','Operations'].map(d => ({ label: d, value: d }));
    }

    get statusOptions() {
        return [
            { label: 'Draft',    value: 'Draft' },
            { label: 'Active',   value: 'Active' },
            { label: 'Inactive', value: 'Inactive' }
        ];
    }

    get previewConnection() {
        if (!this._connectingFrom) return null;
        const fromNode = this.nodes.find(n => n.id === this._connectingFrom.nodeId);
        if (!fromNode) return null;
        const from = this.getPortPosition(fromNode, this._connectingFrom.port);
        const to   = { x: this._connectMouseX, y: this._connectMouseY };
        const mx   = (from.x + to.x) / 2;
        return {
            d: `M${from.x},${from.y} C${mx},${from.y} ${mx},${to.y} ${to.x},${to.y}`
        };
    }

    get svgConnections() {
        return this.connections.map(c => {
            const fromNode = this.nodes.find(n => n.id === c.fromNodeId);
            const toNode   = this.nodes.find(n => n.id === c.toNodeId);
            if (!fromNode || !toNode) return null;

            const from = this.getPortPosition(fromNode, c.fromPort);
            const to   = this.getPortPosition(toNode, 'in');
            const mx   = (from.x + to.x) / 2;

            const color = c.fromPort === 'yes' ? '#2e844a'
                        : c.fromPort === 'no'  ? '#c23934'
                        : '#378ADD';
            const dash = c.fromPort === 'no' ? '5,3' : '4,3';

            return {
                id:    c.id,
                d:     `M${from.x},${from.y} C${mx},${from.y} ${mx},${to.y} ${to.x},${to.y}`,
                color,
                dash,
                endX:  to.x,
                endY:  to.y,
                label: c.fromPort !== 'out' ? c.fromPort : null
            };
        }).filter(Boolean);
    }

    // ── Drop node from palette ───────────────────────────────────────
    handleDrop(e) {
        e.preventDefault();
        // Primary: the in-memory payload set at dragstart (immune to LWS
        // dataTransfer sanitization). Fallback: text/plain for exotic paths.
        let nodeData = this._dragPayload;
        this._dragPayload = null;
        if (!nodeData) {
            const raw = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('nodeData');
            if (!raw) return;
            try { nodeData = JSON.parse(raw); } catch (err) { return; }
        }
        if (!nodeData || !nodeData.type) return;

        const canvasArea = this.template.querySelector('.canvas-area');
        const canvasRect = canvasArea.getBoundingClientRect();

        // Account for canvas scroll — the dot grid makes the area scrollable.
        const x = Math.round((e.clientX - canvasRect.left + canvasArea.scrollLeft) / this.scale) - 78;
        const y = Math.round((e.clientY - canvasRect.top  + canvasArea.scrollTop)  / this.scale) - 42;

        const newNode = {
            id:        `new_${nodeIdCounter++}`,
            label:     nodeData.label,
            type:      nodeData.type,
            subType:   nodeData.subType,
            x:         Math.max(10, x),
            y:         Math.max(10, y),
            config:    { ...(DEFAULT_CONFIG[nodeData.subType] || {}), ...(nodeData.configOverride || {}) },
            mcpServer: nodeData.mcpServer,
            mcpTool:   nodeData.mcpTool,
            isEnabled: true,
            // Connector-bound nodes carry brand display data
            connectorBrandColor: nodeData.brandColor || null,
            connectorIconUrl:    nodeData.iconUrl || null,
            connectorAccount:    nodeData.accountEmail || null
        };

        this.nodes = [...this.nodes, newNode];
        this.selectedNodeId = newNode.id;
    }

    handleDragOver(e) { e.preventDefault(); }

    handlePaletteDragStart(e) {
        const nodeData = {
            label:     e.currentTarget.dataset.label,
            type:      e.currentTarget.dataset.type,
            subType:   e.currentTarget.dataset.subtype,
            mcpServer: e.currentTarget.dataset.mcpserver,
            mcpTool:   e.currentTarget.dataset.mcptool
        };
        this._dragPayload = nodeData;
        try { e.dataTransfer.setData('text/plain', JSON.stringify(nodeData)); } catch (ignore) { /* LWS */ }
        e.dataTransfer.effectAllowed = 'copy';
    }

    // Dragging a connector tile drops a catalog node of the matching type.
    // Works for unconnected providers too — the node lands with a red status
    // dot and the user links an account from the node's Auth tab.
    handleConnectorDragStart(e) {
        const ds = e.currentTarget.dataset;
        const catalogType = ds.catalogType; // e.g. storage_tools
        const nodeData = {
            label:     ds.label,
            type:      'catalog',
            subType:   catalogType,
            mcpServer: this.mcpServerFor(catalogType),
            mcpTool:   'catalog',
            brandColor:   ds.brandColor,
            iconUrl:      ds.iconUrl,
            accountEmail: ds.accountEmail,
            configOverride: {
                connectorId:  ds.connectorId || '',
                provider:     ds.provider,
                // Intentionally NO allowedTools here — the properties panel
                // fetches the provider's live /tools catalog and defaults to
                // its read-only tools. Hardcoded names drift from the real
                // MCP tool names and would break allowed_tools enforcement.
                description:  this.describeCatalog(catalogType)
            }
        };
        this._dragPayload = nodeData;
        try { e.dataTransfer.setData('text/plain', JSON.stringify(nodeData)); } catch (ignore) { /* LWS */ }
        e.dataTransfer.effectAllowed = 'copy';
    }

    mcpServerFor(catalogType) {
        switch (catalogType) {
            case 'salesforce_crm_tools': return 'salesforce-crm';
            case 'storage_tools':        return 'storage';
            case 'email_tools':          return 'email';
            case 'channel_tools':        return 'channels';
            default: return null;
        }
    }
    describeCatalog(catalogType) {
        switch (catalogType) {
            case 'salesforce_crm_tools': return 'Read Salesforce records, run SOQL queries, describe schemas.';
            case 'storage_tools':        return 'List, read, and write files in cloud storage.';
            case 'email_tools':          return 'Read inbox and send transactional emails.';
            case 'channel_tools':        return 'Post messages to chat channels.';
            default: return '';
        }
    }

    // ── Node drag (move on canvas) ───────────────────────────────────
    handleNodeMouseDown(e) {
        if (e.target.classList.contains('port')) return;
        const nodeId = e.currentTarget.dataset.id;
        this._draggingNodeId = nodeId;
        const nodeEl = this.template.querySelector(`[data-id="${nodeId}"]`);
        const rect   = nodeEl.getBoundingClientRect();
        this._dragOffsetX = e.clientX - rect.left;
        this._dragOffsetY = e.clientY - rect.top;
        this.selectedNodeId = nodeId;
        e.stopPropagation();
    }

    handleCanvasMouseMove(e) {
        const canvasArea = this.template.querySelector('.canvas-area');
        const canvasRect = canvasArea.getBoundingClientRect();
        // The canvas scrolls (dot grid is larger than the viewport) — node
        // coordinates are in CONTENT space, so add the scroll offsets.
        const sx = canvasArea.scrollLeft;
        const sy = canvasArea.scrollTop;

        if (this._draggingNodeId) {
            const x = Math.round((e.clientX - canvasRect.left + sx - this._dragOffsetX) / this.scale);
            const y = Math.round((e.clientY - canvasRect.top  + sy - this._dragOffsetY) / this.scale);

            this.nodes = this.nodes.map(n =>
                n.id === this._draggingNodeId
                    ? { ...n, x: Math.max(0, x), y: Math.max(0, y) }
                    : n
            );
            return;
        }

        if (this._connectingFrom) {
            this._connectMouseX = (e.clientX - canvasRect.left + sx) / this.scale;
            this._connectMouseY = (e.clientY - canvasRect.top  + sy) / this.scale;
        }
    }

    handleCanvasMouseUp() {
        this._draggingNodeId  = null;
        this._connectingFrom  = null;
    }

    handleCanvasClick(e) {
        if (e.target.classList.contains('canvas-area') ||
            e.target.classList.contains('canvas-dots')) {
            this.selectedNodeId = null;
        }
    }

    // ── Port connection ──────────────────────────────────────────────
    handlePortMouseDown(e) {
        e.stopPropagation();
        e.preventDefault();
        const nodeId = e.currentTarget.dataset.nodeid;
        const port   = e.currentTarget.dataset.port;
        if (port !== 'in') {
            const node = this.nodes.find(n => n.id === nodeId);
            if (node) {
                const start = this.getPortPosition(node, port);
                this._connectMouseX = start.x;
                this._connectMouseY = start.y;
            }
            this._connectingFrom = { nodeId, port };
        }
    }

    handlePortMouseUp(e) {
        e.stopPropagation();
        if (!this._connectingFrom) return;
        const toNodeId = e.currentTarget.dataset.nodeid;
        const port     = e.currentTarget.dataset.port;

        if (port === 'in' && toNodeId !== this._connectingFrom.nodeId) {
            // Prevent duplicate connections on same port
            const exists = this.connections.some(
                c => c.fromNodeId === this._connectingFrom.nodeId
                  && c.fromPort   === this._connectingFrom.port
                  && c.toNodeId   === toNodeId
            );
            if (!exists) {
                this.connections = [...this.connections, {
                    id:         `conn_${Date.now()}`,
                    fromNodeId: this._connectingFrom.nodeId,
                    fromPort:   this._connectingFrom.port,
                    toNodeId,
                    toPort:     'in'
                }];
            }
        }
        this._connectingFrom = null;
    }

    handleDeleteConnection(e) {
        const connId = e.currentTarget.dataset.id;
        this.connections = this.connections.filter(c => c.id !== connId);
    }

    handleDeleteNode(e) {
        e.stopPropagation();
        const nodeId = e.currentTarget.dataset.id;
        this.nodes       = this.nodes.filter(n => n.id !== nodeId);
        this.connections = this.connections.filter(
            c => c.fromNodeId !== nodeId && c.toNodeId !== nodeId
        );
        if (this.selectedNodeId === nodeId) this.selectedNodeId = null;
    }

    // ── Properties panel updates ─────────────────────────────────────
    handleNodeConfigChange(e) {
        const { field, value } = e.detail;
        // aiEngineConnectionId is a top-level column on AgentNode__c (native Lookup),
        // not a nested JSON config value — the picker already persisted server-side
        // via bindToNode(). We only need to update local state so the UI + canvas
        // status dot reflect the new binding immediately.
        if (field === 'aiEngineConnectionId') {
            this.nodes = this.nodes.map(n =>
                n.id === this.selectedNodeId ? { ...n, aiEngineConnectionId: value } : n
            );
            return;
        }
        this.nodes = this.nodes.map(n =>
            n.id === this.selectedNodeId
                ? { ...n, config: { ...n.config, [field]: value } }
                : n
        );
    }

    handleNodeLabelChange(e) {
        const value = e.detail.value;
        this.nodes = this.nodes.map(n =>
            n.id === this.selectedNodeId ? { ...n, label: value } : n
        );
    }

    // ── Palette search ───────────────────────────────────────────────
    handlePaletteSearch(e) {
        this.paletteSearch = e.target.value;
    }

    // ── Zoom ─────────────────────────────────────────────────────────
    handleZoomIn()    { this.scale = Math.min(2, this.scale + 0.1); }
    handleZoomOut()   { this.scale = Math.max(0.4, this.scale - 0.1); }
    handleZoomReset() { this.scale = 1; }

    // ── Auto layout: arrange nodes in a clean line ───────────────────
    handleAutoLayout() {
        const GAP_X = 180;
        const START_X = 40;
        const START_Y = 100;
        const ROWS = 3;

        this.nodes = this.nodes.map((n, i) => ({
            ...n,
            x: START_X + (Math.floor(i / ROWS)) * GAP_X,
            y: START_Y + (i % ROWS) * 130
        }));
    }

    // ── Save ─────────────────────────────────────────────────────────
    async handleSave() {
        this.isSaving = true;
        try {
            // Map connections to node-index references so they survive the
            // delete-and-reinsert that happens on the server.
            const idToIndex = {};
            this.nodes.forEach((n, i) => { idToIndex[n.id] = i; });

            const indexedConnections = this.connections.map(c => ({
                id:        c.id,
                fromIndex: idToIndex[c.fromNodeId],
                fromPort:  c.fromPort,
                toIndex:   idToIndex[c.toNodeId],
                toPort:    c.toPort
            })).filter(c =>
                Number.isInteger(c.fromIndex) && Number.isInteger(c.toIndex)
            );

            const agentInput = {
                apiName:       this.agentDef.ApiName__c || this.slugify(this.agentDef.Name),
                label:         this.agentDef.Name,
                department:    this.agentDef.Department__c,
                description:   this.agentDef.Description__c,
                knowledgeBase: this.agentDef.KnowledgeBase__c,
                status:        this.agentDef.Status__c,
                canvasJson:    JSON.stringify({ connections: indexedConnections })
            };

            const nodeInput = this.nodes.map((n, i) => ({
                label:                 n.label,
                nodeType:              n.type,
                nodeSubType:           n.subType,
                configJson:            JSON.stringify(n.config),
                positionX:             Math.round(n.x),
                positionY:             Math.round(n.y),
                isEnabled:             n.isEnabled,
                mcpServer:             n.mcpServer,
                mcpTool:               n.mcpTool,
                aiEngineConnectionId:  n.aiEngineConnectionId || null
            }));

            const savedId = await saveAgentWithNodes({
                agentJson: JSON.stringify(agentInput),
                nodesJson: JSON.stringify(nodeInput)
            });

            this.agentDef = { ...this.agentDef, Id: savedId };
            this.showToast('success', 'Agent saved successfully');

        } catch (err) {
            this.showError(err);
        } finally {
            this.isSaving = false;
        }
    }

    // ── Back + Test ──────────────────────────────────────────────────
    handleBack() {
        this.dispatchEvent(new CustomEvent('back'));
    }

    handleTestRun() {
        this.dispatchEvent(new CustomEvent('test', { detail: this.agentDef }));
    }

    async handleDeploy() {
        // Need at least one node to deploy
        if (this.nodes.length === 0) {
            this.showToast('warning', 'Add at least one node before deploying');
            return;
        }

        // Flip Status to Active and save in one go
        this.agentDef = { ...this.agentDef, Status__c: 'Active' };
        await this.handleSave();

        if (this.agentDef.Id || this.agentDef.Status__c === 'Active') {
            this.showToast('success', `Agent "${this.agentDef.Name}" is now Active and ready to run`);
        }
    }

    handleAgentNameChange(e) { this.agentDef = { ...this.agentDef, Name: e.target.value }; }
    handleDeptChange(e)      { this.agentDef = { ...this.agentDef, Department__c: e.detail.value }; }
    handleStatusChange(e)    { this.agentDef = { ...this.agentDef, Status__c: e.detail.value }; }
    handleKbChange(e)        { this.agentDef = { ...this.agentDef, KnowledgeBase__c: e.target.value }; }
    handleOpenKb()           { this.showKbModal = true; }
    handleCloseKb()          { this.showKbModal = false; }
    handleOpenConnectors()   {
        this.connectorsStartProvider = null;
        this.showConnectorsModal = true;
    }
    handleCloseConnectors()  {
        this.showConnectorsModal = false;
        this.connectorsStartProvider = null;
    }
    /** "+ Connect" on a specific tile — start OAuth for that provider directly,
     *  no directory modal in between. */
    async handleConnectProvider(e) {
        e.stopPropagation();
        await this.startConnectFlow(e.currentTarget.dataset.provider);
    }

    /** Same flow triggered from a node's Auth tab ("Connect Gmail" button). */
    async handleConnectProviderEvent(e) {
        await this.startConnectFlow(e.detail?.provider);
    }

    async startConnectFlow(providerKey) {
        if (!providerKey) return;
        const entry = this._directoryAll.find(t => t.providerKey === providerKey);
        if (!entry) {
            this.showToast('warning', `Unknown connector provider: ${providerKey}`);
            return;
        }
        // Salesforce MCP is connected through Archon Setup, not the broker.
        if (providerKey === 'salesforce_mcp' && entry.status !== 'Connected') {
            this.showToast('info', 'Salesforce MCP connects through Archon Setup — run Setup first.');
            return;
        }
        // Every other provider: the server decides what's supported/configured
        // and returns a friendly error otherwise — no hardcoded gate here.
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('synapse_connected');
            url.searchParams.delete('error');
            url.searchParams.delete('connectorId');
            const { authorizeUrl } = await startOAuth({
                providerKey,
                displayName: entry.displayName,
                returnUrl: url.toString()
            });
            window.location.assign(authorizeUrl);
        } catch (err) {
            this.showError(err);
        }
    }
    handleNavHome()          { this.dispatchEvent(new CustomEvent('back')); }

    // ── Helpers ──────────────────────────────────────────────────────
    getPortPosition(node, port) {
        // Cards auto-size with content (tool chips, badges), so measure the
        // real rendered element — CSS places ports at the ACTUAL midpoints.
        // Fallback constants cover the first render before DOM exists.
        let W = 156, H = 84;
        const el = this.template.querySelector(`.cnode[data-id="${node.id}"]`);
        if (el) {
            W = el.offsetWidth  || W;
            H = el.offsetHeight || H;
        }
        if (port === 'in')  return { x: node.x,     y: node.y + H / 2 };
        if (port === 'out') return { x: node.x + W, y: node.y + H / 2 };
        if (port === 'yes') return { x: node.x + W, y: node.y + H * 0.3 };
        if (port === 'no')  return { x: node.x + W, y: node.y + H * 0.7 };
        return { x: node.x + W, y: node.y + H / 2 };
    }

    slugify(str) {
        return (str || 'New_Agent').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    }

    showToast(variant, message) {
        this.dispatchEvent(new ShowToastEvent({ title: message, variant }));
    }

    showError(err) {
        const msg = err?.body?.message || err?.message || 'Unknown error';
        this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: msg, variant: 'error' }));
    }

    stopProp(e) { e.stopPropagation(); }
}
