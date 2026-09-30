// Communication-agent test run, step 0: free checks before any paid build.
HttpResponse h = ArchonServerClient.callout('GET', '/health', null, 60000);
System.debug('PF_HEALTH ' + h.getStatusCode() + ' ' + h.getBody().left(300));
for (AiEngineConnection__c e : [SELECT Label__c, EngineType__c, DefaultModel__c, IsActive__c, IsPreferred__c, OwnershipType__c, ValidationStatus__c FROM AiEngineConnection__c]) {
    System.debug('PF_ENGINE ' + e.Label__c + ' type=' + e.EngineType__c + ' model=' + e.DefaultModel__c + ' active=' + e.IsActive__c + ' preferred=' + e.IsPreferred__c + ' owner=' + e.OwnershipType__c + ' valid=' + e.ValidationStatus__c);
}
for (ConnectorCatalog__mdt c : [SELECT DeveloperName, McpServerUrl__c FROM ConnectorCatalog__mdt WHERE McpServerUrl__c != null]) {
    System.debug('PF_MCP ' + c.DeveloperName + ' ' + c.McpServerUrl__c);
}
System.debug('PF_COUNTS agents=' + [SELECT COUNT() FROM AgentDefinition__c]
    + ' leads=' + [SELECT COUNT() FROM Lead] + ' contacts=' + [SELECT COUNT() FROM Contact]
    + ' cases=' + [SELECT COUNT() FROM Case] + ' opps=' + [SELECT COUNT() FROM Opportunity]
    + ' products=' + [SELECT COUNT() FROM Product2 WHERE IsActive = true]
    + ' stdPricebook=' + [SELECT COUNT() FROM Pricebook2 WHERE IsStandard = true]
    + ' testLeftovers=' + [SELECT COUNT() FROM Lead WHERE Company LIKE '[ARCHON TEST]%']);
List<String> industries = new List<String>();
for (Schema.PicklistEntry p : Lead.Industry.getDescribe().getPicklistValues()) if (p.isActive()) industries.add(p.getValue());
System.debug('PF_INDUSTRY ' + String.join(industries, '|'));
List<String> statuses = new List<String>();
for (Schema.PicklistEntry p : Lead.Status.getDescribe().getPicklistValues()) if (p.isActive()) statuses.add(p.getValue());
System.debug('PF_LEADSTATUS ' + String.join(statuses, '|'));
List<String> prios = new List<String>();
for (Schema.PicklistEntry p : Case.Priority.getDescribe().getPicklistValues()) if (p.isActive()) prios.add(p.getValue());
System.debug('PF_CASEPRIORITY ' + String.join(prios, '|'));
for (AgentDefinition__c a : [SELECT ApiName__c, ExecuteType__c, Status__c FROM AgentDefinition__c ORDER BY CreatedDate DESC LIMIT 15]) {
    System.debug('PF_AGENT ' + a.ApiName__c + ' ' + a.ExecuteType__c + ' ' + a.Status__c);
}
