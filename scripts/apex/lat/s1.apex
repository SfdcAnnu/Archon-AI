Long t0 = System.now().getTime();
AgentChatController.TurnResult r = AgentChatController.sendTurn('a08g500000CtHpJAAV', 'Reply with exactly the word OK and nothing else.', null);
System.debug('S1_WALL ' + (System.now().getTime() - t0));
