Long t0 = System.now().getTime();
AgentChatController.TurnResult r = AgentChatController.sendTurn('a08g500000CtHpJAAV', 'What is the email address on this lead? One short sentence.', null);
System.debug('S2_WALL ' + (System.now().getTime() - t0));
