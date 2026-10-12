/**
 * A conversation handed to a person, and back.
 *
 * The handoff is a state on ChatSession__c: Status__c 'Handed off' plus the
 * Handoff* fields that say who has it, why, since when, and when the agent
 * takes it back. The server's hand_off_to_human tool writes that state when
 * the agent calls it; the Return button, the /agent command and the
 * quiet-period sweep write it back. ChatSessionHandoffHandler (the trigger)
 * turns every transition into the transcript line, the notification and
 * the customer's line, so no path can drift from the others.
 *
 * While a conversation is handed off the WhatsApp bridge keeps the
 * customer's messages here (recordCustomerMessage) and never runs a turn,
 * and a person replies through replyAsHuman, which goes out on the same
 * WhatsApp number the agent used.
 */
public with sharing class AgentHandoffService {

    public class HandoffException extends Exception {}

    public static final String STATUS_HANDED_OFF = 'Handed off';
    public static final String ROLE_HUMAN = 'Human';
    public static final Integer DEFAULT_QUIET_HOURS = 12;

    /** The session with everything a handoff needs. */
    public static ChatSession__c load(Id sessionId) {
        List<ChatSession__c> rows = [
            SELECT Id, Name, Status__c, Channel__c, SenderPhone__c, RecordContextId__c, RecordContextType__c, OwnerId, User__c,
                   AgentDefinition__c, AgentDefinition__r.Name, AgentDefinition__r.ApiName__c, LastActivityAt__c,
                   HandoffReason__c, HandedOffAt__c, HandoffReturnAt__c, HandoffReturnHours__c,
                   HandoffAssigneeType__c, HandoffAssigneeId__c, HandoffAssigneeLabel__c, HandoffPreviousOwner__c,
                   HandoffNotify__c, HandoffReturnLine__c, HandoffReturnNote__c, HandoffReturnedBy__c
            FROM ChatSession__c WHERE Id = :sessionId WITH USER_MODE LIMIT 1
        ];
        if (rows.isEmpty()) throw new HandoffException('Conversation not found.');
        return rows[0];
    }

    /** Give the conversation back to the agent. The note is what the agent
     *  is told on its next turn; the trigger writes the transcript line and
     *  sends the customer's return line. */
    public static void returnToAgent(Id sessionId, String note, Id byUserId) {
        ChatSession__c s = load(sessionId);
        if (s.Status__c != STATUS_HANDED_OFF) throw new HandoffException('This conversation is not handed off.');
        ChatSession__c patch = new ChatSession__c(Id = s.Id);
        patch.Status__c = 'Active';
        patch.HandoffReturnAt__c = null;
        patch.HandoffReturnNote__c = String.isBlank(note) ? null : note.trim().left(1000);
        patch.HandoffReturnedBy__c = byUserId == null ? null : String.valueOf(byUserId);
        patch.LastActivityAt__c = System.now();
        if (String.isNotBlank(s.HandoffPreviousOwner__c)) {
            try { patch.OwnerId = Id.valueOf(s.HandoffPreviousOwner__c); } catch (Exception e) { /* keep the current owner */ }
        }
        update patch;
    }

    /** A person's reply to the customer while the conversation is theirs.
     *  "/agent" on its own hands the conversation back instead. */
    public static ChatMessage__c replyAsHuman(Id sessionId, String text) {
        if (String.isBlank(text)) throw new HandoffException('Type a message.');
        String body = text.trim();
        if (body == '/agent') { returnToAgent(sessionId, null, UserInfo.getUserId()); return null; }
        ChatSession__c s = load(sessionId);
        if (s.Status__c != STATUS_HANDED_OFF) throw new HandoffException('This conversation is with the agent. Hand it off first.');
        // Callout first (the reply goes to WhatsApp), DML after — never the reverse.
        if (s.Channel__c == 'whatsapp' && String.isNotBlank(s.SenderPhone__c)) {
            sendWhatsApp(s.SenderPhone__c, body, relatedPersonId(s));
        }
        ChatMessage__c m = new ChatMessage__c(
            ChatSession__c = s.Id,
            Role__c = ROLE_HUMAN,
            Content__c = body.left(131072),
            AuthorUser__c = UserInfo.getUserId(),
            SequenceNumber__c = nextSequence(s.Id)
        );
        insert m;
        update new ChatSession__c(Id = s.Id, LastActivityAt__c = System.now(), HandoffReturnAt__c = System.now().addHours(hoursOf(s)));
        return m;
    }

    /** The customer wrote while a person has the conversation: keep the
     *  words, restart the quiet clock, tell the person. No agent turn. */
    public static void recordCustomerMessage(Id sessionId, String text) {
        ChatSession__c s = load(sessionId);
        insert new ChatMessage__c(
            ChatSession__c = s.Id, Role__c = 'User',
            Content__c = String.isBlank(text) ? '' : text.left(131072),
            SequenceNumber__c = nextSequence(s.Id)
        );
        update new ChatSession__c(Id = s.Id, LastActivityAt__c = System.now(), HandoffReturnAt__c = System.now().addHours(hoursOf(s)));
        ChatSessionHandoffHandler.notify(s, 'New message from ' + ChatSessionHandoffHandler.customerLabel(s), text, false);
    }

    /** Conversations whose quiet period has passed go back to the agent.
     *  Called by the server's sweep; safe to call often. */
    public static Integer returnOverdue() {
        Integer n = 0;
        for (ChatSession__c s : [
            SELECT Id FROM ChatSession__c
            WHERE Status__c = :STATUS_HANDED_OFF AND HandoffReturnAt__c != null AND HandoffReturnAt__c <= :System.now()
            LIMIT 50
        ]) {
            try {
                ChatSession__c full = load(s.Id);
                returnToAgent(s.Id, 'No reply for ' + hoursOf(full) + ' hours, so the conversation came back to the agent.', null);
                n++;
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, 'AgentHandoffService.returnOverdue: ' + e.getMessage());
            }
        }
        return n;
    }

    public static Integer hoursOf(ChatSession__c s) {
        return s.HandoffReturnHours__c == null || s.HandoffReturnHours__c <= 0 ? DEFAULT_QUIET_HOURS : Integer.valueOf(s.HandoffReturnHours__c);
    }

    public static Decimal nextSequence(Id sessionId) {
        List<ChatMessage__c> last = [SELECT SequenceNumber__c FROM ChatMessage__c WHERE ChatSession__c = :sessionId ORDER BY SequenceNumber__c DESC LIMIT 1];
        return (last.isEmpty() || last[0].SequenceNumber__c == null ? 0 : last[0].SequenceNumber__c) + 1;
    }

    /** 360 SMS threads its conversation view on the person, never the deal. */
    public static String relatedPersonId(ChatSession__c s) {
        return s.RecordContextType__c == 'Lead' || s.RecordContextType__c == 'Contact' ? s.RecordContextId__c : null;
    }

    public static void sendWhatsApp(String phone, String text, String relatedId) {
        if (Test.isRunningTest()) return;
        tdc_tsw.GlobalSMSSender.sendSmsWithPhoneNumberAndMessageText(phone, text, relatedId);
    }

    /** Queues a builder can hand a conversation to; `omni` says Omni-Channel
     *  routes it. The routing field only exists once Omni-Channel is on. */
    public static List<Map<String, Object>> listQueues() {
        Boolean hasOmni = Schema.SObjectType.Group.fields.getMap().containsKey('queueroutingconfigid');
        String soql = 'SELECT Id, Name, DeveloperName' + (hasOmni ? ', QueueRoutingConfigId' : '') + ' FROM Group WHERE Type = \'Queue\' ORDER BY Name LIMIT 200';
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (SObject g : Database.query(soql)) {
            out.add(new Map<String, Object>{
                'id' => g.get('Id'), 'name' => g.get('Name'), 'developerName' => g.get('DeveloperName'),
                'omni' => hasOmni && g.get('QueueRoutingConfigId') != null
            });
        }
        return out;
    }

    /** Public groups a builder can hand a conversation to. */
    public static List<Map<String, Object>> listGroups() {
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Group g : [SELECT Id, Name, DeveloperName FROM Group WHERE Type = 'Regular' ORDER BY Name LIMIT 200]) {
            out.add(new Map<String, Object>{ 'id' => g.Id, 'name' => g.Name, 'developerName' => g.DeveloperName });
        }
        return out;
    }

    /** What the Conversations page shows above a handed-off transcript. */
    public static Map<String, Object> status(Id sessionId) {
        ChatSession__c s = load(sessionId);
        String returnedBy = null;
        if (String.isNotBlank(s.HandoffReturnedBy__c)) {
            for (User u : [SELECT Name FROM User WHERE Id = :s.HandoffReturnedBy__c LIMIT 1]) returnedBy = u.Name;
        }
        return new Map<String, Object>{
            'sessionId' => s.Id,
            'status' => s.Status__c,
            'handedOff' => s.Status__c == STATUS_HANDED_OFF,
            'assignee' => s.HandoffAssigneeLabel__c,
            'assigneeType' => s.HandoffAssigneeType__c,
            'reason' => s.HandoffReason__c,
            'handedOffAt' => s.HandedOffAt__c,
            'returnAt' => s.HandoffReturnAt__c,
            'quietHours' => hoursOf(s),
            'channel' => s.Channel__c,
            'canReply' => s.Status__c == STATUS_HANDED_OFF && s.Channel__c == 'whatsapp' && String.isNotBlank(s.SenderPhone__c),
            'returnedBy' => returnedBy,
            'returnNote' => s.HandoffReturnNote__c
        };
    }
}
