HttpResponse r = ArchonServerClient.callout('GET', '/api/architect/build/08faeccb-938d-4fc2-8604-f3b83ded7c69', null, 60000);
Map<String,Object> j = (Map<String,Object>) JSON.deserializeUntyped(r.getBody());
System.debug('P1 status=' + j.get('status') + ' cost=' + j.get('costUsd') + ' elapsedMs=' + j.get('elapsedMs') + ' error=' + j.get('error'));
for (Object so : (List<Object>) j.get('steps')) { Map<String,Object> s = (Map<String,Object>) so;
  System.debug('P1 step ' + s.get('key') + ' ' + s.get('state') + ' ms=' + s.get('ms') + ' cost=' + s.get('costUsd') + ' detail=' + String.valueOf(s.get('detail')).left(160)); }
