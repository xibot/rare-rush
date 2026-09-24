/** Local browser QA only. Chain calls use mocks; the test never signs or sends a transaction. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeAbiParameters, parseAbi } from 'viem';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const artifacts = resolve(here, 'artifacts/browser-check');
const temporary = await mkdtemp(resolve(tmpdir(), 'rare-rush-agent-browser-'));
const port = Number(process.env.AGENT_PLAY_TEST_PORT || 4222);
const origin = `http://127.0.0.1:${port}`;
const failures = [], checks = [], pages = [];
const check = message => { checks.push(message); console.log(`✓ ${message}`); };
let server, browser, serverOutput = '';
const account = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const wallet = '0x3333333333333333333333333333333333333333';
const abi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function generation(uint256 tokenId) view returns (uint8)',
  'function tokenBoundAccount(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function familyOf(uint256 tokenId) pure returns (uint8)',
  'function seedOf(uint256 tokenId) pure returns (uint32)',
  'function frames(uint8 id, uint32 seed) view returns (uint256[64])',
]);
const data = (mime, value) => `data:${mime};base64,${Buffer.from(value).toString('base64')}`;
const portrait = data('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#fff"/><path d="M1 1h6v6H1zM2 2v1h1V2zm3 0v1h1V2zM3 4v1h2V4z" fill-rule="evenodd"/></svg>');
const metadata = data('application/json', JSON.stringify({ image: portrait }));

async function newPage(width, fixture) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  const page = await context.newPage();
  pages.push(page);
  page.on('pageerror', error => { failures.push(error.stack || error.message); console.error(error.stack || error.message); });
  // Testnet controls may inspect status, but no test is permitted to reach a
  // real chain, verifier, wallet signature, or external network endpoint.
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { failures.push(`Unexpected external request: ${url.href}`); return route.abort(); }
    if (['/api/rpc', '/api/status', '/api/verify-run'].includes(url.pathname)) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Chain network disabled during local browser QA.' }) });
    }
    return route.continue();
  });
  if (fixture) {
    await page.exposeBinding('__agentMockRpc', async (_source, { method, params }) => {
      fixture.methods.push(method);
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [fixture.account];
      if (method === 'eth_chainId') return fixture.chain;
      if (method === 'eth_blockNumber') return '0x63';
      assert.equal(method, 'eth_call', `Unexpected wallet method ${method}`);
      const { functionName } = decodeFunctionData({ abi, data: params[0].data });
      fixture.reads.push(functionName);
      switch (functionName) {
        case 'ownerOf': return encodeAbiParameters([{ type: 'address' }], [fixture.owner]);
        case 'generation': return encodeAbiParameters([{ type: 'uint8' }], [1]);
        case 'tokenBoundAccount': return encodeAbiParameters([{ type: 'address' }], [wallet]);
        case 'tokenURI': return encodeAbiParameters([{ type: 'string' }], [metadata]);
        case 'familyOf': return encodeAbiParameters([{ type: 'uint8' }], [2]);
        case 'seedOf': return encodeAbiParameters([{ type: 'uint32' }], [4_000_000_000]);
        case 'frames': return encodeAbiParameters([{ type: 'uint256[64]' }], [Array(64).fill(BigInt('0x' + '3c00'.repeat(16)))]);
      }
      throw new Error(`Unexpected contract method ${functionName}`);
    });
    await page.addInitScript(() => {
      const listeners = new Map();
      window.ethereum = {
        request: args => window.__agentMockRpc(args),
        on(event, callback) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(callback); },
        removeListener(event, callback) { listeners.get(event)?.delete(callback); },
      };
      window.__agentWalletEvent = (event, value) => { for (const listener of listeners.get(event) ?? []) listener(value); };
    });
  }
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'AGENT PLAY.' }).waitFor();
  return page;
}

async function noOverflow(page, name) {
  const result = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('body *')].filter(element => {
      if (element.closest('svg') || element instanceof SVGElement) return false;
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      return style.display !== 'none' && box.width > 0 && (box.right > innerWidth + 1 || box.left < -1);
    }).map(element => ({ element: element.tagName, class: element.className })).slice(0, 8) }));
  assert.ok(result.document <= result.width + 1, `${name}: page overflow ${JSON.stringify(result)}`);
  assert.deepEqual(result.offenders, [], `${name}: elements escape viewport`);
}

async function clock(page) {
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
}
const tick = async page => Number(await page.locator('.watch-section').getAttribute('data-tick'));
async function complete(page) {
  for (let i = 0; i < 12 && await page.locator('.watch-section').getAttribute('data-screen') !== 'result'; i++) await page.clock.runFor(2500);
  assert.equal(await page.locator('.watch-section').getAttribute('data-screen'), 'result', 'Run completed within its simulated duration');
}

try {
  await mkdir(artifacts, { recursive: true });
  const serverSource = await readFile(resolve(here, 'serve.mjs'), 'utf8');
  assert.ok(serverSource.includes('AGENT_PLAY_DATA_DIR') && serverSource.includes('AGENT_PLAY_OUT_DIR'), 'Server needs isolated QA output/data directory options.');
  server = spawn(process.execPath, [resolve(here, 'serve.mjs')], { cwd: repo, env: { ...process.env,
    AGENT_PLAY_PORT: String(port), AGENT_PLAY_DATA_DIR: resolve(temporary, 'data'), AGENT_PLAY_OUT_DIR: resolve(temporary, 'out') }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', value => { serverOutput += value; });
  server.stderr.on('data', value => { serverOutput += value; });
  for (let retry = 0; retry < 100; retry++) {
    if (server.exitCode !== null) throw new Error(`Local test server exited: ${serverOutput}`);
    if (serverOutput.includes(`AGENT PLAY (local only): ${origin}/`)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(serverOutput.includes(`AGENT PLAY (local only): ${origin}/`), `Local server not ready: ${serverOutput}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  if (!process.argv.includes('--arcade-only')) {
  const page = await newPage(1440);

  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const mode of ['EASY', 'NORMAL', 'DEGEN']) {
      const button = page.locator('.difficulties').getByRole('button', { name: new RegExp(`^${mode}`) });
      await button.click(); assert.equal(await button.getAttribute('aria-pressed'), 'true');
    }
    for (const collection of ['GENESIS', 'GENERATIONS']) {
      const button = page.locator('.collections').getByRole('button', { name: new RegExp(`^${collection} `) });
      await button.click(); assert.equal(await button.getAttribute('aria-pressed'), 'true');
    }
    for (const environment of ['ARCADE', 'TESTNET', 'PREVIEW']) {
      const button = page.getByRole('group', { name: 'Game environment' }).getByRole('button', { name: new RegExp(`^${environment} `) });
      await button.click(); assert.equal(await button.getAttribute('aria-pressed'), 'true');
      await noOverflow(page, `${width}px ${environment}`);
      await page.locator('.sources button:disabled').waitFor({ state: 'hidden' });
    }
    await page.screenshot({ path: resolve(artifacts, `ready-${width}.png`), fullPage: true });
    check(`${width}px: no overflow; all environments, difficulties, and collections selectable`);
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await clock(page);
  await page.locator('.collections').getByRole('button', { name: /^GENESIS / }).click();
  await page.getByRole('button', { name: /WATCH AGENT PLAY/ }).click();
  await page.clock.runFor(1000);
  assert.ok(await tick(page) > 0);
  await page.getByRole('button', { name: 'PAUSE Ⅱ', exact: true }).click();
  const pausedAt = await tick(page);
  await page.clock.runFor(2000);
  assert.equal(await tick(page), pausedAt, 'Pause freezes simulation ticks');
  await page.getByRole('button', { name: 'RESUME ▶', exact: true }).click();
  await page.clock.runFor(500);
  assert.ok(await tick(page) > pausedAt);
  await page.getByRole('button', { name: '1× PLAYBACK', exact: true }).click();
  await page.getByRole('button', { name: '2× PLAYBACK', exact: true }).click();
  for (let i = 0; i < 30; i++) {
    await page.clock.runFor(250);
    if (['up', 'down'].includes(await page.locator('.agent-stage').getAttribute('data-phase')) &&
      await page.locator('[data-scene="connected-track"]').getAttribute('data-transition') === 'none') break;
  }
  await page.getByRole('button', { name: 'PAUSE Ⅱ', exact: true }).click();
  assert.ok(['up', 'down'].includes(await page.locator('.agent-stage').getAttribute('data-phase')), 'Degen run reaches a vertical shaft');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.clock.runFor(100);
    const scale = Number(await page.locator('[data-scene="connected-track"]').getAttribute('data-camera-scale'));
    assert.ok(Math.abs(scale - 520 / 960) < .001, 'Mobile camera shows the full shaft');
    await noOverflow(page, `${width}px shaft`);
    await page.locator('.agent-stage').screenshot({ path: resolve(artifacts, `shaft-${width}.png`) });
  }
  check('Pause/resume freezes and advances ticks; the full shaft stays visible on mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'RESUME ▶', exact: true }).click();
  await complete(page);
  await page.getByRole('button', { name: 'WATCH REPLAY ▶', exact: true }).waitFor();
  const finalTick = await tick(page);
  const result = await page.locator('.result-stats').innerText();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'SAVE REPLAY ↓', exact: true }).click();
  const download = await downloadPromise;
  const replayFile = resolve(artifacts, 'downloaded-replay.json');
  await download.saveAs(replayFile);
  const downloaded = JSON.parse(await readFile(replayFile, 'utf8'));
  assert.equal(downloaded.replay.finalTick, finalTick);
  assert.ok(downloaded.replay.inputs.frames.length > 0);
  const saved = await (await page.request.get(`${origin}/api/runs`)).json();
  assert.equal(saved.runs.length, 1);
  assert.equal(saved.runs[0].metrics.ticks, finalTick);
  check('Local preview completes, verifies, saves a score, and downloads its replay');

  await page.getByRole('button', { name: 'WATCH REPLAY ▶', exact: true }).click();
  await page.getByRole('button', { name: '1× PLAYBACK', exact: true }).click();
  await page.getByRole('button', { name: '2× PLAYBACK', exact: true }).click();
  await complete(page);
  assert.equal(await tick(page), finalTick);
  assert.equal(await page.locator('.result-stats').innerText(), result);
  assert.equal((await (await page.request.get(`${origin}/api/runs`)).json()).runs.length, 1, 'Watching a replay does not create another score');
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.run-row').waitFor();
  assert.equal(await page.locator('.run-row').count(), 1);
  await page.screenshot({ path: resolve(artifacts, 'saved-library.png'), fullPage: true });
  check('Watching a replay reproduces final metrics; the saved score survives reload');
  await page.context().close();
  }

  const fixture = { owner: other, account, chain: '0x1237', methods: [], reads: [] };
  const arcade = await newPage(1440, fixture);
  await arcade.getByRole('group', { name: 'Game environment' }).getByRole('button', { name: /^ARCADE / }).click();
  await arcade.getByRole('button', { name: 'CONNECT ARCADE WALLET', exact: true }).click();
  await arcade.getByLabel('YOUR NFT ID').fill('42');
  for (const collection of ['GENESIS', 'GENERATIONS']) {
    const selected = arcade.locator('.collections').getByRole('button', { name: new RegExp(`^${collection} `) });
    await selected.click();
    assert.equal(await selected.getAttribute('aria-pressed'), 'true', `${collection} is selected`);
    await arcade.getByRole('button', { name: /WATCH AGENT PLAY/ }).click();
    await arcade.getByRole('alert').filter({ hasText: /not owned|no longer owned/ }).waitFor();
    assert.equal(await arcade.locator('.watch-section').getAttribute('data-screen'), 'ready');
    assert.equal(await tick(arcade), 0);
  }
  check('Arcade rejects unowned Genesis and Generations before starting');
  fixture.owner = account;
  for (const collection of ['GENERATIONS', 'GENESIS']) {
    const selected = arcade.locator('.collections').getByRole('button', { name: new RegExp(`^${collection} `) });
    await selected.click();
    assert.equal(await selected.getAttribute('aria-pressed'), 'true', `${collection} is selected`);
    await arcade.getByRole('button', { name: 'CHECK FRIEND ↗', exact: true }).click();
    await arcade.getByText(new RegExp(`${collection === 'GENESIS' ? 'Genesis' : 'Generations'} #42.*OWNERSHIP CHECKED`)).waitFor();
    assert.equal(await arcade.locator('.agent-stage-caption').getByText('ONCHAIN ART', { exact: true }).count(), 1);
    if (collection === 'GENESIS') assert.equal(await arcade.locator('image[data-genesis-art]').getAttribute('href'), portrait);
    check(`Arcade loads ${collection} mock onchain artwork`);
  }
  const readsBefore = fixture.reads.filter(name => name === 'ownerOf').length;
  await clock(arcade);
  await arcade.getByRole('button', { name: /WATCH AGENT PLAY/ }).click();
  await arcade.locator('.agent-stage[data-running="true"]').waitFor();
  await arcade.clock.runFor(1000);
  assert.ok(await tick(arcade) > 0);
  assert.ok(fixture.reads.filter(name => name === 'ownerOf').length > readsBefore, 'Arcade rechecks ownership on start');
  fixture.account = other;
  await arcade.evaluate(other => window.__agentWalletEvent('accountsChanged', [other]), other);
  const walletPaused = await tick(arcade);
  await arcade.clock.runFor(1000);
  assert.equal(await tick(arcade), walletPaused);
  const resume = arcade.getByRole('button', { name: 'RESUME ▶', exact: true });
  if (await resume.isEnabled()) { await resume.click(); await arcade.clock.runFor(1000); }
  assert.equal(await tick(arcade), walletPaused, 'Arcade cannot resume with a changed wallet');
  assert.ok(fixture.methods.every(method => ['eth_accounts', 'eth_requestAccounts', 'eth_chainId', 'eth_blockNumber', 'eth_call'].includes(method)));
  await arcade.screenshot({ path: resolve(artifacts, 'arcade-wallet-change.png'), fullPage: true });
  check('Arcade uses actual mock onchain art, rechecks on start, and stops on wallet changes without any transaction');

  await arcade.getByRole('button', { name: /^(?:SAVE & EXIT|EXIT RUN)$/ }).click();
  fixture.account = account;
  await arcade.evaluate(account => window.__agentWalletEvent('accountsChanged', [account]), account);
  await arcade.getByRole('button', { name: 'CONNECT ARCADE WALLET', exact: true }).click();
  await arcade.locator('.collections').getByRole('button', { name: /^GENERATIONS / }).click();
  await arcade.getByRole('button', { name: /WATCH AGENT PLAY/ }).click();
  await arcade.locator('.agent-stage[data-running="true"]').waitFor();
  await arcade.getByRole('button', { name: '1× PLAYBACK', exact: true }).click();
  await arcade.getByRole('button', { name: '2× PLAYBACK', exact: true }).click();
  await complete(arcade);
  await arcade.getByRole('button', { name: 'WATCH REPLAY ▶', exact: true }).waitFor();
  const library = await (await arcade.request.get(`${origin}/api/runs`)).json();
  const generationRun = library.runs.find(run => run.source === 'arcade' && run.collection === 0);
  assert.ok(generationRun, 'Actual Generations Arcade run saves successfully');
  const stored = await (await arcade.request.get(`${origin}/api/runs/${generationRun.id}`)).json();
  assert.equal(stored.art.sprites.seed, 4_000_000_000);
  assert.equal(stored.art.sprites.frames.length, 64);
  assert.ok(stored.art.sprites.frames.every(frame => typeof frame === 'string'));
  await arcade.getByRole('button', { name: 'WATCH REPLAY ▶', exact: true }).click();
  await arcade.locator('.agent-stage[data-running="true"]').waitFor();
  await arcade.clock.runFor(500);
  assert.equal(await arcade.locator('.agent-stage-caption').getByText('ONCHAIN ART', { exact: true }).count(), 1);
  assert.ok(await tick(arcade) > 0);
  assert.ok(fixture.methods.every(method => ['eth_accounts', 'eth_requestAccounts', 'eth_chainId', 'eth_blockNumber', 'eth_call'].includes(method)));
  check('Generations Arcade completion saves uint32 artwork and restores it for watchable replay');
  assert.deepEqual(failures, [], 'No browser errors or external requests');
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify({ status: 'passed', checks, failures }, null, 2));
  console.log(`Browser QA passed. Artifacts: ${artifacts}`);
} catch (error) {
  await mkdir(artifacts, { recursive: true });
  for (const [index, page] of pages.entries()) if (!page.isClosed()) await page.screenshot({ path: resolve(artifacts, `failure-${index}.png`), fullPage: true }).catch(() => {});
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify({ status: 'failed', checks, failures, error: error.stack, serverOutput }, null, 2));
  throw error;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(temporary, { recursive: true, force: true });
}
