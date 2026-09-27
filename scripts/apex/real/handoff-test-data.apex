// Test data for the Closed Won Handoff agent: three labelled cases.
//  Case 1 — full handoff: Prospect Account, New Customer, 120,000, closed on a Friday; Decision Maker + Technical Buyer,
//           no primary, no Economic Buyer; two finance Contacts (first by Name must win).
//  Case 2 — not Closed Won: only the skip line, nothing else touched.
//  Case 3 — small existing-customer deal with a primary Economic Buyer: almost nothing to do.
Id me = UserInfo.getUserId();
Date friday = Date.newInstance(2026, 9, 25);

Account a1 = new Account(Name = 'ARCHON TEST - Handoff', Type = 'Prospect', Description = 'before test');
Account a2 = new Account(Name = 'ARCHON TEST - Handoff Skip', Type = 'Prospect', Description = 'before test');
Account a3 = new Account(Name = 'ARCHON TEST - Handoff Small', Type = 'Customer - Direct', Rating = 'Warm', Description = 'before test');
insert new List<Account>{ a1, a2, a3 };

List<Contact> cs = new List<Contact>{
  new Contact(AccountId = a1.Id, FirstName = 'Zed', LastName = 'Kumar', Title = 'Finance Manager', Email = 'zed.kumar@example.com'),
  new Contact(AccountId = a1.Id, FirstName = 'Asha', LastName = 'Rao', Title = 'CFO', Email = 'asha.rao@example.com'),
  new Contact(AccountId = a1.Id, FirstName = 'Dev', LastName = 'Patel', Title = 'Head of Operations', Email = 'dev.patel@example.com'),
  new Contact(AccountId = a1.Id, FirstName = 'Eli', LastName = 'Stone', Title = 'Engineer', Email = 'eli.stone@example.com'),
  new Contact(AccountId = a3.Id, FirstName = 'Mia', LastName = 'Chen', Title = 'VP Finance', Email = 'mia.chen@example.com')
};
insert cs;

Opportunity o1 = new Opportunity(Name = 'TEST Handoff Deal', AccountId = a1.Id, StageName = 'Closed Won', Type = 'New Customer', Amount = 120000, CloseDate = friday, OwnerId = me);
Opportunity o2 = new Opportunity(Name = 'TEST Handoff Not Won', AccountId = a2.Id, StageName = 'Negotiation/Review', Type = 'New Customer', Amount = 150000, CloseDate = friday.addDays(30), OwnerId = me);
Opportunity o3 = new Opportunity(Name = 'TEST Handoff Small', AccountId = a3.Id, StageName = 'Closed Won', Type = 'Existing Customer - Upgrade', Amount = 40000, CloseDate = friday, OwnerId = me);
insert new List<Opportunity>{ o1, o2, o3 };

insert new List<OpportunityContactRole>{
  new OpportunityContactRole(OpportunityId = o1.Id, ContactId = cs[2].Id, Role = 'Decision Maker', IsPrimary = false),
  new OpportunityContactRole(OpportunityId = o1.Id, ContactId = cs[3].Id, Role = 'Technical Buyer', IsPrimary = false),
  new OpportunityContactRole(OpportunityId = o3.Id, ContactId = cs[4].Id, Role = 'Economic Buyer', IsPrimary = true)
};
System.debug('HT case1 opp=' + o1.Id + ' acct=' + a1.Id);
System.debug('HT case2 opp=' + o2.Id + ' acct=' + a2.Id);
System.debug('HT case3 opp=' + o3.Id + ' acct=' + a3.Id);
