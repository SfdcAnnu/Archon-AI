// Delete every agent the communication-agent test runs built, with their conversations (user asked, 1 Oct 2026).
Set<String> names = new Set<String>{ 'customer_case_support_chat', 'inbound_lead_qualification_booker', 'inbound_lead_qualification_chat', 'sales_contact_lookup_assistant', 'sales_desk', 'sales_desk_chat_agent', 'sales_desk_customer_chat', 'sunpeak_solar_website_chat', 'website_lead_capture_chat' };
List<AgentDefinition__c> agents = [SELECT Id, Name FROM AgentDefinition__c WHERE ApiName__c IN :names AND (IsSystem__c = false OR IsSystem__c = null)];
Set<Id> agentIds = new Map<Id, AgentDefinition__c>(agents).keySet();
List<ChatSession__c> sessions = [SELECT Id FROM ChatSession__c WHERE AgentDefinition__c IN :agentIds];
List<ChatMessage__c> messages = [SELECT Id FROM ChatMessage__c WHERE ChatSession__c IN :sessions];
System.debug('DEL agents=' + agents.size() + ' sessions=' + sessions.size() + ' messages=' + messages.size());
delete messages;
delete sessions;
for (AgentDefinition__c a : agents) {
    try { AgentBuilderController.deleteAgent(a.Id); System.debug('DEL ok ' + a.Name); }
    catch (Exception e) { System.debug('DEL FAILED ' + a.Name + ' | ' + e.getMessage().left(300)); }
}
for (AgentDefinition__c a : [SELECT Name, ApiName__c FROM AgentDefinition__c ORDER BY CreatedDate]) System.debug('LEFT ' + a.ApiName__c);
