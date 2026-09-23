// Second transaction: no DML before the callout.
Long t0 = System.now().getTime();
AgentChatController.TurnResult r = AgentChatController.sendTurn(
    'a08g500000Ct1EmAAJ',
    'What is this lead\'s email address? Answer in one short sentence.',
    null);
Long ms = System.now().getTime() - t0;
System.debug('STATUS ' + r.status + ' | ms=' + ms);
for (ChatMessage__c m : r.newMessages) {
  if (m.Role__c == 'Assistant') {
    System.debug('TOOLS ' + m.ToolCallsJson__c);
    System.debug('REPLY ' + m.Content__c);
    System.debug('MODEL ' + m.ModelUsed__c + ' in=' + m.TokensIn__c + ' out=' + m.TokensOut__c);
  }
}
