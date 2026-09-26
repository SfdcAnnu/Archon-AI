// Marks the intake agent's two write tools as background tools (runInBackground on the tool node).
// Pass 'off' semantics by editing the Boolean below; the flag is read by lc/background-tools.ts.
Boolean on = true;
List<AgentNode__c> nodes = [
    SELECT Id, Name, ConfigJson__c FROM AgentNode__c
    WHERE Id IN ('a02g500000CexwzAAB', 'a02g500000Cexx0AAB')
];
for (AgentNode__c n : nodes) {
    Map<String, Object> cfg = (Map<String, Object>) JSON.deserializeUntyped(n.ConfigJson__c);
    cfg.put('runInBackground', on);
    n.ConfigJson__c = JSON.serialize(cfg);
    System.debug('BGF ' + n.Name + ' runInBackground=' + on + ' requiresApproval=' + cfg.get('requiresApproval'));
}
update nodes;
System.debug('BGF DONE ' + nodes.size());
