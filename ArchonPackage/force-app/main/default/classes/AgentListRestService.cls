/**
 * Apex REST wrapper around the agent-list surface of AgentBuilderController
 * (list / delete / status-toggle) for the React UI Bundle's Home page —
 * same reasoning as AgentBuilderRestService.cls: thin marshalling only,
 * zero duplicated logic.
 *
 * Separate class from AgentBuilderRestService (which owns the single-agent
 * get/save endpoints under /agent-builder/agent/*) because this is a
 * distinct resource shape (collection vs. single record) with its own verb
 * set (GET list, DELETE, PATCH status) — matches AgentGuardrailsRestService/
 * AgentConnectorRestService's one-class-per-resource convention.
 */
@RestResource(urlMapping='/agent-builder/agents')
global with sharing class AgentListRestService {

    @HttpGet
    global static void listAgents() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            String department = req.params.get('department');
            List<AgentDefinition__c> agents = AgentBuilderController.getAgentDefinitions(department);
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(agents));
        } catch (Exception e) {
            writeError(res, 400, e.getMessage());
        }
    }

    @HttpDelete
    global static void deleteAgent() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            String agentId = req.params.get('agentId');
            if (String.isBlank(agentId)) {
                writeError(res, 400, 'Pass agentId as a query param.');
                return;
            }
            AgentBuilderController.deleteAgent(agentId);
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, Boolean>{ 'success' => true }));
        } catch (Exception e) {
            writeError(res, 400, e.getMessage());
        }
    }

    /** Body shape: { "status": "Active" | "Draft" | "Inactive" }
     *  or { "streamReplies": true | false } — one agent property per call,
     *  so a checkbox never has to post a whole agent back. */
    @HttpPatch
    global static void updateStatus() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            String agentId = req.params.get('agentId');
            if (String.isBlank(agentId)) {
                writeError(res, 400, 'Pass agentId as a query param.');
                return;
            }
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(req.requestBody.toString());
            if (body.containsKey('streamReplies')) {
                AgentBuilderController.updateStreamReplies(agentId, (Boolean) body.get('streamReplies'));
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, Boolean>{ 'success' => true }));
                return;
            }
            String status = (String) body.get('status');
            if (String.isBlank(status)) {
                writeError(res, 400, 'Body must include "status" or "streamReplies".');
                return;
            }
            AgentBuilderController.updateAgentStatus(agentId, status);
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
