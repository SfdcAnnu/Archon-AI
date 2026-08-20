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

    /** One endpoint, three ops (body.op): 'analyze' (v2 capability plan),
     *  'verify' (v2 free-text answer verification), default 'generate'.
     *  Analyze additionally gathers the org grounding pack server-side, so
     *  it gets the full 120s callout ceiling. */
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
            String op = (String) body.get('op');
            // Generation must know which providers this org can actually
            // RUN, or it emits ai/subagent nodes (spec default: claude)
            // whose every chat turn dies with "no connection configured".
            if (op != 'analyze' && op != 'verify') {
                body.put('availableEngines', listAvailableEngines());
            }
            String path = op == 'analyze' ? '/api/agent/analyze'
                        : op == 'verify'  ? '/api/agent/verify-answer'
                        : '/api/agent/generate';
            Integer timeoutMs = op == 'analyze' ? 120000 : GENERATE_TIMEOUT_MS;
            HttpResponse serverRes = ArchonServerClient.callout('POST', path, JSON.serialize(body), timeoutMs);
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

    /** Distinct engine types with at least one ACTIVE connection visible to
     *  the running user, translated to AgentNode__c.NodeSubType__c vocabulary
     *  ('openai' is stored on connections, 'gpt4' on nodes — same mapping
     *  AiEngineConnectionController.normalizeEngineType() applies in
     *  reverse). Order matters: the server uses the FIRST entry as the
     *  fallback engine, so put the user's preferred provider first. */
    private static List<String> listAvailableEngines() {
        List<AiEngineConnection__c> rows = [
            SELECT EngineType__c, IsPreferred__c
            FROM AiEngineConnection__c
            WHERE IsActive__c = true
            WITH USER_MODE
            ORDER BY IsPreferred__c DESC, LastUsedAt__c DESC NULLS LAST
        ];
        List<String> engines = new List<String>();
        for (AiEngineConnection__c c : rows) {
            String subType = c.EngineType__c == 'openai' ? 'gpt4' : c.EngineType__c;
            if (!engines.contains(subType)) engines.add(subType);
        }
        return engines;
    }

    private static void writeError(RestResponse res, Integer statusCode, String message) {
        res.statusCode = statusCode;
        res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => message }));
    }
}
