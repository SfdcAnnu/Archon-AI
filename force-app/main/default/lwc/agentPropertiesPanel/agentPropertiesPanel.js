import { LightningElement, api, track, wire } from 'lwc';
import getConnectorsForCatalogType from '@salesforce/apex/AgentConnectorController.getConnectorsForCatalogType';
import getConnectorTools from '@salesforce/apex/AgentConnectorController.getConnectorTools';
import getDirectory      from '@salesforce/apex/AgentConnectorController.getDirectory';
import getMcpToolCatalog from '@salesforce/apex/AgentConnectorController.getMcpToolCatalog';
import getMcpToolSchemas from '@salesforce/apex/AgentConnectorController.getMcpToolSchemas';
import getCustomActionCatalog from '@salesforce/apex/AgentConnectorController.getCustomActionCatalog';
import describeCustomAction    from '@salesforce/apex/AgentConnectorController.describeCustomAction';

// Text/textarea fields that hold an identifier/name rather than an
// interpolated value — the {!...} insert button is hidden for these.
const NO_INTERPOLATION_KEYS = new Set([
    'className', 'methodName', 'variableName', 'iteratorVar', 'cronExpression'
]);

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
                   { key: 'fields', label: 'Fields (comma separated)', type: 'text', placeholder: 'Id,Name,Email,Company' },
                   { key: 'outputVariable', label: 'Output variable name (optional)', type: 'text', placeholder: 'leadRecord',
                     hint: 'Name this record so later nodes can reference its fields as {!leadRecord.Email}, {!leadRecord.Company}, etc.' }],
    update_record:[{ key: 'objectType', label: 'SF Object', type: 'text', placeholder: 'Lead' },
                   { key: 'fieldMappings', label: 'Field mappings (JSON)', type: 'textarea', placeholder: '{"Status__c": "Hot", "Score__c": "{!ai.score}"}' },
                   { key: 'outputVariable', label: 'Output variable name (optional)', type: 'text', placeholder: 'updateResult',
                     hint: 'Reference downstream as {!updateResult.id} / {!updateResult.success}.' }],
    create_record:[{ key: 'objectType', label: 'SF Object', type: 'text', placeholder: 'Task' },
                   { key: 'fieldMappings', label: 'Field values (JSON)', type: 'textarea', placeholder: '{"Subject": "Follow up", "Priority": "High"}' },
                   { key: 'outputVariable', label: 'Output variable name (optional)', type: 'text', placeholder: 'newRecord',
                     hint: 'Reference downstream as {!newRecord.id} — the new record\'s Id.' }],
    query_records:[{ key: 'soql', label: 'SOQL query', type: 'textarea', placeholder: "SELECT Id, Name FROM Lead WHERE Id = '{!recordId}'" },
                   { key: 'outputVariable', label: 'Output variable name (optional)', type: 'text', placeholder: 'queryResults',
                     hint: 'Reference downstream as {!queryResults.count}, or wire {!queryResults.records} into a Loop node\'s collection.' }],
    create_task:  [{ key: 'subject', label: 'Subject', type: 'text', placeholder: 'Follow up with lead' },
                   { key: 'dueDate', label: 'Due date', type: 'text', placeholder: 'TODAY+1' },
                   { key: 'priority', label: 'Priority', type: 'picklist', options: ['High','Normal','Low'] },
                   { key: 'outputVariable', label: 'Output variable name (optional)', type: 'text', placeholder: 'newTask',
                     hint: 'Reference downstream as {!newTask.id}.' }],
    post_chatter: [{ key: 'message', label: 'Message', type: 'textarea', placeholder: 'Lead scored {!ai.score} — action required' },
                   { key: 'outputVariable', label: 'Output variable name (optional)', type: 'text', placeholder: 'chatterPost',
                     hint: 'Reference downstream as {!chatterPost.id}.' }],
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
    set_variable: [{ key: 'variableName', label: 'Variable name', type: 'text', placeholder: 'leadSummary',
                     hint: 'Letters, numbers, no spaces. Reference it downstream as {!leadSummary.value}.' },
                   { key: 'template', label: 'Value', type: 'textarea', placeholder: '{!ai.finalText}',
                     hint: 'Plain text or {!variables} — see the Variables tab. Combine several with normal text.' }],
    loop:         [{ key: 'collectionVar', label: 'Collection variable', type: 'text', placeholder: '{!records}',
                     hint: 'Must resolve to a list — e.g. a query_records or Call-a-Tool node\'s array output.' },
                   { key: 'iteratorVar',   label: 'Iterator variable',   type: 'text', placeholder: 'item',
                     hint: 'Reference the current item downstream as {!item.FieldName} (or {!item.value} for a plain list).' },
                   { key: 'maxIterations', label: 'Max iterations', type: 'number', min: 1, max: 100,
                     hint: 'Hard-capped at 100 regardless of this value.' }],
    wait:         [{ key: 'delayValue', label: 'Delay', type: 'number', min: 0 },
                   { key: 'delayUnit', label: 'Unit', type: 'picklist', options: ['seconds','minutes','hours','days'],
                     hint: '60 seconds or less runs inline. Longer than that pauses the run durably — it survives a server restart and resumes on its own.' }],
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
    /** Full canvas graph — passed down so this panel can figure out which
     *  variables (trigger fields, AI score, Set Variable outputs) are
     *  actually available upstream of the selected node. */
    @api allNodes = [];
    @api connections = [];

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
    // The provider key is captured WITH the payload: when the user clicks
    // from one connector node to another, the wire briefly still holds the
    // previous provider's tools — without the stamp, the auto-default would
    // write e.g. Salesforce tool names into a Gmail node's config.
    // IMPERATIVE catalog loader — deliberately NOT a @wire. refreshApex on
    // an errored wire does not reliably re-provision, which left the Tools
    // tab spinning forever behind sleeping free-tier servers. Here every
    // attempt, delay, and terminal state is explicit.
    @track _mcpCatalog = { providerKey: null, data: undefined, error: undefined };
    @track _catalogInFlight = false;
    _catalogSeq = 0;

    async loadCatalog(providerKey) {
        const seq = ++this._catalogSeq;          // supersede older runs
        this._catalogInFlight = true;
        this._mcpCatalog = { providerKey, data: undefined, error: undefined };

        const MAX_ATTEMPTS = 10;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const rows = await getMcpToolCatalog({ providerKey });
                if (seq !== this._catalogSeq) return;     // node/provider changed
                this._mcpCatalog = { providerKey, data: rows, error: undefined };
                this._catalogInFlight = false;
                return;
            } catch (e) {
                if (seq !== this._catalogSeq) return;
                const msg = e?.body?.message || e?.message || '';
                const retriable = /SERVER_WAKING|Application loading|upstream|unreachable|502|503|timed? ?out/i.test(msg);
                if (!retriable || attempt === MAX_ATTEMPTS) {
                    this._mcpCatalog = { providerKey, data: undefined, error: e };
                    this._catalogInFlight = false;
                    return;
                }
                // eslint-disable-next-line @lwc/lwc/no-async-operation
                await new Promise(resolve => setTimeout(resolve, 8000));
            }
        }
    }

    /** Catalog payload, but only when it belongs to the CURRENT provider. */
    get wiredMcpCatalog() {
        return this._mcpCatalog.providerKey === this.providerKeyForCatalog
            ? this._mcpCatalog
            : { data: undefined, error: undefined };
    }

    get providerKeyForCatalog() {
        if (!CATALOG_SUBTYPES.includes(this.node?.subType)) return null;
        // Legacy nodes (saved before provider was stamped at drop time)
        // fall back to an unambiguous subType mapping.
        const LEGACY_PROVIDER_BY_SUBTYPE = { salesforce_crm_tools: 'salesforce_mcp' };
        return this.node?.config?.provider
            || LEGACY_PROVIDER_BY_SUBTYPE[this.node?.subType]
            || null;
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
            // allowedTools must ALWAYS come from a live MCP source — never
            // the static schema options (kept only as field metadata).
            const liveNames = this.liveCatalog ? this.liveCatalog.map(t => t.name) : liveTools;
            const msOptions = (isMultiselect && f.key === 'allowedTools')
                ? (liveNames || [])
                : (f.options || []);
            return {
                ...f,
                value: raw ?? (isMultiselect ? [] : isExamples ? [] : ''),
                isText:        f.type === 'text',
                isTextarea:    f.type === 'textarea',
                isNumber:      f.type === 'number',
                isPicklist:    f.type === 'picklist' || isConnector,
                isToggle:      f.type === 'toggle',
                supportsVariables: (f.type === 'text' || f.type === 'textarea') && !NO_INTERPOLATION_KEYS.has(f.key),
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

    get isCatalogNode()  { return CATALOG_SUBTYPES.includes(this.node?.subType); }
    get isIfElseNode()   { return this.node?.subType === 'if_else'; }
    get isCallToolNode() { return this.node?.subType === 'call_tool'; }

    // ── Variables (scoped to nodes upstream of the selection) ────
    // Walks the connection graph BACKWARD from the selected node so the
    // Variables tab — and the click-to-insert pickers on If/Else and
    // Call-a-Tool — only ever offer tokens that actually resolve at
    // runtime, instead of a generic static list.
    get upstreamNodeIds() {
        const visited = new Set();
        const selfId = this.node?.id;
        if (!selfId || !Array.isArray(this.connections)) return visited;
        const incoming = new Map();
        this.connections.forEach(c => {
            if (!incoming.has(c.toNodeId)) incoming.set(c.toNodeId, []);
            incoming.get(c.toNodeId).push(c.fromNodeId);
        });
        const queue = [selfId];
        while (queue.length > 0) {
            const cur = queue.shift();
            for (const pred of (incoming.get(cur) || [])) {
                if (!visited.has(pred)) { visited.add(pred); queue.push(pred); }
            }
        }
        return visited;
    }

    get availableVariables() {
        const ids = this.upstreamNodeIds;
        const nodesById = new Map((this.allNodes || []).map(n => [n.id, n]));
        let hasTrigger = false;
        let hasAi = false;
        const customVars = [];
        const ACTION_OUTPUT_EXAMPLE = {
            get_record:    'FieldApiName',
            update_record: 'id',
            create_record: 'id',
            query_records: 'count',
            create_task:   'id',
            post_chatter:  'id'
        };
        ids.forEach(id => {
            const n = nodesById.get(id);
            if (!n) return;
            if (n.type === 'trigger') hasTrigger = true;
            if (n.type === 'ai') hasAi = true;
            if (n.subType === 'set_variable' && n.config?.variableName) {
                customVars.push({ token: `{!${n.config.variableName}.value}`, hint: `Set by "${n.label || 'Set Variable'}"` });
            }
            const example = ACTION_OUTPUT_EXAMPLE[n.subType];
            if (example && n.config?.outputVariable) {
                customVars.push({ token: `{!${n.config.outputVariable}.${example}}`, hint: `Output of "${n.label || n.subType}"` });
            }
        });
        const out = [];
        if (hasTrigger) out.push({ token: '{!record.Field}', hint: "Trigger record field — replace Field with the API name, e.g. {!record.Email}" });
        out.push({ token: '{!recordId}', hint: "The triggering record's Id" });
        if (hasAi) {
            out.push(
                { token: '{!ai.score}',     hint: 'Most recent AI score' },
                { token: '{!ai.priority}',  hint: 'Most recent AI priority' },
                { token: '{!ai.finalText}', hint: "Most recent AI response text" }
            );
        }
        out.push(...customVars);
        out.push({ token: '{!input.X}', hint: 'A value passed in via inputPayload — replace X with the key' });
        // Always-available context — not scoped to upstream nodes since these
        // don't depend on the graph, only on who/where the agent is running.
        out.push(
            { token: '{!user.Id}',       hint: 'Running user — Id' },
            { token: '{!user.Name}',     hint: 'Running user — full name' },
            { token: '{!user.Email}',    hint: 'Running user — email' },
            { token: '{!user.Username}', hint: 'Running user — username' },
            { token: '{!org.Id}',        hint: 'Organization Id' },
            { token: '{!org.Name}',      hint: 'Organization name' }
        );
        return out;
    }

    /**
     * Deterministic per-field "insert a field/variable" menus — each button
     * carries its own data-key/data-part, so selecting a token always lands
     * in the exact field the button sits next to. Replaces an earlier
     * design (a shared Variables tab + "insert into whatever was last
     * clicked") that was unreliable across tab switches.
     */
    handleInsertFieldToken(e) {
        const key = e.currentTarget.dataset.key;
        const token = e.detail.value;
        if (!key || !token) return;
        const current = String(this.node?.config?.[key] ?? '');
        const value = current ? `${current} ${token}` : token;
        this.dispatchEvent(new CustomEvent('config', { detail: { field: key, value } }));
    }

    handleInsertConditionToken(e) {
        const part = e.currentTarget.dataset.part;
        const token = e.detail.value;
        if (!part || !token) return;
        const parts = this.conditionParts;
        const existing = parts[part] || '';
        this.applyConditionParts({ ...parts, [part]: existing ? `${existing} ${token}` : token });
    }

    handleInsertParamToken(e) {
        const key = e.currentTarget.dataset.key;
        const token = e.detail.value;
        if (!key || !token) return;
        const current = { ...(this.node?.config?.paramValues || {}) };
        current[key] = current[key] ? `${current[key]} ${token}` : token;
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'paramValues', value: current } }));
    }

    // ── If/Else condition builder ─────────────────────────
    // Compiles down to the SAME "{!x} op y" string the engine's
    // evalCondition() already parses — no engine change needed here.
    get conditionOperatorOptions() {
        return [
            { label: '=  equals',            value: '==' },
            { label: '≠  not equals',        value: '!=' },
            { label: '>  greater than',      value: '>' },
            { label: '<  less than',         value: '<' },
            { label: '≥  greater or equal',  value: '>=' },
            { label: '≤  less or equal',     value: '<=' }
        ];
    }
    get conditionParts() {
        const raw = String(this.node?.config?.condition ?? '').trim();
        const match = raw.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
        if (!match) return { lhs: raw, op: '>', rhs: '' };
        const [, lhs, op, rhs] = match;
        return { lhs: lhs.trim(), op, rhs: rhs.trim() };
    }
    applyConditionParts(parts) {
        const composed = `${parts.lhs || ''} ${parts.op || '>'} ${parts.rhs || ''}`.trim();
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'condition', value: composed } }));
    }
    get ifElseScoreHint() {
        return 'Using {!ai.score} or {!ai.priority}? The upstream AI node asks the model for these automatically, but a busy tool-calling reply can occasionally omit them. Run "Test this node" after building the flow — the Execution Log will call out an unresolved value by name instead of failing silently.';
    }
    handleConditionLhsChange(e) { this.applyConditionParts({ ...this.conditionParts, lhs: e.target.value }); }
    handleConditionOpChange(e)  { this.applyConditionParts({ ...this.conditionParts, op: e.detail.value }); }
    handleConditionRhsChange(e) { this.applyConditionParts({ ...this.conditionParts, rhs: e.target.value }); }

    // ── Call a Tool (generic action node) ─────────────────
    // Same connector directory the catalog nodes use for the provider
    // picklist; tool schemas + custom-action catalog are fetched live,
    // exactly like the AI's own tool discovery — never hardcoded.
    get callToolProvider()    { return this.node?.config?.provider || ''; }
    get callToolConnectorId() { return this.node?.config?.connectorId || ''; }
    get callToolKind()        { return this.node?.config?.toolKind || 'standard'; }
    get callToolName()        { return this.node?.config?.toolName || ''; }
    get callToolSupportsCustom() { return this.callToolProvider === 'salesforce_mcp'; }
    get isCallToolStandard() { return this.callToolKind !== 'custom'; }
    get isCallToolCustom()   { return this.callToolKind === 'custom' && this.callToolSupportsCustom; }

    get callToolProviderOptions() {
        if (!this._allTiles || this._allTiles.length === 0) {
            return [{ label: '— No connected providers — open Connectors to add one —', value: '' }];
        }
        return this._allTiles.map(t => ({
            label: t.displayName + (t.accountEmail ? `  ·  ${t.accountEmail}` : ''),
            value: t.providerKey
        }));
    }
    get callToolKindOptions() {
        const opts = [{ label: 'Standard tool (from the connector)', value: 'standard' }];
        if (this.callToolSupportsCustom) opts.push({ label: "Custom — my org's Apex action / Flow", value: 'custom' });
        return opts;
    }

    handleCallToolProviderChange(e) {
        const value = e.detail.value;
        const tile = (this._allTiles || []).find(t => t.providerKey === value);
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'provider', value } }));
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'connectorId', value: tile ? tile.connectorId : '' } }));
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'toolKind', value: 'standard' } }));
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'toolName', value: '' } }));
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'customToolType', value: '' } }));
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'paramValues', value: {} } }));
    }
    handleCallToolKindChange(e) {
        const value = e.detail.value;
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'toolKind', value } }));
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'toolName', value: '' } }));
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'customToolType', value: '' } }));
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'paramValues', value: {} } }));
    }

    // Standard tools — live tools/list WITH schemas from the MCP server.
    @track _callToolTools = { providerKey: null, data: undefined, error: undefined };
    @track _callToolLoading = false;
    _callToolSeq = 0;

    async loadCallToolSchemas(providerKey) {
        const seq = ++this._callToolSeq;
        this._callToolLoading = true;
        this._callToolTools = { providerKey, data: undefined, error: undefined };
        const connectorId = this.callToolConnectorId || null;
        const MAX_ATTEMPTS = 8;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const rows = await getMcpToolSchemas({ providerKey, connectorId });
                if (seq !== this._callToolSeq) return;
                this._callToolTools = { providerKey, data: rows, error: undefined };
                this._callToolLoading = false;
                return;
            } catch (e) {
                if (seq !== this._callToolSeq) return;
                const msg = e?.body?.message || e?.message || '';
                const retriable = /SERVER_WAKING|Application loading|upstream|unreachable|502|503|timed? ?out/i.test(msg);
                if (!retriable || attempt === MAX_ATTEMPTS) {
                    this._callToolTools = { providerKey, data: undefined, error: e };
                    this._callToolLoading = false;
                    return;
                }
                // eslint-disable-next-line @lwc/lwc/no-async-operation
                await new Promise(resolve => setTimeout(resolve, 8000));
            }
        }
    }

    get callToolStandardRows() {
        const tools = (this._callToolTools.providerKey === this.callToolProvider) ? this._callToolTools.data : undefined;
        if (!Array.isArray(tools)) return [];
        const prettify = t => String(t).replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, c => c.toUpperCase());
        const selected = this.callToolName;
        return tools.map(t => ({
            value: t.name,
            label: prettify(t.name),
            description: t.description,
            rowClass: t.name === selected ? 'tool-row tool-row--on' : 'tool-row',
            checkClass: t.name === selected ? 'tool-check tool-check--on' : 'tool-check'
        }));
    }
    get callToolStandardLoading() {
        return this.callToolKind === 'standard' && !!this.callToolProvider
            && this._callToolTools.providerKey !== this.callToolProvider && this._callToolLoading;
    }
    get callToolStandardError() {
        if (this.callToolKind !== 'standard' || this._callToolTools.providerKey !== this.callToolProvider) return null;
        const err = this._callToolTools.error;
        return err ? (err?.body?.message || err?.message || 'Could not load tools.') : null;
    }
    handleCallToolStandardSelect(e) {
        const toolName = e.currentTarget.dataset.option;
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'toolName', value: toolName } }));
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'paramValues', value: {} } }));
    }
    get callToolSelectedSchema() {
        const tools = this._callToolTools.data;
        if (!Array.isArray(tools)) return null;
        const tool = tools.find(t => t.name === this.callToolName);
        if (!tool || !tool.inputSchema) return null;
        try { return JSON.parse(tool.inputSchema); } catch { return null; }
    }

    // Custom tools — org's own Apex actions / Flows (Salesforce provider only).
    @track _customCatalog = { data: undefined, error: undefined, loading: false };
    async loadCustomCatalog() {
        this._customCatalog = { data: undefined, error: undefined, loading: true };
        try {
            const raw = await getCustomActionCatalog();
            const parsed = JSON.parse(raw);
            this._customCatalog = { data: parsed.actions || [], error: undefined, loading: false };
        } catch (e) {
            this._customCatalog = { data: undefined, error: e?.body?.message || e?.message || 'Could not load custom actions.', loading: false };
        }
    }
    get callToolCustomOptions() {
        return (this._customCatalog.data || []).map(i => ({
            label: `${i.label || i.name}  ·  ${i.type === 'apex' ? 'Apex' : 'Flow'}`,
            value: `${i.type}:${i.name}`
        }));
    }
    get callToolCustomValue() {
        const type = this.node?.config?.customToolType;
        return type && this.callToolName ? `${type}:${this.callToolName}` : '';
    }
    get callToolCustomLoading() { return this._customCatalog.loading; }
    get callToolCustomError()   { return this._customCatalog.error || null; }

    @track _customToolSchema = { key: null, data: undefined, loading: false, error: undefined };
    async loadCustomToolSchema(type, name) {
        const key = `${type}:${name}`;
        this._customToolSchema = { key, data: undefined, loading: true, error: undefined };
        try {
            const raw = await describeCustomAction({ actionType: type, name });
            const d = JSON.parse(raw);
            this._customToolSchema = { key, data: d, loading: false, error: undefined };
        } catch (e) {
            this._customToolSchema = { key, data: undefined, loading: false, error: e?.body?.message || e?.message || 'Could not load the schema.' };
        }
    }
    handleCallToolCustomSelect(e) {
        const raw = e.detail.value;
        const idx = raw.indexOf(':');
        if (idx < 0) return;
        const type = raw.slice(0, idx);
        const name = raw.slice(idx + 1);
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'customToolType', value: type } }));
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'toolName', value: name } }));
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'paramValues', value: {} } }));
        this.loadCustomToolSchema(type, name);
    }

    // Param fields — schema-driven for either kind, rendered identically.
    get callToolParamFields() {
        const current = this.node?.config?.paramValues || {};
        if (this.callToolKind === 'custom') {
            const key = this.callToolCustomValue;
            if (!key || this._customToolSchema.key !== key || !this._customToolSchema.data) return [];
            return (this._customToolSchema.data.inputs || []).map(inp => ({
                key: inp.name,
                label: inp.name + (inp.required ? ' (required)' : ''),
                description: inp.description || inp.label || '',
                value: current[inp.name] ?? '',
                isMultiline: inp.type === 'textarea' || inp.type === 'object'
            }));
        }
        const schema = this.callToolSelectedSchema;
        if (!schema || !schema.properties) return [];
        const required = new Set(schema.required || []);
        return Object.keys(schema.properties).map(key => {
            const p = schema.properties[key] || {};
            return {
                key,
                label: key + (required.has(key) ? ' (required)' : ''),
                description: p.description || '',
                value: current[key] ?? '',
                isMultiline: p.type === 'object' || p.type === 'array'
            };
        });
    }
    get callToolNoParams() {
        return !!this.callToolName && this.callToolParamFields.length === 0;
    }
    handleCallToolParamChange(e) {
        const key = e.currentTarget.dataset.param;
        const current = { ...(this.node?.config?.paramValues || {}) };
        current[key] = e.target.value;
        this.dispatchEvent(new CustomEvent('config', { detail: { field: 'paramValues', value: current } }));
    }

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
        else if (t === 'action')  tint = 'ic-teal';
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
        return this.fields
            .filter(f => !(this.isAiNode && f.key === 'model'))
            // If/Else renders its own lhs/op/rhs builder instead of the raw condition text box.
            .filter(f => !(this.isIfElseNode && f.key === 'condition'));
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
     * Tool catalog resolution order — LIVE sources only, never hardcoded:
     *   1. Public /tools catalog (name+description+readOnly) — provider-level
     *   2. Authenticated MCP tools/list (names) — connector-level
     * If neither is available the template shows a loading or error state;
     * a static tool list must never appear (tools belong to the MCP server).
     */
    get liveCatalog() {
        const rows = this.wiredMcpCatalog?.data;
        return Array.isArray(rows) && rows.length > 0 ? rows : null;
    }

    /** True while the provider-level /tools fetch is still in flight. */
    get catalogLoading() {
        if (!this.isCatalogNode || !this.providerKeyForCatalog) return false;
        if (this.liveCatalog || this.effectiveToolOptions) return false;
        return this._catalogInFlight;
    }

    /** Error message when the /tools fetch failed and no live source is left. */
    get catalogError() {
        if (this._catalogInFlight) return null;
        if (!this.isCatalogNode || this.liveCatalog || this.effectiveToolOptions) return null;
        const err = this.wiredMcpCatalog?.error;
        if (err) {
            return err?.body?.message || err?.statusText || 'Could not reach the MCP server.';
        }
        // Wire resolved but came back empty — catalog record or server issue.
        const rows = this.wiredMcpCatalog?.data;
        if (Array.isArray(rows) && rows.length === 0) {
            return 'The MCP server returned no tools. Check the connector catalog McpServerUrl and that the server is running.';
        }
        return null;
    }

    handleCatalogRetry() {
        if (this.providerKeyForCatalog) this.loadCatalog(this.providerKeyForCatalog);
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
        } else if (this.effectiveToolOptions) {
            // Authenticated MCP tools/list — still live, just names only.
            catalog = this.effectiveToolOptions.map(v => ({ value: v, description: null, readOnly: null }));
        } else {
            // No live source — template shows loading/error, never static tools.
            return [];
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
    get noTools() {
        return this.isCatalogNode && this.toolRows.length === 0
            && !this.catalogLoading && !this.catalogError;
    }

    _defaultedForNodeId = null;
    _catalogProvider = null;
    _callToolProviderLoaded = null;
    _customCatalogRequested = false;
    _focusTrackedNodeId = null;

    renderedCallback() {
        // Reset transient per-node UI state (click-to-insert target) when
        // the selected node changes, so a stale field key from a
        // previously-selected node never gets written to the new one.
        if (this._focusTrackedNodeId !== this.node?.id) {
            this._focusTrackedNodeId = this.node?.id;
            this._lastFocusTarget = null;
        }

        // Tools-tab catalog (connector/catalog nodes) — kick the imperative
        // load when the selected node's provider changes.
        if (this.providerKeyForCatalog !== this._catalogProvider) {
            this._catalogProvider = this.providerKeyForCatalog;
            if (this._catalogProvider) this.loadCatalog(this._catalogProvider);
        }
        if (this.isCatalogNode && this.liveCatalog && this._defaultedForNodeId !== this.node?.id) {
            this.applyCatalogAutoDefault();
        }

        // Call-a-Tool node — standard tool schemas + custom action catalog.
        if (this.isCallToolNode) {
            if (this.callToolKind === 'standard' && this.callToolProvider) {
                if (this._callToolProviderLoaded !== this.callToolProvider) {
                    this._callToolProviderLoaded = this.callToolProvider;
                    this.loadCallToolSchemas(this.callToolProvider);
                }
            } else if (this._callToolProviderLoaded) {
                this._callToolProviderLoaded = null;
            }
            if (this.callToolKind === 'custom' && !this._customCatalogRequested) {
                this._customCatalogRequested = true;
                this.loadCustomCatalog();
            } else if (this.callToolKind !== 'custom' && this._customCatalogRequested) {
                this._customCatalogRequested = false;
            }
            // Re-opening an already-configured custom-tool node: fetch its
            // param schema without waiting for the user to re-pick the tool
            // (re-picking would also reset their saved paramValues).
            const customType = this.node?.config?.customToolType;
            if (this.callToolKind === 'custom' && customType && this.callToolName) {
                const key = `${customType}:${this.callToolName}`;
                if (this._customToolSchema.key !== key) {
                    this.loadCustomToolSchema(customType, this.callToolName);
                }
            }
        }
    }

    /**
     * Auto-default: when the live catalog arrives and this node has never
     * had a selection (allowedTools missing — connector tiles drop with
     * null), pre-select the read-only tools. Never overrides a user's
     * choice, including an intentional empty selection ([]).
     */
    applyCatalogAutoDefault() {
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

    // ── Custom tools (org's own Apex actions / Flows) ─────
    // Only the Salesforce MCP connector supports them — they execute via
    // the org's invocable-actions API with the session's own token.
    @track showCustomToolPicker = false;

    get supportsCustomTools() {
        return this.isCatalogNode && this.providerKeyForCatalog === 'salesforce_mcp';
    }
    get selectedCustomTools() {
        const list = this.node?.config?.customTools;
        return Array.isArray(list) ? list : [];
    }
    get hasCustomTools() { return this.selectedCustomTools.length > 0; }
    get customToolRows() {
        return this.selectedCustomTools.map(t => ({
            ...t,
            key: `${t.type}:${t.name}`,
            label: t.label || t.name,
            typeLabel: t.type === 'apex' ? 'apex' : 'flow'
        }));
    }

    handleOpenCustomToolPicker()  { this.showCustomToolPicker = true; }
    handleCloseCustomToolPicker() { this.showCustomToolPicker = false; }

    handleAddCustomTool(e) {
        const { type, name, label } = e.detail;
        const current = this.selectedCustomTools;
        if (current.some(t => t.type === type && t.name === name)) return;
        this.dispatchEvent(new CustomEvent('config', {
            detail: { field: 'customTools', value: [...current, { type, name, label }] }
        }));
    }

    handleRemoveCustomTool(e) {
        const key = e.currentTarget.dataset.key;
        const next = this.selectedCustomTools.filter(t => `${t.type}:${t.name}` !== key);
        this.dispatchEvent(new CustomEvent('config', {
            detail: { field: 'customTools', value: next }
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
    get isSalesforceMcpAuth() {
        return this.providerKeyForCatalog === 'salesforce_mcp';
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
