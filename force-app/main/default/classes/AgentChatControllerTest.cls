@IsTest
private class AgentChatControllerTest {

    private class StubMock implements HttpCalloutMock {
        Integer code;
        String body;
        StubMock(Integer code, String body) { this.code = code; this.body = body; }
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(code);
            res.setBody(body);
            res.setHeader('Content-Type', 'application/json');
            return res;
        }
    }

    @TestSetup
    static void seed() {
        SynapseInstall__c row = new SynapseInstall__c(
            SetupOwnerId    = UserInfo.getOrganizationId(),
            SessionKey__c   = 'sk-test',
            ConfiguredAt__c = System.now()
        );
        insert row;

        AgentDefinition__c agent = new AgentDefinition__c(
            Name = 'Test Chat Agent',
            ApiName__c = 'TestChatAgent',
            Department__c = 'Sales',
            Status__c = 'Active',
            ExecuteType__c = 'Chat'
        );
        insert agent;
    }

    @IsTest
    static void listChatEnabledAgents_returns_chat_agents() {
        Test.startTest();
        List<AgentChatController.AgentSummary> agents = AgentChatController.listChatEnabledAgents(null);
        Test.stopTest();
        System.assert(agents.size() >= 1, 'Expected at least the seeded chat agent');
        Boolean found = false;
        for (AgentChatController.AgentSummary a : agents) {
            if (a.apiName == 'TestChatAgent') found = true;
        }
        System.assertEquals(true, found);
    }

    @IsTest
    static void listChatEnabledAgents_filter_narrows_results() {
        Test.startTest();
        List<AgentChatController.AgentSummary> agents = AgentChatController.listChatEnabledAgents('XYZ_no_match');
        Test.stopTest();
        System.assertEquals(0, agents.size());
    }

    @IsTest
    static void startSession_creates_new_session() {
        Test.startTest();
        AgentChatController.SessionWithMessages r = AgentChatController.startSession('TestChatAgent', null, null);
        Test.stopTest();
        System.assertNotEquals(null, r.session);
        System.assertEquals('Active', r.session.Status__c);
        System.assertEquals(0, r.messages.size());
    }

    @IsTest
    static void startSession_reuses_existing_active_session() {
        AgentChatController.SessionWithMessages a = AgentChatController.startSession('TestChatAgent', null, null);
        Test.startTest();
        AgentChatController.SessionWithMessages b = AgentChatController.startSession('TestChatAgent', null, null);
        Test.stopTest();
        System.assertEquals(a.session.Id, b.session.Id, 'Should reuse the existing active session');
    }

    @IsTest
    static void findOrCreateAutomatedSession_creates_session_anchored_to_given_user() {
        Id fakeOwnerId = UserInfo.getUserId();
        Test.startTest();
        ChatSession__c s = AgentChatController.findOrCreateAutomatedSession('TestChatAgent', '006000000000001AAA', 'Opportunity', fakeOwnerId);
        Test.stopTest();
        System.assertNotEquals(null, s.Id);
        System.assertEquals('Active', s.Status__c);
        System.assertEquals(fakeOwnerId, s.User__c);
        System.assertEquals('006000000000001AAA', s.RecordContextId__c);
    }

    @IsTest
    static void findOrCreateAutomatedSession_reuses_existing_session_regardless_of_anchor_user() {
        // Started under the running test user...
        ChatSession__c first = AgentChatController.findOrCreateAutomatedSession('TestChatAgent', '006000000000002AAA', 'Opportunity', UserInfo.getUserId());

        Test.startTest();
        // ...a second call passing a DIFFERENT (fake, non-matching) anchor
        // user must still find and reuse it — this is the whole point of
        // this method over startSession()'s User__c-scoped reuse, since the
        // two flows that call it (WhatsAppRevivalInitiator's proactive send,
        // WhatsAppAgentBridge's inbound reply) can run under different users.
        ChatSession__c second = AgentChatController.findOrCreateAutomatedSession('TestChatAgent', '006000000000002AAA', 'Opportunity', null);
        Test.stopTest();

        System.assertEquals(first.Id, second.Id, 'Must reuse the same session regardless of which anchor user is passed');
    }

    @IsTest
    static void sendTurn_complete_inserts_user_and_assistant_messages() {
        AgentChatController.SessionWithMessages sess = AgentChatController.startSession('TestChatAgent', null, null);

        String body = '{"status":"complete","assistantText":"Score is 78.","toolCalls":[],"modelUsed":"gpt-4o","tokensIn":120,"tokensOut":45}';
        Test.setMock(HttpCalloutMock.class, new StubMock(200, body));
        Test.startTest();
        AgentChatController.TurnResult r = AgentChatController.sendTurn(sess.session.Id, 'What is the score?', null);
        Test.stopTest();

        System.assertEquals('complete', r.status);
        // newMessages must include the user message so the LWC never loses the user's input
        Boolean sawUser = false;
        Boolean sawAssistant = false;
        for (ChatMessage__c m : r.newMessages) {
            if (m.Role__c == 'User') sawUser = true;
            if (m.Role__c == 'Assistant') sawAssistant = true;
        }
        System.assertEquals(true, sawUser, 'newMessages should contain the persisted user message');
        System.assertEquals(true, sawAssistant, 'newMessages should contain the assistant reply');

        Integer userMsgs = 0;
        Integer assistantMsgs = 0;
        for (ChatMessage__c m : [SELECT Role__c FROM ChatMessage__c WHERE ChatSession__c = :sess.session.Id]) {
            if (m.Role__c == 'User') userMsgs++;
            if (m.Role__c == 'Assistant') assistantMsgs++;
        }
        System.assertEquals(1, userMsgs);
        System.assertEquals(1, assistantMsgs);

        ChatSession__c updated = [SELECT TotalTurns__c, TokensIn__c, TokensOut__c, Title__c FROM ChatSession__c WHERE Id = :sess.session.Id];
        System.assertEquals(1, updated.TotalTurns__c);
        System.assertEquals(120, updated.TokensIn__c);
        System.assertEquals(45, updated.TokensOut__c);
        System.assert(updated.Title__c.startsWith('What is the score'), 'Title should auto-derive from first user message');
    }

    @IsTest
    static void sendTurn_server_error_still_persists_user_and_error_bubble() {
        // A chat-app must never lose the user's message. When the AI service returns 5xx,
        // Apex must still commit the user's message + a visible "⚠" assistant bubble.
        AgentChatController.SessionWithMessages sess = AgentChatController.startSession('TestChatAgent', null, null);

        String errBody = '{"error":"chat_turn_failed","message":"OpenAI API error 429"}';
        Test.setMock(HttpCalloutMock.class, new StubMock(500, errBody));
        Test.startTest();
        AgentChatController.TurnResult r = AgentChatController.sendTurn(sess.session.Id, 'Give me 5 opps', null);
        Test.stopTest();

        System.assertEquals('error', r.status);
        System.assertEquals(2, r.newMessages.size(), 'Expected user msg + error assistant bubble');

        Integer userMsgs = 0;
        Integer assistantMsgs = 0;
        Boolean sawWarning = false;
        for (ChatMessage__c m : [SELECT Role__c, Content__c FROM ChatMessage__c WHERE ChatSession__c = :sess.session.Id]) {
            if (m.Role__c == 'User') userMsgs++;
            if (m.Role__c == 'Assistant') {
                assistantMsgs++;
                if (m.Content__c != null && m.Content__c.startsWith('⚠')) sawWarning = true;
            }
        }
        System.assertEquals(1, userMsgs, 'User message must persist even on server error');
        System.assertEquals(1, assistantMsgs, 'Error assistant message must be created');
        System.assertEquals(true, sawWarning, 'Error bubble should be a visible ⚠-prefixed message');
    }

    @IsTest
    static void endSession_marks_ended() {
        AgentChatController.SessionWithMessages sess = AgentChatController.startSession('TestChatAgent', null, null);
        Test.startTest();
        AgentChatController.endSession(sess.session.Id);
        Test.stopTest();
        ChatSession__c after = [SELECT Status__c FROM ChatSession__c WHERE Id = :sess.session.Id];
        System.assertEquals('Ended', after.Status__c);
    }

    @IsTest
    static void listMySessions_returns_user_sessions() {
        AgentChatController.startSession('TestChatAgent', null, null);
        Test.startTest();
        List<AgentChatController.SessionSummary> mine = AgentChatController.listMySessions(50);
        Test.stopTest();
        System.assert(mine.size() >= 1);
    }

    @IsTest
    static void sendTurn_throws_when_message_too_long() {
        AgentChatController.SessionWithMessages sess = AgentChatController.startSession('TestChatAgent', null, null);
        String longMsg = '';
        for (Integer i = 0; i < 1100; i++) longMsg += '0123456789';
        Test.startTest();
        Boolean threw = false;
        try { AgentChatController.sendTurn(sess.session.Id, longMsg, null); }
        catch (Exception e) { threw = true; }
        Test.stopTest();
        System.assertEquals(true, threw);
    }
}
