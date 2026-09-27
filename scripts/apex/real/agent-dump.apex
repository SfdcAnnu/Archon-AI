// Prints an agent's wiring and each node's config, in chunks.
String api = 'closed_won_handoff';
AgentDefinition__c a = [SELECT Id, CanvasJson__c, Description__c FROM AgentDefinition__c WHERE ApiName__c = :api LIMIT 1];
System.debug('AD canvas ' + a.CanvasJson__c.left(3000));
Integer i = 0;
for (AgentNode__c n : [SELECT Name, NodeType__c, NodeSubType__c, IsEnabled__c, SortOrder__c, ConfigJson__c FROM AgentNode__c WHERE AgentDefinition__c = :a.Id ORDER BY SortOrder__c]) {
  String c = n.ConfigJson__c == null ? '' : n.ConfigJson__c;
  System.debug('AD node ' + n.SortOrder__c + ' ' + n.NodeType__c + '/' + n.NodeSubType__c + ' ' + n.Name + ' enabled=' + n.IsEnabled__c + ' cfglen=' + c.length());
  if (n.NodeType__c != 'ai') System.debug('AD cfg ' + n.SortOrder__c + ' ' + c.left(900));
  else System.debug('AD prompt ' + c.left(200));
}
