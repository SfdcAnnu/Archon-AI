// Opens a fresh Chat-path session with the intake agent (no phone, no record) and prints its id.
// Any earlier Active session of this user with the agent is ended first, so a measurement never
// continues a conversation polluted by a previous run. A turn cannot follow in the same
// execution: the insert here would make the callout refuse.
List<ChatSession__c> stale = [
    SELECT Id FROM ChatSession__c
    WHERE AgentDefinition__r.ApiName__c = 'whatsapp_lead_intake_qualifier'
      AND User__c = :UserInfo.getUserId()
      AND Status__c = 'Active'
      AND RecordContextId__c = null
];
for (ChatSession__c s : stale) s.Status__c = 'Ended';
if (!stale.isEmpty()) update stale;
System.debug('BG_ENDED ' + stale.size());
AgentChatController.SessionWithMessages s = AgentChatController.startSession('whatsapp_lead_intake_qualifier', null, null);
System.debug('BG_SESSION ' + s.session.Id);
