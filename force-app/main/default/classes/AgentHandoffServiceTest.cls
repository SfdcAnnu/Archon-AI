@IsTest
private class AgentHandoffServiceTest {

    @TestSetup
    static void seed() {
        insert new ArchonInstall__c(
            SetupOwnerId    = UserInfo.getOrganizationId(),
            SessionKey__c   = 'sk-test',
            ConfiguredAt__c = System.now()
        );
        AgentDefinition__c agent = new AgentDefinition__c(
            Name = 'Handoff Test Agent',
            ApiName__c = 'HandoffTestAgent',
            Department__c = 'Sales',
            Status__c = 'Active',
            ExecuteType__c = 'Chat'
        );
        insert agent;
        insert new ChatSession__c(
            AgentDefinition__c = agent.Id,
            User__c = UserInfo.getUserId(),
            Status__c = 'Active',
            Channel__c = 'whatsapp',
            SenderPhone__c = '+919876543210',
            LastActivityAt__c = System.now(),
            ExpiresAt__c = System.now().addHours(24),
            TotalTurns__c = 1
        );
    }

    private static ChatSession__c session() {
        return [SELECT Id, Status__c, OwnerId FROM ChatSession__c LIMIT 1];
    }

    /** What the server's tool writes: the handoff state, as one update. */
    private static void handOff(Id sessionId) {
        ChatSession__c off = new ChatSession__c(Id = sessionId);
        off.Status__c = 'Handed off';
        off.HandoffReason__c = 'asked for a person';
        off.HandedOffAt__c = System.now();
        off.HandoffReturnHours__c = 6;
        off.HandoffReturnAt__c = System.now().addHours(6);
        off.HandoffAssigneeType__c = 'user';
        off.HandoffAssigneeId__c = UserInfo.getUserId();
        off.HandoffAssigneeLabel__c = 'Rahul Mehta';
        off.HandoffPreviousOwner__c = String.valueOf(UserInfo.getUserId());
        off.HandoffNotify__c = 'notification,email';
        off.HandoffReturnLine__c = 'You are back with our assistant.';
        update off;
    }

    @IsTest
    static void handing_off_writes_the_transcript_line_and_the_status_reads_true() {
        ChatSession__c s = session();
        Test.startTest();
        handOff(s.Id);
        Test.stopTest();
        List<ChatMessage__c> rows = [SELECT Role__c, Content__c, ToolCallsJson__c FROM ChatMessage__c WHERE ChatSession__c = :s.Id ORDER BY SequenceNumber__c];
        System.assertEquals(1, rows.size(), 'one System line for the handoff');
        System.assertEquals('System', rows[0].Role__c);
        System.assert(rows[0].Content__c.startsWith('Handed off to Rahul Mehta'), rows[0].Content__c);
        System.assert(rows[0].ToolCallsJson__c.contains('"kind":"handoff"'));
        Map<String, Object> st = AgentHandoffService.status(s.Id);
        System.assertEquals(true, st.get('handedOff'));
        System.assertEquals('Rahul Mehta', st.get('assignee'));
        System.assertEquals(true, st.get('canReply'));
        System.assertEquals(6, st.get('quietHours'));
    }

    @IsTest
    static void returning_writes_the_return_line_with_the_note_and_clears_the_clock() {
        ChatSession__c s = session();
        handOff(s.Id);
        Test.startTest();
        AgentHandoffService.returnToAgent(s.Id, 'pricing clarified', UserInfo.getUserId());
        Test.stopTest();
        ChatSession__c after = [SELECT Status__c, HandoffReturnAt__c, HandoffReturnNote__c FROM ChatSession__c WHERE Id = :s.Id];
        System.assertEquals('Active', after.Status__c);
        System.assertEquals(null, after.HandoffReturnAt__c);
        System.assertEquals('pricing clarified', after.HandoffReturnNote__c);
        List<ChatMessage__c> rows = [SELECT Role__c, Content__c FROM ChatMessage__c WHERE ChatSession__c = :s.Id ORDER BY SequenceNumber__c];
        System.assertEquals(2, rows.size());
        System.assert(rows[1].Content__c.startsWith('Returned to the agent by '), rows[1].Content__c);
        System.assert(rows[1].Content__c.contains('pricing clarified'));
        // A second return is refused: the conversation is already with the agent.
        try { AgentHandoffService.returnToAgent(s.Id, null, null); System.assert(false, 'expected a refusal'); }
        catch (AgentHandoffService.HandoffException e) { System.assert(e.getMessage().contains('not handed off')); }
    }

    @IsTest
    static void a_person_replies_as_themselves_and_slash_agent_hands_back() {
        ChatSession__c s = session();
        handOff(s.Id);
        Test.startTest();
        ChatMessage__c m = AgentHandoffService.replyAsHuman(s.Id, 'Hi, Rahul here.');
        System.assertNotEquals(null, m);
        System.assertEquals('Human', [SELECT Role__c FROM ChatMessage__c WHERE Id = :m.Id].Role__c);
        System.assertEquals(UserInfo.getUserId(), [SELECT AuthorUser__c FROM ChatMessage__c WHERE Id = :m.Id].AuthorUser__c);
        ChatMessage__c none = AgentHandoffService.replyAsHuman(s.Id, '/agent');
        Test.stopTest();
        System.assertEquals(null, none);
        System.assertEquals('Active', [SELECT Status__c FROM ChatSession__c WHERE Id = :s.Id].Status__c);
    }

    @IsTest
    static void the_customer_writing_restarts_the_quiet_clock_and_keeps_the_words() {
        ChatSession__c s = session();
        handOff(s.Id);
        DateTime before = [SELECT HandoffReturnAt__c FROM ChatSession__c WHERE Id = :s.Id].HandoffReturnAt__c;
        Test.startTest();
        AgentHandoffService.recordCustomerMessage(s.Id, 'is anyone there?');
        Test.stopTest();
        ChatSession__c after = [SELECT HandoffReturnAt__c, Status__c FROM ChatSession__c WHERE Id = :s.Id];
        System.assertEquals('Handed off', after.Status__c, 'no agent turn, still with the person');
        System.assert(after.HandoffReturnAt__c >= before, 'the quiet clock restarted');
        System.assertEquals(1, [SELECT COUNT() FROM ChatMessage__c WHERE ChatSession__c = :s.Id AND Role__c = 'User']);
    }

    @IsTest
    static void overdue_conversations_come_back_on_the_sweep() {
        ChatSession__c s = session();
        handOff(s.Id);
        update new ChatSession__c(Id = s.Id, HandoffReturnAt__c = System.now().addMinutes(-1));
        Test.startTest();
        Integer n = AgentHandoffService.returnOverdue();
        Test.stopTest();
        System.assertEquals(1, n);
        System.assertEquals('Active', [SELECT Status__c FROM ChatSession__c WHERE Id = :s.Id].Status__c);
        List<ChatMessage__c> rows = [SELECT Content__c FROM ChatMessage__c WHERE ChatSession__c = :s.Id ORDER BY SequenceNumber__c];
        System.assert(rows[rows.size() - 1].Content__c.contains('after the quiet period'), rows[rows.size() - 1].Content__c);
    }

    @IsTest
    static void the_pickers_answer_without_omni_channel() {
        Test.startTest();
        List<Map<String, Object>> queues = AgentHandoffService.listQueues();
        List<Map<String, Object>> groups = AgentHandoffService.listGroups();
        Test.stopTest();
        System.assertNotEquals(null, queues);
        System.assertNotEquals(null, groups);
    }
}
