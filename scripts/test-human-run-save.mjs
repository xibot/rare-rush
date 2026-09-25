import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { privateKeyToAccount } from 'viem/accounts';
import { decodeFunctionData, encodeFunctionResult, encodeEventTopics, parseAbi, zeroAddress } from 'viem';
import { buildRushSite, createRushSiteServer } from './rush-site.mjs';
import { createArtworkFixture } from '../node_modules/@rarefriends/friendsdk/scripts/browser-fixture.mjs';
import { createReplayFeed } from '../server/replay-feed.mjs';

// Isolated synthetic wallet, local build and in-memory feed only. No live RPC,
// wallet, publication or transaction is possible in this browser test.
const origin = 'https://rarerush.app', rpc = 'https://rpc.mainnet.chain.robinhood.com';
const signer = privateKeyToAccount(`0x${'1'.padStart(64, '0')}`), player = signer.address;
const addresses = { genesis: '0x116EaA62241751E0c98dA43d458600c6C17cD361', generations: '0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D' };
const abi = parseAbi(['function balanceOf(address) view returns(uint256)', 'function ownerOf(uint256) view returns(address)',
  'function tokenBoundAccount(uint256) view returns(address)', 'function tokenURI(uint256) view returns(string)',
  'function generation(uint256) view returns(uint8)', 'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
const portrait = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="white"/><path d="M1 1h6v6H1z" fill="black"/></svg>').toString('base64');
const uri = 'data:application/json;base64,' + Buffer.from(JSON.stringify({ name: 'Genesis #1', image: portrait })).toString('base64');
const outdir = await mkdtemp(path.join(tmpdir(), 'rush-human-save-'));
let built, server, browser;
try {
  built = await buildRushSite({ outdir }); server = createRushSiteServer(outdir);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const local = `http://127.0.0.1:${server.address().port}`, artwork = await createArtworkFixture();
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  for (const { collection, actor } of ['human', 'autopilot'].flatMap(actor => ['genesis', 'generations'].map(collection => ({ collection, actor })))) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [], violations = [], records = new Map(), posts = [];
    let now = Date.now(), reads = 0;
    const { handle } = createReplayFeed({ now: () => now, clientKey: () => collection, store: {
      async read(key) { return structuredClone(records.get(key) ?? null); },
      async putIfAbsent(key, value) { if (records.has(key)) return false; records.set(key, structuredClone(value)); return true; },
      async list() { return { blobs: [], hasMore: false }; },
    }, bindArcade: async payload => {
      assert.equal(payload.player.toLowerCase(), player.toLowerCase());
      assert.equal(payload.collection, collection === 'genesis' ? 1 : 0);
      return { chainId: 4663, owner: player.toLowerCase(), verifiedAtBlock: '256' };
    } });
        const answer = async call => {
          let result;
          if (call.method === 'eth_chainId') result = '0x1237';
          else if (call.method === 'eth_blockNumber') result = '0x100';
          else if (call.method === 'eth_getLogs') {
            assert.equal(call.params[0].address.toLowerCase(), addresses[collection].toLowerCase());
            result = call.params[0].topics[2]?.toLowerCase().endsWith(player.slice(2).toLowerCase()) ? [{ address: addresses[collection],
              topics: encodeEventTopics({ abi, eventName: 'Transfer', args: { from: zeroAddress, to: player, tokenId: collection === 'genesis' ? 1n : 7730n } }),
              data: '0x', blockNumber: '0x100', blockHash: '0x' + 'ab'.repeat(32), transactionHash: '0x' + 'cd'.repeat(32), transactionIndex: '0x0', logIndex: '0x0', removed: false }] : [];
          } else {
            assert.equal(call.method, 'eth_call');
            if (call.params[0].to.toLowerCase() !== addresses[collection].toLowerCase()) result = await artwork(call.params[0]);
            else {
              const { functionName } = decodeFunctionData({ abi, data: call.params[0].data });
              if (functionName === 'ownerOf') reads++;
              const value = { balanceOf: 1n, ownerOf: player, generation: 1, tokenBoundAccount: '0x3333333333333333333333333333333333333333', tokenURI: uri }[functionName];
              result = encodeFunctionResult({ abi, functionName, result: value });
            }
          }
          return { jsonrpc: '2.0', id: call.id, result };
        };
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('readFixtureRpc', async call => (await answer(call)).result);
    await page.exposeFunction('signFixturePublication', typed => signer.signTypedData(typed));
    await page.addInitScript(({ player, authorized }) => {
      if (window.parent !== window) return;
      window.fixtureWallet = { requests: [], authorized, reject: true };
      const provider = { on() {}, removeListener() {}, async request({ method, params }) {
        window.fixtureWallet.requests.push(method);
        if (method === 'eth_accounts') return window.fixtureWallet.authorized ? [player] : [];
        if (method === 'eth_requestAccounts') { window.fixtureWallet.authorized = true; return [player]; }
        if (method === 'eth_chainId') return '0x1237';
        if (['eth_call', 'eth_blockNumber'].includes(method)) return window.readFixtureRpc({ method, params });
        if (method === 'eth_signTypedData_v4') {
          if (window.fixtureWallet.reject) throw Object.assign(new Error('User rejected'), { code: 4001 });
          return window.signFixturePublication(JSON.parse(params[1]));
        }
        throw new Error(`Unexpected wallet method ${method}`);
      } };
      window.ethereum = provider;
      // Same provider through legacy injection and EIP-6963 must be deduplicated.
      window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: { provider, info: { uuid: '7a2f52da-c36f-433e-9a38-a340a4431023', name: 'Fixture wallet', icon: 'data:image/svg+xml;base64,PHN2Zy8+', rdns: 'test.fixture' } },
      })));
      window.addEventListener('securitypolicyviolation', event => window.fixtureViolations.push(event.violatedDirective));
      window.fixtureViolations = [];
    }, { player, authorized: collection === 'genesis' });
    await page.route('**/*', async route => {
      try {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === origin) {
          if (url.pathname === '/api/status') return route.fulfill({ json: { ready: false } });
          if (url.pathname === '/api/arcade-events') return route.fulfill({ json: { accepted: true, receipt: 'fixture-receipt' } });
          if (url.pathname === '/api/runs' || url.pathname.startsWith('/api/runs/')) {
            if (request.method() === 'POST') posts.push(request.postDataJSON()); now = await page.evaluate(() => Date.now());
            const response = await handle(new Request(request.url(), { method: request.method(), headers: request.headers(), ...(request.method() === 'POST' ? { body: request.postData() } : {}) }));
            return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
          }
          const response = await route.fetch({ url: new URL(url.pathname + url.search, local).href });
          return route.fulfill({ response });
        }
        assert.equal(url.origin, rpc, 'Every external request is intercepted');
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        const body = request.postDataJSON();
        return route.fulfill({ headers, json: Array.isArray(body) ? await Promise.all(body.map(answer)) : await answer(body) });
      } catch (error) { violations.push(error.message); await route.abort(); }
    });
    let game;
    if (actor === 'human') {
      await page.goto(`${origin}/${collection === 'genesis' ? 'genesis' : 'play'}/`);
      if (collection === 'generations') await page.getByRole('button', { name: /^Connect (wallet|Fixture wallet|Browser wallet)$/ }).click();
      await page.getByRole('button', { name: collection === 'genesis' ? /Genesis #1 FREE ENTRY/ : /^Friend #7730\b/ }).click();
      game = page.frameLocator(collection === 'genesis' ? 'iframe' : '.rf-frame-viewport > iframe');
      await game.getByRole('button', { name: /LET’S RUSH/ }).waitFor();
      assert.equal(await page.locator('iframe').evaluate(el => el.contentDocument === null), true);
      assert.equal(await game.locator('body').evaluate(() => typeof window.ethereum), 'undefined');
      await page.clock.install();
      await game.getByRole('button', { name: 'Degen difficulty' }).click();
      await game.getByRole('button', { name: /LET’S RUSH/ }).click();
    } else {
      await page.goto(`${origin}/agent-play/`);
      game = page;
      await page.locator('.sources button').filter({ hasText: 'ARCADE' }).click();
      await page.locator('.collections button').filter({ hasText: collection === 'genesis' ? 'GENESIS' : 'GENERATIONS' }).click();
      await page.locator('#friend-id').fill(collection === 'genesis' ? '1' : '7730');
      await page.locator('.difficulties button').filter({ hasText: 'DEGEN' }).click();
      await page.getByRole('button', { name: 'CONNECT WALLET', exact: true }).click();
      await page.clock.install();
      await page.getByRole('button', { name: /WATCH AGENT PLAY/ }).click();
      await page.getByRole('button', { name: '1× PLAYBACK', exact: true }).click();
      await page.getByRole('button', { name: '2× PLAYBACK', exact: true }).click();
    }
    for (let second = 0; second < 65 && !await game.locator('[data-screen="result"]').count(); second++) {
      await page.clock.runFor(1000); await new Promise(resolve => setTimeout(resolve, 5));
    }
    await game.locator('[data-screen="result"]').waitFor();
    const score = Number((await game.locator('.result-score').textContent()).replace(/[^0-9]/g, ''));
    assert.equal(posts.length, 0, 'Gameplay never publishes automatically');
    assert.equal((await page.evaluate(() => window.fixtureWallet.requests)).filter(name => name.includes('sign')).length, 0);
    const beforeSaveReads = reads;
    await game.getByRole('button', { name: 'SAVE RUN', exact: true }).click();
    const retry = game.getByRole('button', { name: actor === 'human' ? 'RETRY SAVE RUN' : 'SAVE RUN', exact: true });
    await (actor === 'human' ? game.locator('.run-save [role="alert"]') : page.locator('.result-error')).waitFor();
    assert.match(await (actor === 'human' ? game.locator('.run-save [role="alert"]') : page.locator('.result-error')).textContent(), /Signature declined/);
    await retry.waitFor();
    assert.equal(posts.length, 0); if (actor === 'human') assert(reads > beforeSaveReads, 'Host freshly checks ownership');
    await page.evaluate(() => { window.fixtureWallet.reject = false; });
    await retry.click();
    await game.getByRole('button', { name: actor === 'human' ? 'VIEW SAVED RUN ↗' : 'VIEW IN RUNS FEED ↗', exact: true }).waitFor();
    assert.equal(posts.length, 1);
    const saved = [...records.entries()].find(([key]) => key.includes('/records/'))?.[1];
    assert(saved); assert.equal(saved.metrics.score, score); assert.equal(saved.metrics.verified, true);
    assert.equal(saved.actor, actor); assert.equal(saved.replay.finalTick, saved.metrics.ticks);
    if (collection === 'genesis') assert.equal(saved.art.portraitUrl, portrait);
    else { assert.equal(saved.art.sprites.frames.length, 64); assert(saved.art.sprites.frames.every(word => typeof word === 'string')); }
    const methods = await page.evaluate(() => window.fixtureWallet.requests);
    assert.equal(methods.filter(name => name === 'eth_signTypedData_v4').length, 2);
    assert(methods.every(name => ['eth_accounts', 'eth_requestAccounts', 'eth_chainId', 'eth_call', 'eth_blockNumber', 'eth_signTypedData_v4'].includes(name)));
    assert.deepEqual(errors, []); assert.deepEqual(violations, []); assert.deepEqual(await page.evaluate(() => window.fixtureViolations), []);
    console.log(`${actor} ${collection}: real gameplay → selected wallet → declined/retry signature → verified public replay (${saved.metrics.ticks} real ticks), exact art, no transaction.`);
    await page.close();
  }
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await built?.close(); await rm(outdir, { recursive: true, force: true });
}
