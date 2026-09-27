@IsTest
private class SynapseSetupControllerTest {

    private class StubMock implements HttpCalloutMock {
        Integer code;
        String body;
        StubMock(Integer code, String body) { this.code = code; this.body = body; }
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(code);
            res.setBody(body);
            res.setHeader('Content-Type', 'application/json');
            return res;
        }
    }

    @IsTest
    static void getStatus_returns_not_configured_initially() {
        Test.startTest();
        SynapseSetupController.SetupStatus s = SynapseSetupController.getStatus();
        Test.stopTest();
        System.assertEquals(false, s.configured);
        System.assertEquals(UserInfo.getOrganizationId(), s.orgId);
    }

    @IsTest
    static void startSetup_returns_authorize_url_and_stashes_session_key() {
        Test.setMock(HttpCalloutMock.class, new StubMock(200, '{"authorizeUrl":"https://example.com/auth?x=1","sessionKey":"sk-pre-minted-abc"}'));
        Test.startTest();
        SynapseSetupController.StartResult r = SynapseSetupController.startSetup('https://acme.lightning.force.com/lightning/n/Synapse_Setup');
        Test.stopTest();
        System.assertEquals('https://example.com/auth?x=1', r.authorizeUrl);

        SynapseInstall__c row = SynapseInstall__c.getOrgDefaults();
        System.assertEquals('sk-pre-minted-abc', row.SessionKey__c, 'sessionKey must be stashed before OAuth begins');
        System.assertEquals(null, row.ConfiguredAt__c, 'configuredAt should still be null until refreshStatus runs');
    }

    @IsTest
    static void startSetup_throws_when_server_500s() {
        Test.setMock(HttpCalloutMock.class, new StubMock(500, '{"error":"server_misconfigured"}'));
        Test.startTest();
        Boolean threw = false;
        try {
            SynapseSetupController.startSetup('https://acme.lightning.force.com/lightning/n/Synapse_Setup');
        } catch (Exception e) { threw = true; }
        Test.stopTest();
        System.assertEquals(true, threw);
    }

    @IsTest
    static void refreshStatus_marks_configured_and_fills_email() {
        // Seed an existing in-flight install (Apex would have done this in startSetup)
        SynapseInstall__c seed = new SynapseInstall__c(
            SetupOwnerId = UserInfo.getOrganizationId(),
            SessionKey__c = 'sk-from-start'
        );
        insert seed;

        String body = '{"configured":true,"orgId":"' + UserInfo.getOrganizationId() + '","email":"bob@acme.com","configuredAt":"2026-06-08T10:00:00.000Z"}';
        Test.setMock(HttpCalloutMock.class, new StubMock(200, body));
        Test.startTest();
        SynapseSetupController.SetupStatus s = SynapseSetupController.refreshStatus();
        Test.stopTest();

        System.assertEquals(true, s.configured);
        System.assertEquals('bob@acme.com', s.configuredByEmail);

        SynapseInstall__c after = SynapseInstall__c.getOrgDefaults();
        System.assertEquals('bob@acme.com', after.ConfiguredByEmail__c);
        System.assertNotEquals(null, after.ConfiguredAt__c);
    }

    @IsTest
    static void refreshStatus_returns_local_when_server_not_configured() {
        Test.setMock(HttpCalloutMock.class, new StubMock(200, '{"configured":false}'));
        Test.startTest();
        SynapseSetupController.SetupStatus s = SynapseSetupController.refreshStatus();
        Test.stopTest();
        System.assertEquals(false, s.configured);
    }

    @IsTest
    static void resetSetup_clears_local_state() {
        SynapseInstall__c row = new SynapseInstall__c(
            SetupOwnerId    = UserInfo.getOrganizationId(),
            SessionKey__c   = 'sk-old',
            ConfiguredAt__c = System.now()
        );
        insert row;

        Test.setMock(HttpCalloutMock.class, new StubMock(200, '{"ok":true}'));
        Test.startTest();
        SynapseSetupController.resetSetup();
        Test.stopTest();

        SynapseInstall__c after = SynapseInstall__c.getOrgDefaults();
        System.assertEquals(null, after.SessionKey__c);
        System.assertEquals(null, after.ConfiguredAt__c);
    }
}
