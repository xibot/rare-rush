/** Read-only, local Testnet reporting. No wallet or RPC credential leaves this module. */
export const TESTNET_CHAIN_ID = 46630;
export const TESTNET_OWNER = '0x6fd155b9d52f80e8a73a8a2537268602978486e2';
export const TESTNET_GAMES = Object.freeze({
  v1: '0x24bca5bf559e0353801f719ebc3885441cb49fd3',
  v2: '0x415b897fff5a336a8c3a527beef12440eadc6422',
});
const DEPLOYMENT_BLOCKS = { v1: 122550868, v2: 123019398 };
const DAY = 86_400_000;
const COLLECTIONS = ['genesis', 'generations'];
const DIFFICULTIES = ['easy', 'normal', 'degen'];
// Selectors and static return layout from both deployed RareRushGame contracts:
// runCount() -> uint256; runs(uint256) -> address,uint256,bytes32,uint64,
// uint64,uint8,uint8,bool,uint256,bool. No ABI/chain library is needed locally.
const RUN_COUNT = '0x9196b700';
const RUNS = '0xae66f57c';
const SAFE_CODES = new Set(['testnet-config', 'testnet-timeout', 'testnet-rpc', 'testnet-response', 'testnet-chain', 'testnet-limit', 'testnet-snapshot', 'testnet-options']);
const error = code => Object.assign(new Error(code), { code, status: code === 'testnet-options' ? 400 : 503 });
const need = (condition, code = 'testnet-response') => { if (!condition) throw error(code); };
const iso = time => new Date(time).toISOString();
const dayOf = time => iso(time).slice(0, 10);

function quantity(value) {
  need(typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value) && value.length <= 18);
  const number = Number(BigInt(value));
  need(Number.isSafeInteger(number) && number >= 0);
  return number;
}

function uint(value) {
  need(typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value));
  return BigInt(value);
}

function decodeRun(data, version, blockTime) {
  need(typeof data === 'string' && /^0x[0-9a-f]{640}$/i.test(data));
  const words = data.slice(2).match(/.{64}/g);
  need(/^0{24}[0-9a-f]{40}$/i.test(words[0]) && !/^0+$/.test(words[0]));
  const values = words.map(word => BigInt(`0x${word}`));
  const startedAt = Number(values[3]) * 1000;
  const claimUntil = Number(values[4]) * 1000;
  need(Number.isSafeInteger(startedAt) && startedAt > 0 && startedAt <= blockTime);
  need(Number.isSafeInteger(claimUntil) && claimUntil >= startedAt && claimUntil <= 8_640_000_000_000_000);
  need(values[5] <= 1n && values[6] <= 2n && values[7] <= 1n && values[9] <= 1n && !(values[7] && values[9]));
  return {
    player: `0x${words[0].slice(24)}`.toLowerCase(), version, startedAt,
    collection: COLLECTIONS[Number(values[5])], difficulty: DIFFICULTIES[Number(values[6])],
    state: values[7] ? 'claimedRuns' : values[9] ? 'abandonedRuns' : blockTime > claimUntil ? 'expiredRuns' : 'openRuns',
  };
}

function counters() {
  return { players: new Set(), startedRuns: 0, claimedRuns: 0, abandonedRuns: 0, openRuns: 0, expiredRuns: 0 };
}
function plain({ players, ...counts }) {
  return { uniquePlayers: players.size, ...counts, unresolvedRuns: counts.openRuns + counts.expiredRuns };
}
function aggregate(snapshot, days, selected, time) {
  const today = Math.floor(time / DAY) * DAY;
  const from = days === 'all' ? null : today - (Number(days) - 1) * DAY;
  const until = today + DAY;
  const versions = selected === 'all' ? ['v1', 'v2'] : [selected];
  const totals = counters();
  const collections = Object.fromEntries(COLLECTIONS.map(key => [key, counters()]));
  const difficulties = Object.fromEntries(DIFFICULTIES.map(key => [key, counters()]));
  const byVersion = Object.fromEntries(versions.map(key => [key, counters()]));
  const daily = new Map(days === 'all' ? [] : Array.from({ length: Number(days) }, (_, index) => [dayOf(from + index * DAY), counters()]));
  let earliest = null;
  for (const run of snapshot.runs) {
    if (!versions.includes(run.version) || run.player === TESTNET_OWNER || (from !== null && run.startedAt < from) || run.startedAt >= until) continue;
    const date = dayOf(run.startedAt);
    if (!daily.has(date)) daily.set(date, counters());
    earliest = earliest === null ? run.startedAt : Math.min(earliest, run.startedAt);
    for (const count of [totals, collections[run.collection], difficulties[run.difficulty], byVersion[run.version], daily.get(date)]) {
      count.players.add(run.player);
      count.startedRuns++;
      count[run.state]++;
    }
  }
  return {
    version: 1, mode: 'testnet', generatedAt: iso(snapshot.checkedAt),
    window: { days, from: from === null ? null : iso(from), to: iso(until), timezone: 'UTC' },
    selection: { version: selected }, totals: plain(totals),
    byCollection: Object.fromEntries(Object.entries(collections).map(([key, value]) => [key, plain(value)])),
    byDifficulty: Object.fromEntries(Object.entries(difficulties).map(([key, value]) => [key, plain(value)])),
    byVersion: Object.fromEntries(Object.entries(byVersion).map(([key, value]) => [key, plain(value)])),
    daily: [...daily].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, ...plain(count) })),
    earliestObservedStart: earliest === null ? null : iso(earliest),
    snapshot: { chainId: TESTNET_CHAIN_ID, blockNumber: snapshot.blockNumber, blockTimestamp: iso(snapshot.blockTime) },
    scope: { source: 'onchain-testnet-runs', historicalBackfill: true, ownerExcluded: true, complete: true, versions },
  };
}

async function limitedJson(response, maximum) {
  need(response && response.ok, 'testnet-rpc');
  need(Number(response.headers.get('content-length') ?? 0) <= maximum);
  const reader = response.body?.getReader();
  need(reader);
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw error('testnet-response'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw error('testnet-response'); }
}

/**
 * Small bounded snapshot reader. Cache and in-flight work are per reader instance;
 * raw chain rows remain only in short-lived memory, and read() exposes aggregates.
 * Fixed chain/contracts and HTTPS config cannot be changed through browser filters.
 */
export function createTestnetReader({ rpcUrl, request = fetch, now = Date.now, timeoutMs = 15_000, cacheMs = 15_000, maxRuns = 5_000, batchSize = 25 } = {}) {
  let endpoint;
  try { endpoint = new URL(rpcUrl); } catch { throw error('testnet-config'); }
  need(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && !endpoint.hash && endpoint.href.length <= 4096, 'testnet-config');
  need(typeof request === 'function' && typeof now === 'function', 'testnet-config');
  need(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60_000 && Number.isSafeInteger(cacheMs) && cacheMs >= 0 && cacheMs <= 60_000, 'testnet-config');
  need(Number.isSafeInteger(maxRuns) && maxRuns > 0 && maxRuns <= 10_000 && Number.isSafeInteger(batchSize) && batchSize > 0 && batchSize <= 100, 'testnet-config');
  const cached = new Map(), pending = new Map();
  let nextId = 0;

  async function scan(selected) {
    const abort = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { abort.abort(); reject(error('testnet-timeout')); }, timeoutMs);
    });
    async function batch(calls) {
      need(!abort.signal.aborted, 'testnet-timeout');
      const payload = calls.map(call => ({ jsonrpc: '2.0', id: ++nextId, ...call }));
      const responses = await limitedJson(await request(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload), signal: abort.signal, redirect: 'error', cache: 'no-store',
      }), 100_000);
      need(Array.isArray(responses) && responses.length === payload.length);
      const expected = new Set(payload.map(item => item.id)), results = new Map();
      for (const response of responses) {
        need(response && response.jsonrpc === '2.0' && expected.has(response.id) && !results.has(response.id));
        need(!Object.hasOwn(response, 'error'), 'testnet-rpc');
        need(Object.hasOwn(response, 'result'));
        results.set(response.id, response.result);
      }
      return payload.map(item => results.get(item.id));
    }
    async function work() {
      const versions = selected === 'all' ? ['v1', 'v2'] : [selected];
      const [chain, blockHex] = await batch([{ method: 'eth_chainId', params: [] }, { method: 'eth_blockNumber', params: [] }]);
      need(quantity(chain) === TESTNET_CHAIN_ID, 'testnet-chain');
      const blockNumber = quantity(blockHex);
      need(versions.every(version => blockNumber >= DEPLOYMENT_BLOCKS[version]), 'testnet-snapshot');
      const [block, ...counts] = await batch([
        { method: 'eth_getBlockByNumber', params: [blockHex, false] },
        ...versions.map(version => ({ method: 'eth_call', params: [{ to: TESTNET_GAMES[version], data: RUN_COUNT }, blockHex] })),
      ]);
      need(block && quantity(block.number) === blockNumber && /^0x[0-9a-f]{64}$/i.test(block.hash));
      const blockTime = quantity(block.timestamp) * 1000;
      const time = now();
      need(Number.isSafeInteger(time) && time > 0 && time <= 8_640_000_000_000_000, 'testnet-config');
      need(Number.isSafeInteger(blockTime) && blockTime > 0 && blockTime <= time + 120_000, 'testnet-snapshot');
      const runCounts = counts.map(count => uint(count));
      need(runCounts.reduce((sum, count) => sum + count, 0n) <= BigInt(maxRuns), 'testnet-limit');
      const calls = versions.flatMap((version, index) => Array.from({ length: Number(runCounts[index]) }, (_, offset) => ({
        version, method: 'eth_call', params: [{ to: TESTNET_GAMES[version], data: `${RUNS}${(offset + 1).toString(16).padStart(64, '0')}` }, blockHex],
      })));
      const runs = [];
      for (let index = 0; index < calls.length; index += batchSize) {
        const slice = calls.slice(index, index + batchSize);
        const values = await batch(slice.map(({ version: _version, ...call }) => call));
        values.forEach((value, offset) => runs.push(decodeRun(value, slice[offset].version, blockTime)));
      }
      // Number-pinned eth_call is supported by RH providers. Recheck that the same
      // canonical block still occupies that height before accepting the snapshot.
      const [confirmed] = await batch([{ method: 'eth_getBlockByNumber', params: [blockHex, false] }]);
      need(confirmed && quantity(confirmed.number) === blockNumber && confirmed.hash === block.hash && confirmed.timestamp === block.timestamp, 'testnet-snapshot');
      const checkedAt = now();
      need(Number.isSafeInteger(checkedAt) && checkedAt > 0 && checkedAt <= 8_640_000_000_000_000, 'testnet-config');
      return { runs, blockNumber, blockTime, checkedAt };
    }
    try { return await Promise.race([work(), timeout]); }
    catch (caught) { throw SAFE_CODES.has(caught?.code) ? error(caught.code) : error('testnet-rpc'); }
    finally { clearTimeout(timer); abort.abort(); }
  }

  return {
    async read({ days = '7', version = 'all' } = {}) {
      need(['7', '30', 'all'].includes(days) && ['all', 'v1', 'v2'].includes(version), 'testnet-options');
      const time = now();
      need(Number.isSafeInteger(time) && time > 0 && time <= 8_640_000_000_000_000, 'testnet-config');
      for (const [key, value] of cached) if (time - value.checkedAt >= cacheMs || time < value.checkedAt) cached.delete(key);
      let snapshot = cached.get('all') ?? cached.get(version);
      if (!snapshot) {
        const key = pending.has('all') ? 'all' : version;
        if (!pending.has(key)) {
          const task = scan(key).then(value => {
            if (cacheMs > 0) {
              cached.set(key, value);
              // Expire raw rows even when the dashboard is not refreshed again.
              const expiry = setTimeout(() => { if (cached.get(key) === value) cached.delete(key); }, cacheMs);
              expiry.unref?.();
            }
            return value;
          }).finally(() => pending.delete(key));
          pending.set(key, task);
        }
        snapshot = await pending.get(key);
      }
      return aggregate(snapshot, days, version, time);
    },
  };
}
