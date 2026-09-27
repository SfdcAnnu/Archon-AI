// Does the Closed Won Handoff agent's instructions carry the requirement's exact wording and values?
AgentNode__c root = [SELECT ConfigJson__c FROM AgentNode__c WHERE AgentDefinition__r.ApiName__c = 'closed_won_handoff' AND NodeType__c = 'ai' LIMIT 1];
String p = (String) ((Map<String, Object>) JSON.deserializeUntyped(root.ConfigJson__c)).get('systemPrompt');
List<String> must = new List<String>{
  'Handoff skipped', 'not Closed Won', 'Customer - Direct', 'Prospect', '100,000', 'Hot', 'Economic Buyer', 'CFO', 'Finance', 'first by Name',
  'no finance contact', 'Decision Maker', 'Welcome call with', '3 business days', 'Saturday', 'Name a primary contact for', 'Existing Customer - Upgrade',
  'Renewal', '12 months', 'Prospecting', 'Closed Won: ', 'handoff done', 'welcome calls booked', 'thousands', 'Handoff {', 'Account unchanged',
  'already open', 'already posted', 'twice'
};
List<String> missing = new List<String>();
for (String m : must) if (!p.contains(m)) missing.add(m);
System.debug('PC length=' + p.length() + ' checked=' + must.size() + ' missing=' + missing);
for (Integer i = 0; i < Math.min(p.length(), 11000); i += 900) System.debug('PC text ' + p.substring(i, Math.min(i + 900, p.length())).replace('\n', ' / '));
