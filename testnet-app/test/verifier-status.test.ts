import assert from 'node:assert/strict';
import test from 'node:test';
import { createVerifierStatusMonitor, fetchVerifierJson, type VerifierAvailability } from '../src/play/verifier-status.ts';

const expected = { chainId: 46630, game: `0x${'1'.repeat(40)}`, engineVersion: `0x${'2'.repeat(64)}` };
const ready = () => Response.json({ ...expected, ready: true, reason: 'ready' });
const unavailable = () => Response.json({ ...expected, ready: false, reason: 'rpc-unavailable' });
function fixture(request: typeof fetch, options = {}) {
  const states: VerifierAvailability[] = [];
  return { states, monitor: createVerifierStatusMonitor({ ...expected, request, onChange: value => states.push(value), timeoutMs: 1000, retryDelayMs: 0, ...options }) };
}

test('a transient RPC status failure recovers on one bounded retry', async () => {
  let requests = 0;
  const { states, monitor } = fixture(async () => ++requests === 1 ? unavailable() : ready());
  await monitor.check();
  assert.equal(requests, 2);
  assert.deepEqual(states, ['checking', 'ready']);
  monitor.dispose();
});

test('concurrent automatic checks share one request', async () => {
  let requests = 0;
  let resolve!: (response: Response) => void;
  const { states, monitor } = fixture(async () => { requests++; return new Promise<Response>(done => { resolve = done; }); });
  const first = monitor.check(), second = monitor.check();
  assert.equal(first, second);
  resolve(ready());
  await Promise.all([first, second]);
  assert.equal(requests, 1);
  assert.deepEqual(states, ['checking', 'ready']);
  monitor.dispose();
});

test('an older failed response cannot overwrite a successful manual retry', async () => {
  let requests = 0;
  let resolveOld!: (response: Response) => void;
  const { states, monitor } = fixture(async () => ++requests === 1 ? new Promise<Response>(done => { resolveOld = done; }) : ready());
  const first = monitor.check();
  await monitor.check(true);
  resolveOld(unavailable());
  await first;
  assert.equal(states.at(-1), 'ready');
  assert.equal(states.filter(state => state === 'unavailable').length, 0);
  monitor.dispose();
});

test('hung requests and bodies time out, unlock retry, and recover without reload', async () => {
  for (const bodyHang of [false, true]) {
    let requests = 0;
    const { states, monitor } = fixture(async () => {
      requests++;
      if (requests > 2) return ready();
      return bodyHang ? { ok: true, json: () => new Promise(() => {}) } as Response : new Promise<Response>(() => {});
    }, { timeoutMs: 5 });
    await monitor.check();
    assert.equal(states.at(-1), 'unavailable');
    assert.equal(requests, 2, 'a failing cycle makes at most two requests');
    await monitor.check(true);
    assert.equal(states.at(-1), 'ready');
    monitor.dispose();
  }
});

test('mismatched identities, paused/configuration failures, and rate limits remain closed', async () => {
  const cases = [
    { ...expected, ready: true, chainId: 1 },
    { ...expected, ready: true, game: `0x${'3'.repeat(40)}` },
    { ...expected, ready: true, engineVersion: `0x${'4'.repeat(64)}` },
    { ...expected, ready: false, reason: 'paused' },
    { ...expected, ready: false, reason: 'not-configured' },
    { ...expected, ready: false, reason: 'configuration-mismatch' },
  ];
  for (const body of cases) {
    let requests = 0;
    const { states, monitor } = fixture(async () => { requests++; return Response.json(body); });
    await monitor.check();
    assert.equal(requests, 1);
    assert.deepEqual(states, ['checking', 'unavailable']);
    monitor.dispose();
  }
  let requests = 0;
  const { states, monitor } = fixture(async () => { requests++; return Response.json({ error: 'Too many requests' }, { status: 429 }); });
  await monitor.check();
  assert.equal(requests, 1, 'rate limiting must not cause an immediate retry');
  assert.equal(states.at(-1), 'unavailable');
  monitor.dispose();
});

test('disposing a monitor cancels old requests without updating unmounted UI', async () => {
  let resolve!: (response: Response) => void;
  const { states, monitor } = fixture(async () => new Promise<Response>(done => { resolve = done; }));
  const pending = monitor.check();
  monitor.dispose(); resolve(ready()); await pending;
  await monitor.check();
  assert.deepEqual(states, ['checking']);
});

test('verification POST timeout preserves a retryable error without resubmitting', async () => {
  let requests = 0;
  await assert.rejects(fetchVerifierJson('/api/verify-run', { method: 'POST' }, 5, async () => {
    requests++; return new Promise<Response>(() => {});
  }), /replay is saved; try again/);
  assert.equal(requests, 1);
});
