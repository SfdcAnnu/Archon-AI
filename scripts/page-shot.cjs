// Run: node scripts/page-shot.cjs /knowledge [name]
// Logs in through the CLI's one-time link, opens the deployed app from its
// App Launcher tile, goes to the given route and screenshots it (and the
// same page scrolled to the bottom) into the OS temp dir as shot-<name>-*.png.
const path = require('path');
const APP = 'C:/Users/Annu/Documents/Sfdx/AIAgentBuilder/force-app/main/default/uiBundles/AgentBuilderApp';
const { chromium } = require(path.join(APP, 'node_modules/playwright-core'));
const OUT = require('os').tmpdir();
const route = process.argv[2] || '/';
const name = process.argv[3] || route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';

(async () => {
  const { execSync } = require('child_process');
  const minted = JSON.parse(execSync('sf org open --url-only --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: 'powershell.exe', cwd: 'C:/Users/Annu/Documents/Sfdx/AIAgentBuilder' }));
  // THEME=hud|light picks the app theme; WIDTH/HEIGHT the viewport.
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: Number(process.env.WIDTH) || 1440, height: Number(process.env.HEIGHT) || 900 } });
  if (process.env.THEME) {
    // The app opens in a popup on its own domain: the script must apply to
    // every page of the context, not just this first one.
    const theme = process.env.THEME;
    await page.context().addInitScript(t => { try { localStorage.setItem('archon:theme', t); } catch { /* fine */ } }, theme);
  }
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
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
  console.log('popup:', popup ? popup.url().slice(0, 120) : null, '| page:', page.url().slice(0, 120));
  const app = popup && /\/app\//.test(popup.url()) ? popup : page;
  const t1 = Date.now();
  while (Date.now() - t1 < 60_000 && !(await app.locator('#root').count())) await app.waitForTimeout(1000);
  app.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  const base = app.url().replace(/[?#].*$/, '').replace(/\/(connectors|chat|home|settings|knowledge)?\/?$/, '');
  console.log('app base:', base, '| app url:', app.url().slice(0, 140), '| root:', await app.locator('#root').count());
  // Navigate inside the app (client-side routing) rather than reloading
  // the route: a direct load of a deep route can bounce to Lightning.
  await app.evaluate(r => { window.history.pushState({}, '', r); window.dispatchEvent(new PopStateEvent('popstate')); }, `${new URL(base).pathname}${route}`);
  await app.waitForTimeout(1500);
  if (!app.url().endsWith(route)) await app.goto(`${base}${route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  console.log('route url:', app.url().slice(0, 160));
  await app.waitForTimeout(12_000);
  // EVAL='<js>' runs in the page before the shot, e.g. to put a screen into
  // a state that would otherwise need a live turn to reach.
  if (process.env.EVAL) { await app.evaluate(process.env.EVAL); await app.waitForTimeout(800); }
  await app.screenshot({ path: path.join(OUT, `shot-${name}-1.png`) });
  await app.evaluate(() => { for (const el of document.querySelectorAll('*')) { if (el.scrollHeight > el.clientHeight + 50) el.scrollTop = el.scrollHeight; } });
  await app.waitForTimeout(600);
  await app.screenshot({ path: path.join(OUT, `shot-${name}-2.png`) });
  console.log('saved:', path.join(OUT, `shot-${name}-1.png`), '| page errors:', errors.slice(0, 5));
  await browser.close();
})().catch(e => { console.log('failed:', e.message); process.exit(1); });
