AgentDefinition__c a = [SELECT Id FROM AgentDefinition__c WHERE ApiName__c = 'sales_contact_lookup_assistant'];
List<AgentNode__c> ns = [SELECT Id FROM AgentNode__c WHERE AgentDefinition__c = :a.Id AND NodeType__c IN ('ai','subagent') AND AiEngineConnection__c = null];
List<AiEngineConnection__c> k = [SELECT Id, Label__c FROM AiEngineConnection__c WHERE IsActive__c = true AND IsPreferred__c = true AND EngineType__c = 'openai' LIMIT 1];
for (AgentNode__c n : ns) n.AiEngineConnection__c = k[0].Id;
update ns;
System.debug('BOUND ' + ns.size() + ' to ' + k[0].Label__c);
