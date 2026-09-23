import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeFunctionResult, toHex } from 'viem';
import { GENERATION_ELIGIBILITY_ABI } from '@rarefriends/friendsdk/identity';
import { GENERATION_SPRITE_MANIFEST } from '@rarefriends/friendsdk/sprites';
import { fileURLToPath } from 'node:url';

// Isolated production-origin fixture. All HTML, RPC and analytics traffic is
// fulfilled locally by Playwright; this never contacts a live site or wallet.
const root = fileURLToPath(new URL('..', import.meta.url));
const origin = 'https://rarerush.app';
const wallet = '0x1111111111111111111111111111111111111111';
const owner = '0x6fd155b9d52f80e8a73a8a2537268602978486e2';
const bundle = await build({ stdin: { contents: `import { bindGenerationsAnalytics } from './games/rare-rush/host-analytics.ts'; const root = document.getElementById('root'); const analytics = bindGenerationsAnalytics(root); new MutationObserver(analytics.update).observe(root, { subtree: true, childList: true, characterData: true }); analytics.update();`, resolveDir: root }, bundle: true, format: 'iife', platform: 'browser', write: false });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
const context = await browser.newContext();
const events = [], errors = [];
let currentOwner = wallet, rpcCalls = 0;
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin === origin && url.pathname === '/play/') return route.fulfill({ contentType: 'text/html', body: `<div id="root"><div class="rf-runtime-connection"><p>Connected: ${wallet}</p></div><div class="rf-frame-toolbar"><button aria-label="Choose Friend">Friend #1</button></div><div class="rf-frame-viewport"><iframe id="game" sandbox="allow-scripts" srcdoc="<p>opaque game</p>"></iframe></div></div><iframe id="unrelated" sandbox="allow-scripts" srcdoc="<p>unrelated</p>"></iframe><script src="/analytics-fixture.js"></script>` });
  if (url.origin === origin && url.pathname === '/analytics-fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
  if (url.origin === origin && url.pathname === '/api/arcade-events') {
    assert.equal(request.headers().origin, origin, 'analytics requests originate from the trusted host, never null');
    const body = request.postDataJSON(); events.push(body);
    return route.fulfill({ json: { accepted: true, receipt: body.type === 'start' ? `receipt-${body.runId}` : null } });
  }
  if (url.origin === new URL(GENERATION_SPRITE_MANIFEST.rpcUrl).origin) {
    rpcCalls++;
    const data = request.postDataJSON();
    const respond = item => {
      let result;
      if (item.method === 'eth_chainId') result = toHex(4663);
      else if (item.method === 'eth_blockNumber') result = toHex(99);
      else {
        assert.equal(item.method, 'eth_call');
        const call = decodeFunctionData({ abi: GENERATION_ELIGIBILITY_ABI, data: item.params[0].data });
        result = encodeFunctionResult({ abi: GENERATION_ELIGIBILITY_ABI, functionName: call.functionName, result: call.functionName === 'ownerOf' ? currentOwner : 1 });
      }
      return { jsonrpc: '2.0', id: item.id, result };
    };
    return route.fulfill({ headers: { 'Access-Control-Allow-Origin': origin }, json: Array.isArray(data) ? data.map(respond) : respond(data) });
  }
  errors.push(`Unexpected network request: ${request.url()}`);
  return route.abort();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
const wait = async predicate => { const deadline = Date.now() + 5000; while (!predicate()) { if (Date.now() > deadline) assert.fail('Timed out waiting for analytics fixture'); await new Promise(resolve => setTimeout(resolve, 15)); } };
const start = runId => ({ version: 1, type: 'rarerush:arcade-start', runId, collection: 'generations', difficulty: 'normal' });
const finish = runId => ({ version: 1, type: 'rarerush:arcade-finish', runId, finishReason: 'time', elapsedSeconds: 90 });
try {
  await page.goto(`${origin}/play/`);
  const game = await page.locator('#game').contentFrame(), unrelated = await page.locator('#unrelated').contentFrame();
  const emit = async (frame, value) => frame.locator('body').evaluate((_body, signal) => window.parent.postMessage(signal, 'https://rarerush.app'), value);
  const id = '11111111-1111-4111-8111-111111111111';
  await emit(unrelated, start(id));
  await emit(game, { ...start(id), wallet: owner });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(rpcCalls, 0); assert.equal(events.length, 0);
  await emit(game, start(id));
  await wait(() => events.length === 1);
  assert.equal(events[0].wallet, wallet);
  await emit(game, start(id)); await emit(game, finish(id)); await emit(game, finish(id));
  await wait(() => events.length === 2);
  assert.equal(events[1].receipt, `receipt-${id}`);
  currentOwner = '0x2222222222222222222222222222222222222222';
  const previousRpc = rpcCalls;
  await emit(game, start('22222222-2222-4222-8222-222222222222'));
  await wait(() => rpcCalls >= previousRpc + 4);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(events.length, 2, 'mismatched onchain owner is not recorded');
  await page.locator('.rf-runtime-connection p').evaluate((node, value) => { node.textContent = `Connected: ${value}`; }, owner);
  const excludedRpc = rpcCalls;
  await emit(game, start('33333333-3333-4333-8333-333333333333'));
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(events.length, 2); assert.equal(rpcCalls, excludedRpc);
  assert.deepEqual(errors, []);
  console.log('Arcade analytics browser checks passed: exact opaque iframe source, strict payload, host-derived wallet, fresh ownership match, owner exclusion, same-origin API, receipt binding, duplicate protection. All network traffic mocked.');
} finally { await context.close(); await browser.close(); }
