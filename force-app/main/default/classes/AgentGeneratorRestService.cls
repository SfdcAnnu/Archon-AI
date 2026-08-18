/**
 * Apex REST wrapper around the Archon Node server's /api/agent/generate
 * route (server/src/routes/agent-generator.routes.ts) for the React UI
 * Bundle — see AgentBuilderRestService.cls's header for why REST (not
 * @AuraEnabled) is the right shape for a UI Bundle caller.
 *
 * Mostly a passthrough — the Node server already validates the request
 * (zod) and returns exactly the shape the client needs — but ONE thing
 * can't be left to the client: generate.ts's resolveEngine('openai', ...)
 * has deliberately no server-side .env fallback, so a request with no
 * engineOverride 502s with "No AI Engine Connection configured". The
 * client never has (and shouldn't need) direct access to the org's stored
 * AiEngineConnection__c credentials, so this class resolves one here —
 * same pattern AgentKbController.buildEmbeddingEngineOverride() already
 * uses for KB uploads — before forwarding. OpenAI specifically, matching
 * generate.ts's own hardcoded provider (this org's only active AI Engine
 * Connection is OpenAI).
 */
@RestResource(urlMapping='/agent-builder/generate/*')
global with sharing class AgentGeneratorRestService {

    // Generation is a real LLM call (plus an optional repair retry) — give
    // it more headroom than the default callout timeout, same reasoning
    // AgentKbController's document upload/reindex callouts already use.
    private static final Integer GENERATE_TIMEOUT_MS = 60000;

    @HttpPost
    global static void generate() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(req.requestBody.toString());
            if (body.get('engineOverride') == null) {
                Map<String, Object> engineOverride = buildOpenAiEngineOverride();
                if (engineOverride != null) body.put('engineOverride', engineOverride);
            }
            HttpResponse serverRes = ArchonServerClient.callout('POST', '/api/agent/generate', JSON.serialize(body), GENERATE_TIMEOUT_MS);
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

    /** Same resolution AgentKbController uses for embeddings: the running
     *  user's own personal connection first, falling back through
     *  AiEngineConnectionController.resolveForRuntime's shared/org chain —
     *  no node to bind to yet since this is generating a NEW agent. */
    private static Map<String, Object> buildOpenAiEngineOverride() {
        AiEngineConnection__c cred = AiEngineConnectionController.resolveForRuntime('openai', null);
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
