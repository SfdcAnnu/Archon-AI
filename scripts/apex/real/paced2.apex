Long t0 = System.now().getTime();
AgentChatController.TurnResult r = AgentChatController.sendTurn('a08g500000CtLo5AAF', 'And what is the project type on it?', null);
System.debug('PC2_WALL ' + (System.now().getTime() - t0));
for (ChatMessage__c m : r.newMessages) {
  if (m.Role__c == 'Assistant') System.debug('PC2_JSON ' + m.PhaseMsJson__c);
}
