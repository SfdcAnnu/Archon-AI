// Dumps one Architect build: status, error, agent type, and the design's nodes and automation steps.
String id = 'cff62bde-a602-4b3a-8690-1146fd9f97e7';
HttpResponse r = ArchonServerClient.callout('GET', '/api/architect/build/' + id + '/detail', null, 60000);
String body = r.getBody();
System.debug('BI_HTTP ' + r.getStatusCode() + ' len=' + body.length());
Integer at = 0;
while (at < body.length()) { System.debug('BI_JSON ' + body.substring(at, Math.min(at + 900, body.length()))); at += 900; }
