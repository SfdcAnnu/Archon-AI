for (ChatSession__c o : [SELECT Id FROM ChatSession__c WHERE Status__c = 'Active' AND RecordContextId__c = '00Qg5000008cYQfEAM']) {
    o.Status__c = 'Ended';
    update o;
}
AgentChatController.SessionWithMessages s = AgentChatController.startSession(
    'whatsapp_lead_intake_qualifier', '00Qg5000008cYQfEAM', 'Lead');
System.debug('SESSION ' + s.session.Id);
