// Recent Archon Copilot conversations, turn by turn: role, text (flattened, clipped), tools, latency, model.
List<Id> ids = new List<Id>{ 'a08g500000D4Q1FAAV' };
for (ChatMessage__c m : [SELECT ChatSession__c, SequenceNumber__c, Role__c, Content__c, ToolCallsJson__c, LatencyMs__c, ModelUsed__c, TurnStatus__c FROM ChatMessage__c WHERE ChatSession__c IN :ids ORDER BY ChatSession__c, SequenceNumber__c]) {
  String c = m.Content__c == null ? '' : m.Content__c.replace('\n', ' / ');
  String tools = m.ToolCallsJson__c == null ? '' : m.ToolCallsJson__c.left(300);
  System.debug('TR ' + String.valueOf(m.ChatSession__c).right(6) + ' #' + m.SequenceNumber__c + ' ' + m.Role__c + ' ms=' + m.LatencyMs__c + ' model=' + m.ModelUsed__c + ' status=' + m.TurnStatus__c + ' tools=[' + tools.trim() + '] :: ' + c.left(1400));
}
