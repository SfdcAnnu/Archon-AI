// One turn while the MCP servers are (probably) asleep: is the reply honest, and does the turn record a warning?
Long t0 = System.currentTimeMillis();
AgentChatController.TurnResult r = AgentChatController.sendTurn('a08g500000DEvVBAA1', 'Look up priya.sharma@archontest.example', new List<AgentChatController.AttachmentInput>());
Long ms = System.currentTimeMillis() - t0;
Set<Id> ids = new Set<Id>();
for (ChatMessage__c m : r.newMessages) ids.add(m.Id);
for (ChatMessage__c m : [SELECT Role__c, Content__c, PhaseMsJson__c, ToolCallsJson__c FROM ChatMessage__c WHERE Id IN :ids ORDER BY SequenceNumber__c]) {
    System.debug('COLD ' + m.Role__c + ' ms=' + ms + ' :: ' + (m.Content__c == null ? '' : m.Content__c.replace('\n', ' | ')).left(500)
        + (m.PhaseMsJson__c == null ? '' : ' || PHASE ' + m.PhaseMsJson__c.left(900))
        + (m.ToolCallsJson__c == null ? '' : ' || CALL ' + m.ToolCallsJson__c.left(200)));
}
