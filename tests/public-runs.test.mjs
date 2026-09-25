import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { publishRun, readRunServiceResponse, RunPublicationError, runPublicationMessage, MAX_PUBLIC_REPLAY_PAYLOAD_BYTES } from '../games/rare-rush/public-runs.ts';
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
  const records = new Map(); let posts = 0;
  const { handle } = createReplayFeed({ store: {
    async read(path) { return structuredClone(records.get(path) ?? null); },
    async putIfAbsent(path, value) { if (records.has(path)) return false; records.set(path, structuredClone(value)); return true; },
    async list() { return { blobs: [], hasMore: false }; },
  }, clientKey: () => 'test-client',
  bindArcade: async () => ({ chainId: 4663, owner: account.address }),
  bindTestnet: async payload => ({ chainId: 46630, game: '0x3333333333333333333333333333333333333333', runId: payload.runId }) });
  return { records, get posts() { return posts; }, fetcher: async (url, init) => {
    posts++; assert.equal(init.credentials, 'omit'); assert.equal(init.method, 'POST');
    return handle(new Request('https://rarerush.app/api/runs', { ...init, headers: { ...init.headers, origin: 'https://rarerush.app' } }));
  } };
}

test('human run signs exact serialized art + replay, verifies at API, and retries retain one content ID', async () => {
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
  assert.equal(f.posts, 2);
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
  await assert.rejects(publishRun(base, wallet({ signer: other }), undefined, { fetcher: f.fetcher }), /compatible signature/);
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
  await assert.rejects(publishRun(base, wallet(), undefined, { fetcher: async () => new Response('x'.repeat(16_385)) }), /invalid response/);
  await assert.rejects(publishRun(base, wallet(), undefined, { fetcher: async () => Response.json({ source: base.source, tokenId: base.tokenId, collection: base.collection, seed: base.seed, difficulty: base.difficulty, player: base.player, id: '0'.repeat(64) }) }), /different run/);
  await assert.rejects(publishRun(base, wallet(), undefined, { fetcher: async () => Response.json({ error: 'https://private.example/secret' }, { status: 503 }) }), error => !error.message.includes('secret'));
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
    assert.equal(error.message, 'The run could not be published. Your replay is still here; try again.');
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
