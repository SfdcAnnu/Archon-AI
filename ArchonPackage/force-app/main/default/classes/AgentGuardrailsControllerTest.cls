@IsTest
private class AgentGuardrailsControllerTest {

    @IsTest
    static void getGuardrails_defaults_to_disabled_with_zero_usage() {
        Test.startTest();
        AgentGuardrailsController.GuardrailsStatus s = AgentGuardrailsController.getGuardrails();
        Test.stopTest();
        System.assertEquals(false, s.isEnabled);
        System.assertEquals(null, s.maxTokensPerDay);
        System.assertEquals(0, s.tokensUsedToday);
        System.assertEquals(0, s.tokensUsedThisMonth);
    }

    @IsTest
    static void saveGuardrails_persists_caps_and_enabled_flag() {
        Test.startTest();
        AgentGuardrailsController.GuardrailsStatus s = AgentGuardrailsController.saveGuardrails(true, 50000, 1000000);
        Test.stopTest();
        System.assertEquals(true, s.isEnabled);
        System.assertEquals(50000, s.maxTokensPerDay);
        System.assertEquals(1000000, s.maxTokensPerMonth);
    }

    @IsTest
    static void enforceBeforeTurn_does_nothing_when_disabled() {
        Test.startTest();
        // Default state is disabled — must not throw.
        AgentGuardrailsController.enforceBeforeTurn();
        Test.stopTest();
        // No exception = success
    }

    @IsTest
    static void enforceBeforeTurn_throws_once_daily_cap_is_already_used() {
        AgentGuardrailsController.saveGuardrails(true, 100, null);

        AgentDefinition__c agent = new AgentDefinition__c(
            Name = 'Guardrail Test Agent', ApiName__c = 'guardrail_test_agent',
            Department__c = 'Sales', Status__c = 'Active', ExecuteType__c = 'Chat'
        );
        insert agent;
        ChatSession__c session = new ChatSession__c(
            AgentDefinition__c = agent.Id, User__c = UserInfo.getUserId(),
            Status__c = 'Active', LastActivityAt__c = System.now(),
            ExpiresAt__c = System.now().addHours(1), TotalTurns__c = 1
        );
        insert session;
        insert new ChatMessage__c(
            ChatSession__c = session.Id, Role__c = 'Assistant', Content__c = 'hi',
            SequenceNumber__c = 1, ApprovalStatus__c = 'NotRequired',
            TokensIn__c = 80, TokensOut__c = 40
        );

        Test.startTest();
        Boolean threw = false;
        try {
            AgentGuardrailsController.enforceBeforeTurn();
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();
        System.assertEquals(true, threw);
    }
}
