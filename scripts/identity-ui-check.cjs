// Run: node scripts/identity-ui-check.cjs (Chrome installed; the sf CLI default org).
// Logs in through the CLI's one-time link, opens the deployed app from its App
// Launcher tile, and screenshots the identity screens: the Connectors
// directory with its principal chips, a connector's Connections / Server
// tabs, the Users roster, Settings → Identity & access, and My connections.
// Screenshots land in the OS temp dir as identity-*.png.
const fs = require('fs');
const path = require('path');
const APP = 'C:/Users/Annu/Documents/Sfdx/AIAgentBuilder/force-app/main/default/uiBundles/AgentBuilderApp';
const { chromium } = require(path.join(APP, 'node_modules/playwright-core'));
const OUT = require('os').tmpdir();
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `identity-${name}.png`) });

async function tour(app, base, errors) {
  const pause = ms => app.waitForTimeout(ms);

  // 1 · the directory and its chips
  await app.goto(`${base}/connectors`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await app.getByText('Directory', { exact: true }).first().waitFor({ timeout: 60_000 });
  // The Archon server sleeps when idle: the directory retries while it wakes.
  await app.getByRole('button', { name: /^(Manage|Authorise)$/ }).first().waitFor({ timeout: 150_000 });
  await pause(6000);
  await shot(app, '1-directory');
  console.log('org-connected chips:', await app.getByText('Org connected', { exact: true }).count(), '| manage buttons:', await app.getByRole('button', { name: 'Manage' }).count());

  // 2 · Gmail's own page
  const gmail = app.locator('div').filter({ has: app.getByRole('button', { name: 'Gmail', exact: true }) }).last();
  const manage = gmail.getByRole('button', { name: 'Manage' }).first();
  if (await manage.count()) await manage.click(); else await app.getByRole('button', { name: 'Gmail', exact: true }).first().click();
  await app.getByText('Org connection', { exact: true }).first().waitFor({ timeout: 60_000 });
  await pause(8000);
  await shot(app, '2-gmail-connections');
  console.log('detail sections:', {
    org: await app.getByText('Org connection', { exact: true }).count(),
    groups: await app.getByText('Group connections', { exact: true }).count(),
    people: await app.getByText(/People who connect/).count(),
    addGroup: await app.getByRole('button', { name: /Add group/ }).count(),
  });

  // 2b · add-user dialog finds people by name or email
  await app.getByRole('button', { name: /Add user connection/ }).first().click();
  await pause(5000);
  await app.locator('[role="dialog"] input[placeholder="Name or email"]').fill('an');
  await pause(4000);
  await shot(app, '2b-add-user');
  console.log('people in add-user dialog:', await app.locator('[role="dialog"] input[type="checkbox"]').count());
  await app.keyboard.press('Escape');
  await pause(500);

  // 3 · add-group dialog lists the org's permission sets
  await app.getByRole('button', { name: /Add group/ }).first().click();
  await pause(6000);
  await shot(app, '3-add-group');
  console.log('group rows in dialog:', await app.locator('[role="dialog"] button').filter({ hasText: /member/ }).count());
  await app.keyboard.press('Escape');
  await pause(500);

  // 4 · the server tab and its dialog
  await app.getByRole('button', { name: 'Server' }).first().click();
  await pause(800);
  await shot(app, '4-gmail-server');
  await app.getByRole('button', { name: 'Change server' }).first().click();
  await pause(800);
  await shot(app, '5-change-server');
  await app.keyboard.press('Escape');
  await pause(500);

  // 5 · the Users tab
  await app.getByText('Directory', { exact: true }).first().click();
  await pause(1500);
  await app.getByRole('button', { name: 'Users', exact: true }).first().click();
  await pause(8000);
  await shot(app, '6-users');

  // 6 · Settings → Identity & access
  await app.goto(`${base}/settings`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await app.getByText('Identity & access').first().waitFor({ timeout: 60_000 });
  await pause(7000);
  await shot(app, '7-settings');
  console.log('settings selects:', await app.locator('[role="combobox"]').count());

  // 7 · My connections
  await app.goto(`${base}/my-connections`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await app.getByText('My connections').first().waitFor({ timeout: 60_000 });
  await pause(7000);
  await shot(app, '8-my-connections');

  // 8 · the Chat picker: an agent that acts as the person carries a chip
  await app.goto(`${base}/chat`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await pause(6000);
  await shot(app, '9-chat-picker');
  console.log('"as you" chips on the picker:', await app.getByText('as you', { exact: true }).count());
  console.log('console errors:', errors.slice(0, 10));
}

(async () => {
  const { execSync } = require('child_process');
  const minted = JSON.parse(execSync('sf org open --url-only --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: 'powershell.exe', cwd: 'C:/Users/Annu/Documents/Sfdx/AIAgentBuilder' }));
  const frontdoor = minted.result.url;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => errors.push(`pageerror ${String(e).slice(0, 200)}`));

  await page.goto(`${frontdoor}&retURL=${encodeURIComponent('/lightning/page/home')}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000 && !/lightning\.force\.com|\/lwr\//.test(page.url())) await page.waitForTimeout(1000);
  console.log('after login url:', page.url().slice(0, 120));
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
  if (await row.count()) await row.click({ force: true }).catch(e => console.log('row click failed', e.message));
  else await page.getByText('Archon Agent Builder', { exact: true }).last().click({ force: true }).catch(e => console.log('tile click failed', e.message));
  const popup = await popupPromise;
  if (popup) await popup.waitForLoadState('domcontentloaded').catch(() => null);
  const app = popup && /\/app\/|\/lwr\//.test(popup.url()) ? popup : page;
  const t1 = Date.now();
  while (Date.now() - t1 < 60_000 && !(await app.locator('#root').count())) await app.waitForTimeout(1000);
  app.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  const base = app.url().replace(/[?#].*$/, '').replace(/\/(connectors|chat|home|settings)?\/?$/, '');
  console.log('app base:', base);
  await tour(app, base, errors);
  await browser.close();
})().catch(e => { console.log('failed:', e.message); process.exit(1); });
