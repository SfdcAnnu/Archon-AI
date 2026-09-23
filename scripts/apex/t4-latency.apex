// WHERE DOES A SIMPLE TURN'S TIME GO?
// A no-tool, no-subagent turn measured 9.2s wall clock with only 1.1s of
// model loop. This splits the remaining 8.1s into the legs we can time
// from inside Salesforce, without touching the server.
SynapseInstall__c install = SynapseInstall__c.getOrgDefaults();
String base = SynapseConfig__mdt.getInstance('Default').ServerUrl__c;
System.debug('BASE ' + base);

// Leg 1: Salesforce -> Render network + TLS, no server work.
// Run twice: the first callout in a transaction pays TLS setup.
for (Integer i = 1; i <= 2; i++) {
    Long a = System.now().getTime();
    HttpRequest hr = new HttpRequest();
    hr.setEndpoint(base.removeEnd('/') + '/health');
    hr.setMethod('GET');
    hr.setTimeout(120000);
    HttpResponse hres = new Http().send(hr);
    System.debug('LEG1_health#' + i + ' ' + (System.now().getTime() - a) + 'ms status=' + hres.getStatusCode());
}

// Leg 2: the SOQL the controller runs before it ever calls out.
Long b = System.now().getTime();
ChatSession__c s = [SELECT Id, AgentDefinition__c FROM ChatSession__c WHERE Id = 'a08g500000Ct1EmAAJ' LIMIT 1];
AgentDefinition__c ag = [SELECT Id, ApiName__c, DebugMode__c FROM AgentDefinition__c WHERE Id = :s.AgentDefinition__c LIMIT 1];
List<ChatMessage__c> hist = [
    SELECT Id, Role__c, Content__c, ToolCallsJson__c, ToolResultsJson__c
    FROM ChatMessage__c WHERE ChatSession__c = :s.Id ORDER BY SequenceNumber__c
];
List<AgentNode__c> nodes = [
    SELECT Id, NodeType__c, NodeSubType__c, ConfigJson__c, McpServer__c, McpTool__c
    FROM AgentNode__c WHERE AgentDefinition__c = :s.AgentDefinition__c
];
System.debug('LEG2_soql ' + (System.now().getTime() - b) + 'ms  history=' + hist.size() + ' nodes=' + nodes.size());

// Leg 3: how big is the payload we ship every turn?
Long c = System.now().getTime();
String body = JSON.serialize(hist);
System.debug('LEG3_serialize ' + (System.now().getTime() - c) + 'ms  historyBytes=' + body.length());

System.debug('LIMITS cpu=' + Limits.getCpuTime() + 'ms soql=' + Limits.getQueries() + ' rows=' + Limits.getQueryRows());
