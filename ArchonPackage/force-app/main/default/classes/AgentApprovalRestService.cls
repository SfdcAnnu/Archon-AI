/**
 * Apex REST wrapper around AgentApprovalController for the React
 * "Approvals" page. Thin marshalling only — decide() already does all the
 * security-sensitive work itself (re-checks ApproverId__c + Status__c
 * server-side, never trusts client input; calls the remote resume
 * endpoint BEFORE any DML so a failed resume leaves the approval Pending,
 * safe to retry; never returns ApprovalToken__c). This wrapper does not
 * and must not touch any of that — it only relays the call.
 */
@RestResource(urlMapping='/agent-builder/approvals')
global with sharing class AgentApprovalRestService {

    @HttpGet
    global static void listApprovals() {
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            List<AgentApprovalController.ApprovalDto> rows = AgentApprovalController.getMyPendingApprovals();
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(rows));
        } catch (Exception e) {
            res.statusCode = 400;
            res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => e.getMessage() }));
        }
    }

    /** Body shape: { "approvalId": "...", "decision": "approved"|"rejected", "comments": "..." } */
    @HttpPost
    global static void decide() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;
        res.addHeader('Content-Type', 'application/json');
        try {
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(req.requestBody.toString());
            String approvalId = (String) body.get('approvalId');
            String decision = (String) body.get('decision');
            String comments = (String) body.get('comments');
            if (String.isBlank(approvalId) || String.isBlank(decision)) {
                res.statusCode = 400;
                res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => 'approvalId and decision are required.' }));
                return;
            }
            AgentApprovalController.ApprovalDto result = AgentApprovalController.decide(approvalId, decision, comments);
            res.statusCode = 200;
            res.responseBody = Blob.valueOf(JSON.serialize(result));
        } catch (Exception e) {
            res.statusCode = 400;
            res.responseBody = Blob.valueOf(JSON.serialize(new Map<String, String>{ 'error' => e.getMessage() }));
        }
    }
}
