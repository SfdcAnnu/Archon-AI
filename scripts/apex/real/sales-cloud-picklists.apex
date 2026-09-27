// Standard Sales Cloud picklist values the handoff requirement relies on.
Map<String, Schema.SObjectField> pick = new Map<String, Schema.SObjectField>{
  'Opportunity.StageName' => Opportunity.StageName, 'Opportunity.Type' => Opportunity.Type,
  'Account.Type' => Account.Type, 'Account.Rating' => Account.Rating,
  'OpportunityContactRole.Role' => OpportunityContactRole.Role, 'Task.Priority' => Task.Priority, 'Product2.Family' => Product2.Family
};
for (String k : pick.keySet()) {
  List<String> v = new List<String>();
  for (Schema.PicklistEntry e : pick.get(k).getDescribe().getPicklistValues()) if (e.isActive()) v.add(e.getValue());
  System.debug('PL ' + k + ' = ' + String.join(v, ' | '));
}
System.debug('PL standardPricebook=' + [SELECT Id, IsActive FROM Pricebook2 WHERE IsStandard = true]);
System.debug('PL fiscal/business hours default=' + [SELECT Id, Name FROM BusinessHours WHERE IsDefault = true]);
