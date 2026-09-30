import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { decodeGenerationSprites, spriteFrame } from '@rarefriends/friendsdk/sprites';
import { buildRushSite, createRushSiteServer } from './rush-site.mjs';

// Exercise the public build and the real manual runner. Virtual browser time
// drives its normal requestAnimationFrame loop; there is no pilot or engine hook.
const repo = fileURLToPath(new URL('../', import.meta.url));
const outdir = await mkdtemp(path.join(tmpdir(), 'rare-rush-free-play-'));
const artifacts = path.join(repo, 'artifacts/free-play');
await mkdir(artifacts, { recursive: true });
const modes = [['easy', 120], ['normal', 90], ['degen', 60]];
const reports = [];
const cachedArt = JSON.parse(await readFile(path.join(repo, 'games/rare-rush/landing/preview-art.json'), 'utf8'));
const source = cachedArt.friends.find(friend => friend.tokenId === '42' || friend.tokenId === 42);
const chosenArt = decodeGenerationSprites(BigInt(source.tokenId), source.familyId, source.seed,
  source.frames.map(BigInt), cachedArt.provenance.manifest);
const pixelPath = rows => rows.flatMap((row, y) => [...row].flatMap((pixel, x) =>
  pixel === '#' ? [`M${x} ${y}h1v1h-1z`] : [])).join('');
const chosenFrontPixels = pixelPath(spriteFrame(chosenArt, 'down', false, 0).frame.rows);
const chosenRunningPixels = pixelPath(spriteFrame(chosenArt, 'right', false, 0).frame.rows);
let built, server, browser;

async function installOfflineGuard(page, origin) {
  const external = [], unexpectedLocal = [], errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    const state = { accesses: [], calls: [], discoveries: 0 };
    Object.defineProperty(window, '__freePlayWalletGuard', { value: state });
    const fail = method => (...args) => {
      state.calls.push({ method, request: args[0]?.method });
      throw new Error(`Free Play must not call a wallet: ${method}`);
    };
    const provider = { request: fail('request'), send: fail('send'), sendAsync: fail('sendAsync'),
      enable: fail('enable'), on: fail('on'), removeListener: fail('removeListener') };
    for (const name of ['ethereum', 'solana', 'phantom']) {
      Object.defineProperty(window, name, { configurable: true, get() { state.accesses.push(name); return provider; } });
    }
    window.addEventListener('eip6963:requestProvider', () => { state.discoveries++; });
  });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    requests.push({ method: request.method(), url: request.url(), type: request.resourceType() });
    if (['data:', 'blob:'].includes(url.protocol)) return route.continue();
    if (url.origin !== origin) {
      external.push(request.url());
      return route.abort('blockedbyclient');
    }
    if (!['GET', 'HEAD'].includes(request.method()) || /^\/(?:api|rpc)(?:\/|$)/.test(url.pathname)) {
      unexpectedLocal.push(`${request.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  await page.routeWebSocket('**/*', socket => {
    external.push(socket.url());
    socket.close();
  });
  return {
    requests,
    async verify() {
      assert.deepEqual(external, [], 'Free Play must make no external requests, including RPC or analytics');
      assert.deepEqual(unexpectedLocal, [], 'Free Play must not call a same-origin API or post data');
      assert.deepEqual(await page.evaluate(() => window.__freePlayWalletGuard),
        { accesses: [], calls: [], discoveries: 0 }, 'Free Play must never inspect, discover, or call a wallet');
      assert.deepEqual(errors, [], 'The public build must have no browser errors');
    },
  };
}

async function assertFits(page, root, state) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false,
    `${state}: page must not overflow horizontally`);
  if (await root.count()) {
    assert.equal(await root.evaluate(element => element.scrollWidth > element.clientWidth + 1), false,
      `${state}: game must not overflow horizontally`);
    const world = root.locator('.world-svg');
    const geometry = await world.evaluate(element => ({
      width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
      ratio: element.viewBox.baseVal.width / element.viewBox.baseVal.height,
    }));
    assert(Math.abs(geometry.width / geometry.height - geometry.ratio) < .03,
      `${state}: the world retains its aspect ratio at this viewport`);
  }
}

async function assertFreeUI(root) {
  assert.equal(await root.getByRole('button', { name: /^FX (ON|OFF)$/ }).count(), 0,
    'Free Play has no manual visual FX switch that can snap the scenery mid-run');
  assert.equal(await root.locator('.run-save, .economy-panel').count(), 0,
    'Free Play must not mount saving, fee, or token-economy controls');
  assert.doesNotMatch(await root.innerText(), /SAVE RUN|TOKEN LAB|\$RUSH|demo RF|prize pool|\brewards?\b|\bfees?\b/i,
    'The free runner should show its score and play controls without economy messaging');
}

async function assertTouchTarget(control) {
  const bounds = await control.boundingBox();
  assert(bounds && bounds.width >= 44 && bounds.height >= 44, 'Controls need usable 44px touch targets');
  return bounds;
}

function readScore(text) { return Number(text.replace(/[^\d]/g, '')); }

async function finishRun(page, root, seconds) {
  for (let elapsed = 0; elapsed <= (seconds + 2) * 1000; elapsed += 1000) {
    if (await root.getAttribute('data-screen') === 'result') return;
    await page.clock.runFor(1000);
  }
  assert.fail('A real unattended run must finish by its duration or loss of hearts');
}

async function pointerHold(page, control, callback) {
  await control.scrollIntoViewIfNeeded();
  const bounds = await assertTouchTarget(control);
  // CDP sends genuine touch events, including pointer capture and release.
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{
      x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2,
    }] });
    await callback();
  } finally {
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  }
}

async function assertInvitation(page) {
  const invitation = page.locator('.free-play-invitation');
  await invitation.waitFor();
  assert.equal(await invitation.getByRole('link', { name: /Play with your Rare Friend/i }).getAttribute('href'), '/arcade/#collections');
  assert.equal(await invitation.getByRole('link', { name: /TRY TESTNET/i }).getAttribute('href'), 'https://testnet.rarerush.app/play/');
}

try {
  built = await buildRushSite({ outdir });
  server = createRushSiteServer(outdir);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true,
    ...(process.env.RUSH_BROWSER_CHANNEL ? { channel: process.env.RUSH_BROWSER_CHANNEL } : {}) });

  for (const [width, height, difficulty] of [[1440, 1000, 'easy'], [640, 960, 'normal'], [390, 844, 'normal'], [360, 640, 'degen']]) {
    const mobile = width < 600;
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: mobile,
      isMobile: mobile, reducedMotion: 'no-preference', serviceWorkers: 'block' });
    const page = await context.newPage();
    const guard = await installOfflineGuard(page, origin);
    const clock = new Date('2026-09-29T00:00:00Z');
    await page.clock.install({ time: clock });
    await page.clock.pauseAt(clock);
    await page.goto(`${origin}/free-play/`);
    const samples = page.getByTestId('sample-friend');
    await samples.first().waitFor();
    assert.equal(await samples.count(), 12, 'Players can choose six Genesis and six Generations samples');
    for (const collection of ['genesis', 'generations']) {
      assert.equal(await samples.and(page.locator(`[data-collection="${collection}"]`)).count(), 6,
        `The picker offers six ${collection} Friends`);
    }
    const back = page.getByRole('link', { name: /BACK TO ARCADE/ });
    assert.equal(await back.getAttribute('href'), '/arcade/');
    const backBox = await assertTouchTarget(back);
    const kickerBox = await page.locator('.free-play-kicker').boundingBox();
    assert(backBox.y + backBox.height <= kickerBox.y + 1, 'Back to Arcade sits above You’re the Player');
    const chosenSample = samples.and(page.locator('[data-collection="generations"][data-token-id="42"]'));
    await page.evaluate(() => document.fonts.ready);
    const root = page.locator('.rare-rush');
    await assertFits(page, root, 'sample selection');
    await assertTouchTarget(chosenSample);
    assert.equal(await chosenSample.locator('path[fill="#000000"]').getAttribute('d'), chosenFrontPixels,
      'Generations cards show canonical front-facing art');
    await page.screenshot({ path: path.join(artifacts, `${width}-samples.png`), fullPage: true });
    await chosenSample.click();
    await page.getByRole('button', { name: /LET’S RUSH/ }).waitFor();
    assert.equal(await root.getAttribute('data-screen'), 'ready');
    assert.match(await page.locator('.free-play-game').getAttribute('aria-label'), /Sample Friend #42 selected\. Free Play game\.$/);
    assert.equal(await page.locator('iframe').count(), 0, 'The free runner loads directly without a wallet host');
    const pixels = root.locator('[data-character="friend"] path[fill="#000000"]');
    assert(await pixels.count() > 0, 'The selected Friend has real bitmap-derived pixel art');
    assert((await pixels.first().getAttribute('d')).length > 100, 'Friend art contains a real pixel silhouette');
    assert.equal(await pixels.first().getAttribute('d'), chosenRunningPixels, 'The runner retains the selected Friend’s canonical side-facing gameplay art');
    await assertFreeUI(root);
    await assertFits(page, root, 'ready');

    for (const [mode, seconds] of modes) {
      const choice = page.getByRole('button', { name: new RegExp(`^${mode} difficulty$`, 'i') });
      await choice.click();
      assert.equal(await choice.getAttribute('aria-pressed'), 'true');
      assert.equal(await root.getAttribute('data-difficulty'), mode);
      assert.equal(await root.getAttribute('data-run-duration'), String(seconds));
      await assertTouchTarget(choice);
      assert.equal(Number(await root.locator('[data-local-best]').getAttribute('data-local-best')), 0,
        'Each difficulty begins with a clean local best in a new browser context');
    }
    await page.getByRole('button', { name: new RegExp(`^${difficulty} difficulty$`, 'i') }).click();
    await page.getByRole('button', { name: 'How to play', exact: true }).click();
    await page.getByText('JUMP / DOUBLE JUMP', { exact: true }).waitFor();
    await assertFreeUI(root);
    await page.getByRole('button', { name: /^Close/ }).click();
    await page.screenshot({ path: path.join(artifacts, `${width}-ready.png`), fullPage: true });
    await page.getByRole('button', { name: /LET’S RUSH/ }).click();
    await page.clock.runFor(80);
    assert.equal(await root.getAttribute('data-screen'), 'running');
    assert.equal(await root.getAttribute('data-phase'), 'side');
    assert.equal(await page.getByRole('group', { name: 'Choose difficulty', exact: true }).count(), 0,
      'Difficulty stays locked during a run');
    const character = root.locator('[data-character="friend"]');
    const startY = Number(await character.getAttribute('data-screen-y'));
    const stage = root.locator('.world-svg');
    await stage.focus();
    if (mobile) await page.getByRole('button', { name: 'Jump, tap twice to double jump', exact: true }).tap();
    else await page.keyboard.press('Space');
    await page.clock.runFor(160);
    assert(Number(await character.getAttribute('data-screen-y')) < startY - 10,
      'Manual jump input moves the actual Friend into the air');
    await page.clock.runFor(1000);

    for (const [key, name, direction] of [['ArrowRight', 'Hold to speed up', 1], ['ArrowLeft', 'Hold to slow down', -1]]) {
      const checkHeld = async () => {
        await page.clock.runFor(100);
        assert.equal(await root.locator('[data-pace]').getAttribute('data-pace'), String(direction),
          'A held manual control changes actual run pace');
      };
      if (mobile) await pointerHold(page, page.getByRole('button', { name, exact: true }), checkHeld);
      else {
        await stage.focus();
        await page.keyboard.down(key);
        await checkHeld();
        await page.keyboard.up(key);
      }
      await page.clock.runFor(40);
      assert.equal(await root.locator('[data-pace]').getAttribute('data-pace'), '0', 'Releasing input restores neutral pace');
    }
    const checkSlide = async () => {
      await page.clock.runFor(80);
      assert.equal(await character.getAttribute('data-slide'), 'true', 'Holding slide changes actual player pose');
    };
    if (mobile) await pointerHold(page, page.getByRole('button', { name: 'Hold to slide', exact: true }), checkSlide);
    else {
      await page.keyboard.down('ArrowDown');
      await checkSlide();
      await page.keyboard.up('ArrowDown');
    }
    await page.clock.runFor(40);
    assert.equal(await character.getAttribute('data-slide'), 'false', 'Releasing slide restores standing pose');

    await page.getByRole('button', { name: 'Pause game', exact: true }).click();
    await page.getByRole('heading', { name: 'PAUSED', exact: true }).waitFor();
    const pausedHUD = await root.locator('.hud').innerText();
    const pausedPosition = await character.getAttribute('transform');
    await page.clock.runFor(1200);
    assert.equal(await root.locator('.hud').innerText(), pausedHUD, 'Pause freezes timer, distance, and hearts');
    assert.equal(await character.getAttribute('transform'), pausedPosition, 'Pause freezes player movement');
    await page.getByRole('button', { name: /KEEP RUNNING/ }).click();
    await page.clock.runFor(80);
    await page.keyboard.down('ArrowRight');
    await page.clock.runFor(40);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.keyboard.up('ArrowRight');
    await page.getByRole('heading', { name: 'PAUSED', exact: true }).waitFor();
    const blurredHUD = await root.locator('.hud').innerText();
    await page.clock.runFor(1200);
    assert.equal(await root.locator('.hud').innerText(), blurredHUD, 'Losing focus pauses the real timer');
    await page.getByRole('button', { name: /KEEP RUNNING/ }).click();
    await page.clock.runFor(80);
    assert.equal(await root.locator('[data-pace]').getAttribute('data-pace'), '0', 'Blur releases held controls');
    await assertFits(page, root, 'running');
    await assertFreeUI(root);
    await page.screenshot({ path: path.join(artifacts, `${width}-running.png`), fullPage: true });

    const seconds = modes.find(([mode]) => mode === difficulty)[1];
    await finishRun(page, root, seconds);
    await assertInvitation(page);
    await assertFreeUI(root);
    await assertFits(page, root, 'result');
    const firstScore = readScore(await root.locator('.result-score').innerText());
    assert(firstScore > 0, 'A manual run earns an observable nonzero score');
    assert.equal(Number(await root.locator('[data-local-best]').getAttribute('data-local-best')), firstScore);
    await page.screenshot({ path: path.join(artifacts, `${width}-result.png`), fullPage: true });
    await guard.verify();
    await page.getByRole('button', { name: /RUN IT BACK/ }).click();
    await page.clock.runFor(80);
    assert.equal(await root.getAttribute('data-screen'), 'running', 'Retry starts another actual run');
    assert.equal(await root.getAttribute('data-difficulty'), difficulty, 'Retry retains the selected difficulty');
    await finishRun(page, root, seconds);
    const secondScore = readScore(await root.locator('.result-score').innerText());
    const best = Math.max(firstScore, secondScore);
    assert.equal(Number(await root.locator('[data-local-best]').getAttribute('data-local-best')), best,
      'A lower run cannot overwrite the local best');
    const change = page.getByRole('button', { name: /CHANGE DIFFICULTY/ });
    await assertTouchTarget(change);
    await change.click();
    assert.equal(await root.getAttribute('data-screen'), 'ready', 'Change difficulty returns to selection');
    const other = modes.find(([mode]) => mode !== difficulty)[0];
    await page.getByRole('button', { name: new RegExp(`^${other} difficulty$`, 'i') }).click();
    assert.equal(Number(await root.locator('[data-local-best]').getAttribute('data-local-best')), 0,
      'Local bests are independent for each difficulty');
    await guard.verify();

    await page.reload();
    await chosenSample.click();
    await page.getByRole('button', { name: /LET’S RUSH/ }).waitFor();
    await page.getByRole('button', { name: new RegExp(`^${difficulty} difficulty$`, 'i') }).click();
    assert.equal(Number(await root.locator('[data-local-best]').getAttribute('data-local-best')), best,
      'An earned best survives a full page reload');
    await guard.verify();
    if (width === 1440 || width === 390) {
      await page.getByRole('button', { name: 'Choose another sample Friend', exact: true }).click();
      const genesisSample = samples.and(page.locator('[data-collection="genesis"]')).first();
      await genesisSample.waitFor();
      const genesisId = await genesisSample.getAttribute('data-token-id');
      const portrait = genesisSample.locator('img');
      const portraitUrl = await portrait.getAttribute('src');
      assert.match(portraitUrl, /^data:image\//, 'Genesis sample artwork is locally cached');
      assert(await portrait.evaluate(image => image.complete && image.naturalWidth > 0),
        'The Genesis front portrait decodes successfully');
      await genesisSample.click();
      await page.getByRole('button', { name: /LET’S RUSH/ }).waitFor();
      assert.match(await page.locator('.free-play-game').getAttribute('aria-label'), new RegExp(`Genesis #${genesisId} selected`));
      const genesisArt = root.locator('[data-genesis-art="true"]');
      assert(await genesisArt.count() > 0, 'The actual Genesis portrait is attached to its runner body');
      assert.equal(await genesisArt.first().getAttribute('href'), portraitUrl,
        'The Genesis runner uses the exact portrait selected in the picker');
      assert(await root.locator('[data-genesis-body-pixels]').count() > 0, 'Genesis has its animated runner body');
      await page.getByRole('button', { name: /^degen difficulty$/i }).click();
      await page.getByRole('button', { name: /LET’S RUSH/ }).click();
      await page.clock.runFor(80);
      const genesisCharacter = root.locator('[data-character="friend"]');
      const genesisStartY = Number(await genesisCharacter.getAttribute('data-screen-y'));
      if (mobile) await page.getByRole('button', { name: 'Jump, tap twice to double jump', exact: true }).tap();
      else { await root.locator('.world-svg').focus(); await page.keyboard.press('Space'); }
      await page.clock.runFor(160);
      assert(Number(await genesisCharacter.getAttribute('data-screen-y')) < genesisStartY - 10,
        'Manual controls move the selected Genesis character');
      await assertFreeUI(root);
      await assertFits(page, root, 'Genesis running');
      await page.screenshot({ path: path.join(artifacts, `${width}-genesis-running.png`), fullPage: true });
      await finishRun(page, root, 60);
      assert(readScore(await root.locator('.result-score').innerText()) > 0, 'A real Genesis run earns a score');
      await assertFreeUI(root);
      await assertInvitation(page);
      await guard.verify();
    }
    reports.push({ width, height, difficulty, firstScore, secondScore, best,
      requests: guard.requests.map(request => ({ ...request, url: request.url.replace(origin, '') })) });
    await context.close();
    console.log(`${width}px ${difficulty}: local samples, all difficulty choices, manual ${mobile ? 'touch' : 'keyboard'} input, pause/blur, results, retry and persistent best passed`);
  }

  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const guard = await installOfflineGuard(page, origin);
    await page.goto(`${origin}/arcade/`);
    const card = page.locator('.collection-free-play');
    const cta = card.locator('b');
    await card.waitFor();
    await page.mouse.move(0, 0);
    assert.equal(await card.evaluate(element => getComputedStyle(element).borderTopColor), 'rgb(255, 255, 255)',
      'Free Play card has the same default white border as the wallet collection cards');
    assert.equal(await card.evaluate(element => getComputedStyle(element).boxShadow), 'none',
      'Free Play card has a single flat outline like the wallet collection cards');
    const buttonColors = await cta.evaluate(element => {
      const style = getComputedStyle(element); return { background: style.backgroundColor, color: style.color };
    });
    assert.deepEqual(buttonColors, { background: 'rgb(204, 255, 0)', color: 'rgb(0, 0, 0)' });
    await card.hover();
    assert.equal(await card.evaluate(element => getComputedStyle(element).borderTopColor), 'rgb(204, 255, 0)',
      'Hover changes only the card outline to lime');
    await cta.hover();
    assert.deepEqual(await cta.evaluate(element => {
      const style = getComputedStyle(element); return { background: style.backgroundColor, color: style.color };
    }), buttonColors, 'Free Play button keeps its lime fill and black label on hover');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false,
      'Arcade card must not create horizontal overflow');
    await page.screenshot({ path: path.join(artifacts, `${width}-arcade-hover.png`), fullPage: true });
    await guard.verify();
    await context.close();
  }

  const request = await browser.newContext();
  const redirect = await request.request.get(`${origin}/free-play`, { maxRedirects: 0 });
  assert.equal(redirect.status(), 308);
  assert.equal(redirect.headers().location, '/free-play/');
  for (const [route, mime] of [['/free-play/', /text\/html/], ['/free-play/index.js', /javascript/], ['/free-play/index.css', /text\/css/]]) {
    const response = await request.request.get(origin + route);
    assert.equal(response.status(), 200, `${route} must be public`);
    assert.match(response.headers()['content-type'], mime);
  }
  // Even an accidental output file must stay private: the server must serve a
  // public allowlist, rather than exposing every file in the route directory.
  await writeFile(path.join(outdir, 'free-play/not-public.json'), '{"private":true}\n');
  for (const route of ['/free-play/not-public.json', '/free-play/index.tsx', '/free-play/index.js.map',
    '/free-play/bests.ts', '/games/rare-rush/free-play/index.tsx', '/.env', '/.rush-site-fonts.json']) {
    assert.equal((await request.request.get(origin + route)).status(), 404, `${route} must not be publicly served`);
  }
  await request.close();
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(reports, null, 2) + '\n');
  console.log('Free Play public-file boundaries and zero wallet/RPC/external-network access passed');
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await built?.close();
  await rm(outdir, { recursive: true, force: true });
}
