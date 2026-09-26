// Turn one agent into a Communication agent: type Chat, trigger node and its wire removed.
String apiName = 'opportunity_activity_and_account_rating_viewer';
AgentDefinition__c a = [SELECT Id, ExecuteType__c, CanvasJson__c FROM AgentDefinition__c WHERE ApiName__c = :apiName LIMIT 1];
List<AgentNode__c> nodes = [SELECT Id, NodeType__c, SortOrder__c FROM AgentNode__c WHERE AgentDefinition__c = :a.Id ORDER BY SortOrder__c];
Integer triggerIndex = -1;
for (Integer i = 0; i < nodes.size(); i++) { if (nodes[i].NodeType__c == 'trigger') triggerIndex = i; }
System.debug('FIX before type=' + a.ExecuteType__c + ' triggerIndex=' + triggerIndex + ' nodes=' + nodes.size());
if (triggerIndex != nodes.size() - 1) { System.debug('FIX abort: trigger is not the last node'); return; }
Map<String, Object> canvas = (Map<String, Object>) JSON.deserializeUntyped(a.CanvasJson__c);
List<Object> kept = new List<Object>();
for (Object o : (List<Object>) canvas.get('connections')) {
    Map<String, Object> c = (Map<String, Object>) o;
    if ((Integer) c.get('fromIndex') == triggerIndex || (Integer) c.get('toIndex') == triggerIndex) continue;
    kept.add(c);
}
canvas.put('connections', kept);
a.CanvasJson__c = JSON.serialize(canvas);
a.ExecuteType__c = 'Chat';
update a;
delete nodes[triggerIndex];
System.debug('FIX after type=Chat connections=' + kept.size() + ' nodes=' + (nodes.size() - 1));
