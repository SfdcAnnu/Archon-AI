// The Metadata Expert is org-owned: a change to its seed spec
// (server-langchain/src/platform/agents/metadata-expert.ts) does not reach
// the org copy. This applies the same three wording changes to it:
// specialists describe an object once and trust earlier results, the root
// names earlier components in its brief, and Refresh catalog is only for
// changes made outside the chat. Safe to run again: it only replaces text
// that is still the old wording.
Map<String, String> swaps = new Map<String, String>{
    'with fieldsLike, one call per object. Never describe User.' =>
        'Describe an object ONCE per task, without fieldsLike, and take every field you need from that one result — never describe the same object again with other filters, and never list_metadata or retrieve the same thing twice. Never describe User. \'ALREADY ESTABLISHED IN THIS CONVERSATION\' under your brief is what earlier calls created or found: trust it and do not read those components again unless you are modifying one.',
    'reads the org. When it returns a changeId' =>
        'reads the org. When earlier turns created or changed components this task builds on, name them in the brief with their API names; the specialist also receives the earlier results and must not read them from the org again. When it returns a changeId',
    'Clear the describe and action caches after changes made outside this agent.' =>
        'Clear the describe and action caches — only when the person says something was changed outside this chat (in Setup or another tool). Never after this agent\'s own deploys, and never to double-check.'
};
List<AgentNode__c> changed = new List<AgentNode__c>();
for (AgentNode__c n : [SELECT Id, Name, ConfigJson__c FROM AgentNode__c WHERE AgentDefinition__r.ApiName__c = 'metadata_expert']) {
    String c = n.ConfigJson__c;
    if (c == null) continue;
    String before = c;
    for (String oldText : swaps.keySet()) {
        c = c.replace(oldText, swaps.get(oldText));
    }
    if (c != before) { n.ConfigJson__c = c; changed.add(n); }
}
update changed;
for (AgentNode__c n : changed) System.debug('PATCHED|' + n.Name);
System.debug('PATCHED|total ' + changed.size());
