import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrivateRpcProxy } from '../server/private-rpc.ts';
import { ARCADE_RPC_PATH, createArcadePublicClient } from '../games/rare-rush/arcade-client.ts';

let originId = 0;
function browserOrigin(t: { after: (fn: () => void) => void }) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const origin = `https://rpc-test-${++originId}.example`;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete (globalThis as Record<string, unknown>).window; });
  return origin + ARCADE_RPC_PATH;
}

test('mainnet browser reads use only the private same-origin server and bounded HTTP batches', async t => {
  const endpoint = browserOrigin(t);
  const requests: { url: string; body: { id: number; method: string }[] }[] = [];
  const client = createArcadePublicClient({ retryCount: 0, fetchFn: async (input, init) => {
    const body = JSON.parse(init!.body as string);
    const calls = Array.isArray(body) ? body : [body];
    requests.push({ url: String(input), body: calls });
    return new Response(JSON.stringify(calls.map((call: { id: number }) => ({ jsonrpc: '2.0', id: call.id, result: '0x1237' }))),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  } });
  const results = await Promise.all(Array.from({ length: 45 }, () => client.request({ method: 'eth_chainId' }, { dedupe: false })));
  assert.ok(results.every(chainId => chainId === '0x1237'));
  assert.equal(requests.reduce((sum, request) => sum + request.body.length, 0), 45);
  assert.ok(requests.every(request => request.url === endpoint && request.body.length <= 20));
  assert.ok(requests.every(request => request.body.every(call => call.method === 'eth_chainId')));
});

test('private RPC failure does not silently fall back to a public provider or wallet', async t => {
  const endpoint = browserOrigin(t);
  const destinations: string[] = [];
  const client = createArcadePublicClient({ retryCount: 0, fetchFn: async input => {
    destinations.push(String(input));
    return new Response(JSON.stringify({ error: 'RPC temporarily unavailable' }), { status: 503 });
  } });
  await assert.rejects(client.getChainId());
  assert.deepEqual(destinations, [endpoint]);
});


test('cancelling a picker or portrait does not abort another client sharing the endpoint', async t => {
  browserOrigin(t);
  const cancelled = new AbortController(), retained = new AbortController();
  let begun = 0, ready!: () => void;
  const allStarted = new Promise<void>(resolve => { ready = resolve; });
  const fetchFn: typeof fetch = async (_, init) => {
    const calls = JSON.parse(init!.body as string) as { id: number }[];
    begun++; if (begun === 2) ready();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 40);
      init!.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init!.signal!.reason); }, { once: true });
    });
    return new Response(JSON.stringify(calls.map(call => ({ jsonrpc: '2.0', id: call.id, result: '0x1237' }))),
      { headers: { 'Content-Type': 'application/json' } });
  };
  const first = createArcadePublicClient({ signal: cancelled.signal, fetchFn, retryCount: 0 });
  const second = createArcadePublicClient({ signal: retained.signal, fetchFn, retryCount: 0 });
  const requests = Promise.allSettled([
    first.request({ method: 'eth_chainId' }, { dedupe: false }),
    second.request({ method: 'eth_chainId' }, { dedupe: false }),
  ]);
  await allStarted;
  cancelled.abort();
  const results = await requests;
  assert.equal(results[0].status, 'rejected');
  assert.deepEqual(results[1], { status: 'fulfilled', value: '0x1237' });
});


test('actual viem parameterless wire requests pass the private proxy and use its configured upstream', async t => {
  const endpoint = browserOrigin(t), origin = new URL(endpoint).origin;
  const upstreamBodies: { method: string; params: unknown[] }[][] = [];
  const proxy = createPrivateRpcProxy({ env: { RUSH_MAINNET_RPC_URL: 'https://mainnet.example/v2/private-fixture' },
    fetcher: async (url, init) => {
      assert.equal(url, 'https://mainnet.example/v2/private-fixture');
      const payload = JSON.parse(init!.body as string), batch = Array.isArray(payload) ? payload : [payload];
      upstreamBodies.push(batch);
      const replies = batch.map((call: { id: string | number; method: string; params: unknown[] }) => {
        assert.deepEqual(call.params, []);
        return { jsonrpc: '2.0', id: call.id, result: call.method === 'eth_chainId' ? '0x1237' : '0x100' };
      });
      return Response.json(Array.isArray(payload) ? replies : replies[0]);
    },
  });
  const wireBodies: Record<string, unknown>[][] = [];
  const client = createArcadePublicClient({ retryCount: 0, fetchFn: async (url, init) => {
    wireBodies.push(JSON.parse(init!.body as string));
    const headers = new Headers(init!.headers); headers.set('origin', origin);
    const response = await proxy(new Request(url, { ...init, headers }), 'mainnet');
    assert.equal(response.status, 200);
    return response;
  } });
  assert.deepEqual(await Promise.all([client.getChainId(), client.getBlockNumber({ cacheTime: 0 })]), [4663, 256n]);
  assert.ok(wireBodies.flat().every(call => !Object.hasOwn(call, 'params')), 'Use viem’s real omitted-params encoding');
  assert.ok(upstreamBodies.flat().some(call => call.method === 'eth_blockNumber'));
});
