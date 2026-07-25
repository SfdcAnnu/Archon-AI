@IsTest
private class AgentKbControllerTest {

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
    static void seedInstall() {
        insert new SynapseInstall__c(
            SetupOwnerId    = UserInfo.getOrganizationId(),
            SessionKey__c   = 'sk-test',
            ConfiguredAt__c = System.now()
        );
    }

    @IsTest
    static void getStorageConfig_parses_response() {
        Test.setMock(HttpCalloutMock.class, new StubMock(200,
            '{"backend":"archon","connectionUrlMasked":null,"hasConnectionUrl":false}'));
        Test.startTest();
        AgentKbController.StorageConfig cfg = AgentKbController.getStorageConfig();
        Test.stopTest();
        System.assertEquals('archon', cfg.backend);
        System.assertEquals(false, cfg.hasConnectionUrl);
    }

    @IsTest
    static void saveStorageConfig_posts_backend_choice() {
        Test.setMock(HttpCalloutMock.class, new StubMock(200,
            '{"backend":"external_pg","connectionUrlMasked":"postgresql://host/db"}'));
        Test.startTest();
        AgentKbController.StorageConfig cfg = AgentKbController.saveStorageConfig('external_pg', 'postgresql://user:pw@host/db');
        Test.stopTest();
        System.assertEquals('external_pg', cfg.backend);
    }

    @IsTest
    static void saveStorageConfig_throws_on_server_error() {
        Test.setMock(HttpCalloutMock.class, new StubMock(400, '{"message":"connection refused"}'));
        Test.startTest();
        Boolean threw = false;
        try {
            AgentKbController.saveStorageConfig('external_pg', 'postgresql://bad');
        } catch (AuraHandledException e) { threw = true; }
        Test.stopTest();
        System.assertEquals(true, threw);
    }

    @IsTest
    static void testConnection_succeeds() {
        Test.setMock(HttpCalloutMock.class, new StubMock(200, '{"ok":true}'));
        Test.startTest();
        AgentKbController.testConnection('postgresql://user:pw@host/db');
        Test.stopTest();
        // No exception = success
    }

    @IsTest
    static void getDocuments_parses_list() {
        String body = '{"documents":[{"id":"d1","title":"FAQ","sourceType":"upload","status":"Ready","chunkCount":3,"errorMessage":null}]}';
        Test.setMock(HttpCalloutMock.class, new StubMock(200, body));
        Test.startTest();
        List<AgentKbController.KbDocumentDto> docs = AgentKbController.getDocuments('lead_scoring_agent');
        Test.stopTest();
        System.assertEquals(1, docs.size());
        System.assertEquals('FAQ', docs[0].title);
        System.assertEquals('Ready', docs[0].status);
        System.assertEquals(3, docs[0].chunkCount);
    }

    @IsTest
    static void uploadDocument_pasted_text_returns_document() {
        String body = '{"document":{"id":"d2","title":"Notes","sourceType":"upload","status":"Ready","chunkCount":1,"errorMessage":null}}';
        Test.setMock(HttpCalloutMock.class, new StubMock(200, body));
        Test.startTest();
        AgentKbController.KbDocumentDto doc = AgentKbController.uploadDocument('lead_scoring_agent', 'Notes', 'Some plain text.', null);
        Test.stopTest();
        System.assertEquals('d2', doc.id);
        System.assertEquals('Ready', doc.status);
    }

    @IsTest
    static void reindexDocument_returns_updated_document() {
        String body = '{"document":{"id":"d2","title":"Notes","sourceType":"upload","status":"Indexing","chunkCount":0,"errorMessage":null}}';
        Test.setMock(HttpCalloutMock.class, new StubMock(200, body));
        Test.startTest();
        AgentKbController.KbDocumentDto doc = AgentKbController.reindexDocument('d2');
        Test.stopTest();
        System.assertEquals('Indexing', doc.status);
    }

    @IsTest
    static void deleteDocument_calls_delete() {
        Test.setMock(HttpCalloutMock.class, new StubMock(200, '{"ok":true}'));
        Test.startTest();
        AgentKbController.deleteDocument('d2');
        Test.stopTest();
        // No exception = success
    }

    @IsTest
    static void deleteDocument_throws_on_error() {
        Test.setMock(HttpCalloutMock.class, new StubMock(500, '{"message":"boom"}'));
        Test.startTest();
        Boolean threw = false;
        try {
            AgentKbController.deleteDocument('missing');
        } catch (AuraHandledException e) { threw = true; }
        Test.stopTest();
        System.assertEquals(true, threw);
    }
}
