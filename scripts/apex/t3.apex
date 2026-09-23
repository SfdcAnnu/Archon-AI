// A turn that MUST use a tool: the dependent picklist. Tests the v63/v64
// MCP work and the tool path end to end.
Long t0 = System.now().getTime();
AgentChatController.TurnResult r = AgentChatController.sendTurn(
    'a08g500000Ct1EmAAJ',
    'Which projects are available under Villa? List them.',
    null);
Long ms = System.now().getTime() - t0;
System.debug('STATUS ' + r.status + ' | ms=' + ms);
// Tool calls ride on Tool-ROLE messages. Reading only the Assistant one
// reports "TOOLS none" on a turn that called three tools -- which is how a
// perfectly good run first looked like a failure.
for (ChatMessage__c m : r.newMessages) {
  if (m.ToolCallsJson__c != null) {
    System.debug('TOOL ' + m.ToolCallsJson__c.left(200));
  }
  if (m.Role__c == 'Assistant' && m.Content__c != null) {
    System.debug('REPLY ' + m.Content__c);
    System.debug('MODEL ' + m.ModelUsed__c + ' in=' + m.TokensIn__c + ' out=' + m.TokensOut__c);
  }
}
