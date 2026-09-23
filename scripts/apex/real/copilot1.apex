AgentChatController.SessionWithMessages s = AgentChatController.startSession('archon_copilot', null, null);
System.debug('CP_SESSION ' + s.session.Id);
Long t0 = System.now().getTime();
AgentChatController.TurnResult r = AgentChatController.sendTurn(s.session.Id, 'I just want to know like which agent are used most agent right now', null);
System.debug('CP_WALL ' + (System.now().getTime() - t0));
for (ChatMessage__c m : r.newMessages) {
  if (m.Role__c == 'Tool') System.debug('CP_TOOL ' + (m.ToolCallsJson__c == null ? '' : m.ToolCallsJson__c.left(160)));
  if (m.Role__c == 'Assistant') {
    System.debug('CP_PHASES ' + m.PhaseMsJson__c);
    System.debug('CP_LATENCY ' + m.LatencyMs__c);
    System.debug('CP_USAGE ' + m.UsageJson__c);
    System.debug('CP_REPLY ' + (m.Content__c == null ? '' : m.Content__c.left(400)));
  }
}
