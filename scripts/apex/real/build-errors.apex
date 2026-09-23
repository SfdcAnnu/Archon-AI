List<String> ids = new List<String>{'b8a9e936-befd-4cdb-881c-6494ca6dc433', 'b62de57a-8808-45c0-83ff-72712a29d76f', '10b68cfc-2592-4f95-8cf6-9c44fd9ed2ad'};
for (String id : ids) {
  HttpResponse r = ArchonServerClient.callout('GET', '/api/architect/build/' + id, null, 60000);
  Map<String,Object> j = (Map<String,Object>) JSON.deserializeUntyped(r.getBody());
  System.debug('BE ' + id.left(8) + ' elapsedMs=' + j.get('elapsedMs') + ' resumedFrom=' + j.get('resumedFrom') + ' thisRun=' + j.get('thisRunCostUsd') + ' max=' + j.get('maxCostUsd'));
  System.debug('BE ' + id.left(8) + ' error=' + (j.get('error') == null ? '' : String.valueOf(j.get('error')).left(700)));
}
