import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeFunctionResult, encodeEventTopics, parseAbi, zeroAddress } from 'viem';
import { buildRushSite, createRushSiteServer } from './rush-site.mjs';

// Wallet/RPC fixtures are confined to this test. The shipped host always verifies live ownership.
const account = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const tba = '0x3333333333333333333333333333333333333333';
const contract = '0x116EaA62241751E0c98dA43d458600c6C17cD361';
const rpc = 'https://rpc.mainnet.chain.robinhood.com';
const abi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenBoundAccount(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);
const portrait = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="white"/><path fill="black" d="M1 1h6v6H1zM2 2v1h1V2zm3 0v1h1V2zM3 4v1h2V4z" fill-rule="evenodd"/></svg>').toString('base64');
const uri = 'data:application/json;base64,' + Buffer.from(JSON.stringify({ name: 'Genesis #1', image: portrait })).toString('base64');
const transfer = {
  address: contract, topics: encodeEventTopics({ abi, eventName: 'Transfer', args: { from: zeroAddress, to: account, tokenId: 1n } }),
  data: '0x', blockNumber: '0x100', blockHash: '0x' + 'ab'.repeat(32), transactionHash: '0x' + 'cd'.repeat(32),
  transactionIndex: '0x0', logIndex: '0x0', removed: false,
};
const outdir = await mkdtemp(path.join(tmpdir(), 'rare-rush-genesis-'));
await mkdir('artifacts', { recursive: true });
let built, server, browser;
try {
  built = await buildRushSite({ outdir });
  server = createRushSiteServer(outdir);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  async function fixture(width = 1100, height = 820, chainId = '0x1237') {
    const page = await browser.newPage({ viewport: { width, height } });
    const state = { owner: account, ownerReads: 0, requests: [], errors: [], unexpected: [], ownerGate: null, ownerDelayAt: 0, failed: false };
    page.on('pageerror', error => state.errors.push(error.message));
    await page.addInitScript(({ account, chainId }) => {
      if (window.parent !== window) return;
      let current = account, chain = chainId;
      const listeners = new Map(), methods = [];
      const emit = (name, data) => [...(listeners.get(name) ?? [])].forEach(fn => fn(data));
      window.ethereum = {
        on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
        removeListener(name, fn) { listeners.get(name)?.delete(fn); },
        async request({ method, params }) {
          methods.push(method);
          if (method === 'eth_accounts' || method === 'eth_requestAccounts') return current ? [current] : [];
          if (method === 'eth_chainId') return chain;
          if (method === 'wallet_switchEthereumChain') { chain = params[0].chainId; emit('chainChanged', chain); return null; }
          throw new Error(`Unexpected wallet method: ${method}`);
        },
      };
      window.testWallet = { methods, change(next) { current = next; emit('accountsChanged', next ? [next] : []); }, disconnect() { emit('disconnect', {}); } };
    }, { account, chainId });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin || url.protocol === 'data:') return route.continue();
      if (url.origin !== rpc) { state.unexpected.push(url.href); return route.abort(); }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
      const call = route.request().postDataJSON();
      state.requests.push(call);
      let result;
      if (call.method === 'eth_chainId') result = '0x1237';
      else if (call.method === 'eth_blockNumber') result = '0x100';
      else if (call.method === 'eth_getLogs') result = call.params[0].topics[2]?.toLowerCase().endsWith(account.slice(2)) ? [transfer] : [];
      else if (call.method === 'eth_call') {
        assert.equal(call.params[0].to.toLowerCase(), contract.toLowerCase(), 'Only the canonical Genesis contract is read');
        const decoded = decodeFunctionData({ abi, data: call.params[0].data });
        if (decoded.functionName === 'ownerOf') {
          state.ownerReads++;
          if (state.ownerDelayAt === state.ownerReads) await new Promise(resolve => setTimeout(resolve, 11_000));
          if (state.ownerGate) await state.ownerGate;
        }
        if (state.failed) return route.fulfill({ json: { jsonrpc: '2.0', id: call.id, error: { code: -32603, message: 'Test RPC unavailable' } }, headers: { 'access-control-allow-origin': '*' } });
        const value = { balanceOf: decoded.args[0].toString().toLowerCase() === state.owner.toLowerCase() ? 1n : 0n, ownerOf: state.owner, tokenBoundAccount: tba, tokenURI: uri }[decoded.functionName];
        result = encodeFunctionResult({ abi, functionName: decoded.functionName, result: value });
      } else throw new Error(`Unexpected RPC: ${call.method}`);
      return route.fulfill({ json: { jsonrpc: '2.0', id: call.id, result }, headers: { 'access-control-allow-origin': '*' } });
    });
    return { page, state, game: page.frameLocator('iframe') };
  }
  const openGame = async ({ page, game }) => {
    await page.goto(`${origin}/genesis/`);
    await page.getByRole('button', { name: /Genesis #1 FREE ENTRY/ }).click();
    await game.getByRole('button', { name: /LET’S RUSH/ }).waitFor({ timeout: 45000 });
  };
  for (const [width, height] of [[1100, 820], [390, 844], [360, 640]]) {
    const f = await fixture(width, height), { page, state, game } = f;
    await page.goto(`${origin}/arcade/`);
    assert.equal(state.requests.length, 0, 'The collection choice does not connect or fetch a wallet');
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `artifacts/genesis-${width}-collections.png`, fullPage: true });
    await page.getByRole('link', { name: /PLAY GENESIS/ }).click();
    const friendCard = page.getByRole('button', { name: /Genesis #1 FREE ENTRY/ });
    await friendCard.waitFor();
    await friendCard.scrollIntoViewIfNeeded();
    await friendCard.locator('.genesis-portrait img').waitFor();
    assert.equal(await friendCard.locator('img').getAttribute('src'), portrait, 'Picker displays the original canonical Genesis portrait');
    await page.waitForFunction(() => { const image = document.querySelector('.genesis-portrait img'); return image?.complete && image.naturalWidth > 0; });
    assert.equal(await friendCard.isEnabled(), true, 'Preview artwork does not disable Friend selection');
    await page.screenshot({ path: `artifacts/genesis-${width}-picker.png`, fullPage: true });
    await page.getByRole('button', { name: /Genesis #1 FREE ENTRY/ }).click();
    await game.getByRole('button', { name: /LET’S RUSH/ }).waitFor();
    assert.equal(await game.locator('.rare-rush').getAttribute('data-collection'), 'genesis');
    assert.equal(await game.locator('[data-genesis-art]').first().getAttribute('href'), portrait);
    assert.equal(await page.locator('iframe').evaluate(el => el.contentDocument === null), true, 'Child has an opaque origin');
    assert.equal(await game.locator('body').evaluate(() => typeof window.ethereum), 'undefined', 'No wallet reaches the game sandbox');
    assert(await game.locator('body').evaluate(() => { try { localStorage.getItem('test'); return false; } catch { return true; } }));
    assert(await game.locator('h1').evaluate(async () => { await document.fonts.ready; return [...document.fonts].some(f => f.family === 'Silkscreen' && f.status === 'loaded'); }), 'Fonts load under opaque-origin CORS');
    const gameBack = game.getByRole('button', { name: 'Back to Friend selection', exact: true });
    const home = game.getByRole('button', { name: 'Rare Rush home', exact: true });
    for (const control of [gameBack, home]) {
      const bounds = await control.boundingBox();
      assert(bounds && bounds.width >= 44 && bounds.height >= 44, 'Genesis arcade navigation has usable touch targets');
    }
    const beforeBackMethods = await page.evaluate(() => [...window.testWallet.methods]);
    await gameBack.click();
    await page.locator('iframe').waitFor({ state: 'detached' });
    await friendCard.waitFor();
    assert.equal(page.url(), `${origin}/genesis/`, 'Arcade BACK restores the Genesis NFT selector');
    assert.equal(await friendCard.locator('img').getAttribute('src'), portrait, 'Returning preserves the original NFT portrait');
    assert.deepEqual(await page.evaluate(() => window.testWallet.methods), beforeBackMethods, 'Returning to the Genesis selector never reconnects the wallet');
    await page.screenshot({ path: `artifacts/genesis-${width}-back-to-friends.png`, fullPage: true });
    const beforeReselect = state.ownerReads;
    await friendCard.click();
    await game.getByRole('button', { name: /LET’S RUSH/ }).waitFor();
    assert(state.ownerReads > beforeReselect, 'Reselecting Genesis performs fresh ownership checks');
    for (const [mode, reward] of [['Easy', '750'], ['Degen', '2,000'], ['Normal', '1,000']]) {
      await game.getByRole('button', { name: `${mode} difficulty` }).click();
      assert.equal(await game.locator('.economy-bar b').innerText(), reward);
    }
    assert.match(await game.locator('.entry-note').innerText(), /FREE ENTRY/);
    assert.equal(await game.locator('.rare-rush').evaluate(el => el.scrollWidth > el.clientWidth), false);
    assert(await game.locator('.start-card').evaluate(el => el.getBoundingClientRect().bottom <= document.querySelector('.arcade-bottom').getBoundingClientRect().top));
    await page.screenshot({ path: `artifacts/genesis-${width}-ready.png` });
    const beforeStart = state.ownerReads;
    await game.getByRole('button', { name: /LET’S RUSH/ }).click();
    await game.locator('[data-screen="running"]').waitFor();
    assert(state.ownerReads > beforeStart, 'Every run rechecks current ownership');
    await page.waitForTimeout(1500);
    await game.getByRole('button', { name: 'Pause game' }).click();
    const coins = Number((await game.locator('.run-score small').innerText()).match(/^\d+/)[0]);
    assert(coins > 0, 'Real game loop collects opening coins');
    assert.equal(Number((await game.locator('.token-hud strong').innerText()).replaceAll(',', '').replace('✦', '')), coins * 1000);
    await game.getByRole('button', { name: /TOKEN LAB/ }).click();
    const values = await game.locator('.ledger > div').evaluateAll(rows => Object.fromEntries(rows.map(row => [row.querySelector('dt').textContent, row.querySelector('dd').textContent])));
    assert.equal(values['Your demo RF'], '100', 'Genesis entry does not debit RF');
    assert.equal(values['Demo RF prize pool'], '0', 'Free entry does not invent a pool contribution');
    await game.getByRole('button', { name: 'Close TOKEN LAB · SIMULATION', exact: true }).click();
    await game.getByRole('button', { name: /KEEP RUNNING/ }).click();
    await page.screenshot({ path: `artifacts/genesis-${width}-running.png` });
    await page.getByRole('button', { name: 'CHANGE FRIEND', exact: true }).click();
    assert.equal(await page.locator('iframe').count(), 0);
    assert((await page.evaluate(() => window.testWallet.methods)).every(method => ['eth_accounts', 'eth_chainId'].includes(method)), 'Gameplay never asks for signatures or transactions');
    await friendCard.click();
    await game.getByRole('button', { name: /LET’S RUSH/ }).waitFor();
    await home.click();
    await page.waitForURL(`${origin}/`);
    assert.equal(await page.locator('iframe').count(), 0, 'Genesis arcade logo navigates the top-level page home');
    await page.getByRole('link', { name: /PLAY WITH YOUR FRIEND/i }).waitFor();
    assert.deepEqual(state.errors, []); assert.deepEqual(state.unexpected, []);
    await page.close();
    console.log(`${width}px: verified Genesis picker, BACK/home navigation, isolated sandbox, artwork, 100× rewards, free entry and responsive layout passed`);
  }
  {
    const f = await fixture(); await openGame(f);
    f.state.owner = other;
    await f.game.getByRole('button', { name: /LET’S RUSH/ }).click();
    await f.page.getByRole('alert').filter({ hasText: 'ownership could not be confirmed' }).waitFor();
    assert.equal(await f.page.locator('iframe').count(), 0, 'A transferred Genesis cannot start a run');
    await f.page.close();
  }
  {
    const f = await fixture(); await openGame(f);
    let release; f.state.ownerGate = new Promise(resolve => { release = resolve; });
    const count = f.state.ownerReads;
    await f.game.getByRole('button', { name: /LET’S RUSH/ }).click();
    await f.page.waitForFunction(() => document.querySelector('.genesis-checking'));
    while (f.state.ownerReads === count) await new Promise(resolve => setTimeout(resolve, 20));
    f.state.owner = other;
    await f.page.evaluate(next => window.testWallet.change(next), other);
    await f.page.locator('iframe').waitFor({ state: 'detached' });
    release(); f.state.ownerGate = null;
    await f.page.waitForTimeout(250);
    assert.equal(await f.page.locator('iframe').count(), 0, 'A stale ownership response cannot restore a session after wallet change');
    await f.page.close();
  }
  {
    const f = await fixture(390, 844, '0x1');
    await f.page.goto(`${origin}/genesis/`);
    await f.page.getByRole('button', { name: /SWITCH TO ROBINHOOD/ }).waitFor();
    assert.equal(f.state.requests.length, 0, 'Wrong-network wallets never start ownership discovery');
    await f.page.getByRole('button', { name: /SWITCH TO ROBINHOOD/ }).click();
    await f.page.getByRole('button', { name: /Genesis #1 FREE ENTRY/ }).waitFor();
    await f.page.getByRole('button', { name: 'DISCONNECT', exact: true }).click();
    assert.equal(await f.page.locator('iframe').count(), 0);
    await f.page.close();
  }
  {
    const f = await fixture(); await openGame(f);
    await f.page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await f.page.locator('iframe').waitFor({ state: 'detached' });
    await f.page.getByRole('button', { name: /Genesis #1 FREE ENTRY/ }).waitFor();
    await f.page.getByRole('button', { name: /Genesis #1 FREE ENTRY/ }).click();
    await f.game.getByRole('button', { name: /LET’S RUSH/ }).waitFor();
    await f.game.getByRole('button', { name: /LET’S RUSH/ }).click();
    await f.game.locator('[data-screen="running"]').waitFor();
    await f.page.close();
  }
  {
    const f = await fixture(); f.state.ownerDelayAt = 3;
    await openGame(f);
    assert(f.state.ownerReads >= 3, 'A slow (>10s) handshake ownership check still completes');
    f.state.failed = true;
    await f.game.getByRole('button', { name: /LET’S RUSH/ }).click();
    await f.page.getByRole('alert').filter({ hasText: 'ownership could not be confirmed' }).waitFor({ timeout: 30000 });
    assert.equal(await f.page.locator('iframe').count(), 0, 'RPC failures fail closed');
    await f.page.close();
  }
  {
    const page = await browser.newPage();
    await page.goto(`${origin}/genesis/game.html`);
    await page.getByRole('heading', { name: 'ENTER THROUGH THE ARCADE' }).waitFor();
    assert.equal(await page.locator('.rare-rush').count(), 0, 'The raw child URL cannot bypass ownership');
    await page.goto(`${origin}/genesis/`);
    await page.getByText(/Open this page in your wallet’s browser/).waitFor();
    assert.equal(await page.locator('iframe').count(), 0);
    await page.close();
  }
  console.log('Ownership transfer, wallet race, wrong network, disconnect, slow RPC, RPC failure and direct-entry gates passed');
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await built?.close();
  await rm(outdir, { recursive: true, force: true });
}
