// Idempotency probe: remove one welcome-call Task from test case 1, so a re-run must notice and recreate only that one.
delete [SELECT Id FROM Task WHERE WhatId = '006g5000009hmFVAAY' AND Subject = 'Welcome call with Dev Patel (Decision Maker)'];
System.debug('RM tasks left=' + [SELECT COUNT() FROM Task WHERE WhatId = '006g5000009hmFVAAY']);
