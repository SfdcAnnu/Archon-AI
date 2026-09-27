// One run of the Account Open Opportunity Follow-Up agent, exactly as a Flow on the Account calls it.
AgentInvokeAction.Request r = new AgentInvokeAction.Request();
r.agent = 'account_open_opportunity_follow_up';
r.agentType = 'Automation';
r.recordId = '001g500000itc05AAA';
Long t0 = System.now().getTime();
AgentInvokeAction.Result res = AgentInvokeAction.run(new List<AgentInvokeAction.Request>{ r })[0];
System.debug('RUN ms=' + (System.now().getTime() - t0) + ' success=' + res.success + ' status=' + res.status + ' error=' + res.errorMessage);
String txt = res.responseText == null ? '' : res.responseText;
for (Integer i = 0; i < txt.length(); i += 800) System.debug('RUN text ' + txt.substring(i, Math.min(i + 800, txt.length())));
String outp = res.outputPayload == null ? '' : res.outputPayload;
for (Integer i = 0; i < Math.min(outp.length(), 4000); i += 800) System.debug('RUN out ' + outp.substring(i, Math.min(i + 800, outp.length())));
