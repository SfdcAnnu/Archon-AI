/**
 * AgentChatController — Apex side of the chat flow.
 *
 * Responsibilities:
 *   • Persist ChatSession__c + ChatMessage__c records (server is stateless for chat history)
 *   • Forward turns to the Synapse Node server's /api/chat/turn endpoint
 *   • Handle the write-tool approval pause/resume protocol
 *   • Enforce session expiry (24h sliding) + manual End
 *
 * Auth: same Bearer <SynapseInstall__c.SessionKey__c> pattern as other controllers.
 */
@SuppressWarnings('PMD.ApexCRUDViolation')
public with sharing class AgentChatController {

    private static final Integer CALLOUT_TIMEOUT_MS = 120000;   // 2-min — chat tool sequences can be slow
    private static final Integer EXPIRY_HOURS = 24;

    // ── PICKER ───────────────────────────────────────────────────

    /** List all chat-enabled agents the running user can see (record-level access enforced). */
    @AuraEnabled(cacheable=true)
    public static List<AgentSummary> listChatEnabledAgents(String filter) {
        String filterPattern = '%' + (filter == null ? '' : filter) + '%';
        List<AgentDefinition__c> rows = [
            SELECT Id, ApiName__c, Name, Department__c, Description__c, ExecuteType__c
            FROM AgentDefinition__c
            WHERE ExecuteType__c IN ('Chat', 'Both')
              AND Status__c = 'Active'
              AND (Name LIKE :filterPattern OR Department__c LIKE :filterPattern)
            WITH USER_MODE
            ORDER BY Name ASC
            LIMIT 200
        ];
        List<AgentSummary> out = new List<AgentSummary>();
        for (AgentDefinition__c a : rows) {
            AgentSummary s = new AgentSummary();
            s.apiName     = a.ApiName__c;
            s.name        = a.Name;
            s.department  = a.Department__c;
            s.description = a.Description__c;
            out.add(s);
        }
        return out;
    }

    // ── SESSION LIFECYCLE ────────────────────────────────────────

    @AuraEnabled
    public static SessionWithMessages startSession(String agentApiName, String recordContextId, String recordContextType) {
        if (String.isBlank(agentApiName)) {
            throw new AuraHandledException('agentApiName is required.');
        }
        AgentDefinition__c agent = loadAgent(agentApiName);
        Id userId = UserInfo.getUserId();
        DateTime nowTs = System.now();

        // Try to reuse an existing Active, non-expired session for this user/agent/recordContext.
        // Apex SOQL doesn't allow `:bindVar = null` comparisons, so split into two branches.
        List<ChatSession__c> existing;
        if (String.isBlank(recordContextId)) {
            existing = [
                SELECT Id FROM ChatSession__c
                WHERE User__c = :userId
                  AND AgentDefinition__c = :agent.Id
                  AND RecordContextId__c = null
                  AND Status__c = 'Active'
                  AND ExpiresAt__c > :nowTs
                WITH USER_MODE
                ORDER BY LastActivityAt__c DESC
                LIMIT 1
            ];
        } else {
            existing = [
                SELECT Id FROM ChatSession__c
                WHERE User__c = :userId
                  AND AgentDefinition__c = :agent.Id
                  AND RecordContextId__c = :recordContextId
                  AND Status__c = 'Active'
                  AND ExpiresAt__c > :nowTs
                WITH USER_MODE
                ORDER BY LastActivityAt__c DESC
                LIMIT 1
            ];
        }

        ChatSession__c session;
        if (!existing.isEmpty()) {
            session = [
                SELECT Id, Name, AgentDefinition__c, AgentDefinition__r.ApiName__c, AgentDefinition__r.Name,
                       User__c, RecordContextId__c, RecordContextType__c, Title__c, Status__c,
                       LastActivityAt__c, ExpiresAt__c, Department__c, TotalTurns__c,
                       TokensIn__c, TokensOut__c, PendingApprovalToken__c
                FROM ChatSession__c WHERE Id = :existing[0].Id WITH USER_MODE LIMIT 1
            ];
        } else {
            session = new ChatSession__c(
                AgentDefinition__c   = agent.Id,
                User__c              = userId,
                RecordContextId__c   = recordContextId,
                RecordContextType__c = recordContextType,
                Status__c            = 'Active',
                LastActivityAt__c    = System.now(),
                ExpiresAt__c         = System.now().addHours(EXPIRY_HOURS),
                Department__c        = agent.Department__c,
                TotalTurns__c        = 0
            );
            insert session;
            session = [
                SELECT Id, Name, AgentDefinition__c, AgentDefinition__r.ApiName__c, AgentDefinition__r.Name,
                       User__c, RecordContextId__c, RecordContextType__c, Title__c, Status__c,
                       LastActivityAt__c, ExpiresAt__c, Department__c, TotalTurns__c,
                       TokensIn__c, TokensOut__c, PendingApprovalToken__c
                FROM ChatSession__c WHERE Id = :session.Id WITH USER_MODE LIMIT 1
            ];
        }

        SessionWithMessages r = new SessionWithMessages();
        r.session  = session;
        r.messages = loadMessages(session.Id);
        return r;
    }

    @AuraEnabled
    public static SessionWithMessages getSession(Id sessionId) {
        ChatSession__c session = loadActiveSession(sessionId, false);  // don't throw if expired — let caller see
        SessionWithMessages r = new SessionWithMessages();
        r.session  = session;
        r.messages = loadMessages(sessionId);
        return r;
    }

    @AuraEnabled
    public static List<SessionSummary> listMySessions(Integer limitN) {
        Integer lim = (limitN == null || limitN <= 0) ? 20 : Math.min(limitN, 100);
        Id userId = UserInfo.getUserId();
        List<ChatSession__c> rows = [
            SELECT Id, Name, AgentDefinition__r.Name, AgentDefinition__r.ApiName__c,
                   Title__c, Status__c, LastActivityAt__c, ExpiresAt__c, TotalTurns__c,
                   RecordContextId__c
            FROM ChatSession__c
            WHERE User__c = :userId
            WITH USER_MODE
            ORDER BY LastActivityAt__c DESC NULLS LAST, CreatedDate DESC
            LIMIT :lim
        ];
        List<SessionSummary> out = new List<SessionSummary>();
        for (ChatSession__c s : rows) {
            SessionSummary o = new SessionSummary();
            o.id              = s.Id;
            o.name            = s.Name;
            o.agentName       = s.AgentDefinition__r != null ? s.AgentDefinition__r.Name    : null;
            o.agentApiName    = s.AgentDefinition__r != null ? s.AgentDefinition__r.ApiName__c : null;
            o.title           = s.Title__c;
            o.status          = s.Status__c;
            o.lastActivityAt  = s.LastActivityAt__c;
            o.expiresAt       = s.ExpiresAt__c;
            o.totalTurns      = (Integer) (s.TotalTurns__c == null ? 0 : s.TotalTurns__c);
            o.recordContextId = s.RecordContextId__c;
            out.add(o);
        }
        return out;
    }

    @AuraEnabled
    public static void endSession(Id sessionId) {
        ChatSession__c s = loadActiveSession(sessionId, false);
        s.Status__c = 'Ended';
        s.PendingApprovalToken__c = null;
        update s;
    }

    // ── THE TURN ─────────────────────────────────────────────────

    @AuraEnabled
    public static TurnResult sendTurn(Id sessionId, String userText, List<AttachmentInput> attachments) {
        Boolean hasText = !String.isBlank(userText);
        Boolean hasAttachments = attachments != null && !attachments.isEmpty();
        if (!hasText && !hasAttachments) throw new AuraHandledException('Send some text or attach a file.');
        if (hasText && userText.length() > 10000) throw new AuraHandledException('Message too long (max 10,000 chars).');

        // ── Phase 1: SELECTs + callout. ZERO DML before HTTP. ──
        ChatSession__c session = loadActiveSession(sessionId, true);
        AgentDefinition__c agent = [
            SELECT Id, ApiName__c, Name
            FROM AgentDefinition__c WHERE Id = :session.AgentDefinition__c WITH USER_MODE LIMIT 1
        ];
        List<ChatMessage__c> history = loadMessages(sessionId);

        Map<String, Object> payload = buildTurnPayload(agent.ApiName__c, session, history, userText == null ? '' : userText);
        if (hasAttachments) payload.put('attachments', buildAttachmentsPayload(attachments));

        // Salesforce owns all connector config — MCP URLs + the admin's tool
        // selection travel with every turn so Node stays stateless for config.
        List<Map<String, Object>> connectorsPayload = buildConnectorsPayload(session.AgentDefinition__c);
        if (!connectorsPayload.isEmpty()) payload.put('connectors', connectorsPayload);

        // Resolve engine credentials for this turn.
        // May be null → Node falls back to its .env keys (dev/staging path).
        AgentNode__c aiNode = findAiNode(session.AgentDefinition__c);
        Id resolvedConnectionId = null;
        if (aiNode != null && String.isNotBlank(aiNode.NodeSubType__c)) {
            AiEngineConnection__c cred = AiEngineConnectionController.resolveForRuntime(
                aiNode.NodeSubType__c, aiNode.AiEngineConnection__c
            );
            if (cred != null) {
                resolvedConnectionId = cred.Id;
                payload.put('engineOverride', new Map<String, Object>{
                    'engineType'   => cred.EngineType__c,
                    'apiKey'       => cred.ApiKey__c,
                    'endpoint'     => cred.Endpoint__c,
                    'defaultModel' => cred.DefaultModel__c,
                    'connectionId' => cred.Id
                });
            }
        }

        HttpResponse res = null;
        String errorMessage = null;
        try {
            res = callout('POST', '/api/chat/turn', JSON.serialize(payload));
        } catch (Exception e) {
            // Callout couldn't complete at the HTTP layer (DNS, TLS, timeout, blocked endpoint).
            errorMessage = 'Could not reach the AI service: ' + e.getMessage();
        }
        if (errorMessage == null && res != null && res.getStatusCode() >= 400) {
            errorMessage = extractServerError(res);
        }

        // ── Phase 2: ALWAYS persist the user's message so it never disappears from
        // the chat panel, then either append the assistant reply or an error bubble.
        Integer nextSeq = nextSequenceNumber(sessionId);
        ChatMessage__c userMsg = new ChatMessage__c(
            ChatSession__c    = sessionId,
            Role__c           = 'User',
            Content__c        = hasText ? userText : '',
            SequenceNumber__c = nextSeq,
            ApprovalStatus__c = 'NotRequired',
            AttachedContentDocumentIds__c = hasAttachments ? joinDocIds(attachments) : null
        );
        insert userMsg;

        // Error path — persist a visible "⚠" assistant bubble and return status='error'.
        if (errorMessage != null) {
            String display = errorMessage.length() > 32000 ? errorMessage.left(32000) : errorMessage;
            ChatMessage__c errMsg = new ChatMessage__c(
                ChatSession__c    = sessionId,
                Role__c           = 'Assistant',
                Content__c        = '⚠ ' + display,
                SequenceNumber__c = nextSeq + 1,
                ApprovalStatus__c = 'NotRequired'
            );
            insert errMsg;

            session.LastActivityAt__c = System.now();
            session.ExpiresAt__c      = System.now().addHours(EXPIRY_HOURS);
            update session;

            TurnResult r = new TurnResult();
            r.status      = 'error';
            r.session     = session;
            r.newMessages = new List<ChatMessage__c>{ userMsg, errMsg };
            return r;
        }

        // Success path — parse the server body and delegate to persistComplete,
        // then prepend userMsg so the LWC gets the whole turn's messages in one payload.
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        String status = (String) body.get('status');
        if (status == 'complete') {
            TurnResult r = persistComplete(session, body, nextSeq + 1);
            List<ChatMessage__c> combined = new List<ChatMessage__c>{ userMsg };
            combined.addAll(r.newMessages);
            r.newMessages = combined;
            // Post-callout DML: mark the resolved credential as recently used.
            if (resolvedConnectionId != null) AiEngineConnectionController.touchLastUsed(resolvedConnectionId);
            return r;
        }

        // Server returned 200 with an unexpected status shape — treat as error.
        ChatMessage__c badMsg = new ChatMessage__c(
            ChatSession__c    = sessionId,
            Role__c           = 'Assistant',
            Content__c        = '⚠ Unexpected server status: ' + String.valueOf(status),
            SequenceNumber__c = nextSeq + 1,
            ApprovalStatus__c = 'NotRequired'
        );
        insert badMsg;
        session.LastActivityAt__c = System.now();
        update session;

        TurnResult r = new TurnResult();
        r.status      = 'error';
        r.session     = session;
        r.newMessages = new List<ChatMessage__c>{ userMsg, badMsg };
        return r;
    }

    // approveToolCalls() was removed with the Managed MCP refactor.
    // Anthropic / OpenAI execute tools directly through the standalone MCP
    // server; there is no server-side pause to resume from.

    // ── INTERNALS ────────────────────────────────────────────────

    /**
     * Build the connectors[] payload from the agent's catalog nodes.
     * Each entry: provider, mcpServerUrl (from ConnectorCatalog__mdt),
     * allowedTools (admin's selection on the node), connectorId.
     * Nodes without a provider or URL are skipped — Node falls back to its
     * env-configured Salesforce MCP when the list is empty.
     */
    private static List<Map<String, Object>> buildConnectorsPayload(Id agentDefinitionId) {
        List<Map<String, Object>> out = new List<Map<String, Object>>();

        // Access mode travels with the salesforce_mcp connector so the
        // server refuses to fall back to the org token on PerUser agents.
        String accessMode = 'Org';
        List<AgentDefinition__c> agentRows = [
            SELECT AccessMode__c FROM AgentDefinition__c
            WHERE Id = :agentDefinitionId WITH USER_MODE LIMIT 1
        ];
        if (!agentRows.isEmpty() && String.isNotBlank(agentRows[0].AccessMode__c)) {
            accessMode = agentRows[0].AccessMode__c;
        }

        Map<String, String> urlByProvider = new Map<String, String>();
        for (ConnectorCatalog__mdt cat : [
            SELECT DeveloperName, McpServerUrl__c FROM ConnectorCatalog__mdt
        ]) {
            if (String.isNotBlank(cat.McpServerUrl__c)) {
                urlByProvider.put(cat.DeveloperName, cat.McpServerUrl__c.removeEnd('/'));
            }
        }

        for (AgentNode__c n : [
            SELECT ConfigJson__c, NodeSubType__c
            FROM AgentNode__c
            WHERE AgentDefinition__c = :agentDefinitionId
              AND NodeType__c = 'catalog'
              AND IsEnabled__c = true
            WITH USER_MODE
        ]) {
            if (String.isBlank(n.ConfigJson__c)) continue;
            Map<String, Object> cfg;
            try {
                cfg = (Map<String, Object>) JSON.deserializeUntyped(n.ConfigJson__c);
            } catch (Exception e) { continue; }

            String provider = (String) cfg.get('provider');
            if (String.isBlank(provider) || !urlByProvider.containsKey(provider)) continue;

            List<String> allowedTools = new List<String>();
            if (cfg.get('allowedTools') instanceof List<Object>) {
                for (Object t : (List<Object>) cfg.get('allowedTools')) {
                    if (t instanceof String) allowedTools.add((String) t);
                }
            }

            // Custom tools (org's own Apex actions / Flows) selected on the
            // node — sent as {type, name} pairs; server wires them into the
            // MCP session dynamically.
            List<Map<String, Object>> customTools = new List<Map<String, Object>>();
            if (cfg.get('customTools') instanceof List<Object>) {
                for (Object ctObj : (List<Object>) cfg.get('customTools')) {
                    if (!(ctObj instanceof Map<String, Object>)) continue;
                    Map<String, Object> ct = (Map<String, Object>) ctObj;
                    String ctType = (String) ct.get('type');
                    String ctName = (String) ct.get('name');
                    if (String.isBlank(ctType) || String.isBlank(ctName)) continue;
                    customTools.add(new Map<String, Object>{
                        'type' => ctType, 'name' => ctName, 'label' => (String) ct.get('label')
                    });
                }
            }

            out.add(new Map<String, Object>{
                'provider'     => provider,
                'mcpServerUrl' => urlByProvider.get(provider),
                'allowedTools' => allowedTools,
                'connectorId'  => (String) cfg.get('connectorId'),
                'accessMode'   => provider == 'salesforce_mcp' ? accessMode : null,
                'customTools'  => customTools
            });
        }
        return out;
    }

    /** Find the AI orchestrator node for an agent (there is exactly one per agent). */
    private static AgentNode__c findAiNode(Id agentDefinitionId) {
        List<AgentNode__c> rows = [
            SELECT Id, NodeType__c, NodeSubType__c, AiEngineConnection__c
            FROM AgentNode__c
            WHERE AgentDefinition__c = :agentDefinitionId AND NodeType__c = 'ai'
            WITH USER_MODE
            ORDER BY SortOrder__c ASC LIMIT 1
        ];
        return rows.isEmpty() ? null : rows[0];
    }

    private static AgentDefinition__c loadAgent(String apiName) {
        List<AgentDefinition__c> rows = [
            SELECT Id, ApiName__c, Name, Department__c, Status__c, ExecuteType__c
            FROM AgentDefinition__c WHERE ApiName__c = :apiName WITH USER_MODE LIMIT 1
        ];
        if (rows.isEmpty()) throw new AuraHandledException('Agent not found: ' + apiName);
        if (rows[0].Status__c != 'Active') throw new AuraHandledException('Agent not Active.');
        if (rows[0].ExecuteType__c != 'Chat' && rows[0].ExecuteType__c != 'Both') {
            throw new AuraHandledException('Agent is not chat-enabled.');
        }
        return rows[0];
    }

    private static ChatSession__c loadActiveSession(Id sessionId, Boolean throwIfExpired) {
        List<ChatSession__c> rows = [
            SELECT Id, Name, AgentDefinition__c, AgentDefinition__r.ApiName__c, AgentDefinition__r.Name,
                   User__c, RecordContextId__c, RecordContextType__c, Title__c, Status__c,
                   LastActivityAt__c, ExpiresAt__c, Department__c, TotalTurns__c,
                   TokensIn__c, TokensOut__c, PendingApprovalToken__c
            FROM ChatSession__c WHERE Id = :sessionId WITH USER_MODE LIMIT 1
        ];
        if (rows.isEmpty()) throw new AuraHandledException('Session not found.');
        ChatSession__c s = rows[0];
        if (s.Status__c == 'Ended')   throw new AuraHandledException('Session has been ended.');
        if (s.Status__c == 'Expired') throw new AuraHandledException('Session has expired. Start a new chat.');
        if (throwIfExpired && s.ExpiresAt__c != null && s.ExpiresAt__c < System.now()) {
            s.Status__c = 'Expired';
            update s;
            throw new AuraHandledException('Session expired due to inactivity. Start a new chat.');
        }
        return s;
    }

    private static List<ChatMessage__c> loadMessages(Id sessionId) {
        return [
            SELECT Id, Name, Role__c, Content__c, ToolCallsJson__c, ToolResultsJson__c,
                   ModelUsed__c, TokensIn__c, TokensOut__c, SequenceNumber__c,
                   Sensitive__c, RequiredApproval__c, ApprovedAt__c, ApprovalStatus__c,
                   AttachedContentDocumentIds__c, CreatedDate
            FROM ChatMessage__c
            WHERE ChatSession__c = :sessionId
            WITH USER_MODE
            ORDER BY SequenceNumber__c ASC
            LIMIT 1000
        ];
    }

    /**
     * Build the attachment metadata list for the Node payload.
     * LWC already captured versionId + name + mime during upload, so we don't
     * need any Salesforce query here — this runs BEFORE the HTTP callout,
     * so avoiding DML/SOQL keeps the callout-first ordering clean and fast.
     */
    private static List<Map<String, Object>> buildAttachmentsPayload(List<AttachmentInput> attachments) {
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (AttachmentInput a : attachments) {
            if (String.isBlank(a.contentDocumentId) || String.isBlank(a.contentVersionId)) continue;
            out.add(new Map<String, Object>{
                'contentDocumentId' => a.contentDocumentId,
                'contentVersionId'  => a.contentVersionId,
                'fileName'          => a.fileName,
                'mimeType'          => a.mimeType,
                'fileExtension'     => a.fileExtension
            });
        }
        return out;
    }

    private static String joinDocIds(List<AttachmentInput> attachments) {
        List<String> ids = new List<String>();
        for (AttachmentInput a : attachments) {
            if (String.isNotBlank(a.contentDocumentId)) ids.add(a.contentDocumentId);
        }
        return String.join(ids, ',');
    }

    private static Integer nextSequenceNumber(Id sessionId) {
        List<AggregateResult> ar = [
            SELECT MAX(SequenceNumber__c) maxSeq
            FROM ChatMessage__c WHERE ChatSession__c = :sessionId
        ];
        Decimal d = (Decimal) ar[0].get('maxSeq');
        return (d == null ? 1 : Integer.valueOf(d) + 1);
    }

    private static Map<String, Object> buildTurnPayload(String agentApiName, ChatSession__c session, List<ChatMessage__c> history, String newUserText) {
        List<Map<String, Object>> histPayload = new List<Map<String, Object>>();
        // History is the conversation BEFORE this turn — the new user message is sent separately.
        // We refactored sendTurn to run the callout BEFORE inserting the user message, so history
        // here is already correct without any filtering.
        for (ChatMessage__c m : history) {
            histPayload.add(new Map<String, Object>{
                'role'            => m.Role__c.toLowerCase(),
                'content'         => m.Content__c == null ? '' : m.Content__c,
                'toolCallsJson'   => m.ToolCallsJson__c,
                'toolResultsJson' => m.ToolResultsJson__c,
                'toolCallId'      => extractToolCallIdForTool(m)
            });
        }
        return new Map<String, Object>{
            'agentApiName'   => agentApiName,
            'sessionId'      => session.Id,
            'history'        => histPayload,
            'newUserMessage' => newUserText,
            'context'        => new Map<String, Object>{
                'userId'            => UserInfo.getUserId(),
                'recordContextId'   => session.RecordContextId__c,
                'recordContextType' => session.RecordContextType__c
            }
        };
    }

    private static String extractToolCallIdForTool(ChatMessage__c m) {
        if (m.Role__c != 'Tool' || String.isBlank(m.ToolCallsJson__c)) return null;
        try {
            Map<String, Object> j = (Map<String, Object>) JSON.deserializeUntyped(m.ToolCallsJson__c);
            return (String) j.get('id');
        } catch (Exception e) { return null; }
    }

    private static TurnResult persistComplete(ChatSession__c session, Map<String, Object> body, Integer baseSeq) {
        String assistantText = (String) body.get('assistantText');
        List<Object> toolCalls = (List<Object>) body.get('toolCalls');
        String modelUsed = (String) body.get('modelUsed');
        Integer tokensIn  = body.get('tokensIn')  == null ? 0 : Integer.valueOf(body.get('tokensIn'));
        Integer tokensOut = body.get('tokensOut') == null ? 0 : Integer.valueOf(body.get('tokensOut'));

        List<ChatMessage__c> inserts = new List<ChatMessage__c>();
        Integer seq = baseSeq;

        // Tool messages first (the reads + approved writes that ran)
        if (toolCalls != null) {
            for (Object t : toolCalls) {
                Map<String, Object> tc = (Map<String, Object>) t;
                inserts.add(new ChatMessage__c(
                    ChatSession__c    = session.Id,
                    Role__c           = 'Tool',
                    Content__c        = JSON.serialize(tc.get('output')).left(131072),
                    ToolCallsJson__c  = JSON.serialize(new Map<String, Object>{ 'id' => null, 'name' => tc.get('name'), 'args' => tc.get('input') }),
                    ToolResultsJson__c = JSON.serialize(tc).left(32768),
                    SequenceNumber__c = seq++,
                    ApprovalStatus__c = 'NotRequired'
                ));
            }
        }
        // Final assistant message
        inserts.add(new ChatMessage__c(
            ChatSession__c    = session.Id,
            Role__c           = 'Assistant',
            Content__c        = assistantText == null ? '' : assistantText,
            ModelUsed__c      = modelUsed,
            TokensIn__c       = tokensIn,
            TokensOut__c      = tokensOut,
            SequenceNumber__c = seq++,
            ApprovalStatus__c = 'NotRequired'
        ));
        insert inserts;

        // Update session totals + reset expiry
        session.TotalTurns__c    = (session.TotalTurns__c == null ? 0 : session.TotalTurns__c) + 1;
        session.LastActivityAt__c = System.now();
        session.ExpiresAt__c      = System.now().addHours(EXPIRY_HOURS);
        session.TokensIn__c       = (session.TokensIn__c  == null ? 0 : session.TokensIn__c)  + tokensIn;
        session.TokensOut__c      = (session.TokensOut__c == null ? 0 : session.TokensOut__c) + tokensOut;
        session.PendingApprovalToken__c = null;
        if (String.isBlank(session.Title__c)) {
            // Auto-title from the first user message
            List<ChatMessage__c> first = [SELECT Content__c FROM ChatMessage__c WHERE ChatSession__c = :session.Id AND Role__c = 'User' ORDER BY SequenceNumber__c ASC LIMIT 1];
            if (!first.isEmpty()) {
                String t = first[0].Content__c == null ? '' : first[0].Content__c;
                session.Title__c = t.length() > 117 ? t.left(117) + '...' : t;
            }
        }
        update session;

        TurnResult r = new TurnResult();
        r.status = 'complete';
        r.session = session;
        r.newMessages = inserts;
        return r;
    }

    // persistNeedsApproval() + markPendingMessages() removed with the
    // Managed MCP refactor — no more approval flow in chat mode.

    private static HttpResponse callout(String method, String path, String body) {
        SynapseInstall__c install = SynapseInstall__c.getOrgDefaults();
        if (install == null || String.isBlank(install.SessionKey__c)) {
            throw new AuraHandledException('Synapse is not set up yet. Open Synapse Setup and click Authorize first.');
        }
        String base = getServerUrl();
        if (String.isBlank(base)) {
            throw new AuraHandledException('SynapseConfig.Default.ServerUrl__c is not set.');
        }
        HttpRequest req = new HttpRequest();
        req.setEndpoint(base.removeEnd('/') + path);
        req.setMethod(method);
        req.setHeader('Authorization', 'Bearer ' + install.SessionKey__c);
        req.setHeader('Content-Type', 'application/json');
        if (String.isNotBlank(body)) req.setBody(body);
        req.setTimeout(CALLOUT_TIMEOUT_MS);
        return new Http().send(req);
    }

    /** Unwrap the server's JSON `{message}` field for the toast; fall back to raw body. */
    private static String extractServerError(HttpResponse res) {
        String raw = res.getBody();
        if (String.isBlank(raw)) return 'Server error ' + res.getStatusCode();
        try {
            Map<String, Object> j = (Map<String, Object>) JSON.deserializeUntyped(raw);
            if (j.containsKey('message') && j.get('message') != null) {
                return (String) j.get('message');
            }
        } catch (Exception e) { /* not JSON */ }
        return raw.length() > 400 ? raw.left(400) + '…' : raw;
    }

    private static String getServerUrl() {
        List<SynapseConfig__mdt> rows = [
            SELECT ServerUrl__c FROM SynapseConfig__mdt WHERE DeveloperName = 'Default' LIMIT 1
        ];
        return rows.isEmpty() ? null : rows[0].ServerUrl__c;
    }

    // ── WRAPPERS ─────────────────────────────────────────────────

    public class AgentSummary {
        @AuraEnabled public String apiName;
        @AuraEnabled public String name;
        @AuraEnabled public String department;
        @AuraEnabled public String description;
    }

    public class SessionSummary {
        @AuraEnabled public Id       id;
        @AuraEnabled public String   name;
        @AuraEnabled public String   agentName;
        @AuraEnabled public String   agentApiName;
        @AuraEnabled public String   title;
        @AuraEnabled public String   status;
        @AuraEnabled public DateTime lastActivityAt;
        @AuraEnabled public DateTime expiresAt;
        @AuraEnabled public Integer  totalTurns;
        @AuraEnabled public String   recordContextId;
    }

    public class SessionWithMessages {
        @AuraEnabled public ChatSession__c       session;
        @AuraEnabled public List<ChatMessage__c> messages;
    }

    public class TurnResult {
        @AuraEnabled public String                status;         // 'complete' or 'error'
        @AuraEnabled public ChatSession__c        session;
        @AuraEnabled public List<ChatMessage__c>  newMessages;    // messages inserted during this turn
    }

    /** Sent by LWC per attached file. LWC captures both IDs at upload time so
     *  the Node server can hit Shepherd directly without a SOQL round-trip. */
    public class AttachmentInput {
        @AuraEnabled public String contentDocumentId;
        @AuraEnabled public String contentVersionId;
        @AuraEnabled public String fileName;
        @AuraEnabled public String mimeType;
        @AuraEnabled public String fileExtension;
    }
}
