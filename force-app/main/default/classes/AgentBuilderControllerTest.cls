@IsTest
private class AgentBuilderControllerTest {

    private static AgentDefinition__c createAgent(String apiName, String status) {
        AgentDefinition__c a = new AgentDefinition__c(
            Name           = 'Test Agent ' + apiName,
            ApiName__c     = apiName,
            Department__c  = 'Sales',
            Description__c = 'Unit test agent',
            Status__c      = status,
            KnowledgeBase__c = 'Test knowledge base content'
        );
        insert a;
        return a;
    }

    @IsTest
    static void getAgentDefinitions_returns_all_when_blank_department() {
        createAgent('agent_a', 'Active');
        createAgent('agent_b', 'Draft');

        Test.startTest();
        List<AgentDefinition__c> all = AgentBuilderController.getAgentDefinitions(null);
        Test.stopTest();

        System.assertEquals(2, all.size(), 'Should return both agents');
    }

    @IsTest
    static void getAgentDefinitions_filters_by_department() {
        createAgent('agent_sales', 'Active');
        AgentDefinition__c svc = new AgentDefinition__c(
            Name='Svc', ApiName__c='agent_svc', Department__c='Service', Status__c='Active'
        );
        insert svc;

        Test.startTest();
        List<AgentDefinition__c> only = AgentBuilderController.getAgentDefinitions('Service');
        Test.stopTest();

        System.assertEquals(1, only.size());
        System.assertEquals('Service', only[0].Department__c);
    }

    @IsTest
    static void getAgentWithNodes_returns_null_for_blank_id() {
        Test.startTest();
        AgentBuilderController.AgentWithNodes wrap = AgentBuilderController.getAgentWithNodes(null);
        Test.stopTest();
        System.assertEquals(null, wrap);
    }

    @IsTest
    static void getAgentWithNodes_returns_agent_and_nodes() {
        AgentDefinition__c a = createAgent('a1', 'Active');
        insert new AgentNode__c(
            Name='Trigger',
            AgentDefinition__c=a.Id,
            NodeType__c='trigger',
            NodeSubType__c='record',
            SortOrder__c=0
        );

        Test.startTest();
        AgentBuilderController.AgentWithNodes wrap = AgentBuilderController.getAgentWithNodes(a.Id);
        Test.stopTest();

        System.assertNotEquals(null, wrap);
        System.assertEquals(1, wrap.nodes.size());
    }

    @IsTest
    static void saveAgentWithNodes_creates_and_overwrites_nodes() {
        AgentBuilderController.AgentDefinitionInput agentInput = new AgentBuilderController.AgentDefinitionInput();
        agentInput.apiName    = 'new_agent';
        agentInput.label      = 'New Agent';
        agentInput.department = 'Sales';
        agentInput.status     = 'Draft';
        agentInput.canvasJson = '{"connections":[]}';

        AgentBuilderController.AgentNodeInput n1 = new AgentBuilderController.AgentNodeInput();
        n1.label = 'Trigger'; n1.nodeType = 'trigger'; n1.nodeSubType = 'record';
        n1.configJson = '{}'; n1.positionX = 10; n1.positionY = 10; n1.isEnabled = true;

        List<AgentBuilderController.AgentNodeInput> nodes = new List<AgentBuilderController.AgentNodeInput>{ n1 };

        Test.startTest();
        String savedId = AgentBuilderController.saveAgentWithNodes(
            JSON.serialize(agentInput),
            JSON.serialize(nodes)
        );
        Test.stopTest();

        System.assertNotEquals(null, savedId);
        List<AgentNode__c> kids = [SELECT Id FROM AgentNode__c WHERE AgentDefinition__c = :savedId];
        System.assertEquals(1, kids.size());
    }

    @IsTest
    static void getExecutionLogs_returns_paginated_results() {
        AgentDefinition__c a = createAgent('logged', 'Active');
        insert new AgentExecution__c(
            AgentDefinition__c = a.Id,
            CorrelationId__c   = 'corr-1',
            Status__c          = 'SUCCESS'
        );

        Test.startTest();
        AgentBuilderController.ExecutionPage page1 = AgentBuilderController.getExecutionLogs(a.Id, 20, 0, null);
        AgentBuilderController.ExecutionPage allLogs = AgentBuilderController.getExecutionLogs(null, 20, 0, null);
        AgentBuilderController.ExecutionPage byStatus = AgentBuilderController.getExecutionLogs(null, 20, 0, 'SUCCESS');
        AgentBuilderController.ExecutionPage noMatch = AgentBuilderController.getExecutionLogs(null, 20, 0, 'ERROR');
        Test.stopTest();

        System.assertEquals(1, page1.records.size());
        System.assert(allLogs.total >= 1);
        System.assert(byStatus.total >= 1);
        System.assertEquals(0, noMatch.total);
    }

    @IsTest
    static void getDepartmentStats_aggregates_by_department() {
        createAgent('agent_a', 'Active');
        createAgent('agent_b', 'Active');

        Test.startTest();
        List<AgentBuilderController.DeptStats> stats = AgentBuilderController.getDepartmentStats();
        Test.stopTest();

        System.assert(stats.size() >= 1);
    }

    @IsTest
    static void deleteAgent_and_updateAgentStatus() {
        AgentDefinition__c a = createAgent('to_modify', 'Draft');

        Test.startTest();
        AgentBuilderController.updateAgentStatus(a.Id, 'Active');
        AgentDefinition__c after = [SELECT Status__c FROM AgentDefinition__c WHERE Id = :a.Id];
        System.assertEquals('Active', after.Status__c);

        AgentBuilderController.deleteAgent(a.Id);
        Integer count = [SELECT COUNT() FROM AgentDefinition__c WHERE Id = :a.Id];
        System.assertEquals(0, count);
        Test.stopTest();
    }

    /** Mock HTTP for executeAgent callout. */
    private class MockEngine implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setBody('{"success":true,"correlationId":"corr-test","agentStatus":"SUCCESS","agentScore":85,"agentPriority":"Hot","agentReason":"Strong fit","agentOutputPayload":"{}","toolsUsed":"ai-models:claude"}');
            return res;
        }
    }

    @IsTest
    static void executeAgent_calls_engine_and_returns_result() {
        AgentDefinition__c a = createAgent('exec_agent', 'Active');
        insert new SynapseInstall__c(
            SetupOwnerId    = UserInfo.getOrganizationId(),
            SessionKey__c   = 'sk-test',
            ConfiguredAt__c = System.now()
        );

        Test.setMock(HttpCalloutMock.class, new MockEngine());
        Test.startTest();
        AgentBuilderController.ExecutionResult result =
            AgentBuilderController.executeAgent('exec_agent', a.Id, 'sync', '{}');
        Test.stopTest();

        System.assertEquals(true, result.success);
        System.assertEquals('SUCCESS', result.agentStatus);
        System.assertEquals(85, result.agentScore);
    }

    @IsTest
    static void executeAgent_allows_draft_agent_as_test_run() {
        AgentDefinition__c a = createAgent('exec_draft_agent', 'Draft');
        insert new SynapseInstall__c(
            SetupOwnerId    = UserInfo.getOrganizationId(),
            SessionKey__c   = 'sk-test',
            ConfiguredAt__c = System.now()
        );

        Test.setMock(HttpCalloutMock.class, new MockEngine());
        Test.startTest();
        AgentBuilderController.ExecutionResult result =
            AgentBuilderController.executeAgent('exec_draft_agent', a.Id, 'sync', '{}');
        Test.stopTest();

        System.assertEquals(true, result.success);
    }

    @IsTest
    static void executeAgent_blocks_inactive_agent() {
        AgentDefinition__c a = createAgent('exec_inactive_agent', 'Inactive');
        insert new SynapseInstall__c(
            SetupOwnerId    = UserInfo.getOrganizationId(),
            SessionKey__c   = 'sk-test',
            ConfiguredAt__c = System.now()
        );

        Test.setMock(HttpCalloutMock.class, new MockEngine());
        Test.startTest();
        Boolean threw = false;
        try {
            AgentBuilderController.executeAgent('exec_inactive_agent', a.Id, 'sync', '{}');
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();

        System.assertEquals(true, threw);
    }
}
