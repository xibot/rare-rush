import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrivateRpcProxy, privateRpcUrl } from '../server/private-rpc.ts';
import { GENERATION_SPRITE_MANIFEST } from '@rarefriends/friendsdk/sprites';
import deployment from '../testnet-app/src/shared/deployment.json' with { type: 'json' };

const origin = 'https://rarerush.app';
const mainnet = 'https://private-mainnet.example/v2/not-for-browser';
const testnet = 'https://private-testnet.example/v2/not-for-browser';
const env = { RUSH_MAINNET_RPC_URL: mainnet, RUSH_TESTNET_RPC_URL: testnet };
const rpc = (method = 'eth_chainId', params: unknown[] = [], id: string | number = 1) => ({ jsonrpc: '2.0', id, method, params });
const request = (payload: unknown = rpc(), headers: Record<string, string> = {}, path = 'mainnet-rpc') => new Request(`${origin}/api/${path}`, {
  method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload),
});
const query = () => ({ address: GENERATION_SPRITE_MANIFEST.generations, fromBlock: '0x0', toBlock: '0x98967f',
  topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', null, '0x' + '0'.repeat(24) + '1'.repeat(40)] });
function mockRpc() {
  const calls: { url: string; payload: any; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const payload = JSON.parse(String(init?.body)); calls.push({ url: String(url), payload, init });
    const result = (call: any) => ({ jsonrpc: '2.0', id: call.id, result: call.method === 'eth_chainId'
      ? String(url) === testnet ? '0xb626' : '0x1237' : call.method === 'eth_getLogs' ? [] : '0x1' });
    return Response.json(Array.isArray(payload) ? payload.map(result) : result(payload));
  };
  return { calls, fetcher };
}

test('private configuration requires correct server-only endpoints and never uses a public fallback', () => {
  assert.equal(privateRpcUrl('mainnet', env), mainnet);
  assert.equal(privateRpcUrl('testnet', env), testnet);
  assert.equal(privateRpcUrl('testnet', { RUSH_RPC_URL: testnet }), testnet);
  for (const bad of [undefined, '', ' https://secret.example/key', 'http://secret.example/key', 'https://localhost/x',
    'https://127.0.0.1/x', 'https://10.0.1.5/key', 'https://name:password@example.com/key', 'https://example.com/#secret']) {
    assert.throws(() => privateRpcUrl('mainnet', { RUSH_MAINNET_RPC_URL: bad }), error =>
      error instanceof Error && error.message === 'Private RPC configuration is unavailable.');
  }
  assert.throws(() => privateRpcUrl('mainnet', { RUSH_RPC_URL: testnet }));
});

test('both networks use private endpoints, validate chain once, preserve batch IDs and forbid redirects', async () => {
  const f = mockRpc(), proxy = createPrivateRpcProxy({ env, fetcher: f.fetcher });
  const batch = Array.from({ length: 20 }, (_, id) => rpc('eth_blockNumber', [], id));
  const response = await proxy(request(batch), 'mainnet');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).map((item: any) => item.id), batch.map(item => item.id));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].payload.id, 'rare-rush-chain');
  await proxy(request(rpc('eth_getCode', [GENERATION_SPRITE_MANIFEST.generations, 'latest'])), 'mainnet');
  assert.equal(f.calls.length, 3, 'warm requests reuse the validated chain');
  await proxy(request(rpc(), {}, 'rpc'), 'testnet');
  assert.deepEqual(f.calls.map(call => call.url), [mainnet, mainnet, mainnet, testnet, testnet]);
  for (const call of f.calls) assert.equal(call.init?.redirect, 'error');
});

test('missing or wrong-chain endpoints fail closed before any requested state reads', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    calls++;
    assert.equal(JSON.parse(String(init?.body)).method, 'eth_chainId');
    return Response.json({ jsonrpc: '2.0', id: 'rare-rush-chain', result: '0x1' });
  };
  for (const settings of [{}, { RUSH_MAINNET_RPC_URL: mainnet }]) {
    const proxy = createPrivateRpcProxy({ env: settings, fetcher });
    const reply = await proxy(request(rpc('eth_call', [{ to: GENERATION_SPRITE_MANIFEST.generations, data: '0x6352211e' }, 'latest'])), 'mainnet');
    assert.equal(reply.status, 503);
    assert.equal((await reply.text()).includes('not-for-browser'), false);
  }
  assert.equal(calls, 1);
});

test('only bounded project reads and owner-filtered NFT history reach upstream', async () => {
  const f = mockRpc(), proxy = createPrivateRpcProxy({ env, fetcher: f.fetcher });
  const good = [rpc('eth_getLogs', [query()]), rpc('eth_call', [{ to: GENERATION_SPRITE_MANIFEST.registry, data: '0x12345678' }, 'latest']),
    rpc('eth_getBalance', ['0x' + '1'.repeat(40), 'latest']), rpc('eth_getTransactionReceipt', ['0x' + '1'.repeat(64)])];
  for (const call of good) assert.equal((await proxy(request(call), 'mainnet')).status, 200);
  const count = f.calls.length;
  const bad = [rpc('eth_sendRawTransaction', ['0x00']), rpc('eth_accounts'), rpc('debug_traceCall'),
    rpc('eth_call', [{ to: '0x' + '1'.repeat(40), data: '0x12345678' }, 'latest']),
    rpc('eth_call', [{ to: GENERATION_SPRITE_MANIFEST.registry, data: '0x12345678', value: '0x1' }, 'latest']),
    rpc('eth_call', [{ to: GENERATION_SPRITE_MANIFEST.registry, data: '0x12345678' }, 'latest', {}]),
    rpc('eth_call', [{ to: GENERATION_SPRITE_MANIFEST.registry, data: '0x' + 'ff'.repeat(64_001) }, 'latest']),
    rpc('eth_getCode', ['0x' + '1'.repeat(40), 'latest']), rpc('eth_getLogs', [{ ...query(), topics: [query().topics[0]] }]),
    rpc('eth_getLogs', [{ ...query(), topics: [query().topics[0], '0x' + '0'.repeat(64)] }]),
    rpc('eth_getLogs', [{ ...query(), toBlock: '0x989680' }]), rpc('eth_getLogs', [{ ...query(), toBlock: 'latest' }]),
    rpc('eth_getLogs', [{ ...query(), address: [GENERATION_SPRITE_MANIFEST.generations] }]),
    rpc('eth_getLogs', [{ ...query(), blockHash: '0x' + '1'.repeat(64) }]), rpc('eth_getBlockByNumber', ['latest', true]),
    { ...rpc(), id: null }, { ...rpc(), jsonrpc: '1.0' }, { ...rpc(), extra: true }, [], Array(101).fill(rpc()), [rpc(), rpc()]];
  for (const call of bad) assert.equal((await proxy(request(call), 'mainnet')).status, 400, JSON.stringify(call).slice(0, 120));
  assert.equal(f.calls.length, count);
  assert.equal((await proxy(request(rpc('eth_getBlockByNumber', ['latest', true])), 'testnet')).status, 200,
    'receipt replacement checks need Testnet blocks with full transactions');
  assert.equal((await proxy(request(rpc('eth_call', [{ to: deployment.contracts.game, data: '0x12345678' }, 'latest'])), 'testnet')).status, 200);
});

test('origin, method, body bounds, and malformed upstream replies fail without leaking provider diagnostics', async () => {
  const f = mockRpc(), proxy = createPrivateRpcProxy({ env, fetcher: f.fetcher });
  assert.equal((await proxy(new Request(origin + '/api/mainnet-rpc'), 'mainnet')).status, 405);
  for (const headers of [{ origin: 'https://other.example' }, { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' }]) {
    assert.equal((await proxy(request(rpc(), headers), 'mainnet')).status, 403);
  }
  assert.equal((await proxy(request('x'.repeat(512_001)), 'mainnet')).status, 400);
  assert.equal(f.calls.length, 0);
  for (const badReply of [() => new Response('x'.repeat(8_000_001)), () => Response.json({ jsonrpc: '2.0', id: 'wrong', result: 1 }),
    () => Response.json({ jsonrpc: '2.0', id: 1, result: 1, error: { code: -1 } })]) {
    const broken = createPrivateRpcProxy({ env, fetcher: async (url, init) => {
      if (JSON.parse(String(init?.body)).id === 'rare-rush-chain') return f.fetcher(url, init);
      return badReply();
    } });
    const reply = await broken(request(rpc()), 'mainnet');
    assert.equal(reply.status, 503);
    assert.equal((await reply.text()).includes('not-for-browser'), false);
  }
});

test('provider errors redact URLs, API keys and arbitrary data while preserving safe revert bytes', async () => {
  const f = mockRpc();
  const proxy = createPrivateRpcProxy({ env, fetcher: async (url, init) => {
    const call = JSON.parse(String(init?.body));
    if (call.id === 'rare-rush-chain') return f.fetcher(url, init);
    return Response.json({ jsonrpc: '2.0', id: call.id, error: { code: 3,
      message: 'execution reverted at ' + mainnet, data: '0x7e273289' } });
  } });
  const reply = await proxy(request(rpc()), 'mainnet');
  const text = await reply.text();
  assert.equal(text.includes('not-for-browser'), false);
  assert.deepEqual(JSON.parse(text).error, { code: 3, message: 'Contract execution reverted.', data: '0x7e273289' });
});

test('short Retry-After is honored, long waits return a bounded retry instruction, and retries stop', async () => {
  const f = mockRpc(); let attempt = 0; const delays: number[] = [];
  const proxy = createPrivateRpcProxy({ env, sleep: async ms => { delays.push(ms); }, fetcher: async (url, init) => {
    if (JSON.parse(String(init?.body)).id === 'rare-rush-chain') return f.fetcher(url, init);
    if (++attempt <= 2) return new Response('private diagnostic', { status: 429, headers: { 'retry-after': '0.25' } });
    return f.fetcher(url, init);
  } });
  assert.equal((await proxy(request(rpc()), 'mainnet')).status, 200);
  assert.equal(attempt, 3); assert.deepEqual(delays, [250, 250]);
  const noWait = createPrivateRpcProxy({ env, sleep: async () => { assert.fail('long waits are not retried inside a browser request'); },
    fetcher: async () => new Response('private diagnostic', { status: 429, headers: { 'retry-after': '8' } }) });
  const longReply = await noWait(request(rpc()), 'mainnet');
  assert.equal(longReply.status, 429); assert.equal(longReply.headers.get('retry-after'), '8');
  assert.equal((await longReply.text()).includes('diagnostic'), false);
});

test('large holders can complete thousands of reads while batches are still metered by call cost', async () => {
  const f = mockRpc(); let clock = 0;
  const proxy = createPrivateRpcProxy({ env, fetcher: f.fetcher, now: () => clock });
  const batch = Array.from({ length: 100 }, (_, id) => rpc('eth_blockNumber', [], id));
  for (let i = 0; i < 150; i++) assert.equal((await proxy(request(batch), 'mainnet')).status, 200);
  assert.equal((await proxy(request(rpc()), 'mainnet')).status, 429);
  clock = 60_001;
  assert.equal((await proxy(request(rpc()), 'mainnet')).status, 200);
});

test('cancelling one request does not poison the shared private-chain probe', async () => {
  const f = mockRpc(); let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const began = new Promise<void>(resolve => { started = resolve; });
  let probes = 0;
  const proxy = createPrivateRpcProxy({ env, fetcher: async (url, init) => {
    if (JSON.parse(String(init?.body)).id === 'rare-rush-chain') {
      probes++; started(); await gate;
      assert.equal(init?.signal?.aborted, false, 'chain probe has its own bounded lifetime');
    }
    return f.fetcher(url, init);
  } });
  const controller = new AbortController();
  const first = proxy(new Request(request(rpc()), { signal: controller.signal }), 'mainnet');
  await began;
  const second = proxy(request(rpc('eth_blockNumber')), 'mainnet');
  controller.abort();
  assert.equal((await first).status, 503);
  release();
  assert.equal((await second).status, 200);
  assert.equal(probes, 1);
});

test('an already-cancelled cold request never starts a private-chain probe', async () => {
  let calls = 0;
  const proxy = createPrivateRpcProxy({ env, fetcher: async () => {
    calls++;
    return Response.json({ jsonrpc: '2.0', id: 'rare-rush-chain', result: '0x1' });
  } });
  const controller = new AbortController(); controller.abort();
  const reply = await proxy(new Request(request(rpc()), { signal: controller.signal }), 'mainnet');
  assert.equal(reply.status, 503);
  assert.equal(calls, 0);
});

test('a shared probe failing after its last waiter cancels is observed and the next request can retry', async () => {
  const f = mockRpc(); let release!: () => void, started!: () => void, probes = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const began = new Promise<void>(resolve => { started = resolve; });
  const proxy = createPrivateRpcProxy({ env, fetcher: async (url, init) => {
    if (JSON.parse(String(init?.body)).id === 'rare-rush-chain' && ++probes === 1) {
      started(); await gate;
      return Response.json({ jsonrpc: '2.0', id: 'rare-rush-chain', result: '0x1' });
    }
    return f.fetcher(url, init);
  } });
  const controller = new AbortController();
  const first = proxy(new Request(request(rpc()), { signal: controller.signal }), 'mainnet');
  await began; controller.abort();
  assert.equal((await first).status, 503);
  release();
  // A dangling rejection here also fails node:test after the test finishes.
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await proxy(request(rpc()), 'mainnet')).status, 200);
  assert.equal(probes, 2);
});
