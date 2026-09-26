// How long does a fresh copilot session take to start, and what is it waiting on?
Long t0 = System.now().getTime();
AgentChatController.SessionWithMessages r = AgentChatController.startFreshSession('archon_copilot', null, null);
Long t1 = System.now().getTime();
System.debug('TIMING startFreshSession ms=' + (t1 - t0) + ' session=' + r.session.Id + ' messages=' + r.messages.size()
    + ' callouts=' + Limits.getCallouts() + ' soql=' + Limits.getQueries() + ' dml=' + Limits.getDmlStatements() + ' cpu=' + Limits.getCpuTime());
Long t2 = System.now().getTime();
AgentChatController.SessionWithMessages r2 = AgentChatController.startSession('archon_copilot', null, null);
Long t3 = System.now().getTime();
System.debug('TIMING startSession(reuse) ms=' + (t3 - t2) + ' session=' + r2.session.Id + ' messages=' + r2.messages.size()
    + ' callouts=' + Limits.getCallouts() + ' soql=' + Limits.getQueries());
