// Delete the agents the user chose (27 Sep 2026: list items 6-11), through the Agents page's own path.
Set<String> names = new Set<String>{
    'sales_desk_assistant',
    'noida_real_estate_sales_assistant',
    'metadata_smoke',
    'test_automation_mufq0apb',
    'opportunity_risk_scoring_automation'
};
List<AgentDefinition__c> targets = [SELECT Id, Name, ApiName__c, IsSystem__c FROM AgentDefinition__c
    WHERE (ApiName__c IN :names OR ApiName__c LIKE 'opportunity_activity_and_account_rat%') AND (IsSystem__c = false OR IsSystem__c = null)];
System.debug('DEL found ' + targets.size());
for (AgentDefinition__c a : targets) {
    try {
        AgentBuilderController.deleteAgent(a.Id);
        System.debug('DEL ok ' + a.Name + ' | ' + a.ApiName__c);
    } catch (Exception e) {
        System.debug('DEL FAILED ' + a.Name + ' | ' + e.getMessage());
    }
}
for (AgentDefinition__c a : [SELECT Name, ApiName__c, Status__c FROM AgentDefinition__c ORDER BY CreatedDate]) {
    System.debug('LEFT ' + a.Status__c + ' | ' + a.Name);
}
