import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildRushSite, createRushSiteServer } from './rush-site.mjs';

const outdir = await mkdtemp(path.join(tmpdir(), 'rare-rush-docs-'));
await mkdir('artifacts', { recursive: true });
let built, server, browser;
try {
  built = await buildRushSite({ outdir });
  server = createRushSiteServer(outdir);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  for (const [width, height] of [[1440, 1000], [390, 844], [360, 640]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [], external = [], failed = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) failed.push(response.url()); });
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    await page.goto(origin);
    const docsLink = page.getByRole('link', { name: 'DOCS', exact: true });
    assert(await docsLink.isVisible(), 'Docs navigation stays visible on phones');
    assert.equal(await page.locator('body').evaluate(body => body.scrollWidth > window.innerWidth), false, 'Landing header still fits');
    await docsLink.click();
    await page.waitForURL(`${origin}/docs/`);
    await page.getByRole('heading', { level: 1 }).waitFor();
    const typography = await page.evaluate(async () => {
      await document.fonts.ready;
      return { heading: getComputedStyle(document.querySelector('h1')).fontFamily, loaded: [...document.fonts].some(font => font.family === 'Silkscreen' && font.status === 'loaded') };
    });
    assert.match(typography.heading, /Silkscreen/);
    assert(typography.loaded);
    assert.equal(await page.locator('body').evaluate(body => body.scrollWidth > window.innerWidth), false, 'Guide fits viewport');
    assert.equal(await page.locator('.docs-logo small').innerText(), 'BY XIBOT');
    assert.equal(await page.locator('.docs-nav a').count(), 6);
    await page.screenshot({ path: `artifacts/docs-${width}-hero.png` });

    const collect = page.getByRole('button', { name: 'COLLECT 5 COINS +' });
    const hit = page.getByRole('button', { name: 'TAKE A HIT −' });
    await collect.click();
    assert.equal(await page.locator('[data-growth]').getAttribute('data-growth'), '1.175');
    for (let i = 0; i < 5; i++) await collect.click();
    assert.equal(await page.locator('[data-growth]').getAttribute('data-growth'), '1.750', 'Growth respects game cap');
    await hit.click();
    assert.equal(await page.locator('[data-growth]').getAttribute('data-growth'), '1.400', 'Damage shrinks by the game amount');
    for (let i = 0; i < 4; i++) await hit.click();
    assert.equal(await page.locator('[data-growth]').getAttribute('data-growth'), '1.000', 'Damage never shrinks below starting size');
    await page.locator('.growth-lab').screenshot({ path: `artifacts/docs-${width}-growth.png` });

    const mode = page.locator('#reward-mode');
    assert.equal(await page.locator('[data-reward="ordinary"]').innerText(), '10');
    assert.equal(await page.locator('[data-reward="bonus"]').innerText(), '100');
    await page.getByRole('button', { name: /Easy/ }).click();
    assert.equal(await mode.inputValue(), 'easy');
    assert.equal(await page.locator('[data-reward="ordinary"]').innerText(), '7.5');
    await mode.selectOption('degen');
    assert.equal(await page.getByRole('button', { name: /Degen/ }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-reward="bonus"]').innerText(), '200');
    const activity = page.getByRole('slider');
    await activity.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await activity.getAttribute('aria-valuetext'), '10,000 example pickups');
    assert.equal(await page.locator('[data-reward="ordinary"]').innerText(), '10');
    assert.equal(await page.locator('[data-reward="bonus"]').innerText(), '100');
    await activity.press('End');
    assert.equal(await page.locator('[data-reward="ordinary"]').innerText(), '1.25');
    assert.equal(await page.locator('[data-reward="bonus"]').innerText(), '12.5');
    await page.locator('#reward-holder').selectOption('genesis');
    assert.equal(await page.locator('[data-reward="ordinary"]').innerText(), '125');
    assert.equal(await page.locator('[data-reward="bonus"]').innerText(), '1,250');
    assert.match(await page.locator('.holder-preview').innerText(), /free entry and 100× tokens per coin in the Genesis arcade/);
    await mode.selectOption('normal');
    await activity.focus();
    await activity.press('Home');
    assert.equal(await page.locator('[data-reward="ordinary"]').innerText(), '1,000');
    assert.equal(await page.locator('[data-reward="bonus"]').innerText(), '10,000');
    await page.locator('#reward-holder').selectOption('generations');
    assert.equal(await page.locator('[data-reward="ordinary"]').innerText(), '10');
    await page.locator('.reward-lab').screenshot({ path: `artifacts/docs-${width}-rewards.png` });
    await page.getByRole('link', { name: /05.*The next level/ }).click();
    await page.locator('#next').screenshot({ path: `artifacts/docs-${width}-planned.png` });
    await page.getByText('Am I earning real tokens right now?', { exact: true }).click();
    assert(await page.locator('details[open]').innerText().then(text => text.includes('simulated')));
    assert.equal(await page.locator('body').evaluate(body => body.scrollWidth > window.innerWidth), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, [], 'Guide runs without wallet, RPC or external assets');
    assert.deepEqual(failed, [], 'All bundled guide resources load');
    await page.screenshot({ path: `artifacts/docs-${width}-full.png`, fullPage: true });
    await page.getByRole('link', { name: 'LET’S RUSH ↗' }).click();
    await page.waitForURL(`${origin}/arcade/`);
    assert.equal(await page.locator('.collection-cards a[href="/genesis/"]').count(), 1, 'Guide offers the Genesis tester route');
    await page.locator('.collection-cards a[href="/play/"]').click();
    await page.waitForURL(`${origin}/play/`);
    await page.locator('.rf-runtime-status').waitFor();
    assert.equal(await page.locator('iframe').count(), 0, 'Guide CTA reaches real ownership gate');
    await page.close();
    console.log(`${width}px: navigation, fonts, layout, growth, reward curve, shared difficulty, FAQ, collection choice and SDK entry passed`);
  }
  const page = await browser.newPage();
  const redirect = await page.request.get(`${origin}/docs`, { maxRedirects: 0 });
  assert.equal(redirect.status(), 308);
  assert.equal(redirect.headers().location, '/docs/');
  for (const route of ['/docs/', '/docs/index.html', '/docs/index.css', '/docs/index.js']) assert.equal((await page.request.get(origin + route)).status(), 200);
  for (const route of ['/package.json', '/.env.local', '/docs/docs.css', '/docs/../../package.json']) assert.equal((await page.request.get(origin + route)).status(), 404);
  await page.close();
  console.log('Docs routes, redirect and static-file allowlist passed');
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await built?.close();
  await rm(outdir, { recursive: true, force: true });
}
