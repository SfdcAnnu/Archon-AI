/**
 * Apex REST endpoint for design-time discovery of the org's OWN automation
 * — invocable Apex actions and autolaunched Flows — for the React Tool
 * panel's Apex/Flow pickers. Proxies the Node server's
 * POST /api/sf/custom-actions (server/src/routes/connectors.routes.ts):
 *   ?mode=list                      → { "actions": [{type,name,label}] }
 *   ?mode=describe&type=apex&name=X → { type,name,label,description,inputs,outputs }
 *
 * Self-contained callout (ArchonServerClient) rather than delegating to
 * AgentConnectorController.getCustomActionCatalog — that method's error
 * paths throw AuraHandledException, which detonates as an uncatchable
 * LimitException outside Aura context (same landmine AgentMcpToolsRestService
 * already documents).
 */
@RestResource(urlMapping='/agent-builder/custom-actions/*')
global with sharing class AgentCustomActionsRestService {

    @HttpGet
    global static void getActions() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');

        String mode = req.params.get('mode');
        if (String.isBlank(mode)) mode = 'list';
        try {
            Map<String, Object> reqBody = new Map<String, Object>{ 'mode' => mode };
            if (mode == 'describe') {
                reqBody.put('type', req.params.get('type'));
                reqBody.put('name', req.params.get('name'));
            }

            HttpResponse serverRes = ArchonServerClient.callout('POST', '/api/sf/custom-actions', JSON.serialize(reqBody));

            String rawBody = serverRes.getBody();
            Boolean htmlBody = rawBody != null && rawBody.trim().startsWith('<');
            if (htmlBody || serverRes.getStatusCode() == 502 || serverRes.getStatusCode() == 503) {
                writeError(res, 503, 'SERVER_WAKING: The Archon server is waking up from idle — this usually takes under a minute. Try again shortly.');
                return;
            }
            if (serverRes.getStatusCode() >= 400) {
                writeError(res, serverRes.getStatusCode(), ArchonServerClient.extractServerError(serverRes));
                return;
            }
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(rawBody);
        } catch (ArchonServerClient.NotConfiguredException nce) {
            writeError(res, 400, nce.getMessage());
        } catch (Exception e) {
            writeError(res, 400, e.getMessage());
        }
    }

    private static void writeError(RestResponse res, Integer statusCode, String message) {
        res.statusCode = statusCode;
        res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => message }));
    }
}
