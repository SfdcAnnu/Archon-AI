// Run (Git Bash): MSYS_NO_PATHCONV=1 node scripts/viewport-check.cjs <agentApiName>
// Opens the deployed builder, zooms and pans, drags a node, and reports
// whether the view stayed where it was (it used to snap back on every drag).
// Read-only: nothing is saved. Screenshots land in the OS temp dir.
const path = require('path');
const APP = 'C:/Users/Annu/Documents/Sfdx/AIAgentBuilder/force-app/main/default/uiBundles/AgentBuilderApp';
const { chromium } = require(path.join(APP, 'node_modules/playwright-core'));
const OUT = require('os').tmpdir();
const apiName = process.argv[2];
if (!apiName) { console.log('usage: node scripts/viewport-check.cjs <agentApiName>'); process.exit(2); }

const viewportOf = app => app.evaluate(() => {
  const el = document.querySelector('.react-flow__viewport');
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(el?.style.transform ?? '');
  return m ? { x: +m[1], y: +m[2], zoom: +m[3] } : null;
});

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
  await app.evaluate(r => { window.history.pushState({}, '', r); window.dispatchEvent(new PopStateEvent('popstate')); }, `${new URL(base).pathname}/agent/${apiName}`);
  await app.locator('.react-flow__node').first().waitFor({ timeout: 60_000 });
  await app.waitForTimeout(6000);
  const fitted = await viewportOf(app);

  // Zoom in twice and pan: the view we expect to keep.
  const pane = app.locator('.react-flow__pane').first();
  const box = await pane.boundingBox();
  await app.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await app.mouse.wheel(0, -400);
  await app.waitForTimeout(600);
  await app.mouse.down(); await app.mouse.move(box.x + box.width / 2 - 180, box.y + box.height / 2 - 90, { steps: 8 }); await app.mouse.up();
  await app.waitForTimeout(800);
  const changed = await viewportOf(app);
  await app.screenshot({ path: path.join(OUT, 'viewport-1-zoomed.png') });

  // Drag a node: before the fix this re-fitted the whole canvas.
  const node = app.locator('.react-flow__node').last();
  const nb = await node.boundingBox();
  await app.mouse.move(nb.x + nb.width / 2, nb.y + 12);
  await app.mouse.down(); await app.mouse.move(nb.x + nb.width / 2 + 140, nb.y + 60, { steps: 10 }); await app.mouse.up();
  await app.waitForTimeout(1500);
  const afterDrag = await viewportOf(app);
  await app.screenshot({ path: path.join(OUT, 'viewport-2-after-drag.png') });

  const same = changed && afterDrag && Math.abs(changed.zoom - afterDrag.zoom) < 1e-6 && Math.abs(changed.x - afterDrag.x) < 1 && Math.abs(changed.y - afterDrag.y) < 1;
  console.log('fitted on open:', JSON.stringify(fitted));
  console.log('after zoom+pan:', JSON.stringify(changed));
  console.log('after dragging a node:', JSON.stringify(afterDrag));
  console.log(same ? 'VIEW KEPT after drag' : 'VIEW CHANGED after drag');
  await browser.close();
})().catch(e => { console.log('failed:', e.message); process.exit(1); });
