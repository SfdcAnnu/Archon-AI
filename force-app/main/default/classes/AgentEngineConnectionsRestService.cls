/**
 * Apex REST wrapper around AiEngineConnectionController for the React AI
 * Connections admin page AND the canvas properties-panel credential
 * picker (both need the same list/save/delete/bind/test surface). Thin
 * marshalling only — action-dispatch POST body, same pattern as
 * AgentKbRestService for a controller with several distinct writes.
 */
@RestResource(urlMapping='/agent-builder/engine-connections/*')
global with sharing class AgentEngineConnectionsRestService {

    @HttpGet
    global static void handleGet() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            String engineType = req.params.get('engineType');
            if (String.isBlank(engineType)) {
                writeError(res, 400, 'Pass engineType as a query param.');
                return;
            }
            List<AiEngineConnectionController.ConnectionSummary> rows =
                AiEngineConnectionController.listAccessibleForEngine(engineType);
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

            if (action == 'save') {
                Id newId = AiEngineConnectionController.saveConnection(
                    (String) body.get('recordId'),
                    (String) body.get('engineType'),
                    (String) body.get('ownershipType'),
                    (String) body.get('label'),
                    (String) body.get('apiKey'),
                    (String) body.get('endpoint'),
                    (String) body.get('defaultModel'),
                    (Boolean) body.get('isActive'),
                    (Boolean) body.get('isPreferred'),
                    (Boolean) body.get('isPublicShared'),
                    (String) body.get('notes')
                );
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'id' => newId }));
                return;
            }
            if (action == 'delete') {
                AiEngineConnectionController.deleteConnection((String) body.get('recordId'));
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, Boolean>{ 'success' => true }));
                return;
            }
            if (action == 'bind') {
                AiEngineConnectionController.bindToNode((String) body.get('agentNodeId'), (String) body.get('connectionId'));
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, Boolean>{ 'success' => true }));
                return;
            }
            if (action == 'fetchModels') {
                List<Object> models = AiEngineConnectionController.fetchProviderModels(
                    (String) body.get('recordId'),
                    (String) body.get('engineType'),
                    (String) body.get('apiKey'),
                    (String) body.get('endpoint')
                );
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, Object>{ 'models' => models }));
                return;
            }
            if (action == 'saveModels') {
                AiEngineConnectionController.saveModels(
                    (String) body.get('recordId'),
                    (String) body.get('modelsJson')
                );
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, Boolean>{ 'success' => true }));
                return;
            }
            if (action == 'test') {
                AiEngineConnectionController.TestResult result =
                    AiEngineConnectionController.testConnection((String) body.get('recordId'));
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(result));
                return;
            }
            writeError(res, 400, 'Unknown action "' + action + '".');
        } catch (Exception e) {
            writeError(res, 400, e.getMessage());
        }
    }

    private static void writeError(RestResponse res, Integer statusCode, String message) {
        res.statusCode = statusCode;
        res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => message }));
    }
}
