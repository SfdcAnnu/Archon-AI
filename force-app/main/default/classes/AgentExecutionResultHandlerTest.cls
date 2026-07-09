@IsTest
private class AgentExecutionResultHandlerTest {

    @IsTest
    static void event_upserts_execution_log() {
        AgentDefinition__c agent = new AgentDefinition__c(
            Name='Result Agent', ApiName__c='result_agent', Department__c='Sales', Status__c='Active'
        );
        insert agent;

        AgentExecutionResult__e ev = new AgentExecutionResult__e(
            AgentApiName__c  = 'result_agent',
            CorrelationId__c = 'corr-ev-1',
            RecordId__c      = '00Q000000000000',
            Status__c        = 'SUCCESS',
            AgentScore__c    = 91,
            AgentPriority__c = 'Hot',
            AgentReason__c   = 'High intent',
            ToolsUsed__c     = 'ai-models:claude-opus-4-7',
            OutputPayload__c = '{}',
            ExecutionMs__c   = 1234
        );

        Test.startTest();
        Database.SaveResult sr = EventBus.publish(ev);
        Test.stopTest();

        System.assert(sr.isSuccess());

        List<AgentExecution__c> logs = [
            SELECT Id, Status__c, AgentScore__c
            FROM AgentExecution__c WHERE CorrelationId__c = 'corr-ev-1'
        ];
        System.assertEquals(1, logs.size());
        System.assertEquals('SUCCESS', logs[0].Status__c);
        System.assertEquals(91, logs[0].AgentScore__c);
    }
}
