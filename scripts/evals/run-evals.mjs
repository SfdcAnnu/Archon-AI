#!/usr/bin/env node
/**
 * Revival-agent eval runner — replays scripted WhatsApp conversations against
 * the REAL agent (real session, real server, real models, real org tools) and
 * asserts on facts: reply content, records created, stage changes, price
 * floors. Run after every prompt or server change:
 *
 *     node scripts/evals/run-evals.mjs            (uses the default sf org)
 *     node scripts/evals/run-evals.mjs -o MyOrg   (explicit org alias)
 *
 * Each scenario seeds a fresh automated session on the test Opportunity
 * (template opener logged, stage reset to Closed Lost, intel/Tasks/Events
 * cleared), drives the turns through AgentChatController.sendTurn — the same
 * entry point the WhatsApp bridge uses — and cleans up after itself.
 * The 360SMS message TEMPLATE is never touched, and no SMS goes out
 * (sendTurn alone never sends; only the bridge does).
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Test fixture constants (this client org) ─────────────────────────
const AGENT = 'whatsapp_lost_opportunity_revival';
const OPP_ID = '006g5000006ric9AAA';
const FLOOR_TOTAL = 54250;    // GenWatt 21,250 + Installation 16,000 + SLA 17,000
const FIRST_OFFER = 57200;    // 12% off the $65,000 list total

const orgFlagIdx = process.argv.indexOf('-o');
const ORG_ARGS = orgFlagIdx > -1 ? ['-o', process.argv[orgFlagIdx + 1]] : [];
// --only S1  runs just the scenarios whose name starts with that prefix.
const onlyIdx = process.argv.indexOf('--only');
const ONLY_PREFIX = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;

// ── Scenarios ────────────────────────────────────────────────────────
// must / mustNot: regexes on the reply. soql: checks after the turn.
// belowFloorCheck: reject a first-person offer of $45,000–$54,249.

// Internal-system narration only — bare "opportunity"/"record" are normal
// English ("a great opportunity") and false-flagged in an early run.
const CRM_INTERNALS = /\b(CRM|salesforce|database|opportunity stage|record (?:has been )?(?:created|updated)|created a (?:task|record)|updated the (?:record|system|opportunity))\b/i;
const FAREWELL = /\b(goodbye|take care|have a great day|feel free to reach out)\b/i;

const SCENARIOS = [
  {
    name: 'S1 Full revival journey (objection → intel → escalation)',
    turns: [
      {
        message: 'Hi',
        must: [[/Annu/i, 'greets by name'], [/GenWatt/i, 'names the deal'], [/\?/, 'ends advancing with a question']],
        mustNot: [[/how can i (help|assist)/i, 'no generic greeting']],
      },
      {
        message: 'What is the price breakdown for my deal?',
        must: [[/25,000/, 'GenWatt line price'], [/65,000/, 'deal total']],
        mustNot: [[/\b(one moment|let me (get|check|pull|fetch))\b/i, 'no deferral stall']],
      },
      {
        message: 'No',
        must: [[/\?/, 'probes instead of closing']],
        mustNot: [[FAREWELL, '"No" treated as objection, not goodbye']],
      },
      {
        message: 'Honestly your price is too high. I checked the market and other vendors give much better price',
        must: [[/\b(who|which|vendor|provider|quoted|company)\b/i, 'intel gate: asks who quoted']],
        mustNot: [[/\d{1,2}\s?%/, 'no discount % in the intel-gate reply'], [/\$5[0-9],\d{3}/, 'no revised price in the intel-gate reply']],
      },
      {
        message: 'Its Tracktion, they offered 40k for everything with 24x7 support included',
        must: [[/\?/, 'keeps advancing after intel']],
        belowFloorCheck: true,
        soql: [
          {
            label: 'competitor intel stored on Opportunity',
            query: `SELECT CompetitorIntel__c FROM Opportunity WHERE Id = '${OPP_ID}'`,
            check: (rows) => (rows[0]?.CompetitorIntel__c ?? '').includes('Tracktion'),
          },
        ],
      },
      {
        message: '40k is my final budget. Take it or leave it, otherwise I am moving to Tracktion',
        must: [[/\b(tomorrow|morning|afternoon|time|when would|what time)\b/i, 'escalation asks the meeting time']],
        mustNot: [[CRM_INTERNALS, 'no CRM internals narrated to customer']],
        belowFloorCheck: true,
      },
      {
        message: 'Tomorrow morning works for me',
        // The 24h commitment may land in this reply or the previous one —
        // accept a concrete time restatement as the commitment here.
        must: [[/24\s?(-|\s)?hours?|tomorrow/i, 'commits to the follow-up (24h quote or confirmed time)']],
        mustNot: [[CRM_INTERNALS, 'no CRM internals narrated to customer']],
        soql: [
          {
            label: 'exactly one Revival Task',
            query: `SELECT COUNT() FROM Task WHERE WhatId = '${OPP_ID}' AND Subject LIKE 'Revival%'`,
            check: (_rows, totalSize) => totalSize === 1,
          },
          {
            label: 'exactly one Revival Event',
            query: `SELECT COUNT() FROM Event WHERE WhatId = '${OPP_ID}' AND Subject LIKE 'Revival%'`,
            check: (_rows, totalSize) => totalSize === 1,
          },
          {
            label: 'stage moved to Negotiation/Review',
            query: `SELECT StageName FROM Opportunity WHERE Id = '${OPP_ID}'`,
            check: (rows) => rows[0]?.StageName === 'Negotiation/Review',
          },
        ],
      },
    ],
  },
  {
    name: 'S2 Discount ladder + close (deterministic prices)',
    turns: [
      {
        message: 'Hello. Before anything else — give me your best revised price for the full deal.',
        must: [[/57,200/, `first offer is the injected ${fmt(FIRST_OFFER)}`]],
        mustNot: [[/54,250/, 'final floor price NOT revealed on the first ask']],
        belowFloorCheck: true,
      },
      {
        message: 'That is still not enough. What is the absolute final price you can approve?',
        must: [[/54,250/, `final offer is the injected floor ${fmt(FLOOR_TOTAL)}`]],
        mustNot: [[/\b(floor|concession|matrix|policy)\b/i, 'no internal vocabulary']],
        belowFloorCheck: true,
      },
      {
        message: 'Ok fine, 54,250 works for me. Lets move ahead.',
        must: [[/\b(confirm|proceed|arrange|specialist|next|call|quote|great|excellent|wonderful)\b/i, 'closes with forward motion']],
        mustNot: [[FAREWELL, 'no passive farewell on a buying signal']],
      },
    ],
  },
];

// ── sf CLI helpers ───────────────────────────────────────────────────

const tmp = mkdtempSync(join(tmpdir(), 'revival-evals-'));

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function sf(args) {
  // Transient CLI/network failures ("fetch failed", ETIMEDOUT) happen on
  // long runs — retry twice before treating it as a real failure.
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // shell:true on Windows joins args without quoting — quote anything
      // with whitespace ourselves or a SOQL query splits into stray args.
      const quoted = [...args, ...ORG_ARGS].map(a => (/\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
      return execFileSync('sf', quoted, {
        shell: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 300_000,
      });
    } catch (err) {
      lastErr = err;
      const msg = `${err.message} ${err.stderr ?? ''}`;
      if (attempt < 3 && /fetch failed|ETIMEDOUT|ECONNRESET|ENOTFOUND|socket hang up/i.test(msg)) {
        console.log(`    (transient sf CLI failure, retry ${attempt}/2)`);
        sleepSync(5000 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function runApex(code, label) {
  const file = join(tmp, `${label}-${Date.now()}.apex`);
  writeFileSync(file, code, 'utf8');
  return sf(['apex', 'run', '--file', file]);
}

function soqlQuery(query) {
  const out = sf(['data', 'query', '-q', query, '--json']);
  const parsed = JSON.parse(out.slice(out.indexOf('{')));
  return { rows: parsed.result?.records ?? [], totalSize: parsed.result?.totalSize ?? 0 };
}

const apexStr = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function fmt(n) { return '$' + n.toLocaleString('en-US'); }

// ── Seed / turn / cleanup Apex ───────────────────────────────────────

const RESET_APEX = `
Opportunity opp = [SELECT Id, StageName, CompetitorIntel__c FROM Opportunity WHERE Id = '${OPP_ID}'];
opp.StageName = 'Closed Lost';
opp.CompetitorIntel__c = null;
update opp;
delete [SELECT Id FROM Task WHERE WhatId = :opp.Id AND Subject LIKE 'Revival%'];
delete [SELECT Id FROM Event WHERE WhatId = :opp.Id AND Subject LIKE 'Revival%'];
List<ChatSession__c> sessions = [SELECT Id FROM ChatSession__c WHERE RecordContextId__c = '${OPP_ID}' AND AgentDefinition__r.ApiName__c = '${AGENT}'];
delete [SELECT Id FROM ChatMessage__c WHERE ChatSession__c IN :sessions];
delete sessions;
System.debug('RESET_DONE');
`;

const SEED_APEX = `
Opportunity opp = [SELECT Id, OwnerId FROM Opportunity WHERE Id = '${OPP_ID}'];
ChatSession__c session = AgentChatController.findOrCreateAutomatedSession('${AGENT}', opp.Id, 'Opportunity', opp.OwnerId);
insert new ChatMessage__c(
    ChatSession__c    = session.Id,
    Role__c           = 'Assistant',
    Content__c        = 'Hi Annu Choudhary, thank you for considering 360 Degree Cloud Technologies for Annu Choudhary - GenWatt Diesel 200kW Deal. We understand the deal didn\\'t move forward due to pricing, and we\\'d genuinely like to find a way to make this work for you. Could you share what pricing would work on your end?',
    SequenceNumber__c = AgentChatController.nextSequenceNumber(session.Id),
    ApprovalStatus__c = 'NotRequired'
);
System.debug('SESSION_ID=' + session.Id);
`;

function turnApex(sessionId, message) {
  return `
AgentChatController.TurnResult r = AgentChatController.sendTurn('${sessionId}', '${apexStr(message)}', new List<AgentChatController.AttachmentInput>());
String reply = '';
for (ChatMessage__c m : r.newMessages) { if (m.Role__c == 'Assistant') reply = m.Content__c; }
System.debug('TURN=' + r.status + ' :: ' + (reply == null ? '' : reply.replace('\\n', ' | ')));
`;
}

// ── Below-floor offer detector (mirrors the server guardrail, with a
// tighter 45k lower bound so the competitor's echoed 40k never
// false-flags an otherwise-good reply) ───────────────────────────────

const OFFER_CONTEXT = /\b(i can|i'll|i’ll|i will|we can|we'll|we’ll|happy to|able to)\b[^.!?\n]*\b(offer|bring|do|go|reduce|give|approve|match|come down|drop|extend)\b|\bbest (price|i can do|we can do)\b|\bfinal (price|offer)\b|\bbring (it|this|that) (down )?to\b|\brevised (price|total|offer|quote)\b|\blowest\b/i;

function belowFloorOffer(reply) {
  for (const sentence of reply.split(/(?<=[.!?])\s+|\|/)) {
    if (!OFFER_CONTEXT.test(sentence)) continue;
    for (const m of sentence.matchAll(/\$?\s?(\d{2},\d{3})(?:\s?USD)?/g)) {
      const amt = Number(m[1].replace(/,/g, ''));
      if (amt >= 45000 && amt < FLOOR_TOTAL) return amt;
    }
  }
  return null;
}

// ── Runner ───────────────────────────────────────────────────────────

let pass = 0, fail = 0;
const failures = [];

function record(ok, scenario, turnNo, label, detail) {
  const mark = ok ? ' ✓' : ' ✗';
  console.log(`${mark} [${scenario} · turn ${turnNo}] ${label}${ok ? '' : ' — ' + detail}`);
  if (ok) pass++; else { fail++; failures.push(`[${scenario} · turn ${turnNo}] ${label}: ${detail}`); }
}

try {
  for (const scenario of SCENARIOS.filter(s => !ONLY_PREFIX || s.name.startsWith(ONLY_PREFIX))) {
    console.log(`\n▶ ${scenario.name}`);
    runApex(RESET_APEX, 'reset');
    const seedOut = runApex(SEED_APEX, 'seed');
    const sessionId = (seedOut.match(/SESSION_ID=(\w{15,18})/) ?? [])[1];
    if (!sessionId) { console.error('Seeding failed — no SESSION_ID in output:\n' + seedOut.slice(-2000)); process.exit(2); }

    let turnNo = 0;
    for (const turn of scenario.turns) {
      turnNo++;
      console.log(`  → "${turn.message.length > 70 ? turn.message.slice(0, 70) + '…' : turn.message}"`);
      const out = runApex(turnApex(sessionId, turn.message), `turn${turnNo}`);
      const m = out.match(/\|DEBUG\|TURN=(\w+) :: (.*)/);
      const status = m?.[1] ?? 'missing';
      const reply = m?.[2]?.trim() ?? '';
      record(status === 'complete' && reply.length > 0, scenario.name, turnNo, 'turn completed with a reply',
        `status=${status}, output tail: ${out.slice(-500).replace(/\n/g, ' ')}`);
      if (!reply) continue;
      console.log(`    reply: ${reply.length > 220 ? reply.slice(0, 220) + '…' : reply}`);

      for (const [re, label] of turn.must ?? []) {
        record(re.test(reply), scenario.name, turnNo, label, `expected /${re.source}/ in reply`);
      }
      for (const [re, label] of turn.mustNot ?? []) {
        record(!re.test(reply), scenario.name, turnNo, label, `forbidden /${re.source}/ matched "${(re.exec(reply) ?? [''])[0]}"`);
      }
      if (turn.belowFloorCheck) {
        const amt = belowFloorOffer(reply);
        record(amt === null, scenario.name, turnNo, `no offer below the ${fmt(FLOOR_TOTAL)} floor`, `offered ${fmt(amt ?? 0)}`);
      }
      for (const s of turn.soql ?? []) {
        const { rows, totalSize } = soqlQuery(s.query);
        record(Boolean(s.check(rows, totalSize)), scenario.name, turnNo, s.label, `query returned ${JSON.stringify(rows).slice(0, 300)} (totalSize=${totalSize})`);
      }
    }
  }
} finally {
  console.log('\n↺ Cleaning up test data (stage → Closed Lost, intel/Tasks/Events/session cleared)…');
  try { runApex(RESET_APEX, 'final-reset'); } catch (e) { console.error('Cleanup failed — run it manually:', e.message); }
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${'─'.repeat(60)}\nRESULT: ${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log('  ✗ ' + f); }
process.exit(fail > 0 ? 1 : 0);
