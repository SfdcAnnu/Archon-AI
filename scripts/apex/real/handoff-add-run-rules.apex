// Adds the platform's AUTOMATION RUN RULES (server-langchain/src/architect/run-rules.ts, exact text)
// to the Closed Won Handoff agent, which was saved before the compiler added them. Safe to run twice.
AgentNode__c root = [SELECT Id, ConfigJson__c FROM AgentNode__c WHERE AgentDefinition__r.ApiName__c = 'closed_won_handoff' AND NodeType__c = 'ai' LIMIT 1];
Map<String, Object> cfg = (Map<String, Object>) JSON.deserializeUntyped(root.ConfigJson__c);
String p = (String) cfg.get('systemPrompt');
String rules = 'AUTOMATION RUN RULES (the platform adds these to every automation agent; they override anything above that disagrees):\n1. CHECK THE LIVE DATA ON EVERY RUN. Before you decide that a step is done or not needed, query the records it would create or change. Never treat a Description, a summary, a note, a Chatter post or anything an earlier run wrote as proof that work was done — records may have been deleted or changed since. A re-run makes every check again and creates only what is actually missing.\n2. COUNT AFTER YOU WRITE. Every number you report — in a post, a message, a field or a summary — is counted from the records as they stand after this run\'s writes (query them again if you need to), never from what you planned to write.\n3. USE THE REQUIREMENT\'S WORDS. Where these instructions give the words for an outcome (for example "already open", "not a new customer", "no assets"), write exactly those words, not your own phrasing.\n4. WRITE THE SUMMARY LAST, from what the records show after every other step, so it never claims something the org does not have.';
if (p.contains('AUTOMATION RUN RULES')) { System.debug('RR already there'); return; }
cfg.put('systemPrompt', p.trim() + '\n\n' + rules);
root.ConfigJson__c = JSON.serialize(cfg);
update root;
System.debug('RR added, prompt length now ' + ((String) cfg.get('systemPrompt')).length());
