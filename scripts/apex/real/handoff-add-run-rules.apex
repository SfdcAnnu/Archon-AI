// Puts the platform's current AUTOMATION RUN RULES (server-langchain/src/architect/run-rules.ts, exact text)
// on the Closed Won Handoff agent, which was saved before the compiler added them. Replaces an older copy.
AgentNode__c root = [SELECT Id, ConfigJson__c FROM AgentNode__c WHERE AgentDefinition__r.ApiName__c = 'closed_won_handoff' AND NodeType__c = 'ai' LIMIT 1];
Map<String, Object> cfg = (Map<String, Object>) JSON.deserializeUntyped(root.ConfigJson__c);
String p = (String) cfg.get('systemPrompt');
String rules = 'AUTOMATION RUN RULES (the platform adds these to every automation agent; they override anything above that disagrees):\n1. CHECK THE LIVE DATA ON EVERY RUN. Before you decide that a step is done or not needed, query the records it would create or change. Never treat a Description, a summary, a note, a Chatter post or anything an earlier run wrote as proof that work was done — records may have been deleted or changed since. A re-run makes every check again and creates only what is actually missing.\n2. COUNT AFTER YOU WRITE. Every number you report — in a post, a message, a field or a summary — is counted from the records as they stand after this run\'s writes (query them again if you need to), never from what you planned to write.\n3. USE THE REQUIREMENT\'S WORDS. Where these instructions give the words for an outcome (whatever they say for created, skipped, already there or not needed), write exactly those words, not your own phrasing.\n4. WRITE THE SUMMARY LAST, from what the records show after every other step, so it never claims something the org does not have.';
Integer at = p.indexOf('AUTOMATION RUN RULES');
String base = at >= 0 ? p.substring(0, at).trim() : p.trim();
cfg.put('systemPrompt', base + '\n\n' + rules);
root.ConfigJson__c = JSON.serialize(cfg);
update root;
System.debug('RR set, prompt length now ' + ((String) cfg.get('systemPrompt')).length());
