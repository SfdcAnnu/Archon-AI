// Deletes the Account Open Opportunity Follow-Up agent (asked for 28 Sep 2026): its nodes, then the agent.
// Its two run records go too only when Salesforce refuses the delete because of them.
Id agentId = 'a00g5000017y5OUAAY';
List<AgentDefinition__c> a = [SELECT Id, Name FROM AgentDefinition__c WHERE Id = :agentId];
if (a.isEmpty()) { System.debug('DEL already gone'); return; }
delete [SELECT Id FROM AgentNode__c WHERE AgentDefinition__c = :agentId];
try {
  delete a;
  System.debug('DEL agent deleted; runs kept=' + [SELECT COUNT() FROM AgentExecution__c WHERE AgentDefinition__c = :agentId]);
} catch (DmlException e) {
  System.debug('DEL blocked: ' + e.getMessage().left(200));
  delete [SELECT Id FROM AgentExecution__c WHERE AgentDefinition__c = :agentId];
  delete a;
  System.debug('DEL agent deleted with its 2 run records');
}
