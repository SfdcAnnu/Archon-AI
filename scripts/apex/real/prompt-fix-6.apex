// Round 6, one line: the WhatsApp agent's guardrail said every write needs approval.
// None of its tools is marked for approval, so the sentence only ever made the model
// hold a write back or tell the customer a saved value was "waiting to be saved".
AgentNode__c n = [SELECT Id, ConfigJson__c FROM AgentNode__c WHERE Id = 'a02g500000CexwvAAB'];
Map<String, Object> cfg = (Map<String, Object>) JSON.deserializeUntyped(n.ConfigJson__c);
String p = (String) cfg.get('systemPrompt');
System.debug('BEFORE_LEN ' + p.length());
String line = '- All write actions require approval; if approval is pending, tell the customer their request is waiting to be saved.\n';
System.debug('FOUND ' + p.contains(line));
p = p.replace(line, '');
cfg.put('systemPrompt', p);
n.ConfigJson__c = JSON.serialize(cfg);
update n;
System.debug('AFTER_LEN ' + p.length());
System.debug('STILL_THERE ' + p.contains('require approval'));
