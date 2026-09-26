// One live run of the Opportunity Risk Scoring Automation on one open Opportunity.
AgentInvokeAction.Request r = new AgentInvokeAction.Request();
r.agent = 'opportunity_risk_scoring_automation';
r.agentType = 'Automation';
r.recordId = '006g50000099GwRAAU';
r.userQuery = 'Score this Opportunity for the risk of not closing this quarter.';
Long t0 = System.now().getTime();
AgentInvokeAction.Result res = AgentInvokeAction.run(new List<AgentInvokeAction.Request>{ r })[0];
System.debug('RISK ms=' + (System.now().getTime() - t0) + ' success=' + res.success + ' status=' + res.status + ' error=' + res.errorMessage);
System.debug('RISK text=' + (res.responseText == null ? '' : res.responseText.left(1500)));
System.debug('RISK output=' + (res.outputPayload == null ? '' : res.outputPayload.left(1500)));
