/**
 * REST for the handoff, used by the React app (Conversations page) and the
 * Archon server's quiet-period sweep.
 *
 *   GET  ?resource=queues               queues a node can hand to (omni flag)
 *   GET  ?resource=groups               public groups
 *   GET  ?resource=status&sessionId=…   what the banner shows
 *   POST { action: 'return', sessionId, note }   give it back to the agent
 *   POST { action: 'reply',  sessionId, text }   a person's reply to the customer
 *   POST { action: 'sweep' }                     return every conversation past its quiet period
 */
@RestResource(urlMapping='/agent-builder/handoff/*')
global with sharing class AgentHandoffRestService {

    @HttpGet
    global static void handleGet() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            String resource = req.params.get('resource');
            if (resource == 'queues') {
                ok(res, AgentHandoffService.listQueues());
            } else if (resource == 'groups') {
                ok(res, AgentHandoffService.listGroups());
            } else if (resource == 'status') {
                String sessionId = req.params.get('sessionId');
                if (String.isBlank(sessionId)) { fail(res, 400, 'sessionId is required.'); return; }
                ok(res, AgentHandoffService.status(sessionId));
            } else {
                fail(res, 400, 'Unknown resource. Use queues, groups or status.');
            }
        } catch (Exception e) {
            fail(res, 400, e.getMessage());
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
            String sessionId = (String) body.get('sessionId');
            if (action == 'return') {
                if (String.isBlank(sessionId)) { fail(res, 400, 'sessionId is required.'); return; }
                AgentHandoffService.returnToAgent(sessionId, (String) body.get('note'), UserInfo.getUserId());
                ok(res, AgentHandoffService.status(sessionId));
            } else if (action == 'reply') {
                if (String.isBlank(sessionId)) { fail(res, 400, 'sessionId is required.'); return; }
                ChatMessage__c m = AgentHandoffService.replyAsHuman(sessionId, (String) body.get('text'));
                Map<String, Object> out = AgentHandoffService.status(sessionId);
                out.put('messageId', m == null ? null : m.Id);
                ok(res, out);
            } else if (action == 'sweep') {
                ok(res, new Map<String, Object>{ 'returned' => AgentHandoffService.returnOverdue() });
            } else {
                fail(res, 400, 'Unknown action. Use return, reply or sweep.');
            }
        } catch (Exception e) {
            fail(res, 400, e.getMessage());
        }
    }

    private static void ok(RestResponse res, Object payload) {
        res.statusCode = 200;
        res.responseBody = Blob.valueOf(JSON.serialize(payload));
    }

    private static void fail(RestResponse res, Integer code, String message) {
        res.statusCode = code;
        res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => message }));
    }
}
