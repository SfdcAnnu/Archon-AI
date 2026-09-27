// What the follow-up agent actually changed on the test Account.
Id acct = '001g500000itc05AAA';
Account a = [SELECT Description FROM Account WHERE Id = :acct];
System.debug('CHK description=' + a.Description);
for (Task t : [SELECT Subject, Priority, Status, ActivityDate, What.Name, Owner.Name, CreatedDate FROM Task WHERE WhatId IN (SELECT Id FROM Opportunity WHERE AccountId = :acct) AND Subject != 'TEST past call' AND Subject != 'TEST recent call']) {
  System.debug('CHK task ' + t.What.Name + ' | ' + t.Subject + ' | ' + t.Priority + ' | due ' + t.ActivityDate);
}
for (Opportunity o : [SELECT Name, StageName, Amount, CloseDate FROM Opportunity WHERE AccountId = :acct ORDER BY Name]) System.debug('CHK opp ' + o.Name + ' ' + o.StageName + ' ' + o.Amount + ' ' + o.CloseDate);
for (AgentExecution__c e : [SELECT Status__c, ExecutionMs__c, ErrorMessage__c, ToolsUsed__c, CreatedDate FROM AgentExecution__c WHERE RecordId__c = :acct ORDER BY CreatedDate DESC LIMIT 3]) System.debug('CHK exec ' + e.Status__c + ' ms=' + e.ExecutionMs__c + ' tools=' + e.ToolsUsed__c + ' err=' + e.ErrorMessage__c);
