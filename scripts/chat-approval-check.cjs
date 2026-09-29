// Run: node scripts/chat-approval-check.cjs (Chrome installed; the sf CLI default org). Logs in through
// the CLI's one-time link, opens the app from its App Launcher tile (it lives on its own
// *.my.salesforce.app domain), and screenshots a chat session with its approval cards.
// Opens the deployed app in Chrome through a front-door login, goes to
// Chat → Metadata Expert → the "Bundle Test" session, and reports what the
// chat shows for its pending approvals. Screenshots land in the scratchpad.
const fs = require('fs');
const path = require('path');
const APP = 'C:/Users/Annu/Documents/Sfdx/AIAgentBuilder/force-app/main/default/uiBundles/AgentBuilderApp';
const { chromium } = require(path.join(APP, 'node_modules/playwright-core'));
const OUT = require('os').tmpdir();

(async () => {
  // The CLI's login link is a one-time code that expires within minutes:
  // mint it here and open it at once.
  const { execSync } = require('child_process');
  const minted = JSON.parse(execSync('sf org open --url-only --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: 'powershell.exe', cwd: 'C:/Users/Annu/Documents/Sfdx/AIAgentBuilder' }));
  const frontdoor = minted.result.url;
  fs.writeFileSync('C:/tmp/frontdoor.txt', frontdoor);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => errors.push(`pageerror ${String(e).slice(0, 200)}`));

  await page.goto(`${frontdoor}&retURL=${encodeURIComponent('/lightning/app/06mg5000009vgVCAAY')}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000 && !/lightning\.force\.com|\/lwr\//.test(page.url())) await page.waitForTimeout(1000);
  console.log('after login url:', page.url().slice(0, 120));
  await page.screenshot({ path: path.join(OUT, 'approval-0-login.png') });
  // The UI Bundle app's own URL: read it off its App Launcher tile.
  let base = null;
  await page.goto('https://orgfarm-ac9142a7a9-dev-ed.develop.lightning.force.com/lightning/page/home', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const launcher = page.locator('button[title="App Launcher"], .slds-icon-waffle_container, button.slds-icon-waffle_container').first();
  await launcher.waitFor({ timeout: 60_000 });
  await launcher.click();
  const search = page.getByPlaceholder(/Search apps/i).first();
  await search.waitFor({ timeout: 30_000 });
  await search.fill('Archon Agent Builder');
  await page.waitForTimeout(2500);
  // Lightning renders the tiles inside shadow roots: walk them all.
  const links = await page.evaluate(() => {
    const out = [];
    const walk = root => {
      for (const el of root.querySelectorAll('*')) {
        if (el.tagName === 'A' && el.href) out.push({ text: (el.textContent || '').trim().slice(0, 40), href: el.href });
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    return out.filter(l => /lwr|application|Archon/i.test(l.href + ' ' + l.text));
  });
  console.log('launcher links:', JSON.stringify(links).slice(0, 1200));
  await page.screenshot({ path: path.join(OUT, 'approval-0-launcher.png') });
  let tile = links.find(l => /lwr\//.test(l.href)) ?? links.find(l => /Archon Agent Builder/.test(l.text));
  if (!tile) {
    // Click the app in the launcher's results and see where Salesforce goes —
    // a UI Bundle app may open in a new tab.
    const before = page.url();
    const popupPromise = page.context().waitForEvent('page', { timeout: 20_000 }).catch(() => null);
    const row = page.locator('one-app-launcher-menu-item, [role="option"], .slds-app-launcher__tile, li').filter({ hasText: 'Archon Agent Builder' }).first();
    const rowCount = await row.count();
    console.log('launcher rows matching:', rowCount);
    if (rowCount) await row.click({ force: true }).catch(e => console.log('row click failed', e.message));
    else await page.getByText('Archon Agent Builder', { exact: true }).last().click({ force: true }).catch(e => console.log('tile click failed', e.message));
    const popup = await popupPromise;
    const t2 = Date.now();
    while (Date.now() - t2 < 30_000 && page.url() === before && !popup && !(await page.locator('#root').count())) await page.waitForTimeout(1000);
    if (popup) { await popup.waitForLoadState('domcontentloaded').catch(() => null); console.log('popup url:', popup.url().slice(0, 160)); }
    console.log('after tile click:', page.url().slice(0, 140), 'root:', await page.locator('#root').count());
    const target = popup && /\/app\/|\/lwr\//.test(popup.url()) ? popup.url() : (/\/lwr\//.test(page.url()) || (await page.locator('#root').count())) ? page.url() : null;
    if (target) tile = { href: target };
    if (popup && target === popup.url()) {
      // The app lives on its own domain: carry on in that tab.
      const app = popup;
      app.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
      const appBase = target.replace(/[?#].*$/, '').replace(/\/$/, '');
      console.log('app base:', appBase);
      await app.goto(`${appBase}/chat`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await app.getByText('Metadata Expert', { exact: true }).first().waitFor({ timeout: 60_000 });
      await app.getByText('Metadata Expert', { exact: true }).first().click();
      await app.getByText(/Create a small test app/).first().waitFor({ timeout: 60_000 });
      await app.getByText(/Create a small test app/).first().click();
      await app.waitForTimeout(8000);
      await app.screenshot({ path: path.join(OUT, 'approval-1-chat.png') });
      const approveButtons = await app.getByRole('button', { name: /Approve & run/ }).count();
      const badges = await app.locator('text=Needs approval').count();
      console.log('approve buttons:', approveButtons, 'needs-approval badges:', badges);
      await app.evaluate(() => { for (const el of document.querySelectorAll('*')) { if (el.scrollHeight > el.clientHeight + 50) el.scrollTop = el.scrollHeight; } });
      await app.waitForTimeout(800);
      await app.screenshot({ path: path.join(OUT, 'approval-2-bottom.png') });
      const box = await app.getByRole('button', { name: /Approve & run/ }).first().boundingBox().catch(() => null);
      console.log('first approve button box:', JSON.stringify(box), 'viewport 1440x1000');
      console.log('console errors:', errors.slice(0, 8));
      await browser.close();
      return;
    }
  }
  if (!tile) {
    const my = 'https://orgfarm-ac9142a7a9-dev-ed.develop.my.salesforce.com';
    for (const cand of [`${my}/lwr/application/AgentBuilderApp`, `${my}/lwr/application/9YEg500000004DJGAY`, `${my}/lwr/application/c/AgentBuilderApp/`, `${my}/lwr/app/c/AgentBuilderApp`]) {
      const r = await page.goto(cand, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null);
      const status = r ? r.status() : 0;
      const hasRoot = await page.locator('#root').count().catch(() => 0);
      console.log('try', cand.replace(my, ''), 'status', status, 'root', hasRoot);
      if (status === 200 && hasRoot) { tile = { href: page.url() }; break; }
    }
  }
  if (!tile) { console.log('no tile; errors:', errors); await browser.close(); return; }
  await page.goto(tile.href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const t1 = Date.now();
  while (Date.now() - t1 < 60_000 && !(await page.locator('#root').count())) await page.waitForTimeout(1000);
  console.log('app url:', page.url().slice(0, 140), 'root:', await page.locator('#root').count());
  const m = page.url().match(/^(https:\/\/[^/]+\/lwr\/application\/[^/?#]+\/[^/?#]+)/) ?? page.url().match(/^(https:\/\/[^/]+\/lwr\/application\/[^/?#]+)/);
  base = m ? m[1] : null;
  if (!base) { await page.screenshot({ path: path.join(OUT, 'approval-0-app.png') }); console.log('unexpected app url; errors:', errors); await browser.close(); return; }
  console.log('app base:', base);

  await page.goto(`${base}/chat`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByText('Metadata Expert', { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.getByText('Metadata Expert', { exact: true }).first().click();
  await page.getByText(/Create a small test app/).first().waitFor({ timeout: 60_000 });
  await page.getByText(/Create a small test app/).first().click();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: path.join(OUT, 'approval-1-chat.png') });
  const approveButtons = await page.getByRole('button', { name: /Approve & run/ }).count();
  const cards = await page.locator('text=Needs approval').count();
  console.log('approve buttons:', approveButtons, 'needs-approval badges:', cards);
  // Where the cards sit: scroll the chat to the bottom and shoot again.
  await page.evaluate(() => { for (const el of document.querySelectorAll('*')) { if (el.scrollHeight > el.clientHeight + 50) el.scrollTop = el.scrollHeight; } });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'approval-2-bottom.png') });
  const box = await page.getByRole('button', { name: /Approve & run/ }).first().boundingBox().catch(() => null);
  console.log('first approve button box:', JSON.stringify(box));
  console.log('console errors:', errors.slice(0, 8));
  await browser.close();
})().catch(e => { console.log('failed:', e.message); process.exit(1); });
