// Prints the Evaluator's raw answer for one build, from the checkpoint the detail route exposes.
HttpResponse r = ArchonServerClient.callout('GET', '/api/architect/build/96fae9b9-2fb3-4924-8c03-d79f7f9be3a0/detail', null, 60000);
Map<String,Object> j = (Map<String,Object>) JSON.deserializeUntyped(r.getBody());
System.debug('RV_KEYS ' + String.join(new List<String>(j.keySet()), ','));
Object review = j.get('review');
String s = review == null ? 'null' : JSON.serialize(review);
Integer at = 0;
while (at < s.length()) { System.debug('RV_JSON ' + s.substring(at, Math.min(at + 900, s.length()))); at += 900; }
