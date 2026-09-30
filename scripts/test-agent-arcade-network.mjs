import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeFunctionData } from 'viem';
import { FAMILIES_REGISTRY_ABI } from '@rarefriends/friendsdk/sprites';
import { buildRushSite, createRushSiteServer } from './rush-site.mjs';
import { installMainnetFixture, createArtworkFixture } from './mainnet-browser-fixture.mjs';

// Exercise the shipped Agent Play page with a wallet left on Testnet. All
// assets come from the local build; all chain responses are isolated fixtures.
const origin = 'https://rarerush.app';
const owner = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const outdir = await mkdtemp(path.join(tmpdir(), 'rush-agent-network-'));
let built, server, browser, fixture;
try {
  built = await buildRushSite({ outdir }); server = createRushSiteServer(outdir);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: process.env.RUSH_BROWSER_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const artwork = await createArtworkFixture();
  fixture = await installMainnetFixture(page, origin, { artworkCall: call => {
    const { functionName, args } = decodeFunctionData({ abi: FAMILIES_REGISTRY_ABI, data: call.data });
    // Both isolated wallet fixtures may use the same recorded cosmetic frames.
    if (['familyOf', 'seedOf'].includes(functionName) && args[0] === 3412n) {
      return artwork({ ...call, data: encodeFunctionData({ abi: FAMILIES_REGISTRY_ABI, functionName, args: [7730n] }) });
    }
    return artwork(call);
  }, initialChain: '0xb626' });
  await page.route(`${origin}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/mainnet-rpc') return route.fallback();
    if (url.pathname === '/api/runs') return route.fulfill({ json: { runs: [], nextCursor: null } });
    if (url.pathname === '/api/status') return route.fulfill({ json: { ready: false } });
    assert.ok(!url.pathname.startsWith('/api/'), `Unexpected API request: ${url.pathname}`);
    return route.fulfill({ response: await route.fetch({ url: new URL(url.pathname + url.search, local).href }) });
  });
  await page.goto(`${origin}/agent-play/`);
  await page.locator('.sources button').filter({ hasText: 'ARCADE' }).click();
  await page.locator('.collections button').filter({ hasText: 'GENERATIONS' }).click();
  await page.getByRole('button', { name: 'CONNECT WALLET', exact: true }).click();
  const switchButton = page.getByRole('button', { name: 'SWITCH TO ROBINHOOD ↗', exact: true });
  await switchButton.waitFor();
  assert.equal(await page.locator('.arcade-friend-picker').count(), 0);
  assert.equal(fixture.requests.length, 0, 'Wrong-network state does not launch doomed NFT reads');
  assert.equal(await page.getByText('Could not load your Friends.', { exact: false }).count(), 0);
  await page.evaluate(() => { window.__friendWalletTest.state.switchError = 4001; });
  await switchButton.click();
  await page.getByText('Network switch declined. Try again when ready.', { exact: true }).waitFor();
  assert.equal(await switchButton.isEnabled(), true, 'A declined switch can be retried');
  await page.evaluate(() => { window.__friendWalletTest.state.switchError = null; });
  await switchButton.click();
  const choice = page.locator('.arcade-friend-card').filter({ hasText: 'Generations #7730' });
  await choice.waitFor();
  assert.equal(await switchButton.count(), 0);
  assert.equal(await page.getByText('Network switch declined. Try again when ready.', { exact: true }).count(), 0);
  await choice.click();
  await page.getByRole('button', { name: /WATCH AGENT PLAY/ }).click();
  await page.locator('.agent-stage[data-running="true"]').waitFor();
  assert.equal((await page.evaluate(() => window.__friendWalletTest.state.requests)).filter(method => method === 'eth_requestAccounts').length, 1,
    'The network switch recovers without reconnecting the wallet');

  await page.evaluate(() => window.__friendWalletTest.chain('0xb626'));
  await page.locator('.agent-stage[data-running="false"]').waitFor();
  await page.getByRole('button', { name: 'EXIT RUN', exact: true }).click();
  await switchButton.waitFor();
  assert.equal(await page.locator('.arcade-selected-friend').count(), 0, 'Network changes invalidate the selected identity');
  await page.evaluate(() => window.__friendWalletTest.chain('0x1237'));
  await choice.waitFor();
  await choice.click();
  await page.evaluate(other => window.__friendWalletTest.accounts([other]), other);
  await page.locator('.arcade-friend-card').filter({ hasText: 'Generations #3412' }).waitFor();
  assert.equal(await choice.count(), 0, 'Old account cards disappear');
  assert.equal(await page.locator('.arcade-selected-friend').count(), 0, 'Account changes invalidate the selected identity');
  await page.evaluate(owner => window.__friendWalletTest.accounts([owner]), owner);
  await choice.waitFor();

  // A late response from the previous network cannot repopulate the picker.
  fixture.mode = 'loading';
  fixture.hold = new Promise(resolve => { fixture.release = resolve; });
  await page.locator('.arcade-friend-picker').getByRole('button', { name: 'REFRESH ↻' }).click();
  await page.getByText('Finding your Friends…', { exact: true }).waitFor();
  await page.evaluate(() => window.__friendWalletTest.chain('0xb626'));
  await switchButton.waitFor();
  fixture.mode = 'eligible'; fixture.release();
  assert.equal(await page.locator('.arcade-friend-card').count(), 0);
  await page.evaluate(() => window.__friendWalletTest.chain('0x1237'));
  await choice.waitFor();
  const methods = await page.evaluate(() => window.__friendWalletTest.state.requests);
  assert.ok(methods.every(method => ['eth_accounts', 'eth_requestAccounts', 'eth_chainId', 'wallet_switchEthereumChain'].includes(method)),
    'Wallet supplies only connection and network control; all NFT reads use the private server route');
  assert.deepEqual(errors, []);
  assert.deepEqual(fixture.errors, []);
  console.log('Agent Arcade: Testnet network, declined/retried switch, automatic grid recovery, real run start, manual network/account invalidation and late-response cancellation passed.');
} finally {
  fixture?.release?.();
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await built?.close(); await rm(outdir, { recursive: true, force: true });
}
