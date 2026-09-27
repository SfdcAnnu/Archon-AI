// The AI step's full answer from the latest run on the test Account.
AgentExecution__c e = [SELECT OutputPayload__c FROM AgentExecution__c WHERE RecordId__c = '001g500000itc05AAA' ORDER BY CreatedDate DESC LIMIT 1];
Map<String, Object> out = (Map<String, Object>) JSON.deserializeUntyped(e.OutputPayload__c);
for (String k : out.keySet()) {
  Object v = out.get(k);
  if (v instanceof Map<String, Object> && ((Map<String, Object>) v).containsKey('finalText')) {
    Map<String, Object> m = (Map<String, Object>) v;
    String t = String.valueOf(m.get('finalText')).replace('\n', ' / ');
    System.debug('ANS meta model=' + m.get('modelUsed') + ' in=' + m.get('tokensIn') + ' out=' + m.get('tokensOut') + ' toolCalls=' + JSON.serialize(m.get('toolCalls')));
    for (Integer i = 0; i < t.length(); i += 700) System.debug('ANS ' + t.substring(i, Math.min(i + 700, t.length())));
    System.debug('ANS keys ' + ((Map<String, Object>) v).keySet());
  }
}
