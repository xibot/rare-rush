import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('all built community functions start without TypeScript source loading', () => {
  const env = { ...process.env };
  delete env.BLOB_STORE_ID;
  delete env.BLOB_READ_WRITE_TOKEN;
  // Run the exact deploy entry points with TS loading disabled. This catches
  // mixed MJS/TS imports that pass local tests but fail in the function bundle.
  const output = execFileSync(process.execPath, ['--no-experimental-strip-types', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import list from './api/runs.mjs';
    import detail from './api/runs/[id].mjs';
    import status from './api/status.mjs';
    import rpc from './api/rpc.mjs';
    import verify from './api/verify-run.mjs';
    for (const [handler, path] of [[list, '/api/runs'], [detail, '/api/runs/' + 'a'.repeat(64)]]) {
      const response = await handler.fetch(new Request('https://rarerush.app' + path));
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error, 'Public replay storage is not configured.');
    }
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return Response.json({ ready: true, jsonrpc: '2.0', id: 1, result: '0xb626' });
    };
    const origin = 'https://rarerush.app';
    assert.equal((await status.fetch(new Request(origin + '/api/status'))).status, 200);
    for (const [handler, route, payload] of [
      [rpc, 'rpc', { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }],
      [verify, 'verify-run', { runId: '1', signature: 'test-only' }],
    ]) {
      const response = await handler.fetch(new Request(origin + '/api/' + route, {
        method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(payload),
      }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).result, '0xb626');
    }
    assert.deepEqual(calls.map(call => call.url), [
      'https://testnet.rarerush.app/api/status',
      'https://rpc.testnet.chain.robinhood.com',
      'https://testnet.rarerush.app/api/verify-run',
    ]);
    console.log('Function entry points loaded successfully.');
  `], { cwd: new URL('..', import.meta.url), env, encoding: 'utf8' });
  assert.match(output, /loaded successfully/);
});
