import { createHash } from 'node:crypto';
import { recoverTypedDataAddress } from 'viem';
import { checkAgentReplay } from '../drafts/agent-play/runner.ts';
import { PUBLICATION_TTL_SECONDS, publicationPayloadHash, publicationTypedData } from '../shared/replay-publication.ts';

export const REPLAY_FEED_PREFIX = 'public-runs/v1';
export const MAX_PUBLICATION_BYTES = 1_800_000;
export const MAX_FEED_PAGE = 24;
export const PUBLICATION_ORIGINS = ['https://rarerush.app', 'https://rarerush.vercel.app', 'https://testnet.rarerush.app'];
const HOSTS = PUBLICATION_ORIGINS.slice(0, 2);
const ID = /^[a-f0-9]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const DECIMAL = /^[1-9][0-9]{0,77}$/;
const ACTORS = { human: 'Human player', autopilot: 'Deterministic autopilot', agentic: 'Agentic player' };
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const requireThat = (condition, status = 400, message = 'Invalid replay publication.') => { if (!condition) throw new HttpError(status, message); };
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, required, optional = []) => object(value) && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const numericId = value => typeof value === 'string' && DECIMAL.test(value) && BigInt(value) < 2n ** 256n;
const recordPath = id => `${REPLAY_FEED_PREFIX}/records/${id}.json`;
const indexPath = record => `${REPLAY_FEED_PREFIX}/newest/${String(9_999_999_999_999 - Date.parse(record.createdAt)).padStart(13, '0')}.${record.id}.json`;
const summary = record => { const { replay, art, ...metadata } = record; return metadata; };

function validateArt(art, payload) {
  requireThat(exactKeys(art, ['collection', 'tokenId', 'owner', 'chainId', 'label'], ['blockNumber', 'portraitUrl', 'bodyId', 'sprites']));
  requireThat(art.collection === payload.collection && art.tokenId === payload.tokenId && typeof art.owner === 'string' && art.owner.toLowerCase() === payload.player.toLowerCase()
    && art.chainId === 4663 && typeof art.label === 'string' && art.label.length <= 150);
  requireThat(art.blockNumber === undefined || typeof art.blockNumber === 'string' && /^[0-9]{1,20}$/.test(art.blockNumber));
  if (payload.collection === 1) {
    requireThat(art.sprites === undefined && typeof art.portraitUrl === 'string' && art.portraitUrl.length <= 500_000
      && /^data:image\/(png|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(art.portraitUrl)
      && typeof art.bodyId === 'string' && /^[a-z0-9-]{1,50}$/.test(art.bodyId));
  } else {
    const sprites = art.sprites;
    requireThat(art.portraitUrl === undefined && art.bodyId === undefined && exactKeys(sprites, ['familyId', 'seed', 'frames']));
    requireThat(Number.isInteger(sprites.familyId) && sprites.familyId >= 0 && sprites.familyId <= 8
      && Number.isInteger(sprites.seed) && sprites.seed >= 0 && sprites.seed <= 0xffffffff
      && Array.isArray(sprites.frames) && sprites.frames.length === 64
      && sprites.frames.every(frame => typeof frame === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(frame) && BigInt(frame) < 2n ** 256n));
  }
}

export function parsePublication(input) {
  requireThat(exactKeys(input, ['source', 'collection', 'tokenId', 'difficulty', 'seed', 'replay', 'player', 'actor', 'authorization'], ['runId', 'art']));
  requireThat(['arcade', 'testnet'].includes(input.source) && [0, 1].includes(input.collection)
    && ['easy', 'normal', 'degen'].includes(input.difficulty) && numericId(input.tokenId)
    && typeof input.seed === 'string' && /^[a-z0-9:_-]{1,256}$/i.test(input.seed)
    && typeof input.player === 'string' && ADDRESS.test(input.player) && !/^0x0{40}$/i.test(input.player)
    && typeof input.actor === 'string' && Object.hasOwn(ACTORS, input.actor) && object(input.replay));
  requireThat(exactKeys(input.authorization, ['expiresAt', 'signature']) && typeof input.authorization.expiresAt === 'string'
    && /^[1-9][0-9]{0,11}$/.test(input.authorization.expiresAt) && typeof input.authorization.signature === 'string'
    && /^0x[0-9a-f]{130}$/i.test(input.authorization.signature));
  if (input.source === 'testnet') requireThat(numericId(input.runId) && /^0x[0-9a-f]{64}$/i.test(input.seed) && input.art === undefined);
  else { requireThat(input.runId === undefined); validateArt(input.art, input); }
  const { authorization, ...payload } = input;
  return { payload, authorization };
}

async function boundedJson(request) {
  const declared = request.headers.get('content-length');
  requireThat(declared === null || /^\d+$/.test(declared) && Number(declared) <= MAX_PUBLICATION_BYTES, 413, 'Replay exceeds the upload limit.');
  requireThat(request.body, 400, 'A replay is required.');
  const reader = request.body.getReader(), chunks = [];
  let bytes = 0, timer;
  try {
    return await Promise.race([
      (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          requireThat(bytes <= MAX_PUBLICATION_BYTES, 413, 'Replay exceeds the upload limit.');
          chunks.push(value);
        }
        try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new HttpError(400, 'Replay must be valid JSON.'); }
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new HttpError(408, 'Replay upload timed out.')), 8000); }),
    ]);
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}

function limiter(maximum) {
  const buckets = new Map();
  return (key, now) => {
    const minute = Math.floor(now / 60_000), previous = buckets.get(key);
    if (previous?.minute === minute) return ++previous.count <= maximum;
    if (buckets.size >= 2000) {
      for (const [key, value] of buckets) if (value.minute !== minute) buckets.delete(key);
      if (buckets.size >= 2000) return false;
    }
    buckets.set(key, { minute, count: 1 }); return true;
  };
}

function validStored(record, id) {
  return object(record) && record.id === id && ID.test(id) && ['arcade', 'testnet'].includes(record.source)
    && [0, 1].includes(record.collection) && numericId(record.tokenId) && ADDRESS.test(record.player)
    && Object.hasOwn(ACTORS, record.actor) && Number.isFinite(Date.parse(record.createdAt)) && object(record.metrics)
    && ['score', 'coins', 'bonusCoins', 'hearts', 'distance', 'ticks', 'elapsed', 'duration'].every(key => Number.isFinite(record.metrics[key]))
    && ['survived', 'lost'].includes(record.metrics.outcome);
}

/** Public replay API: bounded reads, wallet-authorized immutable publications,
 * canonical physics metrics and an independent confirmed Testnet run binding.
 * Actor labels describe the submitted mode; they are not proof of a human/AI.
 */
export function createReplayFeed({ store, storageReady = () => true, bindTestnet, bindArcade,
  now = Date.now, clientKey = () => 'shared', hosts = HOSTS, origins = PUBLICATION_ORIGINS }) {
  const writes = limiter(10), reads = limiter(120);
  let active = 0;
  function headers(request, extra = {}) {
    const origin = request.headers.get('origin');
    return { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", Vary: 'Origin',
      ...(origins.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}), ...extra };
  }
  function json(request, status, value, extra = {}) { return Response.json(value, { status, headers: headers(request, extra) }); }
  function checkRequest(request) {
    requireThat(hosts.includes(new URL(request.url).origin), 403, 'Wrong replay API host.');
    const origin = request.headers.get('origin');
    requireThat(origin === null || origins.includes(origin), 403, 'Wrong replay origin.');
  }
  function ready() { requireThat(storageReady(), 503, 'Public replay storage is not configured.'); }
  async function reservePublication(player, id, time) {
    const wallet = createHash('sha256').update(player.toLowerCase()).digest('hex');
    const prefix = `${REPLAY_FEED_PREFIX}/limits/${Math.floor(time / 60_000)}/${wallet}`;
    // Immutable object creation supplies a distributed three-publications/minute
    // wallet limit. Retries of the same content keep their original reservation.
    for (let slot = 0; slot < 3; slot++) {
      const path = `${prefix}/${slot}.json`;
      if (await store.putIfAbsent(path, { id })) return;
      if ((await store.read(path, 2048))?.id === id) return;
    }
    throw new HttpError(429, 'Three runs per minute can be published by this wallet. Try again shortly.');
  }
  async function reserveTestnetRun(payload, id, onchain) {
    requireThat(onchain?.chainId === 46630 && ADDRESS.test(onchain.game) && onchain.runId === payload.runId,
      503, 'Testnet replay verification is unavailable.');
    const path = `${REPLAY_FEED_PREFIX}/testnet/${onchain.game.toLowerCase()}/${payload.runId}.json`;
    // The first authorized payload wins, including its actor and recording.
    // Reserving the same digest again lets a retry finish a failed record/index
    // write without releasing this immutable onchain-start identity.
    if (await store.putIfAbsent(path, { id })) return;
    const anchor = await store.read(path, 2048);
    requireThat(object(anchor) && ID.test(anchor.id), 503, 'Stored Testnet replay is unavailable.');
    requireThat(anchor.id === id, 409, 'This Testnet run already has a public replay.');
  }
  async function publish(request) {
    requireThat(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json', 415, 'Use application/json.');
    requireThat(!request.headers.has('content-encoding') || request.headers.get('content-encoding') === 'identity', 415, 'Compressed replays are not accepted.');
    const time = now();
    requireThat(writes(clientKey(request).slice(0, 160), time), 429, 'Too many replay uploads. Try again shortly.');
    requireThat(active < 2, 503, 'Replay verification is busy. Try again shortly.');
    active++;
    try {
      const { payload, authorization } = parsePublication(await boundedJson(request));
      const seconds = Math.floor(time / 1000), expiry = Number(authorization.expiresAt);
      requireThat(expiry > seconds && expiry <= seconds + PUBLICATION_TTL_SECONDS, 401, 'Publication authorization expired. Sign a fresh message.');
      let signer;
      try { signer = await recoverTypedDataAddress({ ...publicationTypedData(payload, authorization.expiresAt), signature: authorization.signature }); }
      catch { throw new HttpError(401, 'Invalid publication signature.'); }
      requireThat(signer.toLowerCase() === payload.player.toLowerCase(), 401, 'Publication signature does not match the run player.');
      const id = publicationPayloadHash(payload).slice(2), path = recordPath(id);
      let record = await store.read(path);
      if (record) {
        requireThat(validStored(record, id), 503, 'Stored replay is unavailable.');
        if (payload.source === 'testnet') await reserveTestnetRun(payload, id, record.onchain);
      }
      else {
        let metrics;
        try { metrics = checkAgentReplay(payload.seed, payload.difficulty, payload.replay); }
        catch { throw new HttpError(422, 'The recording is not a complete legal run.'); }
        let onchain;
        if (payload.source === 'testnet') {
          requireThat(typeof bindTestnet === 'function', 503, 'Testnet replay verification is unavailable.');
          onchain = await bindTestnet(payload, metrics);
          requireThat(onchain, 422, 'Replay identity does not match a confirmed Testnet run.');
        } else {
          requireThat(typeof bindArcade === 'function', 503, 'Arcade ownership verification is unavailable.');
          onchain = await bindArcade(payload);
          requireThat(onchain, 422, 'The signing wallet does not own an eligible Arcade Friend.');
        }
        await reservePublication(payload.player, id, time);
        if (payload.source === 'testnet') await reserveTestnetRun(payload, id, onchain);
        const proposed = { id, ...payload, player: payload.player.toLowerCase(), seed: payload.seed.toLowerCase(),
          createdAt: new Date(time).toISOString(), metrics, agent: ACTORS[payload.actor],
          verification: payload.source === 'testnet' ? 'testnet-start-and-replay' : 'wallet-authorized-replay',
          ...(payload.source === 'arcade' ? { artVerification: 'wallet-submitted' } : {}),
          ...(onchain ? { onchain } : {}) };
        record = await store.putIfAbsent(path, proposed) ? proposed : await store.read(path);
        requireThat(validStored(record, id), 503, 'Stored replay is unavailable.');
      }
      // A retry repairs an interrupted index write using the first immutable timestamp.
      await store.putIfAbsent(indexPath(record), summary(record));
      return json(request, 200, summary(record));
    } finally { active--; }
  }
  async function listing(request) {
    requireThat(reads(clientKey(request).slice(0, 160), now()), 429, 'Too many replay reads.');
    const params = new URL(request.url).searchParams;
    requireThat([...params.keys()].every(key => ['limit', 'cursor'].includes(key))
      && params.getAll('limit').length <= 1 && params.getAll('cursor').length <= 1);
    const rawLimit = params.get('limit') ?? '12';
    requireThat(/^[1-9][0-9]?$/.test(rawLimit) && Number(rawLimit) <= MAX_FEED_PAGE, 400, 'Invalid replay page size.');
    const encoded = params.get('cursor');
    requireThat(encoded === null || /^[A-Za-z0-9_-]{1,4096}$/.test(encoded), 400, 'Invalid replay cursor.');
    const cursor = encoded ? Buffer.from(encoded, 'base64url').toString('utf8') : undefined;
    const prefix = `${REPLAY_FEED_PREFIX}/newest/`;
    const page = await store.list({ prefix, limit: Number(rawLimit), ...(cursor ? { cursor } : {}) });
    requireThat(Array.isArray(page.blobs) && page.blobs.length <= Number(rawLimit), 503, 'Replay index is unavailable.');
    const runs = await Promise.all(page.blobs.map(async blob => {
      requireThat(new RegExp(`^${prefix}[0-9]{13}\\.([a-f0-9]{64})\\.json$`).test(blob.pathname), 503, 'Replay index is unavailable.');
      const id = blob.pathname.split('.').at(-2), record = await store.read(blob.pathname, 8192);
      requireThat(validStored(record, id), 503, 'Replay index is unavailable.');
      return summary(record);
    }));
    const result = { runs, nextCursor: page.hasMore && page.cursor ? Buffer.from(page.cursor).toString('base64url') : null };
    requireThat(Buffer.byteLength(JSON.stringify(result)) <= 128_000, 503, 'Replay page is too large.');
    return json(request, 200, result, { 'Cache-Control': 'public, max-age=5, s-maxage=10, stale-while-revalidate=30' });
  }
  async function handle(request) {
    try {
      checkRequest(request);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(request, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600',
      }) });
      ready();
      const pathname = new URL(request.url).pathname;
      if (/^\/api\/runs\/?$/.test(pathname)) {
        if (request.method === 'POST') return await publish(request);
        if (request.method === 'GET') return await listing(request);
      } else {
        const match = /^\/api\/runs\/([a-f0-9]{64})\/?$/.exec(pathname);
        requireThat(match, 404, 'Replay not found.');
        if (request.method === 'GET') {
          requireThat(reads(clientKey(request).slice(0, 160), now()), 429, 'Too many replay reads.');
          const record = await store.read(recordPath(match[1]));
          requireThat(record, 404, 'Replay not found.');
          requireThat(validStored(record, match[1]) && object(record.replay), 503, 'Stored replay is unavailable.');
          return json(request, 200, record, { 'Cache-Control': 'public, max-age=60, s-maxage=300' });
        }
      }
      return json(request, 405, { error: 'Method not allowed.' }, { Allow: 'GET, POST, OPTIONS' });
    } catch (error) {
      if (error instanceof HttpError) return json(request, error.status, { error: error.message }, error.status === 429 ? { 'Retry-After': '60' } : {});
      // Upstream messages can contain credential-bearing RPC/storage URLs.
      return json(request, 503, { error: 'Public replays are temporarily unavailable. Try again shortly.' });
    }
  }
  return { handle };
}
