/**
 * Apex REST endpoint for the live, authenticated tools/list of ANY MCP
 * provider (standard connectors and custom MCP servers alike) — powers the
 * Tool properties panel's live tool picker and the Quick Add palette's
 * per-server tool lists in the React UI Bundle.
 *
 * Deliberately does NOT delegate to AgentConnectorController.
 * getMcpToolSchemas: that method throws AuraHandledException on its error
 * and server-waking paths, which is only legal from Aura/VF context — from
 * Apex REST the throw itself detonates as an uncatchable LimitException
 * (found the hard way in live testing, not hypothetically). Same Node
 * route, same payload, REST-appropriate error handling.
 */
@RestResource(urlMapping='/agent-builder/mcp-tools/*')
global with sharing class AgentMcpToolsRestService {

    @HttpGet
    global static void getTools() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');

        String providerKey = req.params.get('provider');
        String connectorId = req.params.get('connectorId');
        try {
            if (String.isBlank(providerKey)) {
                writeError(res, 400, 'Pass a provider key.');
                return;
            }
            Map<String, Object> reqBody = new Map<String, Object>{
                'provider' => providerKey,
                'userId'   => UserInfo.getUserId()
            };
            // Non-Salesforce connectorIds are Node-side UUIDs, not Salesforce
            // Ids — kept as a plain String end to end, same as the controller.
            if (String.isNotBlank(connectorId)) reqBody.put('connectorId', connectorId);

            HttpResponse serverRes = ArchonServerClient.callout('POST', '/api/mcp-tool-schemas', JSON.serialize(reqBody));

            // Free-tier Render sleeps idle services; while one wakes its edge
            // answers with an HTML "Application loading" page. Same signal
            // AgentConnectorController.throwIfServerWaking encodes, as a
            // clean JSON error the client can retry on.
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

            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(rawBody);
            List<Map<String, Object>> tools = new List<Map<String, Object>>();
            for (Object item : (List<Object>) body.get('tools')) {
                Map<String, Object> t = (Map<String, Object>) item;
                tools.add(new Map<String, Object>{
                    'name'        => (String) t.get('name'),
                    'description' => (String) t.get('description'),
                    'inputSchema' => t.get('inputSchema') != null ? JSON.serialize(t.get('inputSchema')) : null
                });
            }
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(tools));
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
