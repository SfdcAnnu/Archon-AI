/**
 * Apex REST wrapper around AgentGuardrailsController for the React UI
 * Bundle — same reasoning as AgentBuilderRestService.cls / AgentConnectorRestService.cls:
 * a UI Bundle can't reach @AuraEnabled methods, so this just marshals JSON
 * around the EXISTING guardrails logic (org-wide chat token cap) rather
 * than reimplementing it.
 */
@RestResource(urlMapping='/agent-builder/guardrails')
global with sharing class AgentGuardrailsRestService {

    @HttpGet
    global static void getGuardrails() {
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            AgentGuardrailsController.GuardrailsStatus status = AgentGuardrailsController.getGuardrails();
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(status));
        } catch (Exception e) {
            res.statusCode = 400;
            res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => e.getMessage() }));
        }
    }

    @HttpPost
    global static void saveGuardrails() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(req.requestBody.toString());
            Boolean isEnabled = body.get('isEnabled') == null ? false : (Boolean) body.get('isEnabled');
            Decimal maxTokensPerDay   = body.get('maxTokensPerDay')   == null ? null : (Decimal) body.get('maxTokensPerDay');
            Decimal maxTokensPerMonth = body.get('maxTokensPerMonth') == null ? null : (Decimal) body.get('maxTokensPerMonth');

            AgentGuardrailsController.GuardrailsStatus status =
                AgentGuardrailsController.saveGuardrails(isEnabled, maxTokensPerDay, maxTokensPerMonth);
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(status));
        } catch (Exception e) {
            res.statusCode = 400;
            res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => e.getMessage() }));
        }
    }
}
