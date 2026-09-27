// What refers to the Account Open Opportunity Follow-Up agent before it is deleted.
Id agentId = 'a00g5000017y5OUAAY';
System.debug('FP nodes=' + [SELECT COUNT() FROM AgentNode__c WHERE AgentDefinition__c = :agentId]);
System.debug('FP executions=' + [SELECT COUNT() FROM AgentExecution__c WHERE AgentDefinition__c = :agentId]);
System.debug('FP sessions=' + [SELECT COUNT() FROM ChatSession__c WHERE AgentDefinition__c = :agentId]);
System.debug('FP approvals=' + [SELECT COUNT() FROM AgentApproval__c WHERE AgentApiName__c = 'account_open_opportunity_follow_up']);
for (AgentApproval__c ap : [SELECT Id, Status__c, NodeLabel__c FROM AgentApproval__c WHERE AgentApiName__c = 'account_open_opportunity_follow_up']) System.debug('FP approval ' + ap.Id + ' ' + ap.Status__c + ' ' + ap.NodeLabel__c);
// Accounts with old open Cases, for the next test.
for (AggregateResult r : [SELECT AccountId, Account.Name name, COUNT(Id) n, MIN(CreatedDate) oldest FROM Case WHERE IsClosed = false AND AccountId != null GROUP BY AccountId, Account.Name ORDER BY COUNT(Id) DESC LIMIT 8]) {
  System.debug('FP cases ' + r.get('AccountId') + ' ' + r.get('name') + ' open=' + r.get('n') + ' oldest=' + r.get('oldest'));
}
System.debug('FP openCasesTotal=' + [SELECT COUNT() FROM Case WHERE IsClosed = false]);
