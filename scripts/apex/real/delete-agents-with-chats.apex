// Delete three agents together with their conversations (user confirmed, 27 Sep 2026).
Set<String> names = new Set<String>{ 'sales_desk_assistant', 'noida_real_estate_sales_assistant', 'metadata_smoke' };
List<AgentDefinition__c> agents = [SELECT Id, Name FROM AgentDefinition__c WHERE ApiName__c IN :names AND (IsSystem__c = false OR IsSystem__c = null)];
Set<Id> agentIds = new Map<Id, AgentDefinition__c>(agents).keySet();
List<ChatSession__c> sessions = [SELECT Id FROM ChatSession__c WHERE AgentDefinition__c IN :agentIds];
List<ChatMessage__c> messages = [SELECT Id FROM ChatMessage__c WHERE ChatSession__c IN :sessions];
System.debug('DEL agents=' + agents.size() + ' sessions=' + sessions.size() + ' messages=' + messages.size());
delete messages;
delete sessions;
for (AgentDefinition__c a : agents) {
    try { AgentBuilderController.deleteAgent(a.Id); System.debug('DEL ok ' + a.Name); }
    catch (Exception e) { System.debug('DEL FAILED ' + a.Name + ' | ' + e.getMessage().left(400)); }
}
for (AgentDefinition__c a : [SELECT Name, Status__c FROM AgentDefinition__c ORDER BY CreatedDate]) System.debug('LEFT ' + a.Status__c + ' | ' + a.Name);
