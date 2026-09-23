// Checks the spill change: a month of home_stats (~4k chars) used to be stored as an artifact
// and cost the root a read_artifact call; on the platform threshold it comes back whole.
Long t0 = System.now().getTime();
AgentChatController.TurnResult r = AgentChatController.sendTurn('a08g500000CtcAbAAJ', 'Over the last 31 days, how many chat turns ran in total and which agent had the most?', null);
System.debug('CP_WALL ' + (System.now().getTime() - t0));
for (ChatMessage__c m : r.newMessages) {
  if (m.Role__c == 'Tool') System.debug('CP_TOOL ' + (m.ToolCallsJson__c == null ? '' : m.ToolCallsJson__c.left(160)));
  if (m.Role__c == 'Assistant') {
    System.debug('CP_PHASES ' + m.PhaseMsJson__c);
    System.debug('CP_USAGE ' + m.UsageJson__c);
    System.debug('CP_REPLY ' + (m.Content__c == null ? '' : m.Content__c.left(300)));
  }
}
