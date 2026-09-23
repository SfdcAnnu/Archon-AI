// The warm copilot measurement: a question the session has not seen, so the root must
// call home_stats rather than answer from the conversation. Same session as copilot1.
Long t0 = System.now().getTime();
AgentChatController.TurnResult r = AgentChatController.sendTurn('a08g500000CtcAbAAJ', 'How many chat turns ran this week in total, and which agent had the most of them?', null);
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
