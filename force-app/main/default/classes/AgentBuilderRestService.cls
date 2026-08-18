/**
 * Apex REST wrapper around AgentBuilderController for the React UI Bundle
 * (force-app/main/default/uiBundles/AgentBuilderApp).
 *
 * A UI Bundle's browser code cannot reach @AuraEnabled methods — there is
 * no Aura/LWC RPC bridge inside a UI Bundle's container. @RestResource,
 * called via the platform SDK's CSRF-aware fetch(), is the documented
 * path instead (confirmed against the actual installed @salesforce/
 * platform-sdk 10.24.0 type definitions — its CSRF interceptor names
 * "Apex REST" explicitly as the endpoint class it protects).
 *
 * This is a thin marshalling layer only. All real logic — the delete-and-
 * reinsert transaction semantics in saveAgentWithNodes, FLS/sharing via
 * WITH USER_MODE, validation — stays in AgentBuilderController so there
 * is exactly one implementation of "how an agent gets loaded/saved,"
 * shared by both the LWC canvas and this REST-fronted React canvas.
 *
 * @RestResource classes must be declared `global` — that's a Salesforce
 * platform requirement for this annotation, not a deliberate widening of
 * this codebase's usual `public with sharing` convention.
 */
@RestResource(urlMapping='/agent-builder/agent/*')
global with sharing class AgentBuilderRestService {

    @HttpGet
    global static void getAgent() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');

        String agentId = req.params.get('agentId');
        String apiName = req.params.get('apiName');
        try {
            if (String.isBlank(agentId)) {
                if (String.isBlank(apiName)) {
                    writeError(res, 400, 'Pass either agentId or apiName.');
                    return;
                }
                List<AgentDefinition__c> byApiName = [
                    SELECT Id FROM AgentDefinition__c WHERE ApiName__c = :apiName WITH USER_MODE LIMIT 1
                ];
                if (byApiName.isEmpty()) {
                    writeError(res, 404, 'No agent found for apiName "' + apiName + '".');
                    return;
                }
                agentId = byApiName[0].Id;
            }

            AgentBuilderController.AgentWithNodes result = AgentBuilderController.getAgentWithNodes(agentId);
            if (result == null) {
                writeError(res, 404, 'No agent found for that Id.');
                return;
            }
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(result));
        } catch (Exception e) {
            writeError(res, 400, e.getMessage());
        }
    }

    /** Body shape: { "agent": <AgentDefinitionInput fields>, "nodes": [<AgentNodeInput fields>, ...] }
     *  — same two payloads AgentBuilderController.saveAgentWithNodes already
     *  accepts as JSON strings; this just relays them through unparsed. */
    @HttpPost
    global static void saveAgent() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(req.requestBody.toString());
            if (!body.containsKey('agent') || !body.containsKey('nodes')) {
                writeError(res, 400, 'Body must include "agent" and "nodes".');
                return;
            }
            String agentId = AgentBuilderController.saveAgentWithNodes(
                JSON.serialize(body.get('agent')),
                JSON.serialize(body.get('nodes'))
            );
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'agentId' => agentId }));
        } catch (Exception e) {
            writeError(res, 400, e.getMessage());
        }
    }

    private static void writeError(RestResponse res, Integer statusCode, String message) {
        res.statusCode = statusCode;
        res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => message }));
    }
}
