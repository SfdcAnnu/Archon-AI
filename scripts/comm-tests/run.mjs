#!/usr/bin/env node
/**
 * Communication-agent test run: build agents with the Agent Builder, score
 * the builds, talk to them, check the org, write a report.
 *
 *   node scripts/comm-tests/run.mjs seed              create fixture records ([ARCHON TEST])
 *   node scripts/comm-tests/run.mjs build C1 C2 ...   start builds (default: all not yet built)
 *   node scripts/comm-tests/run.mjs poll              wait for the builds to finish
 *   node scripts/comm-tests/run.mjs score             score each saved agent (free)
 *   node scripts/comm-tests/run.mjs chat C1 ...       run the conversations (default: all built, not yet run)
 *   node scripts/comm-tests/run.mjs report            write results/report.md
 *   node scripts/comm-tests/run.mjs cleanup           delete fixture + test-created records
 *
 * Everything goes through the org's own Apex (ArchonServerClient,
 * AgentChatController.sendTurn) - the path WhatsApp and the chat widget
 * use. State lives in results/state.json so a step can be rerun alone.
 * Nothing is retried on its own: a failed build or turn is a finding.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES, TEST_TAG } from './cases.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, 'results');
const STATE_FILE = join(RESULTS, 'state.json');
const ORG = process.env.COMM_TEST_ORG ?? 'AiAgentBuilderOrg';
const BUDGET_USD = Number(process.env.COMM_TEST_BUDGET ?? 3.8);
const BUILD_CAP_USD = 1.0;
const TMP = mkdtempSync(join(tmpdir(), 'commtest-'));

// Same table as the server (architect/specialists.ts MODEL_USD_PER_MTOK).
const PRICES = [
  ['gpt-5-mini', 0.25, 2], ['gpt-5-nano', 0.05, 0.4], ['gpt-5', 1.25, 10], ['gpt-4.1-mini', 0.4, 1.6],
  ['gpt-4.1-nano', 0.1, 0.4], ['gpt-4.1', 2, 8], ['gpt-4o-mini', 0.15, 0.6], ['gpt-4o', 2.5, 10],
  ['claude-sonnet', 3, 15], ['claude-haiku', 0.8, 4], ['claude-opus', 15, 75],
];
function usd(model, tin, tout) {
  const p = PRICES.find(([prefix]) => String(model ?? '').startsWith(prefix)) ?? ['?', 1.25, 10];
  return (Number(tin || 0) * p[1] + Number(tout || 0) * p[2]) / 1e6;
}

// ── state ────────────────────────────────────────────────────────────
mkdirSync(RESULTS, { recursive: true });
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : { cases: {}, spentUsd: 0 };
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
const caseState = id => (state.cases[id] ??= {});
const chatCost = c => (c.chat?.costUsd ?? 0) + (c.previousChats ?? []).reduce((p, x) => p + (x.costUsd ?? 0), 0);
const spent = () =>
  Object.values(state.cases).reduce((s, c) => s + (c.build?.costUsd ?? 0) + chatCost(c)
    + (c.previousRuns ?? []).reduce((p, r) => p + (r.build?.costUsd ?? 0) + chatCost(r), 0), 0);

// ── Apex plumbing ────────────────────────────────────────────────────
function sf(args) {
  const quoted = args.map(a => (/\s/.test(a) ? `"${a}"` : a));
  return execFileSync('sf', quoted, { shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600_000, stdio: ['ignore', 'pipe', 'ignore'] });
}

/** Runs anonymous Apex; returns every `RES::<json>` payload it debugged. */
function apex(code, label = 'x') {
  const file = join(TMP, `${label}-${Date.now()}.apex`);
  writeFileSync(file, code, 'utf8');
  let out;
  try {
    out = JSON.parse(sf(['apex', 'run', '-o', ORG, '-f', file, '--json']));
  } catch (e) {
    out = JSON.parse(e.stdout || '{}');
  }
  const r = out.result ?? {};
  if (!r.compiled) throw new Error(`Apex compile failed (${label}): ${r.compileProblem ?? out.message}`);
  const payloads = [...(r.logs ?? '').matchAll(/\|DEBUG\|RES::(.*)/g)].map(m => JSON.parse(m[1]));
  if (!r.success) {
    const err = new Error(`Apex failed (${label}): ${r.exceptionMessage}`);
    err.payloads = payloads;
    throw err;
  }
  return payloads;
}

const str = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '').replace(/\n/g, '\\n')}'`;
const soqlApex = queries => queries.map((q, i) => `System.debug('RES::' + JSON.serialize(new Map<String,Object>{ 'i' => ${i}, 'rows' => Database.query(${str(q)}) }));`).join('\n');

function query(queries) {
  const out = apex(soqlApex(queries), 'soql');
  return queries.map((_, i) => out.find(o => o.i === i)?.rows ?? []);
}

// ── seed / cleanup ───────────────────────────────────────────────────
function seed() {
  const [left] = query([`SELECT COUNT(Id) n FROM Account WHERE Name LIKE '${TEST_TAG}%'`]);
  if (Number(left[0]?.n) > 0) throw new Error('Fixture accounts already exist - run cleanup first.');
  const T = TEST_TAG;
  const [res] = apex(`
Account acme = new Account(Name = ${str(T + ' Acme Robotics')}, Industry = 'Manufacturing', Phone = '+1 415 555 0101');
Account globex = new Account(Name = ${str(T + ' Globex Foods')}, Industry = 'Food & Beverage');
insert new List<Account>{ acme, globex };
Contact priya = new Contact(FirstName = 'Priya', LastName = 'Sharma', Email = 'priya.sharma@archontest.example', Phone = '+1 415 555 0142', Title = 'Operations Manager', AccountId = acme.Id);
Contact priya2 = new Contact(FirstName = 'Priya', LastName = 'Sharma', Email = 'priya.s@archontest.example', Phone = '+1 212 555 0199', Title = 'Buyer', AccountId = globex.Id);
Contact rahul = new Contact(FirstName = 'Rahul', LastName = 'Verma', Email = 'rahul.verma@archontest.example', Phone = '+1 212 555 0177', Title = 'Plant Head', AccountId = globex.Id);
insert new List<Contact>{ priya, priya2, rahul };
insert new List<Case>{
  new Case(Subject = ${str(T + ' Robot arm calibration drift')}, Status = 'New', Priority = 'Medium', Origin = 'Web', ContactId = priya.Id, AccountId = acme.Id, Description = 'Internal note: customer is on legacy firmware 2.1'),
  new Case(Subject = ${str(T + ' Invoice mismatch for Q3')}, Status = 'Working', Priority = 'Low', Origin = 'Email', ContactId = priya.Id, AccountId = acme.Id),
  new Case(Subject = ${str(T + ' Onboarding question')}, Status = 'Closed', Priority = 'Low', Origin = 'Phone', ContactId = priya.Id, AccountId = acme.Id),
  new Case(Subject = ${str(T + ' Freezer temperature alarm')}, Status = 'New', Priority = 'High', Origin = 'Web', ContactId = rahul.Id, AccountId = globex.Id)
};
Opportunity oppAcme = new Opportunity(Name = ${str(T + ' Acme - Warehouse Automation')}, AccountId = acme.Id, StageName = 'Proposal/Price Quote', Amount = 48000, CloseDate = Date.today().addDays(30));
Opportunity oppGlobex = new Opportunity(Name = ${str(T + ' Globex - Cold Storage')}, AccountId = globex.Id, StageName = 'Negotiation/Review', Amount = 90000, CloseDate = Date.today().addDays(45));
insert new List<Opportunity>{ oppAcme, oppGlobex };
Product2 arm = new Product2(Name = 'RoboArm X1', ProductCode = 'ARCHON-TEST-RX1', Description = ${str(T)}, IsActive = true);
Product2 kit = new Product2(Name = 'Vision Kit', ProductCode = 'ARCHON-TEST-VK', Description = ${str(T)}, IsActive = true);
insert new List<Product2>{ arm, kit };
Id std = [SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1].Id;
insert new List<PricebookEntry>{
  new PricebookEntry(Pricebook2Id = std, Product2Id = arm.Id, UnitPrice = 12000, IsActive = true),
  new PricebookEntry(Pricebook2Id = std, Product2Id = kit.Id, UnitPrice = 3000, IsActive = true)
};
System.debug('RES::' + JSON.serialize(new Map<String,Object>{
  'accountAcme' => acme.Id, 'accountGlobex' => globex.Id, 'contactPriya' => priya.Id, 'contactPriyaGlobex' => priya2.Id,
  'contactRahul' => rahul.Id, 'oppAcme' => oppAcme.Id, 'oppGlobex' => oppGlobex.Id, 'productArm' => arm.Id }));
`, 'seed');
  const [[leads]] = [query(['SELECT COUNT(Id) n FROM Lead'])];
  state.ids = res;
  state.leadCountBefore = Number(leads[0]?.n);
  state.start = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  save();
  console.log('Seeded:', res);
}

function cleanup() {
  const [out] = apex(`
List<Lead> leads = [SELECT Id FROM Lead WHERE Email LIKE '%@archontest.example'];
List<Account> accts = [SELECT Id FROM Account WHERE Name LIKE ${str(TEST_TAG + '%')}];
List<Case> cases = [SELECT Id FROM Case WHERE AccountId IN :accts OR Contact.Email LIKE '%@archontest.example'];
List<Opportunity> opps = [SELECT Id FROM Opportunity WHERE AccountId IN :accts];
List<Contact> contacts = [SELECT Id FROM Contact WHERE AccountId IN :accts OR Email LIKE '%@archontest.example'];
List<Product2> prods = [SELECT Id FROM Product2 WHERE ProductCode LIKE 'ARCHON-TEST-%'];
Set<Id> parents = new Set<Id>();
for (Lead l : leads) parents.add(l.Id);
for (Case c : cases) parents.add(c.Id);
for (Opportunity o : opps) parents.add(o.Id);
for (Contact c : contacts) parents.add(c.Id);
for (Account a : accts) parents.add(a.Id);
List<Task> tasks = [SELECT Id FROM Task WHERE WhoId IN :parents OR WhatId IN :parents];
List<Event> events = [SELECT Id FROM Event WHERE WhoId IN :parents OR WhatId IN :parents];
delete tasks; delete events; delete cases; delete opps; delete leads; delete contacts; delete accts;
List<PricebookEntry> pbes = [SELECT Id FROM PricebookEntry WHERE Product2Id IN :prods];
delete pbes; delete prods;
System.debug('RES::' + JSON.serialize(new Map<String,Object>{ 'leads' => leads.size(), 'accounts' => accts.size(), 'contacts' => contacts.size(),
  'cases' => cases.size(), 'opps' => opps.size(), 'tasks' => tasks.size(), 'events' => events.size(), 'products' => prods.size() }));
`, 'cleanup');
  console.log('Deleted:', out);
  state.cleanedUp = { at: new Date().toISOString(), ...out };
  save();
}

// ── builds ───────────────────────────────────────────────────────────
function startBuilds(ids) {
  for (const c of CASES.filter(c => (ids.length ? ids.includes(c.id) : !caseState(c.id).build))) {
    if (spent() + BUILD_CAP_USD > BUDGET_USD) { console.log(`Budget brake: not starting ${c.id} (spent $${spent().toFixed(3)}).`); break; }
    // A rebuild keeps the earlier build, its score and its conversations for the before/after report.
    const prev = caseState(c.id);
    if (prev.build) {
      (prev.previousRuns ??= []).push({ build: prev.build, score: prev.score, chat: prev.chat, previousChats: prev.previousChats, activated: prev.activated });
      delete prev.score; delete prev.chat; delete prev.previousChats; delete prev.activated;
    }
    const body = JSON.stringify({ requirement: c.requirement, maxCostUsd: BUILD_CAP_USD });
    const [r] = apex(`HttpResponse r = ArchonServerClient.callout('POST', '/api/architect/build', ${str(body)}, 60000);
System.debug('RES::' + JSON.serialize(new Map<String,Object>{ 'code' => r.getStatusCode(), 'body' => r.getBody() }));`, `build-${c.id}`);
    const jobId = r.code === 202 ? JSON.parse(r.body).jobId : null;
    caseState(c.id).build = { jobId, startedAt: new Date().toISOString(), startCode: r.code, startBody: jobId ? undefined : r.body };
    save();
    console.log(`${c.id} build ${jobId ?? 'FAILED TO START: ' + r.body}`);
  }
}

const FINAL = new Set(['done', 'failed', 'error', 'stopped', 'paused', 'cancelled', 'complete', 'completed']);

async function pollBuilds() {
  for (;;) {
    const open = CASES.filter(c => caseState(c.id).build?.jobId && !FINAL.has(caseState(c.id).build.status));
    if (!open.length) break;
    for (const c of open) {
      const b = caseState(c.id).build;
      const [r] = apex(`HttpResponse r = ArchonServerClient.callout('GET', '/api/architect/build/${b.jobId}', null, 60000);
System.debug('RES::' + JSON.serialize(new Map<String,Object>{ 'code' => r.getStatusCode(), 'body' => r.getBody() }));`, `poll-${c.id}`);
      const j = JSON.parse(r.body);
      Object.assign(b, {
        status: j.status, costUsd: Number(j.costUsd ?? 0), elapsedMs: j.elapsedMs, error: j.error ?? null,
        result: j.result ?? null,
        steps: (j.steps ?? []).map(s => ({ key: s.key, state: s.state, ms: s.ms, costUsd: s.costUsd, detail: s.detail, calls: (s.calls ?? []).length, failedCalls: (s.calls ?? []).filter(x => x.failed).map(x => `${x.specialist}: ${String(x.failed).slice(0, 160)}`) })),
      });
      save();
      const running = (j.steps ?? []).find(s => s.state === 'running');
      console.log(`${c.id} ${j.status} $${Number(j.costUsd ?? 0).toFixed(3)} ${Math.round((j.elapsedMs ?? 0) / 1000)}s ${running ? '-> ' + running.key + ' ' + (running.detail ?? '') : ''}`);
    }
    if (CASES.some(c => caseState(c.id).build?.jobId && !FINAL.has(caseState(c.id).build.status))) await new Promise(r => setTimeout(r, 30_000));
  }
  console.log(`Builds finished. Spent so far $${spent().toFixed(3)}.`);
}

// ── scoring (free) ───────────────────────────────────────────────────
const WRITE_TOOL = /(create|update|upsert|insert|save|delete|destroy|remove|dml|write|post|send|log_?task|add)/i;
const DELETE_TOOL = /(delete|destroy|remove)/i;

function score() {
  for (const c of CASES) {
    const cs = caseState(c.id);
    const apiName = cs.build?.result?.apiName;
    if (!apiName) { cs.score = { error: `no saved agent (build ${cs.build?.status ?? 'not started'})` }; continue; }
    const [agents, nodes] = query([
      `SELECT Id, Name, ApiName__c, ExecuteType__c, Status__c, Description__c FROM AgentDefinition__c WHERE ApiName__c = '${apiName}'`,
      `SELECT NodeType__c, NodeSubType__c, ConfigJson__c, IsEnabled__c FROM AgentNode__c WHERE AgentDefinition__r.ApiName__c = '${apiName}' ORDER BY SortOrder__c`,
    ]);
    const a = agents[0];
    const cfg = n => { try { return JSON.parse(n.ConfigJson__c || '{}'); } catch { return {}; } };
    const tools = nodes.filter(n => n.NodeType__c === 'tool').map(n => ({ name: cfg(n).toolName ?? n.NodeSubType__c, connector: cfg(n).connectorId, approval: !!cfg(n).requiresApproval, desc: cfg(n).description ?? '' }));
    const prompts = nodes.filter(n => n.NodeType__c === 'ai' || cfg(n).systemPrompt).map(n => cfg(n).systemPrompt ?? '').join('\n\n');
    const models = [...new Set(nodes.map(n => cfg(n).model).filter(Boolean))];
    const allText = `${prompts}\n${tools.map(t => `${t.name} ${t.desc}`).join('\n')}`;
    const checks = [];
    const add = (name, result, detail) => checks.push({ name, result, detail });

    add('Built as a Communication agent', a?.ExecuteType__c === 'Chat' ? 'pass' : 'fail', `ExecuteType__c = ${a?.ExecuteType__c}`);
    add('No automation trigger node', nodes.some(n => n.NodeType__c === 'trigger') ? 'fail' : 'pass', nodes.map(n => n.NodeType__c).join(', '));
    const e = c.expect;
    if (e.tools === 'none') add('No Salesforce tools for a facts-only agent', tools.length === 0 ? 'pass' : 'fail', tools.map(t => t.name).join(', ') || 'none');
    else add('Has tools to do the job', tools.length ? 'pass' : 'fail', tools.map(t => `${t.name}${t.approval ? ' (approval)' : ''}`).join(', ') || 'none');
    if (e.tools === 'read-only') add('Read-only: no write tools', tools.some(t => WRITE_TOOL.test(t.name)) ? 'fail' : 'pass', tools.map(t => t.name).join(', '));
    if (e.tools !== 'none') add('No delete tools', tools.some(t => DELETE_TOOL.test(t.name)) ? 'fail' : 'pass', tools.filter(t => DELETE_TOOL.test(t.name)).map(t => t.name).join(', ') || 'none');
    if (e.tools === 'write') add('Can write', tools.some(t => WRITE_TOOL.test(t.name)) || nodes.some(n => n.NodeType__c === 'catalog') ? 'pass' : 'fail', tools.map(t => t.name).join(', '));
    for (const o of e.objects ?? []) add(`Mentions object ${o}`, new RegExp(`\\b(${o})\\b`).test(allText) ? 'pass' : 'fail');
    const hit = (e.promptKeywords ?? []).filter(k => new RegExp(k, 'i').test(prompts));
    const cov = (e.promptKeywords ?? []).length ? hit.length / e.promptKeywords.length : 1;
    add('Instructions cover the requirement', cov === 1 ? 'pass' : cov >= 0.6 ? 'partial' : 'fail', `${hit.length}/${(e.promptKeywords ?? []).length}; missing: ${(e.promptKeywords ?? []).filter(k => !hit.includes(k)).join(' · ') || 'none'}`);
    const res = cs.build.result ?? {};
    const notes = [...(res.notes ?? []), ...(res.assumptions ?? []).map(x => `Assumption: ${x}`), ...(res.prerequisites ?? []).map(p => `Setup: ${typeof p === 'string' ? p : p.title ?? p.description ?? JSON.stringify(p)}`)];
    const verdict = res.review?.verdict ?? 'none';
    add("Builder's own review", verdict === 'pass' ? 'pass' : verdict === 'fail' ? 'fail' : 'partial', `verdict ${verdict}; confidence ${res.confidence ?? '-'}; ${notes.length} note(s)`);

    const pts = checks.reduce((s, x) => s + (x.result === 'pass' ? 1 : x.result === 'partial' ? 0.5 : 0), 0);
    cs.score = { apiName, agentId: a?.Id, status: a?.Status__c, models, tools, promptChars: prompts.length, checks, pct: Math.round((pts / checks.length) * 100), notes };
    console.log(`${c.id} ${apiName} score ${cs.score.pct}% (${checks.filter(x => x.result !== 'pass').map(x => x.name).join('; ') || 'all pass'})`);
  }
  save();
}

// ── conversations ────────────────────────────────────────────────────
function checkReply(turn, reply) {
  const out = [];
  for (const [re, label] of turn.must ?? []) out.push({ kind: 'reply', label, pass: re.test(reply) });
  for (const [re, label] of turn.mustNot ?? []) out.push({ kind: 'reply', label, pass: !re.test(reply), found: (reply.match(re) ?? [])[0] });
  for (const [fn, label] of turn.custom ?? []) out.push({ kind: 'reply', label, pass: fn(reply) });
  return out;
}

function chat(ids) {
  const ctx = { ids: state.ids, start: state.start, leadCountBefore: state.leadCountBefore };
  if (!ctx.ids) throw new Error('Run seed first.');
  for (const c of CASES.filter(c => (ids.length ? ids.includes(c.id) : caseState(c.id).score?.apiName && !caseState(c.id).chat))) {
    const cs = caseState(c.id);
    const apiName = cs.score?.apiName;
    if (!apiName) { console.log(`${c.id}: no agent, skipped.`); continue; }
    if (spent() > BUDGET_USD - 0.3) { console.log(`Budget brake before ${c.id}: spent $${spent().toFixed(3)}.`); break; }

    // The server only chats with Active agents; the builder saves Drafts.
    if (cs.score.status !== 'Active') {
      apex(`AgentDefinition__c a = [SELECT Id FROM AgentDefinition__c WHERE ApiName__c = '${apiName}']; a.Status__c = 'Active'; update a;`, 'activate');
      cs.activated = true;
    }
    // A rerun keeps the earlier attempt for the report.
    if (cs.chat) (cs.previousChats ??= []).push({ ...cs.chat, reason: process.env.COMM_TEST_RERUN_REASON ?? 'rerun' });
    // An agent runs only on the key chosen on its AI node (2b3a694), and the
    // builder does not choose one. Choose the org's preferred OpenAI key, as
    // a person would in the builder, and record that the test did it.
    const [bound] = apex(`AgentDefinition__c a = [SELECT Id FROM AgentDefinition__c WHERE ApiName__c = '${apiName}'];
List<AgentNode__c> ns = [SELECT Id FROM AgentNode__c WHERE AgentDefinition__c = :a.Id AND NodeType__c IN ('ai','subagent') AND AiEngineConnection__c = null];
List<AiEngineConnection__c> k = [SELECT Id, Label__c FROM AiEngineConnection__c WHERE IsActive__c = true AND IsPreferred__c = true AND EngineType__c = 'openai' LIMIT 1];
if (!ns.isEmpty() && !k.isEmpty()) { for (AgentNode__c n : ns) n.AiEngineConnection__c = k[0].Id; update ns; }
System.debug('RES::' + JSON.serialize(new Map<String,Object>{ 'nodes' => ns.size(), 'key' => k.isEmpty() ? null : k[0].Label__c }));`, 'bindkey');
    if (bound.nodes > 0) cs.keyBoundByTest = bound.key;
    const [s] = apex(`AgentChatController.SessionWithMessages s = AgentChatController.startFreshSession('${apiName}', null, null);
System.debug('RES::' + JSON.serialize(new Map<String,Object>{ 'sessionId' => s.session.Id }));`, 'session');
    const run = (cs.chat = { sessionId: s.sessionId, turns: [], costUsd: 0 });
    save();
    console.log(`\n${c.id} ${apiName} session ${s.sessionId}`);

    for (const [i, turn] of c.turns.entries()) {
      const t = { n: i + 1, say: turn.say };
      try {
        const [r] = apex(`Long t0 = System.currentTimeMillis();
AgentChatController.TurnResult r = AgentChatController.sendTurn('${s.sessionId}', ${str(turn.say)}, new List<AgentChatController.AttachmentInput>());
Long ms = System.currentTimeMillis() - t0;
Set<Id> ids = new Set<Id>();
for (ChatMessage__c m : r.newMessages) ids.add(m.Id);
List<Object> msgs = new List<Object>();
for (ChatMessage__c m : [SELECT Role__c, Content__c, ToolCallsJson__c, ToolResultsJson__c, ModelUsed__c, TokensIn__c, TokensOut__c, RequiredApproval__c, ApprovalStatus__c FROM ChatMessage__c WHERE Id IN :ids ORDER BY SequenceNumber__c]) {
  msgs.add(new Map<String,Object>{ 'role' => m.Role__c, 'content' => m.Content__c, 'toolCalls' => m.ToolCallsJson__c, 'toolResults' => m.ToolResultsJson__c == null ? null : m.ToolResultsJson__c.left(1500),
    'model' => m.ModelUsed__c, 'tin' => m.TokensIn__c, 'tout' => m.TokensOut__c, 'approval' => m.RequiredApproval__c, 'approvalStatus' => m.ApprovalStatus__c });
}
System.debug('RES::' + JSON.serialize(new Map<String,Object>{ 'status' => r.status, 'ms' => ms, 'messages' => msgs }));`, `turn-${c.id}-${i + 1}`);
        const assistant = r.messages.filter(m => m.role === 'Assistant');
        t.reply = assistant.map(m => m.content ?? '').join('\n').trim();
        t.status = r.status;
        t.ms = r.ms;
        // A Tool row holds ONE call as an object, not a list.
        t.tools = r.messages.flatMap(m => { try { const v = JSON.parse(m.toolCalls || 'null'); return v == null ? [] : (Array.isArray(v) ? v : [v]).map(x => x.name ?? x.toolName ?? '?'); } catch { return []; } });
        t.toolErrors = r.messages.map(m => m.toolResults).filter(x => x && /"isError"\s*:\s*true|INVALID_|MALFORMED_|Exception/.test(x)).map(x => x.slice(0, 300));
        t.tokensIn = r.messages.reduce((s, m) => s + Number(m.tin || 0), 0);
        t.tokensOut = r.messages.reduce((s, m) => s + Number(m.tout || 0), 0);
        t.model = r.messages.map(m => m.model).find(Boolean);
        t.costUsd = usd(t.model, t.tokensIn, t.tokensOut);
      } catch (e) {
        t.status = 'apex-error';
        t.reply = '';
        t.error = String(e.message).slice(0, 600);
      }

      // A write waiting for approval: approve it, the way a person would on the card.
      try {
        const [ap] = apex(`HttpResponse r = ArchonServerClient.callout('GET', '/api/chat/approvals?sessionId=${s.sessionId}&status=Pending', null, 60000);
List<Object> out = new List<Object>();
Map<String,Object> j = (Map<String,Object>) JSON.deserializeUntyped(r.getBody());
for (Object o : (List<Object>) j.get('approvals')) { Map<String,Object> a = (Map<String,Object>) o;
  HttpResponse d = ArchonServerClient.callout('POST', '/api/chat/approvals/decide', JSON.serialize(new Map<String,Object>{ 'approvalId' => a.get('id'), 'decision' => 'approved', 'deciderUserId' => UserInfo.getUserId() }), 120000);
  out.add(new Map<String,Object>{ 'tool' => a.get('toolName'), 'code' => d.getStatusCode(), 'body' => d.getBody().left(400) }); }
System.debug('RES::' + JSON.serialize(new Map<String,Object>{ 'approved' => out }));`, 'approve');
        if (ap.approved.length) t.approvals = ap.approved;
      } catch (e) {
        t.approvalError = String(e.message).slice(0, 300);
      }

      t.checks = checkReply(turn, t.reply);
      if (turn.soql?.length) {
        try {
          const rows = query(turn.soql.map(q => q.query(ctx)));
          turn.soql.forEach((q, k) => t.checks.push({ kind: 'org', label: q.label, pass: !!q.check(rows[k], ctx), detail: q.detail ? q.detail(rows[k]).slice(0, 400) : undefined }));
        } catch (e) {
          t.checks.push({ kind: 'org', label: 'SOQL check', pass: false, detail: String(e.message).slice(0, 300) });
        }
      }
      if (t.status !== 'complete') t.checks.push({ kind: 'turn', label: 'turn completed', pass: false, detail: t.error ?? t.status });
      run.turns.push(t);
      run.costUsd = run.turns.reduce((s2, x) => s2 + (x.costUsd ?? 0), 0);
      save();
      const failed = t.checks.filter(x => !x.pass);
      console.log(`  T${t.n} ${t.status} ${t.ms ?? '-'}ms $${(t.costUsd ?? 0).toFixed(4)} ${failed.length ? 'FAIL: ' + failed.map(x => x.label).join('; ') : 'ok'}`);
      console.log(`     > ${turn.say.slice(0, 90)}\n     < ${(t.reply || t.error || '').replace(/\s+/g, ' ').slice(0, 220)}`);
      if (spent() > BUDGET_USD) { console.log(`Budget brake inside ${c.id}: spent $${spent().toFixed(3)}.`); break; }
    }
    const [sess] = query([`SELECT UsageByModelJson__c, TokensIn__c, TokensOut__c, CachedTokens__c FROM ChatSession__c WHERE Id = '${s.sessionId}'`]);
    run.session = sess[0] ?? null;
    if (sess[0]?.UsageByModelJson__c) {
      try { run.costUsd = JSON.parse(sess[0].UsageByModelJson__c).reduce((s2, u) => s2 + usd(u.model, u.tokensIn, u.tokensOut), 0); } catch { /* keep per-turn sum */ }
    }
    save();
    console.log(`${c.id} chat cost $${run.costUsd.toFixed(4)}; total spent $${spent().toFixed(3)}`);
  }
}

// ── report ───────────────────────────────────────────────────────────
function report() {
  const L = [];
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '-');
  let bPts = 0, bN = 0, tPass = 0, tAll = 0;
  L.push('# Communication agent test report', '', `Org: \`${ORG}\` · run started ${state.start ?? '-'} · total spend **$${spent().toFixed(2)}** (builds + chats, server price table)`, '');
  L.push('| # | Level | Agent | Build | Build cost | Build time | Builder score | Conversation checks | Chat cost |', '|---|---|---|---|---|---|---|---|---|');
  for (const c of CASES) {
    const cs = caseState(c.id);
    const checks = (cs.chat?.turns ?? []).flatMap(t => t.checks ?? []);
    const pass = checks.filter(x => x.pass).length;
    tPass += pass; tAll += checks.length;
    if (cs.score?.checks) { bPts += cs.score.pct; bN += 1; }
    L.push(`| ${c.id} | ${c.level} | ${c.title}${cs.score?.apiName ? `<br>\`${cs.score.apiName}\`` : ''} | ${cs.build?.status ?? '-'} | $${(cs.build?.costUsd ?? 0).toFixed(3)} | ${cs.build?.elapsedMs ? Math.round(cs.build.elapsedMs / 1000) + ' s' : '-'} | ${cs.score?.pct != null ? cs.score.pct + '%' : cs.score?.error ?? '-'} | ${checks.length ? `${pass}/${checks.length} (${pct(pass, checks.length)})` : '-'} | $${(cs.chat?.costUsd ?? 0).toFixed(3)} |`);
  }
  L.push('', `**Builder accuracy:** ${bN ? Math.round(bPts / bN) + '%' : '-'} (average scorecard) · **Conversation accuracy:** ${pct(tPass, tAll)} (${tPass}/${tAll} checks)`, '');
  // The person-written reading of the run (root causes, priorities), when there is one.
  const analysis = join(RESULTS, 'analysis.md');
  if (existsSync(analysis)) L.push(readFileSync(analysis, 'utf8').trim(), '');

  L.push('## Issue log', '', '| # | Case | Where | Severity | What went wrong | Evidence |', '|---|---|---|---|---|---|');
  let n = 0;
  const esc = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 300);
  for (const c of CASES) {
    const cs = caseState(c.id);
    if (cs.build && cs.build.status !== 'done') L.push(`| ${++n} | ${c.id} | Builder | High | Build ${cs.build.status ?? 'did not start'} | ${esc(cs.build.error ?? cs.build.startBody)} |`);
    for (const s of cs.build?.steps ?? []) for (const f of s.failedCalls ?? []) L.push(`| ${++n} | ${c.id} | Builder · ${s.key} | Medium | Model call returned nothing | ${esc(f)} |`);
    for (const x of cs.score?.checks ?? []) if (x.result !== 'pass') L.push(`| ${++n} | ${c.id} | Builder | ${x.result === 'fail' ? 'High' : 'Low'} | ${esc(x.name)} | ${esc(x.detail)} |`);
    for (const t of cs.chat?.turns ?? []) {
      for (const x of t.checks ?? []) if (!x.pass) L.push(`| ${++n} | ${c.id} T${t.n} | ${x.kind === 'org' ? 'Salesforce result' : x.kind === 'turn' ? 'Runtime' : 'Reply'} | ${x.kind === 'reply' && !/leak|never|no price|delete|declines|refuses/i.test(x.label) ? 'Medium' : 'High'} | ${esc(x.label)} | ${esc(x.detail ?? x.found ?? t.reply)} |`);
      for (const te of t.toolErrors ?? []) L.push(`| ${++n} | ${c.id} T${t.n} | Tool | Medium | Tool returned an error | ${esc(te)} |`);
      if (t.approvalError) L.push(`| ${++n} | ${c.id} T${t.n} | Approval | Medium | Could not read/decide approvals | ${esc(t.approvalError)} |`);
      for (const ap of t.approvals ?? []) if (ap.code !== 200 || /Failed|error/i.test(ap.body)) L.push(`| ${++n} | ${c.id} T${t.n} | Approval | High | Approved write failed to execute | ${esc(ap.tool + ': ' + ap.body)} |`);
    }
    for (const p of cs.previousChats ?? []) {
      const all = p.turns.flatMap(t => t.checks ?? []);
      const sample = p.turns.find(t => (t.checks ?? []).some(x => !x.pass));
      L.push(`| ${++n} | ${c.id} (earlier run) | Runtime | High | ${esc(p.reason)} - ${all.filter(x => !x.pass).length}/${all.length} checks failed, ${p.turns.reduce((s, t) => s + (t.tools?.length ?? 0), 0)} tool calls | ${esc(sample ? `T${sample.n}: ${sample.reply}` : '')} |`);
    }
  }
  if (!n) L.push('| - | - | - | - | No issues | - |');

  for (const c of CASES) {
    const cs = caseState(c.id);
    L.push('', `## ${c.id} · ${c.level} · ${c.title}`, '', `**Requirement given to the builder:** ${esc(c.requirement).slice(0, 600)}…`, '');
    if (cs.build) {
      L.push(`**Build:** ${cs.build.status} · $${(cs.build.costUsd ?? 0).toFixed(3)} · ${Math.round((cs.build.elapsedMs ?? 0) / 1000)} s · job \`${cs.build.jobId}\``);
      L.push('', '| Stage | State | Time | Cost | Detail |', '|---|---|---|---|---|');
      for (const s of cs.build.steps ?? []) L.push(`| ${s.key} | ${s.state} | ${s.ms ? Math.round(s.ms / 1000) + ' s' : '-'} | ${s.costUsd != null ? '$' + Number(s.costUsd).toFixed(3) : '-'} | ${esc(s.detail)} |`);
      if (cs.score?.notes?.length) L.push('', "**Builder's notes:**", ...cs.score.notes.slice(0, 12).map(x => `- ${esc(typeof x === 'string' ? x : JSON.stringify(x))}`));
    }
    if (cs.score?.checks) {
      L.push('', `**Builder scorecard: ${cs.score.pct}%** · status ${cs.score.status}${cs.activated ? ' (activated by the test)' : ''} · models ${cs.score.models.join(', ') || '-'} · instructions ${cs.score.promptChars} chars`);
      L.push(`Tools: ${cs.score.tools.map(t => `\`${t.name}\`${t.approval ? ' (approval)' : ''}`).join(', ') || 'none'}`, '', '| Check | Result | Detail |', '|---|---|---|');
      for (const x of cs.score.checks) L.push(`| ${esc(x.name)} | ${x.result} | ${esc(x.detail)} |`);
    }
    if (cs.chat) {
      L.push('', `**Conversation** (session \`${cs.chat.sessionId}\`, $${cs.chat.costUsd.toFixed(3)})`, '');
      for (const t of cs.chat.turns) {
        const bad = (t.checks ?? []).filter(x => !x.pass);
        L.push(`**T${t.n}** ${bad.length ? '❌' : '✅'} · ${t.ms ? (t.ms / 1000).toFixed(1) + ' s' : '-'} · ${t.tokensIn ?? 0} in / ${t.tokensOut ?? 0} out${t.tools?.length ? ' · tools: ' + t.tools.join(', ') : ''}${t.approvals ? ' · approved: ' + t.approvals.map(a => a.tool).join(', ') : ''}`);
        L.push(`> **Customer:** ${esc(t.say)}`, '>', `> **Agent:** ${esc(t.reply || t.error || '(no reply)').slice(0, 700)}`, '');
        for (const x of t.checks ?? []) L.push(`- ${x.pass ? '✅' : '❌'} ${x.label}${!x.pass && (x.detail || x.found) ? ` — ${esc(x.detail ?? x.found)}` : ''}`);
        L.push('');
      }
    }
  }
  writeFileSync(join(RESULTS, 'report.md'), L.join('\n'));
  console.log(`Wrote ${join(RESULTS, 'report.md')}`);
}

// ── main ─────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);
// Re-grade stored replies after a pattern fix -- free, no turns re-run.
function regrade() {
  for (const c of CASES) {
    const cs = caseState(c.id);
    for (const t of cs.chat?.turns ?? []) {
      const turn = c.turns[t.n - 1];
      if (!turn || turn.say !== t.say) continue;
      const kept = (t.checks ?? []).filter(x => x.kind !== 'reply');
      t.checks = [...checkReply(turn, t.reply ?? ''), ...kept];
    }
  }
  save();
  console.log('Re-graded stored replies.');
}

const cmds = { seed, cleanup, regrade, build: () => startBuilds(rest), poll: pollBuilds, score, chat: () => chat(rest), report };
if (!cmds[cmd]) { console.log('Commands: seed | build [ids] | poll | score | chat [ids] | report | cleanup'); process.exit(1); }
await cmds[cmd]();
