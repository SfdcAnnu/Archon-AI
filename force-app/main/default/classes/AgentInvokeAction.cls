/**
 * AgentInvokeAction — ONE generic "Call AI Agent" invocable usable from any
 * Flow anywhere in the org (record-triggered, screen, scheduled, platform
 * event…). Takes a user query, free-form reference data, the agent (Id or
 * API name), an optional type override, an output-format instruction, and
 * optional files — returns the agent's reply to the Flow.
 *
 * Routing: Chat agents run a real stateful chat turn (same engine as the
 * chat widget / WhatsApp bridge, session reused per agent+record so
 * repeated calls about the same record continue one conversation).
 * Trigger/Automation agents run through the orchestrator (same path as
 * AgentRunner) with the query/reference data folded into the run's input
 * payload. Blank Agent Type = whatever the agent's own Execute Type says.
 *
 * Callout rules: this action makes a callout, so from a record-triggered
 * Flow it must be called on the "Run Asynchronously" path (Salesforce
 * forbids callouts in the trigger's own transaction). Screen flows and
 * autolaunched flows can call it directly.
 *
 * Known throw-paths in the shared controllers (agent missing / inactive)
 * are pre-checked here BEFORE delegating, because those methods raise
 * AuraHandledException — which detonates as an uncatchable LimitException
 * outside Aura context (same landmine AgentMcpToolsRestService documents).
 */
public with sharing class AgentInvokeAction {

    public class Request {
        @InvocableVariable(
            label='Agent (Id or API Name)'
            description='AgentDefinition__c record Id, or its ApiName__c (e.g. viva_money_ai_agent_msri5f65).'
            required=true
        )
        public String agent;

        @InvocableVariable(
            label='User Query'
            description='The question or instruction for the agent.'
        )
        public String userQuery;

        @InvocableVariable(
            label='Reference Data'
            description='Extra context the agent should consider — plain text or JSON (e.g. fields from the triggering record).'
        )
        public String referenceData;

        @InvocableVariable(
            label='Agent Type (Chat or Trigger)'
            description='Optional override. Leave blank to use the Execute Type saved on the agent.'
        )
        public String agentType;

        @InvocableVariable(
            label='Output Format'
            description='How the reply should be structured, e.g. "JSON with fields decision, reason" or "One short sentence".'
        )
        public String outputFormat;

        @InvocableVariable(
            label='Record ID'
            description='Record this call is about. Chat: anchors the conversation (same record = same ongoing session). Trigger: the record the automation runs on (required).'
        )
        public String recordId;

        @InvocableVariable(
            label='Files (Ids or URLs, comma-separated)'
            description='ContentDocument (069…) or ContentVersion (068…) Ids are attached to the chat turn; http(s) URLs are passed to the agent as reference links.'
        )
        public String files;
    }

    public class Result {
        @InvocableVariable(label='Success')          public Boolean success;
        @InvocableVariable(label='Response Text')    public String  responseText;
        @InvocableVariable(label='Status')           public String  status;
        @InvocableVariable(label='Chat Session ID')  public String  sessionId;
        @InvocableVariable(label='Output JSON')      public String  outputPayload;
        @InvocableVariable(label='Error Message')    public String  errorMessage;
    }

    @InvocableMethod(
        label='Call AI Agent'
        description='Runs any Archon agent (Chat or Automation) with a query, reference data, output-format instructions and optional files, and returns the reply. Makes a callout — from record-triggered Flows, use the Run Asynchronously path.'
        category='Agent Builder'
    )
    public static List<Result> run(List<Request> requests) {
        List<Result> results = new List<Result>();
        if (requests == null) return results;
        for (Request req : requests) {
            results.add(runOne(req));
        }
        return results;
    }

    private static Result runOne(Request req) {
        Result r = new Result();
        r.success = false;
        try {
            if (req == null || String.isBlank(req.agent)) {
                r.errorMessage = 'Pass an Agent (record Id or API name).';
                return r;
            }
            AgentDefinition__c agent = resolveAgent(req.agent.trim());
            if (agent == null) {
                r.errorMessage = 'No agent found for "' + req.agent + '".';
                return r;
            }
            if (agent.Status__c == 'Inactive') {
                r.errorMessage = 'Agent "' + agent.ApiName__c + '" is Inactive and cannot be run.';
                return r;
            }

            String effectiveType = String.isNotBlank(req.agentType)
                ? normalizeType(req.agentType)
                : (String.isNotBlank(agent.ExecuteType__c) ? agent.ExecuteType__c : 'Trigger');

            if (effectiveType == 'Chat') {
                return runChatTurn(agent, req, r);
            }
            return runAutomation(agent, req, r);
        } catch (Exception e) {
            r.errorMessage = e.getMessage();
            return r;
        }
    }

    // ── CHAT PATH ─────────────────────────────────────────────────────

    private static Result runChatTurn(AgentDefinition__c agent, Request req, Result r) {
        List<String> urls = new List<String>();
        List<AgentChatController.AttachmentInput> attachments = parseFiles(req.files, urls);

        String text = composeMessage(req, urls);
        if (String.isBlank(text) && attachments.isEmpty()) {
            r.errorMessage = 'Pass a User Query (or at least Reference Data / files).';
            return r;
        }
        if (text != null && text.length() > 10000) {
            r.errorMessage = 'Combined query + reference data is over the 10,000 character chat limit — shorten it.';
            return r;
        }

        ChatSession__c session = AgentChatController.findOrCreateAutomatedSession(
            agent.ApiName__c,
            String.isNotBlank(req.recordId) ? req.recordId : null,
            null,
            null
        );
        r.sessionId = session.Id;

        AgentChatController.TurnResult tr = AgentChatController.sendTurn(
            session.Id, text, attachments.isEmpty() ? null : attachments
        );
        r.status = tr.status;
        if (tr.status == 'complete' && tr.newMessages != null && !tr.newMessages.isEmpty()) {
            r.responseText = tr.newMessages[tr.newMessages.size() - 1].Content__c;
            r.success = true;
        } else if (String.isBlank(r.errorMessage)) {
            r.errorMessage = 'The chat turn did not complete (status: ' + tr.status + ').';
        }
        return r;
    }

    private static String composeMessage(Request req, List<String> urls) {
        List<String> parts = new List<String>();
        if (String.isNotBlank(req.userQuery)) parts.add(req.userQuery.trim());
        if (String.isNotBlank(req.referenceData)) parts.add('REFERENCE DATA:\n' + req.referenceData.trim());
        if (!urls.isEmpty()) parts.add('REFERENCE FILES (URLs):\n' + String.join(urls, '\n'));
        if (String.isNotBlank(req.outputFormat)) parts.add('RESPOND IN THIS FORMAT:\n' + req.outputFormat.trim());
        return String.join(parts, '\n\n');
    }

    // ── AUTOMATION (TRIGGER) PATH ─────────────────────────────────────

    private static Result runAutomation(AgentDefinition__c agent, Request req, Result r) {
        if (String.isBlank(req.recordId)) {
            r.errorMessage = 'Record ID is required to run an Automation (Trigger) agent.';
            return r;
        }
        List<String> urls = new List<String>();
        parseFiles(req.files, urls); // automation runs don't take chat attachments — URLs still pass through

        Map<String, Object> payload = new Map<String, Object>();
        if (String.isNotBlank(req.userQuery))     payload.put('userQuery', req.userQuery.trim());
        if (String.isNotBlank(req.referenceData)) payload.put('referenceData', req.referenceData.trim());
        if (String.isNotBlank(req.outputFormat))  payload.put('outputFormat', req.outputFormat.trim());
        if (!urls.isEmpty())                      payload.put('referenceFileUrls', urls);

        AgentBuilderController.ExecutionResult er = AgentBuilderController.executeAgent(
            agent.ApiName__c, req.recordId, 'sync',
            payload.isEmpty() ? null : JSON.serialize(payload)
        );
        r.success       = er.success == true;
        r.status        = er.agentStatus;
        r.responseText  = er.agentReason;
        r.outputPayload = er.agentOutputPayload;
        r.errorMessage  = er.errorMessage;
        return r;
    }

    // ── HELPERS ───────────────────────────────────────────────────────

    private static AgentDefinition__c resolveAgent(String idOrApiName) {
        Id maybeId = null;
        try {
            Id parsed = Id.valueOf(idOrApiName);
            if (parsed.getSobjectType() == AgentDefinition__c.SObjectType) maybeId = parsed;
        } catch (Exception e) {
            // not an Id — fall through to ApiName__c lookup
        }
        List<AgentDefinition__c> rows = maybeId != null
            ? [SELECT Id, ApiName__c, ExecuteType__c, Status__c FROM AgentDefinition__c WHERE Id = :maybeId WITH USER_MODE LIMIT 1]
            : [SELECT Id, ApiName__c, ExecuteType__c, Status__c FROM AgentDefinition__c WHERE ApiName__c = :idOrApiName WITH USER_MODE LIMIT 1];
        return rows.isEmpty() ? null : rows[0];
    }

    private static String normalizeType(String raw) {
        String t = raw.trim().toLowerCase();
        if (t == 'chat') return 'Chat';
        // 'trigger', 'automation', anything else automation-flavored
        return 'Trigger';
    }

    /** Splits the files input into Salesforce content attachments (returned)
     *  and plain URLs (appended to the urls list). Unresolvable Ids are
     *  skipped rather than failing the whole call. */
    private static List<AgentChatController.AttachmentInput> parseFiles(String files, List<String> urls) {
        List<AgentChatController.AttachmentInput> out = new List<AgentChatController.AttachmentInput>();
        if (String.isBlank(files)) return out;

        Set<Id> contentDocIds = new Set<Id>();
        Set<Id> contentVersionIds = new Set<Id>();
        for (String rawToken : files.split('[,\n]')) {
            String token = rawToken.trim();
            if (String.isBlank(token)) continue;
            if (token.startsWith('http://') || token.startsWith('https://')) {
                urls.add(token);
                continue;
            }
            try {
                Id tokenId = Id.valueOf(token);
                if (tokenId.getSobjectType() == ContentDocument.SObjectType) contentDocIds.add(tokenId);
                else if (tokenId.getSobjectType() == ContentVersion.SObjectType) contentVersionIds.add(tokenId);
            } catch (Exception e) {
                // neither URL nor Id — ignore
            }
        }
        if (contentDocIds.isEmpty() && contentVersionIds.isEmpty()) return out;

        for (ContentVersion cv : [
            SELECT Id, ContentDocumentId, Title, FileExtension
            FROM ContentVersion
            WHERE (ContentDocumentId IN :contentDocIds AND IsLatest = true) OR Id IN :contentVersionIds
            WITH USER_MODE
        ]) {
            AgentChatController.AttachmentInput att = new AgentChatController.AttachmentInput();
            att.contentDocumentId = cv.ContentDocumentId;
            att.contentVersionId  = cv.Id;
            att.fileName          = cv.Title + (String.isNotBlank(cv.FileExtension) ? '.' + cv.FileExtension : '');
            att.fileExtension     = cv.FileExtension;
            att.mimeType          = mimeTypeFor(cv.FileExtension);
            out.add(att);
        }
        return out;
    }

    private static String mimeTypeFor(String ext) {
        String e = ext == null ? '' : ext.toLowerCase();
        if (e == 'pdf')  return 'application/pdf';
        if (e == 'png')  return 'image/png';
        if (e == 'jpg' || e == 'jpeg') return 'image/jpeg';
        if (e == 'gif')  return 'image/gif';
        if (e == 'txt')  return 'text/plain';
        if (e == 'csv')  return 'text/csv';
        if (e == 'md')   return 'text/markdown';
        if (e == 'json') return 'application/json';
        return 'application/octet-stream';
    }
}
