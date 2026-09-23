Long t0 = System.now().getTime();
AgentChatController.TurnResult r = AgentChatController.sendTurn('a08g500000CtHpJAAV', 'What are the valid Project Type values? List them.', null);
System.debug('S4_WALL ' + (System.now().getTime() - t0));
