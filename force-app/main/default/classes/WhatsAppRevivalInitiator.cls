/**
 * WhatsAppRevivalInitiator — the proactive counterpart to WhatsAppAgentBridge.
 * Fires when an Opportunity is marked Closed Lost, and sends the approved
 * WhatsApp revival template to restart contact with the customer. Once they
 * reply, the existing incoming-message Flow/WhatsAppAgentBridge picks up
 * normally.
 *
 * Only fires when WE are the ones initiating — if the customer already has
 * an active conversation with the revival agent on this deal (they reached
 * out on their own), sending the generic template on top of that would be
 * redundant/wrong, so this checks for an existing active ChatSession__c
 * first and skips quietly if one exists.
 */
public with sharing class WhatsAppRevivalInitiator {

    private static final String TEMPLATE_NAME = 'opp_revival • English (US)';
    private static final String CHAT_AGENT_API_NAME = 'whatsapp_lost_opportunity_revival';

    @InvocableMethod(
        label='Initiate WhatsApp Revival Outreach'
        description='When an Opportunity is marked Closed Lost, proactively sends the approved WhatsApp template to restart contact — unless the customer already has an active conversation going.'
        category='Agent Builder'
    )
    public static void handle(List<Id> opportunityIds) {
        if (opportunityIds == null || opportunityIds.isEmpty()) return;
        System.enqueueJob(new RevivalQueueable(opportunityIds));
    }

    public class RevivalQueueable implements Queueable, Database.AllowsCallouts {
        private final List<Id> opportunityIds;
        public RevivalQueueable(List<Id> opportunityIds) { this.opportunityIds = opportunityIds; }
        public void execute(QueueableContext qc) {
            for (Id oppId : opportunityIds) processOne(oppId);
        }
    }

    private static void processOne(Id opportunityId) {
        Opportunity opp;
        try {
            opp = [
                SELECT Id, ContactId, OwnerId
                FROM Opportunity
                WHERE Id = :opportunityId
                WITH USER_MODE
                LIMIT 1
            ];
        } catch (Exception e) {
            logError('load opportunity', opportunityId, e);
            return;
        }

        if (opp.ContactId == null) {
            logError('no contact on this opportunity, skipping proactive outreach', opportunityId, null);
            return;
        }

        if (hasActiveConversation(opportunityId, opp.ContactId)) {
            // Customer already has an ongoing conversation with the revival agent
            // on this deal (they reached out first, or a prior outreach is still
            // active) — don't also fire the generic "let's reconnect" template.
            logError('active conversation already exists, skipping proactive outreach', opportunityId, null);
            return;
        }

        Contact ct;
        try {
            ct = [SELECT Id, Phone, MobilePhone FROM Contact WHERE Id = :opp.ContactId WITH USER_MODE LIMIT 1];
        } catch (Exception e) {
            logError('load contact', opportunityId, e);
            return;
        }
        String phone = String.isNotBlank(ct.MobilePhone) ? ct.MobilePhone : ct.Phone;
        if (String.isBlank(phone)) {
            logError('no phone number available on contact, skipping proactive outreach', opportunityId, null);
            return;
        }

        tdc_tsw__Message_Template__c template;
        try {
            List<tdc_tsw__Message_Template__c> templates = [
                SELECT Id, Name, tdc_tsw__SMSBodyNew__c
                FROM tdc_tsw__Message_Template__c
                WHERE Name = :TEMPLATE_NAME AND tdc_tsw__Status__c = 'Active'
                WITH USER_MODE
                LIMIT 1
            ];
            if (!templates.isEmpty()) template = templates[0];
        } catch (Exception e) {
            logError('load WhatsApp template', opportunityId, e);
            return;
        }

        if (template == null) {
            logError('template "' + TEMPLATE_NAME + '" not found or not Active, skipping proactive outreach', opportunityId, null);
            return;
        }

        try {
            tdc_tsw.GlobalSMSSender.sendSmsWithPhoneNumberAndTemplateId(phone, template.Id, opportunityId);
        } catch (Exception e) {
            logError('template send failed', opportunityId, e);
            return; // don't log a chat message for a send that never went out
        }

        logSentTemplateAsFirstMessage(opportunityId, opp.OwnerId, template);
    }

    /**
     * Records the just-sent template as the conversation's opening message,
     * so the Conversations transcript shows what actually kicked things off
     * instead of appearing to start mid-conversation at the customer's
     * first reply. Best-effort and isolated from the send above — the SMS
     * already went out successfully by the time this runs, so a problem
     * here (e.g. this org's message-log shape differing) must never look
     * like the outreach itself failed.
     */
    @TestVisible
    private static void logSentTemplateAsFirstMessage(Id opportunityId, Id ownerId, tdc_tsw__Message_Template__c template) {
        try {
            // Prefer the actual resolved/sent text from 360 SMS App's own
            // outgoing message log (merge fields like {!Contact.Name}
            // already substituted) — fall back to the raw template body
            // (merge fields intact) if that log entry isn't found, e.g. if
            // this org's send path doesn't create one synchronously.
            String messageText = template.tdc_tsw__SMSBodyNew__c;
            try {
                List<tdc_tsw__Message__c> sent = [
                    SELECT Id, tdc_tsw__Message_Text_New__c
                    FROM tdc_tsw__Message__c
                    WHERE tdc_tsw__ContextId__c = :opportunityId
                      AND RecordType.DeveloperName = 'Outgoing'
                    WITH USER_MODE
                    ORDER BY CreatedDate DESC
                    LIMIT 1
                ];
                if (!sent.isEmpty() && String.isNotBlank(sent[0].tdc_tsw__Message_Text_New__c)) {
                    messageText = sent[0].tdc_tsw__Message_Text_New__c;
                }
            } catch (Exception e) {
                // Fall back to the raw template body queried above.
            }
            if (String.isBlank(messageText)) return;

            ChatSession__c session = AgentChatController.findOrCreateAutomatedSession(
                CHAT_AGENT_API_NAME, opportunityId, 'Opportunity', ownerId
            );
            insert new ChatMessage__c(
                ChatSession__c    = session.Id,
                Role__c           = 'Assistant',
                Content__c        = messageText,
                SequenceNumber__c = AgentChatController.nextSequenceNumber(session.Id),
                ApprovalStatus__c = 'NotRequired'
            );
            session.LastActivityAt__c = System.now();
            session.ExpiresAt__c      = System.now().addHours(AgentChatController.EXPIRY_HOURS);
            update session;
        } catch (Exception e) {
            logError('log sent template as first chat message', opportunityId, e);
        }
    }

    /** True if the revival agent already has an Active, unexpired session tied to this deal. */
    private static Boolean hasActiveConversation(Id opportunityId, Id contactId) {
        List<ChatSession__c> sessions = [
            SELECT Id
            FROM ChatSession__c
            WHERE AgentDefinition__r.ApiName__c = :CHAT_AGENT_API_NAME
              AND RecordContextId__c IN (:opportunityId, :contactId)
              AND Status__c = 'Active'
              AND ExpiresAt__c > :System.now()
            WITH USER_MODE
            LIMIT 1
        ];
        return !sessions.isEmpty();
    }

    private static void logError(String stage, Id opportunityId, Exception e) {
        System.debug(LoggingLevel.ERROR,
            'WhatsAppRevivalInitiator [' + stage + '] for opportunity ' + opportunityId +
            (e != null ? ': ' + e.getMessage() : ''));
    }
}
