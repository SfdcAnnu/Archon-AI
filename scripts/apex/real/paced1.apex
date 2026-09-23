Long t0 = System.now().getTime();
AgentChatController.TurnResult r = AgentChatController.sendTurn('a08g500000CtLo5AAF', 'Quick check, is my enquiry still open?', null);
System.debug('PC1_WALL ' + (System.now().getTime() - t0));
for (ChatMessage__c m : r.newMessages) {
  if (m.Role__c == 'Assistant') System.debug('PC1_JSON ' + m.PhaseMsJson__c);
}
