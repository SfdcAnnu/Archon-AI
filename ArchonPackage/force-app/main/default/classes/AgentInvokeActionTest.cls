/**
 * Coverage for AgentInvokeAction's Flow-facing contract: never throws past
 * the invocable boundary, resolves agents by Id or API name, validates
 * inputs, and returns structured error Results instead of exceptions.
 * Happy-path callouts (real chat turn / orchestrator run) need a live Node
 * server and are covered by the browser/Apex smoke tests, not unit tests.
 */
@IsTest
private class AgentInvokeActionTest {

    @IsTest
    static void emptyAndNullInputsReturnCleanly() {
        System.assertEquals(0, AgentInvokeAction.run(null).size(), 'null request list');
        System.assertEquals(0, AgentInvokeAction.run(new List<AgentInvokeAction.Request>()).size(), 'empty request list');

        AgentInvokeAction.Request blank = new AgentInvokeAction.Request();
        List<AgentInvokeAction.Result> results = AgentInvokeAction.run(new List<AgentInvokeAction.Request>{ blank });
        System.assertEquals(1, results.size());
        System.assertEquals(false, results[0].success);
        System.assert(String.isNotBlank(results[0].errorMessage), 'blank agent should explain itself');
    }

    @IsTest
    static void unknownAgentReturnsErrorResult() {
        AgentInvokeAction.Request req = new AgentInvokeAction.Request();
        req.agent = 'no_such_agent_api_name';
        req.userQuery = 'Hello?';

        List<AgentInvokeAction.Result> results = AgentInvokeAction.run(new List<AgentInvokeAction.Request>{ req });
        System.assertEquals(false, results[0].success);
        System.assert(results[0].errorMessage.contains('no_such_agent_api_name'));
    }

    @IsTest
    static void inactiveAgentIsRejectedWithoutThrowing() {
        AgentDefinition__c agent = new AgentDefinition__c(
            Name = 'Invoke Test Agent',
            ApiName__c = 'invoke_test_agent',
            Department__c = 'Test',
            Status__c = 'Inactive',
            ExecuteType__c = 'Chat'
        );
        insert agent;

        AgentInvokeAction.Request req = new AgentInvokeAction.Request();
        req.agent = 'invoke_test_agent';
        req.userQuery = 'Hello?';

        List<AgentInvokeAction.Result> results = AgentInvokeAction.run(new List<AgentInvokeAction.Request>{ req });
        System.assertEquals(false, results[0].success);
        System.assert(results[0].errorMessage.containsIgnoreCase('inactive'));
    }

    @IsTest
    static void triggerTypeWithoutRecordIdIsRejected() {
        AgentDefinition__c agent = new AgentDefinition__c(
            Name = 'Invoke Test Automation',
            ApiName__c = 'invoke_test_automation',
            Department__c = 'Test',
            Status__c = 'Active',
            ExecuteType__c = 'Trigger'
        );
        insert agent;

        AgentInvokeAction.Request req = new AgentInvokeAction.Request();
        req.agent = agent.Id; // resolve-by-record-Id path
        req.userQuery = 'Score this.';

        List<AgentInvokeAction.Result> results = AgentInvokeAction.run(new List<AgentInvokeAction.Request>{ req });
        System.assertEquals(false, results[0].success);
        System.assert(results[0].errorMessage.contains('Record ID'), 'trigger mode requires a record');
    }

    @IsTest
    static void chatPathWithoutServerReturnsErrorResultNotException() {
        AgentDefinition__c agent = new AgentDefinition__c(
            Name = 'Invoke Test Chat',
            ApiName__c = 'invoke_test_chat',
            Department__c = 'Test',
            Status__c = 'Active',
            ExecuteType__c = 'Chat'
        );
        insert agent;

        AgentInvokeAction.Request req = new AgentInvokeAction.Request();
        req.agent = 'invoke_test_chat';
        req.userQuery = 'Hello?';
        req.referenceData = '{"loanId":"L-123"}';
        req.outputFormat = 'One short sentence.';

        Test.startTest();
        List<AgentInvokeAction.Result> results = AgentInvokeAction.run(new List<AgentInvokeAction.Request>{ req });
        Test.stopTest();

        // No callout mock is set, so the turn fails somewhere past validation —
        // the contract under test is that the failure comes back as a Result,
        // never as an exception through the Flow boundary.
        System.assertEquals(1, results.size());
        System.assertEquals(false, results[0].success);
        System.assert(String.isNotBlank(results[0].errorMessage));
    }
}
