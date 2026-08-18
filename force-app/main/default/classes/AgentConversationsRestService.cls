/**
 * Apex REST wrapper around AgentChatController's read-only session-history
 * surface (listMySessions / getSession) for the React "Conversations" page
 * — the same data the old agentHome LWC's inline Conversations view reads.
 * Thin marshalling only; sharing/FLS stays exactly as AgentChatController
 * already enforces it (WITH USER_MODE, scoped to the running user's own
 * sessions for the list).
 */
@RestResource(urlMapping='/agent-builder/conversations/*')
global with sharing class AgentConversationsRestService {

    @HttpGet
    global static void handleGet() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            String sessionId = req.params.get('sessionId');
            if (String.isNotBlank(sessionId)) {
                AgentChatController.SessionWithMessages detail = AgentChatController.getSession(sessionId);
                res.statusCode = 200;
                res.responseBody = Blob.valueOf(JSON.serialize(detail));
                return;
            }

            Integer limitN = null;
            String limitParam = req.params.get('limit');
            if (String.isNotBlank(limitParam)) {
                try { limitN = Integer.valueOf(limitParam); } catch (Exception e) { /* fall back to default */ }
            }
            List<AgentChatController.SessionSummary> sessions = AgentChatController.listMySessions(limitN);
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(sessions));
        } catch (Exception e) {
            res.statusCode = 400;
            res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => e.getMessage() }));
        }
    }
}
