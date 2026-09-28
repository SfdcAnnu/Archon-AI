// Every run on test case 1: when, input tokens, tool calls — to tell "tools offered but not used" from "no tools offered".
for (AgentExecution__c e : [SELECT CreatedDate, Status__c, OutputPayload__c FROM AgentExecution__c WHERE RecordId__c = '006g5000009hmFVAAY' ORDER BY CreatedDate]) {
  Map<String, Object> out = (Map<String, Object>) JSON.deserializeUntyped(e.OutputPayload__c);
  for (String k : out.keySet()) {
    Object v = out.get(k);
    if (v instanceof Map<String, Object> && ((Map<String, Object>) v).containsKey('finalText')) {
      Map<String, Object> m = (Map<String, Object>) v;
      Integer calls = m.get('toolCalls') == null ? 0 : ((List<Object>) m.get('toolCalls')).size();
      System.debug('CMP ' + e.CreatedDate + ' in=' + m.get('tokensIn') + ' out=' + m.get('tokensOut') + ' toolCalls=' + calls);
    }
  }
}
