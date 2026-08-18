/**
 * Apex REST wrapper around AgentKbController for the React "Knowledge
 * Base" page — thin marshalling only, same callout-proxy logic
 * AgentKbController already has (storage-backend config, document
 * upload/reindex/delete against the Archon Node server's RAG pipeline).
 *
 * POST body carries an "action" field since there are several distinct
 * write operations sharing one urlMapping — same reasoning as any other
 * REST wrapper in this app, just with more than one POST shape to cover.
 */
@RestResource(urlMapping='/agent-builder/kb/*')
global with sharing class AgentKbRestService {

    @HttpGet
    global static void handleGet() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            if (req.params.get('resource') == 'storage-config') {
                AgentKbController.StorageConfig cfg = AgentKbController.getStorageConfig();
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(cfg));
                return;
            }

            String agentApiName = req.params.get('agentApiName');
            if (String.isBlank(agentApiName)) {
                writeError(res, 400, 'Pass agentApiName as a query param.');
                return;
            }
            List<AgentKbController.KbDocumentDto> docs = AgentKbController.getDocuments(agentApiName);
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(docs));
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

            if (action == 'saveStorageConfig') {
                AgentKbController.StorageConfig cfg = AgentKbController.saveStorageConfig(
                    (String) body.get('backend'), (String) body.get('connectionUrl')
                );
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(cfg));
                return;
            }
            if (action == 'testConnection') {
                AgentKbController.testConnection((String) body.get('connectionUrl'));
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, Boolean>{ 'success' => true }));
                return;
            }
            if (action == 'uploadDocument') {
                AgentKbController.KbDocumentDto doc = AgentKbController.uploadDocument(
                    (String) body.get('agentApiName'),
                    (String) body.get('title'),
                    (String) body.get('text'),
                    (String) body.get('fileBase64'),
                    (String) body.get('fileName')
                );
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(doc));
                return;
            }
            if (action == 'reindexDocument') {
                AgentKbController.KbDocumentDto doc = AgentKbController.reindexDocument((String) body.get('documentId'));
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(doc));
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
            String documentId = req.params.get('documentId');
            if (String.isBlank(documentId)) {
                writeError(res, 400, 'Pass documentId as a query param.');
                return;
            }
            AgentKbController.deleteDocument(documentId);
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
