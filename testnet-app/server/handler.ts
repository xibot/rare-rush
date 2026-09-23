import { recoverTypedDataAddress, type Address, type Hex } from 'viem';
import {
  AUTH_CHAIN_ID, AUTH_GAME, AUTH_SITE, AUTH_TTL_SECONDS, MAX_VERIFY_REQUEST_BYTES,
  authorizationTypedData, canonicalReplay, canonicalReplayHash, parseAuthorization,
  type VerifyRunRequest,
} from '../src/shared/authorization.ts';

export type VerifierStatus = {
  ready: boolean;
  chainId: 46630;
  game: Address;
  engineVersion: Hex;
  verifier: Address | null;
  reason: 'ready' | 'not-configured' | 'configuration-mismatch' | 'paused' | 'rpc-unavailable';
};
export type VerifierReceipt = {
  chainId: number; game: Address; runId: string; player: Address; engineVersion: Hex;
  replayHash: Hex; pickupKinds: Hex; deadline: string; signature: Hex; verifiedAtBlock: string;
  claimArgs: readonly unknown[];
  [key: string]: unknown;
};
export class RunVerificationRejected extends Error {}
type Dependencies = {
  status(): Promise<VerifierStatus>;
  verify(input: { runId: bigint; replay: VerifyRunRequest['replay']; expectedPlayer: Address }): Promise<VerifierReceipt>;
  now?: () => number;
  allowedOrigins?: readonly string[];
  clientKey?: (request: Request) => string;
  maxActive?: number;
};

class RequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

// A warm-instance defense only: Vercel/platform rate limits are required across instances.
class BoundedWindow {
  readonly buckets = new Map<string, { count: number; until: number }>();
  readonly maximum: number;
  readonly entries: number;
  constructor(maximum: number, entries = 4096) { this.maximum = maximum; this.entries = entries; }
  consume(key: string, now: number) {
    for (const [candidate, bucket] of this.buckets) if (bucket.until <= now) this.buckets.delete(candidate);
    const existing = this.buckets.get(key);
    if (existing) {
      if (existing.count >= this.maximum) return false;
      existing.count++;
      return true;
    }
    if (this.buckets.size >= this.entries) return false;
    this.buckets.set(key, { count: 1, until: now + 60 });
    return true;
  }
}

function response(status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return Response.json(body, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...extraHeaders,
  } });
}

async function readLimitedBody(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_VERIFY_REQUEST_BYTES)) {
    throw new RequestError(413, 'Replay request exceeds the size limit.');
  }
  if (!request.body) throw new RequestError(400, 'A replay request is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RequestError(408, 'Replay upload timed out.')), 10_000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      length += value.byteLength;
      if (length > MAX_VERIFY_REQUEST_BYTES) throw new RequestError(413, 'Replay request exceeds the size limit.');
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new RequestError(400, 'Replay request must contain valid JSON.'); }
  } finally {
    if (timer) clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}

export function parseVerifyRequest(input: unknown): VerifyRunRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'authorization,replay,signature') throw new RequestError(400, 'Invalid verification request fields.');
  const value = input as Record<string, unknown>;
  if (typeof value.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(value.signature)) {
    throw new RequestError(400, 'A wallet authorization signature is required.');
  }
  try {
    const authorization = parseAuthorization(value.authorization);
    const replay = canonicalReplay(value.replay);
    if (canonicalReplayHash(replay) !== authorization.replayHash) throw new Error('Replay differs from authorization.');
    return { authorization, signature: value.signature as Hex, replay };
  } catch { throw new RequestError(400, 'Invalid authorization or replay schema.'); }
}

export function createVerifierHandlers(dependencies: Dependencies) {
  const now = dependencies.now ?? (() => Math.floor(Date.now() / 1000));
  const allowedOrigins = dependencies.allowedOrigins ?? [AUTH_SITE];
  const clientKey = dependencies.clientKey ?? (() => 'shared');
  const ipLimits = new BoundedWindow(30);
  const playerLimits = new BoundedWindow(10);
  const statusLimits = new BoundedWindow(60);
  const pendingRuns = new Set<string>();
  const maxActive = dependencies.maxActive ?? 2;
  let active = 0;
  let statusCache: { until: number; value: VerifierStatus } | null = null;
  let statusPending: Promise<VerifierStatus> | null = null;
  const key = (request: Request) => clientKey(request).slice(0, 160) || 'shared';

  async function currentStatus() {
    if (statusCache && statusCache.until > now()) return statusCache.value;
    if (!statusPending) statusPending = dependencies.status().then(value => {
      // A transient RPC error must not make CHECK AGAIN repeat a cached failure.
      // Keep coalescing concurrent probes, and cache stable readiness/configuration.
      statusCache = value.reason === 'rpc-unavailable' ? null : { until: now() + 10, value };
      return value;
    }).finally(() => { statusPending = null; });
    return statusPending;
  }

  async function verify(request: Request): Promise<Response> {
    let acquired = false;
    let pendingKey: string | undefined;
    try {
      if (request.method !== 'POST') return response(405, { error: 'Use POST to verify a replay.' }, { Allow: 'POST' });
      const origin = request.headers.get('origin');
      if (!origin || !allowedOrigins.includes(origin)) throw new RequestError(403, 'Verification requests must originate from the testnet game.');
      if (!allowedOrigins.includes(new URL(request.url).origin)) throw new RequestError(403, 'Wrong verification host.');
      if (request.headers.get('sec-fetch-site') === 'cross-site') throw new RequestError(403, 'Cross-site verification is not allowed.');
      if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new RequestError(415, 'Use application/json.');
      if (request.headers.has('content-encoding') && request.headers.get('content-encoding') !== 'identity') throw new RequestError(415, 'Compressed replay requests are not supported.');
      if (!ipLimits.consume(key(request), now())) throw new RequestError(429, 'Too many verification requests. Try again in a minute.');
      if (active >= maxActive) throw new RequestError(503, 'Verifier is busy. Try again shortly.');
      active++; acquired = true;
      const payload = parseVerifyRequest(await readLimitedBody(request));
      const expiry = BigInt(payload.authorization.expiresAt);
      if (expiry <= BigInt(now()) || expiry > BigInt(now() + AUTH_TTL_SECONDS)) throw new RequestError(401, 'Wallet authorization expired or is too long-lived. Sign a fresh request.');
      let recovered: Address;
      try { recovered = await recoverTypedDataAddress({ ...authorizationTypedData(payload.authorization), signature: payload.signature }); }
      catch { throw new RequestError(401, 'Wallet authorization could not be verified.'); }
      if (recovered.toLowerCase() !== payload.authorization.player.toLowerCase()) throw new RequestError(401, 'Wallet authorization does not match the player.');
      if (!playerLimits.consume(recovered.toLowerCase(), now())) throw new RequestError(429, 'Too many requests from this wallet. Try again in a minute.');
      const candidate = `${recovered.toLowerCase()}:${payload.authorization.runId}`;
      if (pendingRuns.has(candidate)) throw new RequestError(409, 'This run is already being verified.');
      pendingRuns.add(candidate); pendingKey = candidate;
      const status = await currentStatus();
      if (!status.ready || status.chainId !== AUTH_CHAIN_ID || status.game.toLowerCase() !== AUTH_GAME.toLowerCase()) {
        throw new RequestError(503, 'The testnet verifier is not ready. Try again shortly.');
      }
      const receipt = await dependencies.verify({
        runId: BigInt(payload.authorization.runId), replay: payload.replay, expectedPlayer: recovered,
      });
      // Defense in depth against accidental service wiring to another game or player.
      if (receipt.chainId !== AUTH_CHAIN_ID || receipt.game.toLowerCase() !== AUTH_GAME.toLowerCase()
        || receipt.player.toLowerCase() !== recovered.toLowerCase() || receipt.runId !== payload.authorization.runId
        || receipt.replayHash.toLowerCase() !== payload.authorization.replayHash
        || receipt.engineVersion.toLowerCase() !== status.engineVersion.toLowerCase()) throw new Error('Verifier receipt mismatch.');
      if (expiry <= BigInt(now())) throw new RequestError(401, 'Wallet authorization expired during verification. Sign a fresh request.');
      return response(200, receipt);
    } catch (error) {
      if (error instanceof RequestError) return response(error.status, { error: error.message }, error.status === 429 ? { 'Retry-After': '60' } : {});
      if (error instanceof RunVerificationRejected) return response(422, { error: 'This run is not eligible for a reward claim. Refresh its status and check that you survived the timer.' });
      // Never serialize upstream errors: they can contain requests or signing configuration.
      return response(503, { error: 'Verification is temporarily unavailable. Try again shortly.' });
    } finally {
      if (pendingKey) pendingRuns.delete(pendingKey);
      if (acquired) active--;
    }
  }

  async function status(request: Request): Promise<Response> {
    if (request.method !== 'GET') return response(405, { error: 'Use GET for verifier status.' }, { Allow: 'GET' });
    if (!statusLimits.consume(key(request), now())) return response(429, { error: 'Too many status requests.' }, { 'Retry-After': '60' });
    try { return response(200, await currentStatus()); }
    catch { return response(503, { error: 'Verifier status is temporarily unavailable.' }); }
  }
  return { verify, status };
}
