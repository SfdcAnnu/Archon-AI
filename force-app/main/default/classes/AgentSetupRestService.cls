/**
 * Apex REST wrapper around SynapseSetupController for the React Setup
 * page — the org-level Archon OAuth connection wizard. Thin marshalling
 * only; the actual OAuth authorize/callback flow is unchanged (still a
 * full-page redirect through Salesforce login/consent and back to
 * whatever returnUrl the React page passes, same as the old LWC).
 */
@RestResource(urlMapping='/agent-builder/setup')
global with sharing class AgentSetupRestService {

    @HttpGet
    global static void getStatus() {
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            SynapseSetupController.SetupStatus status = SynapseSetupController.getStatus();
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(status));
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

            if (action == 'refresh') {
                SynapseSetupController.SetupStatus status = SynapseSetupController.refreshStatus();
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(status));
                return;
            }
            if (action == 'start') {
                SynapseSetupController.StartResult result = SynapseSetupController.startSetup((String) body.get('returnUrl'));
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(result));
                return;
            }
            if (action == 'reset') {
                SynapseSetupController.resetSetup();
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, Boolean>{ 'success' => true }));
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
