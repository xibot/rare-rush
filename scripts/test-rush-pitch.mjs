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
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  for (const [width, height] of [[1440, 1000], [768, 1024], [390, 844], [360, 640]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'no-preference' });
    const errors = [], external = [], failures = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) errors.push(message.text()); });
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
    const preview = page.locator('.pitch-gameplay-video');
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
    assert.equal(await preview.getAttribute('preload'), 'none', 'Clip waits for the visitor to play');
    assert.equal(await preview.getAttribute('autoplay'), null, 'Recorded clip never autoplays');
    assert.equal(await preview.getAttribute('controls'), '', 'Native playback controls are available');
    assert.equal(await preview.getAttribute('playsinline'), '', 'Mobile playback stays inline');
    assert.match(await page.locator('#pitch-video-caption').innerText(), /Recorded Testnet demo gameplay · normal speed/);
    assert.equal(await page.locator('.pitch-playable-grid article').count(), 2);
    assert.match(await page.locator('.pitch-playable-grid article').first().innerText(), /mainnet.*simulated/s);
    assert.match(await page.locator('.pitch-playable-grid article').last().innerText(), /chain 46630.*no real value/s);
    assert.equal(await page.locator('.pitch-playable-grid a').last().getAttribute('href'), 'https://testnet.rarerush.app');
    assert.match(await page.locator('.pitch-future-heading').innerText(), /LIVE ON ROBINHOOD TESTNET/);
    assert.match(await page.locator('.pitch-world-intro').innerText(), /already playable/);
    assert.match(await page.locator('.pitch-economy-now').innerText(), /ARCADE \/ SESSION SIMULATION/);
    assert.match(await page.locator('.pitch-economy').innerText(), /three starts per NFT per UTC day/);
    assert.match(await page.locator('.pitch-next-grid').innerText(), /Automatic prize distribution.*still to come/s);
    await preview.scrollIntoViewIfNeeded();
    await preview.focus();
    assert.equal(await preview.evaluate(el => el === document.activeElement), true, 'Video controls can receive keyboard focus');
    await preview.evaluate(el => { void el.play(); });
    await page.waitForFunction(() => document.querySelector('.pitch-gameplay-video').currentTime > .2, null, { timeout: 10_000 }).catch(async error => {
      console.error('Video playback state', await preview.evaluate(el => ({ readyState: el.readyState, networkState: el.networkState, error: el.error?.message, paused: el.paused, source: el.currentSrc, duration: el.duration, visible: el.getBoundingClientRect().top })), { failures, external, errors });
      throw error;
    });
    const metadata = await preview.evaluate(el => ({ width: el.videoWidth, height: el.videoHeight, duration: el.duration, paused: el.paused }));
    assert(metadata.width > 0 && metadata.height > 0 && metadata.duration > 0, 'Actual gameplay clip decodes with valid metadata');
    assert.equal(metadata.paused, false);
    await preview.evaluate(el => el.pause());
    await preview.evaluate(el => { el.currentTime = el.duration / 2; });
    await page.waitForFunction(() => !document.querySelector('.pitch-gameplay-video').seeking);
    assert(Math.abs(await preview.evaluate(el => el.currentTime - el.duration / 2)) < .2, 'Clip can seek through the directional highlights');
    const time = await preview.evaluate(el => el.currentTime);
    await page.waitForTimeout(300);
    assert.equal(await preview.evaluate(el => el.currentTime), time, 'Clip respects manual pause');
    await preview.evaluate(el => { void el.play(); });
    await page.locator('footer').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('.pitch-gameplay-video').paused);
    const offscreen = await preview.evaluate(el => el.currentTime);
    await page.waitForTimeout(300);
    assert.equal(await preview.evaluate(el => el.currentTime), offscreen, 'Offscreen clip stops playing');
    await page.screenshot({ path: `artifacts/pitch-${width}-full.png`, fullPage: true });
    await page.locator('main a[href="/arcade/"]').last().click();
    await page.waitForURL(`${origin}/arcade/`);
    assert.equal(await page.locator('.collection-cards a[href="/genesis/"]').count(), 1);
    await page.locator('.collection-cards a[href="/play/"]').click();
    await page.waitForURL(`${origin}/play/`);
    await page.getByRole('button', { name: 'Check for wallet', exact: true }).waitFor();
    assert.equal(await page.locator('iframe').count(), 0, 'Pitch CTA preserves the real SDK ownership gate');
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(failures, []);
    await page.close();
    console.log(`${width}px: pitch navigation, current build status, fonts, layout, real video playback, pause, offscreen suspension and gated play passed`);
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await page.goto(`${origin}/pitch/`);
  const preview = page.locator('.pitch-gameplay-video');
  await preview.scrollIntoViewIfNeeded();
  assert.equal(await preview.evaluate(el => el.paused), true, 'Reduced-motion visitors start with a still poster');
  assert.equal(await preview.getAttribute('autoplay'), null);
  await page.waitForTimeout(300);
  assert.equal(await preview.evaluate(el => el.currentTime), 0);
  await preview.evaluate(el => { void el.play(); });
  await page.waitForFunction(() => document.querySelector('.pitch-gameplay-video').currentTime > .1);
  const redirect = await page.request.get(`${origin}/pitch`, { maxRedirects: 0 });
  assert.equal(redirect.status(), 308); assert.equal(redirect.headers().location, '/pitch/');
  for (const route of ['/pitch/', '/pitch/index.html', '/pitch/index.js', '/pitch/index.css', '/media/rare-rush-directions.mp4', '/media/rare-rush-directions.jpg']) assert.equal((await page.request.get(origin + route)).status(), 200);
  for (const route of ['/pitch/index.tsx', '/pitch/pitch.css', '/.env.local', '/package.json']) assert.equal((await page.request.get(origin + route)).status(), 404);
  await page.close();
  console.log('Pitch reduced-motion opt-in, routes, redirect and public-file boundaries passed');
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await built?.close();
  await rm(outdir, { recursive: true, force: true });
}
