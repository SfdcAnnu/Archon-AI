Long t0 = System.now().getTime();
AgentChatController.TurnResult r = AgentChatController.sendTurn('a08g500000CtLo5AAF', 'Actually please change it to Villa Project C.', null);
System.debug('R6_WALL ' + (System.now().getTime() - t0));
for (ChatMessage__c m : r.newMessages) {
  if (m.ToolCallsJson__c != null) System.debug('R6_TOOL ' + m.ToolCallsJson__c.left(140));
}
