@IsTest
private class AgentRunnerTest {

    private class MockEngine implements HttpCalloutMock {
        public Boolean success;
        public MockEngine(Boolean success) { this.success = success; }
        public HttpResponse respond(HttpRequest req) {
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
        JwtSigner.overrideSecret = 'unit-test-secret';

        Test.setMock(HttpCalloutMock.class, new MockEngine(true));
        Test.startTest();
        List<AgentRunner.AgentOutput> outs = AgentRunner.run(new List<AgentRunner.AgentInput>{ inp });
        Test.stopTest();

        System.assertEquals(1, outs.size());
        System.assertEquals(true, outs[0].success);
        System.assertEquals(72, outs[0].agentScore);
    }

    @IsTest
    static void run_creates_execution_log() {
        AgentRunner.AgentInput inp = new AgentRunner.AgentInput();
        inp.agentApiName = 'runner_agent';
        inp.recordId = '00Q000000000000';
        JwtSigner.overrideSecret = 'unit-test-secret';

        Test.setMock(HttpCalloutMock.class, new MockEngine(true));
        Test.startTest();
        AgentRunner.run(new List<AgentRunner.AgentInput>{ inp });
        Test.stopTest();

        Integer logs = [SELECT COUNT() FROM AgentExecution__c WHERE CorrelationId__c = 'corr-runner'];
        System.assertEquals(1, logs);
    }
}
