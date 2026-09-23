import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestnetReader, TESTNET_CHAIN_ID, TESTNET_GAMES, TESTNET_OWNER } from './testnet.mjs';

const RPC = 'https://robinhood-testnet.g.alchemy.com/v2/secret-for-test-only';
const NOW = Date.parse('2026-09-23T12:00:00.000Z');
const BLOCK = 123400000;
const BLOCK_HEX = `0x${BLOCK.toString(16)}`;
const WALLET_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const WALLET_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const WALLET_C = '0xcccccccccccccccccccccccccccccccccccccccc';
const word = value => BigInt(value).toString(16).padStart(64, '0');
const quantity = value => `0x${BigInt(value).toString(16)}`;
const resultUint = value => `0x${word(value)}`;
function run({ player = WALLET_A, at = '2026-09-23T10:00:00Z', claimUntil, collection = 0, difficulty = 1, claimed = false, abandoned = false } = {}) {
  const started = Date.parse(at) / 1000;
  return `0x${[BigInt(player), 1, 1234, started, claimUntil ? Date.parse(claimUntil) / 1000 : started + 1020, collection, difficulty, Number(claimed), 1, Number(abandoned)].map(word).join('')}`;
}
function fixture({ v1 = [], v2 = [], chainId = TESTNET_CHAIN_ID, reverse = true, mutate, blockTime = NOW } = {}) {
  const calls = [];
  let blockReads = 0;
  const request = async (url, options) => {
    assert.equal(url.href, RPC);
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    const payload = JSON.parse(options.body);
    calls.push(payload);
    const results = payload.map(call => {
      let value;
      switch (call.method) {
        case 'eth_chainId': value = quantity(chainId); break;
        case 'eth_blockNumber': value = BLOCK_HEX; break;
        case 'eth_getBlockByNumber':
          assert.deepEqual(call.params, [BLOCK_HEX, false]);
          blockReads++;
          value = { number: BLOCK_HEX, timestamp: quantity(blockTime / 1000), hash: `0x${'1'.repeat(64)}` };
          break;
        case 'eth_call': {
          assert.equal(call.params[1], BLOCK_HEX);
          const transaction = call.params[0];
          assert.ok(Object.values(TESTNET_GAMES).includes(transaction.to));
          const data = transaction.to === TESTNET_GAMES.v1 ? v1 : v2;
          if (transaction.data === '0x9196b700') value = resultUint(data.length);
          else {
            assert.match(transaction.data, /^0xae66f57c[0-9a-f]{64}$/);
            value = data[Number(BigInt(`0x${transaction.data.slice(10)}`)) - 1];
          }
          break;
        }
        default: assert.fail(`Unexpected/write RPC method: ${call.method}`);
      }
      return { jsonrpc: '2.0', id: call.id, result: value };
    });
    if (reverse) results.reverse();
    return new Response(JSON.stringify(mutate ? mutate(results, payload, { blockReads }) : results), { headers: { 'content-type': 'application/json' } });
  };
  return { request, calls };
}
function reader(mock, extra = {}) {
  return createTestnetReader({ rpcUrl: RPC, request: mock.request, now: () => NOW, ...extra });
}
function assertCounts(counts) {
  assert.equal(counts.startedRuns, counts.claimedRuns + counts.abandonedRuns + counts.unresolvedRuns);
  assert.equal(counts.unresolvedRuns, counts.openRuns + counts.expiredRuns);
  assert.ok(counts.uniquePlayers <= counts.startedRuns);
}

test('V1 + V2 totals dedupe wallets, exclude owner, preserve onchain states, and expose only aggregates', async () => {
  const mock = fixture({
    v1: [run({ player: TESTNET_OWNER, claimed: true }), run({ claimed: true }), run({ player: WALLET_B, collection: 1, abandoned: true })],
    v2: [run({ collection: 1, difficulty: 2, claimed: true }), run({ player: WALLET_C, at: '2026-09-23T11:55:00Z', difficulty: 0 }), run({ player: WALLET_B, collection: 1 })],
  });
  const stats = await reader(mock).read({ days: 'all', version: 'all' });
  assert.deepEqual(stats.totals, { uniquePlayers: 3, startedRuns: 5, claimedRuns: 2, abandonedRuns: 1, openRuns: 1, expiredRuns: 1, unresolvedRuns: 2 });
  assert.equal(stats.byCollection.genesis.startedRuns, 2);
  assert.equal(stats.byCollection.generations.startedRuns, 3);
  assert.equal(stats.byDifficulty.degen.claimedRuns, 1);
  assert.equal(stats.byVersion.v1.startedRuns, 2);
  assert.equal(stats.byVersion.v2.startedRuns, 3);
  assert.equal(stats.daily.length, 1);
  assert.equal(stats.daily[0].uniquePlayers, 3);
  assert.equal(stats.mode, 'testnet');
  assert.equal(stats.scope.historicalBackfill, true);
  assert.equal(stats.scope.complete, true);
  assert.equal(stats.scope.ownerExcluded, true);
  assert.deepEqual(stats.snapshot, { chainId: TESTNET_CHAIN_ID, blockNumber: BLOCK, blockTimestamp: new Date(NOW).toISOString() });
  for (const counts of [stats.totals, ...Object.values(stats.byCollection), ...Object.values(stats.byDifficulty), ...Object.values(stats.byVersion), ...stats.daily]) assertCounts(counts);
  const serialized = JSON.stringify(stats);
  for (const secret of [TESTNET_OWNER, WALLET_A, WALLET_B, WALLET_C, 'secret-for-test-only', RPC, 'tokenId']) assert.ok(!serialized.includes(secret));
  assert.ok(!Object.hasOwn(stats.totals, 'survivedRuns'), 'A claim is not mislabeled as all game wins');
});

test('UTC start-date windows include boundary and classify claim state at the pinned block', async () => {
  const mock = fixture({ v1: [
    run({ at: '2026-09-16T23:59:59Z', claimed: true }),
    run({ at: '2026-09-17T00:00:00Z', claimed: true }),
    run({ at: '2026-09-23T11:45:00Z', claimUntil: '2026-09-23T12:00:00Z' }),
  ] });
  const stats = await reader(mock).read({ days: '7', version: 'v1' });
  assert.equal(stats.window.from, '2026-09-17T00:00:00.000Z');
  assert.equal(stats.window.to, '2026-09-24T00:00:00.000Z');
  assert.equal(stats.totals.startedRuns, 2);
  assert.equal(stats.totals.openRuns, 1, 'Claim grace is inclusive at claimUntil');
  assert.equal(stats.daily.length, 7);
  assert.equal(stats.daily[0].date, '2026-09-17');
  assert.equal(stats.daily[0].startedRuns, 1);
  assert.equal(stats.daily[1].startedRuns, 0);
  assert.equal(stats.earliestObservedStart, '2026-09-17T00:00:00.000Z');
  assert.deepEqual(Object.keys(stats.byVersion), ['v1']);
  assert.ok(mock.calls.flat().filter(call => call.method === 'eth_call').every(call => call.params[0].to === TESTNET_GAMES.v1));
});

test('only-owner history is a complete zero-user result, not unavailable or leaked owner counts', async () => {
  const mock = fixture({ v1: [run({ player: TESTNET_OWNER, claimed: true })], v2: [run({ player: TESTNET_OWNER, abandoned: true })] });
  const stats = await reader(mock).read({ days: '30' });
  assert.equal(stats.totals.startedRuns, 0);
  assert.equal(stats.totals.uniquePlayers, 0);
  assert.equal(stats.earliestObservedStart, null);
  assert.equal(stats.daily.length, 30);
  assert.ok(stats.daily.every(day => day.startedRuns === 0));
});

test('wrong chain fails before any contract call', async () => {
  const mock = fixture({ chainId: 1 });
  await assert.rejects(reader(mock).read(), { code: 'testnet-chain' });
  assert.equal(mock.calls.length, 1);
});

test('bounded scan rejects excessive runCount before loading individual runs', async () => {
  const mock = fixture({ v1: [run(), run()], v2: [run()] });
  await assert.rejects(reader(mock, { maxRuns: 2 }).read(), { code: 'testnet-limit' });
  assert.ok(!mock.calls.flat().some(call => call.params?.[0]?.data?.startsWith('0xae66f57c')));
});

test('out-of-order responses are matched by ID; duplicate/missing IDs fail closed', async () => {
  const ok = fixture({ v1: [run({ claimed: true })], reverse: true });
  assert.equal((await reader(ok).read()).totals.claimedRuns, 1);
  const duplicate = fixture({ mutate: responses => responses.length > 1 ? responses.map(() => responses[0]) : responses });
  await assert.rejects(reader(duplicate).read(), { code: 'testnet-response' });
  const missing = fixture({ mutate: responses => responses.slice(1) });
  await assert.rejects(reader(missing).read(), { code: 'testnet-response' });
});

test('an RPC error or malformed run prevents partial stats and error payload disclosure', async () => {
  let fail = true;
  const mock = fixture({ v1: [run()], mutate: (responses, payload) => {
    const index = payload.findIndex(call => call.params?.[0]?.data?.startsWith('0xae66f57c'));
    if (index >= 0 && fail) return responses.map(response => response.id === payload[index].id ? { jsonrpc: '2.0', id: response.id, error: { message: `upstream ${RPC}` } } : response);
    return responses;
  } });
  const subject = reader(mock);
  await assert.rejects(subject.read(), caught => caught.code === 'testnet-rpc' && !caught.message.includes(RPC));
  fail = false;
  assert.equal((await subject.read()).totals.startedRuns, 1, 'An unsuccessful scan was not cached');
  const invalid = fixture({ v1: [run({ claimed: true, abandoned: true })] });
  await assert.rejects(reader(invalid).read(), { code: 'testnet-response' });
  const badEnum = fixture({ v1: [run({ collection: 2 })] });
  await assert.rejects(reader(badEnum).read(), { code: 'testnet-response' });
});

test('a changed block hash rejects a potentially inconsistent reorg snapshot', async () => {
  const mock = fixture({ v1: [run()], mutate: (responses, _payload, state) => state.blockReads > 1
    ? responses.map(response => ({ ...response, result: { ...response.result, hash: `0x${'2'.repeat(64)}` } })) : responses });
  await assert.rejects(reader(mock).read(), { code: 'testnet-snapshot' });
});

test('caching coalesces in-flight reads, allows filtered views, expires, and never mutates returned stats', async () => {
  let clock = NOW;
  const mock = fixture({ v1: [run()], v2: [run({ player: WALLET_B, claimed: true })] });
  const subject = reader(mock, { now: () => clock, cacheMs: 1000 });
  const [all, v2] = await Promise.all([subject.read({ days: '7' }), subject.read({ days: 'all', version: 'v2' })]);
  assert.equal(all.totals.startedRuns, 2);
  assert.equal(v2.totals.startedRuns, 1);
  assert.equal(mock.calls.length, 4, 'Only one full snapshot was fetched');
  all.totals.startedRuns = 9999;
  assert.equal((await subject.read()).totals.startedRuns, 2);
  assert.equal(mock.calls.length, 4);
  clock += 1001;
  await subject.read();
  assert.equal(mock.calls.length, 8);
});

test('overall timeout aborts in-flight requests without leaking the endpoint', async () => {
  let signal;
  const subject = createTestnetReader({ rpcUrl: RPC, timeoutMs: 15, request: async (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  } });
  await assert.rejects(subject.read(), caught => caught.code === 'testnet-timeout' && caught.message === 'testnet-timeout');
  assert.equal(signal.aborted, true);
});

test('invalid config/filters and oversized response are rejected safely', async () => {
  assert.throws(() => createTestnetReader({ rpcUrl: 'http://private.example/secret' }), { code: 'testnet-config' });
  assert.throws(() => createTestnetReader({ rpcUrl: RPC, batchSize: 101 }), { code: 'testnet-config' });
  const mock = fixture();
  await assert.rejects(reader(mock).read({ days: '8' }), { code: 'testnet-options' });
  await assert.rejects(reader(mock).read({ version: TESTNET_GAMES.v2 }), { code: 'testnet-options' });
  assert.equal(mock.calls.length, 0);
  const subject = createTestnetReader({ rpcUrl: RPC, request: async () => new Response(' '.repeat(100_001)) });
  await assert.rejects(subject.read(), { code: 'testnet-response' });
});
