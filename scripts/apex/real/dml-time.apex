// Is the ORG slow on this Lead, or is the slowness in the MCP write path?
Lead l = [SELECT Id, Project_Type__c, Project_Name__c FROM Lead WHERE Id='00Qg5000008cYQfEAM'];
Long t0 = System.now().getTime();
l.Project_Type__c = 'Villa';
l.Project_Name__c = 'Villa Project B';
update l;
System.debug('DML_MS ' + (System.now().getTime() - t0));
System.debug('LIMITS cpu=' + Limits.getCpuTime() + ' dml=' + Limits.getDmlStatements());
