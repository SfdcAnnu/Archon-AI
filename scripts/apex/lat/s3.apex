Long t0 = System.now().getTime();
AgentChatController.TurnResult r = AgentChatController.sendTurn('a08g500000CtHpJAAV', 'Which projects are available under Villa? List them.', null);
System.debug('S3_WALL ' + (System.now().getTime() - t0));
