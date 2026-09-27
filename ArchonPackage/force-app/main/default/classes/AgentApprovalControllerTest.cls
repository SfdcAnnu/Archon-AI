@IsTest
private class AgentApprovalControllerTest {

    private class StubMock implements HttpCalloutMock {
        Integer code;
        String body;
        StubMock(Integer code, String body) { this.code = code; this.body = body; }
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(this.code);
            res.setBody(this.body);
            res.setHeader('Content-Type', 'application/json');
            return res;
        }
    }

    @TestSetup
    static void seedData() {
        insert new SynapseInstall__c(
            SetupOwnerId    = UserInfo.getOrganizationId(),
            SessionKey__c   = 'sk-test',
            ConfiguredAt__c = System.now()
        );
        insert new AgentApproval__c(
            AgentRunId__c   = 'run-123',
            AgentApiName__c = 'lead_followup',
            NodeLabel__c    = 'Manager Approval',
            RecordId__c     = '00Qxxxxxxxxxxxxxxx',
            ApproverId__c   = UserInfo.getUserId(),
            Status__c       = 'Pending',
            ApprovalToken__c = 'tok-abc-123'
        );
    }

    @IsTest
    static void getMyPendingApprovals_returns_own_pending_rows() {
        Test.startTest();
        List<AgentApprovalController.ApprovalDto> rows = AgentApprovalController.getMyPendingApprovals();
        Test.stopTest();
        System.assertEquals(1, rows.size());
        System.assertEquals('Pending', rows[0].status);
        System.assertEquals('lead_followup', rows[0].agentApiName);
    }

    @IsTest
    static void decide_approved_resumes_run_and_updates_status() {
        Test.setMock(HttpCalloutMock.class, new StubMock(200, '{"success":true,"agentStatus":"SUCCESS"}'));
        AgentApproval__c approval = [SELECT Id FROM AgentApproval__c LIMIT 1];

        Test.startTest();
        AgentApprovalController.ApprovalDto dto = AgentApprovalController.decide(approval.Id, 'approved', 'Looks good');
        Test.stopTest();

        System.assertEquals('Approved', dto.status);
        AgentApproval__c reloaded = [SELECT Status__c, Comments__c, DecidedAt__c FROM AgentApproval__c WHERE Id = :approval.Id];
        System.assertEquals('Approved', reloaded.Status__c);
        System.assertEquals('Looks good', reloaded.Comments__c);
        System.assertNotEquals(null, reloaded.DecidedAt__c);
    }

    @IsTest
    static void decide_rejected_updates_status() {
        Test.setMock(HttpCalloutMock.class, new StubMock(200, '{"success":true,"agentStatus":"SUCCESS"}'));
        AgentApproval__c approval = [SELECT Id FROM AgentApproval__c LIMIT 1];

        Test.startTest();
        AgentApprovalController.ApprovalDto dto = AgentApprovalController.decide(approval.Id, 'rejected', null);
        Test.stopTest();

        System.assertEquals('Rejected', dto.status);
    }

    @IsTest
    static void decide_invalid_decision_throws() {
        AgentApproval__c approval = [SELECT Id FROM AgentApproval__c LIMIT 1];
        Test.startTest();
        Boolean threw = false;
        try {
            AgentApprovalController.decide(approval.Id, 'maybe', null);
        } catch (AuraHandledException e) { threw = true; }
        Test.stopTest();
        System.assertEquals(true, threw);
    }

    @IsTest
    static void decide_already_decided_throws() {
        // Simulate an already-decided approval directly (rather than calling
        // decide() twice) — a callout right after DML in the SAME transaction
        // throws "uncommitted work pending", unrelated to what this test checks.
        AgentApproval__c approval = [SELECT Id FROM AgentApproval__c LIMIT 1];
        approval.Status__c = 'Approved';
        update approval;

        Test.setMock(HttpCalloutMock.class, new StubMock(200, '{"success":true,"agentStatus":"SUCCESS"}'));
        Test.startTest();
        Boolean threw = false;
        try {
            AgentApprovalController.decide(approval.Id, 'rejected', null);
        } catch (AuraHandledException e) { threw = true; }
        Test.stopTest();
        System.assertEquals(true, threw);
    }

    @IsTest
    static void decide_server_error_throws_and_leaves_status_pending() {
        Test.setMock(HttpCalloutMock.class, new StubMock(500, '{"message":"boom"}'));
        AgentApproval__c approval = [SELECT Id FROM AgentApproval__c LIMIT 1];

        Test.startTest();
        Boolean threw = false;
        try {
            AgentApprovalController.decide(approval.Id, 'approved', null);
        } catch (AuraHandledException e) { threw = true; }
        Test.stopTest();

        System.assertEquals(true, threw);
        AgentApproval__c reloaded = [SELECT Status__c FROM AgentApproval__c WHERE Id = :approval.Id];
        System.assertEquals('Pending', reloaded.Status__c);
    }
}
