// Full graph of one agent: every node (index, type, name, enabled, config) and every wire by index and port.
String api = 'deal_risk_review';
AgentDefinition__c a = [SELECT Id, CanvasJson__c, SetupChecklistJson__c FROM AgentDefinition__c WHERE ApiName__c = :api LIMIT 1];
Integer i = 0;
for (AgentNode__c n : [SELECT Name, NodeType__c, NodeSubType__c, IsEnabled__c, ConfigJson__c FROM AgentNode__c WHERE AgentDefinition__c = :a.Id ORDER BY SortOrder__c]) {
  String c = n.ConfigJson__c == null ? '' : n.ConfigJson__c.replace('\n', ' ');
  if (n.NodeType__c == 'ai' && !c.contains('"step":true')) c = c.left(300) + ' …(root prompt ' + c.length() + ' chars)';
  for (Integer k = 0; k < c.length(); k += 1500) System.debug('GD node ' + i + (k > 0 ? ' (cont)' : ' ' + n.NodeType__c + '/' + n.NodeSubType__c + ' [' + n.Name + '] enabled=' + n.IsEnabled__c) + ' :: ' + c.substring(k, Math.min(k + 1500, c.length())));
  i++;
}
Map<String, Object> canvas = (Map<String, Object>) JSON.deserializeUntyped(a.CanvasJson__c);
for (Object o : (List<Object>) canvas.get('connections')) {
  Map<String, Object> c = (Map<String, Object>) o;
  System.debug('GD wire ' + c.get('fromIndex') + ' -' + c.get('fromPort') + '-> ' + c.get('toIndex'));
}
System.debug('GD checklist ' + (a.SetupChecklistJson__c == null ? '' : a.SetupChecklistJson__c.left(1500)));
