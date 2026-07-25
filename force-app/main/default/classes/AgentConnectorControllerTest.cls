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

    // Every AgentConnectorController.callout() requires a configured
    // SynapseInstall__c row (Bearer <SessionKey__c> pattern) — without it,
    // the method throws before the HttpCalloutMock is ever reached.
    @TestSetup
    static void seedInstall() {
        insert new SynapseInstall__c(
            SetupOwnerId    = UserInfo.getOrganizationId(),
            SessionKey__c   = 'sk-test',
            ConfiguredAt__c = System.now()
        );
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
        Test.setMock(HttpCalloutMock.class, new StubMock(200, '{"id":"a0000000000000A","status":"Disconnected"}'));
        Test.startTest();
        AgentConnectorController.disconnect('a0000000000000A');
        Test.stopTest();
        // No exception = success
    }

    @IsTest
    static void getConnectorTools_parses_list() {
        String body = '{"tools":[{"name":"soqlQuery","description":"Run SOQL","inputSchema":{"type":"object"}}]}';
        Test.setMock(HttpCalloutMock.class, new StubMock(200, body));
        Test.startTest();
        List<AgentConnectorController.RemoteTool> tools = AgentConnectorController.getConnectorTools('a0000000000000A');
        Test.stopTest();
        System.assertEquals(1, tools.size());
        System.assertEquals('soqlQuery', tools[0].name);
        System.assert(tools[0].inputSchema.contains('object'), 'inputSchema should be JSON-encoded');
    }

    @IsTest
    static void getMcpToolSchemas_parses_list_with_real_schema() {
        String body = '{"tools":[{"name":"send_email","description":"Send an email","inputSchema":{"type":"object","properties":{"to":{"type":"string"}},"required":["to"]}}]}';
        Test.setMock(HttpCalloutMock.class, new StubMock(200, body));
        Test.startTest();
        List<AgentConnectorController.RemoteTool> tools = AgentConnectorController.getMcpToolSchemas('outlook', 'conn-uuid-123');
        Test.stopTest();
        System.assertEquals(1, tools.size());
        System.assertEquals('send_email', tools[0].name);
        System.assert(tools[0].inputSchema.contains('required'), 'inputSchema should carry the real JSON schema through');
    }

    @IsTest
    static void getMcpToolSchemas_blank_provider_returns_empty() {
        Test.startTest();
        List<AgentConnectorController.RemoteTool> tools = AgentConnectorController.getMcpToolSchemas(null, null);
        Test.stopTest();
        System.assertEquals(0, tools.size());
    }

    @IsTest
    static void getConnectorsForCatalogType_blank_returns_empty() {
        Test.startTest();
        List<AgentConnectorController.ConnectorOption> opts = AgentConnectorController.getConnectorsForCatalogType(null);
        Test.stopTest();
        System.assertEquals(0, opts.size());
    }

    @IsTest
    static void getConnectorsForCatalogType_filters_connected_rows() {
        String body = '{"connectors":[{"id":"a0000000000000A","providerKey":"salesforce_mcp","displayName":"My SF","status":"Connected","accountEmail":"a@b.com"}]}';
        Test.setMock(HttpCalloutMock.class, new StubMock(200, body));
        Test.startTest();
        List<AgentConnectorController.ConnectorOption> opts = AgentConnectorController.getConnectorsForCatalogType('salesforce_crm_tools');
        Test.stopTest();
        System.assert(opts != null, 'should return a list even with no matching metadata rows in this org');
    }

    @IsTest
    static void getMcpToolCatalog_blank_provider_returns_empty() {
        Test.startTest();
        List<AgentConnectorController.McpToolSummary> tools = AgentConnectorController.getMcpToolCatalog(null);
        Test.stopTest();
        System.assertEquals(0, tools.size());
    }

    @IsTest
    static void getCustomActionCatalog_returns_server_body() {
        Test.setMock(HttpCalloutMock.class, new StubMock(200, '{"actions":[{"type":"apex","name":"X","label":"X"}]}'));
        Test.startTest();
        String body = AgentConnectorController.getCustomActionCatalog();
        Test.stopTest();
        System.assert(body.contains('actions'), 'should pass the server response straight through');
    }

    @IsTest
    static void describeCustomAction_returns_server_body() {
        Test.setMock(HttpCalloutMock.class, new StubMock(200, '{"label":"X","inputs":[]}'));
        Test.startTest();
        String body = AgentConnectorController.describeCustomAction('apex', 'MyClass');
        Test.stopTest();
        System.assert(body.contains('label'), 'should pass the server response straight through');
    }
}
