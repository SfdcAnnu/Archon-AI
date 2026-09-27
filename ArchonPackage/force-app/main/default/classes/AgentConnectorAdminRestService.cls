/**
 * Apex REST wrapper for the React "Connectors" admin page's write actions
 * (custom MCP server CRUD, disconnect, OAuth start) — deliberately a
 * SEPARATE class/urlMapping from AgentConnectorRestService.cls (which owns
 * the already-deployed, read-only getDirectory() the canvas Palette
 * depends on) so this additive work can't risk that working endpoint.
 */
@RestResource(urlMapping='/agent-builder/connectors-admin/*')
global with sharing class AgentConnectorAdminRestService {

    @HttpGet
    global static void listCustomMcpServers() {
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            List<CustomMcpServer__c> rows = AgentConnectorController.listCustomMcpServers();
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(rows));
        } catch (Exception e) {
            writeError(res, 400, e.getMessage());
        }
    }

    @HttpPost
    global static void handlePost() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(req.requestBody.toString());
            String action = (String) body.get('action');
            if (String.isBlank(action)) {
                writeError(res, 400, 'Body must include "action".');
                return;
            }

            if (action == 'saveCustomMcpServer') {
                Id newId = AgentConnectorController.saveCustomMcpServer(
                    (String) body.get('recordId'),
                    (String) body.get('serverName'),
                    (String) body.get('mcpServerUrl'),
                    (String) body.get('description'),
                    (String) body.get('category'),
                    (String) body.get('catalogType')
                );
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'id' => newId }));
                return;
            }
            if (action == 'startOAuth') {
                AgentConnectorController.StartOAuthResult result = AgentConnectorController.startOAuth(
                    (String) body.get('providerKey'), (String) body.get('displayName'), (String) body.get('returnUrl')
                );
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(result));
                return;
            }
            writeError(res, 400, 'Unknown action "' + action + '".');
        } catch (Exception e) {
            writeError(res, 400, e.getMessage());
        }
    }

    @HttpDelete
    global static void handleDelete() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            String resource = req.params.get('resource');
            if (resource == 'custom-mcp') {
                AgentConnectorController.deleteCustomMcpServer(req.params.get('recordId'));
            } else {
                AgentConnectorController.disconnect(req.params.get('connectorId'));
            }
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, Boolean>{ 'success' => true }));
        } catch (Exception e) {
            writeError(res, 400, e.getMessage());
        }
    }

    private static void writeError(RestResponse res, Integer statusCode, String message) {
        res.statusCode = statusCode;
        res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => message }));
    }
}
