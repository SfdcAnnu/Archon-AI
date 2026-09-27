@IsTest
private class AgentRunnerTest {

    private class MockEngine implements HttpCalloutMock {
        public Boolean success;
        public String lastRequestBody;
        public MockEngine(Boolean success) { this.success = success; }
        public HttpResponse respond(HttpRequest req) {
            this.lastRequestBody = req.getBody();
            HttpResponse res = new HttpResponse();
            res.setStatusCode(success ? 200 : 500);
            res.setBody('{"success":' + success + ',"correlationId":"corr-runner","agentStatus":"' +
                (success ? 'SUCCESS' : 'ERROR') + '","agentScore":72,"agentPriority":"Warm","agentReason":"OK","agentOutputPayload":"{}"}');
            return res;
        }
    }

    @TestSetup
    static void setup() {
        insert new AgentDefinition__c(
            Name='Runner Agent', ApiName__c='runner_agent', Department__c='Sales', Status__c='Active'
        );
        insert new SynapseInstall__c(
            SetupOwnerId    = UserInfo.getOrganizationId(),
            SessionKey__c   = 'sk-test',
            ConfiguredAt__c = System.now()
        );
    }

    @IsTest
    static void run_handles_missing_agent() {
        AgentRunner.AgentInput inp = new AgentRunner.AgentInput();
        inp.agentApiName = 'does_not_exist';
        inp.recordId = '00Q000000000000';
        inp.runMode = 'sync';

        Test.startTest();
        List<AgentRunner.AgentOutput> outs = AgentRunner.run(new List<AgentRunner.AgentInput>{ inp });
        Test.stopTest();

        System.assertEquals(1, outs.size());
        System.assertEquals(false, outs[0].success);
        System.assertEquals('ERROR', outs[0].agentStatus);
    }

    @IsTest
    static void run_calls_external_engine_for_active_agent() {
        AgentRunner.AgentInput inp = new AgentRunner.AgentInput();
        inp.agentApiName = 'runner_agent';
        inp.recordId = '00Q000000000000';
        inp.runMode = 'sync';

        Test.setMock(HttpCalloutMock.class, new MockEngine(true));
        Test.startTest();
        List<AgentRunner.AgentOutput> outs = AgentRunner.run(new List<AgentRunner.AgentInput>{ inp });
        Test.stopTest();

        System.assertEquals(1, outs.size());
        System.assertEquals(true, outs[0].success);
        System.assertEquals(72, outs[0].agentScore);
    }

    @IsTest
    static void run_attaches_engine_override_when_ai_node_and_connection_exist() {
        AgentDefinition__c agent = [SELECT Id FROM AgentDefinition__c WHERE ApiName__c = 'runner_agent' LIMIT 1];
        insert new AgentNode__c(
            Name = 'AI Node', AgentDefinition__c = agent.Id,
            NodeType__c = 'ai', NodeSubType__c = 'claude', SortOrder__c = 0
        );
        insert new AiEngineConnection__c(
            Label__c = 'My Claude Key', User__c = UserInfo.getUserId(),
            OwnershipType__c = 'Personal', EngineType__c = 'claude',
            ApiKey__c = 'sk-ant-test', IsActive__c = true, IsPreferred__c = true
        );

        AgentRunner.AgentInput inp = new AgentRunner.AgentInput();
        inp.agentApiName = 'runner_agent';
        inp.recordId = '00Q000000000000';

        MockEngine mock = new MockEngine(true);
        Test.setMock(HttpCalloutMock.class, mock);
        Test.startTest();
        List<AgentRunner.AgentOutput> outs = AgentRunner.run(new List<AgentRunner.AgentInput>{ inp });
        Test.stopTest();

        System.assertEquals(true, outs[0].success);
        System.assert(mock.lastRequestBody.contains('engineOverride'), 'Resolved AI Engine Connection should ride along in the payload');
        System.assert(mock.lastRequestBody.contains('sk-ant-test'), 'The resolved API key should be in the payload');
    }

    @IsTest
    static void run_creates_execution_log() {
        AgentRunner.AgentInput inp = new AgentRunner.AgentInput();
        inp.agentApiName = 'runner_agent';
        inp.recordId = '00Q000000000000';

        Test.setMock(HttpCalloutMock.class, new MockEngine(true));
        Test.startTest();
        AgentRunner.run(new List<AgentRunner.AgentInput>{ inp });
        Test.stopTest();

        Integer logs = [SELECT COUNT() FROM AgentExecution__c WHERE CorrelationId__c = 'corr-runner'];
        System.assertEquals(1, logs);
    }
}
