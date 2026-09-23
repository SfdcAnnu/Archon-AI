// Reads one Architect build with the per-call records the server keeps since bf50a15.
HttpResponse r = ArchonServerClient.callout('GET', '/api/architect/build/b88a8a32-ab12-4504-bc8e-8c2bd71eed02', null, 60000);
Map<String,Object> j = (Map<String,Object>) JSON.deserializeUntyped(r.getBody());
System.debug('MB_JOB status=' + j.get('status') + ' cost=' + j.get('costUsd') + ' elapsedMs=' + j.get('elapsedMs') + ' error=' + (j.get('error') == null ? '' : String.valueOf(j.get('error')).left(400)));
for (Object so : (List<Object>) j.get('steps')) { Map<String,Object> s = (Map<String,Object>) so;
  System.debug('MB_STEP ' + s.get('key') + ' ' + s.get('state') + ' ms=' + s.get('ms') + ' cost=' + s.get('costUsd') + ' in=' + s.get('tokensIn') + ' out=' + s.get('tokensOut') + ' detail=' + (s.get('detail') == null ? '' : String.valueOf(s.get('detail')).left(70)));
  if (s.get('calls') != null) for (Object co : (List<Object>) s.get('calls')) { Map<String,Object> c = (Map<String,Object>) co;
    System.debug('MB_CALL ' + s.get('key') + ' ' + c.get('specialist') + ' ' + c.get('model') + ' in=' + c.get('tokensIn') + ' out=' + c.get('tokensOut') + ' cost=' + c.get('costUsd') + ' ms=' + c.get('ms') + (c.get('failed') == null ? '' : ' FAILED=' + String.valueOf(c.get('failed')).left(120)));
  }
}
Map<String,Object> res = (Map<String,Object>) j.get('result');
if (res != null) System.debug('MB_RESULT ' + res.get('apiName') + ' ' + res.get('shape') + ' notes=' + JSON.serialize(res.get('notes')).left(700));
