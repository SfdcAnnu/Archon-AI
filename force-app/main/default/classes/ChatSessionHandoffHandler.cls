/**
 * The trigger side of a handoff.
 *
 * Every path that hands a conversation to a person or back only changes
 * ChatSession__c (see AgentHandoffService). This handler turns the change
 * into what people see: the transcript line, the notification and email
 * to whoever takes over, and the customer's line on return. Nothing here
 * makes a callout in the trigger's own transaction: the WhatsApp line on
 * return goes through a queueable.
 */
public with sharing class ChatSessionHandoffHandler {

    public static void afterUpdate(List<ChatSession__c> rows, Map<Id, ChatSession__c> oldMap) {
        List<ChatSession__c> handedOff = new List<ChatSession__c>();
        List<ChatSession__c> returned = new List<ChatSession__c>();
        for (ChatSession__c s : rows) {
            ChatSession__c o = oldMap.get(s.Id);
            if (o == null) continue;
            Boolean nowOff = s.Status__c == AgentHandoffService.STATUS_HANDED_OFF;
            Boolean wasOff = o.Status__c == AgentHandoffService.STATUS_HANDED_OFF;
            if (nowOff && !wasOff) handedOff.add(s);
            else if (wasOff && s.Status__c == 'Active') returned.add(s);
        }
        if (handedOff.isEmpty() && returned.isEmpty()) return;

        List<ChatMessage__c> lines = new List<ChatMessage__c>();
        for (ChatSession__c s : handedOff) {
            String text = 'Handed off to ' + label(s) + (String.isBlank(s.HandoffReason__c) ? '' : ' · reason: ' + s.HandoffReason__c);
            lines.add(systemLine(s, text, new Map<String, Object>{
                'kind' => 'handoff', 'assignee' => s.HandoffAssigneeLabel__c, 'assigneeType' => s.HandoffAssigneeType__c, 'reason' => s.HandoffReason__c
            }));
        }
        Map<Id, String> returnerNames = new Map<Id, String>();
        for (ChatSession__c s : returned) {
            if (String.isNotBlank(s.HandoffReturnedBy__c)) {
                try { returnerNames.put(Id.valueOf(s.HandoffReturnedBy__c), null); } catch (Exception e) { /* not an Id */ }
            }
        }
        if (!returnerNames.isEmpty()) {
            for (User u : [SELECT Id, Name FROM User WHERE Id IN :returnerNames.keySet()]) returnerNames.put(u.Id, u.Name);
        }
        for (ChatSession__c s : returned) {
            String returner = null;
            if (String.isNotBlank(s.HandoffReturnedBy__c)) {
                try { returner = returnerNames.get(Id.valueOf(s.HandoffReturnedBy__c)); } catch (Exception e) { returner = null; }
            }
            String text = 'Returned to the agent' + (String.isBlank(returner) ? ' after the quiet period' : ' by ' + returner)
                + (String.isBlank(s.HandoffReturnNote__c) ? '' : ' · ' + s.HandoffReturnNote__c);
            lines.add(systemLine(s, text, new Map<String, Object>{
                'kind' => 'handoff_return', 'returnedBy' => returner, 'note' => s.HandoffReturnNote__c,
                'assignee' => s.HandoffAssigneeLabel__c, 'handedOffAt' => s.HandedOffAt__c
            }));
        }
        if (!lines.isEmpty()) {
            try { insert lines; } catch (Exception e) { System.debug(LoggingLevel.WARN, 'ChatSessionHandoffHandler: transcript line failed: ' + e.getMessage()); }
        }

        for (ChatSession__c s : handedOff) {
            notify(s, customerLabel(s) + ' needs a person', String.isBlank(s.HandoffReason__c) ? 'The agent handed this conversation to you.' : s.HandoffReason__c, true);
        }
        for (ChatSession__c s : returned) {
            if (s.Channel__c == 'whatsapp' && String.isNotBlank(s.SenderPhone__c) && String.isNotBlank(s.HandoffReturnLine__c)) {
                ReturnLineQueueable job = new ReturnLineQueueable(s.SenderPhone__c, s.HandoffReturnLine__c, AgentHandoffService.relatedPersonId(s));
                if (Test.isRunningTest()) job.execute(null); else System.enqueueJob(job);
            }
        }
    }

    /** One System row in the transcript. */
    private static ChatMessage__c systemLine(ChatSession__c s, String text, Map<String, Object> audit) {
        return new ChatMessage__c(
            ChatSession__c = s.Id,
            Role__c = 'System',
            Content__c = text.left(131072),
            SequenceNumber__c = AgentHandoffService.nextSequence(s.Id),
            ToolCallsJson__c = JSON.serialize(audit).left(32768)
        );
    }

    /** Who has the conversation, as people read it. */
    public static String label(ChatSession__c s) {
        if (String.isNotBlank(s.HandoffAssigneeLabel__c)) return s.HandoffAssigneeLabel__c;
        return s.HandoffAssigneeType__c == 'omni' ? 'Omni-Channel' : 'a person';
    }

    /** The customer, by the record the conversation is about, else the number. */
    public static String customerLabel(ChatSession__c s) {
        try {
            if (String.isNotBlank(s.RecordContextId__c) && (s.RecordContextType__c == 'Lead' || s.RecordContextType__c == 'Contact')) {
                String sid = s.RecordContextId__c.replaceAll('[^A-Za-z0-9]', '');
                for (SObject r : Database.query('SELECT Name FROM ' + s.RecordContextType__c + ' WHERE Id = \'' + sid + '\' LIMIT 1')) {
                    return String.valueOf(r.get('Name'));
                }
            }
        } catch (Exception e) { /* fall through */ }
        return String.isNotBlank(s.SenderPhone__c) ? s.SenderPhone__c : 'A customer';
    }

    /**
     * Tell whoever has the conversation. A Salesforce notification (bell)
     * always; an email when the node asked for it and `withEmail` is set.
     * Omni-Channel handoffs are told by the Omni widget itself.
     */
    public static void notify(ChatSession__c s, String title, String body, Boolean withEmail) {
        if (s.HandoffAssigneeType__c == 'omni') return;
        Set<Id> people = peopleFor(s);
        if (people.isEmpty()) return;
        String notifyHow = String.isBlank(s.HandoffNotify__c) ? 'notification,email' : s.HandoffNotify__c;
        String link = ConnectionReminderService.appUrl() + '/conversations?session=' + s.Id;
        String bodyText = (String.isBlank(body) ? '' : body.trim()) + '\n\nOpen the conversation: ' + link;

        if (notifyHow.contains('notification')) {
            try {
                List<CustomNotificationType> types = [SELECT Id FROM CustomNotificationType WHERE DeveloperName = 'Archon_Handoff' LIMIT 1];
                if (!types.isEmpty()) {
                    Messaging.CustomNotification n = new Messaging.CustomNotification();
                    n.setTitle(title.left(250));
                    n.setBody((String.isBlank(body) ? 'Open the conversation to reply.' : body.trim()).left(750));
                    n.setNotificationTypeId(types[0].Id);
                    n.setTargetId(String.isNotBlank(s.RecordContextId__c) ? s.RecordContextId__c : String.valueOf(s.Id));
                    Set<String> ids = new Set<String>();
                    for (Id p : people) ids.add(p);
                    n.send(ids);
                }
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, 'ChatSessionHandoffHandler: notification failed: ' + e.getMessage());
            }
        }
        if (withEmail && notifyHow.contains('email')) {
            try {
                List<Messaging.SingleEmailMessage> mails = new List<Messaging.SingleEmailMessage>();
                for (User u : [SELECT Id, Name, Email FROM User WHERE Id IN :people AND IsActive = true]) {
                    if (String.isBlank(u.Email)) continue;
                    Messaging.SingleEmailMessage m = new Messaging.SingleEmailMessage();
                    m.setTargetObjectId(u.Id);
                    m.setSaveAsActivity(false);
                    m.setSubject(title.left(250));
                    String text = 'Hi ' + u.Name.substringBefore(' ') + ',\n\n' + bodyText + '\n\nThe agent stays silent until you give the conversation back (Return to agent), or after '
                        + AgentHandoffService.hoursOf(s) + ' quiet hours.\n\n— Archon';
                    m.setPlainTextBody(text);
                    m.setHtmlBody(text.replace('\n', '<br>').replace(link, '<a href="' + link + '">Open the conversation</a>'));
                    mails.add(m);
                }
                if (!mails.isEmpty()) Messaging.sendEmail(mails, false);
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, 'ChatSessionHandoffHandler: email failed: ' + e.getMessage());
            }
        }
    }

    /** The users behind the node's choice: a user, the members of a queue or
     *  group, or the record owner. Nested groups are not followed. */
    public static Set<Id> peopleFor(ChatSession__c s) {
        Set<Id> out = new Set<Id>();
        String t = s.HandoffAssigneeType__c;
        // Not named "id": Apex names are case-insensitive, and a local called
        // id would shadow the Id type on the next line.
        String assigneeId = s.HandoffAssigneeId__c;
        try {
            if ((t == 'user' || t == 'owner') && String.isNotBlank(assigneeId) && assigneeId.startsWith('005')) {
                out.add(Id.valueOf(assigneeId));
            } else if ((t == 'queue' || t == 'group') && String.isNotBlank(assigneeId)) {
                for (GroupMember gm : [SELECT UserOrGroupId FROM GroupMember WHERE GroupId = :assigneeId LIMIT 200]) {
                    if (String.valueOf(gm.UserOrGroupId).startsWith('005')) out.add(gm.UserOrGroupId);
                }
            }
            if (out.isEmpty() && s.OwnerId != null && String.valueOf(s.OwnerId).startsWith('005')) out.add(s.OwnerId);
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'ChatSessionHandoffHandler.peopleFor: ' + e.getMessage());
        }
        return out;
    }

    /** The customer's line on return, sent outside the trigger's transaction. */
    public class ReturnLineQueueable implements Queueable, Database.AllowsCallouts {
        private final String phone;
        private final String text;
        private final String relatedId;
        public ReturnLineQueueable(String phone, String text, String relatedId) {
            this.phone = phone; this.text = text; this.relatedId = relatedId;
        }
        public void execute(QueueableContext qc) {
            try { AgentHandoffService.sendWhatsApp(phone, text, relatedId); }
            catch (Exception e) { System.debug(LoggingLevel.WARN, 'ChatSessionHandoffHandler: return line failed: ' + e.getMessage()); }
        }
    }
}
