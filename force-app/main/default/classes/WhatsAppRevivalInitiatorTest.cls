/**
 * Coverage for the parts that don't require a real WhatsApp template or a
 * live send — this org has zero active WhatsApp templates today, so the
 * real contract under test is "never fail silently, never throw past the
 * invocable boundary," same discipline as WhatsAppAgentBridgeTest.
 */
@IsTest
private class WhatsAppRevivalInitiatorTest {

    @IsTest
    static void handleWithEmptyListDoesNothing() {
        Test.startTest();
        WhatsAppRevivalInitiator.handle(new List<Id>());
        WhatsAppRevivalInitiator.handle(null);
        Test.stopTest();
    }

    @IsTest
    static void logSentTemplateAsFirstMessageNeverThrowsWhenAgentMissing() {
        // Deliberately no AgentDefinition__c with ApiName__c
        // 'whatsapp_lost_opportunity_revival' in this isolated test context
        // (that value is a real, unique-constrained record in the actual
        // org — inserting a second one here would collide with it even
        // under test isolation, since unique constraints aren't relaxed by
        // SeeAllData rules). This exercises the same "never throw past this
        // boundary" contract as the rest of this class: the SMS already
        // sent successfully by the time this runs, so a lookup failure here
        // must degrade quietly, not blow up the caller.
        Account acct = new Account(Name = 'Revival Log Test Account');
        insert acct;
        Contact ct = new Contact(LastName = 'Revival Log Test Contact', AccountId = acct.Id, MobilePhone = '15550002345');
        insert ct;
        Opportunity opp = new Opportunity(
            Name = 'Revival Log Test Opp', AccountId = acct.Id, ContactId = ct.Id,
            StageName = 'Closed Lost', CloseDate = Date.today(), Loss_Reason__c = 'Price'
        );
        insert opp;

        tdc_tsw__Message_Template__c template = new tdc_tsw__Message_Template__c(
            Name = 'opp_revival • English (US)',
            tdc_tsw__SMSBodyNew__c = 'Hi {!Contact.Name}, following up on our conversation.'
        );

        Test.startTest();
        WhatsAppRevivalInitiator.logSentTemplateAsFirstMessage(opp.Id, ct.Id, UserInfo.getUserId(), template);
        Test.stopTest();

        // No ChatSession__c should have been created — the agent lookup
        // failed and was swallowed, exactly as designed.
        List<ChatSession__c> sessions = [SELECT Id FROM ChatSession__c WHERE RecordContextId__c = :opp.Id];
        System.assertEquals(0, sessions.size());
    }

    @IsTest
    static void handleWithNoTemplateNoOpsGracefully() {
        Account acct = new Account(Name = 'Revival Test Account');
        insert acct;
        Contact ct = new Contact(LastName = 'Revival Test Contact', AccountId = acct.Id, MobilePhone = '15550001234');
        insert ct;
        Opportunity opp = new Opportunity(
            Name = 'Revival Test Opp', AccountId = acct.Id, ContactId = ct.Id,
            StageName = 'Closed Lost', CloseDate = Date.today(), Loss_Reason__c = 'Price'
        );
        insert opp;

        Test.startTest();
        WhatsAppRevivalInitiator.handle(new List<Id>{ opp.Id });
        Test.stopTest();
        // No active WhatsApp template exists in a fresh test context — this
        // exercises the "skip quietly" branch. No assertion beyond "didn't throw."
        System.assert(true);
    }
}
