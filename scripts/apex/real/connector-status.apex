// What the Connectors page shows: every catalog entry and whether this org has it connected.
for (AgentConnectorController.DirectoryEntry e : AgentConnectorController.getDirectory()) {
    System.debug('CONN ' + JSON.serialize(e));
}
// The agents in the org, for a clean-up list.
for (AgentDefinition__c a : [SELECT Name, ApiName__c, Status__c, ExecuteType__c, IsSystem__c, TotalExecutions__c, CreatedDate, LastModifiedDate FROM AgentDefinition__c ORDER BY CreatedDate]) {
    System.debug('AGENT ' + a.Status__c + ' | ' + a.ExecuteType__c + ' | sys=' + a.IsSystem__c + ' | runs=' + a.TotalExecutions__c + ' | ' + a.CreatedDate.format('yyyy-MM-dd') + ' | ' + a.Name + ' | ' + a.ApiName__c);
}
