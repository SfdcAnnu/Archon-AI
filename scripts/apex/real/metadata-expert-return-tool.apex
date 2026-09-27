// Gives the org's Metadata Expert the "hand back to Archon" tool (platform tool
// return_to_previous_agent) and the one rule for when to use it. The platform's
// seed spec has both for new orgs; this org's copy was seeded before, and it is
// org-owned, so it is updated here. Safe to run twice.
String api = 'metadata_expert';
AgentDefinition__c a = [SELECT Id, CanvasJson__c FROM AgentDefinition__c WHERE ApiName__c = :api LIMIT 1];
List<AgentNode__c> nodes = [SELECT Id, Name, NodeType__c, SortOrder__c, ConfigJson__c FROM AgentNode__c WHERE AgentDefinition__c = :a.Id ORDER BY SortOrder__c];
for (AgentNode__c n : nodes) {
  if (n.ConfigJson__c != null && n.ConfigJson__c.contains('return_to_previous_agent')) { System.debug('MRT already has the tool'); return; }
}
Integer rootIndex = -1;
AgentNode__c root = null;
Decimal maxSort = 0;
for (Integer i = 0; i < nodes.size(); i++) {
  if (nodes[i].NodeType__c == 'ai' && root == null) { root = nodes[i]; rootIndex = i; }
  if (nodes[i].SortOrder__c > maxSort) maxSort = nodes[i].SortOrder__c;
}
if (root == null) { System.debug('MRT no root node'); return; }

AgentNode__c tool = new AgentNode__c(
  AgentDefinition__c = a.Id,
  Name = 'Hand back to Archon',
  NodeType__c = 'tool',
  NodeSubType__c = 'mcp',
  SortOrder__c = maxSort + 1,
  IsEnabled__c = true,
  PositionX__c = 700,
  PositionY__c = 40,
  ConfigJson__c = JSON.serialize(new Map<String, Object>{
    'description' => 'Hand the conversation back to Archon when the job it gave you is done, with a short summary.',
    'actionType' => 'MCP',
    'toolName' => 'return_to_previous_agent',
    'connectorId' => 'archon_platform',
    'requiresApproval' => false
  })
);
insert tool;

// Connections are stored by node index in SortOrder order; the new node is last.
Integer toolIndex = nodes.size();
Map<String, Object> canvas = String.isBlank(a.CanvasJson__c) ? new Map<String, Object>() : (Map<String, Object>) JSON.deserializeUntyped(a.CanvasJson__c);
List<Object> conns = canvas.containsKey('connections') ? (List<Object>) canvas.get('connections') : new List<Object>();
conns.add(new Map<String, Object>{ 'id' => 'e' + rootIndex + ':tool-' + toolIndex + ':in', 'fromIndex' => rootIndex, 'toIndex' => toolIndex, 'fromPort' => 'tool', 'toPort' => 'in' });
canvas.put('connections', conns);
a.CanvasJson__c = JSON.serialize(canvas);
update a;

Map<String, Object> cfg = (Map<String, Object>) JSON.deserializeUntyped(root.ConfigJson__c);
String prompt = (String) cfg.get('systemPrompt');
String rule = 'HANDED OVER BY ARCHON. When the conversation came from Archon (the first message says why it is needed), you are doing one job for it. '
  + 'Once that job is deployed, or the person says they are done or want to go back, call return_to_previous_agent with a short summary: what was created '
  + 'or changed (API names), and anything still open. Archon then carries on with the task it was doing.';
if (prompt != null && !prompt.contains('HANDED OVER BY ARCHON')) {
  cfg.put('systemPrompt', prompt + '\n' + rule);
  root.ConfigJson__c = JSON.serialize(cfg);
  update root;
}
System.debug('MRT added tool node at index ' + toolIndex + ' wired from root ' + rootIndex);
