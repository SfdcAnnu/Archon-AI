// Run (Git Bash): MSYS_NO_PATHCONV=1 node scripts/runs-shot.cjs
// Opens Runs in the deployed app, selects the newest run that has an
// output payload, scrolls its record card to the payload and screenshots
// it — and reports whether the page scrolls sideways (it must not).
const path = require('path');
const APP = 'C:/Users/Annu/Documents/Sfdx/AIAgentBuilder/force-app/main/default/uiBundles/AgentBuilderApp';
const { chromium } = require(path.join(APP, 'node_modules/playwright-core'));
const OUT = require('os').tmpdir();

(async () => {
  const { execSync } = require('child_process');
  const minted = JSON.parse(execSync('sf org open --url-only --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: 'powershell.exe', cwd: 'C:/Users/Annu/Documents/Sfdx/AIAgentBuilder' }));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
  const base = app.url().replace(/[?#].*$/, '').replace(/\/$/, '');
  await app.evaluate(r => { window.history.pushState({}, '', r); window.dispatchEvent(new PopStateEvent('popstate')); }, `${new URL(base).pathname}/executions`);
  await app.getByText('Run record').first().waitFor({ timeout: 60_000 }).catch(() => null);
  await app.waitForTimeout(4000);
  // Walk the list until a run shows an output payload.
  const buttons = app.locator('button').filter({ hasText: /EXEC-\d+/ });
  const n = await buttons.count();
  let found = false;
  for (let i = 0; i < n && !found; i++) {
    await buttons.nth(i).click();
    await app.waitForTimeout(2500);
    found = (await app.getByText('Output payload').count()) > 0;
  }
  const payload = app.getByText('Output payload').first();
  if (found) await payload.scrollIntoViewIfNeeded();
  await app.waitForTimeout(600);
  const overflow = await app.evaluate(() => {
    const wide = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === 'visible') {
        const r = el.getBoundingClientRect();
        if (r.width > 200) wide.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')} ${el.scrollWidth}>${el.clientWidth}`);
      }
    }
    return { docWider: document.documentElement.scrollWidth > document.documentElement.clientWidth, wide: wide.slice(0, 6) };
  });
  await app.screenshot({ path: path.join(OUT, 'shot-runs.png') });
  console.log('payload shown:', found, '| page scrolls sideways:', overflow.docWider, '| overflowing:', overflow.wide);
  console.log('saved:', path.join(OUT, 'shot-runs.png'));
  await browser.close();
})().catch(e => { console.log('failed:', e.message); process.exit(1); });
