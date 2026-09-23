// Throwaway turn on a fresh session anchored to the old test Lead -- NOT the
// user's session. Its only purpose is to make the server notice the agent
// definition changed: the cache serves stale for this turn and reloads behind
// it, so the user's first real message runs on the corrected prompt.
for (ChatSession__c o : [SELECT Id FROM ChatSession__c WHERE Status__c = 'Active' AND RecordContextId__c = '00Qg5000008cYQfEAM']) { o.Status__c = 'Ended'; update o; }
AgentChatController.SessionWithMessages s = AgentChatController.startSession('whatsapp_lead_intake_qualifier', '00Qg5000008cYQfEAM', 'Lead');
System.debug('WARM_SESSION ' + s.session.Id);
