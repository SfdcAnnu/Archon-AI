// Prints a build's error, its survey outline and the matcher's gaps from the detail route.
String jobId = 'f212f8f2-090d-492d-8df2-45c1ac95b2a4';
HttpResponse r = ArchonServerClient.callout('GET', '/api/architect/build/' + jobId + '/detail', null, 60000);
Map<String,Object> j = (Map<String,Object>) JSON.deserializeUntyped(r.getBody());
String err = j.get('error') == null ? '' : String.valueOf(j.get('error'));
Integer at = 0;
while (at < err.length()) { System.debug('BD_ERR ' + err.substring(at, Math.min(at + 900, err.length()))); at += 900; }
String survey = j.get('survey') == null ? 'null' : JSON.serialize(j.get('survey'));
at = 0;
while (at < survey.length()) { System.debug('BD_SURVEY ' + survey.substring(at, Math.min(at + 900, survey.length()))); at += 900; }
String match = j.get('match') == null ? 'null' : JSON.serialize(j.get('match'));
System.debug('BD_MATCH ' + match.left(1800));
