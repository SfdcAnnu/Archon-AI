List<String> ids = new List<String>{'0e17a369-4cf6-4bb1-9170-d98e2a831cd3', 'b8a9e936-befd-4cdb-881c-6494ca6dc433', '8e63f0bd-5e1b-4035-99d9-c0f07810c248', 'a8ef0aec-1810-47a2-900f-93c9cdc7dbdf', 'b62de57a-8808-45c0-83ff-72712a29d76f', '485ca51f-7ee4-4d19-814f-c57ddcc77045', '10b68cfc-2592-4f95-8cf6-9c44fd9ed2ad', 'f12d6607-6915-47eb-b1c8-f14e24e710b3', '1916e62f-a4ba-4dc4-b9f9-54714a187ebc', '0fe2d3f6-6b01-4cd8-a281-efdcb14a2d41'};
for (String id : ids) {
  HttpResponse r = ArchonServerClient.callout('GET', '/api/architect/build/' + id, null, 60000);
  if (r.getStatusCode() != 200) { System.debug('BJ ' + id + ' HTTP ' + r.getStatusCode() + ' ' + r.getBody().left(120)); continue; }
  Map<String,Object> j = (Map<String,Object>) JSON.deserializeUntyped(r.getBody());
  String req = j.get('requirement') == null ? '' : String.valueOf(j.get('requirement')).left(90);
  System.debug('BJ ' + id.left(8) + ' status=' + j.get('status') + ' cost=' + j.get('costUsd') + ' prior=' + j.get('priorCostUsd') + ' started=' + j.get('startedAt') + ' finished=' + j.get('finishedAt') + ' req=' + req);
  List<Object> steps = (List<Object>) j.get('steps');
  if (steps != null) for (Object so : steps) { Map<String,Object> s = (Map<String,Object>) so;
    System.debug('BS ' + id.left(8) + ' ' + s.get('key') + ' ' + s.get('state') + ' ms=' + s.get('ms') + ' cost=' + s.get('costUsd') + ' reused=' + s.get('reused') + ' detail=' + (s.get('detail') == null ? '' : String.valueOf(s.get('detail')).left(60)));
  }
}
