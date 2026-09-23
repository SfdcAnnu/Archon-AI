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
    static void findOrCreateAutomatedSession_keys_by_sender_phone_and_fills_the_anchor_later() {
        // A stranger writes in: no record yet, only a phone.
        ChatSession__c first = AgentChatController.findOrCreateAutomatedSession('TestChatAgent', null, null, null, '+919999900001', 'whatsapp');
        System.assertEquals('+919999900001', first.SenderPhone__c);
        System.assertEquals('whatsapp', first.Channel__c);
        System.assertEquals(null, first.RecordContextId__c);

        Test.startTest();
        // Their next message arrives linked to the Lead the SMS package created.
        ChatSession__c second = AgentChatController.findOrCreateAutomatedSession('TestChatAgent', '00Q000000000001AAA', 'Lead', null, '+919999900001', 'whatsapp');
        Test.stopTest();

        System.assertEquals(first.Id, second.Id, 'Same phone, same conversation');
        System.assertEquals('00Q000000000001AAA', second.RecordContextId__c, 'The anchor is filled in once known');
        ChatSession__c stored = [SELECT RecordContextId__c, RecordContextType__c FROM ChatSession__c WHERE Id = :first.Id];
        System.assertEquals('00Q000000000001AAA', stored.RecordContextId__c);
        System.assertEquals('Lead', stored.RecordContextType__c);
    }

    @IsTest
    static void findOrCreateAutomatedSession_two_strangers_never_share_a_session() {
        ChatSession__c a = AgentChatController.findOrCreateAutomatedSession('TestChatAgent', null, null, null, '+919999900002', 'whatsapp');
        Test.startTest();
        ChatSession__c b = AgentChatController.findOrCreateAutomatedSession('TestChatAgent', null, null, null, '+919999900003', 'whatsapp');
        Test.stopTest();
        System.assertNotEquals(a.Id, b.Id, 'A blank record anchor must never match another stranger');
    }

    @IsTest
    static void findOrCreateAutomatedSession_reply_finds_the_outreach_session_by_record_and_takes_the_phone() {
        // Proactive outreach opened the session on the record, without a phone...
        ChatSession__c outreach = AgentChatController.findOrCreateAutomatedSession('TestChatAgent', '006000000000003AAA', 'Opportunity', null);
        Test.startTest();
        // ...and the customer's reply, keyed by phone, must still land in it.
        ChatSession__c reply = AgentChatController.findOrCreateAutomatedSession('TestChatAgent', '006000000000003AAA', 'Opportunity', null, '+919999900004', 'whatsapp');
        Test.stopTest();
        System.assertEquals(outreach.Id, reply.Id, 'The reply lands in the outreach session');
        System.assertEquals('+919999900004', [SELECT SenderPhone__c FROM ChatSession__c WHERE Id = :outreach.Id].SenderPhone__c);
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
        AgentChatController.SessionWithMessages sess = AgentChatController.startSession('TestChatAgent', null, null);
        insert new ChatMessage__c(
            ChatSession__c = sess.session.Id, Role__c = 'User',
            Content__c = 'hello', SequenceNumber__c = 1
        );
        Test.startTest();
        List<AgentChatController.SessionSummary> mine = AgentChatController.listMySessions(50);
        Test.stopTest();
        System.assert(mine.size() >= 1, 'a session with messages must be listed');
    }

    // ── Empty test-chat sessions ─────────────────────────────────────
    // Opening the chat has to create a session (the turn endpoint and the
    // websocket are keyed on its id), so testing an agent and closing
    // without typing used to leave an empty conversation behind.

    @IsTest
    static void listMySessions_hides_sessions_with_no_messages() {
        AgentChatController.startSession('TestChatAgent', null, null);
        Test.startTest();
        List<AgentChatController.SessionSummary> mine = AgentChatController.listMySessions(50);
        Test.stopTest();
        System.assertEquals(0, mine.size(), 'a session nobody spoke in is not a conversation');
    }

    @IsTest
    static void discardSessionIfEmpty_removes_an_unused_session() {
        AgentChatController.SessionWithMessages sess = AgentChatController.startSession('TestChatAgent', null, null);
        Id sessionId = sess.session.Id;
        Test.startTest();
        Boolean discarded = AgentChatController.discardSessionIfEmpty(sessionId);
        Test.stopTest();
        System.assertEquals(true, discarded);
        System.assertEquals(0, [SELECT COUNT() FROM ChatSession__c WHERE Id = :sessionId]);
    }

    @IsTest
    static void discardSessionIfEmpty_keeps_a_session_that_has_messages() {
        AgentChatController.SessionWithMessages sess = AgentChatController.startSession('TestChatAgent', null, null);
        Id sessionId = sess.session.Id;
        insert new ChatMessage__c(
            ChatSession__c = sessionId, Role__c = 'User',
            Content__c = 'real conversation', SequenceNumber__c = 1
        );
        Test.startTest();
        Boolean discarded = AgentChatController.discardSessionIfEmpty(sessionId);
        Test.stopTest();
        System.assertEquals(false, discarded, 'anything with content must survive');
        System.assertEquals(1, [SELECT COUNT() FROM ChatSession__c WHERE Id = :sessionId]);
    }

    @IsTest
    static void discardSessionIfEmpty_ignores_blank_and_unknown_ids() {
        Test.startTest();
        System.assertEquals(false, AgentChatController.discardSessionIfEmpty(null));
        System.assertEquals(false, AgentChatController.discardSessionIfEmpty(''));
        Test.stopTest();
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

    // ── Per-model usage accounting ───────────────────────────────────
    // A turn can span the router's model, a specialist's, and utility
    // passes. These cover the arithmetic that keeps those attributed
    // separately instead of collapsed onto one ModelUsed__c.

    private static List<Object> usageOf(String model, Integer calls, Integer tIn, Integer tOut, Integer cached) {
        return new List<Object>{ new Map<String, Object>{
            'model' => model, 'calls' => calls,
            'tokensIn' => tIn, 'tokensOut' => tOut, 'cacheRead' => cached
        } };
    }

    // Not named `json` — Apex identifiers are case-insensitive, so that
    // would shadow the System.JSON class on the next line.
    private static Map<String, Map<String, Object>> indexByModel(String raw) {
        Map<String, Map<String, Object>> out = new Map<String, Map<String, Object>>();
        for (Object o : (List<Object>) JSON.deserializeUntyped(raw)) {
            Map<String, Object> row = (Map<String, Object>) o;
            out.put(String.valueOf(row.get('model')), row);
        }
        return out;
    }

    @IsTest
    static void mergeUsage_accumulates_same_model_across_turns() {
        String after1 = AgentChatController.mergeUsageByModel(null, usageOf('gpt-5.5', 2, 1000, 100, 40));
        String after2 = AgentChatController.mergeUsageByModel(after1, usageOf('gpt-5.5', 1, 500, 50, 10));
        Map<String, Object> row = indexByModel(after2).get('gpt-5.5');
        System.assertEquals(3,    Integer.valueOf(row.get('calls')),     'calls should accumulate');
        System.assertEquals(1500, Integer.valueOf(row.get('tokensIn')),  'tokensIn should accumulate');
        System.assertEquals(150,  Integer.valueOf(row.get('tokensOut')), 'tokensOut should accumulate');
        System.assertEquals(50,   Integer.valueOf(row.get('cacheRead')), 'cacheRead should accumulate');
    }

    @IsTest
    static void mergeUsage_keeps_models_separate() {
        String after1 = AgentChatController.mergeUsageByModel(null, usageOf('gpt-5.5', 1, 900, 90, 0));
        String after2 = AgentChatController.mergeUsageByModel(after1, usageOf('claude-haiku-4-5', 1, 300, 30, 0));
        Map<String, Map<String, Object>> byModel = indexByModel(after2);
        System.assertEquals(2, byModel.size(), 'each model keeps its own row');
        System.assertEquals(900, Integer.valueOf(byModel.get('gpt-5.5').get('tokensIn')));
        System.assertEquals(300, Integer.valueOf(byModel.get('claude-haiku-4-5').get('tokensIn')));
    }

    @IsTest
    static void mergeUsage_survives_a_corrupt_blob() {
        // Must never throw away the turn being recorded.
        String merged = AgentChatController.mergeUsageByModel('{not json at all', usageOf('gpt-5.5', 1, 10, 2, 0));
        System.assertEquals(10, Integer.valueOf(indexByModel(merged).get('gpt-5.5').get('tokensIn')));
    }

    @IsTest
    static void mergeUsage_buckets_a_missing_model_name() {
        List<Object> nameless = new List<Object>{ new Map<String, Object>{
            'calls' => 1, 'tokensIn' => 25, 'tokensOut' => 5, 'cacheRead' => 0
        } };
        String merged = AgentChatController.mergeUsageByModel(null, nameless);
        System.assertEquals(25, Integer.valueOf(indexByModel(merged).get('unknown').get('tokensIn')),
            'tokens with no model name must still be counted, not dropped');
    }

    @IsTest
    static void mergeUsage_null_usage_leaves_totals_untouched() {
        String before = AgentChatController.mergeUsageByModel(null, usageOf('gpt-5.5', 1, 100, 10, 0));
        // Nothing to fold in must not rewrite the stored value at all.
        System.assertEquals(before, AgentChatController.mergeUsageByModel(before, null));
        System.assertEquals(before, AgentChatController.mergeUsageByModel(before, new List<Object>()));
        // And the totals must survive regardless of how they are serialized.
        Map<String, Object> row = indexByModel(
            AgentChatController.mergeUsageByModel(before, null)
        ).get('gpt-5.5');
        System.assertEquals(100, Integer.valueOf(row.get('tokensIn')));
        System.assertEquals(10,  Integer.valueOf(row.get('tokensOut')));
    }

    @IsTest
    static void sumCachedTokens_adds_across_models() {
        List<Object> two = new List<Object>{
            new Map<String, Object>{ 'model' => 'a', 'cacheRead' => 120 },
            new Map<String, Object>{ 'model' => 'b', 'cacheRead' => 80 },
            new Map<String, Object>{ 'model' => 'c' }
        };
        System.assertEquals(200, AgentChatController.sumCachedTokens(two));
        System.assertEquals(0, AgentChatController.sumCachedTokens(null));
    }
}
