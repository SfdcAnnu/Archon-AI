// Test data for the Account Open Opportunity Follow-Up agent: one Account, one open deal per rule.
//   A overdue      -> CloseDate 10 days ago                      -> High Task + Outlook email to manager
//   B stale, big   -> future close, last done activity 20 days ago, 80,000 -> Gmail email to owner
//   C stale, small -> future close, last done activity 20 days ago, 20,000 -> Normal Task due +3
//   D recent       -> future close, last done activity 2 days ago, 90,000  -> nothing
// Plus one CLOSED deal that must be ignored.
Account a = new Account(Name = 'ARCHON TEST - Follow-up agent', Description = 'before test');
insert a;
Date t = Date.today();
List<Opportunity> opps = new List<Opportunity>{
  new Opportunity(Name = 'TEST A overdue', AccountId = a.Id, StageName = 'Proposal/Price Quote', CloseDate = t.addDays(-10), Amount = 30000),
  new Opportunity(Name = 'TEST B stale big', AccountId = a.Id, StageName = 'Negotiation/Review', CloseDate = t.addDays(30), Amount = 80000),
  new Opportunity(Name = 'TEST C stale small', AccountId = a.Id, StageName = 'Qualification', CloseDate = t.addDays(30), Amount = 20000),
  new Opportunity(Name = 'TEST D recent', AccountId = a.Id, StageName = 'Needs Analysis', CloseDate = t.addDays(30), Amount = 90000),
  new Opportunity(Name = 'TEST E closed', AccountId = a.Id, StageName = 'Closed Won', CloseDate = t.addDays(-5), Amount = 10000)
};
insert opps;
List<Task> done = new List<Task>{
  new Task(WhatId = opps[1].Id, Subject = 'TEST past call', Status = 'Completed', ActivityDate = t.addDays(-20), OwnerId = UserInfo.getUserId()),
  new Task(WhatId = opps[2].Id, Subject = 'TEST past call', Status = 'Completed', ActivityDate = t.addDays(-20), OwnerId = UserInfo.getUserId()),
  new Task(WhatId = opps[3].Id, Subject = 'TEST recent call', Status = 'Completed', ActivityDate = t.addDays(-2), OwnerId = UserInfo.getUserId())
};
insert done;
User me = [SELECT Id, Email, ManagerId, Manager.Email FROM User WHERE Id = :UserInfo.getUserId()];
System.debug('TD account=' + a.Id + ' owner=' + me.Email + ' manager=' + (me.ManagerId == null ? 'NONE' : me.Manager.Email));
for (Opportunity o : [SELECT Name, CloseDate, Amount, StageName, LastActivityDate FROM Opportunity WHERE AccountId = :a.Id ORDER BY Name]) {
  System.debug('TD opp ' + o.Name + ' close=' + o.CloseDate + ' amount=' + o.Amount + ' stage=' + o.StageName + ' lastActivity=' + o.LastActivityDate);
}
