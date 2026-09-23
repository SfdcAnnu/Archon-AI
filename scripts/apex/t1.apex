// A turn anchored to a Lead. If today's record-context change works, the
// agent answers from the prompt block and never calls soqlQuery.
Long t0 = System.now().getTime();
AgentChatController.SessionWithMessages s =
    AgentChatController.startSession('whatsapp_lead_intake_qualifier', '00Qg5000008cYQfEAM', 'Lead');
System.debug('SESSION ' + s.session.Id + ' rc=' + s.session.RecordContextId__c + ' type=' + s.session.RecordContextType__c);

AgentChatController.TurnResult r =
    AgentChatController.sendTurn(s.session.Id, 'What is this lead\'s email address? Answer in one short sentence.', null);
Long ms = System.now().getTime() - t0;

System.debug('STATUS ' + r.status + ' | ms=' + ms);
for (ChatMessage__c m : r.newMessages) {
  System.debug('MSG role=' + m.Role__c + ' tools=' + m.ToolCallsJson__c);
  System.debug('TEXT ' + m.Content__c);
}
