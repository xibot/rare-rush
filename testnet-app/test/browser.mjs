import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeFunctionResult, encodeFunctionData } from 'viem';
import { gameAbi, tokenAbi, nftAbi } from '../src/abi.ts';
import { CHAIN_ID, REWARD_CAP, LAUNCH_ALLOCATION, GAMEPLAY_ALLOCATION, RPC_URL } from '../src/safety.ts';

const origin = process.env.TESTNET_APP_URL ?? 'http://127.0.0.1:4176';
const browser = await chromium.launch({ headless: true });
const output = new URL('../artifacts/', import.meta.url);
await mkdir(output, { recursive: true });
const errors = [];
const address = id => `0x${id.toString(16).padStart(40, '0')}`;
const contracts = { game: address(1), rf: address(2), genesis: address(3), generations: address(4), rewardToken: address(5) };
const undeployedConfig = { version: 1, chainId: CHAIN_ID, contracts: null, deploymentConsoleUrl: null };
const configuredConfig = { ...undeployedConfig, contracts };
const fixtureBlock = '0x123456';
const fixtureTimestamp = 1_800_000_000n;

async function mockConfig(page, config = undeployedConfig) {
  await page.route('**/testnet-config.json', route => route.fulfill({ json: config }));
}

async function mockWallet(page, chain = '0xb626') {
  await page.addInitScript(chain => {
    window.mockWallet = { authorized: false, account: '0x00000000000000000000000000000000000000a1', chain, listeners: {}, writes: [], requests: [] };
    window.ethereum = {
      on(event, listener) { window.mockWallet.listeners[event] = listener; },
      async request({ method, params }) {
        window.mockWallet.requests.push(method);
        if (method === 'eth_requestAccounts') { window.mockWallet.authorized = true; return [window.mockWallet.account]; }
        if (method === 'eth_accounts') return window.mockWallet.authorized ? [window.mockWallet.account] : [];
        if (method === 'eth_chainId') return window.mockWallet.chain;
        if (method === 'wallet_switchEthereumChain') { window.mockWallet.chain = params[0].chainId; return null; }
        if (method === 'eth_sendTransaction') {
          window.mockWallet.writes.push(params[0]);
          // Exercise the wallet request without submitting any real transaction.
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
        }
        throw new Error(`Unexpected wallet method: ${method}`);
      },
    };
  }, chain);
}

async function mockRpc(page, overrides = {}) {
  const requests = [];
  const unexpected = [];
  const minted = 2_070_000_000n;
  const values = {
    game: { rf: contracts.rf, genesis: contracts.genesis, generations: contracts.generations, token: contracts.rewardToken,
      ENTRY_FEE: 110n * 10n ** 18n, PRIZE_POOL_SHARE: 100n * 10n ** 18n, TREASURY_SHARE: 10n * 10n ** 18n,
      MAX_DAILY_RUNS: 3n, expectedLaunchAllocation: LAUNCH_ALLOCATION, INITIAL_COIN_REWARD: 10_000_000n, MIN_COIN_REWARD: 1_000_000n, HALVING_INTERVAL: 10_000n },
    rf: { FAUCET_AMOUNT: 1100n * 10n ** 18n, balanceOf: 220n * 10n ** 18n, lastFaucetDayPlusOne: 0n },
    genesis: { isGenesis: true, balanceOf: 2n },
    generations: { isGenesis: false, balanceOf: 3n },
    rewardToken: { CAP: REWARD_CAP, rewardMinter: contracts.game, decimals: 6, launchAllocation: LAUNCH_ALLOCATION,
      rewardAllocation: GAMEPLAY_ALLOCATION, rewardsMinted: minted, totalSupply: LAUNCH_ALLOCATION + minted, balanceOf: minted },
  };
  for (const [key, value] of Object.entries(overrides)) Object.assign(values[key], value);
  function respond(item) {
    requests.push(item);
    try {
      let result;
      if (item.method === 'eth_chainId') result = '0xb626';
      else if (item.method === 'eth_blockNumber') result = fixtureBlock;
      else if (item.method === 'eth_getCode') result = '0x6001600055';
      else if (item.method === 'eth_getBalance') result = '0x2386f26fc10000';
      else if (item.method === 'eth_getBlockByNumber') result = { number: fixtureBlock, timestamp: `0x${fixtureTimestamp.toString(16)}`, transactions: [] };
      else if (item.method === 'eth_call') {
        const key = Object.keys(contracts).find(key => contracts[key].toLowerCase() === item.params[0].to.toLowerCase());
        assert.ok(key, `Unknown contract ${item.params[0].to}`);
        const abi = key === 'game' ? gameAbi : ['genesis', 'generations'].includes(key) ? nftAbi : tokenAbi;
        const { functionName } = decodeFunctionData({ abi, data: item.params[0].data });
        assert.ok(functionName in values[key], `Unexpected ${key}.${functionName}`);
        result = encodeFunctionResult({ abi, functionName, result: values[key][functionName] });
      } else throw new Error(`Unexpected RPC method: ${item.method}`);
      return { jsonrpc: '2.0', id: item.id, result };
    } catch (error) {
      unexpected.push(error.message);
      return { jsonrpc: '2.0', id: item.id, error: { code: -32603, message: error.message } };
    }
  }
  await page.route(`${RPC_URL}/**`, route => {
    const request = route.request().postDataJSON();
    return route.fulfill({ json: Array.isArray(request) ? request.map(respond) : respond(request) });
  });
  return { requests, unexpected };
}

async function expectActions(page, enabled) {
  for (const id of ['claim-rf', 'mint-genesis', 'mint-generations']) {
    await page.locator(`#${id}${enabled ? ':enabled' : ':disabled'}`).waitFor();
  }
}

async function isolatedContext(options = {}) {
  const context = await browser.newContext(options);
  // Fail closed: only the local app and explicitly intercepted RPC fixtures are reachable.
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(origin).origin ? route.continue() : route.abort());
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  return context;
}

try {
  const context = await isolatedContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 1080 });
  await mockConfig(page);
  await page.goto(origin);
  await page.getByText('CONTRACTS AWAITING DEPLOYMENT', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'DASHBOARD', exact: true }).getAttribute('href'), '/dashboard/');
  assert.equal(await page.getByRole('link', { name: 'PLAY TESTNET', exact: false }).first().getAttribute('href'), '/play/');
  assert.equal(await page.getByRole('link', { name: /ARCADE/ }).count(), 0, 'test kit navigation must stay in the testnet flow');
  assert.equal(await page.locator('#claim-rf').isDisabled(), true);
  assert.equal(await page.locator('#mint-genesis').isDisabled(), true);
  assert.equal(await page.locator('#mint-generations').isDisabled(), true);
  assert.equal(await page.getByRole('link', { name: 'GET TEST ETH' }).getAttribute('href'), 'https://faucet.testnet.chain.robinhood.com');
  await page.screenshot({ path: fileURLToPath(new URL('desktop.png', output)), fullPage: true });
  await page.locator('#connect').click();
  await page.getByText('Open this page in a wallet browser, or install a browser wallet, then connect.').waitFor();

  const mobileContext = await isolatedContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
  const mobile = await mobileContext.newPage();
  await mockConfig(mobile);
  await mobile.goto(origin);
  await mobile.getByText('CONTRACTS AWAITING DEPLOYMENT', { exact: true }).waitFor();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile must not overflow');
  await mobile.screenshot({ path: fileURLToPath(new URL('mobile.png', output)), fullPage: true });
  await mobileContext.close();

  const wallet = await context.newPage();
  await wallet.setViewportSize({ width: 1280, height: 900 });
  await mockConfig(wallet);
  await mockWallet(wallet, '0x1237');
  await mockRpc(wallet);
  await wallet.goto(origin);
  await wallet.locator('#connect').click();
  await wallet.locator('#switch-network').waitFor();
  assert.equal(await wallet.locator('#mint-genesis').isDisabled(), true);
  await wallet.locator('#switch-network').click();
  await wallet.getByText('Connected to Robinhood testnet.', { exact: true }).waitFor();
  assert.equal(await wallet.locator('#claim-rf').isDisabled(), true, 'network match cannot bypass absent contracts');
  assert.equal(await wallet.evaluate(() => window.mockWallet.writes.length), 0);
  await wallet.locator('#disconnect').click();
  await wallet.evaluate(() => window.mockWallet.listeners.accountsChanged(['0x00000000000000000000000000000000000000a2']));
  await wallet.locator('#connect').waitFor();
  assert.equal(await wallet.locator('#disconnect').count(), 0, 'wallet event must not reconnect after local disconnect');
  await wallet.close();

  const invalid = await context.newPage();
  await mockConfig(invalid, { ...undeployedConfig, chainId: 4663 });
  await invalid.goto(origin);
  await invalid.getByText('This app only supports Robinhood testnet (46630).', { exact: true }).waitFor();
  assert.equal(await invalid.locator('#claim-rf').isDisabled(), true);
  assert.equal(await invalid.locator('#mint-genesis').isDisabled(), true);
  await invalid.close();

  const ready = await context.newPage();
  await mockConfig(ready, configuredConfig);
  await mockWallet(ready);
  const rpc = await mockRpc(ready);
  await ready.goto(origin);
  await ready.getByText('TEST CONTRACTS VERIFIED', { exact: true }).waitFor();
  await expectActions(ready, false);
  await ready.locator('#connect').click();
  await expectActions(ready, true);
  assert.match(await ready.locator('.balance-row').innerText(), /2,070/);
  assert.match(await ready.locator('.kit-card').last().innerText(), /2 GENESIS · 3 GENERATIONS/);
  const pinnedReads = rpc.requests.filter(item => item.method === 'eth_getCode' || item.method === 'eth_call' && !['balanceOf', 'lastFaucetDayPlusOne'].some(functionName => item.params[0].data.startsWith(encodeFunctionData({ abi: tokenAbi, functionName, args: [address(0xa1)] }).slice(0, 10))));
  assert.ok(pinnedReads.length >= 27, 'contract code and economy checks must run');
  for (const item of pinnedReads) assert.equal(item.params[1], fixtureBlock, `${item.method} verification must use the pinned block`);
  const checkedData = new Set(rpc.requests.filter(item => item.method === 'eth_call').map(item => item.params[0].data));
  for (const [abi, functionName] of [[tokenAbi, 'rewardMinter'], [tokenAbi, 'launchAllocation'], [tokenAbi, 'rewardAllocation'], [tokenAbi, 'rewardsMinted'], [tokenAbi, 'totalSupply'], [gameAbi, 'expectedLaunchAllocation'], [gameAbi, 'MIN_COIN_REWARD']]) {
    assert.ok(checkedData.has(encodeFunctionData({ abi, functionName })), `${functionName} must be checked before actions are enabled`);
  }
  for (const [button, contract, abi, functionName] of [
    ['claim-rf', contracts.rf, tokenAbi, 'faucet'],
    ['mint-genesis', contracts.genesis, nftAbi, 'mint'],
    ['mint-generations', contracts.generations, nftAbi, 'mint'],
  ]) {
    await ready.locator(`#${button}`).click();
    await ready.locator('#feedback').filter({ hasText: 'Request declined.' }).waitFor();
    await expectActions(ready, true);
    const request = await ready.evaluate(() => window.mockWallet.writes.at(-1));
    assert.equal(request.to.toLowerCase(), contract);
    assert.equal(request.from.toLowerCase(), address(0xa1));
    assert.equal(request.data, encodeFunctionData({ abi, functionName }));
  }
  assert.equal(await ready.evaluate(() => window.mockWallet.writes.length), 3, 'each button makes exactly one mocked wallet request');
  assert.deepEqual(rpc.unexpected, []);
  await ready.setViewportSize({ width: 1440, height: 1080 });
  await ready.screenshot({ path: fileURLToPath(new URL('configured-desktop.png', output)), fullPage: true });
  await ready.setViewportSize({ width: 390, height: 844 });
  assert.equal(await ready.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'configured contract addresses must not overflow on mobile');
  await ready.screenshot({ path: fileURLToPath(new URL('configured-mobile.png', output)), fullPage: true });
  await ready.close();

  for (const overrides of [
    { rewardToken: { rewardMinter: address(9) } },
    { rewardToken: { totalSupply: LAUNCH_ALLOCATION } },
    { game: { MIN_COIN_REWARD: 0n } },
  ]) {
    const mismatch = await context.newPage();
    await mockConfig(mismatch, configuredConfig);
    await mockWallet(mismatch);
    const mismatchRpc = await mockRpc(mismatch, overrides);
    await mismatch.goto(origin);
    await mismatch.getByText('CONTRACT CHECKS INCOMPLETE', { exact: true }).waitFor();
    await mismatch.locator('#connect').click();
    await mismatch.locator('#feedback').filter({ hasText: 'reward token or test emission settings do not match' }).waitFor();
    await expectActions(mismatch, false);
    assert.equal(await mismatch.evaluate(() => window.mockWallet.writes.length), 0);
    assert.deepEqual(mismatchRpc.unexpected, []);
    await mismatch.close();
  }

  const cooldown = await context.newPage();
  await mockConfig(cooldown, configuredConfig);
  await mockWallet(cooldown);
  const cooldownRpc = await mockRpc(cooldown, { rf: { lastFaucetDayPlusOne: fixtureTimestamp / 86_400n + 1n } });
  await cooldown.goto(origin);
  await cooldown.getByText('TEST CONTRACTS VERIFIED', { exact: true }).waitFor();
  await cooldown.locator('#connect').click();
  await cooldown.locator('#mint-genesis:enabled').waitFor();
  assert.equal(await cooldown.locator('#claim-rf').isDisabled(), true);
  assert.equal(await cooldown.locator('#mint-generations').isEnabled(), true);
  await cooldown.getByText('CLAIMED TODAY · RESETS AT 00:00 UTC', { exact: true }).waitFor();
  assert.deepEqual(cooldownRpc.unexpected, []);
  await cooldown.close();
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: undeployed gating, desktop/mobile layout, no-wallet guidance, network switch, disconnect isolation, mainnet rejection, configured action enablement, pinned-block economy checks, mocked faucet/NFT wallet requests, invalid minter/supply/emissions rejection, daily RF cooldown, no runtime errors. All RPC and wallet actions were mocked.');
} finally { await browser.close(); }
