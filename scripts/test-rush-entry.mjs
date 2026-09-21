import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildRushSite, createRushSiteServer } from './rush-site.mjs';
// Internal SDK read fixtures only. No identity fixture enters a public bundle.
import { installFixture, createArtworkFixture } from '../node_modules/@rarefriends/friendsdk/scripts/browser-fixture.mjs';

const outdir = await mkdtemp(path.join(tmpdir(), 'rare-rush-entry-'));
await mkdir('artifacts', { recursive: true });
let built, server, browser;
try {
  built = await buildRushSite({ outdir });
  server = createRushSiteServer(outdir);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const artworkCall = await createArtworkFixture();
  for (const [width, height] of [[1440, 1000], [390, 844], [360, 640]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const fixture = await installFixture(page, origin, { artworkCall });
    const back = page.getByRole('link', { name: '← CHOOSE COLLECTION', exact: true });
    const connect = page.getByRole('button', { name: /^Connect (wallet|Browser wallet)$/ });
    await page.goto(`${origin}/play/`);
    await back.waitFor(); await connect.waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal((await page.locator('h1').innerText()).toUpperCase(), 'GENERATIONS\nUNLOCKED.');
    assert.equal(await page.locator('.rush-entry-logo small').innerText(), 'BY XIBOT');
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > innerWidth), false);
    const [backBox, connectBox] = await Promise.all([back.boundingBox(), connect.boundingBox()]);
    assert(backBox.height >= 44 && connectBox.height >= 44);
    await page.screenshot({ path: `artifacts/generations-${width}-entry.png`, fullPage: true });
    await back.focus(); await page.keyboard.press('Enter');
    await page.waitForURL(`${origin}/arcade/`);
    assert.equal(await page.locator('.collection-cards a').count(), 2);
    assert.equal((await page.evaluate(() => window.__friendWalletTest.state.requests)).includes('eth_requestAccounts'), false, 'Returning to collections does not connect a wallet');
    await page.locator('a[href="/play/"]').click();
    await connect.click();
    const friend = page.getByRole('button', { name: /^Friend #7730\b/ });
    await friend.waitFor();
    await friend.locator('img.rush-friend-portrait').waitFor();
    await page.waitForFunction(() => { const image = document.querySelector('.rf-frame-friends img'); return image?.complete && image.naturalWidth > 0; });
    assert.equal(await friend.locator('img.rush-friend-portrait').count(), 1);
    assert.equal(await friend.isEnabled(), true);
    assert.equal(await page.locator('.rush-generations-chrome').count(), 1);
    await page.screenshot({ path: `artifacts/generations-${width}-friends.png`, fullPage: true });
    const beforeSelection = fixture.ownerReads;
    await friend.click();
    const game = page.frameLocator('iframe');
    await game.getByRole('button', { name: /LET’S RUSH/ }).waitFor({ timeout: 30000 });
    assert(fixture.ownerReads > beforeSelection, 'Selecting a portrait still triggers fresh SDK ownership verification');
    assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    assert.equal(await page.locator('body.rush-generations-selecting').count(), 0);
    assert.equal(await page.locator('.rush-generations-chrome').count(), 0);
    await page.getByRole('button', { name: 'Choose Friend', exact: true }).click();
    await page.locator('.rush-generations-chrome').waitFor();
    assert.equal(await page.locator('.rush-generations-chrome').count(), 1);
    await friend.locator('img.rush-friend-portrait').waitFor();
    await page.getByRole('button', { name: 'Close Choose your Friend', exact: true }).click();
    await page.getByRole('button', { name: 'Open Friend wallet', exact: true }).click();
    await page.getByRole('dialog', { name: 'Friend wallet', exact: true }).waitFor();
    assert.equal(await page.locator('.rush-generations-chrome').count(), 0, 'Picker chrome never leaks into wallet menus');
    assert.equal(await page.locator('body.rush-generations-selecting').count(), 0);
    await page.getByRole('button', { name: 'Close Friend wallet', exact: true }).click();
    await page.getByRole('button', { name: 'Choose Friend', exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await connect.waitFor();
    assert.equal(await page.locator('.rf-frame-friends img').count(), 0, 'Disconnect removes prior wallet portraits');
    assert.equal(await back.count(), 1);
    await page.evaluate(() => { const original = window.ethereum.request; window.ethereum.request = args => args.method === 'eth_requestAccounts' ? Promise.reject({ code: 4001, message: 'Connection declined for test' }) : original(args); });
    await connect.click();
    await page.getByRole('alert').filter({ hasText: /declined|rejected/i }).waitFor();
    assert.equal(await back.count(), 1, 'Connection errors retain the top collection link');
    await back.click(); await page.waitForURL(`${origin}/arcade/`);
    assert.deepEqual(errors, []); assert.deepEqual(fixture.errors, []);
    await page.close();
    console.log(`${width}px: branded entry, keyboard collection navigation, real sprite previews, verified selection, menu reuse and disconnect passed`);
  }
  const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
  await page.goto(`${origin}/play/`);
  await page.getByRole('button', { name: 'Check for wallet', exact: true }).waitFor();
  await page.getByRole('link', { name: '← CHOOSE COLLECTION', exact: true }).click();
  await page.waitForURL(`${origin}/arcade/`);
  for (const route of ['/', '/docs/', '/pitch/', '/arcade/', '/genesis/', '/play/']) {
    const response = await page.request.get(origin + route);
    assert.equal(response.status(), 200);
    assert.match(await response.text(), /<link rel="icon" type="image\/svg\+xml" sizes="any" href="\/favicon.svg">/);
  }
  const icon = await page.request.get(`${origin}/favicon.svg`);
  assert.equal(icon.status(), 200); assert.match(icon.headers()['content-type'], /image\/svg\+xml/);
  assert.match(await icon.text(), /#ccff00/);
  assert.equal((await page.request.get(`${origin}/host-navigation.js`)).status(), 200);
  assert.equal((await page.request.get(`${origin}/host-navigation.ts`)).status(), 404);
  await page.close();
  console.log('No-wallet collection navigation and shared favicon on every public entry passed');
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await built?.close();
  await rm(outdir, { recursive: true, force: true });
}
