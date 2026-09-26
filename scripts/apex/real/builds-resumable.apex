// Lists the builds that are paused (waiting for a person) or failed with work saved.
HttpResponse r = ArchonServerClient.callout('GET', '/api/architect/builds/resumable', null, 60000);
System.debug('RB_HTTP ' + r.getStatusCode());
String body = r.getBody();
Integer at = 0;
while (at < body.length()) { System.debug('RB_JSON ' + body.substring(at, Math.min(at + 900, body.length()))); at += 900; }
