import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomUUID } from 'node:crypto';
import { createArcadeAnalytics, ANALYTICS_OWNER, ANALYTICS_PREFIX } from '../server/arcade-analytics.mjs';
import { createPrivateBlobStore } from '../server/arcade-analytics-store.mjs';

const site = 'https://rarerush.app';
const adminKey = 'test-admin-'.padEnd(64, 'a');
const hashKey = 'test-hashing-'.padEnd(64, 'b');
const wallet = `0x${'1'.repeat(40)}`, otherWallet = `0x${'2'.repeat(40)}`;
const baseTime = Date.parse('2026-09-25T12:00:00Z');
function memoryStore() {
  const data = new Map(), calls = { put: 0, read: 0, list: 0 };
  return { data, calls,
    async putIfAbsent(path, value) { calls.put++; if (data.has(path)) return false; data.set(path, structuredClone(value)); return true; },
    async read(path) { calls.read++; return structuredClone(data.get(path) ?? null); },
    async list({ prefix, cursor, limit }) {
      calls.list++;
      const entries = [...data.keys()].filter(path => path.startsWith(prefix)).sort();
      const offset = Number(cursor ?? 0), end = offset + limit;
      return { blobs: entries.slice(offset, end).map(pathname => ({ pathname })), hasMore: end < entries.length, cursor: end < entries.length ? String(end) : undefined };
    },
  };
}
function fixture(options = {}) {
  let time = baseTime;
  const store = options.store ?? memoryStore();
  const settings = () => ({ storageReady: true, hashKey, adminKey, ...options.settings });
  const handlers = createArcadeAnalytics({ store, settings, now: () => time, clientKey: () => '192.0.2.1', ...options });
  return { ...handlers, store, setTime(value) { time = value; }, advance(ms) { time += ms; },
    request(payload, init = {}) { return new Request(`${site}/api/arcade-events`, { method: 'POST', headers: { origin: site, 'content-type': 'application/json' }, body: JSON.stringify(payload), ...init }); },
    statsRequest(query = 'days=all', init = {}) { return new Request(`${site}/api/arcade-stats?${query}`, { headers: { authorization: `Bearer ${adminKey}` }, ...init }); },
  };
}
function start(patch = {}) { return { version: 1, type: 'start', runId: randomUUID(), wallet, collection: 'generations', difficulty: 'normal', ...patch }; }
function finish(receipt, patch = {}) { return { version: 1, type: 'finish', receipt, finishReason: 'time', elapsedSeconds: 90, ...patch }; }
async function accepted(f, payload) {
  const response = await f.events(f.request(payload));
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
async function report(f, query) {
  const response = await f.stats(f.statsRequest(query));
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

test('missing storage or secrets fails closed without writing or reading data', async () => {
  for (const settings of [{ storageReady: false }, { hashKey: undefined }, { adminKey: 'short' }]) {
    const f = fixture({ settings });
    assert.equal((await f.events(f.request(start()))).status, 503);
    assert.equal((await f.stats(f.statsRequest())).status, 503);
    assert.deepEqual(f.store.calls, { put: 0, read: 0, list: 0 });
  }
});
test('the builder wallet is always excluded before persistence, including mixed case', async () => {
  const f = fixture();
  for (const wallet of [ANALYTICS_OWNER, '0x6fD155b9D52F80E8A73a8A2537268602978486e2']) {
    assert.deepEqual(await accepted(f, start({ wallet })), { accepted: true, receipt: null, excluded: true });
  }
  assert.equal(f.store.data.size, 0);
  assert.equal(f.store.calls.put, 0);
  assert.equal((await report(f)).totals.startedRuns, 0);
});
test('only exact production origins and same-site JSON POSTs are accepted', async () => {
  const f = fixture();
  for (const origin of [null, 'null', 'https://evil.example', 'https://rarerush.app.evil.example', 'http://localhost:4173', 'https://testnet.rarerush.app']) {
    const headers = { 'content-type': 'application/json' }; if (origin !== null) headers.origin = origin;
    assert.equal((await f.events(f.request(start(), { headers }))).status, 403);
  }
  assert.equal((await f.events(f.request(start(), { headers: { origin: site, 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' } }))).status, 403);
  assert.equal((await f.events(new Request('https://evil.example/api/arcade-events', { method: 'POST', headers: { origin: site, 'content-type': 'application/json' }, body: JSON.stringify(start()) }))).status, 403);
  assert.equal((await f.events(new Request(`${site}/api/arcade-events`, { method: 'GET' }))).status, 405);
  const response = await f.events(f.request(start(), { headers: { origin: 'https://rarerush.vercel.app', 'content-type': 'application/json' } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('strict event schemas and size limits reject malformed input before persistence', async () => {
  const f = fixture();
  for (const payload of [null, [], {}, start({ version: 2 }), start({ runId: '../../escape' }), start({ wallet: '0x123' }),
    start({ wallet: `0x${'0'.repeat(40)}` }), start({ difficulty: '__proto__' }), start({ difficulty: ['normal'] }), start({ difficulty: {} }), start({ collection: 'testnet' }), start({ extra: 'unexpected' })]) {
    assert.equal((await f.events(f.request(payload))).status, 400);
  }
  assert.equal((await f.events(f.request(start(), { body: '{' }))).status, 400);
  assert.equal((await f.events(f.request(start(), { body: 'x'.repeat(2049) }))).status, 413);
  assert.equal((await f.events(f.request(start(), { headers: { origin: site, 'content-type': 'text/plain' } }))).status, 415);
  assert.equal((await f.events(f.request(start(), { headers: { origin: site, 'content-type': 'application/json', 'content-encoding': 'gzip' } }))).status, 415);
  assert.equal(f.store.data.size, 0);
});
test('stored data and receipts contain only keyed wallet IDs; aggregate JSON reveals neither ID nor raw wallet/IP', async () => {
  const f = fixture(), payload = start();
  const receipt = (await accepted(f, payload)).receipt;
  const decoded = JSON.parse(Buffer.from(receipt.split('.')[0], 'base64url').toString());
  assert.match(decoded.walletId, /^[a-f0-9]{64}$/);
  assert.notEqual(decoded.walletId, wallet.slice(2));
  const saved = JSON.stringify([...f.store.data]);
  for (const forbidden of [wallet, '192.0.2.1', hashKey, adminKey]) assert.equal(saved.includes(forbidden), false);
  const result = JSON.stringify(await report(f));
  for (const forbidden of [wallet, decoded.walletId, 'walletId', '192.0.2.1', '.blob.vercel-storage.com']) assert.equal(result.includes(forbidden), false);
});
test('same-run retries return the original receipt and avoid repeated warm writes', async () => {
  const f = fixture(), payload = start();
  const first = await accepted(f, payload);
  f.advance(1000);
  assert.deepEqual(await accepted(f, payload), first);
  assert.equal(f.store.calls.put, 2, 'one immutable anchor and one index');
  const cold = fixture({ store: f.store }); cold.advance(5000);
  assert.deepEqual(await accepted(cold, payload), first);
  assert.equal((await report(cold)).totals.startedRuns, 1);
});
test('a run ID cannot change wallet, collection or difficulty', async () => {
  const f = fixture(), payload = start(); await accepted(f, payload);
  for (const patch of [{ wallet: otherWallet }, { collection: 'genesis' }, { difficulty: 'degen' }]) {
    assert.equal((await f.events(f.request({ ...payload, ...patch }))).status, 409);
  }
  assert.equal(f.store.data.size, 2);
});
test('concurrent instances use immutable anchors rather than lost-update counters', async () => {
  const store = memoryStore(), a = fixture({ store }), b = fixture({ store });
  b.advance(10);
  const payload = start();
  const [first, second] = await Promise.all([accepted(a, payload), accepted(b, payload)]);
  assert.equal(first.receipt, second.receipt);
  assert.equal((await report(a)).totals.startedRuns, 1);
  assert.equal(store.data.size, 2);
});
test('a retry repairs an index failure using the original start time and receipt', async () => {
  const store = memoryStore(), put = store.putIfAbsent;
  let fail = true;
  store.putIfAbsent = async (path, value) => {
    if (fail && path.includes('/events/')) { fail = false; throw new Error('storage unavailable'); }
    return put(path, value);
  };
  const f = fixture({ store }), payload = start();
  assert.equal((await f.events(f.request(payload))).status, 503);
  f.advance(2000);
  const receipt = (await accepted(f, payload)).receipt;
  assert.equal(JSON.parse(Buffer.from(receipt.split('.')[0], 'base64url').toString()).startedAt, baseTime);
  assert.equal((await report(f)).totals.startedRuns, 1);
});
test('finish requires a valid receipt, sensible elapsed time and an allowed result', async () => {
  const f = fixture();
  const receipt = (await accepted(f, start())).receipt;
  for (const payload of [finish(`${receipt}x`), finish('no-signature'), finish(receipt, { finishReason: 'win' }),
    finish(receipt, { elapsedSeconds: 0 }), finish(receipt, { elapsedSeconds: 300 }), finish(receipt, { elapsedSeconds: null }),
    finish(receipt, { extra: 1 }), finish(receipt)]) {
    assert.equal((await f.events(f.request(payload))).status, 400);
  }
  assert.equal(f.store.data.size, 2);
  f.advance(90_000);
  assert.deepEqual(await accepted(f, finish(receipt)), { accepted: true });
  const totals = (await report(f)).totals;
  assert.equal(totals.completedRuns, 1); assert.equal(totals.survivedRuns, 1);
});
test('receipt tampering and expired receipts cannot create completions', async () => {
  const f = fixture();
  const receipt = (await accepted(f, start())).receipt;
  const [body, signature] = receipt.split('.');
  const modified = { ...JSON.parse(Buffer.from(body, 'base64url').toString()), difficulty: 'easy' };
  const changed = `${Buffer.from(JSON.stringify(modified)).toString('base64url')}.${signature}`;
  f.advance(120_000);
  assert.equal((await f.events(f.request(finish(changed, { elapsedSeconds: 120 })))).status, 400);
  f.advance(6 * 60 * 60 * 1000);
  assert.equal((await f.events(f.request(finish(receipt)))).status, 400);
  assert.equal(f.store.data.size, 2);
});
test('advisory elapsed validation tolerates a delayed initial telemetry report', async () => {
  const f = fixture();
  const receipt = (await accepted(f, start())).receipt;
  f.advance(74_000);
  assert.equal((await f.events(f.request(finish(receipt)))).status, 400);
  f.advance(1000);
  assert.deepEqual(await accepted(f, finish(receipt)), { accepted: true });
});
test('builder exclusion also protects a validly signed historical receipt', async () => {
  const f = fixture();
  const pseudo = createHmac('sha256', hashKey).update(`arcade-wallet-v1\0${ANALYTICS_OWNER}`).digest('hex');
  const metadata = { version: 1, runId: randomUUID(), walletId: pseudo, startedAt: baseTime - 90_000, collection: 'genesis', difficulty: 'normal' };
  const body = Buffer.from(JSON.stringify(metadata)).toString('base64url');
  const signature = createHmac('sha256', hashKey).update(`arcade-receipt-v1\0${body}`).digest('hex');
  assert.equal((await f.events(f.request(finish(`${body}.${signature}`)))).status, 400);
  assert.equal(f.store.data.size, 0);
});
test('duplicate completions are idempotent and cannot change survived into lost', async () => {
  const f = fixture();
  const receipt = (await accepted(f, start())).receipt;
  f.advance(90_000);
  await accepted(f, finish(receipt)); await accepted(f, finish(receipt));
  assert.equal(f.store.calls.put, 4);
  assert.equal((await f.events(f.request(finish(receipt, { finishReason: 'hearts', elapsedSeconds: 80 })))).status, 409);
  const cold = fixture({ store: f.store }); cold.advance(91_000);
  await accepted(cold, finish(receipt));
  assert.equal((await report(cold)).totals.completedRuns, 1);
});
test('aggregation counts starts, finishes, unique wallets and collection/mode/day breakdowns', async () => {
  const f = fixture();
  const first = await accepted(f, start({ collection: 'genesis', difficulty: 'easy' }));
  const second = await accepted(f, start({ difficulty: 'degen' }));
  await accepted(f, start({ wallet: otherWallet }));
  f.advance(120_000);
  await accepted(f, finish(first.receipt, { elapsedSeconds: 120 }));
  await accepted(f, finish(second.receipt, { elapsedSeconds: 35, finishReason: 'hearts' }));
  const summary = await report(f);
  assert.deepEqual(summary.totals, { uniquePlayers: 2, startedRuns: 3, completedRuns: 2, survivedRuns: 1, lostRuns: 1, unfinishedRuns: 1 });
  assert.equal(summary.byCollection.genesis.survivedRuns, 1);
  assert.equal(summary.byCollection.generations.uniquePlayers, 2);
  assert.equal(summary.byDifficulty.easy.completedRuns, 1);
  assert.equal(summary.byDifficulty.degen.lostRuns, 1);
  assert.equal(summary.byDifficulty.normal.unfinishedRuns, 1);
  assert.equal(summary.daily[0].date, '2026-09-25');
  assert.equal(summary.earliestObservedStart, new Date(baseTime).toISOString());
  assert.deepEqual(summary.scope, { source: 'client-reported-arcade-events', historicalBackfill: false, ownerExcluded: true, complete: true });
  assert.equal(f.store.calls.read, 0, 'reports list signed indexes, not every event body');
});
test('UTC report windows filter by start date and include zeros for quiet days', async () => {
  const f = fixture();
  f.setTime(Date.parse('2026-09-18T23:59:59Z')); await accepted(f, start());
  f.setTime(Date.parse('2026-09-19T00:00:00Z')); await accepted(f, start());
  f.setTime(baseTime);
  const summary = await report(f, 'days=7');
  assert.equal(summary.window.from, '2026-09-19T00:00:00.000Z');
  assert.equal(summary.window.to, '2026-09-26T00:00:00.000Z');
  assert.equal(summary.daily.length, 7);
  assert.equal(summary.totals.startedRuns, 1);
  assert.equal(summary.daily.at(-1).startedRuns, 0);
  assert.equal(f.store.calls.list, 1, 'one monthly prefix instead of seven daily requests');
  assert.equal((await report(f, 'days=30')).totals.startedRuns, 2);
  assert.equal(f.store.calls.list, 3, 'the 30-day window spans two month prefixes');
});
test('month scans retain exact date boundaries, including a three-month February window', async () => {
  const f = fixture();
  for (const date of ['2026-01-30', '2026-01-31', '2026-02-01', '2026-03-01', '2026-03-02']) {
    f.setTime(Date.parse(`${date}T00:00:00Z`)); await accepted(f, start());
  }
  f.setTime(Date.parse('2026-03-01T12:00:00Z'));
  const summary = await report(f, 'days=30');
  assert.equal(summary.window.from, '2026-01-31T00:00:00.000Z');
  assert.equal(summary.totals.startedRuns, 3);
  assert.equal(summary.daily.length, 30);
  assert.equal(f.store.calls.list, 3);
});
test('one scan deadline bounds all pagination and aborts stalled storage without partial results', async () => {
  const store = memoryStore(); let signal;
  store.list = async (options) => { signal = options.abortSignal; return new Promise(() => {}); };
  const f = fixture({ store, maxScanMs: 15 });
  const response = await f.stats(f.statsRequest('days=30'));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'storage-timeout');
  assert.equal(signal.aborted, true);
});
test('admin authorization is required even for cached reports; no public CORS', async () => {
  const f = fixture(); await report(f);
  const previousLists = f.store.calls.list;
  for (const authorization of ['', 'Bearer wrong', `bearer ${adminKey}`]) {
    const response = await f.stats(f.statsRequest('days=all', { headers: { authorization } }));
    assert.equal(response.status, 401); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  assert.equal((await f.stats(f.statsRequest('days=all', { headers: { authorization: `Bearer ${adminKey}`, origin: 'https://evil.example' } }))).status, 403);
  assert.equal(f.store.calls.list, previousLists);
  assert.equal((await f.stats(new Request(`${site}/api/arcade-stats`, { method: 'POST' }))).status, 405);
});
test('invalid stats windows are rejected and bounded scans never return partial totals', async () => {
  const f = fixture({ maxEvents: 2 });
  for (const query of ['days=1', 'days=-1', 'days=7&days=30', 'days=all&secret=true']) {
    assert.equal((await f.stats(f.statsRequest(query))).status, 400);
  }
  await accepted(f, start()); await accepted(f, start()); await accepted(f, start());
  const response = await f.stats(f.statsRequest());
  assert.equal(response.status, 503); assert.equal((await response.json()).code, 'scan-limit');
  assert.equal(f.store.calls.list, 1);
});
test('forged index names and orphan completions do not count as played runs', async () => {
  const f = fixture();
  const receipt = (await accepted(f, start())).receipt; f.advance(90_000);
  await accepted(f, finish(receipt));
  for (const key of [...f.store.data.keys()]) if (key.includes('/events/') && key.includes('/start/')) {
    const body = f.store.data.get(key); f.store.data.delete(key);
    f.store.data.set(key.replace(/\.[a-f0-9]{64}\.json$/, `.${'0'.repeat(64)}.json`), body);
  }
  assert.equal((await report(f)).totals.startedRuns, 0);
});
test('per-wallet event limits bound scripted starts and do not store raw request identifiers', async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) await accepted(f, start());
  const response = await f.events(f.request(start()));
  assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(f.store.data.size, 40);
  f.advance(60_000); await accepted(f, start());
});
test('storage failures never serialize secret-bearing upstream error messages', async () => {
  const store = memoryStore(); store.putIfAbsent = async () => { throw new Error(`private token ${hashKey} https://private.blob.vercel-storage.com`); };
  const f = fixture({ store });
  const response = await f.events(f.request(start()));
  assert.equal(response.status, 503);
  assert.equal(await response.text(), '{"error":"Analytics is temporarily unavailable."}');
});
test('private Blob adapter always uses immutable private writes and uncached authenticated reads', async () => {
  const calls = [];
  const store = createPrivateBlobStore({
    async put(path, body, options) { calls.push({ path, body, options }); },
    async get(path, options) { calls.push({ path, options }); return { statusCode: 200, blob: { size: 13 }, stream: new Response('{"version":1}').body }; },
    async list(options) { calls.push({ options }); return { blobs: [], hasMore: false }; },
  });
  assert.equal(await store.putIfAbsent(`${ANALYTICS_PREFIX}/test.json`, { version: 1 }), true);
  assert.equal(calls[0].options.access, 'private'); assert.equal(calls[0].options.addRandomSuffix, false); assert.equal(calls[0].options.allowOverwrite, false);
  assert.equal('token' in calls[0].options, false, 'SDK manages OIDC/static credential resolution');
  assert.deepEqual(await store.read('a'), { version: 1 });
  assert.equal(calls[1].options.access, 'private'); assert.equal(calls[1].options.useCache, false);
  await store.list({ prefix: 'a', limit: 100 }); assert.equal(calls[2].options.mode, 'expanded');
  const controller = new AbortController();
  await store.list({ prefix: 'a', limit: 100, abortSignal: controller.signal });
  controller.abort(); assert.equal(calls[3].options.abortSignal.aborted, true);
});
test('an ambiguous or duplicate Blob put succeeds only when the exact private object exists', async () => {
  let present = true;
  const store = createPrivateBlobStore({
    async put() { throw new Error('duplicate or lost response'); },
    async get() { return present ? { statusCode: 200, blob: { size: 13 }, stream: new Response('{"version":1}').body } : null; },
  });
  assert.equal(await store.putIfAbsent('a', { version: 1 }), false);
  present = false;
  await assert.rejects(store.putIfAbsent('a', { version: 1 }), /duplicate or lost response/);
});
