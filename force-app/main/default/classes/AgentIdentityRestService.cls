/**
 * Apex REST wrapper around AgentIdentityController for the React app —
 * thin marshalling only, same convention as AgentConnectorAdminRestService.
 *
 *   GET  ?resource=policy
 *   GET  ?resource=detail&providerKey=
 *   GET  ?resource=roster&providerKey=
 *   GET  ?resource=groups&type=permissionSet|publicGroup|department
 *   GET  ?resource=server&providerKey=
 *   POST { action: savePolicy | startPrincipalOAuth | saveServerOverride | deleteServerOverride | testServer | sendReminders, ... }
 */
@RestResource(urlMapping='/agent-builder/identity/*')
global with sharing class AgentIdentityRestService {

    @HttpGet
    global static void handleGet() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            String resource = req.params.get('resource');
            String providerKey = req.params.get('providerKey');
            String body;
            if (resource == 'policy') {
                body = AgentIdentityController.getPolicy();
            } else if (resource == 'summary') {
                body = AgentIdentityController.getSummary();
            } else if (resource == 'detail') {
                body = AgentIdentityController.getDetail(providerKey);
            } else if (resource == 'roster') {
                body = JSON.serialize(AgentIdentityController.getRoster(providerKey));
            } else if (resource == 'groups') {
                body = AgentIdentityController.listGroups(req.params.get('type'));
            } else if (resource == 'server') {
                body = AgentIdentityController.getServerOverride(providerKey);
            } else {
                writeError(res, 400, 'Unknown resource "' + resource + '".');
                return;
            }
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(body);
        } catch (Exception e) {
            writeError(res, e.getMessage() != null && e.getMessage().startsWith('SERVER_WAKING') ? 503 : 400, e.getMessage());
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
            String out;
            if (action == 'savePolicy') {
                out = AgentIdentityController.savePolicy(JSON.serialize(body.get('policy')));
            } else if (action == 'startPrincipalOAuth') {
                out = AgentIdentityController.startPrincipalOAuth(
                    (String) body.get('providerKey'), (String) body.get('displayName'), (String) body.get('returnUrl'),
                    (String) body.get('principalType'), (String) body.get('subjectType'), (String) body.get('subjectKey'), (String) body.get('subjectLabel'));
            } else if (action == 'saveServerOverride') {
                out = AgentIdentityController.saveServerOverride((String) body.get('providerKey'), (String) body.get('mcpServerUrl'), (String) body.get('authStyle'), (String) body.get('apiKey'));
            } else if (action == 'deleteServerOverride') {
                out = AgentIdentityController.deleteServerOverride((String) body.get('providerKey'));
            } else if (action == 'testServer') {
                out = AgentIdentityController.testServer((String) body.get('providerKey'), (String) body.get('mcpServerUrl'), (String) body.get('authStyle'), (String) body.get('apiKey'));
            } else if (action == 'sendReminders') {
                List<String> userIds = new List<String>();
                if (body.get('userIds') instanceof List<Object>) for (Object o : (List<Object>) body.get('userIds')) userIds.add(String.valueOf(o));
                Integer n = AgentIdentityController.sendReminders((String) body.get('providerKey'), userIds, (String) body.get('agentApiName'));
                out = JSON.serialize(new Map<String, Object>{ 'sent' => n });
            } else {
                writeError(res, 400, 'Unknown action "' + action + '".');
                return;
            }
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(out);
        } catch (Exception e) {
            writeError(res, e.getMessage() != null && e.getMessage().startsWith('SERVER_WAKING') ? 503 : 400, e.getMessage());
        }
    }

    private static void writeError(RestResponse res, Integer statusCode, String message) {
        res.statusCode = statusCode;
        res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => message }));
    }
}
