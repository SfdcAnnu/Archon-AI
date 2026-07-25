@IsTest
private class AgentGeneratorControllerTest {

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
    static void generateAgent_returns_clarifying_questions() {
        Test.setMock(HttpCalloutMock.class, new StubMock(200,
            '{"kind":"questions","questions":["Who should approve this?","What Slack channel?"]}'));
        Test.startTest();
        AgentGeneratorController.GenerateResult result =
            AgentGeneratorController.generateAgent('Notify sales when a big deal closes', null, null);
        Test.stopTest();

        System.assertEquals('questions', result.kind);
        System.assertEquals(2, result.questions.size());
    }

    @IsTest
    static void generateAgent_returns_full_graph() {
        String body = '{"kind":"agent","agent":{"name":"Lead Scorer","department":"Sales","description":"Scores new leads","knowledgeBase":""},' +
            '"nodes":[' +
            '{"label":"Record Trigger","type":"trigger","subType":"record","config":{"objectType":"Lead","triggerOn":"Create"},"x":60,"y":80},' +
            '{"label":"Score Lead","type":"ai","subType":"claude","config":{"model":"claude-sonnet-4-6","instruction":"Score it"},"x":320,"y":80},' +
            '{"label":"Hot Check","type":"logic","subType":"if_else","config":{"condition":"{!ai.score} > 70"},"x":580,"y":80,"rationale":"Added a branch since the requirement implies different handling for hot leads."}' +
            '],' +
            '"connections":[' +
            '{"fromIndex":0,"fromPort":"out","toIndex":1,"toPort":"in"},' +
            '{"fromIndex":1,"fromPort":"out","toIndex":2,"toPort":"in"}' +
            '],' +
            '"setupChecklist":[{"title":"Bind an AI key","description":"The Score Lead node needs a Claude key.","category":"ai_engine"}]}';
        Test.setMock(HttpCalloutMock.class, new StubMock(200, body));

        Test.startTest();
        AgentGeneratorController.GenerateResult result =
            AgentGeneratorController.generateAgent('Score new leads and flag hot ones', null, null);
        Test.stopTest();

        System.assertEquals('agent', result.kind);
        System.assertEquals('Lead Scorer', result.agentName);
        System.assertEquals(3, result.nodes.size());
        System.assertEquals('record', result.nodes[0].nodeSubType);
        System.assertEquals(2, result.connections.size());
        System.assertEquals(1, result.setupChecklist.size());
        System.assertEquals('ai_engine', result.setupChecklist[0].category);
        System.assertNotEquals(null, result.nodes[2].rationale);
    }

    @IsTest
    static void generateAgent_passes_through_file_and_qa_history() {
        String body = '{"kind":"agent","agent":{"name":"X","department":"Sales","description":"","knowledgeBase":""},"nodes":[],"connections":[],"setupChecklist":[]}';
        Test.setMock(HttpCalloutMock.class, new StubMock(200, body));
        String qaJson = JSON.serialize(new List<Map<String,String>>{
            new Map<String,String>{ 'question' => 'Who approves?', 'answer' => 'The record owner' }
        });

        Test.startTest();
        AgentGeneratorController.GenerateResult result = AgentGeneratorController.generateAgent(
            'Approve big deals', EncodingUtil.base64Encode(Blob.valueOf('extra context')), qaJson
        );
        Test.stopTest();

        System.assertEquals('agent', result.kind);
    }

    @IsTest
    static void generateAgent_throws_on_server_error() {
        Test.setMock(HttpCalloutMock.class, new StubMock(500, '{"message":"model unavailable"}'));
        Test.startTest();
        Boolean threw = false;
        try {
            AgentGeneratorController.generateAgent('Do something', null, null);
        } catch (AuraHandledException e) { threw = true; }
        Test.stopTest();
        System.assertEquals(true, threw);
    }

    @IsTest
    static void generateAgent_throws_server_waking_on_html_response() {
        // Note: AuraHandledException.getMessage() always returns the generic
        // "Script-thrown exception" in Apex test context unless .setMessage()
        // was called explicitly — the real message still reaches the client
        // fine via error.body.message, this is a test-introspection-only
        // quirk. So we can only assert that it threw, not inspect the text.
        Test.setMock(HttpCalloutMock.class, new StubMock(502, '<!doctype html><html><title>Render - Application loading</title></html>'));
        Test.startTest();
        Boolean threw = false;
        try {
            AgentGeneratorController.generateAgent('Do something', null, null);
        } catch (AuraHandledException e) { threw = true; }
        Test.stopTest();
        System.assertEquals(true, threw);
    }
}
