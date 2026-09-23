Long t0 = System.now().getTime();
AgentChatController.TurnResult r = AgentChatController.sendTurn('a08g500000CtLo5AAF', 'And which project did I finally pick?', null);
System.debug('PH_WALL ' + (System.now().getTime() - t0));
for (ChatMessage__c m : r.newMessages) {
  if (m.Role__c == 'Assistant') {
    System.debug('PH_JSON ' + m.PhaseMsJson__c);
    System.debug('PH_TOOL ' + (m.ToolCallsJson__c == null ? 'no' : 'yes'));
  }
}
