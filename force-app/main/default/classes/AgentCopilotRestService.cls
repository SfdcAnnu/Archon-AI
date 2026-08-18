/**
 * Apex REST wrapper around the Archon Node server's /api/agent/copilot
 * route (server/src/routes/copilot.routes.ts) for the React UI Bundle —
 * same pattern as AgentGeneratorRestService.cls, including resolving and
 * attaching the org's own OpenAI AiEngineConnection__c server-side (see
 * that class's header for why — copilot.ts's resolveEngine call has no
 * server-side .env fallback either). Bound to the graph's own top-level
 * 'ai' node when present, so a node-bound personal/shared override (not
 * just the running user's own) is honored exactly like a real chat turn
 * would resolve it.
 */
@RestResource(urlMapping='/agent-builder/copilot/*')
global with sharing class AgentCopilotRestService {

    // A copilot turn is one LLM call (no repair retry, unlike generation) —
    // the default ArchonServerClient timeout is enough headroom.

    @HttpPost
    global static void copilot() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(req.requestBody.toString());
            if (body.get('engineOverride') == null) {
                Map<String, Object> engineOverride = buildOpenAiEngineOverride(findTopLevelAiNodeId(body));
                if (engineOverride != null) body.put('engineOverride', engineOverride);
            }
            HttpResponse serverRes = ArchonServerClient.callout('POST', '/api/agent/copilot', JSON.serialize(body));
            if (serverRes.getStatusCode() >= 400) {
                writeError(res, serverRes.getStatusCode(), ArchonServerClient.extractServerError(serverRes));
                return;
            }
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(serverRes.getBody());
        } catch (ArchonServerClient.NotConfiguredException nce) {
            writeError(res, 400, nce.getMessage());
        } catch (Exception e) {
            writeError(res, 400, e.getMessage());
        }
    }

    private static Id findTopLevelAiNodeId(Map<String, Object> body) {
        List<Object> nodes = (List<Object>) body.get('nodes');
        if (nodes == null) return null;
        for (Object n : nodes) {
            Map<String, Object> node = (Map<String, Object>) n;
            if ('ai' == (String) node.get('nodeType')) {
                try {
                    return Id.valueOf((String) node.get('id'));
                } catch (Exception e) {
                    return null; // not-yet-saved local id — nothing to bind to
                }
            }
        }
        return null;
    }

    private static Map<String, Object> buildOpenAiEngineOverride(Id nodeBoundId) {
        AiEngineConnection__c cred = AiEngineConnectionController.resolveForRuntime('openai', nodeBoundId);
        if (cred == null) return null;
        return new Map<String, Object>{
            'engineType'   => cred.EngineType__c,
            'apiKey'       => cred.ApiKey__c,
            'endpoint'     => cred.Endpoint__c,
            'defaultModel' => cred.DefaultModel__c,
            'connectionId' => cred.Id
        };
    }

    private static void writeError(RestResponse res, Integer statusCode, String message) {
        res.statusCode = statusCode;
        res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => message }));
    }
}
