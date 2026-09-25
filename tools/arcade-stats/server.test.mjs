import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequestHandler, parseConfig, parseTestnetConfig, sanitizeStats, sanitizeTestnetStats, UPSTREAM, TESTNET_RPC } from './server.mjs';

const key = 'unit-test-admin-key-never-render';
const counter = (startedRuns = 0, completedRuns = 0, survivedRuns = 0, uniquePlayers = 0) => ({ startedRuns, completedRuns, survivedRuns, lostRuns: completedRuns - survivedRuns, unfinishedRuns: startedRuns - completedRuns, uniquePlayers });
export const sample = (days = '7') => ({ version: 1, generatedAt: '2026-09-23T12:00:00.000Z', window: { days, from: days === 'all' ? null : '2026-09-17T00:00:00.000Z', to: '2026-09-23T12:00:00.000Z', timezone: 'UTC' }, totals: counter(21, 17, 12, 8), byCollection: { genesis: counter(9, 8, 7, 3), generations: counter(12, 9, 5, 6) }, byDifficulty: { easy: counter(4, 4, 4, 2), normal: counter(10, 8, 5, 5), degen: counter(7, 5, 3, 5) }, daily: Array.from({ length: 7 }, (_, index) => ({ date: `2026-09-${17 + index}`, ...counter(3, index < 3 ? 3 : 2, index < 5 ? 2 : 1, 2) })), earliestObservedStart: '2026-09-17T12:00:00.000Z', scope: { source: 'client-reported-arcade-events', historicalBackfill: false, ownerExcluded: true, complete: true } });
const headers = { host: '127.0.0.1:4217', 'x-rare-rush-local': '1', 'sec-fetch-site': 'same-origin' };
async function invoke(handler, url = '/stats?days=7', overrides = {}) {
  const result = { status: 200, headers: {}, body: null };
  const req = { url, method: 'GET', headers: { ...headers }, ...overrides };
  const res = { statusCode: 200, setHeader(name, value) { result.headers[name] = value; }, end(body) { result.status = this.statusCode; result.body = Buffer.isBuffer(body) ? body.toString('utf8') : body; } };
  await handler(req, res);
  return result;
}
const handler = (request = async () => Response.json(sample()), other = {}) => createRequestHandler({ configLoader: async () => ({ url: UPSTREAM, key }), request, ...other });

test('config accepts the fixed endpoint and quoted server-only key', () => {
  assert.deepEqual(parseConfig(`# local settings\nRUSH_ANALYTICS_URL=${UPSTREAM}\nRUSH_ANALYTICS_ADMIN_KEY="${key}"\nUNRELATED=discarded`), { url: UPSTREAM, key });
  assert.throws(() => parseConfig(''), { code: 'not-configured' });
  for (const url of ['https://attacker.invalid/api', 'http://rarerush.app/api/arcade-stats', `${UPSTREAM}?key=${key}`, 'https://rarerush.app@attacker.invalid/api/arcade-stats']) assert.throws(() => parseConfig(`RUSH_ANALYTICS_URL=${url}\nRUSH_ANALYTICS_ADMIN_KEY=${key}`), { code: 'invalid-config' });
  assert.throws(() => parseConfig(`RUSH_ANALYTICS_URL=${UPSTREAM}\nRUSH_ANALYTICS_ADMIN_KEY=short`), { code: 'invalid-config' });
});

test('foreign Host, Origin, cross-site browser requests and preflights never read the secret or reach upstream', async () => {
  let configReads = 0, calls = 0;
  const h = handler(async () => { calls++; return Response.json(sample()); }, { configLoader: async () => { configReads++; return { url: UPSTREAM, key }; } });
  const cases = [
    { headers: { ...headers, host: 'evil.test:4217' } },
    { headers: { ...headers, host: '127.0.0.1:4218' } },
    { headers: { ...headers, host: '127.0.0.1' } },
    { headers: { ...headers, origin: 'https://evil.test' } },
    { headers: { ...headers, origin: 'null' } },
    { headers: { ...headers, origin: 'http://localhost:9999' } },
    { headers: { ...headers, 'sec-fetch-site': 'cross-site' } },
    { headers: { ...headers, 'sec-fetch-site': 'same-site' } },
    { headers: { host: headers.host } },
    { method: 'OPTIONS' }, { method: 'POST' },
  ];
  for (const options of cases) { const r = await invoke(h, '/stats?days=7', options); assert.ok([403, 405].includes(r.status)); assert.equal(r.headers['Access-Control-Allow-Origin'], undefined); }
  assert.equal(configReads, 0); assert.equal(calls, 0);
});

test('only supported date windows and one fixed upstream path are forwarded', async () => {
  const calls = [];
  const h = handler(async (url, options) => { calls.push([url, options]); return Response.json(sample(url.searchParams.get('days'))); });
  for (const days of ['7', '30', 'all']) assert.equal((await invoke(h, `/stats?days=${days}`)).status, 200);
  for (const url of ['/stats?days=8', '/stats?days=7&days=all', '/stats?days=7&url=https://evil.test', '/stats?key=x', '//evil.test/stats', 'https://evil.test/stats']) assert.equal((await invoke(h, url)).status, 400);
  assert.equal(calls.length, 3);
  for (const [url, options] of calls) {
    assert.equal(url.origin + url.pathname, UPSTREAM); assert.equal(url.searchParams.has('key'), false);
    assert.equal(options.headers.Authorization, `Bearer ${key}`); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
  }
});

test('safe static allowlist never serves env, source files or arbitrary paths', async () => {
  const h = handler();
  for (const path of ['/.env.analytics.local', '/server.mjs', '/../../.env.analytics.local', '/%2e%2e/.env.analytics.local', '/assets/../../package.json', '/?url=/server.mjs']) { const r = await invoke(h, path); assert.equal(r.status, 404); assert.ok(!r.body.includes(key)); }
  const page = await invoke(h, '/'); assert.equal(page.status, 200); assert.match(page.headers['Content-Type'], /text\/html/); assert.ok(!page.body.includes(key));
  assert.match(page.headers['Content-Security-Policy'], /connect-src 'self'/); assert.match(page.headers['Content-Security-Policy'], /frame-ancestors 'none'/); assert.equal(page.headers['Cache-Control'], 'no-store'); assert.equal(page.headers['Cross-Origin-Resource-Policy'], 'same-origin');
});

test('unknown fields and wallet identifiers cannot leak through aggregate response', async () => {
  const payload = sample(); payload.secret = key; payload.wallets = ['0x123']; payload.totals.debug = key; payload.daily[0].adminKey = key;
  const response = await invoke(handler(async () => Response.json(payload)));
  assert.equal(response.status, 200); assert.ok(!response.body.includes(key)); assert.ok(!response.body.includes('0x123')); assert.ok(!response.body.includes('adminKey'));
  assert.deepEqual(JSON.parse(response.body), { mode: 'arcade', ...sample() });
});

test('partial, inconsistent, wrong-window and unsafe responses fail closed', async () => {
  const mutations = [p => { p.scope.complete = false; }, p => { p.scope.ownerExcluded = false; }, p => { p.scope.historicalBackfill = true; }, p => { p.window.days = 'all'; }, p => { p.totals.completedRuns = 50; }, p => { p.totals.uniquePlayers = -1; }, p => { p.byCollection.genesis = {}; }, p => { p.daily[0].date = '<script>'; }, p => { p.daily.reverse(); }, p => { p.generatedAt = 'today'; }];
  for (const mutate of mutations) { const value = sample(); mutate(value); assert.throws(() => sanitizeStats(value, '7')); const response = await invoke(handler(async () => Response.json(value))); assert.equal(response.status, 503); assert.equal(JSON.parse(response.body).code, 'invalid-response'); }
});

test('network and upstream error details remain sanitized', async () => {
  for (const request of [async () => { throw new Error(`URL included ${key}`); }, async () => new Response(key, { status: 500 }), async () => new Response(key, { status: 401 }), async () => new Response(key, { status: 403 }), async () => new Response(key, { status: 200 }), async () => new Response('x'.repeat(5000), { status: 503 })]) {
    const response = await invoke(handler(request)); assert.equal(response.status, 503); assert.ok(!response.body.includes(key)); assert.ok(JSON.parse(response.body).error.length < 200);
  }
  const response = await invoke(handler(async () => Response.json({ error: key, code: 'scan-limit' }, { status: 503 })));
  assert.equal(JSON.parse(response.body).code, 'scan-limit'); assert.ok(!response.body.includes(key));
});

test('hung fetch and hung response bodies have bounded timeouts', async () => {
  for (const request of [async () => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }))]) {
    const start = Date.now(), response = await invoke(handler(request, { timeoutMs: 20 }));
    assert.equal(response.status, 503); assert.equal(JSON.parse(response.body).code, 'timeout'); assert.ok(Date.now() - start < 500);
  }
});

test('oversized bodies are rejected before exposing any data', async () => {
  for (const response of [new Response('{}', { headers: { 'content-length': '1000001' } }), new Response('x'.repeat(1_000_001))]) {
    const result = await invoke(handler(async () => response)); assert.equal(result.status, 503); assert.equal(JSON.parse(result.body).code, 'invalid-response');
  }
});

test('missing configuration is distinguished from genuine zero activity', async () => {
  let calls = 0;
  const response = await invoke(handler(async () => { calls++; }, { configLoader: async () => parseConfig('') }));
  assert.equal(response.status, 503); assert.equal(JSON.parse(response.body).code, 'not-configured'); assert.equal(calls, 0);
  const empty = sample(); empty.totals = counter(); for (const group of [empty.byCollection, empty.byDifficulty]) for (const name of Object.keys(group)) group[name] = counter(); empty.daily = []; empty.earliestObservedStart = null;
  const success = await invoke(handler(async () => Response.json(empty))); assert.equal(success.status, 200); assert.equal(JSON.parse(success.body).totals.startedRuns, 0);
});

test('browser files contain no key reading, storage, external fetch or remote asset references', async () => {
  for (const file of ['public/index.html', 'public/app.js', 'public/style.css']) {
    const text = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.ok(!text.includes(key)); assert.doesNotMatch(text, /RUSH_ANALYTICS_ADMIN_KEY|localStorage|sessionStorage|Authorization|https:\/\//);
  }
});

test('launcher reuses only the recognized local dashboard and never requests stats', async () => {
  const { inspectDashboard } = await import('./open.mjs');
  let requested;
  assert.equal(await inspectDashboard(async (url, options) => { requested = [url, options]; return new Response('', { headers: { 'x-rare-rush-dashboard': 'arcade-stats-local-v1' } }); }), 'ready');
  assert.equal(requested[0], 'http://127.0.0.1:4217'); assert.equal(requested[1].redirect, 'error'); assert.equal(requested[1].headers, undefined);
  assert.equal(await inspectDashboard(async () => new Response('Some other service')), 'occupied');
  assert.equal(await inspectDashboard(async () => { throw Object.assign(new Error('closed'), { cause: { code: 'ECONNREFUSED' } }); }), 'closed');
  assert.equal(await inspectDashboard(async () => { throw new Error('timeout'); }), 'unavailable');
});

const chainCounter = (startedRuns = 0, claimedRuns = 0, abandonedRuns = 0, openRuns = 0, expiredRuns = 0, uniquePlayers = 0) =>
  ({ uniquePlayers, startedRuns, claimedRuns, abandonedRuns, openRuns, expiredRuns, unresolvedRuns: openRuns + expiredRuns });
function chainSample(days = '7', version = 'all') {
  const totals = chainCounter(5, 2, 1, 1, 1, 2);
  const versions = version === 'all' ? ['v1', 'v2'] : [version];
  return { version: 1, mode: 'testnet', generatedAt: '2026-09-23T12:00:00.000Z',
    window: { days, from: days === 'all' ? null : '2026-09-17T00:00:00.000Z', to: '2026-09-24T00:00:00.000Z', timezone: 'UTC' },
    selection: { version }, totals,
    byCollection: { genesis: chainCounter(2, 1, 1, 0, 0, 1), generations: chainCounter(3, 1, 0, 1, 1, 2) },
    byDifficulty: { easy: chainCounter(2, 1, 0, 1, 0, 1), normal: chainCounter(2, 1, 1, 0, 0, 2), degen: chainCounter(1, 0, 0, 0, 1, 1) },
    byVersion: Object.fromEntries(versions.map(name => [name, versions.length === 1 ? totals : name === 'v1' ? chainCounter(2, 1, 1, 0, 0, 1) : chainCounter(3, 1, 0, 1, 1, 2)])),
    daily: [{ date: '2026-09-23', ...totals }], earliestObservedStart: '2026-09-23T11:00:00.000Z',
    snapshot: { chainId: 46630, blockNumber: 123320789, blockTimestamp: '2026-09-23T12:00:00.000Z' },
    scope: { source: 'onchain-testnet-runs', historicalBackfill: true, ownerExcluded: true, complete: true, versions } };
}

test('Testnet RPC configuration is server-only and restricted to the intended network providers', () => {
  assert.deepEqual(parseTestnetConfig(''), { rpcUrl: TESTNET_RPC });
  assert.deepEqual(parseTestnetConfig('RUSH_TESTNET_RPC_URL=\nRUSH_ANALYTICS_ADMIN_KEY=ignored'), { rpcUrl: TESTNET_RPC });
  assert.deepEqual(parseTestnetConfig('RUSH_TESTNET_RPC_URL=""'), { rpcUrl: TESTNET_RPC });
  const url = 'https://robinhood-testnet.g.alchemy.com/v2/private-testnet-key';
  assert.deepEqual(parseTestnetConfig(`RUSH_TESTNET_RPC_URL="${url}"`), { rpcUrl: url });
  for (const invalid of ['http://127.0.0.1:8545', 'https://evil.test/rpc', 'https://rpc.mainnet.chain.robinhood.com', 'https://user:pass@rpc.testnet.chain.robinhood.com', 'https://rpc.testnet.chain.robinhood.com:1234', 'https://rpc.testnet.chain.robinhood.com/#key']) {
    assert.throws(() => parseTestnetConfig(`RUSH_TESTNET_RPC_URL=${invalid}`), { code: 'testnet-invalid-config' });
  }
});

test('Arcade and Testnet read only their own configuration; Testnet works without an Arcade key', async () => {
  let arcadeReads = 0, testnetReads = 0, factories = 0;
  const calls = [];
  const h = handler(undefined, {
    configLoader: async () => { arcadeReads++; return { url: UPSTREAM, key }; },
    testnetConfigLoader: async () => { testnetReads++; return { rpcUrl: TESTNET_RPC }; },
    testnetReaderFactory: ({ rpcUrl }) => { factories++; assert.equal(rpcUrl, TESTNET_RPC); return { read: async options => { calls.push(options); return chainSample(options.days, options.version); } }; },
  });
  const arcade = await invoke(h, '/stats?mode=arcade&days=7'); assert.equal(arcade.status, 200); assert.equal(JSON.parse(arcade.body).mode, 'arcade');
  assert.equal(arcadeReads, 1); assert.equal(testnetReads, 0);
  for (const version of ['all', 'v2', 'v1']) {
    const result = await invoke(h, `/stats?mode=testnet&days=all&version=${version}`);
    assert.equal(result.status, 200); assert.equal(JSON.parse(result.body).mode, 'testnet');
  }
  assert.equal(arcadeReads, 1); assert.equal(testnetReads, 3); assert.equal(factories, 1);
  assert.deepEqual(calls, ['all', 'v2', 'v1'].map(version => ({ days: 'all', version })));
});

test('unsupported or repeated game selectors cannot trigger Testnet RPC reads', async () => {
  let reads = 0;
  const h = handler(undefined, { testnetConfigLoader: async () => { reads++; return {}; } });
  for (const url of ['/stats?mode=testnet&version=v3', '/stats?mode=bad', '/stats?mode=testnet&mode=arcade', '/stats?mode=testnet&version=all&version=v2', '/stats?mode=arcade&version=all', '/stats?mode=testnet&rpcUrl=https://evil.test', '/stats?mode=testnet&days=5']) {
    assert.equal((await invoke(h, url)).status, 400);
  }
  for (const overrides of [{ headers: { ...headers, origin: 'https://evil.test' } }, { headers: { host: headers.host } }, { method: 'POST' }]) {
    assert.ok([403, 405].includes((await invoke(h, '/stats?mode=testnet', overrides)).status));
  }
  assert.equal(reads, 0);
});

test('Testnet sanitizer returns only counts and a chain snapshot without raw identities or endpoint keys', () => {
  const source = chainSample(); source.rpcUrl = 'private-rpc-key'; source.wallets = ['0x123']; source.totals.address = '0x456'; source.snapshot.secret = key;
  const clean = sanitizeTestnetStats(source, '7', 'all');
  assert.deepEqual(clean, chainSample());
  assert.doesNotMatch(JSON.stringify(clean), /private-rpc-key|0x123|0x456|unit-test-admin/);
});

test('wrong-chain, wrong-version, partial and inconsistent Testnet reports are rejected', () => {
  for (const mutate of [p => p.snapshot.chainId = 4663, p => p.snapshot.blockNumber = '123', p => p.scope.complete = false,
    p => p.scope.ownerExcluded = false, p => p.scope.historicalBackfill = false, p => p.scope.versions = ['v2'], p => p.selection.version = 'v2',
    p => p.window.days = 'all', p => p.totals.claimedRuns = 500, p => p.totals.unresolvedRuns = 30, p => p.totals.uniquePlayers = 40,
    p => delete p.byVersion.v1, p => p.daily[0].date = 'bad']) {
    const value = chainSample(); mutate(value); assert.throws(() => sanitizeTestnetStats(value, '7', 'all'));
  }
});

test('Testnet errors stay sanitized and distinct from genuine zero activity', async () => {
  for (const [readerCode, expected] of [['testnet-chain', 'testnet-wrong-chain'], ['testnet-limit', 'testnet-scan-limit'], ['testnet-timeout', 'testnet-timeout'], ['testnet-response', 'testnet-invalid-response'], ['testnet-rpc', 'testnet-unavailable']]) {
    const h = handler(undefined, { testnetConfigLoader: async () => ({ rpcUrl: TESTNET_RPC }), testnetReaderFactory: () => ({ read: async () => { throw Object.assign(new Error(`private RPC ${key}`), { code: readerCode }); } }) });
    const result = await invoke(h, '/stats?mode=testnet'); assert.equal(result.status, 503); assert.equal(JSON.parse(result.body).code, expected); assert.ok(!result.body.includes(key));
  }
  const zero = chainSample(); zero.totals = chainCounter(); zero.daily = []; zero.earliestObservedStart = null;
  for (const group of [zero.byCollection, zero.byDifficulty, zero.byVersion]) for (const name of Object.keys(group)) group[name] = chainCounter();
  const h = handler(undefined, { testnetConfigLoader: async () => ({ rpcUrl: TESTNET_RPC }), testnetReaderFactory: () => ({ read: async () => zero }) });
  const result = await invoke(h, '/stats?mode=testnet'); assert.equal(result.status, 200); assert.equal(JSON.parse(result.body).totals.startedRuns, 0);
});
