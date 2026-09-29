// One chat turn over the websocket, the way the chat panel does it. Mint the
// ticket first: sf apex run --file scripts/apex/real/mint-ws-ticket.apex, put the
// JSON after 'TICKET~~200~~' in a file (with &quot; turned back into quotes) and run
// this within 45 s. The reply and the history for the next turn land in C:/tmp.
// mint a ticket through Apex REST, connect, send the turn, print the result.
// usage: node ws-turn.mjs <ticketJsonFile> <historyFile|-> "<message>"
// The ticket file is what Apex minted: {"ticket":"…","wsUrl":"wss://…"}.
import { readFileSync, writeFileSync } from 'node:fs';
// The gateway admits Salesforce-hosted origins only; Node's built-in
// WebSocket cannot send an Origin header, the ws package can.
import WebSocket from 'file:///C:/Users/Annu/Documents/Sfdx/AIAgentBuilder/server-langchain/node_modules/ws/wrapper.mjs';

const ORIGIN = 'https://orgfarm-ac9142a7a9-dev-ed.develop.my.salesforce.app';
const [ticketFile, historyFile, message] = process.argv.slice(2);
const history = historyFile && historyFile !== '-' ? JSON.parse(readFileSync(historyFile, 'utf8')) : [];

const t0 = Date.now();
const { ticket, wsUrl } = JSON.parse(readFileSync(ticketFile, 'utf8'));

const ws = new WebSocket(`${wsUrl}?ticket=${encodeURIComponent(ticket)}`, { headers: { Origin: ORIGIN } });
const stages = [];
const done = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('no result in 9 minutes')), 9 * 60 * 1000);
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ newUserMessage: message, history, stream: true }));
  });
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(String(ev.data));
    if (msg.type === 'stage') { if (msg.state === 'start') stages.push(`${msg.via === 'specialist' ? '  ' : ''}${msg.name}`); return; }
    if (msg.type === 'text.delta' || msg.type === 'text.reset') return;
    clearTimeout(timer);
    resolve(msg);
  });
  ws.addEventListener('error', e => { clearTimeout(timer); reject(new Error(`socket error ${e.message ?? ''}`)); });
  ws.addEventListener('close', e => setTimeout(() => reject(new Error(`closed ${e.code} ${e.reason}`)), 500));
});

const result = await done;
ws.close();
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const calls = result.toolCalls ?? [];
const tree = (c, depth = 0) => {
  const pad = '  '.repeat(depth);
  let line = `${pad}${c.name}`;
  if (c.name === 'serialize') {
    const raw = c.input?.ir;
    const n = Array.isArray(raw) ? raw.length : 1;
    let out = c.output;
    try { out = typeof out === 'string' ? JSON.parse(out) : out; } catch { /* text */ }
    line += ` [${n} envelope(s)] -> ${out?.changeId ?? ''} count=${out?.count ?? ''}`;
  }
  if (c.name === 'deploy' || c.name === 'check_deploy') line += ` -> ${String(c.output ?? '').slice(0, 120).replace(/\n/g, ' ')}`;
  if (c.isError) line += ' (error)';
  return [line, ...(c.nested ?? []).flatMap(n => tree(n, depth + 1))];
};
console.log(`status=${result.status} ${secs}s model=${result.modelUsed} in=${result.tokensIn} out=${result.tokensOut}`);
console.log('stages:', stages.length, stages.slice(0, 60).join(' | '));
console.log('tools:');
for (const c of calls) for (const l of tree(c)) console.log(' ', l);
console.log('---- reply ----');
console.log(result.assistantText ?? result.error ?? result.message ?? '');
// The history for the next turn, as the chat panel keeps it: the tool
// results of this turn ride along on the assistant entry (ChatPanel.tsx).
let toolContext = '';
if (calls.length > 0) {
  const summaries = calls.slice(0, 6).map(tc => {
    const output = typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output ?? '');
    return `${tc.name}(${JSON.stringify(tc.input ?? {}).slice(0, 200)}) -> ${output.slice(0, 600)}`;
  });
  toolContext = `\n\n[Internal tool results from this turn — reuse exact Ids/values from here in later turns, never invent or truncate them:\n${summaries.join('\n')}]`;
}
const next = [...history, { role: 'user', content: message }, { role: 'assistant', content: (result.assistantText ?? '') + toolContext }];
writeFileSync('C:/tmp/ws-history.json', JSON.stringify(next));
