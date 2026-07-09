import { LightningElement, api, track, wire } from 'lwc';
import getConnectorsForCatalogType from '@salesforce/apex/AgentConnectorController.getConnectorsForCatalogType';
import getConnectorTools from '@salesforce/apex/AgentConnectorController.getConnectorTools';
import getDirectory      from '@salesforce/apex/AgentConnectorController.getDirectory';
import getMcpToolCatalog from '@salesforce/apex/AgentConnectorController.getMcpToolCatalog';

// Dynamic fields per node sub-type
const FIELD_SCHEMAS = {
    record:       [{ key: 'objectType', label: 'SF Object', type: 'text', placeholder: 'Lead' },
                   { key: 'triggerOn', label: 'Trigger on', type: 'picklist', options: ['Create','Update','Create or Update'] }],
    schedule:     [{ key: 'cronExpression', label: 'Cron expression', type: 'text', placeholder: '0 0 8 * * ?' }],
    // ── Orchestrator schemas — AI model nodes act as the reasoning engine for downstream tool catalogs ──
    claude: [
        { key: 'model', label: 'Model', type: 'picklist',
          options: ['claude-opus-4-7','claude-sonnet-4-6','claude-haiku-4-5'],
          hint: 'Best reasoning quality; Opus 4.7 supports adaptive thinking and prompt caching.' },
        { key: 'instruction', label: 'Instruction', type: 'textarea',
          placeholder: 'Look up the {!record.Type}, evaluate fit, then update relevant fields or send a notification.',
          hint: 'Plain English. The AI will read this and decide which tool catalogs and tools to use.' },
        { key: 'systemPrompt', label: 'System prompt (override)', type: 'textarea',
          placeholder: 'Optional. Leave blank to use the built-in safe default.' },
        { key: 'useKnowledgeBase', label: 'Use agent knowledge base', type: 'toggle' },
        { key: 'fewShotExamples', label: 'Few-shot examples', type: 'examples',
          hint: 'Optional. Show the AI 1-3 examples of input → expected behavior.' },
        { key: 'dispatchMode', label: 'Tool dispatch', type: 'picklist',
          options: ['two_tier','flat'],
          hint: 'Two-tier: AI first picks a catalog, then a tool. Best for many catalogs. Flat: all tools visible at once.' },
        { key: 'maxToolCalls', label: 'Max tool calls', type: 'number', min: 1, max: 50 },
        { key: 'captureReasoning', label: 'Capture chain-of-thought', type: 'toggle' },
        { key: 'effort', label: 'Effort', type: 'picklist', options: ['low','medium','high','max'] },
        { key: 'adaptiveThinking', label: 'Adaptive thinking', type: 'toggle' },
        { key: 'maxTokens', label: 'Max tokens', type: 'number', min: 256, max: 64000 }
    ],
    gpt4: [
        { key: 'model', label: 'Model', type: 'picklist',
          options: ['gpt-4o','gpt-4o-mini','gpt-4-turbo','gpt-4.1','gpt-4.1-mini'],
          hint: 'gpt-4o is the default — best balance of cost and capability.' },
        { key: 'instruction', label: 'Instruction', type: 'textarea',
          placeholder: 'Look up the {!record.Type}, evaluate fit, then update relevant fields or send a notification.',
          hint: 'Plain English. The AI will read this and decide which tool catalogs and tools to use.' },
        { key: 'systemPrompt', label: 'System prompt (override)', type: 'textarea',
          placeholder: 'Optional. Leave blank to use the built-in safe default.' },
        { key: 'useKnowledgeBase', label: 'Use agent knowledge base', type: 'toggle' },
        { key: 'fewShotExamples', label: 'Few-shot examples', type: 'examples',
          hint: 'Optional. Show the AI 1-3 examples of input → expected behavior.' },
        { key: 'dispatchMode', label: 'Tool dispatch', type: 'picklist',
          options: ['two_tier','flat'],
          hint: 'Two-tier: AI first picks a catalog, then a tool. Best for many catalogs. Flat: all tools visible at once.' },
        { key: 'maxToolCalls', label: 'Max tool calls', type: 'number', min: 1, max: 50 },
        { key: 'captureReasoning', label: 'Capture chain-of-thought', type: 'toggle' },
        { key: 'temperature', label: 'Temperature', type: 'number', min: 0, max: 2, step: 0.1 },
        { key: 'maxTokens', label: 'Max tokens', type: 'number', min: 256, max: 16000 }
    ],
    gemini: [
        { key: 'model', label: 'Model', type: 'picklist',
          options: ['gemini-2.5-pro','gemini-2.5-flash','gemini-2.0-flash','gemini-2.0-flash-lite'] },
        { key: 'instruction', label: 'Instruction', type: 'textarea',
          placeholder: 'Look up the {!record.Type}, evaluate fit, then update relevant fields or send a notification.',
          hint: 'Plain English. The AI will read this and decide which tool catalogs and tools to use.' },
        { key: 'systemPrompt', label: 'System prompt (override)', type: 'textarea',
          placeholder: 'Optional. Leave blank to use the built-in safe default.' },
        { key: 'useKnowledgeBase', label: 'Use agent knowledge base', type: 'toggle' },
        { key: 'fewShotExamples', label: 'Few-shot examples', type: 'examples',
          hint: 'Optional. Show the AI 1-3 examples of input → expected behavior.' },
        { key: 'dispatchMode', label: 'Tool dispatch', type: 'picklist',
          options: ['two_tier','flat'] },
        { key: 'maxToolCalls', label: 'Max tool calls', type: 'number', min: 1, max: 50 },
        { key: 'captureReasoning', label: 'Capture chain-of-thought', type: 'toggle' },
        { key: 'temperature', label: 'Temperature (0-2)', type: 'number', min: 0, max: 2, step: 0.1 },
        { key: 'maxTokens', label: 'Max output tokens', type: 'number', min: 256, max: 8192 }
    ],
    einstein: [{ key: 'modelType', label: 'Model type', type: 'picklist', options: ['predict','classify','generate'] }],
    get_record:   [{ key: 'objectType', label: 'SF Object', type: 'text', placeholder: 'Lead' },
                   { key: 'fields', label: 'Fields (comma separated)', type: 'text', placeholder: 'Id,Name,Email,Company' }],
    update_record:[{ key: 'objectType', label: 'SF Object', type: 'text', placeholder: 'Lead' },
                   { key: 'fieldMappings', label: 'Field mappings (JSON)', type: 'textarea', placeholder: '{"Status__c": "Hot", "Score__c": "{!ai.score}"}' }],
    create_record:[{ key: 'objectType', label: 'SF Object', type: 'text', placeholder: 'Task' },
                   { key: 'fieldMappings', label: 'Field values (JSON)', type: 'textarea', placeholder: '{"Subject": "Follow up", "Priority": "High"}' }],
    query_records:[{ key: 'soql', label: 'SOQL query', type: 'textarea', placeholder: "SELECT Id, Name FROM Lead WHERE Id = '{!recordId}'" }],
    create_task:  [{ key: 'subject', label: 'Subject', type: 'text', placeholder: 'Follow up with lead' },
                   { key: 'dueDate', label: 'Due date', type: 'text', placeholder: 'TODAY+1' },
                   { key: 'priority', label: 'Priority', type: 'picklist', options: ['High','Normal','Low'] }],
    post_chatter: [{ key: 'message', label: 'Message', type: 'textarea', placeholder: 'Lead scored {!ai.score} — action required' }],
    apex_action:  [{ key: 'className', label: 'Apex class', type: 'text', placeholder: 'MyInvocableClass' },
                   { key: 'methodName', label: 'Method', type: 'text', placeholder: 'execute' }],
    outlook:      [{ key: 'to', label: 'To', type: 'text', placeholder: '{!record.Email}' },
                   { key: 'subject', label: 'Subject', type: 'text', placeholder: '' },
                   { key: 'body', label: 'Body', type: 'textarea', placeholder: '' }],
    gmail:        [{ key: 'to', label: 'To', type: 'text', placeholder: '{!record.Email}' },
                   { key: 'subject', label: 'Subject', type: 'text', placeholder: '' },
                   { key: 'body', label: 'Body', type: 'textarea', placeholder: '' }],
    sendgrid:     [{ key: 'to', label: 'To', type: 'text', placeholder: '{!record.Email}' },
                   { key: 'templateId', label: 'Template ID', type: 'text', placeholder: 'd-abc123' }],
    twilio:       [{ key: 'to', label: 'To (phone)', type: 'text', placeholder: '{!record.Phone}' },
                   { key: 'message', label: 'Message', type: 'textarea', placeholder: '' }],
    whatsapp:     [{ key: 'to', label: 'To (phone)', type: 'text', placeholder: '{!record.Phone}' },
                   { key: 'message', label: 'Message', type: 'textarea', placeholder: '' }],
    slack:        [{ key: 'channel', label: 'Channel', type: 'text', placeholder: '#sales-alerts' },
                   { key: 'message', label: 'Message', type: 'textarea', placeholder: 'Hot lead: {!record.Name}' }],
    teams:        [{ key: 'webhookUrl', label: 'Webhook URL', type: 'text', placeholder: 'https://…' },
                   { key: 'message', label: 'Message', type: 'textarea', placeholder: '' }],
    if_else:      [{ key: 'condition', label: 'Condition', type: 'text', placeholder: '{!ai.score} > 80' }],
    loop:         [{ key: 'collectionVar', label: 'Collection variable', type: 'text', placeholder: '{!records}' },
                   { key: 'iteratorVar',   label: 'Iterator variable',   type: 'text', placeholder: 'item' }],
    wait:         [{ key: 'delayMs', label: 'Delay (ms)', type: 'number', min: 0 }],
    approval:     [{ key: 'approverField', label: 'Approver field', type: 'text', placeholder: 'OwnerId' },
                   { key: 'timeoutHours',  label: 'Timeout (hours)', type: 'number', min: 1 }],
    sharepoint:   [{ key: 'siteUrl', label: 'Site URL', type: 'text' },
                   { key: 'filePath', label: 'File path', type: 'text' }],
    gdrive:       [{ key: 'folderId', label: 'Folder ID', type: 'text' },
                   { key: 'fileName', label: 'File name', type: 'text' }],
    end:          [{ key: 'logExecution', label: 'Log execution to SF', type: 'toggle' }],

    // ── Tool catalog nodes — declarations consumed by the upstream AI orchestrator ──
    salesforce_crm_tools: [
        { key: 'description', label: 'Catalog description (shown to AI)', type: 'textarea',
          placeholder: 'Read Salesforce records, query SOQL, describe schemas.',
          hint: 'The AI sees this when deciding whether to use this catalog. Keep it short and specific.' },
        { key: 'connectorId', label: 'Connector', type: 'connector',
          hint: 'Pick a connected Salesforce MCP from the Connectors directory.' },
        { key: 'allowedTools', label: 'Allowed tools', type: 'multiselect',
          options: [
              'list_sobjects','describe_sobject','get_record','query_records','run_report',
              'create_record','update_record','delete_record','create_task','post_chatter','apex_invocable'
          ],
          hint: 'list_sobjects → apex_invocable. Reads are safe; the create_/update_/delete_/post_ ones require approval (Phase 2).' }
    ],
    storage_tools: [
        { key: 'description', label: 'Catalog description (shown to AI)', type: 'textarea',
          placeholder: 'List, read, and write files in cloud storage.' },
        { key: 'connectorId', label: 'Connector', type: 'connector',
          hint: 'Pick one of your connected storage providers. Add new connections via the Connectors button up top.' },
        { key: 'allowedTools', label: 'Allowed tools', type: 'multiselect',
          options: [
              'list_files','read_file','search','get_file_metadata',
              'write_file','update_file','create_folder','move_file','delete_file','share_file'
          ],
          hint: 'Reads are safe; write_file → share_file require approval (Phase 2).' }
    ],
    email_tools: [
        { key: 'description', label: 'Catalog description (shown to AI)', type: 'textarea',
          placeholder: 'Read inbox and send transactional emails.' },
        { key: 'connectorId', label: 'Connector', type: 'connector',
          hint: 'Pick a connected email provider (Outlook, Gmail, SendGrid).' },
        { key: 'allowedTools', label: 'Allowed tools', type: 'multiselect',
          options: [
              'list_emails','read_email','search_emails',
              'send_email','reply_email','forward_email','create_draft','send_template'
          ],
          hint: 'list/read/search are safe; send/reply/forward/template require approval (Phase 2).' }
    ],
    channel_tools: [
        { key: 'description', label: 'Catalog description (shown to AI)', type: 'textarea',
          placeholder: 'Post messages to chat channels.' },
        { key: 'connectorId', label: 'Connector', type: 'connector',
          hint: 'Pick a connected channel (Slack, Teams, Twilio, WhatsApp).' },
        { key: 'allowedTools', label: 'Allowed tools', type: 'multiselect',
          options: [
              'list_channels','list_users','read_channel_history',
              'post_message','update_message','add_reaction','upload_file'
          ],
          hint: 'list/read are safe; post/update/react/upload require approval (Phase 2).' }
    ]
};

const CATALOG_SUBTYPES = ['salesforce_crm_tools','storage_tools','email_tools','channel_tools'];

const MODEL_HINTS = {
    'claude-opus-4-7':      'Best reasoning quality',
    'claude-sonnet-4-6':    'Fast + balanced',
    'claude-haiku-4-5':     'Fastest, lowest cost',
    'gpt-4o':               'Best balance of cost and capability',
    'gpt-4o-mini':          'Lowest cost',
    'gpt-4-turbo':          'Legacy turbo',
    'gpt-4.1':              'Strong coding',
    'gpt-4.1-mini':         'Fast + cheap',
    'gemini-2.5-pro':       'Best quality',
    'gemini-2.5-flash':     'Fast + balanced',
    'gemini-2.0-flash':     'Fast',
    'gemini-2.0-flash-lite':'Lowest cost'
};

export default class AgentPropertiesPanel extends LightningElement {
    @api node;

    @track _showConnectorPicker = false;
    @track _allTiles = [];
    @track activeTab  = null;
    _tabNodeId = null;

    // Reactive wire fires whenever the selected node's subType changes
    @wire(getConnectorsForCatalogType, { catalogType: '$catalogTypeForConnector' })
    wiredConnectors;

    // Dynamic tool list pulled from the standalone MCP server. Re-fires
    // whenever the bound connectorId changes.
    @wire(getConnectorTools, { connectorId: '$boundConnectorId' })
    wiredRemoteTools;

    // Public /tools catalog (unauthenticated, provider-level). This is the
    // primary source for the Tools checklist — works before any account is
    // connected. Keyed by the provider the tile was dragged in with.
    @wire(getMcpToolCatalog, { providerKey: '$providerKeyForCatalog' })
    wiredMcpCatalog;

    get providerKeyForCatalog() {
        if (!CATALOG_SUBTYPES.includes(this.node?.subType)) return null;
        return this.node?.config?.provider || null;
    }

    get boundConnectorId() {
        const id = this.node?.config?.connectorId;
        return CATALOG_SUBTYPES.includes(this.node?.subType) && id ? id : null;
    }

    /** Either the live remote list (when a connector is bound) or the hardcoded fallback. */
    get effectiveToolOptions() {
        const live = this.wiredRemoteTools?.data;
        if (Array.isArray(live) && live.length > 0) return live.map(t => t.name);
        return null; // signal to fall back to schema.options
    }

    @wire(getDirectory)
    wiredDirectory({ data }) {
        if (data) {
            this._allTiles = data
                .filter(e => e.status === 'Connected')
                .map(e => ({
                    connectorId:        e.connectorId,
                    providerKey:        e.providerKey,
                    displayName:        e.displayName,
                    accountEmail:       e.accountEmail,
                    iconStaticResource: e.iconStaticResource,
                    brandColor:         e.brandColor,
                    mapsToCatalogType:  e.mapsToCatalogType
                }));
        }
    }

    get pinnedConnector() {
        const id = this.node?.config?.connectorId;
        if (!id) return null;
        const tile = this._allTiles.find(t => t.connectorId === id);
        if (!tile) return null;
        return {
            ...tile,
            iconUrl: tile.iconStaticResource ? `/resource/${tile.iconStaticResource}` : null,
            accentStyle: `border-left-color: ${tile.brandColor || '#0176d3'};`
        };
    }

    get showChipMode() {
        return !!this.pinnedConnector && !this._showConnectorPicker;
    }

    handleChangeConnector() { this._showConnectorPicker = true; }
    handleCloseChange()     { this._showConnectorPicker = false; }

    get catalogTypeForConnector() {
        const st = this.node?.subType;
        return CATALOG_SUBTYPES.includes(st) ? st : null;
    }

    get connectorOptions() {
        const rows = (this.wiredConnectors && this.wiredConnectors.data) || [];
        if (rows.length === 0) {
            return [{ label: '— No connected providers yet — open Connectors to add one —', value: '' }];
        }
        return rows.map(r => ({ label: r.label, value: r.connectorId }));
    }

    get fields() {
        const schema = FIELD_SCHEMAS[this.node?.subType] || [];
        // Hide the connector picker field when the pinned chip is showing
        const filtered = this.showChipMode
            ? schema.filter(f => f.type !== 'connector')
            : schema;
        const liveTools = this.effectiveToolOptions;
        return filtered.map(f => {
            const raw = this.node?.config?.[f.key];
            const isMultiselect = f.type === 'multiselect';
            const isExamples    = f.type === 'examples';
            const isConnector   = f.type === 'connector';
            const options = isConnector ? this.connectorOptions : (f.options || []).map(o => ({ label: o, value: o }));
            // allowedTools on a catalog node: prefer the live remote list when present
            const msOptions = (isMultiselect && f.key === 'allowedTools' && liveTools)
                ? liveTools
                : (f.options || []);
            return {
                ...f,
                value: raw ?? (isMultiselect ? [] : isExamples ? [] : ''),
                isText:        f.type === 'text',
                isTextarea:    f.type === 'textarea',
                isNumber:      f.type === 'number',
                isPicklist:    f.type === 'picklist' || isConnector,
                isToggle:      f.type === 'toggle',
                isMultiselect,
                isExamples,
                hint: f.hint || null,
                picklistOptions: options,
                // multiselect: build checkbox rows with checked state
                multiselectOptions: isMultiselect
                    ? msOptions.map(o => ({
                        label: o,
                        value: o,
                        checked: Array.isArray(raw) ? raw.includes(o) : false
                      }))
                    : [],
                // examples: each example gets an index so the user can remove a specific one
                exampleRows: isExamples && Array.isArray(raw)
                    ? raw.map((ex, idx) => ({
                        idx,
                        idxOneBased: idx + 1,
                        input: ex.input ?? '',
                        output: ex.output ?? ''
                      }))
                    : []
            };
        });
    }

    get nodeTitle()   { return this.node?.label || 'Node'; }
    get nodeSubType() { return this.node?.subType || ''; }
    get mcpServer()   { return this.node?.mcpServer || ''; }
    get mcpTool()     { return this.node?.mcpTool || ''; }
    get hasMcp()      { return !!this.node?.mcpServer; }

    get isCatalogNode() { return CATALOG_SUBTYPES.includes(this.node?.subType); }

    // ── Header ────────────────────────────────────────────
    get headIcon() {
        const t = this.node?.type;
        const ICONS = {
            trigger: 'utility:connected_apps', ai: 'utility:einstein',
            action:  'utility:edit',   email: 'utility:email',
            sms:     'utility:sms',    logic: 'utility:flow',
            storage: 'utility:file',   end:   'utility:stop',
            catalog: 'utility:bundle_config'
        };
        return ICONS[t] || 'utility:settings';
    }
    get headIconClass() {
        const t = this.node?.type, st = this.node?.subType;
        let tint = 'ic-gray';
        if (t === 'ai')           tint = st === 'gpt4' ? 'ic-teal' : st === 'gemini' ? 'ic-blue' : 'ic-purple';
        else if (t === 'catalog') tint = 'ic-blue';
        else if (t === 'logic')   tint = 'ic-amber';
        else if (t === 'email')   tint = 'ic-coral';
        else if (t === 'sms')     tint = 'ic-teal';
        else if (t === 'storage') tint = 'ic-green';
        return `rp-icon ${tint}`;
    }
    get headSubtitle() {
        if (this.isAiNode)      return 'AI model node';
        if (this.isCatalogNode) return 'Connector node';
        const t = this.node?.type || '';
        return `${t.charAt(0).toUpperCase()}${t.slice(1)} node`;
    }

    // ── Tabs ──────────────────────────────────────────────
    get tabDefs() {
        const defs = this.isCatalogNode
            ? [{ id: 'tools', label: 'Tools' }, { id: 'auth', label: 'Auth' }]
            : [{ id: 'config', label: 'Config' }, { id: 'vars', label: 'Variables' }];
        const active = this.effectiveTab;
        return defs.map(d => ({ ...d, cls: d.id === active ? 'itab itab--on' : 'itab' }));
    }
    get effectiveTab() {
        const valid = this.isCatalogNode ? ['tools', 'auth'] : ['config', 'vars'];
        if (this._tabNodeId === this.node?.id && valid.includes(this.activeTab)) return this.activeTab;
        return valid[0];
    }
    get showConfigTab() { return this.effectiveTab === 'config'; }
    get showVarsTab()   { return this.effectiveTab === 'vars'; }
    get showToolsTab()  { return this.effectiveTab === 'tools'; }
    get showAuthTab()   { return this.effectiveTab === 'auth'; }

    handleTabClick(e) {
        this.activeTab  = e.currentTarget.dataset.tab;
        this._tabNodeId = this.node?.id;
    }

    // ── Credential alert ──────────────────────────────────
    get showKeyAlert() {
        return this.isAiNode && !this.boundConnectionId;
    }
    get engineDisplayName() {
        const st = this.node?.subType;
        return st === 'gpt4' ? 'OpenAI' : st === 'gemini' ? 'Gemini' : 'Claude';
    }

    // ── Model radio cards (AI nodes) ──────────────────────
    get modelRows() {
        const schema = FIELD_SCHEMAS[this.node?.subType] || [];
        const modelField = schema.find(f => f.key === 'model');
        if (!modelField) return [];
        const current = this.node?.config?.model;
        const st = this.node?.subType;
        const chipTint = st === 'gpt4' ? 'ic-teal' : st === 'gemini' ? 'ic-blue' : 'ic-purple';
        return (modelField.options || []).map(v => {
            const sel = v === current;
            return {
                value:      v,
                hint:       MODEL_HINTS[v] || null,
                rowClass:   sel ? 'engine-row engine-row--sel' : 'engine-row',
                radioClass: sel ? 'erad erad--on' : 'erad',
                chipClass:  `er-chip ${chipTint}`
            };
        });
    }
    handleModelSelect(e) {
        const value = e.currentTarget.dataset.value;
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'model', value } }));
    }

    // ── Config tab fields (schema minus specially-rendered keys) ──
    get configFields() {
        if (this.isCatalogNode) return [];
        return this.fields.filter(f => !(this.isAiNode && f.key === 'model'));
    }

    // ── Tools tab (catalog nodes) ─────────────────────────
    get descriptionField() {
        if (!this.isCatalogNode) return null;
        const schema = FIELD_SCHEMAS[this.node?.subType] || [];
        const f = schema.find(x => x.key === 'description');
        if (!f) return null;
        return { ...f, value: this.node?.config?.description ?? '' };
    }
    /**
     * Tool catalog resolution order:
     *   1. Public /tools catalog (name+description+readOnly) — provider-level
     *   2. Authenticated MCP tools/list (names) — connector-level
     *   3. Hardcoded schema fallback (names)
     */
    get liveCatalog() {
        const rows = this.wiredMcpCatalog?.data;
        return Array.isArray(rows) && rows.length > 0 ? rows : null;
    }

    get toolRows() {
        if (!this.isCatalogNode) return [];
        const prettify = t => String(t).replace(/_/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/^\w/, c => c.toUpperCase());
        const selected = Array.isArray(this.node?.config?.allowedTools) ? this.node.config.allowedTools : [];

        let catalog;
        if (this.liveCatalog) {
            catalog = this.liveCatalog.map(t => ({
                value: t.name, description: t.description, readOnly: t.readOnly === true
            }));
        } else {
            const schema = FIELD_SCHEMAS[this.node?.subType] || [];
            const f = schema.find(x => x.key === 'allowedTools');
            const options = this.effectiveToolOptions || f?.options || [];
            catalog = options.map(v => ({ value: v, description: null, readOnly: null }));
        }

        // Reads first, then writes
        catalog.sort((a, b) => (a.readOnly === b.readOnly) ? 0 : (a.readOnly ? -1 : 1));

        return catalog.map(t => {
            const on = selected.includes(t.value);
            return {
                value:       t.value,
                label:       prettify(t.value),
                description: t.description,
                rowClass:    on ? 'tool-row tool-row--on' : 'tool-row',
                checkClass:  on ? 'tool-check tool-check--on' : 'tool-check',
                showBadge:   t.readOnly !== null,
                badgeLabel:  t.readOnly ? 'read' : 'write',
                badgeClass:  t.readOnly ? 'tool-badge tool-badge--read' : 'tool-badge tool-badge--write'
            };
        });
    }
    get noTools() { return this.isCatalogNode && this.toolRows.length === 0; }

    /**
     * Auto-default: when the live catalog arrives and this node has never
     * had a selection (allowedTools missing — connector tiles drop with
     * null), pre-select the read-only tools. Never overrides a user's
     * choice, including an intentional empty selection ([]).
     */
    _defaultedForNodeId = null;
    renderedCallback() {
        if (!this.isCatalogNode || !this.liveCatalog) return;
        if (this._defaultedForNodeId === this.node?.id) return;

        const current = this.node?.config?.allowedTools;
        const liveNames = new Set(this.liveCatalog.map(t => t.name));

        // Two cases get re-defaulted to the read-only tools:
        //   1. No selection yet (connector tiles drop with none).
        //   2. LEGACY selection where zero names match the live catalog —
        //      agents saved before the live-catalog change hold stale tool
        //      names that would block every tool at runtime.
        const isUnset = !Array.isArray(current);
        const isAllStale = Array.isArray(current) && current.length > 0 &&
            !current.some(t => liveNames.has(t));
        if (!isUnset && !isAllStale) return;

        this._defaultedForNodeId = this.node?.id;
        const readTools = this.liveCatalog.filter(t => t.readOnly === true).map(t => t.name);
        this.dispatchEvent(new CustomEvent('config', {
            detail: { field: 'allowedTools', value: readTools }
        }));
    }

    handleToolRowToggle(e) {
        const option = e.currentTarget.dataset.option;
        const current = Array.isArray(this.node?.config?.allowedTools) ? [...this.node.config.allowedTools] : [];
        const next = current.includes(option)
            ? current.filter(v => v !== option)
            : [...current, option];
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'allowedTools', value: next } }));
    }

    // ── Auth tab (catalog nodes) ──────────────────────────
    get authPinned() {
        return this._showConnectorPicker ? null : this.pinnedConnector;
    }
    get pinnedConnectorAccount() {
        return this.pinnedConnector?.accountEmail || '—';
    }
    get boundConnectorIdValue() {
        return this.node?.config?.connectorId || '';
    }
    get providerDisplayName() {
        const p = this.node?.config?.provider;
        if (!p) return 'the provider';
        // e.g. salesforce_mcp → Salesforce Mcp; good enough for a button label
        return p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/ Mcp$/, '');
    }
    get connectButtonLabel() {
        return `Connect ${this.providerDisplayName}`;
    }
    get hasConnectorOptions() {
        const opts = this.connectorOptions;
        return opts.length > 0 && opts[0].value !== '';
    }
    /** Bubble up — the canvas owns the OAuth start flow. */
    handleConnectProviderClick() {
        this.dispatchEvent(new CustomEvent('connectprovider', {
            detail: { provider: this.node?.config?.provider }
        }));
    }

    // AI engine credential picker
    get isAiNode() {
        const t = this.node?.subType;
        return t === 'claude' || t === 'gpt4' || t === 'gemini';
    }
    /** Map internal subType to the AiEngineConnection__c EngineType__c picklist. */
    get engineTypeForPicker() {
        const t = this.node?.subType;
        return t === 'gpt4' ? 'openai' : t;
    }
    /** The AgentNode__c record Id (falsy for unsaved nodes). */
    get agentNodeRecordId() {
        const id = this.node?.id;
        if (!id || String(id).startsWith('tmp_')) return null;
        return id;
    }
    get boundConnectionId() {
        return this.node?.aiEngineConnectionId || null;
    }
    get canBindPicker()   { return !!this.agentNodeRecordId; }
    get pickerBlockedMsg() {
        return 'Save the canvas first so this node has a stable Id, then come back to bind an engine credential.';
    }

    handlePickerConfigChange(event) {
        const { connectionId } = event.detail || {};
        // Bubble up so agentCanvas can persist the change onto AgentNode__c.
        this.dispatchEvent(new CustomEvent('config', {
            detail: { field: 'aiEngineConnectionId', value: connectionId }
        }));
    }

    handleFieldChange(e) {
        const key   = e.currentTarget.dataset.key;
        const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        this.dispatchEvent(new CustomEvent('config', { detail: { field: key, value } }));
        // Picking a new connector flips us back to chip mode
        if (key === 'connectorId' && value) this._showConnectorPicker = false;
    }

    handleMultiselectChange(e) {
        const fieldKey = e.currentTarget.dataset.key;
        const option   = e.currentTarget.dataset.option;
        const isChecked = e.target.checked;
        const current = Array.isArray(this.node?.config?.[fieldKey]) ? [...this.node.config[fieldKey]] : [];
        const next = isChecked
            ? (current.includes(option) ? current : [...current, option])
            : current.filter(v => v !== option);
        this.dispatchEvent(new CustomEvent('config', { detail: { field: fieldKey, value: next } }));
    }

    handleExampleChange(e) {
        const fieldKey = e.currentTarget.dataset.key;
        const idx      = Number(e.currentTarget.dataset.idx);
        const which    = e.currentTarget.dataset.which; // 'input' | 'output'
        const current = Array.isArray(this.node?.config?.[fieldKey]) ? [...this.node.config[fieldKey]] : [];
        if (!current[idx]) current[idx] = { input: '', output: '' };
        current[idx] = { ...current[idx], [which]: e.target.value };
        this.dispatchEvent(new CustomEvent('config', { detail: { field: fieldKey, value: current } }));
    }

    handleAddExample(e) {
        const fieldKey = e.currentTarget.dataset.key;
        const current = Array.isArray(this.node?.config?.[fieldKey]) ? [...this.node.config[fieldKey]] : [];
        current.push({ input: '', output: '' });
        this.dispatchEvent(new CustomEvent('config', { detail: { field: fieldKey, value: current } }));
    }

    handleRemoveExample(e) {
        const fieldKey = e.currentTarget.dataset.key;
        const idx      = Number(e.currentTarget.dataset.idx);
        const current = Array.isArray(this.node?.config?.[fieldKey]) ? [...this.node.config[fieldKey]] : [];
        current.splice(idx, 1);
        this.dispatchEvent(new CustomEvent('config', { detail: { field: fieldKey, value: current } }));
    }

    handleLabelChange(e) {
        this.dispatchEvent(new CustomEvent('labelchange', { detail: { value: e.target.value } }));
    }

    handleTestNode() {
        this.dispatchEvent(new CustomEvent('testnode', { detail: { node: this.node } }));
    }
}
