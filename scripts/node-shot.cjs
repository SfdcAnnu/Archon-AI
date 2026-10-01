// Run (Git Bash): MSYS_NO_PATHCONV=1 node scripts/node-shot.cjs <agentApiName> "<node title>" [name]
// Logs in, opens the deployed builder for the agent, clicks the canvas node
// whose title matches, and screenshots the properties panel into the OS
// temp dir as shot-<name>-node.png. For checking a node form on real data.
const path = require('path');
const APP = 'C:/Users/Annu/Documents/Sfdx/AIAgentBuilder/force-app/main/default/uiBundles/AgentBuilderApp';
const { chromium } = require(path.join(APP, 'node_modules/playwright-core'));
const OUT = require('os').tmpdir();
const apiName = process.argv[2];
const nodeTitle = process.argv[3] || '';
const name = process.argv[4] || apiName;
if (!apiName) { console.log('usage: node scripts/node-shot.cjs <agentApiName> "<node title>" [name]'); process.exit(2); }

(async () => {
  const { execSync } = require('child_process');
  const minted = JSON.parse(execSync('sf org open --url-only --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: 'powershell.exe', cwd: 'C:/Users/Annu/Documents/Sfdx/AIAgentBuilder' }));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  await page.goto(`${minted.result.url}&retURL=${encodeURIComponent('/lightning/page/home')}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000 && !/lightning\.force\.com/.test(page.url())) await page.waitForTimeout(1000);
  await page.goto('https://orgfarm-ac9142a7a9-dev-ed.develop.lightning.force.com/lightning/page/home', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const launcher = page.locator('button[title="App Launcher"], .slds-icon-waffle_container, button.slds-icon-waffle_container').first();
  await launcher.waitFor({ timeout: 60_000 });
  await launcher.click();
  const search = page.getByPlaceholder(/Search apps/i).first();
  await search.waitFor({ timeout: 30_000 });
  await search.fill('Archon Agent Builder');
  await page.waitForTimeout(2500);
  const popupPromise = page.context().waitForEvent('page', { timeout: 20_000 }).catch(() => null);
  const row = page.locator('one-app-launcher-menu-item, [role="option"], .slds-app-launcher__tile, li').filter({ hasText: 'Archon Agent Builder' }).first();
  if (await row.count()) await row.click({ force: true }).catch(() => null);
  else await page.getByText('Archon Agent Builder', { exact: true }).last().click({ force: true }).catch(() => null);
  const popup = await popupPromise;
  if (popup) await popup.waitForLoadState('domcontentloaded').catch(() => null);
  const app = popup && /\/app\//.test(popup.url()) ? popup : page;
  const t1 = Date.now();
  while (Date.now() - t1 < 60_000 && !(await app.locator('#root').count())) await app.waitForTimeout(1000);
  app.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  app.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  const base = app.url().replace(/[?#].*$/, '').replace(/\/$/, '');
  await app.evaluate(r => { window.history.pushState({}, '', r); window.dispatchEvent(new PopStateEvent('popstate')); }, `${new URL(base).pathname}/agent/${apiName}`);
  await app.waitForTimeout(12_000);
  // React Flow draws each node as a .react-flow__node; click the one whose text matches.
  const node = app.locator('.react-flow__node').filter({ hasText: nodeTitle }).first();
  if (await node.count()) { await node.click(); await app.waitForTimeout(9000); }
  else console.log('no node matching', JSON.stringify(nodeTitle), '— nodes:', await app.locator('.react-flow__node').allInnerTexts().then(t => t.map(s => s.replace(/\s+/g, ' ').slice(0, 40))));
  // TIDY=1 presses Tidy up before the shot (nothing is saved).
  if (process.env.TIDY) {
    const tidy = app.getByRole('button', { name: 'Tidy up' }).first();
    if (await tidy.count()) { await tidy.click(); await app.waitForTimeout(2500); } else console.log('no Tidy up button');
  }
  await app.screenshot({ path: path.join(OUT, `shot-${name}-node.png`) });
  // The panel scrolls on its own; shoot its bottom too.
  await app.evaluate(() => { for (const el of document.querySelectorAll('aside, [data-panel], div')) { if (el.scrollHeight > el.clientHeight + 50 && el.clientWidth < 520) el.scrollTop = el.scrollHeight; } });
  await app.waitForTimeout(600);
  await app.screenshot({ path: path.join(OUT, `shot-${name}-node-2.png`) });
  console.log('saved:', path.join(OUT, `shot-${name}-node.png`), '| page errors:', errors.slice(0, 5));
  await browser.close();
})().catch(e => { console.log('failed:', e.message); process.exit(1); });
