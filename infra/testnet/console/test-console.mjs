import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeFunctionResult } from 'viem';

const base = process.env.RUSH_CONSOLE_URL ?? 'http://127.0.0.1:4174';
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Console tests must use a loopback URL');
const owner = '0x6fd155b9d52f80e8a73a8a2537268602978486e2';
const deploymentConfig = await (await fetch(base + '/config.json')).json();
const gameArtifact = JSON.parse(await readFile(new URL('../artifacts/RareRushGame.json', import.meta.url)));
const tokenArtifact = JSON.parse(await readFile(new URL('../artifacts/RareRushToken.json', import.meta.url)));
const addressFor = index => '0x' + (4097 + index).toString(16).padStart(40, '0');
const blockHash = '0x' + 'b'.repeat(64);
const browser = await chromium.launch({ headless: true });
let count = 0;
async function scenario(mode, run, rpcChain = '0xb626') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://rpc.testnet.chain.robinhood.com/**', async route => {
    const body = route.request().postDataJSON();
    const transactions = mode === 'success' ? await page.evaluate(() => window.__transactions ?? []) : [];
    const resultFor = request => {
      if (mode === 'success') {
        const index = transactions.findIndex(value => value.hash === request.params?.[0]);
        if (request.method === 'eth_blockNumber') return '0x64';
        if (request.method === 'eth_getCode') return '0x60006000f3';
        if (request.method === 'eth_getTransactionReceipt' && index >= 0) return {
          transactionHash: transactions[index].hash, transactionIndex: '0x0', blockHash, blockNumber: '0x64',
          from: owner, to: null, cumulativeGasUsed: '0x186a0', gasUsed: '0x186a0', effectiveGasPrice: '0x3b9aca00',
          contractAddress: addressFor(index), logs: [], logsBloom: '0x' + '0'.repeat(512), status: '0x1', type: '0x0',
        };
        if (request.method === 'eth_getTransactionByHash' && index >= 0) return {
          hash: transactions[index].hash, from: owner, to: null, input: transactions[index].data,
          nonce: '0x' + index.toString(16), blockHash, blockNumber: '0x64', transactionIndex: '0x0',
          value: '0x0', gas: '0x7a120', gasPrice: '0x3b9aca00', type: '0x0', v: '0x1b', r: '0x1', s: '0x1',
        };
        if (request.method === 'eth_call') {
          const call = request.params[0], abi = call.to.toLowerCase() === addressFor(4) ? tokenArtifact.abi : gameArtifact.abi;
          const { functionName } = decodeFunctionData({ abi, data: call.data });
          const values = { owner, verifier: deploymentConfig.verifier, engineVersion: deploymentConfig.engineVersion,
            token: addressFor(4), rf: addressFor(0), genesis: addressFor(1), generations: addressFor(2), game: addressFor(3) };
          return encodeFunctionResult({ abi, functionName, result: values[functionName] });
        }
      }
      return ({ eth_chainId: rpcChain, eth_getBalance: '0x8ac7230489e80000', eth_estimateGas: '0x7a120', eth_gasPrice: '0x3b9aca00' })[request.method] ?? '0x';
    };
    const respond = request => ({ jsonrpc: '2.0', id: request.id,
      ...(request.method === 'eth_getTransactionReceipt'
        && mode !== 'success'
        ? { error: { code: -32000, message: 'Transaction receipt not found' } }
        : { result: resultFor(request) }) });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(body) ? body.map(respond) : respond(body)) });
  });
  await page.addInitScript(({ mode, owner }) => {
    window.__walletMode = mode; window.__walletCalls = []; window.__transactions = [];
    window.__walletAccount = mode === 'wrong-account' ? '0x1111111111111111111111111111111111111111' : owner;
    window.__walletChain = mode === 'wrong-chain' ? '0x1' : '0xb626';
    window.ethereum = {
      on() {},
      async request({ method, params }) {
        window.__walletCalls.push(method);
        if (method === 'eth_requestAccounts') {
          if (window.__walletMode === 'declined-connect') throw Object.assign(new Error('User rejected'), { code: 4001 });
          return [window.__walletAccount];
        }
        if (method === 'eth_accounts') return [window.__walletAccount];
        if (method === 'eth_chainId') return window.__walletChain;
        if (method === 'wallet_switchEthereumChain') { window.__walletChain = '0xb626'; return null; }
        if (method === 'eth_sendTransaction') {
          if (window.__walletMode === 'success') {
            const hash = '0x' + (window.__transactions.length + 1).toString(16).padStart(64, '0');
            window.__transactions.push({ hash, data: params[0].data }); return hash;
          }
          if (window.__walletMode === 'ambiguous-send') throw new Error('Wallet connection interrupted');
          throw Object.assign(new Error('User rejected transaction'), { code: 4001 });
        }
        throw new Error(`Unexpected mocked wallet request: ${method}`);
      },
    };
  }, { mode, owner });
  try {
    await page.goto(base);
    await run(page);
    assert.deepEqual(errors, [], 'No browser exceptions');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No mobile overflow');
    count++;
  } finally { await context.close(); }
}
const firstDeploy = page => page.getByRole('button', { name: 'DEPLOY TEST RF ↗', exact: true });
const connected = async page => {
  await page.getByRole('button', { name: 'CONNECT WALLET ↗', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('wallet-status').textContent.includes('Correct wallet and network'));
};
try {
  const main = await fetch(base);
  assert.equal(main.status, 200);
  assert.match(main.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  for (const path of ['/operator-config.json', '/.env', '/signer.key', '/..%2Foperator-config.json', '/artifacts/../operator-config.json', '/console/app.js']) {
    assert.equal((await fetch(base + path)).status, 404, `Private/unlisted path blocked: ${path}`);
  }
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  assert.equal((await fetch(base, { headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal(await new Promise((resolve, reject) => {
    const req = request(base, { headers: { Host: 'example.com' } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.end();
  }), 403);
  const config = await (await fetch(base + '/config.json')).json();
  assert.deepEqual(Object.keys(config).sort(), ['chainId', 'engineVersion', 'owner', 'verifier']);
  count++;
  await scenario('declined-connect', async page => {
    await page.waitForFunction(() => !document.getElementById('connect').disabled);
    assert.deepEqual(await page.evaluate(() => window.__walletCalls), [], 'No automatic wallet requests');
    await page.getByRole('button', { name: 'CONNECT WALLET ↗', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('wallet-status').textContent.includes('declined'));
    assert.equal(await firstDeploy(page).isDisabled(), true);
  });
  await scenario('wrong-account', async page => {
    await page.getByRole('button', { name: 'CONNECT WALLET ↗', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('wallet-status').textContent.includes('Wrong account'));
    assert.equal(await firstDeploy(page).isDisabled(), true);
  });
  await scenario('wrong-chain', async page => {
    await page.getByRole('button', { name: 'CONNECT WALLET ↗', exact: true }).click();
    await page.getByRole('button', { name: 'SWITCH TO TESTNET', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await firstDeploy(page).isDisabled(), true);
    await page.getByRole('button', { name: 'SWITCH TO TESTNET', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('wallet-status').textContent.includes('Correct wallet and network'));
    assert.equal(await firstDeploy(page).isEnabled(), true);
  });
  await scenario('declined-send', async page => {
    await connected(page); await firstDeploy(page).click();
    await page.waitForFunction(() => document.getElementById('wallet-status').textContent.includes('declined'));
    assert.equal(await firstDeploy(page).isEnabled(), true, 'Explicit rejection can retry');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage)[0])));
    assert.equal(saved.deployments.rf, undefined);
    assert.equal((await page.evaluate(() => window.__walletCalls)).filter(value => value === 'eth_sendTransaction').length, 1);
  });
  await scenario('ambiguous-send', async page => {
    await connected(page); await firstDeploy(page).click();
    await page.getByRole('button', { name: 'VERIFY HASH', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'VERIFY HASH', exact: true }).waitFor();
    assert.equal(await firstDeploy(page).count(), 0, 'Ambiguous send cannot silently redeploy');
    assert.deepEqual(await page.evaluate(() => window.__walletCalls), [], 'Recovery does not prompt wallet');
    await page.getByRole('button', { name: 'VERIFY HASH', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('wallet-status').textContent.includes('complete 0x transaction hash'));
  });
  await scenario('pending', async page => {
    await page.waitForFunction(() => !document.getElementById('connect').disabled);
    await page.evaluate(() => {
      const key = Object.keys(localStorage)[0], state = JSON.parse(localStorage.getItem(key));
      state.deployments.rf = { status: 'pending', hash: '0x' + 'a'.repeat(64) }; localStorage.setItem(key, JSON.stringify(state));
    });
    await page.reload(); await page.getByRole('button', { name: 'RESUME VERIFICATION', exact: true }).waitFor();
    assert.equal(await firstDeploy(page).count(), 0);
    assert.deepEqual(await page.evaluate(() => window.__walletCalls), []);
  });
  await scenario('artifact-mismatch', async page => {
    await page.waitForFunction(() => !document.getElementById('connect').disabled);
    await page.evaluate(() => {
      const key = Object.keys(localStorage)[0], state = JSON.parse(localStorage.getItem(key));
      state.fingerprint = 'old-artifact'; localStorage.setItem(key, JSON.stringify(state));
    });
    await page.reload(); await page.waitForFunction(() => document.getElementById('wallet-status').textContent.includes('compiled contracts changed'));
    assert.equal(await page.getByRole('button', { name: 'CONNECT WALLET ↗', exact: true }).isDisabled(), true);
  });
  await scenario('wrong-rpc', async page => {
    await page.waitForFunction(() => document.getElementById('wallet-status').textContent.includes('wrong chain'));
    assert.equal(await page.getByRole('button', { name: 'CONNECT WALLET ↗', exact: true }).isDisabled(), true);
  }, '0x1237');
  await scenario('success', async page => {
    await connected(page);
    for (const title of ['TEST RF', 'TEST GENESIS', 'TEST GENERATIONS', 'RARE RUSH GAME + TOKEN']) {
      await page.getByRole('button', { name: `DEPLOY ${title} ↗`, exact: true }).click();
      await page.waitForFunction(() => !document.getElementById('refresh').disabled);
    }
    await page.waitForFunction(() => !document.getElementById('download').disabled);
    assert.equal((await page.evaluate(() => window.__walletCalls)).filter(value => value === 'eth_sendTransaction').length, 4);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'DOWNLOAD MANIFEST ↓', exact: true }).click();
    const download = await downloadPromise;
    const manifest = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(manifest.chainId, 46630);
    assert.equal(manifest.game.toLowerCase(), addressFor(3));
    assert.equal(manifest.token.toLowerCase(), addressFor(4));
    assert.equal(Object.keys(manifest.deployments).length, 4);
  });
  console.log(`PASS ${count} console safety/browser scenarios. Wallet and chain RPC calls were mocked; no transactions sent.`);
} finally { await browser.close(); }
