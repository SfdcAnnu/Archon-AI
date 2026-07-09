@IsTest
private class AgentConnectorControllerTest {

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
    static void seedJwt() {
        JwtSigner.overrideSecret = 'test-jwt-secret-for-controller-tests';
    }

    @IsTest
    static void getDirectory_falls_back_when_server_unreachable() {
        Test.setMock(HttpCalloutMock.class, new StubMock(500, 'boom'));
        Test.startTest();
        List<AgentConnectorController.DirectoryEntry> entries = AgentConnectorController.getDirectory();
        Test.stopTest();
        for (AgentConnectorController.DirectoryEntry e : entries) {
            System.assertEquals('NotConfigured', e.status, 'No server data → everything reads NotConfigured');
        }
    }

    @IsTest
    static void getDirectory_decorates_server_rows() {
        String body = '{"connectors":[{"id":"abc","providerKey":"salesforce_mcp","displayName":"My SF","status":"Connected","accountEmail":"a@b.com","lastConnectedAt":"2026-06-08T10:00:00.000Z","lastErrorMessage":null}]}';
        Test.setMock(HttpCalloutMock.class, new StubMock(200, body));
        Test.startTest();
        List<AgentConnectorController.DirectoryEntry> entries = AgentConnectorController.getDirectory();
        Test.stopTest();

        Boolean foundConnected = false;
        for (AgentConnectorController.DirectoryEntry e : entries) {
            if (e.providerKey == 'salesforce_mcp') {
                System.assertEquals('Connected', e.status);
                System.assertEquals('a@b.com', e.accountEmail);
                System.assertEquals('abc', e.connectorId);
                foundConnected = true;
            }
        }
        System.assert(foundConnected, 'salesforce_mcp catalog row should reflect Connected status');
    }

    @IsTest
    static void startOAuth_returns_url() {
        Test.setMock(HttpCalloutMock.class, new StubMock(200, '{"connectorId":"xyz","authorizeUrl":"https://example.com/auth"}'));
        Test.startTest();
        AgentConnectorController.StartOAuthResult r = AgentConnectorController.startOAuth(
            'salesforce_mcp', 'My SF', 'https://acme.lightning.force.com/lightning/n/Synapse_AI'
        );
        Test.stopTest();
        System.assertEquals('xyz', r.connectorId);
        System.assertEquals('https://example.com/auth', r.authorizeUrl);
    }

    @IsTest
    static void startOAuth_throws_on_server_error() {
        Test.setMock(HttpCalloutMock.class, new StubMock(400, '{"error":"bad"}'));
        Test.startTest();
        Boolean threw = false;
        try {
            AgentConnectorController.startOAuth('salesforce_mcp', 'X', 'https://r');
        } catch (Exception e) { threw = true; }
        Test.stopTest();
        System.assertEquals(true, threw);
    }

    @IsTest
    static void disconnect_calls_delete() {
        Test.setMock(HttpCalloutMock.class, new StubMock(200, '{"id":"abc","status":"Disconnected"}'));
        Test.startTest();
        AgentConnectorController.disconnect('abc');
        Test.stopTest();
        // No exception = success
    }

    @IsTest
    static void getConnectorTools_parses_list() {
        String body = '{"tools":[{"name":"soqlQuery","description":"Run SOQL","inputSchema":{"type":"object"}}]}';
        Test.setMock(HttpCalloutMock.class, new StubMock(200, body));
        Test.startTest();
        List<AgentConnectorController.RemoteTool> tools = AgentConnectorController.getConnectorTools('abc');
        Test.stopTest();
        System.assertEquals(1, tools.size());
        System.assertEquals('soqlQuery', tools[0].name);
        System.assert(tools[0].inputSchema.contains('object'), 'inputSchema should be JSON-encoded');
    }
}
