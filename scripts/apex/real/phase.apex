Long t0 = System.now().getTime();
AgentChatController.TurnResult r = AgentChatController.sendTurn('a08g500000CtLo5AAF', 'One more thing, what budget do you have on file for me?', null);
System.debug('PH_WALL ' + (System.now().getTime() - t0));
for (ChatMessage__c m : r.newMessages) {
  if (m.Role__c == 'Assistant') {
    System.debug('PH_MODEL ' + m.LatencyMs__c);
    System.debug('PH_JSON ' + m.PhaseMsJson__c);
    if (m.ToolCallsJson__c != null) System.debug('PH_TOOL yes');
  }
}
