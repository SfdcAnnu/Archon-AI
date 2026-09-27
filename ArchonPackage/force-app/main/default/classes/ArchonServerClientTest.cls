@IsTest
private class ArchonServerClientTest {

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

    @IsTest
    static void callout_throws_when_not_set_up() {
        // No SynapseInstall__c row inserted.
        Boolean threw = false;
        try {
            ArchonServerClient.callout('GET', '/health', null);
        } catch (ArchonServerClient.NotConfiguredException e) {
            threw = true;
            System.assert(e.getMessage().contains('Archon Setup'));
        }
        System.assertEquals(true, threw);
    }

    @IsTest
    static void callout_succeeds_with_install_configured() {
        insert new SynapseInstall__c(
            SetupOwnerId    = UserInfo.getOrganizationId(),
            SessionKey__c   = 'sk-test',
            ConfiguredAt__c = System.now()
        );
        Test.setMock(HttpCalloutMock.class, new StubMock(200, '{"status":"ok"}'));

        Test.startTest();
        HttpResponse res = ArchonServerClient.callout('GET', '/health', null, 5000);
        Test.stopTest();

        System.assertEquals(200, res.getStatusCode());
    }

    @IsTest
    static void extractServerError_unwraps_json_message() {
        HttpResponse res = new HttpResponse();
        res.setStatusCode(400);
        res.setBody('{"error":"bad_request","message":"Something specific went wrong"}');
        System.assertEquals('Something specific went wrong', ArchonServerClient.extractServerError(res));
    }

    @IsTest
    static void extractServerError_falls_back_to_raw_body() {
        HttpResponse res = new HttpResponse();
        res.setStatusCode(500);
        res.setBody('not json');
        System.assertEquals('not json', ArchonServerClient.extractServerError(res));
    }

    @IsTest
    static void extractServerError_handles_blank_body() {
        HttpResponse res = new HttpResponse();
        res.setStatusCode(503);
        res.setBody('');
        System.assertEquals('Server error 503', ArchonServerClient.extractServerError(res));
    }
}
