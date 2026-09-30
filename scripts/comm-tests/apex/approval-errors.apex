HttpResponse r = ArchonServerClient.callout('GET', '/api/chat/approvals?sessionId=a08g500000DB4gjAAD&status=Failed', null, 60000);
Map<String,Object> j = (Map<String,Object>) JSON.deserializeUntyped(r.getBody());
for (Object o : (List<Object>) j.get('approvals')) { Map<String,Object> a = (Map<String,Object>) o;
  System.debug('AE ' + a.get('toolName') + ' :: ' + String.valueOf(a.get('resultText')).left(900)); }
