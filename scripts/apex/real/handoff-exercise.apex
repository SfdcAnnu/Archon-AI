// Exercise the handoff state machine on a real session with no model call:
// hand it to the running user (the trigger writes the transcript line and
// sends the notification), read the status, give it back with a note, and
// print the System rows. Run: sf apex run --file scripts/apex/real/handoff-exercise.apex
// Set the session Id below to any Active session you own.
Id sessionId = 'a08g500000DFS1JAAX';

ChatSession__c s = AgentHandoffService.load(sessionId);
System.debug('BEFORE status=' + s.Status__c + ' owner=' + s.OwnerId);

ChatSession__c off = new ChatSession__c(Id = sessionId);
off.Status__c = 'Handed off';
off.HandoffReason__c = 'test: the customer asked for a person about pricing';
off.HandedOffAt__c = System.now();
off.HandoffReturnHours__c = 12;
off.HandoffReturnAt__c = System.now().addHours(12);
off.HandoffAssigneeType__c = 'user';
off.HandoffAssigneeId__c = UserInfo.getUserId();
off.HandoffAssigneeLabel__c = UserInfo.getName();
off.HandoffPreviousOwner__c = String.valueOf(s.OwnerId);
off.HandoffNotify__c = 'notification,email';
off.HandoffReturnLine__c = 'You are back with our assistant.';
update off;

Map<String, Object> st = AgentHandoffService.status(sessionId);
System.debug('AFTER HANDOFF handedOff=' + st.get('handedOff') + ' assignee=' + st.get('assignee') + ' returnAt=' + st.get('returnAt') + ' canReply=' + st.get('canReply'));

AgentHandoffService.recordCustomerMessage(sessionId, 'test: customer wrote while a person had it');
AgentHandoffService.returnToAgent(sessionId, 'test: pricing clarified, quote resent', UserInfo.getUserId());

Map<String, Object> st2 = AgentHandoffService.status(sessionId);
System.debug('AFTER RETURN status=' + st2.get('status') + ' returnedBy=' + st2.get('returnedBy') + ' note=' + st2.get('returnNote'));

for (ChatMessage__c m : [SELECT Role__c, Content__c, SequenceNumber__c, ToolCallsJson__c FROM ChatMessage__c WHERE ChatSession__c = :sessionId ORDER BY SequenceNumber__c DESC LIMIT 4]) {
    System.debug('ROW #' + m.SequenceNumber__c + ' ' + m.Role__c + ' | ' + m.Content__c + ' | ' + m.ToolCallsJson__c);
}
System.debug('QUEUES ' + JSON.serialize(AgentHandoffService.listQueues()).left(300));
System.debug('GROUPS ' + JSON.serialize(AgentHandoffService.listGroups()).left(300));
