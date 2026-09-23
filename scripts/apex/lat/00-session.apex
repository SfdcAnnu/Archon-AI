// End the current session so startSession opens a genuinely new one --
// otherwise history keeps growing and every turn's input tokens grow with
// it, which would show up as latency that is really prompt size.
for (ChatSession__c old : [SELECT Id FROM ChatSession__c WHERE Status__c = 'Active' AND RecordContextId__c = '00Qg5000008cYQfEAM']) {
    old.Status__c = 'Ended';
    update old;
}
AgentChatController.SessionWithMessages s = AgentChatController.startSession(
    'whatsapp_lead_intake_qualifier', '00Qg5000008cYQfEAM', 'Lead');
System.debug('SESSION ' + s.session.Id);
