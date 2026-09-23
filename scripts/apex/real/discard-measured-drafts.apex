// Removes the Draft agents the measured Architect builds saved. Deliberately narrow:
// only these two Drafts by API name, never the real intake agent
// (whatsapp_lead_intake_qualifier) and never a built-in.
List<AgentDefinition__c> drafts = [
    SELECT Id, Name, ApiName__c, Status__c, IsSystem__c
    FROM AgentDefinition__c
    WHERE ApiName__c IN ('whatsapp_lead_capture_and_qualification', 'whatsapp_lead_qualification_agent')
      AND Status__c = 'Draft'
      AND (IsSystem__c = false OR IsSystem__c = null)
];
System.debug('DRAFTS ' + drafts.size());
for (AgentDefinition__c d : drafts) {
    System.debug('DISCARD ' + d.ApiName__c + ' ' + d.Id);
    AgentBuilderController.deleteAgent(d.Id);
}
System.debug('DONE');
