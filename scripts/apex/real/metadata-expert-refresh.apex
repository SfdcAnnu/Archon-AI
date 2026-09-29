// Bring the org's Metadata Expert wording up to the shipped spec
// (server-langchain/src/platform/agents/metadata-expert.ts): instructions
// and tool descriptions only; the org's wiring, tools and models stay.
// Then show that the new wording is on the nodes.
System.debug('REFRESH|' + SystemAgentSync.refreshInstructions('metadata_expert'));
for (AgentNode__c n : [SELECT Name, NodeType__c, ConfigJson__c FROM AgentNode__c WHERE AgentDefinition__r.ApiName__c = 'metadata_expert' AND NodeType__c IN ('ai', 'subagent') ORDER BY SortOrder__c]) {
    String c = n.ConfigJson__c == null ? '' : n.ConfigJson__c;
    System.debug('REFRESH|' + n.NodeType__c + ' ' + n.Name
        + ' group=' + (c.contains('ONE GROUP, ONE CHANGE, ONE APPROVAL') || c.contains('WHOLE GROUP'))
        + ' outcomes=' + c.contains('APPROVAL OUTCOME')
        + ' maxReply=' + c.substringBetween('"maxReplyTokens":', ','));
}
for (AgentNode__c n : [SELECT Name, ConfigJson__c FROM AgentNode__c WHERE AgentDefinition__r.ApiName__c = 'metadata_expert' AND NodeType__c = 'tool' AND Name IN ('Deploy change', 'Serialize change') LIMIT 4]) {
    System.debug('REFRESH|tool ' + n.Name + ' bundle=' + (n.ConfigJson__c.contains('every component') || n.ConfigJson__c.contains('LIST of envelopes')));
}
