import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const origin = process.env.TESTNET_APP_URL ?? 'http://127.0.0.1:4176';
const browser = await chromium.launch({ headless: true });
const output = new URL('../artifacts/', import.meta.url);
await mkdir(output, { recursive: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.getByText('CONTRACTS AWAITING DEPLOYMENT', { exact: true }).waitFor();
  assert.equal(await page.locator('#claim-rf').isDisabled(), true);
  assert.equal(await page.locator('#mint-genesis').isDisabled(), true);
  assert.equal(await page.locator('#mint-generations').isDisabled(), true);
  assert.equal(await page.getByRole('link', { name: 'GET TEST ETH' }).getAttribute('href'), 'https://faucet.testnet.chain.robinhood.com');
  await page.screenshot({ path: fileURLToPath(new URL('desktop.png', output)), fullPage: true });
  await page.locator('#connect').click();
  await page.getByText('Open this page in a wallet browser, or install a browser wallet, then connect.').waitFor();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(origin);
  await mobile.getByText('CONTRACTS AWAITING DEPLOYMENT', { exact: true }).waitFor();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile must not overflow');
  await mobile.screenshot({ path: fileURLToPath(new URL('mobile.png', output)), fullPage: true });
  await mobile.close();

  const wallet = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  wallet.on('pageerror', error => errors.push(error.message));
  await wallet.addInitScript(() => {
    window.mockWallet = { account: '0x00000000000000000000000000000000000000A1', chain: '0x1237', listeners: {}, writes: 0, requests: [] };
    window.ethereum = {
      on(event, listener) { window.mockWallet.listeners[event] = listener; },
      async request({ method, params }) {
        window.mockWallet.requests.push(method);
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [window.mockWallet.account];
        if (method === 'eth_chainId') return window.mockWallet.chain;
        if (method === 'wallet_switchEthereumChain') { window.mockWallet.chain = params[0].chainId; return null; }
        window.mockWallet.writes++;
        throw new Error('Unexpected write');
      },
    };
  });
  await wallet.route('https://rpc.testnet.chain.robinhood.com/**', route => {
    const request = route.request().postDataJSON();
    const respond = item => ({ jsonrpc: '2.0', id: item.id, result: item.method === 'eth_getBalance' ? '0x2386f26fc10000' : '0xb626' });
    return route.fulfill({ json: Array.isArray(request) ? request.map(respond) : respond(request) });
  });
  await wallet.goto(origin);
  await wallet.locator('#connect').click();
  await wallet.locator('#switch-network').waitFor();
  assert.equal(await wallet.locator('#mint-genesis').isDisabled(), true);
  await wallet.locator('#switch-network').click();
  await wallet.getByText('Connected to Robinhood testnet.', { exact: true }).waitFor();
  assert.equal(await wallet.locator('#claim-rf').isDisabled(), true, 'network match cannot bypass absent contracts');
  assert.equal(await wallet.evaluate(() => window.mockWallet.writes), 0);
  await wallet.locator('#disconnect').click();
  await wallet.evaluate(() => window.mockWallet.listeners.accountsChanged(['0x00000000000000000000000000000000000000a2']));
  await wallet.locator('#connect').waitFor();
  assert.equal(await wallet.locator('#disconnect').count(), 0, 'wallet event must not reconnect after local disconnect');
  await wallet.close();

  const invalid = await browser.newPage();
  await invalid.route('**/testnet-config.json', route => route.fulfill({ json: { version: 1, chainId: 4663, contracts: null } }));
  await invalid.goto(origin);
  await invalid.getByText('This app only supports Robinhood testnet (46630).', { exact: true }).waitFor();
  assert.equal(await invalid.locator('#claim-rf').isDisabled(), true);
  assert.equal(await invalid.locator('#mint-genesis').isDisabled(), true);
  await invalid.close();
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: undeployed action gating, desktop/mobile layout, no-wallet guidance, wrong-network switch, disconnect event isolation, mainnet config rejection, no runtime errors.');
} finally { await browser.close(); }
