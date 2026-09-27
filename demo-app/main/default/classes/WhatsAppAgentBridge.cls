/**
 * WhatsAppAgentBridge — bridges an incoming 360 SMS App WhatsApp message
 * (tdc_tsw__Message__c, RecordType=Incoming) into Archon's existing chat
 * session mechanism (AgentChatController), and relays the AI's reply back
 * out over WhatsApp via 360 SMS App's own send API.
 *
 * Invoked from Record-Triggered Flows (After Save) on tdc_tsw__Message__c
 * — this class does no filtering of its own; each Flow's entry criteria
 * decide which messages reach here. ONE reusable invocable action for ANY
 * number of Flows: each Flow passes which agent handles its conversations
 * (agentApiName), so different incoming WhatsApp numbers route to
 * different agents — the Flow's ToNumber filter picks the audience, the
 * agentApiName input picks the brain.
 *
 * Three transaction boundaries, chained via Queueable, because Salesforce
 * forbids issuing a callout in a transaction that has uncommitted DML ahead
 * of it (each stage below either does DML-only or callout-then-DML, never
 * DML-then-callout):
 *   1. handle() (this transaction already has the triggering record-insert
 *      DML pending, so no callout is attempted here) — resolves/creates the
 *      ChatSession__c synchronously (AgentChatController.startSession is
 *      DML-only, no callout), then enqueues stage 2.
 *   2. WhatsAppAgentTurnQueueable — calls AgentChatController.sendTurn
 *      (callout, then its own internal DML) in a fresh transaction, then
 *      enqueues stage 3.
 *   3. WhatsAppAgentSendQueueable — calls GlobalSMSSender (callout) first,
 *      then creates a follow-up Task afterward if anything upstream failed.
 */
public with sharing class WhatsAppAgentBridge {

    // Backward-compat default only — Flows created before agentApiName was
    // an input (or leaving it blank) keep routing to the Revival agent.
    private static final String DEFAULT_AGENT_API_NAME = 'whatsapp_lost_opportunity_revival';
    private static final String FALLBACK_REPLY = 'Thanks for your message — a team member will follow up with you shortly.';

    public class Request {
        @InvocableVariable(
            label='Message ID'
            description='Id of the incoming tdc_tsw__Message__c record.'
            required=true
        )
        public Id messageId;

        @InvocableVariable(
            label='Agent API Name'
            description='ApiName__c of the chat agent that handles this conversation. Leave blank for the WhatsApp Revival agent.'
        )
        public String agentApiName;
    }

    @InvocableMethod(
        label='Handle Incoming WhatsApp Message'
        description='Continues (or starts) a stateful AI conversation for an incoming WhatsApp message with the given agent, and relays the reply back.'
        category='Agent Builder'
    )
    public static void handle(List<Request> requests) {
        if (requests == null || requests.isEmpty()) return;
        for (Request req : requests) {
            if (req == null || req.messageId == null) continue;
            String agentApiName = String.isNotBlank(req.agentApiName) ? req.agentApiName : DEFAULT_AGENT_API_NAME;
            startConversation(req.messageId, agentApiName);
        }
    }

    private static void startConversation(Id messageId, String agentApiName) {
        tdc_tsw__Message__c msg;
        try {
            msg = [
                SELECT Id, tdc_tsw__Message_Text_New__c, tdc_tsw__Sender_Number__c,
                       tdc_tsw__Opportunity__c, tdc_tsw__Lead__c, tdc_tsw__Contact__c
                FROM tdc_tsw__Message__c
                WHERE Id = :messageId
                WITH USER_MODE
                LIMIT 1
            ];
        } catch (Exception e) {
            logError('load message', messageId, e);
            return;
        }

        Id oppId = msg.tdc_tsw__Opportunity__c;
        Id leadId = msg.tdc_tsw__Lead__c;
        Id contactId = msg.tdc_tsw__Contact__c;

        // 360 SMS usually matches an inbound number to the CONTACT, not the
        // Opportunity — confirmed with real inbound data. A Contact-anchored
        // session can never line up with WhatsAppRevivalInitiator's
        // Opportunity-anchored one (template message + revival context live
        // there), so when no Opportunity came in directly, derive the
        // contact's most recent Closed Lost Opportunity and anchor to THAT.
        if (oppId == null && contactId != null) {
            try {
                // Deliberately NOT filtered to Closed Lost. That filter was
                // self-defeating: the moment the agent did its job and moved
                // a revived deal to Negotiation/Review, the customer's NEXT
                // message could no longer find it — the session fell back to
                // Contact-only, the record context went missing, and the
                // agent started hunting for a quote it had been discussing
                // minutes earlier (live-confirmed, CHAT-0158).
                //
                // Won deals are excluded because there is nothing left to
                // revive; everything else — still lost, or lost and now back
                // in play — is a conversation worth continuing. Most recently
                // touched wins, which is the deal actually being worked.
                List<OpportunityContactRole> roles = [
                    SELECT OpportunityId FROM OpportunityContactRole
                    WHERE ContactId = :contactId AND Opportunity.IsWon = false
                    WITH USER_MODE
                    ORDER BY Opportunity.LastModifiedDate DESC, Opportunity.CloseDate DESC
                    LIMIT 1
                ];
                if (!roles.isEmpty()) oppId = roles[0].OpportunityId;
            } catch (Exception e) {
                logError('derive opportunity from contact', messageId, e);
            }
        }

        String recordContextId = oppId != null ? oppId : (leadId != null ? leadId : contactId);
        String recordContextType = oppId != null ? 'Opportunity' : (leadId != null ? 'Lead' : (contactId != null ? 'Contact' : null));

        // findOrCreateAutomatedSession, NOT AgentChatController.startSession —
        // that reuse path is scoped by User__c (right for the interactive
        // chat widget), but this Flow's running user won't reliably match
        // whichever user context WhatsAppRevivalInitiator's proactive
        // outreach ran under. Matching on (agent, recordContextId) alone is
        // what lets a customer's reply land in the SAME session the
        // initiator already opened, instead of a disconnected duplicate.
        Id sessionId;
        try {
            Id ownerId = resolveOwnerId(recordContextType, recordContextId);
            // The sender's number keys the conversation and reaches the agent
            // as the phone it may use; the record anchor follows when known.
            ChatSession__c session = AgentChatController.findOrCreateAutomatedSession(
                agentApiName, recordContextId, recordContextType, ownerId,
                msg.tdc_tsw__Sender_Number__c, 'whatsapp'
            );
            sessionId = session.Id;
        } catch (Exception e) {
            logError('start session', messageId, e);
            sessionId = null; // WhatsAppAgentTurnQueueable falls back to the generic reply when null.
        }

        System.enqueueJob(new WhatsAppAgentTurnQueueable(
            messageId, sessionId, msg.tdc_tsw__Message_Text_New__c,
            msg.tdc_tsw__Sender_Number__c, recordContextId, oppId, leadId, contactId
        ));
    }

    public class WhatsAppAgentTurnQueueable implements Queueable, Database.AllowsCallouts {
        private final Id messageId;
        private final Id sessionId;
        private final String bodyText;
        private final String senderNumber;
        private final String recordContextId;
        private final Id oppId;
        private final Id leadId;
        private final Id contactId;

        public WhatsAppAgentTurnQueueable(Id messageId, Id sessionId, String bodyText, String senderNumber,
                                           String recordContextId, Id oppId, Id leadId, Id contactId) {
            this.messageId = messageId;
            this.sessionId = sessionId;
            this.bodyText = bodyText;
            this.senderNumber = senderNumber;
            this.recordContextId = recordContextId;
            this.oppId = oppId;
            this.leadId = leadId;
            this.contactId = contactId;
        }

        /**
         * The customer's message plus the record ids this conversation is
         * about. The session already anchors the agent to ONE record (the
         * Opportunity), which its prompt names — but the agent could not
         * see the Contact or the originating message, so it had no way to
         * pass them to a tool that needs them. Ids go BELOW the customer's
         * words and are labelled as system context, so the model never
         * mistakes them for something the customer said.
         */
        private String withRecordContext() {
            String text = String.isBlank(bodyText) ? '' : bodyText.trim();
            List<String> ids = new List<String>();
            if (contactId != null) ids.add('contactId: ' + contactId);
            if (leadId != null)    ids.add('leadId: ' + leadId);
            if (oppId != null)     ids.add('opportunityId: ' + oppId);
            if (messageId != null) ids.add('messageId: ' + messageId);
            if (ids.isEmpty()) return text;
            // Reference only. This used to read "use these ids for lookups
            // and actions", which arrived with every single message and read
            // as a standing instruction to go look things up — measured at
            // five identical tool calls per turn, each forcing another model
            // call over the full prompt. The anchored record's values now
            // reach the agent already loaded (chat/record-context.ts), so
            // these ids are here to be USED in a write, not to trigger a
            // fresh round of discovery.
            String header = '[RECORD IDS - reference, not from the customer. ' +
                'The record details are already provided to you; look something up only if it is not.]';
            return text + '\n\n' + header + '\n' + String.join(ids, '\n');
        }

        public void execute(QueueableContext qc) {
            String replyText;
            Boolean aiFailed = false;

            if (sessionId != null) {
                try {
                    AgentChatController.TurnResult tr =
                        AgentChatController.sendTurn(sessionId, withRecordContext(), null);
                    if (tr.status == 'complete' && tr.newMessages != null && !tr.newMessages.isEmpty()) {
                        replyText = tr.newMessages[tr.newMessages.size() - 1].Content__c;
                    }
                } catch (Exception e) {
                    logError('chat turn', messageId, e);
                }
            }

            if (String.isBlank(replyText)) {
                replyText = FALLBACK_REPLY;
                aiFailed = true;
            }

            WhatsAppAgentSendQueueable next = new WhatsAppAgentSendQueueable(
                messageId, senderNumber, replyText, recordContextId, oppId, leadId, contactId, aiFailed
            );
            // Chaining queueables is forbidden inside Apex tests ("Maximum
            // stack depth has been reached") — run the send stage inline
            // there; real transactions keep the async chain.
            if (Test.isRunningTest()) next.execute(null);
            else System.enqueueJob(next);
        }
    }

    public class WhatsAppAgentSendQueueable implements Queueable, Database.AllowsCallouts {
        private final Id messageId;
        private final String senderNumber;
        private final String replyText;
        private final String recordContextId;
        private final Id oppId;
        private final Id leadId;
        private final Id contactId;
        private final Boolean aiFailed;

        public WhatsAppAgentSendQueueable(Id messageId, String senderNumber, String replyText, String recordContextId,
                                           Id oppId, Id leadId, Id contactId, Boolean aiFailed) {
            this.messageId = messageId;
            this.senderNumber = senderNumber;
            this.replyText = replyText;
            this.recordContextId = recordContextId;
            this.oppId = oppId;
            this.leadId = leadId;
            this.contactId = contactId;
            this.aiFailed = aiFailed;
        }

        public void execute(QueueableContext qc) {
            // Callout first, DML (Task creation) after — Salesforce forbids the reverse order.
            Boolean sendFailed = false;
            if (String.isNotBlank(senderNumber)) {
                try {
                    // Related record for the OUTGOING reply = the person
                    // (Contact/Lead), never the Opportunity — 360 SMS threads
                    // its Conversation View on the person record and the
                    // customer's incoming messages already relate there.
                    // recordContextId (the Opportunity since the session-
                    // anchoring fix) stays the AGENT's context only.
                    String smsRelatedId = contactId != null ? String.valueOf(contactId)
                        : (leadId != null ? String.valueOf(leadId) : recordContextId);
                    tdc_tsw.GlobalSMSSender.sendSmsWithPhoneNumberAndMessageText(senderNumber, replyText, smsRelatedId);
                } catch (Exception e) {
                    logError('WhatsApp send', messageId, e);
                    sendFailed = true;
                }
            } else {
                logError('missing sender number, cannot reply', messageId, null);
                sendFailed = true;
            }

            if (aiFailed) {
                createFollowUpTask(oppId, leadId, contactId, messageId, 'WhatsApp AI reply failed — needs manual follow-up.');
            }
            if (sendFailed) {
                createFollowUpTask(oppId, leadId, contactId, messageId, 'WhatsApp reply failed to send — needs manual follow-up.');
            }
        }
    }

    /** Anchors a freshly-created session to a real person's Conversations list — matches
     *  WhatsAppRevivalInitiator's own anchor choice (the Opportunity's owner) so a
     *  session either side creates first is findable/visible the same way. */
    private static Id resolveOwnerId(String recordContextType, String recordContextId) {
        if (String.isBlank(recordContextType) || String.isBlank(recordContextId)) return null;
        try {
            if (recordContextType == 'Opportunity') {
                List<Opportunity> rows = [SELECT OwnerId FROM Opportunity WHERE Id = :recordContextId WITH USER_MODE LIMIT 1];
                return rows.isEmpty() ? null : rows[0].OwnerId;
            }
            if (recordContextType == 'Lead') {
                List<Lead> rows = [SELECT OwnerId FROM Lead WHERE Id = :recordContextId WITH USER_MODE LIMIT 1];
                return rows.isEmpty() ? null : rows[0].OwnerId;
            }
            if (recordContextType == 'Contact') {
                List<Contact> rows = [SELECT OwnerId FROM Contact WHERE Id = :recordContextId WITH USER_MODE LIMIT 1];
                return rows.isEmpty() ? null : rows[0].OwnerId;
            }
        } catch (Exception e) {
            // Non-fatal — findOrCreateAutomatedSession accepts a null anchor.
        }
        return null;
    }

    /** WhatId only accepts Opportunity/Case/etc — Lead/Contact (person records) go on WhoId. */
    private static void createFollowUpTask(Id oppId, Id leadId, Id contactId, Id messageId, String subject) {
        Task t = new Task(
            Subject      = subject,
            Description  = 'Related to incoming WhatsApp message: ' + messageId,
            Status       = 'Not Started',
            Priority     = 'High',
            ActivityDate = Date.today()
        );
        if (oppId != null) t.WhatId = oppId;
        if (leadId != null) t.WhoId = leadId;
        else if (contactId != null) t.WhoId = contactId;
        if (t.WhatId == null && t.WhoId == null) return; // nothing to relate the follow-up to
        try {
            insert t;
        } catch (Exception e) {
            logError('create follow-up Task', messageId, e);
        }
    }

    private static void logError(String stage, Id messageId, Exception e) {
        System.debug(LoggingLevel.ERROR,
            'WhatsAppAgentBridge [' + stage + '] for message ' + messageId +
            (e != null ? ': ' + e.getMessage() : ''));
    }
}
