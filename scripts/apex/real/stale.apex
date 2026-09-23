Long t0 = System.now().getTime();
AgentChatController.TurnResult r = AgentChatController.sendTurn('a08g500000CtLo5AAF', 'Thanks, that is all for now.', null);
System.debug('STALE_WALL ' + (System.now().getTime() - t0));
