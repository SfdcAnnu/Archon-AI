ChatSession__c s = [SELECT Id FROM ChatSession__c WHERE Status__c = 'Active' AND RecordContextId__c = '00Qg5000008cYQfEAM' ORDER BY CreatedDate DESC LIMIT 1];
Long t0 = System.now().getTime();
AgentChatController.TurnResult r = AgentChatController.sendTurn(s.Id, 'hi', null);
System.debug('WARM_DONE ' + (System.now().getTime() - t0) + 'ms');
