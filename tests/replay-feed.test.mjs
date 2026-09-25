import assert from 'node:assert/strict';
import test from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { createReplayFeed, MAX_PUBLICATION_BYTES, REPLAY_FEED_PREFIX } from '../server/replay-feed.mjs';
import { createReplayBlobStore } from '../server/replay-feed-store.mjs';
import { createTestnetReplayBinding, PUBLIC_TESTNET_ENGINE_VERSION, PUBLIC_TESTNET_GAME } from '../server/replay-testnet.mjs';
import { createArcadeReplayBinding } from '../server/replay-arcade.mjs';
import { prepareReplayPublication, publicationPayloadHash, publicationTypedData } from '../shared/replay-publication.ts';
import { createAgentSession, runSessionToEnd, exportAgentReplay, checkAgentReplay } from '../drafts/agent-play/runner.ts';

const site = 'https://rarerush.app', testnet = 'https://testnet.rarerush.app';
const account = privateKeyToAccount(`0x${'1'.padStart(64, '0')}`);
const other = privateKeyToAccount(`0x${'2'.padStart(64, '0')}`);
const time = Date.parse('2026-09-26T12:00:00Z');
const seed = `0x${'41'.padStart(64, '0')}`;
const replay = exportAgentReplay(runSessionToEnd(createAgentSession(seed, 'degen')));
const portrait = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="white"/></svg>').toString('base64');
const base = { source: 'arcade', collection: 1, tokenId: '42', difficulty: 'degen', seed, replay,
  player: account.address, actor: 'human', art: { collection: 1, tokenId: '42', owner: account.address, chainId: 4663,
    label: 'Genesis #42', portraitUrl: portrait, bodyId: 'asymmetry' } };
function memoryStore() {
  const data = new Map(), calls = { read: 0, put: 0, list: 0 };
  return { data, calls,
    async read(path) { calls.read++; return structuredClone(data.get(path) ?? null); },
    async putIfAbsent(path, value) { calls.put++; if (data.has(path)) return false; data.set(path, structuredClone(value)); return true; },
    async list({ prefix, limit, cursor }) {
      calls.list++;
      const paths = [...data.keys()].filter(path => path.startsWith(prefix)).sort();
      const offset = Number(cursor ?? 0), end = offset + limit;
      return { blobs: paths.slice(offset, end).map(pathname => ({ pathname })), hasMore: end < paths.length, cursor: end < paths.length ? String(end) : undefined };
    },
  };
}
function fixture(options = {}) {
  const store = options.store ?? memoryStore();
  let clock = time;
  const { handle } = createReplayFeed({ store, now: () => clock, clientKey: () => '192.0.2.3',
    bindArcade: async payload => ({ chainId: 4663, tokenId: payload.tokenId, owner: payload.player.toLowerCase(), verifiedAtBlock: '100' }), ...options });
  return { store, handle, setTime(value) { clock = value; },
    post: input => new Request(site + '/api/runs', { method: 'POST', headers: { origin: site, 'content-type': 'application/json' }, body: JSON.stringify(input) }),
    get: query => new Request(site + '/api/runs' + (query ?? ''), { headers: { origin: site } }),
  };
}
async function signed(payload = base, signer = account, now = time) {
  const { expiresAt, typedData } = prepareReplayPublication(payload, now);
  return { ...payload, authorization: { expiresAt, signature: await signer.signTypedData(typedData) } };
}
async function save(f, payload = base) {
  const result = await f.handle(f.post(await signed(payload)));
  assert.equal(result.status, 200, await result.clone().text());
  return result.json();
}
function variant(number) {
  return { ...base, tokenId: String(number), art: { ...base.art, tokenId: String(number), label: `Genesis #${number}` } };
}

test('wallet-signed publication stores a canonical immutable replay, not uploaded totals or signing material', async () => {
  const f = fixture(), saved = await save(f);
  assert.match(saved.id, /^[a-f0-9]{64}$/);
  assert.deepEqual(saved.metrics, checkAgentReplay(seed, 'degen', replay));
  assert.equal(saved.actor, 'human'); assert.equal(saved.agent, 'Human player');
  assert.equal(saved.verification, 'wallet-authorized-replay');
  assert.equal('replay' in saved, false); assert.equal('art' in saved, false); assert.equal('authorization' in saved, false);
  const full = await (await f.handle(f.get('/' + saved.id))).json();
  assert.deepEqual(full.replay, replay); assert.equal(full.art.portraitUrl, portrait);
  assert.equal(full.player, account.address.toLowerCase()); assert.equal('authorization' in full, false);
  const forged = { ...base, metrics: { score: 99999999 } };
  assert.equal((await f.handle(f.post(await signed(forged)))).status, 400);
});

test('publication signatures bind source, player, actor, replay and artwork; expiry is short lived', async () => {
  const authorized = await signed();
  for (const patch of [{ actor: 'agentic' }, { player: other.address }, { seed: `0x${'2'.repeat(64)}` },
    { art: { ...base.art, label: 'Different label' } }, { replay: { ...replay, finalTick: replay.finalTick - 1 } }]) {
    assert.equal((await fixture().handle(fixture().post({ ...authorized, ...patch }))).status, patch.player ? 400 : 401);
  }
  const f = fixture();
  assert.equal((await f.handle(f.post(await signed(base, other)))).status, 401);
  assert.equal((await f.handle(f.post(await signed(base, account, time - 301_000)))).status, 401);
  assert.equal((await f.handle(f.post(await signed(base, account, time + 1000)))).status, 401);
  assert.equal((await f.handle(f.post({ ...base, authorization: undefined }))).status, 400);
  assert.equal(publicationPayloadHash(base), publicationPayloadHash({ ...base, art: { ...base.art }, authorization: authorized.authorization }));
  assert.equal(publicationTypedData(base, '123').domain.chainId, 4663);
  assert.equal(publicationTypedData({ ...base, source: 'testnet' }, '123').domain.chainId, 46630);
});

test('public Preview publishing, incomplete recordings, external artwork and unrelated fields are rejected', async () => {
  for (const patch of [{ source: 'local' }, { collection: 2 }, { tokenId: '../../data' }, { actor: 'proven-human' },
    { art: { ...base.art, owner: null } }, { art: { ...base.art, portraitUrl: 'https://evil.example/art.svg' } },
    { runId: '12' }, { replay: JSON.stringify(replay) }, { key: 'must-not-store' }]) {
    const f = fixture();
    assert.equal((await f.handle(f.post(await signed({ ...base, ...patch })))).status, 400);
    assert.equal(f.store.data.size, 0);
  }
  const f = fixture();
  const incomplete = { ...base, replay: { ...replay, finalTick: replay.finalTick - 1, inputs: { ...replay.inputs, frames: replay.inputs.frames.slice(0, -1) } } };
  assert.equal((await f.handle(f.post(await signed(incomplete)))).status, 422);
  assert.equal(f.store.data.size, 0);
});

test('duplicates retain first timestamp and retries repair an interrupted newest-first index write', async () => {
  const f = fixture(), first = await save(f), size = f.store.data.size;
  assert.deepEqual(await save(f), first); assert.equal(f.store.data.size, size);
  const index = [...f.store.data.keys()].find(path => path.includes('/newest/'));
  f.store.data.delete(index);
  assert.deepEqual(await save(f), first); assert.ok(f.store.data.has(index));
  assert.equal([...f.store.data.keys()].filter(path => path.includes('/records/')).length, 1);
});

test('durable wallet publication limits survive separate serverless instances and permit safe retries', async () => {
  const store = memoryStore();
  for (let number = 1; number <= 3; number++) await save(fixture({ store }), variant(number));
  const f = fixture({ store });
  const blocked = await f.handle(f.post(await signed(variant(4))));
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '60');
  assert.equal((await f.handle(f.post(await signed(variant(1))))).status, 200);
  f.setTime(time + 60_000);
  assert.equal((await f.handle(f.post(await signed(variant(4), account, time + 60_000)))).status, 200);
});

test('feed pagination is bounded, newest first, lightweight and isolated from private analytics', async () => {
  const f = fixture();
  const a = await save(f, variant(1));
  f.setTime(time + 1000); const b = await save(f, variant(2));
  f.setTime(time + 2000); const c = await save(f, variant(3));
  f.store.data.set('arcade-analytics/v1/secret.json', { private: true });
  const first = await (await f.handle(f.get('?limit=2'))).json();
  assert.deepEqual(first.runs.map(run => run.id), [c.id, b.id]); assert.ok(first.nextCursor);
  const second = await (await f.handle(f.get('?limit=2&cursor=' + first.nextCursor))).json();
  assert.deepEqual(second.runs.map(run => run.id), [a.id]); assert.equal(second.nextCursor, null);
  assert.ok(first.runs.every(run => !('replay' in run) && !('art' in run)));
  assert.equal((await f.handle(f.get('?limit=25'))).status, 400);
  assert.equal((await f.handle(f.get('?limit=2&limit=3'))).status, 400);
  assert.equal((await f.handle(f.get('?cursor=../../arcade-analytics'))).status, 400);
  assert.equal((await f.handle(f.get('/' + 'a'.repeat(64)))).status, 404);
});

test('Testnet accepts only a signed, canonical recording bound to the confirmed onchain identity', async () => {
  const { art: _, ...arcade } = base;
  const payload = { ...arcade, source: 'testnet', runId: '31', actor: 'autopilot' };
  let seen;
  const f = fixture({ bindTestnet: async (input, metrics) => {
    seen = { input, metrics }; return { chainId: 46630, game: PUBLIC_TESTNET_GAME, runId: '31', verifiedAtBlock: '100', engineVersion: PUBLIC_TESTNET_ENGINE_VERSION };
  } });
  const saved = await save(f, payload);
  assert.equal(saved.verification, 'testnet-start-and-replay'); assert.equal(saved.actor, 'autopilot');
  assert.equal(saved.onchain.runId, '31'); assert.equal('claimed' in saved.onchain, false);
  assert.equal(seen.input.seed, seed); assert.deepEqual(seen.metrics, saved.metrics);
  const mismatch = fixture({ bindTestnet: async () => null });
  assert.equal((await mismatch.handle(mismatch.post(await signed(payload)))).status, 422);
  assert.equal(mismatch.store.data.size, 0);
  const unavailable = fixture();
  assert.equal((await unavailable.handle(unavailable.post(await signed(payload)))).status, 503);
});

test('one immutable Testnet run anchor rejects another signed actor or recording across instances', async () => {
  const { art: _, ...arcade } = base;
  const payload = { ...arcade, source: 'testnet', runId: '31', actor: 'autopilot' };
  const store = memoryStore(), bindTestnet = async input => ({ chainId: 46630, game: PUBLIC_TESTNET_GAME,
    runId: input.runId, verifiedAtBlock: '100', engineVersion: PUBLIC_TESTNET_ENGINE_VERSION });
  const a = fixture({ store, bindTestnet }), b = fixture({ store, bindTestnet });
  const responses = await Promise.all([
    a.handle(a.post(await signed(payload))),
    b.handle(b.post(await signed({ ...payload, actor: 'agentic' }))),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const first = await responses.find(response => response.status === 200).json();
  const winningPayload = { ...payload, actor: first.actor };
  assert.deepEqual(await save(fixture({ store, bindTestnet }), winningPayload), first);
  const changedRecording = { ...winningPayload, replay: { ...replay, inputs: { ...replay.inputs,
    frames: replay.inputs.frames.map((frame, index) => index ? frame : { ...frame, slide: !frame.slide }) } } };
  assert.doesNotThrow(() => checkAgentReplay(seed, 'degen', changedRecording.replay));
  const changed = fixture({ store, bindTestnet });
  assert.equal((await changed.handle(changed.post(await signed(changedRecording)))).status, 409);
  assert.equal([...store.data.keys()].filter(path => path.includes('/records/')).length, 1);
  assert.equal([...store.data.keys()].filter(path => path.includes('/newest/')).length, 1);
  const anchor = `${REPLAY_FEED_PREFIX}/testnet/${PUBLIC_TESTNET_GAME.toLowerCase()}/31.json`;
  assert.deepEqual(store.data.get(anchor), { id: first.id });
});

test('same Testnet payload retries repair record or index failures after its immutable anchor is reserved', async () => {
  const { art: _, ...arcade } = base;
  const payload = { ...arcade, source: 'testnet', runId: '32', actor: 'human' };
  for (const failedPrefix of ['/records/', '/newest/']) {
    const store = memoryStore(), originalPut = store.putIfAbsent;
    let fail = true;
    store.putIfAbsent = async (path, value) => {
      if (fail && path.includes(failedPrefix)) { fail = false; throw new Error('Temporary storage failure'); }
      return originalPut(path, value);
    };
    const bindTestnet = async input => ({ chainId: 46630, game: PUBLIC_TESTNET_GAME,
      runId: input.runId, verifiedAtBlock: '100', engineVersion: PUBLIC_TESTNET_ENGINE_VERSION });
    const f = fixture({ store, bindTestnet });
    assert.equal((await f.handle(f.post(await signed(payload)))).status, 503);
    const id = publicationPayloadHash(payload).slice(2);
    assert.deepEqual(store.data.get(`${REPLAY_FEED_PREFIX}/testnet/${PUBLIC_TESTNET_GAME.toLowerCase()}/32.json`), { id });
    const conflicting = fixture({ store, bindTestnet });
    assert.equal((await conflicting.handle(conflicting.post(await signed({ ...payload, actor: 'agentic' })))).status, 409);
    const retry = fixture({ store, bindTestnet }), saved = await save(retry, payload);
    assert.equal(saved.id, id);
    assert.deepEqual(await save(retry, payload), saved);
    assert.equal([...store.data.keys()].filter(path => path.includes('/records/')).length, 1);
    const feed = await (await retry.handle(retry.get())).json();
    assert.deepEqual(feed.runs.map(run => run.id), [id]);
  }
});

test('explicit main/Testnet CORS works; opaque or unknown origins cannot publish', async () => {
  const f = fixture();
  const www = await f.handle(new Request('https://www.rarerush.app/api/runs', { headers: { origin: 'https://www.rarerush.app' } }));
  assert.equal(www.status, 200);
  assert.equal(www.headers.get('access-control-allow-origin'), 'https://www.rarerush.app');
  const preflight = await f.handle(new Request(site + '/api/runs', { method: 'OPTIONS', headers: { origin: testnet } }));
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), testnet);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
  for (const origin of ['null', 'https://evil.example']) {
    const request = new Request(site + '/api/runs', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(await signed()) });
    assert.equal((await f.handle(request)).status, 403);
  }
  assert.equal((await f.handle(new Request('https://evil.example/api/runs'))).status, 403);
  const native = new Request(site + '/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(await signed()) });
  assert.equal((await f.handle(native)).status, 200, 'Signed native agent clients do not need to forge a browser Origin');
});

test('unconfigured storage and secret-bearing upstream failures fail closed', async () => {
  const disabled = fixture({ storageReady: () => false });
  assert.equal((await disabled.handle(disabled.get())).status, 503); assert.equal(disabled.store.calls.list, 0);
  const store = memoryStore(); store.read = async () => { throw new Error('https://private.blob.vercel-storage.com/key?secret=token'); };
  const f = fixture({ store });
  const response = await f.handle(f.post(await signed()));
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private\.blob|secret|token/);
});

test('declared and streamed upload sizes are bounded before storage or replay work', async () => {
  for (const [length, body] of [[String(MAX_PUBLICATION_BYTES + 1), '{}'], [null, 'x'.repeat(MAX_PUBLICATION_BYTES + 1)]]) {
    const f = fixture();
    const headers = { origin: site, 'content-type': 'application/json', ...(length ? { 'content-length': length } : {}) };
    const response = await f.handle(new Request(site + '/api/runs', { method: 'POST', headers, body }));
    assert.equal(response.status, 413); assert.equal(f.store.data.size, 0);
  }
});

test('Blob adapter uses immutable private objects and enforces byte limits while reading', async () => {
  const calls = [];
  let body = '{"version":1}', declared = 13;
  const store = createReplayBlobStore({
    async get(path, options) { calls.push({ path, options }); return { statusCode: 200, blob: { size: declared }, stream: new Response(body).body }; },
    async put(path, content, options) { calls.push({ path, content, options }); },
    async list(options) { calls.push({ options }); return { blobs: [], hasMore: false }; },
  });
  assert.equal(await store.putIfAbsent(REPLAY_FEED_PREFIX + '/test.json', { version: 1 }), true);
  assert.equal(calls[0].options.access, 'private'); assert.equal(calls[0].options.allowOverwrite, false);
  assert.equal(calls[0].options.addRandomSuffix, false); assert.equal('token' in calls[0].options, false);
  assert.deepEqual(await store.read('a'), { version: 1 }); assert.equal(calls[1].options.useCache, false);
  body = 'x'.repeat(100); declared = 1;
  await assert.rejects(store.read('a', 20), /size limit/);
});

test('confirmed Testnet binding checks network, pinned engine, player, token, seed, difficulty and elapsed time', async () => {
  const payload = { ...base, source: 'testnet', runId: '1' }, metrics = checkAgentReplay(seed, 'degen', replay);
  const run = [account.address, 42n, seed, 100n, 1060n, 1, 2, false, 1n, false];
  let chain = 46630, version = PUBLIC_TESTNET_ENGINE_VERSION, timestamp = 160n;
  const seen = [];
  const client = { getChainId: async () => chain, getBlockNumber: async () => 12n,
    readContract: async query => { seen.push(query); return query.functionName === 'runs' ? run : version; },
    getBlock: async () => ({ timestamp }) };
  const bind = createTestnetReplayBinding({ client });
  assert.equal((await bind(payload, metrics)).verifiedAtBlock, '10');
  assert.ok(seen.every(query => query.blockNumber === 10n && query.address === PUBLIC_TESTNET_GAME));
  for (const patch of [{ player: other.address }, { tokenId: '43' }, { seed: `0x${'3'.repeat(64)}` }, { difficulty: 'easy' }, { collection: 0 }]) {
    assert.equal(await bind({ ...payload, ...patch }, metrics), null);
  }
  timestamp = 101n; assert.equal(await bind(payload, metrics), null);
  chain = 1; await assert.rejects(bind(payload, metrics), /chain mismatch/);
  chain = 46630; version = `0x${'0'.repeat(64)}`; await assert.rejects(bind(payload, metrics), /Pinned engine/);
});

test('Arcade publication rechecks NFT ownership and hardwired Generations eligibility on the server', async () => {
  let owner = account.address, generation = 1n, chain = 4663;
  const queries = [];
  const bind = createArcadeReplayBinding({ client: { getChainId: async () => chain, getBlockNumber: async () => 100n,
    readContract: async query => { queries.push(query); return query.functionName === 'ownerOf' ? owner : generation; } } });
  assert.equal((await bind(base)).owner, account.address.toLowerCase());
  owner = other.address; assert.equal(await bind(base), null);
  owner = account.address; generation = 0n; assert.equal(await bind({ ...base, collection: 0 }), null);
  generation = 1n; assert.equal((await bind({ ...base, collection: 0 })).chainId, 4663);
  assert.ok(queries.every(query => query.blockNumber === 100n));
  chain = 1; await assert.rejects(bind(base), /unavailable/);
  const f = fixture({ bindArcade: async () => null });
  assert.equal((await f.handle(f.post(await signed()))).status, 422); assert.equal(f.store.data.size, 0);
});
