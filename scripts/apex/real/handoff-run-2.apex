// One run of the Closed Won Handoff agent on test case 2, exactly as a Flow on Opportunity calls it.
AgentInvokeAction.Request r = new AgentInvokeAction.Request();
r.agent = 'closed_won_handoff';
r.agentType = 'Automation';
r.recordId = '006g5000009hmFWAAY';
Long t0 = System.now().getTime();
AgentInvokeAction.Result res = AgentInvokeAction.run(new List<AgentInvokeAction.Request>{ r })[0];
System.debug('RUN ms=' + (System.now().getTime() - t0) + ' success=' + res.success + ' status=' + res.status + ' error=' + res.errorMessage);
