import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeFunctionResult, encodeEventTopics, parseAbi, zeroAddress } from 'viem';
import { installFixture, createArtworkFixture } from '../node_modules/@rarefriends/friendsdk/scripts/browser-fixture.mjs';

// Exercise the real host, sandbox, economy and renderer. The copied build alone gets
// a read-only observer and a legal-input pilot; nothing is added to production code.
const repo = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), 'rare-rush-twist-'));
const artifacts = path.join(repo, 'artifacts/twist');
await mkdir(artifacts, { recursive: true });
let built, server, browser;
const report = [];

const account = '0x1111111111111111111111111111111111111111';
const tba = '0x3333333333333333333333333333333333333333';
const genesisAddress = '0x116EaA62241751E0c98dA43d458600c6C17cD361';
const rpc = 'https://rpc.mainnet.chain.robinhood.com';
const genesisABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenBoundAccount(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);
const portrait = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="white"/><path fill="black" d="M1 1h6v6H1zM2 2v1h1V2zm3 0v1h1V2zM3 4v1h2V4z" fill-rule="evenodd"/></svg>').toString('base64');
const uri = 'data:application/json;base64,' + Buffer.from(JSON.stringify({ name: 'Genesis #1', image: portrait })).toString('base64');

async function installGenesisFixture(page, origin) {
  const state = { errors: [], ownerReads: 0 };
  await page.addInitScript(({ account }) => {
    if (window.parent !== window) return;
    const listeners = new Map(), methods = [];
    window.ethereum = {
      on(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
      removeListener(name, listener) { listeners.get(name)?.delete(listener); },
      async request({ method }) {
        methods.push(method);
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
        if (method === 'eth_chainId') return '0x1237';
        throw new Error(`Unexpected wallet method: ${method}`);
      },
    };
    window.testWallet = { methods };
  }, { account });
  await page.route('**/*', async route => {
    try {
      const url = new URL(route.request().url());
      if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      assert.equal(url.origin, rpc, 'Fixtures cannot access external services');
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      const answer = call => {
        let result;
        if (call.method === 'eth_chainId') result = '0x1237';
        else if (call.method === 'eth_blockNumber') result = '0x100';
        else if (call.method === 'eth_getLogs') result = call.params[0].topics[2]?.toLowerCase().endsWith(account.slice(2)) ? [{
          address: genesisAddress, topics: encodeEventTopics({ abi: genesisABI, eventName: 'Transfer', args: { from: zeroAddress, to: account, tokenId: 1n } }),
          data: '0x', blockNumber: '0x100', blockHash: '0x' + 'ab'.repeat(32), transactionHash: '0x' + 'cd'.repeat(32), transactionIndex: '0x0', logIndex: '0x0', removed: false,
        }] : [];
        else if (call.method === 'eth_call') {
          assert.equal(call.params[0].to.toLowerCase(), genesisAddress.toLowerCase());
          const { functionName } = decodeFunctionData({ abi: genesisABI, data: call.params[0].data });
          if (functionName === 'ownerOf') state.ownerReads++;
          const resultValue = { balanceOf: 1n, ownerOf: account, tokenBoundAccount: tba, tokenURI: uri }[functionName];
          result = encodeFunctionResult({ abi: genesisABI, functionName, result: resultValue });
        } else throw new Error(`Unexpected RPC: ${call.method}`);
        return { jsonrpc: '2.0', id: call.id, result };
      };
      const body = route.request().postDataJSON();
      return route.fulfill({ headers, json: Array.isArray(body) ? body.map(answer) : answer(body) });
    } catch (error) { state.errors.push(error.message); await route.abort('blockedbyclient'); }
  });
  return state;
}

try {
  await cp(path.join(repo, 'games'), path.join(temporary, 'games'), { recursive: true, filter: source => !source.includes(`${path.sep}.friendsdk`) });
  await mkdir(path.join(temporary, 'scripts'));
  await cp(path.join(repo, 'scripts/rush-site.mjs'), path.join(temporary, 'scripts/rush-site.mjs'));
  await writeFile(path.join(temporary, 'package.json'), '{"type":"module"}\n');
  await symlink(await realpath(path.join(repo, 'node_modules')), path.join(temporary, 'node_modules'), 'dir');
  const gameSource = path.join(temporary, 'games/rare-rush/index.tsx');
  let source = await readFile(gameSource, 'utf8');
  const frameAnchor = 'const events = stepRun(engine.current, dt);';
  const observerAnchor = 'const run = engine.current, e = economy.current';
  assert.equal(source.split(frameAnchor).length, 2, 'A single game-loop injection point is required');
  assert.equal(source.split(observerAnchor).length, 2, 'A single observation point is required');
  source = `import { demoControls as qaDemoControls } from './twist/engine';\n` + source;
  source = source.replace(frameAnchor, `
        const qa = (globalThis as any).__rushTwistQA;
        if (qa?.pilot) {
          const controls = qaDemoControls(engine.current);
          setPace(engine.current, controls.axis);
          setSliding(engine.current, controls.slide);
          if (controls.jump) jump(engine.current);
        }
        ${frameAnchor}`);
  source = source.replace(observerAnchor, `
  const qa = ((globalThis as any).__rushTwistQA ??= { pilot: true });
  qa.read = () => structuredClone(engine.current);
  qa.reward = () => reward.current.toString();
  ${observerAnchor}`);
  await writeFile(gameSource, source);
  const { buildRushSite, createRushSiteServer } = await import(pathToFileURL(path.join(temporary, 'scripts/rush-site.mjs')).href);
  built = await buildRushSite({ outdir: path.join(temporary, 'dist') });
  server = createRushSiteServer(built.outdir);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.RUSH_BROWSER_CHANNEL ? { channel: process.env.RUSH_BROWSER_CHANNEL } : {}) });
  const artworkCall = await createArtworkFixture();

  for (const collection of ['generations', 'genesis']) for (const difficulty of ['easy', 'normal', 'degen']) {
    const mobile = collection === 'genesis';
    const page = await browser.newPage({ viewport: { width: mobile ? 360 : 1440, height: mobile ? 800 : 1050 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const fixture = collection === 'genesis' ? await installGenesisFixture(page, origin) : await installFixture(page, origin, { artworkCall });
    await page.goto(`${origin}/${collection === 'genesis' ? 'genesis' : 'play'}/`);
    if (collection === 'generations') await page.getByRole('button', { name: /^Connect (wallet|Browser wallet)$/ }).click();
    await page.getByRole('button', { name: collection === 'genesis' ? /Genesis #1 FREE ENTRY/ : /^Friend #7730\b/ }).click();
    const game = page.frameLocator('iframe');
    await game.getByRole('button', { name: /LET’S RUSH/ }).waitFor();
    await game.getByRole('button', { name: `${difficulty} difficulty`, exact: false }).click();
    const root = game.locator('.rare-rush');
    const read = () => game.locator('body').evaluate(() => window.__rushTwistQA.read());
    const visual = () => game.locator('[data-character="friend"]').evaluate(element => ({
      spin: Number(element.getAttribute('data-spin')), x: Number(element.getAttribute('data-screen-x')), y: Number(element.getAttribute('data-screen-y')),
    }));
    assert.equal(await root.getAttribute('data-run-duration'), String({ easy: 120, normal: 90, degen: 60 }[difficulty]));
    assert.equal((await game.locator('.economy-bar b').innerText()).replaceAll(',', ''), String({ easy: 7.5, normal: 10, degen: 20 }[difficulty] * (collection === 'genesis' ? 100 : 1)));
    assert.equal(await root.evaluate(element => element.scrollWidth > element.clientWidth), false);
    const clock = new Date('2026-09-23T00:00:00Z');
    await page.clock.install({ time: clock });
    await page.clock.pauseAt(clock);
    await game.getByRole('button', { name: /LET’S RUSH/ }).click();
    await game.locator('[data-screen="running"]').waitFor();
    await page.clock.runFor(100);
    async function until(seconds) {
      let previous = await read();
      while (previous.elapsed < seconds && previous.status !== 'finished') {
        await page.clock.runFor(Math.min(1000, Math.ceil((seconds - previous.elapsed) * 1000) + 18));
        const current = await read();
        assert(current.elapsed > previous.elapsed, `${collection}/${difficulty}: game clock advances`);
        previous = current;
      }
      assert(previous.status !== 'finished' || seconds >= previous.duration, `${collection}/${difficulty}: legal pilot survives until ${seconds.toFixed(2)}s, got ${previous.elapsed.toFixed(2)}s`);
      return previous;
    }
    const initial = await read();
    assert.equal(initial.phase, 'side');
    const bodyId = collection === 'genesis' ? await game.locator('[data-genesis-body]').getAttribute('data-genesis-body') : null;
    const witnessed = [];
    for (let index = 1; index < initial.phasePlan.length; index++) {
      const phase = (await read()).phasePlan[index];
      if (phase.phase === 'side') continue;
      await until(phase.start + .2);
      const entering = await read();
      assert(entering.transition && entering.transition.from === 'side' && entering.transition.to === phase.phase);
      assert.equal(await game.locator('[data-chunk="incoming"]').evaluate(element => getComputedStyle(element).opacity), '1');
      assert.equal(await game.locator('[data-chunk="outgoing"]').evaluate(element => getComputedStyle(element).opacity), '1');
      const samples = [];
      for (const offset of [.3, .8, 1.05, 1.12, 1.18, 1.3, 1.8]) {
        const state = await until(entering.phaseEnteredAt + offset);
        const sample = await visual();
        const sign = state.phase === 'up' ? -1 : 1;
        assert(Math.abs(sample.spin - sign * 180 * (state.elapsed - state.phaseEnteredAt)) < .01, 'The first suction turn and shaft share one uninterrupted 180°/s angle');
        if (samples.length) {
          const before = samples.at(-1);
          const velocity = (sample.spin - before.spin) / (state.elapsed - before.elapsed);
          assert(Math.abs(velocity - sign * 180) < .05, 'No idle frame or angle reset at entrance handoff');
        }
        samples.push({ elapsed: state.elapsed, spin: sample.spin });
      }
      const arrived = await read();
      assert.equal(arrived.transition, undefined);
      if (collection === 'genesis') {
        assert.equal(await game.locator('[data-genesis-body]').getAttribute('data-genesis-body'), bodyId);
        assert.equal(await game.locator('[data-genesis-art]').getAttribute('href'), portrait);
      }
      const label = `${collection}-${difficulty}-${phase.phase}`;
      await page.locator('iframe').screenshot({ path: path.join(artifacts, `${label}.png`), animations: 'allow' });
      if (!witnessed.length) {
        await game.getByRole('button', { name: 'Pause game', exact: true }).click();
        await game.getByRole('heading', { name: 'PAUSED', exact: true }).waitFor();
        const paused = await read(), pausedVisual = await visual();
        await page.clock.runFor(600);
        assert.equal((await read()).elapsed, paused.elapsed);
        assert.equal((await visual()).spin, pausedVisual.spin);
        await game.getByRole('button', { name: /KEEP RUNNING/ }).click();
        await page.clock.runFor(30);
        // Hold a real UI control while the pilot is disabled, then release it.
        await game.locator('body').evaluate(() => { window.__rushTwistQA.pilot = false; });
        const before = await read();
        if (mobile) {
          const bounds = await game.getByRole('button', { name: 'Steer right', exact: true }).boundingBox();
          assert(bounds && bounds.height >= 44 && bounds.width >= 44);
          await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
          await page.mouse.down();
        } else { await game.locator('.world-svg').focus(); await page.keyboard.down('ArrowRight'); }
        await page.clock.runFor(100);
        const moved = await read();
        assert(moved.player.x > before.player.x, 'Keyboard/touch steers horizontally during a shaft');
        if (mobile) await page.mouse.up(); else await page.keyboard.up('ArrowRight');
        await page.clock.runFor(20);
        assert.equal((await read()).pace, 0, 'Releasing the control releases steering');
        await game.locator('body').evaluate(() => { window.__rushTwistQA.pilot = true; });
      }
      witnessed.push(phase.phase);
    }
    assert(witnessed.includes('up') && witnessed.includes('down'), 'Every mode visits both vertical directions');
    const finished = await until(initial.duration + .1);
    assert.equal(finished.finishReason, 'time');
    assert(finished.coins > 0 && finished.hearts > 0);
    assert.equal(await root.getAttribute('data-screen'), 'result');
    assert.match(await game.locator('.result-card').innerText(), /Nothing minted onchain/);
    const actualReward = BigInt(await game.locator('body').evaluate(() => window.__rushTwistQA.reward()));
    assert(finished.coins < 10_000, 'This fresh-session run stays below the first reward halving');
    const base = { easy: 7_500_000n, normal: 10_000_000n, degen: 20_000_000n }[difficulty];
    const uncapped = BigInt(finished.coins + 9 * finished.bonusCoins) * base * (collection === 'genesis' ? 100n : 1n);
    assert.equal(actualReward, uncapped < 200_000_000_000n ? uncapped : 200_000_000_000n, 'Existing weighted bonus, mode, Genesis and supply-cap rewards are preserved');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await root.evaluate(element => element.scrollWidth > element.clientWidth), false);
    assert.deepEqual(errors, []); assert.deepEqual(fixture.errors, []);
    report.push({ collection, difficulty, mobile, duration: finished.duration, phases: witnessed, coins: finished.coins, bonus: finished.bonusCoins, hearts: finished.hearts });
    console.log(`${collection}/${difficulty}: ${witnessed.join(' → ')}, uninterrupted spin, pause, controls and original rewards passed`);
    await page.close();
  }
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n');
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await built?.close();
  await rm(temporary, { recursive: true, force: true });
}
