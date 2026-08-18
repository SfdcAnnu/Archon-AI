/**
 * Apex REST wrapper that mints a WebSocket ticket for the React UI Bundle
 * (force-app/main/default/uiBundles/AgentBuilderApp).
 *
 * Ephemeral-ticket pattern: this class does a SERVER-TO-SERVER callout to
 * Archon-Server's POST /api/ws/ticket (SessionKey__c never leaves Apex —
 * see the callout() helper below), gets back a short-lived, single-use
 * ticket id, and hands ONLY that opaque ticket to the browser. The
 * BROWSER then opens the actual WebSocket directly to Node using the
 * ticket — Apex cannot hold a live socket connection itself, so it isn't
 * in the path once the connection exists.
 *
 * userId is resolved from the running user's own session (UserInfo),
 * never accepted from the request body — the browser can't spoof who it
 * says it is.
 *
 * @RestResource classes must be declared `global` — a Salesforce platform
 * requirement for this annotation, not a deliberate widening of this
 * codebase's usual `public with sharing` convention (same note as
 * AgentBuilderRestService.cls, which this mirrors).
 */
@RestResource(urlMapping='/agent-builder/ws-ticket')
global with sharing class AgentWebSocketController {

    private static final Integer CALLOUT_TIMEOUT_MS = 15000;

    @HttpPost
    global static void mintTicket() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');

        try {
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(req.requestBody.toString());
            String agentApiName = (String) body.get('agentApiName');
            String sessionId    = (String) body.get('sessionId');
            if (String.isBlank(agentApiName) || String.isBlank(sessionId)) {
                writeError(res, 400, 'Body must include agentApiName and sessionId.');
                return;
            }

            Map<String, Object> payload = new Map<String, Object>{
                'agentApiName' => agentApiName,
                'sessionId'    => sessionId,
                'userId'       => UserInfo.getUserId()
            };

            // Resolve the running user's AI Engine Connection the SAME way
            // every other execution path does (AgentChatController.sendTurn,
            // AgentBuilderController's Test Runner, AgentRunner's automation)
            // and bind it into the ticket server-side — the WS gateway reads
            // it back from the redeemed ticket, never from a client message,
            // consistent with every other piece of connection identity here.
            // Before this, the live chat panel never sent ANY engineOverride
            // at all, so every WS turn failed with "no connection configured"
            // regardless of what was actually set up.
            Map<String, Object> engineOverride = resolveEngineOverride(agentApiName);
            if (engineOverride != null) {
                payload.put('engineOverride', engineOverride);
            }

            HttpResponse calloutRes = callout('POST', '/api/ws/ticket', JSON.serialize(payload));
            if (calloutRes.getStatusCode() != 200) {
                writeError(res, calloutRes.getStatusCode(), extractServerError(calloutRes));
                return;
            }

            res.statusCode = 200;
            res.responseBody = Blob.valueOf(calloutRes.getBody());
        } catch (Exception e) {
            writeError(res, 400, e.getMessage());
        }
    }

    // Mirrors AgentChatController.findAiNode()'s query shape — a small local
    // copy for the same reason as the callout() helpers below.
    private static Map<String, Object> resolveEngineOverride(String agentApiName) {
        List<AgentDefinition__c> agents = [
            SELECT Id FROM AgentDefinition__c WHERE ApiName__c = :agentApiName WITH USER_MODE LIMIT 1
        ];
        if (agents.isEmpty()) return null;

        List<AgentNode__c> aiNodes = [
            SELECT Id, NodeSubType__c, AiEngineConnection__c
            FROM AgentNode__c
            WHERE AgentDefinition__c = :agents[0].Id AND NodeType__c = 'ai'
            WITH USER_MODE
            ORDER BY SortOrder__c ASC LIMIT 1
        ];
        if (aiNodes.isEmpty() || String.isBlank(aiNodes[0].NodeSubType__c)) return null;

        AiEngineConnection__c cred = AiEngineConnectionController.resolveForRuntime(
            aiNodes[0].NodeSubType__c, aiNodes[0].AiEngineConnection__c
        );
        if (cred == null) return null;

        return new Map<String, Object>{
            'engineType'   => cred.EngineType__c,
            'apiKey'       => cred.ApiKey__c,
            'endpoint'     => cred.Endpoint__c,
            'defaultModel' => cred.DefaultModel__c,
            'connectionId' => cred.Id
        };
    }

    // Mirrors AgentChatController.cls's own callout()/getServerUrl()/
    // extractServerError() helpers exactly — kept as a small local copy
    // rather than exposing those as shared utilities, since this is the
    // only other caller today and the helper is ~15 lines.
    private static HttpResponse callout(String method, String path, String body) {
        SynapseInstall__c install = SynapseInstall__c.getOrgDefaults();
        if (install == null || String.isBlank(install.SessionKey__c)) {
            throw new AuraHandledException('Synapse is not set up yet. Open Synapse Setup and click Authorize first.');
        }
        String base = getServerUrl();
        if (String.isBlank(base)) {
            throw new AuraHandledException('SynapseConfig.Default.ServerUrl__c is not set.');
        }
        HttpRequest httpReq = new HttpRequest();
        httpReq.setEndpoint(base.removeEnd('/') + path);
        httpReq.setMethod(method);
        httpReq.setHeader('Authorization', 'Bearer ' + install.SessionKey__c);
        httpReq.setHeader('Content-Type', 'application/json');
        if (String.isNotBlank(body)) httpReq.setBody(body);
        httpReq.setTimeout(CALLOUT_TIMEOUT_MS);
        return new Http().send(httpReq);
    }

    private static String getServerUrl() {
        List<SynapseConfig__mdt> rows = [
            SELECT ServerUrl__c FROM SynapseConfig__mdt WHERE DeveloperName = 'Default' LIMIT 1
        ];
        return rows.isEmpty() ? null : rows[0].ServerUrl__c;
    }

    private static String extractServerError(HttpResponse res) {
        String raw = res.getBody();
        if (String.isBlank(raw)) return 'Server error ' + res.getStatusCode();
        try {
            Map<String, Object> j = (Map<String, Object>) JSON.deserializeUntyped(raw);
            if (j.containsKey('message') && j.get('message') != null) {
                return (String) j.get('message');
            }
            if (j.containsKey('error') && j.get('error') != null) {
                return String.valueOf(j.get('error'));
            }
        } catch (Exception e) { /* not JSON */ }
        return raw.length() > 400 ? raw.left(400) + '…' : raw;
    }

    private static void writeError(RestResponse res, Integer statusCode, String message) {
        res.statusCode = statusCode;
        res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => message }));
    }
}
