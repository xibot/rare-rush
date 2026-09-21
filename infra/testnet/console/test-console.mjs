import assert from 'node:assert/strict';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeFunctionResult, encodeFunctionData } from 'viem';
import { economics } from '../src/deployment-config.mjs';

const base = process.env.RUSH_CONSOLE_URL ?? 'http://127.0.0.1:4174';
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Console tests must use a loopback URL');
const owner = '0x6fd155b9d52f80e8a73a8a2537268602978486e2';
const deploymentConfig = await (await fetch(base + '/config.json')).json();
const gameArtifact = JSON.parse(await readFile(new URL('../artifacts/RareRushGame.json', import.meta.url)));
const tokenArtifact = JSON.parse(await readFile(new URL('../artifacts/RareRushToken.json', import.meta.url)));
const addressFor = index => '0x' + (4097 + index).toString(16).padStart(40, '0');
const hashFor = index => '0x' + index.toString(16).padStart(64, '0');
const blockHash = '0x' + 'b'.repeat(64);
const ZERO = '0x' + '0'.repeat(40);
const browser = await chromium.launch({ headless: true });
let count = 0;
const successfulModes = ['success', 'wrong-treasury', 'wrong-cap', 'wrong-split', 'wrong-allocation', 'wrong-minter', 'wrong-bound-token', 'wrong-bind-data', 'wrong-bind-destination', 'wrong-bind-sender', 'cancelled-bind', 'recover-hash', 'one-confirmation', 'wallet-changes-before-send', 'two-tab-checkpoint'];
async function scenario(mode, run, rpcChain = '0xb626') {
  if (process.env.RUSH_CONSOLE_SCENARIO && process.env.RUSH_CONSOLE_SCENARIO !== mode) return;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await context.route('https://rpc.testnet.chain.robinhood.com/**', async route => {
    const body = route.request().postDataJSON();
    const fixture = await route.request().frame().page().evaluate(() => ({ transactions: window.__transactions ?? [], confirmations: window.__confirmations ?? 2, rpcMode: window.__walletMode }));
    const transactions = fixture.transactions;
    const resultFor = request => {
      const index = transactions.findIndex(value => value.hash === request.params?.[0]);
      if (request.method === 'eth_blockNumber') return fixture.confirmations >= 2 ? '0x65' : '0x64';
      if (request.method === 'eth_getCode') return '0x60006000f3';
      if (request.method === 'eth_getTransactionReceipt' && index >= 0) return {
        transactionHash: transactions[index].hash, transactionIndex: '0x0', blockHash, blockNumber: '0x64',
        from: owner, to: transactions[index].to ?? null, cumulativeGasUsed: '0x186a0', gasUsed: '0x186a0', effectiveGasPrice: '0x3b9aca00',
        contractAddress: index === 5 ? null : addressFor(index), logs: [], logsBloom: '0x' + '0'.repeat(512), status: '0x1', type: '0x0',
      };
      if (request.method === 'eth_getTransactionByHash' && index >= 0) {
        let to = transactions[index].to ?? null, from = owner, input = transactions[index].data;
        if (index === 5) {
          if (mode === 'wrong-bind-destination') to = addressFor(9);
          if (mode === 'wrong-bind-sender') from = addressFor(9);
          if (mode === 'wrong-bind-data') input = encodeFunctionData({ abi: gameArtifact.abi, functionName: 'bindRewardToken', args: [addressFor(9)] });
          if (mode === 'cancelled-bind') { to = owner; input = '0x'; }
        }
        return { hash: transactions[index].hash, from, to, input,
          nonce: '0x' + index.toString(16), blockHash, blockNumber: '0x64', transactionIndex: '0x0',
          value: '0x0', gas: '0x7a120', gasPrice: '0x3b9aca00', type: '0x0', v: '0x1b', r: '0x1', s: '0x1' };
      }
      if (request.method === 'eth_call') {
        const call = request.params[0], abi = call.to.toLowerCase() === addressFor(4) ? tokenArtifact.abi : gameArtifact.abi;
        const { functionName } = decodeFunctionData({ abi, data: call.data });
        const values = { owner, treasury: deploymentConfig.treasury, verifier: deploymentConfig.verifier, engineVersion: deploymentConfig.engineVersion,
          ENTRY_FEE: 110n * 10n ** 18n, PRIZE_POOL_SHARE: 100n * 10n ** 18n, TREASURY_SHARE: 10n * 10n ** 18n, CAP: 1_024_000_000n * 1_000_000n,
          token: transactions.length >= 6 ? addressFor(4) : ZERO, rf: addressFor(0), genesis: addressFor(1), generations: addressFor(2), rewardMinter: addressFor(3),
          launchAllocation: 102_400_000_000_000n, expectedLaunchAllocation: 102_400_000_000_000n, rewardAllocation: 921_600_000_000_000n, decimals: 6,
          MAX_DAILY_RUNS: 3n, INITIAL_COIN_REWARD: 10_000_000n, MIN_COIN_REWARD: 1_000_000n, HALVING_INTERVAL: 10_000n };
        if (mode === 'wrong-treasury') values.treasury = addressFor(9);
        if (mode === 'wrong-cap') values.CAP = 200_000n * 1_000_000n;
        if (mode === 'wrong-split') values.PRIZE_POOL_SHARE = 110n * 10n ** 18n;
        if (mode === 'wrong-allocation') values.rewardAllocation--;
        if (mode === 'wrong-minter') values.rewardMinter = addressFor(9);
        if (mode === 'wrong-bound-token' && transactions.length >= 6) values.token = addressFor(9);
        return encodeFunctionResult({ abi, functionName, result: values[functionName] });
      }
      return ({ eth_chainId: rpcChain, eth_getBalance: '0x8ac7230489e80000', eth_estimateGas: '0x7a120', eth_gasPrice: '0x3b9aca00' })[request.method] ?? '0x';
    };
    const respond = request => ({ jsonrpc: '2.0', id: request.id,
      ...(request.method === 'eth_getTransactionReceipt' && !transactions.some(tx => tx.hash === request.params?.[0])
        ? { error: { code: -32000, message: 'Transaction receipt not found' } } : { result: resultFor(request) }) });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? body.map(respond) : respond(body)) });
  });
  await context.addInitScript(({ mode, owner, successfulModes }) => {
    window.__walletMode = mode; window.__walletCalls = []; window.__transactions = JSON.parse(sessionStorage.getItem('mock-txs') ?? '[]'); window.__confirmations = 2;
    window.__walletAccount = mode === 'wrong-account' ? '0x1111111111111111111111111111111111111111' : owner;
    window.__walletChain = mode === 'wrong-chain' ? '0x1' : '0xb626';
    window.__accountReads = 0;
    window.ethereum = { on() {}, async request({ method, params }) {
      window.__walletCalls.push(method);
      if (method === 'eth_requestAccounts') {
        if (window.__walletMode === 'declined-connect') throw Object.assign(new Error('User rejected'), { code: 4001 });
        return [window.__walletAccount];
      }
      if (method === 'eth_accounts') {
        window.__accountReads++;
        if (window.__walletMode === 'wallet-changes-before-send' && window.__accountReads >= 3) return ['0x1111111111111111111111111111111111111111'];
        return [window.__walletAccount];
      }
      if (method === 'eth_chainId') return window.__walletChain;
      if (method === 'wallet_switchEthereumChain') { window.__walletChain = '0xb626'; return null; }
      if (method === 'eth_sendTransaction') {
        if (successfulModes.includes(window.__walletMode)) {
          const hash = '0x' + (window.__transactions.length + 1).toString(16).padStart(64, '0');
          window.__transactions.push({ hash, data: params[0].data, to: params[0].to }); sessionStorage.setItem('mock-txs', JSON.stringify(window.__transactions));
          if (window.__walletMode === 'recover-hash' && window.__transactions.length === 1) throw new Error('Wallet connection interrupted after sending');
          return hash;
        }
        if (window.__walletMode === 'ambiguous-send') throw new Error('Wallet connection interrupted');
        throw Object.assign(new Error('User rejected transaction'), { code: 4001 });
      }
      throw new Error(`Unexpected mocked wallet request: ${method}`);
    }};
  }, { mode, owner, successfulModes });
  try {
    await page.goto(base); await run(page);
    assert.deepEqual(errors, [], 'No browser exceptions');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No mobile overflow');
    count++; console.log(`PASS ${mode}`);
  } catch (error) { console.error(mode, await page.locator('#wallet-status').textContent(), await page.evaluate(() => ({ transactionCount: window.__transactions.length, calls: window.__walletCalls }))); throw error; } finally { await context.close(); }
}
const firstDeploy = page => page.getByRole('button', { name: 'DEPLOY TEST RF ↗', exact: true });
const connected = async page => { await page.getByRole('button', { name: 'CONNECT WALLET ↗', exact: true }).click(); await page.waitForFunction(() => document.getElementById('wallet-status').textContent.includes('Correct wallet and network')); };
const buttons = ['DEPLOY TEST RF ↗', 'DEPLOY TEST GENESIS ↗', 'DEPLOY TEST GENERATIONS ↗', 'DEPLOY RARE RUSH GAME ↗', 'DEPLOY REWARD TOKEN ↗', 'BIND REWARD TOKEN ↗'];
const operationIds = ['rf', 'genesis', 'generations', 'game', 'rewardToken', 'bind'];
const through = async (page, length = 6) => { for (const [index, name] of buttons.slice(0, length).entries()) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.waitForFunction(id => { const record = JSON.parse(localStorage.getItem(Object.keys(localStorage)[0])).deployments[id];
    return record && (record.status === 'confirmed' || record.error) && !document.getElementById('refresh').disabled;
  }, operationIds[index]);
} };
try {
  const main = await fetch(base); assert.equal(main.status, 200); assert.match(main.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  for (const path of ['/operator-config.json', '/.env', '/.env.testnet', '/signer.key', '/..%2Foperator-config.json', '/artifacts/../operator-config.json', '/console/app.js']) assert.equal((await fetch(base + path)).status, 404, `Private/unlisted path blocked: ${path}`);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  assert.equal((await fetch(base, { headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal(await new Promise((resolve, reject) => { const req = request(base, { headers: { Host: 'example.com' } }, response => { response.resume(); resolve(response.statusCode); }); req.on('error', reject); req.end(); }), 403);
  assert.deepEqual(Object.keys(deploymentConfig).sort(), ['chainId', 'engineVersion', 'launchAllocation', 'launchRecipient', 'owner', 'treasury', 'verifier']); count++;
  await scenario('declined-connect', async page => {
    await page.waitForFunction(() => !document.getElementById('connect').disabled); assert.deepEqual(await page.evaluate(() => window.__walletCalls), []);
    await page.getByRole('button', { name: 'CONNECT WALLET ↗', exact: true }).click(); await page.waitForFunction(() => document.getElementById('wallet-status').textContent.includes('declined')); assert.equal(await firstDeploy(page).isDisabled(), true);
  });
  await scenario('wrong-account', async page => { await page.getByRole('button', { name: 'CONNECT WALLET ↗', exact: true }).click(); await page.waitForFunction(() => document.getElementById('wallet-status').textContent.includes('Wrong account')); assert.equal(await firstDeploy(page).isDisabled(), true); });
  await scenario('wrong-chain', async page => {
    await page.getByRole('button', { name: 'CONNECT WALLET ↗', exact: true }).click(); await page.getByRole('button', { name: 'SWITCH TO TESTNET', exact: true }).waitFor({ state: 'visible' }); assert.equal(await firstDeploy(page).isDisabled(), true);
    await page.getByRole('button', { name: 'SWITCH TO TESTNET', exact: true }).click(); await page.waitForFunction(() => document.getElementById('wallet-status').textContent.includes('Correct wallet and network')); assert.equal(await firstDeploy(page).isEnabled(), true);
  });
  await scenario('declined-send', async page => {
    await connected(page); await firstDeploy(page).click(); await page.waitForFunction(() => document.getElementById('wallet-status').textContent.includes('declined')); assert.equal(await firstDeploy(page).isEnabled(), true);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage)[0])).deployments.rf), undefined);
  });
  await scenario('ambiguous-send', async page => {
    await connected(page); await firstDeploy(page).click(); await page.getByRole('button', { name: 'VERIFY HASH', exact: true }).waitFor(); await page.reload(); await page.getByRole('button', { name: 'VERIFY HASH', exact: true }).waitFor();
    assert.equal(await firstDeploy(page).count(), 0); assert.deepEqual(await page.evaluate(() => window.__walletCalls), []);
    await page.getByRole('button', { name: 'VERIFY HASH', exact: true }).click(); await page.waitForFunction(() => document.getElementById('wallet-status').textContent.includes('complete 0x transaction hash'));
  });
  await scenario('recover-hash', async page => {
    await connected(page); await firstDeploy(page).click(); await page.getByRole('button', { name: 'VERIFY HASH', exact: true }).waitFor(); await page.reload();
    await page.locator('#hash-rf').fill(hashFor(1)); await page.getByRole('button', { name: 'VERIFY HASH', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.step-status').textContent.startsWith('VERIFIED'));
    assert.equal(await page.evaluate(() => window.__transactions.length), 1); assert.deepEqual(await page.evaluate(() => window.__walletCalls), [], 'Recovery never resends or reconnects');
  });
  await scenario('pending', async page => {
    await page.waitForFunction(() => !document.getElementById('connect').disabled); await page.evaluate(() => { const key = Object.keys(localStorage)[0], state = JSON.parse(localStorage.getItem(key)); state.deployments.rf = { status: 'pending', hash: '0x' + 'a'.repeat(64) }; localStorage.setItem(key, JSON.stringify(state)); });
    await page.reload(); await page.getByRole('button', { name: 'RESUME VERIFICATION', exact: true }).waitFor(); assert.equal(await firstDeploy(page).count(), 0); assert.deepEqual(await page.evaluate(() => window.__walletCalls), []);
  });
  for (const mode of ['artifact-mismatch', 'old-engine-history', 'empty-package-refresh']) await scenario(mode, async page => {
    await page.waitForFunction(() => !document.getElementById('connect').disabled);
    await page.evaluate(mode => { const key = Object.keys(localStorage)[0], state = JSON.parse(localStorage.getItem(key));
      if (mode !== 'empty-package-refresh') state.deployments.rf = { status: 'pending', hash: '0x' + 'a'.repeat(64) }; state.fingerprint = 'old-artifact';
      if (mode === 'old-engine-history') { localStorage.removeItem(key); localStorage.setItem(key + ':old-verifier:old-engine', JSON.stringify(state)); } else localStorage.setItem(key, JSON.stringify(state));
    }, mode); await page.reload();
    if (mode === 'empty-package-refresh') { await page.waitForFunction(() => !document.getElementById('connect').disabled); assert.deepEqual(await page.evaluate(() => window.__walletCalls), []); }
    else { await page.waitForFunction(() => document.getElementById('wallet-status').textContent.includes('preserved')); assert.equal(await page.getByRole('button', { name: 'CONNECT WALLET ↗', exact: true }).isDisabled(), true); }
  });
  await scenario('wrong-rpc', async page => { await page.waitForFunction(() => document.getElementById('wallet-status').textContent.includes('wrong chain')); assert.equal(await page.getByRole('button', { name: 'CONNECT WALLET ↗', exact: true }).isDisabled(), true); }, '0x1237');
  await scenario('wallet-changes-before-send', async page => {
    await connected(page); await firstDeploy(page).click(); await page.waitForFunction(() => document.getElementById('wallet-status').textContent.includes('required deployer'));
    assert.equal(await page.evaluate(() => window.__walletCalls.includes('eth_sendTransaction')), false);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage)[0])).deployments.rf), undefined, 'Pre-send wallet change does not create a phantom pending transaction');
    await page.evaluate(() => { window.__walletMode = 'success'; }); await connected(page); assert.equal(await firstDeploy(page).isEnabled(), true);
  });
  await scenario('success', async page => {
    await connected(page); await through(page); await page.waitForFunction(() => !document.getElementById('download').disabled);
    assert.equal((await page.evaluate(() => window.__walletCalls)).filter(value => value === 'eth_sendTransaction').length, 6);
    const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'DOWNLOAD MANIFEST ↓', exact: true }).click(); const manifest = JSON.parse(await readFile(await (await downloadPromise).path(), 'utf8'));
    assert.equal(manifest.chainId, 46630); assert.equal(manifest.game.toLowerCase(), addressFor(3)); assert.equal(manifest.rewardToken.toLowerCase(), addressFor(4)); assert.deepEqual(manifest.economics, economics); assert.equal(Object.keys(manifest.deployments).length, 6);
    assert.equal(manifest.deployments.bind.to.toLowerCase(), addressFor(3)); assert.deepEqual(manifest.deployments.bind.arguments.map(value => value.toLowerCase()), [addressFor(4)]); assert.equal(manifest.launchAllocation, '102400000000000');
    await page.setViewportSize({ width: 1440, height: 1000 }); await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true }); await page.screenshot({ path: fileURLToPath(new URL('../artifacts/console-six-operations-desktop.png', import.meta.url)), fullPage: true });
    await page.reload(); await page.waitForFunction(() => !document.getElementById('download').disabled); assert.deepEqual(await page.evaluate(() => window.__walletCalls), [], 'Complete progress verifies without wallet prompts');
  });
  await scenario('two-tab-checkpoint', async page => {
    await connected(page); await through(page, 1);
    await page.evaluate(() => { const key = Object.keys(localStorage)[0]; window.__held = false;
      window.__lockTask = navigator.locks.request(key, async () => { window.__held = true; await new Promise(resolve => { window.__releaseLock = resolve; }); });
    });
    await page.waitForFunction(() => window.__held);
    const other = await page.context().newPage();
    await other.addInitScript(transactions => { sessionStorage.setItem('mock-txs', JSON.stringify(transactions)); window.__transactions = transactions; }, await page.evaluate(() => window.__transactions));
    await other.goto(base);
    await other.waitForFunction(() => document.getElementById('wallet-status').textContent.includes('Waiting for the shared deployment lock'));
    await page.evaluate(() => { const key = Object.keys(localStorage)[0], state = JSON.parse(localStorage.getItem(key)); state.deployments.genesis = { status: 'pending', hash: '0x' + 'c'.repeat(64) }; localStorage.setItem(key, JSON.stringify(state)); window.__releaseLock(); });
    await other.getByRole('button', { name: 'RESUME VERIFICATION', exact: true }).waitFor();
    const state = await other.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage)[0])));
    assert.equal(state.deployments.genesis.hash, '0x' + 'c'.repeat(64), 'Initialization preserves the other tab pending checkpoint');
    assert.equal(await other.getByRole('button', { name: buttons[1], exact: true }).count(), 0, 'No duplicate send becomes available');
    assert.deepEqual(await other.evaluate(() => window.__walletCalls), []); await other.close();
  });
  await scenario('one-confirmation', async page => {
    await connected(page); await through(page, 1); await page.evaluate(() => { window.__confirmations = 1; }); await page.getByRole('button', { name: 'REFRESH', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('wallet-status').textContent.includes('two block confirmations')); assert.equal(await page.getByRole('button', { name: buttons[1], exact: true }).isDisabled(), true);
    await page.evaluate(() => { window.__confirmations = 2; }); await page.getByRole('button', { name: 'REFRESH', exact: true }).click(); await page.waitForFunction(name => [...document.querySelectorAll('button')].some(button => button.textContent === name && !button.disabled), buttons[1]); assert.equal(await page.getByRole('button', { name: buttons[1], exact: true }).isEnabled(), true);
  });
  for (const [mode, error, length] of [
    ['wrong-treasury', 'configuration does not match', 4], ['wrong-split', 'split does not match', 4], ['wrong-cap', 'cap or decimals', 5], ['wrong-allocation', 'allocation does not match', 5], ['wrong-minter', 'authorized minter', 5],
    ['wrong-bound-token', 'unexpected reward token', 6], ['wrong-bind-data', 'operation data', 6], ['wrong-bind-destination', 'operation data', 6], ['wrong-bind-sender', 'operation data', 6], ['cancelled-bind', 'operation data', 6],
  ]) await scenario(mode, async page => {
    await connected(page); await through(page, length); await page.waitForFunction(text => document.getElementById('wallet-status').textContent.includes(text), error);
    assert.equal(await page.getByRole('button', { name: 'DOWNLOAD MANIFEST ↓', exact: true }).isDisabled(), true); assert.equal(await page.evaluate(() => window.__transactions.length), length);
    assert.equal(await page.getByRole('button', { name: 'RESUME VERIFICATION', exact: true }).count(), 1);
  });
  console.log(`PASS ${count} console safety/browser scenarios. Wallet and chain RPC calls were mocked; no transactions sent.`);
} finally { await browser.close(); }
