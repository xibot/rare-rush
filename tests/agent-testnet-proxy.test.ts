import assert from 'node:assert/strict';
import test from 'node:test';
import { agentTestnetProxy } from '../server/agent-testnet-proxy.ts';

const origin = 'https://rarerush.app';
const rpc = { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] };
const request = (kind: string, payload: unknown = rpc, headers = {}) => new Request(`${origin}/api/${kind}`, {
  method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload),
});
test('Agent Play bridge permits bounded reads and forwards verifier messages to fixed destinations', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ result: '0xb626' });
  };
  assert.equal((await agentTestnetProxy(request('rpc'), 'rpc', fetcher)).status, 200);
  assert.equal(calls[0].url, 'https://rpc.testnet.chain.robinhood.com');
  assert.equal(calls[0].init?.redirect, 'error');
  assert.equal((await agentTestnetProxy(request('verify-run', { runId: '4', signature: 'wallet-message' }), 'verify-run', fetcher)).status, 200);
  assert.equal(calls[1].url, 'https://testnet.rarerush.app/api/verify-run');
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { runId: '4', signature: 'wallet-message' });
  assert.equal((await agentTestnetProxy(new Request(origin + '/api/status'), 'status', fetcher)).status, 200);
  assert.equal(calls[2].url, 'https://testnet.rarerush.app/api/status');
});
test('cross-origin requests, RPC writes and large batches never reach upstream', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return Response.json({}); };
  assert.equal((await agentTestnetProxy(request('rpc', rpc, { origin: 'https://other.invalid' }), 'rpc', fetcher)).status, 403);
  assert.equal((await agentTestnetProxy(request('rpc', rpc, { 'sec-fetch-site': 'cross-site' }), 'rpc', fetcher)).status, 403);
  assert.equal((await agentTestnetProxy(new Request(origin + '/api/rpc'), 'rpc', fetcher)).status, 405);
  for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'personal_sign', 'debug_traceTransaction']) {
    assert.equal((await agentTestnetProxy(request('rpc', { ...rpc, method }), 'rpc', fetcher)).status, 400);
  }
  assert.equal((await agentTestnetProxy(request('rpc', Array(31).fill(rpc)), 'rpc', fetcher)).status, 400);
  await agentTestnetProxy(request('rpc', 'x'.repeat(1_800_001)), 'rpc', fetcher);
  assert.equal(calls, 0);
});
test('oversize or failed upstream responses expose only a retryable generic error', async () => {
  for (const fetcher of [
    async () => { throw new Error('secret endpoint or key'); },
    async () => new Response('x'.repeat(2_500_001)),
    async () => new Response('<html>upstream unavailable</html>', { status: 502 }),
  ]) {
    const response = await agentTestnetProxy(request('rpc'), 'rpc', fetcher);
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes('secret'), false);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});
