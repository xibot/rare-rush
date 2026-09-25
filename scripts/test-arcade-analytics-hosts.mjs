import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeFunctionResult, encodeEventTopics, parseAbi, zeroAddress } from 'viem';
import { buildRushSite, createRushSiteServer } from './rush-site.mjs';
import { installFixture, createArtworkFixture } from '../node_modules/@rarefriends/friendsdk/scripts/browser-fixture.mjs';

// Real shipped hosts/game bundles, isolated wallet/RPC responses and a routed
// production URL. Every analytics POST is intercepted: no public stats change.
const origin = 'https://rarerush.app';
const account = '0x1111111111111111111111111111111111111111';
const excluded = '0x6fd155b9d52f80e8a73a8a2537268602978486e2';
const contract = '0x116EaA62241751E0c98dA43d458600c6C17cD361';
const rpc = 'https://rpc.mainnet.chain.robinhood.com';
const abi = parseAbi(['function balanceOf(address account) view returns(uint256)', 'function ownerOf(uint256 tokenId) view returns(address)', 'function tokenBoundAccount(uint256 tokenId) view returns(address)', 'function tokenURI(uint256 tokenId) view returns(string)', 'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
const portrait = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="white"/><path d="M1 1h6v6H1z" fill="black"/></svg>').toString('base64');
const uri = 'data:application/json;base64,' + Buffer.from(JSON.stringify({ name: 'Genesis #1', image: portrait })).toString('base64');
const outdir = await mkdtemp(path.join(tmpdir(), 'rush-analytics-hosts-'));
let built, server, browser;

async function routeSite(page, localOrigin, events) {
  await page.addInitScript(() => {
    window.analyticsPolicyViolations = [];
    window.addEventListener('securitypolicyviolation', event => window.analyticsPolicyViolations.push(event.violatedDirective));
  });
  // Registered after the fixture so all production URLs stop here. Only the
  // checked local build server is fetched; no request can reach the live site.
  await page.route(`${origin}/**`, async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/api/arcade-events') {
      assert.equal(request.headers().origin, origin);
      const body = request.postDataJSON(); events.push(body);
      return route.fulfill({ json: { accepted: true, receipt: body.type === 'start' ? `receipt-${body.runId}` : null } });
    }
    const response = await route.fetch({ url: new URL(url.pathname + url.search, localOrigin).href });
    return route.fulfill({ response });
  });
}
async function waitFor(predicate) {
  const deadline = Date.now() + 8000;
  while (!predicate()) { if (Date.now() > deadline) assert.fail('Expected host analytics event was not received'); await new Promise(resolve => setTimeout(resolve, 20)); }
}
async function finishNaturally(page, game) {
  for (let second = 0; second < 125 && await game.locator('[data-screen="result"]').count() === 0; second++) {
    await page.clock.runFor(1000);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(await game.locator('[data-screen="result"]').count(), 1, 'Real engine reaches its natural finish');
}
async function installGenesisFixture(page, player) {
  const errors = [];
  const transfer = { address: contract, topics: encodeEventTopics({ abi, eventName: 'Transfer', args: { from: zeroAddress, to: player, tokenId: 1n } }), data: '0x', blockNumber: '0x100', blockHash: '0x' + 'ab'.repeat(32), transactionHash: '0x' + 'cd'.repeat(32), transactionIndex: '0x0', logIndex: '0x0', removed: false };
  await page.addInitScript(player => {
    if (window.parent !== window) return;
    const methods = [];
    window.ethereum = { on() {}, removeListener() {}, async request({ method }) {
      methods.push(method);
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [player];
      if (method === 'eth_chainId') return '0x1237';
      throw new Error(`Unexpected signing method: ${method}`);
    } };
    window.testWallet = { methods };
  }, player);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.protocol === 'data:') return route.continue();
    if (url.origin !== rpc) { errors.push(url.href); return route.abort(); }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    const respond = call => {
      let result;
      if (call.method === 'eth_chainId') result = '0x1237';
      else if (call.method === 'eth_blockNumber') result = '0x100';
      else if (call.method === 'eth_getLogs') result = call.params[0].topics[2]?.toLowerCase().endsWith(player.slice(2).toLowerCase()) ? [transfer] : [];
      else {
        assert.equal(call.method, 'eth_call'); assert.equal(call.params[0].to.toLowerCase(), contract.toLowerCase());
        const decoded = decodeFunctionData({ abi, data: call.params[0].data });
        const value = { balanceOf: 1n, ownerOf: player, tokenBoundAccount: '0x3333333333333333333333333333333333333333', tokenURI: uri }[decoded.functionName];
        result = encodeFunctionResult({ abi, functionName: decoded.functionName, result: value });
      }
      return { jsonrpc: '2.0', id: call.id, result };
    };
    const body = route.request().postDataJSON();
    return route.fulfill({ json: Array.isArray(body) ? body.map(respond) : respond(body), headers: { 'access-control-allow-origin': '*' } });
  });
  return errors;
}

try {
  built = await buildRushSite({ outdir }); server = createRushSiteServer(outdir);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const localOrigin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const artworkCall = await createArtworkFixture();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }), events = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await installFixture(page, origin, { artworkCall });
  await routeSite(page, localOrigin, events);
  await page.goto(`${origin}/play/`);
  await page.getByRole('button', { name: /^Connect (wallet|Browser wallet)$/ }).click();
  await page.getByRole('button', { name: /^Friend #7730\b/ }).click();
  const game = page.frameLocator('.rf-frame-viewport > iframe');
  await game.getByRole('button', { name: /LET’S RUSH/ }).waitFor();
  assert.equal(await game.locator('body').evaluate(() => document.referrer), '', 'SDK intentionally uses no-referrer');
  assert.equal(await game.locator('body').evaluate(() => new URL(location.href).origin), origin, 'Document URL remains available in the opaque sandbox');
  assert.equal(events.length, 0, 'Choosing a Friend is not a run');
  await page.clock.install();
  await game.getByRole('button', { name: /LET’S RUSH/ }).click();
  await waitFor(() => events.length === 1);
  assert.deepEqual({ collection: events[0].collection, wallet: events[0].wallet, difficulty: events[0].difficulty }, { collection: 'generations', wallet: account, difficulty: 'normal' });
  await finishNaturally(page, game); await waitFor(() => events.length === 2);
  assert.equal(events[1].receipt, `receipt-${events[0].runId}`);
  assert.ok(['time', 'hearts'].includes(events[1].finishReason));
  assert.ok(events[1].elapsedSeconds > 0);
  assert.deepEqual(errors, []); assert.deepEqual(fixture.errors, []);
  assert.deepEqual(await page.evaluate(() => window.analyticsPolicyViolations), [], 'Host CSP permits analytics');
  assert.equal((await page.evaluate(() => window.__friendWalletTest.state.requests)).filter(method => method === 'eth_requestAccounts').length, 1, 'Analytics never reconnects or signs');
  await page.close();
  console.log('Actual Generations SDK host: real account DOM, opaque sandbox with no-referrer, successful entry and natural finish tracked once; no signing.');

  for (const player of [account, excluded]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }), events = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const fixtureErrors = await installGenesisFixture(page, player);
    await routeSite(page, localOrigin, events);
    await page.goto(`${origin}/genesis/`);
    await page.getByRole('button', { name: /Genesis #1 FREE ENTRY/ }).click();
    const game = page.frameLocator('iframe');
    await game.getByRole('button', { name: /LET’S RUSH/ }).waitFor();
    assert.equal(await game.locator('body').evaluate(() => document.referrer), `${origin}/genesis/`);
    assert.equal(events.length, 0);
    await page.clock.install();
    await game.getByRole('button', { name: /LET’S RUSH/ }).click();
    await game.locator('[data-screen="running"]').waitFor();
    if (player !== excluded) {
      await waitFor(() => events.length === 1);
      assert.equal(events[0].collection, 'genesis'); assert.equal(events[0].wallet, account);
    }
    await finishNaturally(page, game);
    if (player !== excluded) {
      await waitFor(() => events.length === 2);
      assert.equal(events[1].receipt, `receipt-${events[0].runId}`);
    } else assert.equal(events.length, 0, 'Actual owner game is excluded at both start and finish');
    assert.deepEqual(errors, []); assert.deepEqual(fixtureErrors, []);
    assert.deepEqual(await page.evaluate(() => window.analyticsPolicyViolations), [], 'Host CSP permits analytics');
    assert.ok((await page.evaluate(() => window.testWallet.methods)).every(method => ['eth_accounts', 'eth_chainId'].includes(method)), 'Analytics adds no wallet prompt or transaction');
    await page.close();
    console.log(`Actual Genesis port: ${player === excluded ? 'owner excluded' : 'verified identity and natural completion tracked once'}; no signing.`);
  }
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await built?.close(); await rm(outdir, { recursive: true, force: true });
}
