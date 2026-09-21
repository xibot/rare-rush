import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildRushSite, createRushSiteServer } from './rush-site.mjs';

const outdir = await mkdtemp(path.join(tmpdir(), 'rare-rush-pitch-'));
await mkdir('artifacts', { recursive: true });
let built, server, browser;
try {
  built = await buildRushSite({ outdir });
  server = createRushSiteServer(outdir);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  for (const [width, height] of [[1440, 1000], [768, 1024], [390, 844], [360, 640]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'no-preference' });
    const errors = [], external = [], failures = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    for (const route of ['/', '/docs/', '/arcade/']) {
      await page.goto(origin + route);
      const pitchLink = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'PITCH', exact: true });
      await pitchLink.waitFor({ state: 'visible' });
      assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > innerWidth), false, `Navigation fits ${route} at ${width}px`);
      await page.locator('header').screenshot({ path: `artifacts/pitch-nav-${width}-${route === '/' ? 'home' : route.split('/')[1]}.png` });
      await pitchLink.click();
      await page.waitForURL(`${origin}/pitch/`);
      await page.getByRole('heading', { level: 1 }).waitFor();
    }
    const preview = page.locator('.preview-run');
    await preview.waitFor();
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return { display: getComputedStyle(document.querySelector('h1')).fontFamily, loaded: [...document.fonts].some(font => font.family === 'Silkscreen' && font.status === 'loaded') };
    });
    assert.match(fonts.display, /Silkscreen/); assert(fonts.loaded);
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > innerWidth), false, 'Pitch fits without horizontal overflow');
    assert.equal(await page.locator('header small').innerText(), 'BY XIBOT');
    assert.equal(await page.locator('iframe').count(), 0, 'Pitch has no game or wallet session');
    await page.screenshot({ path: `artifacts/pitch-${width}-hero.png` });
    await preview.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => Number(document.querySelector('.preview-run')?.getAttribute('data-preview-distance')) > 12 && Number(document.querySelector('.preview-run')?.getAttribute('data-preview-coins')) > 0);
    assert(Number(await preview.getAttribute('data-preview-coins')) > 0, 'Pitch shows actual game-loop pickups without a wallet');
    await page.getByRole('button', { name: 'Pause preview' }).click();
    const distance = await preview.getAttribute('data-preview-distance');
    await page.waitForTimeout(300);
    assert.equal(await preview.getAttribute('data-preview-distance'), distance, 'Preview can be paused');
    const friend = await preview.getAttribute('data-preview-friend');
    await page.getByRole('button', { name: /NEW FRIEND/ }).click();
    assert.notEqual(await preview.getAttribute('data-preview-friend'), friend);
    assert.equal(await preview.getAttribute('data-preview-paused'), 'true', 'Changing Friend preserves manual pause');
    await page.getByRole('button', { name: 'Resume preview' }).click();
    await page.waitForTimeout(600);
    await page.locator('footer').scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const offscreen = await preview.getAttribute('data-preview-distance');
    await page.waitForTimeout(300);
    assert.equal(await preview.getAttribute('data-preview-distance'), offscreen, 'Offscreen preview stops updating');
    await page.screenshot({ path: `artifacts/pitch-${width}-full.png`, fullPage: true });
    await page.locator('main a[href="/arcade/"]').last().click();
    await page.waitForURL(`${origin}/arcade/`);
    assert.equal(await page.locator('.collection-cards a[href="/genesis/"]').count(), 1);
    await page.locator('.collection-cards a[href="/play/"]').click();
    await page.waitForURL(`${origin}/play/`);
    await page.locator('.rf-runtime-status').waitFor();
    assert.equal(await page.locator('iframe').count(), 0, 'Pitch CTA preserves the real SDK ownership gate');
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(failures, []);
    await page.close();
    console.log(`${width}px: pitch navigation, fonts, layout, actual preview, pause, rotation, offscreen suspension and gated play passed`);
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await page.goto(`${origin}/pitch/`);
  const preview = page.locator('.preview-run');
  await preview.scrollIntoViewIfNeeded();
  assert.equal(await preview.getAttribute('data-preview-paused'), 'true');
  await page.waitForTimeout(300);
  assert.equal(await preview.getAttribute('data-preview-distance'), '0');
  await page.getByRole('button', { name: 'Resume preview' }).click();
  await page.waitForFunction(() => Number(document.querySelector('.preview-run')?.getAttribute('data-preview-distance')) > 0);
  const redirect = await page.request.get(`${origin}/pitch`, { maxRedirects: 0 });
  assert.equal(redirect.status(), 308); assert.equal(redirect.headers().location, '/pitch/');
  for (const route of ['/pitch/', '/pitch/index.html', '/pitch/index.js', '/pitch/index.css']) assert.equal((await page.request.get(origin + route)).status(), 200);
  for (const route of ['/pitch/index.tsx', '/pitch/pitch.css', '/.env.local', '/package.json']) assert.equal((await page.request.get(origin + route)).status(), 404);
  await page.close();
  console.log('Pitch reduced-motion opt-in, routes, redirect and public-file boundaries passed');
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await built?.close();
  await rm(outdir, { recursive: true, force: true });
}
