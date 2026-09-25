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
  browser = await chromium.launch({ headless: true, ...(process.env.RUSH_BROWSER_CHANNEL ? { channel: process.env.RUSH_BROWSER_CHANNEL } : {}) });
  for (const [width, height] of [[1440, 1000], [390, 844], [360, 640]]) {
    const label = width > 600 ? 'desktop' : width === 390 ? 'phone' : 'small-phone';
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'no-preference' });
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    const clock = new Date('2026-09-23T00:00:00Z');
    await page.clock.install({ time: clock });
    await page.clock.pauseAt(clock);
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
    await page.clock.runFor(1800);
    assert(Number(await preview.getAttribute('data-preview-distance')) > 0, 'Watch-only preview runs without a wallet');
    assert(Number(await preview.getAttribute('data-preview-coins')) > 0, 'Autoplay collects real course coins');
    assert(Number(await preview.getAttribute('data-preview-growth')) > 1, 'Autoplay shows Friend growth');
    assert.deepEqual(external, [], 'Cached artwork needs no RPC or third-party requests');
    assert.equal(await page.locator('iframe').count(), 0, 'Landing does not mount a fake game session');
    // Use virtual RAF time: verify the real course without wall-clock races.
    const read = () => preview.evaluate(element => {
      const scene = element.querySelector('[data-scene="connected-track"]');
      const character = element.querySelector('[data-character="friend"]');
      return { phase: element.dataset.previewPhase, time: Number(element.dataset.previewTime),
        section: Number(element.dataset.previewSection), friend: element.dataset.previewFriend,
        transition: scene?.getAttribute('data-transition'), heading: Number(scene?.getAttribute('data-heading')),
        spin: Number(character?.getAttribute('data-spin')),
        projectedHeadings: [...element.querySelectorAll('[data-projected-heading]')].map(node => Number(node.getAttribute('data-projected-heading'))) };
    });
    async function advanceUntil(predicate, message, limit = 34000, step = 100) {
      for (let elapsed = 0; elapsed <= limit; elapsed += step) {
        const state = await read();
        assert.notEqual(state.heading, -1, 'The backwards surprise stays out of the landing preview');
        assert(!state.projectedHeadings.includes(-1), 'Connected track chunks never face backwards');
        if (await predicate(state)) return state;
        await page.clock.runFor(step);
      }
      assert.fail(`${message}: ${JSON.stringify(await read())}`);
    }
    const visibleBonus = () => preview.evaluate(element => {
      if (element.dataset.previewPhase !== 'side') return null;
      const width = element.querySelector('.preview-world').viewBox.baseVal.width;
      const coin = [...element.querySelectorAll('[data-bonus-coin]')].find(node => {
        const x = Number(node.dataset.bonusX);
        return x > 320 && x < Math.min(600, width - 90);
      });
      return coin?.getAttribute('data-bonus-coin') ?? null;
    });
    await advanceUntil(async () => (await visibleBonus()) !== null, 'A flying bonus appears during classic running', 9000);
    const bonusId = await visibleBonus();
    const bonus = preview.locator(`[data-bonus-coin="${bonusId}"]`).first();
    assert.equal(await bonus.locator('[data-token-design]').getAttribute('width'), '60', 'Surprise artwork is twice a normal 30px coin');
    assert.equal(await bonus.locator('text').textContent(), '10×');
    const beforeFlight = Number(await bonus.getAttribute('data-bonus-x'));
    await page.clock.runFor(150);
    assert.equal((await read()).phase, 'side');
    assert(Number(await bonus.getAttribute('data-bonus-x')) < beforeFlight, 'Classic running shows airborne coins flying left');
    await preview.screenshot({ path: `artifacts/landing-${label}-bonus.png`, animations: 'allow' });
    await page.getByRole('button', { name: 'Pause preview' }).click();
    const pausedDistance = await preview.getAttribute('data-preview-distance');
    const pausedBonuses = await preview.locator('[data-bonus-coin]').evaluateAll(coins => coins.map(coin => coin.getAttribute('transform')));
    await page.clock.runFor(600);
    assert.equal(await preview.getAttribute('data-preview-distance'), pausedDistance, 'Pause stops the preview');
    assert.deepEqual(await preview.locator('[data-bonus-coin]').evaluateAll(coins => coins.map(coin => coin.getAttribute('transform'))), pausedBonuses, 'Pause also freezes bonus flight and bobbing');
    const friend = await preview.getAttribute('data-preview-friend');
    await page.getByRole('button', { name: /NEW FRIEND/ }).click();
    assert.notEqual(await preview.getAttribute('data-preview-friend'), friend, 'New Friend chooses a different canonical Friend');
    assert.equal(await preview.getAttribute('data-preview-paused'), 'true', 'Changing Friend preserves manual pause');
    assert.equal(await preview.getAttribute('data-preview-growth'), '1.000');
    await page.getByRole('button', { name: 'Resume preview' }).click();
    await page.clock.runFor(1200);
    assert.equal((await read()).phase, 'side', 'Every new Friend starts with classic running');
    await preview.screenshot({ path: `artifacts/landing-${label}-side.png`, animations: 'allow' });
    const beforeLoop = await preview.getAttribute('data-preview-friend');
    const phases = ['side'];
    for (const direction of ['up', 'down']) {
      const entering = await advanceUntil(state => state.phase === direction, `Preview reaches ${direction}`);
      phases.push(entering.phase);
      assert.equal(entering.transition, `side-${direction}`, 'Suction connects directly from the side track');
      assert.equal(await preview.locator('[data-chunk="incoming"]').evaluate(element => getComputedStyle(element).opacity), '1');
      assert.equal(await preview.locator('[data-chunk="outgoing"]').evaluate(element => getComputedStyle(element).opacity), '1');
      let previous = entering;
      let witnessedHandoff = false;
      for (let elapsed = 0; elapsed < 1600; elapsed += 100) {
        await page.clock.runFor(100);
        const current = await read();
        assert.equal(current.phase, direction);
        const elapsedTime = current.time - previous.time;
        assert(elapsedTime > 0, 'Shaft animation clock keeps advancing');
        const velocity = (current.spin - previous.spin) / elapsedTime;
        assert(Math.abs(velocity - (direction === 'up' ? -180 : 180)) < 3,
          'The first suction turn continues into the shaft without an idle or reset');
        if (previous.transition !== 'none' && current.transition === 'none') witnessedHandoff = true;
        previous = current;
      }
      assert(witnessedHandoff, 'Spin is checked through the actual transition-to-shaft handoff');
      await preview.screenshot({ path: `artifacts/landing-${label}-${direction}.png`, animations: 'allow' });
      const exit = await advanceUntil(state => state.phase === 'side', `Preview exits ${direction} into classic running`);
      phases.push(exit.phase);
      assert.equal(exit.transition, `${direction}-side`);
      assert.equal(exit.heading, 1, 'The landing always exits a shaft running right');
      await advanceUntil(state => state.phase === 'side' && state.transition === 'none', 'Connected exit finishes');
    }
    assert.deepEqual(phases, ['side', 'up', 'side', 'down', 'side']);
    const finalSide = await read();
    assert(finalSide.time < 29, 'Classic running resumes before the Friend loop');
    await page.clock.runFor(1500);
    assert.equal((await read()).friend, beforeLoop, 'The Friend stays visible for a classic section after free fall');
    assert.equal((await read()).phase, 'side');
    const looped = await advanceUntil(state => state.friend !== beforeLoop, 'Friend rotates after the completed course', 6000);
    assert.equal(looped.phase, 'side');
    assert.equal(looped.section, 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `artifacts/landing-${label}.png`, fullPage: true, animations: 'allow' });
    if (width < 600) {
      await page.locator('.landing-footer').scrollIntoViewIfNeeded();
      await page.clock.runFor(150);
      const bounds = await preview.boundingBox();
      assert(bounds.y + bounds.height < 0, 'Preview is offscreen for visibility test');
      const offscreenDistance = await preview.getAttribute('data-preview-distance');
      await page.clock.runFor(600);
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
    console.log(`${label}: side → up → side → down → side, continuous spin, right-facing exits, coins/growth, Friend loop, pause, layout and real wallet gate passed`);
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
