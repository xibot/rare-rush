import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildRushSite, createRushSiteServer } from './rush-site.mjs';

const outdir = await mkdtemp(path.join(tmpdir(), 'rare-rush-landing-'));
await mkdir('artifacts', { recursive: true });
let built, server, browser;
try {
  built = await buildRushSite({ outdir });
  server = createRushSiteServer(outdir);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  for (const [width, height] of [[1440, 1000], [390, 844], [360, 640]]) {
    const label = width > 600 ? 'desktop' : width === 390 ? 'phone' : 'small-phone';
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'no-preference' });
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    await page.goto(origin);
    const preview = page.locator('.preview-run');
    await preview.waitFor();
    const typography = await page.evaluate(async () => {
      await document.fonts.ready;
      return { heading: getComputedStyle(document.querySelector('h1')).fontFamily, body: getComputedStyle(document.querySelector('.hero-copy > p')).fontFamily,
        pixelLoaded: [...document.fonts].some(font => font.family === 'Silkscreen' && font.weight === '400' && font.status === 'loaded') };
    });
    assert.match(typography.heading, /Silkscreen/);
    assert.match(typography.body, /Sometype Mono/);
    assert(typography.pixelLoaded, 'The real pixel font must load locally');
    assert.equal(await page.locator('.landing-logo small').innerText(), 'BY XIBOT');
    assert.equal(await page.locator('.landing-logo [data-canonical-face="08"]').count(), 1);
    assert.equal(await page.locator('body').evaluate(body => body.scrollWidth > window.innerWidth), false, 'Landing fits the viewport');
    await preview.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1800);
    assert(Number(await preview.getAttribute('data-preview-distance')) > 0, 'Watch-only preview runs without a wallet');
    assert(Number(await preview.getAttribute('data-preview-coins')) > 0, 'Autoplay collects real course coins');
    assert(Number(await preview.getAttribute('data-preview-growth')) > 1, 'Autoplay shows Friend growth');
    assert.deepEqual(external, [], 'Cached artwork needs no RPC or third-party requests');
    assert.equal(await page.locator('iframe').count(), 0, 'Landing does not mount a fake game session');
    await page.waitForFunction(() => {
      const camera = document.querySelector('.preview-world').viewBox.baseVal.width;
      return [...document.querySelectorAll('.preview-world [data-bonus-coin]')].some(coin => {
        const x = Number(coin.dataset.bonusX);
        return x > 320 && x < Math.min(600, camera - 90);
      });
    }, null, { timeout: 12000 });
    const bonus = preview.locator('[data-bonus-coin]').first();
    assert.equal(await bonus.locator('[data-token-design]').getAttribute('width'), '60', 'Surprise artwork is twice a normal 30px coin');
    assert.equal(await bonus.locator('text').textContent(), '10×');
    const beforeFlight = Number(await bonus.getAttribute('data-bonus-x'));
    await page.waitForTimeout(150);
    assert(Number(await bonus.getAttribute('data-bonus-x')) < beforeFlight, 'Preview shows airborne coins flying left');
    await preview.screenshot({ path: `artifacts/landing-${label}-bonus.png` });
    await page.getByRole('button', { name: 'Pause preview' }).click();
    const pausedDistance = await preview.getAttribute('data-preview-distance');
    const pausedBonuses = await preview.locator('[data-bonus-coin]').evaluateAll(coins => coins.map(coin => coin.getAttribute('transform')));
    await page.waitForTimeout(600);
    assert.equal(await preview.getAttribute('data-preview-distance'), pausedDistance, 'Pause stops the preview');
    assert.deepEqual(await preview.locator('[data-bonus-coin]').evaluateAll(coins => coins.map(coin => coin.getAttribute('transform'))), pausedBonuses, 'Pause also freezes bonus flight and bobbing');
    const friend = await preview.getAttribute('data-preview-friend');
    await page.getByRole('button', { name: /NEW FRIEND/ }).click();
    assert.notEqual(await preview.getAttribute('data-preview-friend'), friend, 'New Friend chooses a different canonical Friend');
    assert.equal(await preview.getAttribute('data-preview-paused'), 'true', 'Changing Friend preserves manual pause');
    assert.equal(await preview.getAttribute('data-preview-growth'), '1.000');
    await page.getByRole('button', { name: 'Resume preview' }).click();
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `artifacts/landing-${label}.png`, fullPage: true });
    if (width > 600) {
      const beforeLoop = await preview.getAttribute('data-preview-friend');
      await page.waitForFunction(id => document.querySelector('.preview-run')?.getAttribute('data-preview-friend') !== id, beforeLoop, { timeout: 30000 });
    } else {
      await page.locator('.landing-footer').scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      assert((await preview.boundingBox()).y + (await preview.boundingBox()).height < 0, 'Preview is offscreen for visibility test');
      const offscreenDistance = await preview.getAttribute('data-preview-distance');
      await page.waitForTimeout(600);
      assert.equal(await preview.getAttribute('data-preview-distance'), offscreenDistance, 'Offscreen autoplay is suspended');
    }
    await page.getByRole('link', { name: /PLAY WITH YOUR FRIEND/ }).click();
    await page.waitForURL(`${origin}/arcade/`);
    assert.equal(await page.locator('.collection-cards a[href="/genesis/"]').count(), 1, 'Collection choice offers Genesis');
    assert.equal(await page.locator('.collection-cards a[href="/play/"]').count(), 1, 'Collection choice preserves Generations SDK entry');
    await page.locator('.collection-cards a[href="/play/"]').click();
    await page.waitForURL(`${origin}/play/`);
    await page.getByRole('button', { name: 'Check for wallet', exact: true }).waitFor();
    assert.match(await page.locator('.rf-runtime-connection').innerText(), /wallet/i, 'Play CTA reaches the real SDK wallet gate');
    assert.equal(await page.locator('iframe').count(), 0, 'No game is admitted without wallet eligibility');
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    await page.close();
    console.log(`${label}: autoplay, coins/growth, rotation, pause, layout, collection choice and SDK entry passed`);
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await page.goto(origin);
  const preview = page.locator('.preview-run');
  await preview.scrollIntoViewIfNeeded();
  assert.equal(await preview.getAttribute('data-preview-paused'), 'true');
  await page.waitForTimeout(700);
  assert.equal(await preview.getAttribute('data-preview-distance'), '0', 'Reduced-motion preference starts with a still preview');
  assert(await page.locator('[data-character="preview-friend"] path').count() > 0, 'Still preview shows canonical artwork');
  await page.getByRole('button', { name: 'Resume preview' }).click();
  await page.waitForTimeout(700);
  assert(Number(await preview.getAttribute('data-preview-distance')) > 0, 'Reduced-motion users can explicitly start the preview');
  assert.equal((await page.request.get(`${origin}/package.json`)).status(), 404);
  assert.equal((await page.request.get(`${origin}/play/../../package.json`)).status(), 404);
  assert.equal((await page.request.get(`${origin}/play/game.html`)).status(), 200);
  assert.match(await (await page.request.get(`${origin}/font-licenses.txt`)).text(), /SIL OPEN FONT LICENSE/);
  assert.match(await (await page.request.get(`${origin}/play/game.html`)).text(), /Content-Security-Policy/);
  await page.close();
  console.log('Reduced motion, explicit resume, static server boundaries and SDK sandbox CSP passed');
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await built?.close();
  await rm(outdir, { recursive: true, force: true });
}
