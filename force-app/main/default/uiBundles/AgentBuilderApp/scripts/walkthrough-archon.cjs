// Drives the real app in Chrome against the Vite dev server with the
// Salesforce data layer mocked, and screenshots each step of the flow:
// Home bar → Archon full screen → dashboard beside the words → close →
// a build that stays words until the design stage, then divides.
const path = require('path');
const fs = require('fs');
// Run from the bundle folder with the Vite dev server up on :5173 and
// Chrome installed:  node scripts/walkthrough-archon.cjs
// Screenshots land in <tmp>/archon-walkthrough. Needs no Salesforce org.
const APP = path.resolve(__dirname, '..');
const { chromium } = require(path.join(APP, 'node_modules/playwright-core'));
const OUT = path.join(require('os').tmpdir(), 'archon-walkthrough');
fs.mkdirSync(OUT, { recursive: true });

const now = new Date();
const at = (h, m = 0, dayOffset = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, h, m).toISOString();
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const byAgent = [
  { apiName: 'whatsapp_lead_intake_qualifier', name: 'WhatsApp Lead Intake Qualifier', runsToday: 0, runsFailedToday: 0, turnsToday: 61, turnsFailedToday: 1, tokensIn: 180000, tokensOut: 40000 },
  { apiName: 'deal_risk_scorer', name: 'Deal Risk Scorer', runsToday: 34, runsFailedToday: 2, turnsToday: 0, turnsFailedToday: 0, tokensIn: 700000, tokensOut: 90000 },
  { apiName: 'archon_metadata_expert', name: 'Metadata Expert', runsToday: 0, runsFailedToday: 0, turnsToday: 18, turnsFailedToday: 0, tokensIn: 120000, tokensOut: 20000 },
  { apiName: 'invoice_reminder', name: 'Invoice Reminder', runsToday: 6, runsFailedToday: 0, turnsToday: 0, turnsFailedToday: 0, tokensIn: 20000, tokensOut: 4000 },
];
function statsFor(days) {
  const byDay = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    byDay.push(i === 0 ? { day: dayKey(d), runsOk: 38, runsFailed: 2, runsOther: 0, turnsOk: 78, turnsFailed: 1 } : { day: dayKey(d), runsOk: 30 + (i % 5) * 3, runsFailed: i % 3, runsOther: 0, turnsOk: 50 + (i % 4) * 6, turnsFailed: i % 2 });
  }
  return { days, byDay, byAgent, runs: 40, runsFailed: 2, turns: 79, turnsFailed: 1, tokensIn: 1020000, tokensOut: 154000, generatedAt: now.toISOString() };
}
const run = (i, h, m, agent, status, reason, ms) => ({ Id: `a0${i}`, Name: `AE-${100 + i}`, 'AgentDefinition__r.Name': agent, 'AgentDefinition__r.Department__c': 'Sales', CorrelationId__c: `c${i}`, RecordId__c: `006g000000${i}Qx`, Status__c: status, AgentScore__c: null, AgentPriority__c: null, AgentReason__c: reason, ToolsUsed__c: null, OutputPayload__c: null, ExecutionMs__c: ms, Department__c: 'Sales', CreatedDate: at(h, m) });
const runs = { records: [
  run(1, 10, 47, 'Deal Risk Scorer', 'ERROR', 'Risk_Score__c: field is not writable by the running user', 6100),
  run(2, 10, 42, 'Deal Risk Scorer', 'ERROR', 'Risk_Score__c: field is not writable by the running user', 5900),
  run(3, 10, 30, 'Deal Risk Scorer', 'SUCCESS', 'Scored 71 · High: renewal at risk, champion left', 6400),
  run(4, 9, 15, 'Deal Risk Scorer', 'SUCCESS', 'Scored 44 · Medium', 5200),
  run(5, 7, 58, 'Invoice Reminder', 'SUCCESS', '6 reminders sent, 0 bounced', 3100),
  run(6, 8, 20, 'Deal Risk Scorer', 'SUCCESS', 'Scored 12 · Low', 4800),
  run(7, 11, 5, 'Deal Risk Scorer', 'SUCCESS', 'Scored 63 · High', 6000),
  run(8, 12, 40, 'Deal Risk Scorer', 'SUCCESS', 'Scored 35 · Medium', 5500),
], total: 8, pageSize: 200, pageOffset: 0 };
const agent = (i, name, api, status, type) => ({ Id: `a02${i}`, Name: name, ApiName__c: api, Department__c: 'Sales', Description__c: null, Status__c: status, Version__c: 1, TotalExecutions__c: 10, SuccessRate__c: 98, IsSystem__c: false, ExecuteType__c: type, StreamReplies__c: false, CreatedDate: at(9, 0, -20), LastModifiedDate: at(18, 20, -1) });
const agents = [
  agent(1, 'WhatsApp Lead Intake Qualifier', 'whatsapp_lead_intake_qualifier', 'Active', 'Chat'),
  agent(2, 'WhatsApp Support', 'whatsapp_support', 'Draft', 'Chat'),
  agent(3, 'Deal Risk Scorer', 'deal_risk_scorer', 'Active', 'Trigger'),
  agent(4, 'Pipeline Manager Assistant', 'pipeline_manager_assistant', 'Draft', 'Both'),
  agent(5, 'Metadata Expert', 'archon_metadata_expert', 'Active', 'Chat'),
  agent(6, 'Invoice Reminder', 'invoice_reminder', 'Active', 'Trigger'),
  agent(7, 'Renewal Outreach', 'renewal_outreach', 'Draft', 'Both'),
];
const sessions = [
  { id: 'sx1', name: 'CS-7', agentName: 'Archon Copilot', agentApiName: 'archon_copilot', title: 'Usage report and the risk scorer', status: 'Ended', lastActivityAt: at(9, 12), expiresAt: null, totalTurns: 6, recordContextId: null, tokensIn: 3000, tokensOut: 900, cachedTokens: 0, latencyMsTotal: 12000 },
  { id: 'sx2', name: 'CS-6', agentName: 'Archon Copilot', agentApiName: 'archon_copilot', title: 'Build the lead intake agent', status: 'Ended', lastActivityAt: at(18, 40, -1), expiresAt: null, totalTurns: 14, recordContextId: null, tokensIn: 9000, tokensOut: 2100, cachedTokens: 0, latencyMsTotal: 40000 },
  { id: 's1', name: 'CS-1', agentName: 'WhatsApp Lead Intake Qualifier', agentApiName: 'whatsapp_lead_intake_qualifier', title: 'Rohan Mehta · 3BHK enquiry', status: 'Handed off', lastActivityAt: at(9, 15), expiresAt: null, totalTurns: 9, recordContextId: null, tokensIn: 1000, tokensOut: 400, cachedTokens: 0, latencyMsTotal: 20000 },
  { id: 's2', name: 'CS-2', agentName: 'WhatsApp Lead Intake Qualifier', agentApiName: 'whatsapp_lead_intake_qualifier', title: 'Priya Nair · villa plot', status: 'Active', lastActivityAt: at(11, 40), expiresAt: null, totalTurns: 6, recordContextId: null, tokensIn: 800, tokensOut: 300, cachedTokens: 0, latencyMsTotal: 14000 },
];
const approvals = [
  { id: 'apr1', name: 'AP-0001', agentApiName: 'pipeline_manager_assistant', nodeLabel: 'Send renewal proposal', recordId: '001g000000AcmeXX', status: 'Pending', createdDate: at(8, 30), timeoutAt: at(20, 30) },
];
const session = { session: { Id: 'sess1', Name: 'CS-9', Title__c: null, Status__c: 'Active', 'AgentDefinition__r.Name': 'Archon', TokensIn__c: 0, TokensOut__c: 0 }, messages: [], streamReplies: false };

const STEPS = [['understand', 'Understood what you want'], ['survey', 'Looked through your Salesforce org'], ['match', 'Matched what you need to what you have'], ['design', 'Designed the agent'], ['prompts', 'Wrote its instructions'], ['review', 'Checked it against what you asked for'], ['gaps', 'Listed the outstanding setup'], ['compile', 'Saved the agent']];
const DETAILS = { understand: 'Reading the requirement (gpt-4.1)…', survey: 'Reading your org: 118 objects, 44 tools…', match: 'Matching 15 capabilities against 44 tools…', design: 'Designing the agent — root, specialists, tools (gpt-5.5, deep)…', prompts: 'Writing instructions for 4 nodes…', review: 'Judging the design against your requirement…', gaps: 'Listing what the org still needs…', compile: 'Compiling and saving…' };
let polls = 0;
let freshAsked = false;
const buildStart = { t: 0 };
function buildView() {
  const n = Math.min(polls, STEPS.length + 1);
  const steps = STEPS.map(([key, label], i) => i < n - 1 ? { key, label, state: 'done', ms: 4000 + i * 1500, costUsd: 0.02 } : i === n - 1 ? { key, label, state: 'running', detail: DETAILS[key], startedAt: Date.now() - 3000 } : { key, label, state: 'pending' });
  const done = n > STEPS.length;
  return { jobId: 'job1', status: done ? 'done' : 'running', steps: done ? steps.map(s => ({ ...s, state: 'done' })) : steps, costUsd: 0.02 * Math.min(n, 8), maxCostUsd: 2, elapsedMs: Date.now() - buildStart.t, result: done ? { agentId: 'a02new', apiName: 'whatsapp_lead_intake_qualifier', status: 'Draft', summarySteps: ['Greet and capture the name', 'Email, project type, project name', 'Budget then a meeting'], shape: 'agent + 1 specialist', prerequisites: [], estimate: { costPerRunUsd: 0.012, latencySeconds: 4 }, assumptions: [], notes: [], confidence: 'high' } : undefined };
}
function buildDetail() {
  const v = buildView();
  const has = k => v.steps.find(s => s.key === k).state !== 'pending';
  return {
    jobId: 'job1', status: v.status, stoppedAfter: null,
    requirement: has('understand') ? { goal: 'Qualify property leads on WhatsApp step by step and book a meeting.', capabilities: ['capture name and email', 'dependent picklist for project', 'budget then meeting', 'escalate top-band budget', 'hand off to a human'], openQuestions: [], successCriteria: ['every answer saved on its turn'], riskLevel: 'low', trigger: null, agentType: 'communication' } : null,
    survey: has('survey') ? { objects: { count: 118, sample: ['Lead', 'Opportunity', 'Task', 'Event'] }, tools: { count: 44, sample: ['find', 'getObjectSchema', 'createSobjectRecord', 'updateSobjectRecord'] } } : null,
    match: has('match') ? { coverage: 1, matched: ['capture name and email', 'dependent picklist for project', 'budget then meeting', 'escalate top-band budget', 'hand off to a human'], gaps: [] } : null,
    design: has('design') ? { name: 'WhatsApp Lead Intake Qualifier', department: 'Sales', description: 'Qualifies a property lead on WhatsApp and books the meeting.', trigger: null, preview: { nodes: [
      { id: 'n1', name: 'WhatsApp Lead Intake', nodeType: 'ai', nodeSubType: 'agent', config: { instructions: 'Qualify the lead step by step.' }, positionX: 80, positionY: 200 },
      { id: 'n2', name: 'Escalation', nodeType: 'subagent', nodeSubType: 'subagent', config: {}, positionX: 420, positionY: 90 },
      { id: 'n3', name: 'Create Task', nodeType: 'tool', nodeSubType: 'salesforce', config: {}, positionX: 760, positionY: 90 },
      { id: 'n4', name: 'Book meeting', nodeType: 'tool', nodeSubType: 'salesforce', config: {}, positionX: 420, positionY: 320 },
    ], connections: [
      { id: 'c1', fromNodeId: 'n1', fromPort: 'tool', toNodeId: 'n2', toPort: 'in' }, { id: 'c2', fromNodeId: 'n2', fromPort: 'tool', toNodeId: 'n3', toPort: 'in' }, { id: 'c3', fromNodeId: 'n1', fromPort: 'tool', toNodeId: 'n4', toPort: 'in' },
    ] }, counts: { specialists: 1, tools: 2, approvals: 0 }, instructions: [{ id: 'n1', label: 'WhatsApp Lead Intake', role: 'agent', text: 'Qualify the lead step by step…' }], guardrails: [], budgets: { maxSteps: 12, maxCostUsd: 0.5, timeoutSeconds: 120 } } : null,
    review: has('review') ? { verdict: 'pass', uncovered: [], failures: [] } : null,
    prerequisites: [], result: v.result ?? null, error: null,
  };
}

const FAKE_WS = `
  class FakeWS extends EventTarget {
    constructor(url) { super(); this.url = url; this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen({}); }, 60); }
    send(payload) {
      const msg = JSON.parse(payload); const text = String(msg.newUserMessage || '').toLowerCase();
      let reply = 'Sure — what would you like to know?'; let toolCalls = [];
      if (/build|create/.test(text)) { reply = 'On it. I have handed the requirement to the Architect — it is reading your requirement now, then your org, before it designs anything. I will bring the graph up beside us when the design starts.'; toolCalls = [{ name: 'build_agent', input: { requirement: msg.newUserMessage }, output: JSON.stringify({ jobId: 'job1', status: 'running' }) }]; }
      else if (/usage|report/.test(text)) { reply = 'Here is the usage report for the last 31 days, on the screen beside us. The WhatsApp Lead Intake Qualifier is far ahead: 173 turns and 984,403 input tokens, about $2.90. The Archon Copilot took 58 turns and 203,576 tokens; the Metadata Expert 48 turns and 213,307.'; toolCalls = [{ name: 'show_on_screen', input: { view: 'usage', days: 31 }, output: JSON.stringify({ screen: { view: 'usage', days: 31, agentApiName: null }, usage: { days: 31, turns: 279, tokensIn: 1401286, tokensOut: 96400, byAgent: [{ apiName: 'whatsapp_lead_intake_qualifier', name: 'WhatsApp Lead Intake Qualifier', turns: 173, tokensIn: 984403, tokensOut: 61200 }, { apiName: 'archon_metadata_expert', name: 'Metadata Expert', turns: 48, tokensIn: 213307, tokensOut: 16800 }, { apiName: 'archon_copilot', name: 'Archon Copilot', turns: 58, tokensIn: 203576, tokensOut: 18400 }] } }) + '\\nSHOWN: the usage view is on the screen.' }]; }
      else if (/today|happened/.test(text)) reply = 'Here is today. 40 runs and 79 chat turns, three failed — the two run failures are both the Deal Risk Scorer, the same field error at 10:42 and 10:47. One approval is waiting on you: the renewal proposal to Acme. Spend is about $4.09, most of it the risk scorer.';
      else if (/fail/.test(text)) reply = 'Both failures are the Deal Risk Scorer: Risk_Score__c is not writable by the running user. Grant the field to the Archon Runtime permission set and re-run the two records.';
      setTimeout(() => { this.onmessage && this.onmessage({ data: JSON.stringify({ status: 'complete', assistantText: reply, toolCalls, tokensIn: 120, tokensOut: 80, modelUsed: 'mock' }) }); }, 700);
    }
    close() { this.readyState = 3; this.onclose && this.onclose({}); }
  }
  FakeWS.CONNECTING = 0; FakeWS.OPEN = 1; FakeWS.CLOSING = 2; FakeWS.CLOSED = 3;
  window.WebSocket = FakeWS;
`;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; const logs = [];
  page.on('console', m => { const t = m.text(); logs.push(m.type() + ': ' + t.slice(0, 220)); if (m.type() === 'error') errors.push(t.slice(0, 200)); });
  page.on('pageerror', e => errors.push('PAGE: ' + String(e).slice(0, 200)));
  page.on('requestfailed', r => console.log('  requestfailed', r.url().slice(0, 120), r.failure() && r.failure().errorText));
  await page.addInitScript(FAKE_WS);
  await page.addInitScript(() => { try { localStorage.setItem('archon:theme', 'hud'); } catch {} });
  // React StrictMode (dev only) runs the panel's bootstrap effect twice and
  // the first run's cleanup marks the session start "cancelled" before it
  // lands; the deployed bundle has no StrictMode. Neutralise that one line
  // in the dev-served module so the flow can be driven here.
  await page.route('**/src/components/chat/ChatPanel.tsx*', async r => {
    const res = await r.fetch();
    const text = (await res.text()).replaceAll('if (cancelled) return;', 'if (false) return;').replaceAll('cancelled = true;', 'cancelled = false;').replaceAll('unmountedRef.current = true;', 'unmountedRef.current = false;');
    await r.fulfill({ response: res, body: text, headers: { ...res.headers(), 'content-length': String(Buffer.byteLength(text)) } });
  });
  await page.route('**/@salesforce_platform-sdk.js*', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'export async function createDataSDK(){ return { fetch: (p, i) => fetch(p, i) }; }\nexport default { createDataSDK };' }));
  await page.route('**/services/apexrest/**', route => {
    const req = route.request(); const url = req.url(); const method = req.method();
    let body = null; try { body = req.postDataJSON(); } catch { /* not json */ }
    const json = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('/home-stats')) return json(statsFor(Number(new URL(url).searchParams.get('days') || 1)));
    if (url.includes('/executions')) return json(runs);
    if (url.includes('/chat-approvals')) return json({ approvals: [] });
    if (url.includes('/approvals')) return json(approvals);
    if (url.includes('/agents')) return json(agents);
    if (url.includes('/conversations')) return json(sessions);
    if (url.includes('/connectors')) return json([]);
    if (url.includes('/ws-ticket')) return json({ ticket: 't1', wsUrl: 'ws://localhost:1/chat' });
    if (url.includes('/architect')) { if (url.includes('resource=detail')) return json(buildDetail()); if (!buildStart.t) buildStart.t = Date.now(); polls++; return json(buildView()); }
    if (url.includes('/chat/')) { if (method === 'GET') return json({ accessMode: 'Org', connected: true, accountEmail: null }); if (body && body.action === 'startSession') { if (body.forceNew) freshAsked = true; return json(session); } return json({}); }
    return json({});
  });
  const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('shot', name); };
  const settle = ms => page.waitForTimeout(ms);

  // 1 · Home with the bar
  await page.goto('http://localhost:5173/home', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ax-bar', { timeout: 20000 });
  await settle(2500);
  await shot('1-home');
  console.log('bar text:', (await page.locator('.ax-bar').innerText()).replace(/\n/g, ' | '));

  // 2 · Talk to Archon → full screen greeting
  await page.click('.ax-talk');
  await page.waitForSelector('.ax-orbhead h1', { timeout: 20000 });
  await page.waitForSelector('.ax-composer textarea', { timeout: 20000 });
  await settle(1500);
  await shot('2-archon-greeting');
  console.log('chat state:', (await page.locator('.ax-list').innerText()).replace(/\n/g, ' | ').slice(0, 160));
  console.log('--- ChatPanel logs so far ---'); for (const l of logs.filter(l => /ChatPanel|apexrest|Error|error/.test(l)).slice(-20)) console.log(l);
  console.log('layout:', await page.getAttribute('.ax-area', 'data-layout'), '| status:', await page.locator('.ax-status').innerText());

  page.__fail = async () => { await shot('fail'); console.log('--- last logs ---'); for (const l of logs.slice(-40)) console.log(l); };
  console.log('screenshots →', OUT);
  // 2b · Recent: the copilot's own earlier conversations, and a fresh start
  await page.click('button:has-text("Recent")');
  await page.waitForSelector('.ax-recent-item', { timeout: 10000 });
  await settle(800);
  await shot('2b-recent');
  console.log('recent items:', await page.locator('.ax-recent-item').count(), '| fresh session asked:', freshAsked);
  await page.click('.ax-recent-new');
  await page.waitForSelector('.ax-composer textarea', { timeout: 20000 });
  await page.click('button:has-text("Recent")');
  await settle(600);

  // 3 · a question that needs a surface
  await page.fill('.ax-composer textarea', 'What happened today?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.ax-area[data-layout="split"]', { timeout: 20000 }).catch(async e => { await page.__fail(); throw e; });
  await page.waitForSelector('.ax-dt', { timeout: 20000 });
  await settle(2500);
  await shot('3-archon-dashboard');
  console.log('tiles:', (await page.locator('.ax-dtiles').innerText()).replace(/\n/g, ' | '));

  // 4 · close → the conversation fills the screen again
  await page.click('.ax-shd button');
  await page.waitForSelector('.ax-area[data-layout="full"]', { timeout: 10000 });
  await settle(900);
  await shot('4-archon-closed');

  // 4b · the copilot itself puts a view on the screen (show_on_screen)
  await page.fill('.ax-composer textarea', 'Show me the usage report for all my agents');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.ax-surface[data-mode="usage"]', { timeout: 20000 });
  await page.waitForFunction(() => /as Archon reported it/.test(document.querySelector('.ax-shd .meta')?.textContent || ''), null, { timeout: 20000 });
  await settle(1500);
  await shot('4b-usage-from-copilot');
  console.log('usage rows:', await page.locator('.ax-table tbody tr').count(), '| meta:', await page.locator('.ax-shd .meta').innerText());
  await page.click('.ax-shd button');
  await page.waitForSelector('.ax-area[data-layout="full"]', { timeout: 10000 });
  await settle(600);

  // 5 · a build: words first, the graph only when the design starts
  await page.fill('.ax-composer textarea', 'Build a WhatsApp lead intake agent for property customers');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.ax-buildstub', { timeout: 20000 });
  await settle(1500);
  await shot('5-build-words');
  console.log('layout during early stages:', await page.getAttribute('.ax-area', 'data-layout'), '| working:', await page.locator('.ax-working').count() ? await page.locator('.ax-working').innerText() : '(none)');
  await page.waitForSelector('.ax-area[data-layout="split"]', { timeout: 40000 });
  console.log('split after', polls, 'polls; running step:', await page.locator('.bw-stage.run .l').first().innerText().catch(() => '?'));
  await settle(1800);
  await shot('6-build-design');
  await page.waitForSelector('.bw-hint.ok', { timeout: 60000 });
  await settle(1500);
  await shot('7-build-saved');
  console.log('surface mode:', await page.getAttribute('.ax-surface', 'data-mode'), '| stub:', await page.locator('.ax-buildstub .k').last().innerText());

  // 6 · activate from the build → back to the conversation
  const act = page.locator('.bw-btn.g');
  if (await act.count()) { await act.first().click(); await page.waitForSelector('.ax-area[data-layout="full"]', { timeout: 10000 }); await settle(800); await shot('8-after-activate'); console.log('after activate layout:', await page.getAttribute('.ax-area', 'data-layout')); }
  else console.log('no Activate button found');

  console.log('console errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED:', String(e).slice(0, 300)); process.exit(1); });
