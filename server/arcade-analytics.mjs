import { createHmac, timingSafeEqual } from 'node:crypto';

export const ANALYTICS_OWNER = '0x6fd155b9d52f80e8a73a8a2537268602978486e2';
export const ANALYTICS_ORIGINS = Object.freeze(['https://rarerush.app', 'https://rarerush.vercel.app']);
export const ANALYTICS_PREFIX = 'arcade-analytics/v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WALLET = /^0x[0-9a-f]{40}$/i;
const HEX_HASH = /^[0-9a-f]{64}$/;
const DURATIONS = Object.freeze({ easy: 120, normal: 90, degen: 60 });
const COLLECTIONS = ['genesis', 'generations'];
const MAX_BODY = 2048;
const MAX_RECEIPT_AGE = 6 * 60 * 60 * 1000;
const DAY = 86_400_000;

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
function requireThat(value, status = 400, message = 'Invalid analytics event.') { if (!value) throw new HttpError(status, message); }
function json(status, body, extra = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
}
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function secureEqual(a, b) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function hmac(secret, purpose, value) { return createHmac('sha256', secret).update(`${purpose}\0${value}`).digest('hex'); }
function walletId(secret, wallet) { return hmac(secret, 'arcade-wallet-v1', wallet.toLowerCase()); }
function validSecret(value) { return typeof value === 'string' && value.length >= 32 && value.length <= 1024 && !/\s/.test(value); }
function dayOf(timestamp) { return new Date(timestamp).toISOString().slice(0, 10); }
function metadataValid(value) {
  return exactKeys(value, ['version', 'runId', 'walletId', 'startedAt', 'collection', 'difficulty'])
    && value.version === 1 && typeof value.runId === 'string' && UUID.test(value.runId)
    && typeof value.walletId === 'string' && HEX_HASH.test(value.walletId)
    && Number.isSafeInteger(value.startedAt) && value.startedAt > 0
    && COLLECTIONS.includes(value.collection) && typeof value.difficulty === 'string' && Object.hasOwn(DURATIONS, value.difficulty);
}
function receiptFor(secret, metadata) {
  const body = Buffer.from(JSON.stringify(metadata)).toString('base64url');
  return `${body}.${hmac(secret, 'arcade-receipt-v1', body)}`;
}
function readReceipt(secret, receipt, now) {
  requireThat(typeof receipt === 'string' && receipt.length < 1024);
  const [body, signature, extra] = receipt.split('.');
  requireThat(body && /^[a-zA-Z0-9_-]+$/.test(body) && HEX_HASH.test(signature ?? '') && extra === undefined);
  requireThat(secureEqual(hmac(secret, 'arcade-receipt-v1', body), signature), 400, 'Invalid run receipt.');
  let value;
  try { value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw new HttpError(400, 'Invalid run receipt.'); }
  requireThat(metadataValid(value), 400, 'Invalid run receipt.');
  requireThat(value.startedAt <= now + 5000 && now - value.startedAt <= MAX_RECEIPT_AGE, 400, 'Run receipt expired.');
  return value;
}
function anchorPath(runId, type) { return `${ANALYTICS_PREFIX}/runs/${runId}/${type}.json`; }
function indexPath(secret, metadata, kind) {
  const detail = `${metadata.startedAt}.${metadata.runId}.${metadata.walletId}`;
  const path = `${ANALYTICS_PREFIX}/events/${dayOf(metadata.startedAt)}/${kind}/${metadata.collection}/${metadata.difficulty}/${detail}`;
  return `${path}.${hmac(secret, 'arcade-index-v1', path)}.json`;
}
function parseIndex(secret, pathname) {
  if (typeof pathname !== 'string') return null;
  const expression = /^arcade-analytics\/v1\/events\/(\d{4}-\d{2}-\d{2})\/(start|time|hearts)\/(genesis|generations)\/(easy|normal|degen)\/(\d{13})\.([0-9a-f-]{36})\.([0-9a-f]{64})\.([0-9a-f]{64})\.json$/;
  const match = expression.exec(pathname);
  if (!match) return null;
  const [, date, kind, collection, difficulty, startedAt, runId, wallet, signature] = match;
  const signedPath = pathname.slice(0, -70);
  if (!secureEqual(hmac(secret, 'arcade-index-v1', signedPath), signature)) return null;
  const metadata = { version: 1, runId, walletId: wallet, startedAt: Number(startedAt), collection, difficulty };
  return metadataValid(metadata) && dayOf(metadata.startedAt) === date ? { ...metadata, kind, date } : null;
}
async function boundedJson(request) {
  const length = request.headers.get('content-length');
  requireThat(length === null || (/^\d+$/.test(length) && Number(length) <= MAX_BODY), 413, 'Analytics event is too large.');
  requireThat(request.body, 400);
  const reader = request.body.getReader();
  let size = 0, timer;
  const chunks = [];
  try {
    const value = await Promise.race([
      (async () => {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > MAX_BODY) throw new HttpError(413, 'Analytics event is too large.');
          chunks.push(part.value);
        }
        try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new HttpError(400, 'Invalid analytics event.'); }
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new HttpError(408, 'Analytics event timed out.')), 3000); }),
    ]);
    return value;
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}

/** Best-effort per-instance limits. Vercel's edge rate limits remain the distributed boundary. */
function windowLimiter(limit, maxKeys = 2000) {
  const entries = new Map();
  return (key, now) => {
    const window = Math.floor(now / 60_000);
    const previous = entries.get(key);
    if (!previous || previous.window !== window) {
      if (entries.size >= maxKeys) {
        for (const [candidate, item] of entries) if (item.window !== window) entries.delete(candidate);
        if (entries.size >= maxKeys) return false;
      }
      entries.set(key, { window, count: 1 }); return true;
    }
    if (previous.count >= limit) return false;
    previous.count++; return true;
  };
}
function emptyCounters() { return { players: new Set(), startedRuns: 0, completedRuns: 0, survivedRuns: 0, lostRuns: 0 }; }
function plainCounters(counters) {
  return { uniquePlayers: counters.players.size, startedRuns: counters.startedRuns, completedRuns: counters.completedRuns,
    survivedRuns: counters.survivedRuns, lostRuns: counters.lostRuns, unfinishedRuns: counters.startedRuns - counters.completedRuns };
}

/** Storage is injected so all privacy, idempotence and counting rules are testable without credentials. */
export function createArcadeAnalytics({ store, settings, now = Date.now, clientKey = () => 'shared', maxEvents = 20_000, maxScanMs = 7000 }) {
  const perClient = windowLimiter(90), perWallet = windowLimiter(20), global = windowLimiter(600, 1), statsLimit = windowLimiter(12, 1);
  let cachedStats = new Map();
  const statsPending = new Map();
  const anchors = new Map(), anchorPending = new Map(), indexed = new Map(), indexPending = new Map();
  let revision = 0;
  function remember(map, key, value) {
    if (map.size >= 1000 && !map.has(key)) map.delete(map.keys().next().value);
    map.set(key, value);
  }
  function configuration() {
    const config = settings();
    if (!config.storageReady || !validSecret(config.hashKey) || !validSecret(config.adminKey)) throw new HttpError(503, 'Analytics is not configured.');
    return config;
  }
  async function canonical(path, proposed, equal) {
    if (!anchors.has(path) && !anchorPending.has(path)) {
      const promise = (async () => {
        const existing = await store.putIfAbsent(path, proposed) ? proposed : await store.read(path);
        if (!existing) throw new HttpError(503, 'Analytics storage is catching up. Retry shortly.');
        remember(anchors, path, existing); return existing;
      })().finally(() => anchorPending.delete(path));
      anchorPending.set(path, promise);
    }
    const existing = anchors.get(path) ?? await anchorPending.get(path);
    requireThat(equal(existing, proposed), 409, 'Run ID already belongs to a different event.');
    return existing;
  }
  async function ensureIndex(path) {
    if (indexed.has(path)) return;
    if (!indexPending.has(path)) {
      const promise = store.putIfAbsent(path, { version: 1 }).then(() => remember(indexed, path, true)).finally(() => indexPending.delete(path));
      indexPending.set(path, promise);
    }
    await indexPending.get(path);
  }
  async function events(request) {
    try {
      if (request.method !== 'POST') return json(405, { error: 'Use POST.' }, { Allow: 'POST' });
      requireThat(ANALYTICS_ORIGINS.includes(request.headers.get('origin')), 403, 'Wrong analytics origin.');
      requireThat(ANALYTICS_ORIGINS.includes(new URL(request.url).origin), 403, 'Wrong analytics host.');
      requireThat(request.headers.get('sec-fetch-site') !== 'cross-site', 403, 'Cross-site analytics is not allowed.');
      requireThat(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json', 415, 'Use application/json.');
      requireThat(!request.headers.has('content-encoding') || request.headers.get('content-encoding') === 'identity', 415, 'Compressed analytics is not accepted.');
      const config = configuration(), time = now();
      // Do not retain IP addresses: only a keyed, one-minute in-memory rate-limit label.
      const requestKey = hmac(config.hashKey, 'arcade-rate-v1', `${Math.floor(time / 60_000)}:${clientKey(request).slice(0, 160)}`);
      if (!global('all', time) || !perClient(requestKey, time)) throw new HttpError(429, 'Too many analytics events.');
      const payload = await boundedJson(request);
      requireThat(payload?.version === 1);
      if (payload.type === 'start') {
        requireThat(exactKeys(payload, ['version', 'type', 'runId', 'wallet', 'collection', 'difficulty']));
        requireThat(typeof payload.runId === 'string' && UUID.test(payload.runId));
        requireThat(typeof payload.wallet === 'string' && WALLET.test(payload.wallet) && !/^0x0{40}$/i.test(payload.wallet));
        requireThat(COLLECTIONS.includes(payload.collection) && typeof payload.difficulty === 'string' && Object.hasOwn(DURATIONS, payload.difficulty));
        if (payload.wallet.toLowerCase() === ANALYTICS_OWNER) return json(200, { accepted: true, receipt: null, excluded: true });
        const proposed = { version: 1, runId: payload.runId.toLowerCase(), walletId: walletId(config.hashKey, payload.wallet), startedAt: time,
          collection: payload.collection, difficulty: payload.difficulty };
        if (!perWallet(proposed.walletId, time)) throw new HttpError(429, 'Too many analytics events.');
        const metadata = await canonical(anchorPath(proposed.runId, 'start'), proposed, (saved, next) => metadataValid(saved)
          && saved.runId === next.runId && saved.walletId === next.walletId && saved.collection === next.collection && saved.difficulty === next.difficulty);
        await ensureIndex(indexPath(config.hashKey, metadata, 'start'));
        revision++; cachedStats.clear();
        return json(200, { accepted: true, receipt: receiptFor(config.hashKey, metadata) });
      }
      requireThat(payload.type === 'finish' && exactKeys(payload, ['version', 'type', 'receipt', 'finishReason', 'elapsedSeconds']));
      const metadata = readReceipt(config.hashKey, payload.receipt, time);
      requireThat(metadata.walletId !== walletId(config.hashKey, ANALYTICS_OWNER), 400, 'Excluded run.');
      requireThat(['time', 'hearts'].includes(payload.finishReason));
      requireThat(typeof payload.elapsedSeconds === 'number' && Number.isFinite(payload.elapsedSeconds)
        && payload.elapsedSeconds >= 0 && payload.elapsedSeconds <= DURATIONS[metadata.difficulty] + 2);
      requireThat(payload.finishReason !== 'time' || payload.elapsedSeconds >= DURATIONS[metadata.difficulty] - 0.1);
      // Gameplay never waits on telemetry. Allow its ownership lookup / initial
      // report to arrive late, while still rejecting obviously premature finishes.
      requireThat(time + 15_000 >= metadata.startedAt + payload.elapsedSeconds * 1000, 400, 'Run has not reached this elapsed time.');
      const proposed = { version: 1, ...metadata, finishReason: payload.finishReason, elapsedSeconds: Math.round(payload.elapsedSeconds * 1000) / 1000 };
      const finished = await canonical(anchorPath(metadata.runId, 'finish'), proposed, (saved, next) =>
        metadataValid(Object.fromEntries(['version', 'runId', 'walletId', 'startedAt', 'collection', 'difficulty'].map(key => [key, saved[key]])))
        && ['runId', 'walletId', 'startedAt', 'collection', 'difficulty', 'finishReason', 'elapsedSeconds'].every(key => saved[key] === next[key]));
      await ensureIndex(indexPath(config.hashKey, metadata, finished.finishReason));
      revision++; cachedStats.clear();
      return json(200, { accepted: true });
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status === 429 ? { 'Retry-After': '60' } : {});
      // Upstream errors may contain storage URLs or credentials. Never serialize or log them.
      return json(503, { error: 'Analytics is temporarily unavailable.' });
    }
  }

  async function aggregate(days, config, time) {
    const today = Math.floor(time / DAY) * DAY;
    const from = days === 'all' ? null : today - (Number(days) - 1) * DAY;
    const until = today + DAY;
    const dates = from === null ? [] : Array.from({ length: Number(days) }, (_, index) => dayOf(from + index * DAY));
    // One listing per overlapping month avoids 30 requests for an empty report.
    // Timestamp filtering below still gives exact UTC start-date cohorts.
    const prefixes = from === null ? [`${ANALYTICS_PREFIX}/events/`]
      : [...new Set(dates.map(date => date.slice(0, 7)))].map(month => `${ANALYTICS_PREFIX}/events/${month}-`);
    const runs = new Map();
    let seen = 0, pages = 0;
    const excludedWallet = walletId(config.hashKey, ANALYTICS_OWNER);
    const controller = new AbortController();
    let deadlineTimer;
    const deadline = new Promise((_, reject) => {
      deadlineTimer = setTimeout(() => {
        const error = new HttpError(503, 'Analytics storage timed out. Retry shortly.', 'storage-timeout');
        reject(error); controller.abort(error);
      }, maxScanMs);
    });
    try { for (const prefix of prefixes) {
      let cursor;
      do {
        if (++pages > 60) throw new HttpError(503, 'Analytics range is too large. Choose a shorter window.', 'scan-limit');
        const page = await Promise.race([
          store.list({ prefix, cursor, limit: Math.min(1000, maxEvents - seen + 1), abortSignal: controller.signal }), deadline,
        ]);
        requireThat(Array.isArray(page.blobs), 503, 'Analytics storage is unavailable.');
        seen += page.blobs.length;
        if (seen > maxEvents) throw new HttpError(503, 'Analytics range is too large. Choose a shorter window.', 'scan-limit');
        for (const blob of page.blobs) {
          const entry = parseIndex(config.hashKey, blob.pathname);
          if (!entry || entry.walletId === excludedWallet || (from !== null && entry.startedAt < from) || entry.startedAt >= until || entry.startedAt > time) continue;
          let run = runs.get(entry.runId);
          if (!run) { run = { metadata: entry, kinds: new Set() }; runs.set(entry.runId, run); }
          requireThat(['walletId', 'startedAt', 'collection', 'difficulty'].every(key => run.metadata[key] === entry[key]), 503, 'Analytics data needs review.');
          run.kinds.add(entry.kind);
        }
        if (!page.hasMore) break;
        requireThat(typeof page.cursor === 'string' && page.cursor && page.cursor !== cursor, 503, 'Analytics pagination is unavailable.');
        cursor = page.cursor;
      } while (true);
    } } finally { clearTimeout(deadlineTimer); }
    const totals = emptyCounters();
    const collections = Object.fromEntries(COLLECTIONS.map(key => [key, emptyCounters()]));
    const difficulties = Object.fromEntries(Object.keys(DURATIONS).map(key => [key, emptyCounters()]));
    const daily = new Map(dates.map(date => [date, emptyCounters()]));
    let earliest = null;
    for (const { metadata: entry, kinds } of runs.values()) {
      // A listed completion without its start index can be temporarily visible while
      // storage propagation catches up. Never count it as an extra or impossible run.
      if (!kinds.has('start')) continue;
      requireThat(!(kinds.has('time') && kinds.has('hearts')), 503, 'Analytics data needs review.');
      if (!daily.has(entry.date)) daily.set(entry.date, emptyCounters());
      earliest = earliest === null ? entry.startedAt : Math.min(earliest, entry.startedAt);
      for (const item of [totals, collections[entry.collection], difficulties[entry.difficulty], daily.get(entry.date)]) {
        item.players.add(entry.walletId); item.startedRuns++;
        if (kinds.has('time') || kinds.has('hearts')) item.completedRuns++;
        if (kinds.has('time')) item.survivedRuns++;
        if (kinds.has('hearts')) item.lostRuns++;
      }
    }
    return { version: 1, generatedAt: new Date(time).toISOString(),
      window: { days, from: from === null ? null : new Date(from).toISOString(), to: new Date(until).toISOString(), timezone: 'UTC' },
      totals: plainCounters(totals), byCollection: Object.fromEntries(Object.entries(collections).map(([key, value]) => [key, plainCounters(value)])),
      byDifficulty: Object.fromEntries(Object.entries(difficulties).map(([key, value]) => [key, plainCounters(value)])),
      daily: [...daily].sort(([a], [b]) => a.localeCompare(b)).map(([date, counts]) => ({ date, ...plainCounters(counts) })),
      earliestObservedStart: earliest === null ? null : new Date(earliest).toISOString(),
      scope: { source: 'client-reported-arcade-events', historicalBackfill: false, ownerExcluded: true, complete: true } };
  }
  async function stats(request) {
    try {
      if (request.method !== 'GET') return json(405, { error: 'Use GET.' }, { Allow: 'GET' });
      const config = configuration();
      const auth = request.headers.get('authorization');
      requireThat(typeof auth === 'string' && auth.startsWith('Bearer ') && secureEqual(auth.slice(7), config.adminKey), 401, 'Administrator authentication required.');
      const origin = request.headers.get('origin');
      requireThat(origin === null || ANALYTICS_ORIGINS.includes(origin), 403, 'Wrong analytics origin.');
      const url = new URL(request.url);
      requireThat([...url.searchParams.keys()].every(key => key === 'days') && url.searchParams.getAll('days').length <= 1, 400, 'Invalid analytics window.');
      const days = url.searchParams.get('days') ?? '7';
      requireThat(['7', '30', 'all'].includes(days), 400, 'Choose days=7, 30 or all.');
      const time = now(), cacheKey = `${days}:${dayOf(time)}`;
      const cached = cachedStats.get(cacheKey);
      if (cached && cached.until > time) return json(200, cached.value);
      if (!statsPending.has(cacheKey)) {
        if (!statsLimit('all', time)) throw new HttpError(429, 'Too many analytics reports.');
        const requestRevision = revision;
        const promise = aggregate(days, config, time).then(value => {
          // Per-instance cache limits listing cost; HTTP responses are always no-store.
          if (cachedStats.size > 3) cachedStats = new Map();
          if (requestRevision === revision) cachedStats.set(cacheKey, { until: now() + 15_000, value }); return value;
        }).finally(() => statsPending.delete(cacheKey));
        statsPending.set(cacheKey, promise);
      }
      return json(200, await statsPending.get(cacheKey));
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status === 429 ? { 'Retry-After': '60' } : {});
      return json(503, { error: 'Analytics is temporarily unavailable.' });
    }
  }
  return { events, stats };
}
