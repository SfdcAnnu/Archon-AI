/**
 * AgentApprovalController — approver-facing actions for AgentApproval__c
 * records, plus the callout that resumes the paused run on the Archon
 * server once a decision is made.
 */
public with sharing class AgentApprovalController {

    @AuraEnabled(cacheable=true)
    public static List<ApprovalDto> getMyPendingApprovals() {
        List<AgentApproval__c> rows = [
            SELECT Id, Name, AgentRunId__c, AgentApiName__c, NodeLabel__c,
                   RecordId__c, Status__c, CreatedDate, TimeoutAt__c
            FROM AgentApproval__c
            WHERE ApproverId__c = :UserInfo.getUserId() AND Status__c = 'Pending'
            WITH USER_MODE
            ORDER BY CreatedDate DESC
            LIMIT 100
        ];
        List<ApprovalDto> out = new List<ApprovalDto>();
        for (AgentApproval__c r : rows) out.add(toDto(r));
        return out;
    }

    @AuraEnabled
    public static ApprovalDto decide(Id approvalId, String decision, String comments) {
        if (decision != 'approved' && decision != 'rejected') {
            throw new AuraHandledException('decision must be "approved" or "rejected".');
        }
        List<AgentApproval__c> rows = [
            SELECT Id, AgentRunId__c, ApprovalToken__c, Status__c
            FROM AgentApproval__c
            WHERE Id = :approvalId AND ApproverId__c = :UserInfo.getUserId()
            WITH USER_MODE
            LIMIT 1
        ];
        if (rows.isEmpty()) {
            throw new AuraHandledException('Approval not found, or you are not the assigned approver.');
        }
        AgentApproval__c approval = rows[0];
        if (approval.Status__c != 'Pending') {
            throw new AuraHandledException('This approval has already been decided (' + approval.Status__c + ').');
        }

        Map<String, Object> payload = new Map<String, Object>{
            'runId' => approval.AgentRunId__c,
            'approvalToken' => approval.ApprovalToken__c,
            'decision' => decision
        };
        HttpResponse res = ArchonServerClient.callout('POST', '/api/agent/runs/resume', JSON.serialize(payload), 120000);
        if (res.getStatusCode() >= 400) {
            throw new AuraHandledException('Could not resume the flow: ' + ArchonServerClient.extractServerError(res));
        }

        approval.Status__c = decision == 'approved' ? 'Approved' : 'Rejected';
        approval.Comments__c = comments;
        approval.DecidedAt__c = System.now();
        update approval;

        return toDto([SELECT Id, Name, AgentRunId__c, AgentApiName__c, NodeLabel__c, RecordId__c, Status__c, CreatedDate, TimeoutAt__c FROM AgentApproval__c WHERE Id = :approvalId LIMIT 1]);
    }

    private static ApprovalDto toDto(AgentApproval__c r) {
        ApprovalDto d = new ApprovalDto();
        d.id = r.Id;
        d.name = r.Name;
        d.agentApiName = r.AgentApiName__c;
        d.nodeLabel = r.NodeLabel__c;
        d.recordId = r.RecordId__c;
        d.status = r.Status__c;
        d.createdDate = r.CreatedDate;
        d.timeoutAt = r.TimeoutAt__c;
        return d;
    }

    public class ApprovalDto {
        @AuraEnabled public String id;
        @AuraEnabled public String name;
        @AuraEnabled public String agentApiName;
        @AuraEnabled public String nodeLabel;
        @AuraEnabled public String recordId;
        @AuraEnabled public String status;
        @AuraEnabled public DateTime createdDate;
        @AuraEnabled public DateTime timeoutAt;
    }
}
