Long t0 = System.now().getTime();
AgentChatController.TurnResult r = AgentChatController.sendTurn('a08g500000CtLo5AAF', 'Hi, I want to continue with my property enquiry.', null);
Long ms = System.now().getTime() - t0;
System.debug('R1_WALL ' + ms);
for (ChatMessage__c m : r.newMessages) {
  if (m.ToolCallsJson__c != null) System.debug('R1_TOOL ' + m.ToolCallsJson__c.left(120));
  if (m.Role__c == 'Assistant' && m.Content__c != null) System.debug('R1_REPLY ' + m.Content__c.left(300));
}
