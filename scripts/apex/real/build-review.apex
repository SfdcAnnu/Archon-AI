// Prints the Evaluator's raw answer for one build, from the checkpoint the detail route exposes.
HttpResponse r = ArchonServerClient.callout('GET', '/api/architect/build/b88a8a32-ab12-4504-bc8e-8c2bd71eed02/detail', null, 60000);
Map<String,Object> j = (Map<String,Object>) JSON.deserializeUntyped(r.getBody());
System.debug('RV_KEYS ' + String.join(new List<String>(j.keySet()), ','));
Object review = j.get('review');
String s = review == null ? 'null' : JSON.serialize(review);
Integer at = 0;
while (at < s.length()) { System.debug('RV_JSON ' + s.substring(at, Math.min(at + 900, s.length()))); at += 900; }
