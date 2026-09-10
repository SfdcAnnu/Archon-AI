/**
 * Thin REST wrapper for CHAT-mode approvals (approval-as-suspension).
 * The pending rows live in the Archon server's database, NOT in Salesforce —
 * this class only proxies the two server endpoints with org auth:
 *   GET  /api/chat/approvals        (filters: sessionId, status)
 *   POST /api/chat/approvals/decide (approved → server executes the stored
 *                                    tool call immediately)
 * Called by the React app: approval cards in the live ChatPanel and on the
 * Conversations detail view. Trigger-mode approvals are separate
 * (AgentApprovalRestService — Salesforce records + run resume).
 */
@RestResource(urlMapping='/agent-builder/chat-approvals')
global with sharing class AgentChatApprovalsRestService {

    @HttpGet
    global static void listApprovals() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            List<String> params = new List<String>();
            String sessionId = req.params.get('sessionId');
            String status = req.params.get('status');
            if (String.isNotBlank(sessionId)) params.add('sessionId=' + EncodingUtil.urlEncode(sessionId, 'UTF-8'));
            if (String.isNotBlank(status)) params.add('status=' + EncodingUtil.urlEncode(status, 'UTF-8'));
            String path = '/api/chat/approvals' + (params.isEmpty() ? '' : '?' + String.join(params, '&'));

            HttpResponse serverRes = ArchonServerClient.callout('GET', path, null);
            if (serverRes.getStatusCode() >= 400) {
                writeError(res, 400, 'Could not load approvals: ' + ArchonServerClient.extractServerError(serverRes));
                return;
            }
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(serverRes.getBody());
        } catch (Exception e) {
            writeError(res, 400, e.getMessage());
        }
    }

    @HttpPost
    global static void decide() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(req.requestBody.toString());
            String approvalId = (String) body.get('approvalId');
            String decision = (String) body.get('decision');
            if (String.isBlank(approvalId) || (decision != 'approved' && decision != 'rejected')) {
                writeError(res, 400, 'Body must include approvalId and decision ("approved" or "rejected").');
                return;
            }
            Map<String, Object> payload = new Map<String, Object>{
                'approvalId' => approvalId,
                'decision' => decision,
                'deciderUserId' => UserInfo.getUserId()
            };
            // 120s — an approved action executes right away, and its MCP
            // server may need a cold start on free-tier hosting.
            HttpResponse serverRes = ArchonServerClient.callout('POST', '/api/chat/approvals/decide', JSON.serialize(payload), 120000);
            if (serverRes.getStatusCode() >= 400) {
                writeError(res, 400, 'Could not decide this approval: ' + ArchonServerClient.extractServerError(serverRes));
                return;
            }
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(serverRes.getBody());
        } catch (Exception e) {
            writeError(res, 400, e.getMessage());
        }
    }

    private static void writeError(RestResponse res, Integer statusCode, String message) {
        res.statusCode = statusCode;
        res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => message }));
    }
}
