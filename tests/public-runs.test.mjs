import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { findPublishedRun, publishRun, readRunServiceResponse, RunPublicationError, runPublicationMessage, MAX_PUBLIC_REPLAY_PAYLOAD_BYTES } from '../games/rare-rush/public-runs.ts';
import { createHumanRecording, advanceHumanRecording, exportHumanReplay } from '../games/rare-rush/replay-recorder.ts';
import { publicationPayloadHash } from '../shared/replay-publication.ts';
import { createReplayFeed } from '../server/replay-feed.mjs';

const account = privateKeyToAccount(`0x${'1'.padStart(64, '0')}`);
const other = privateKeyToAccount(`0x${'2'.padStart(64, '0')}`);
const seed = `0x${'41'.padStart(64, '0')}`;
const recording = createHumanRecording(seed, 'degen');
while (recording.run.status === 'running') advanceHumanRecording(recording, 0);
const replay = exportHumanReplay(recording);
const base = { source: 'arcade', actor: 'human', collection: 0, tokenId: '7', difficulty: 'degen', seed,
  replay, player: account.address, art: { collection: 0, tokenId: '7', owner: account.address, chainId: 4663,
    label: 'Generations #7', sprites: { familyId: 0, seed: 41, frames: Array(64).fill(0n) } } };
const normalize = value => JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item));
function wallet(options = {}) {
  const calls = [], state = { address: account.address, chain: '0x1237', reject: false, ...options };
  return { calls, state, async request({ method, params }) {
    calls.push(method);
    if (method === 'eth_accounts') return [state.address];
    if (method === 'eth_chainId') return state.chain;
    if (method === 'eth_signTypedData_v4') {
      assert.equal(params[0].toLowerCase(), account.address.toLowerCase());
      if (state.reject) throw Object.assign(new Error('User rejected'), { code: 4001 });
      const typed = JSON.parse(params[1]);
      assert.equal(typed.domain.name, 'RareRushPublicReplay');
      assert.equal(typed.message.site, 'https://rarerush.app');
      if (state.onSign) await state.onSign();
      return (state.signer ?? account).signTypedData(typed);
    }
    assert.fail(`Unexpected wallet method: ${method}`);
  } };
}
function server() {
  const records = new Map(); let posts = 0, gets = 0;
  const { handle } = createReplayFeed({ store: {
    async read(path) { return structuredClone(records.get(path) ?? null); },
    async putIfAbsent(path, value) { if (records.has(path)) return false; records.set(path, structuredClone(value)); return true; },
    async list() { return { blobs: [], hasMore: false }; },
  }, clientKey: () => 'test-client',
  bindArcade: async () => ({ chainId: 4663, owner: account.address }),
  bindTestnet: async payload => ({ chainId: 46630, game: '0x3333333333333333333333333333333333333333', runId: payload.runId }) });
  return { records, get posts() { return posts; }, get gets() { return gets; }, fetcher: async (url, init) => {
    assert.equal(init.credentials, 'omit');
    if (init.method === 'POST') posts++;
    else { assert.equal(init.method, 'GET'); assert.equal(init.cache, 'no-store'); gets++; }
    return handle(new Request(new URL(url, 'https://rarerush.app'), { ...init, headers: { ...init.headers, origin: 'https://rarerush.app' } }));
  } };
}

test('human run signs exact serialized art + replay once, and retry finds the same saved record', async () => {
  const f = server(), provider = wallet();
  const saved = await publishRun(base, provider, '/api/runs', { fetcher: f.fetcher });
  assert.equal(saved.id, publicationPayloadHash(normalize(base)).slice(2));
  assert.equal(saved.metrics.score, recording.run.score);
  assert.equal(saved.metrics.outcome, 'lost');
  assert.equal(saved.actor, 'human');
  assert.equal(saved.replay, undefined);
  const again = await publishRun(base, provider, '/api/runs', { fetcher: f.fetcher });
  assert.equal(again.id, saved.id); assert.equal(again.createdAt, saved.createdAt);
  const stored = [...f.records.entries()].filter(([path]) => path.includes('/records/'));
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0][1].art.sprites.frames, Array(64).fill('0'));
  assert.equal(f.posts, 1); assert.equal(f.gets, 2);
  assert.equal(provider.calls.filter(method => method === 'eth_signTypedData_v4').length, 1);
  assert(provider.calls.every(method => ['eth_accounts', 'eth_chainId', 'eth_signTypedData_v4'].includes(method)));
});

test('Testnet publication uses original chain/run/player and does not claim or send transactions', async () => {
  const { art, ...common } = base;
  const payload = { ...common, source: 'testnet', runId: '15' };
  const f = server(), provider = wallet({ chain: '0xb626' });
  const saved = await publishRun(payload, provider, 'https://rarerush.app/api/runs', { fetcher: f.fetcher });
  assert.equal(saved.source, 'testnet'); assert.equal(saved.runId, '15');
  assert.equal(saved.verification, 'testnet-start-and-replay');
  assert(!provider.calls.some(method => method.includes('Transaction')));
  const reopenedWallet = wallet({ address: other.address, chain: '0x1' });
  const reopened = await publishRun(payload, reopenedWallet, 'https://rarerush.app/api/runs', { fetcher: f.fetcher });
  assert.equal(reopened.id, saved.id); assert.equal(reopened.createdAt, saved.createdAt);
  assert.deepEqual(reopenedWallet.calls, []);
  assert.equal(f.posts, 1);
  assert.equal(provider.calls.filter(method => method === 'eth_signTypedData_v4').length, 1);
});

test('read-only lookup recognizes an older saved run with no local saved ID or authorization', async () => {
  const f = server();
  const saved = await publishRun(base, wallet(), undefined, { fetcher: f.fetcher });
  const path = [...f.records.keys()].find(path => path.includes('/records/'));
  const record = f.records.get(path);
  record.createdAt = '2025-01-01T00:00:00.000Z';
  const oldIndex = [...f.records.keys()].find(path => path.includes('/newest/'));
  const index = f.records.get(oldIndex); index.createdAt = record.createdAt;
  f.records.delete(oldIndex);
  f.records.set(`public-runs/v1/newest/${String(9_999_999_999_999 - Date.parse(record.createdAt)).padStart(13, '0')}.${record.id}.json`, index);
  assert.equal(record.authorization, undefined);
  const found = await findPublishedRun(base, 'https://rarerush.app/api/runs/', { fetcher: f.fetcher });
  assert.equal(found.id, saved.id); assert.equal(found.createdAt, record.createdAt);
  assert.equal(f.posts, 1);
});

test('an incomplete feed index remains retryable until the public save is complete', async () => {
  const f = server(), provider = wallet();
  const saved = await publishRun(base, provider, undefined, { fetcher: f.fetcher });
  f.records.delete([...f.records.keys()].find(path => path.includes('/newest/')));
  assert.equal(await findPublishedRun(base, undefined, { fetcher: f.fetcher }), null);
  const repaired = await publishRun(base, provider, undefined, { fetcher: f.fetcher });
  assert.equal(repaired.id, saved.id); assert.equal(repaired.createdAt, saved.createdAt);
  await publishRun(base, provider, undefined, { fetcher: f.fetcher });
  assert.equal(f.posts, 2);
  assert.equal(provider.calls.filter(method => method === 'eth_signTypedData_v4').length, 2);
});

test('only a missing-record 404 permits a new save; lost POST responses retry without another signature', async () => {
  const f = server(), provider = wallet();
  assert.equal(await findPublishedRun(base, undefined, { fetcher: f.fetcher }), null);
  let loseResponse = true;
  const fetcher = async (url, init) => {
    const response = await f.fetcher(url, init);
    if (init.method === 'POST' && loseResponse) { loseResponse = false; throw new Error('connection closed'); }
    return response;
  };
  await assert.rejects(publishRun(base, provider, undefined, { fetcher }), /could not be published/);
  const saved = await publishRun(base, provider, undefined, { fetcher });
  assert.equal(saved.id, publicationPayloadHash(normalize(base)).slice(2));
  assert.equal(f.posts, 1);
  assert.equal(provider.calls.filter(method => method === 'eth_signTypedData_v4').length, 1);
  assert.equal(await findPublishedRun(base, undefined, { fetcher: async () => new Response('', { status: 404 }) }), null);
});

test('failed saved-run lookup never touches the wallet or posts', async () => {
  for (const status of [401, 403, 408, 429, 500, 503]) {
    const provider = wallet();
    await assert.rejects(publishRun(base, provider, undefined, { fetcher: async (_url, init) => {
      assert.equal(init.method, 'GET');
      return new Response('<html>private failure</html>', { status });
    } }), /temporarily unavailable/);
    assert.deepEqual(provider.calls, []);
  }
  const provider = wallet();
  await assert.rejects(publishRun(base, provider, undefined, { fetcher: async () => { throw new Error('https://private.example/secret'); } }),
    error => error instanceof RunPublicationError && !error.message.includes('secret'));
  assert.deepEqual(provider.calls, []);
});

test('aborted or stale saved-run lookups cannot prompt or return a saved run', async () => {
  for (const status of [404, 200]) {
    const controller = new AbortController(), provider = wallet();
    await assert.rejects(publishRun(base, provider, undefined, { signal: controller.signal, fetcher: async () => {
      controller.abort();
      return Response.json({ ...normalize(base), id: publicationPayloadHash(normalize(base)).slice(2) }, { status });
    } }), /cancelled/);
    assert.deepEqual(provider.calls, []);
    let stale = false;
    await assert.rejects(publishRun(base, provider, undefined, {
      assertActive() { if (stale) throw new Error('https://private.example/secret'); },
      fetcher: async () => { stale = true; return Response.json({}, { status }); },
    }), /could not be checked/);
    assert.deepEqual(provider.calls, []);
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(findPublishedRun(base, undefined, { signal: controller.signal,
    fetcher: async () => assert.fail('An already-cancelled lookup must not fetch'), }), /cancelled/);
});

test('a hung saved-run lookup times out without touching the wallet', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const provider = wallet(); let requestSignal;
  const pending = publishRun(base, provider, undefined, { fetcher: async (_url, init) => {
    requestSignal = init.signal;
    return new Promise(() => {});
  } });
  const rejected = assert.rejects(pending, /Checking saved runs timed out/);
  t.mock.timers.tick(20_000);
  await rejected;
  assert.equal(requestSignal.aborted, true);
  assert.deepEqual(provider.calls, []);
});

test('wrong account or chain fails before prompting; a wallet changed during signing never posts', async () => {
  const f = server();
  for (const options of [{ address: other.address }, { chain: '0xb626' }]) {
    const provider = wallet(options);
    await assert.rejects(publishRun(base, provider, undefined, { fetcher: f.fetcher }), /wallet|network/);
    assert(!provider.calls.includes('eth_signTypedData_v4'));
  }
  const provider = wallet(); provider.state.onSign = () => { provider.state.address = other.address; };
  await assert.rejects(publishRun(base, provider, undefined, { fetcher: f.fetcher }), /wallet/);
  assert.equal(f.posts, 0);
});

test('declined signature retains replay and permits explicit retry; incompatible signatures never upload', async () => {
  const f = server(), provider = wallet({ reject: true }), before = JSON.stringify(replay);
  await assert.rejects(publishRun(base, provider, undefined, { fetcher: f.fetcher }), /Signature declined/);
  assert.equal(f.posts, 0); assert.equal(JSON.stringify(replay), before);
  provider.state.reject = false;
  await publishRun(base, provider, undefined, { fetcher: f.fetcher });
  const missing = server();
  await assert.rejects(publishRun(base, wallet({ signer: other }), undefined, { fetcher: missing.fetcher }), /compatible signature/);
  assert.equal(missing.posts, 0);
  assert.equal(f.posts, 1);
});

test('aborted or stale selection after signing cannot post; provider errors never expose raw secrets', async () => {
  const f = server(), controller = new AbortController();
  await assert.rejects(publishRun(base, wallet({ onSign: () => controller.abort() }), undefined,
    { signal: controller.signal, fetcher: f.fetcher }), /cancelled/);
  let stale = false;
  await assert.rejects(publishRun(base, wallet({ onSign: () => { stale = true; } }), undefined,
    { assertActive() { if (stale) throw new Error('https://private.example/api/secret'); }, fetcher: f.fetcher }), /could not be published/);
  assert.equal(f.posts, 0);
  assert(!runPublicationMessage(new Error('https://private.example/api/secret')).includes('secret'));
});

test('payload/response bounds and exact content identity protect the saved link', async () => {
  let prompts = 0;
  await assert.rejects(publishRun({ ...base, seed: 'x'.repeat(MAX_PUBLIC_REPLAY_PAYLOAD_BYTES) },
    { async request() { prompts++; } }), /too large/);
  assert.equal(prompts, 0);
  const afterMissing = response => async (_url, init) => init.method === 'GET' ? new Response(null, { status: 404 }) : response;
  await assert.rejects(publishRun(base, wallet(), undefined, { fetcher: afterMissing(new Response('x'.repeat(16_385))) }), /invalid response/);
  const { replay: _, art: __, ...metadata } = base;
  await assert.rejects(publishRun(base, wallet(), undefined, { fetcher: afterMissing(Response.json({ ...metadata, id: '0'.repeat(64) })) }), /different run/);
  await assert.rejects(publishRun(base, wallet(), undefined, { fetcher: async () => Response.json({ error: 'https://private.example/secret' }, { status: 503 }) }), error => !error.message.includes('secret'));
});

test('lookup uses the normalized content ID and supports bounded older detail responses', async () => {
  const payload = normalize(base), id = publicationPayloadHash(payload).slice(2);
  const detail = { ...payload, id, extra: 'x'.repeat(20_000) };
  assert.deepEqual(await findPublishedRun(base, undefined, { fetcher: async (url, init) => {
    assert.equal(url, `/api/runs/${id}?publication=1`);
    assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit');
    assert.equal(init.body, undefined);
    return Response.json(detail);
  } }), detail);
  await assert.rejects(findPublishedRun({ ...base, seed: 'x'.repeat(MAX_PUBLIC_REPLAY_PAYLOAD_BYTES) }, undefined,
    { fetcher: async () => assert.fail('Oversized input must not fetch') }), /too large/);
  await assert.rejects(findPublishedRun(base, undefined,
    { fetcher: async () => Response.json({ ...detail, extra: 'x'.repeat(2_500_000) }) }), /invalid response/);
});

test('lookup rejects mismatched record identity before accessing the wallet', async () => {
  const payload = normalize(base), expected = { ...payload, id: publicationPayloadHash(payload).slice(2) };
  for (const change of [{ id: '0'.repeat(64) }, { source: 'testnet' }, { tokenId: '8' }, { collection: 1 },
    { seed: `0x${'42'.padStart(64, '0')}` }, { difficulty: 'easy' }, { player: other.address },
    { runId: '15' }, { actor: 'autopilot' }]) {
    const provider = wallet();
    await assert.rejects(publishRun(base, provider, undefined,
      { fetcher: async () => Response.json({ ...expected, ...change }) }), /different run/);
    assert.deepEqual(provider.calls, []);
  }
});

test('hosting startup errors show a friendly retry message for feed reads and publication', async () => {
  for (const body of ['A server error has occurred\nFUNCTION_INVOCATION_FAILED', '<html><body>Bad Gateway</body></html>', '']) {
    await assert.rejects(readRunServiceResponse(new Response(body, { status: 500 })), error => {
      assert(error instanceof RunPublicationError);
      assert.equal(error.message, 'The run service is temporarily unavailable. Please try again.');
      return true;
    });
  }
  const before = JSON.stringify(replay);
  await assert.rejects(publishRun(base, wallet(), undefined, {
    fetcher: async () => new Response('A server error has occurred\nFUNCTION_INVOCATION_FAILED', { status: 500 }),
  }), error => {
    assert(error instanceof RunPublicationError);
    assert.equal(error.message, 'The run service is temporarily unavailable. Please try again.');
    return true;
  });
  assert.equal(JSON.stringify(replay), before);
  const f = server();
  assert.equal((await publishRun(base, wallet(), undefined, { fetcher: f.fetcher })).id, publicationPayloadHash(normalize(base)).slice(2));
});

test('shared run response reader retains safe API errors and bounds malformed or excessive bodies', async () => {
  await assert.rejects(readRunServiceResponse(Response.json({ error: 'Replay not found.' }, { status: 404 })), /Replay not found\./);
  for (const body of ['{', 'null', '[]', '42']) {
    await assert.rejects(readRunServiceResponse(new Response(body)), /invalid response.*try again/i);
  }
  await assert.rejects(readRunServiceResponse(new Response('x'.repeat(21)), { maxBytes: 20 }), /invalid response/);
  await assert.rejects(readRunServiceResponse(new Response('x', { status: 503, headers: { 'content-length': '21' } }), { maxBytes: 20 }), /temporarily unavailable/);
  await assert.rejects(readRunServiceResponse(Response.json({ error: '<html>private failure</html>' }, { status: 502 })), /temporarily unavailable/);
  assert.deepEqual(await readRunServiceResponse(Response.json({ runs: [], nextCursor: null })), { runs: [], nextCursor: null });
});
