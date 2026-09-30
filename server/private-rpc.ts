import { GENERATION_SPRITE_MANIFEST } from '@rarefriends/friendsdk/sprites';
import { GENESIS_DEPLOYMENT } from '../games/rare-rush/genesis/identity.ts';
import deployment from '../testnet-app/src/shared/deployment.json' with { type: 'json' };

export type RpcNetwork = 'mainnet' | 'testnet';
type Env = Record<string, string | undefined>;
declare const process: { env: Env };
type RpcCall = { jsonrpc: '2.0'; id: string | number; method: string; params: unknown[] };
type ProxyOptions = {
  env?: Env | (() => Env); fetcher?: typeof fetch; now?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const REQUEST_LIMIT = 512_000, RESPONSE_LIMIT = 8_000_000, MAX_BATCH = 100;
const MAX_LOG_BLOCKS = 10_000_000n;
// Count calls, not HTTP envelopes: batched clients cannot evade the limit, and
// one large holder can finish discovery, ownership checks and visible artwork.
const CALL_BUDGET = 15_000, MAX_CLIENTS = 4096, WINDOW_MS = 60_000;
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const MAIN_ADDRESSES = [GENESIS_DEPLOYMENT.contract, GENERATION_SPRITE_MANIFEST.generations,
  GENERATION_SPRITE_MANIFEST.registry, GENERATION_SPRITE_MANIFEST.metadata,
  GENERATION_SPRITE_MANIFEST.worldData, GENERATION_SPRITE_MANIFEST.seededLandscape];
const NETWORKS = {
  mainnet: { chainId: 4663, addresses: MAIN_ADDRESSES, nfts: [GENESIS_DEPLOYMENT.contract, GENERATION_SPRITE_MANIFEST.generations] },
  testnet: { chainId: 46630, addresses: Object.values(deployment.contracts), nfts: [deployment.contracts.genesis, deployment.contracts.generations] },
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const address = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
const hex = (value: unknown, bytes: number): value is string => typeof value === 'string' && value.length <= bytes * 2 + 2 && /^0x(?:[0-9a-f]{2})*$/i.test(value);
const quantity = (value: unknown): value is string => typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value);
const block = (value: unknown): boolean => quantity(value) || ['latest', 'earliest', 'pending', 'safe', 'finalized'].includes(value as string);
const hash = (value: unknown): boolean => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const exactKeys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const failure = (status: number, message: string, retryAfter?: number) => Response.json({ error: message }, {
  status, headers: { ...HEADERS, ...(retryAfter === undefined ? {} : { 'Retry-After': String(retryAfter) }) },
});

/** Server-only configuration: no public provider fallback and no URL in errors. */
export function privateRpcUrl(network: RpcNetwork, env: Env = process.env): string {
  const raw = network === 'mainnet' ? env.RUSH_MAINNET_RPC_URL : env.RUSH_TESTNET_RPC_URL || env.RUSH_RPC_URL;
  try {
    if (!raw || raw !== raw.trim() || raw.length > 4096) throw new Error();
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !url.hostname.includes('.')
      || /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(url.hostname)
      || url.hostname.endsWith('.local') || url.hostname.endsWith('.localhost')) throw new Error();
    return url.href;
  } catch { throw new Error('Private RPC configuration is unavailable.'); }
}

function validCall(value: unknown, network: RpcNetwork): value is RpcCall {
  if (!record(value) || value.jsonrpc !== '2.0' || !exactKeys(value, ['jsonrpc', 'id', 'method', 'params'])
    || !(typeof value.id === 'string' && value.id.length <= 100 || typeof value.id === 'number' && Number.isSafeInteger(value.id))
    || typeof value.method !== 'string' || !Array.isArray(value.params)) return false;
  const params = value.params, config = NETWORKS[network];
  const allowedAddress = (v: unknown, values = config.addresses) => address(v) && values.some(a => a.toLowerCase() === v.toLowerCase());
  switch (value.method) {
    case 'eth_chainId': case 'eth_blockNumber': return params.length === 0;
    case 'eth_call': {
      const [call, tag] = params;
      return params.length === 2 && record(call) && exactKeys(call, ['to', 'from', 'data', 'input', 'value', 'gas'])
        && allowedAddress(call.to) && (call.from === undefined || address(call.from))
        && !(call.data !== undefined && call.input !== undefined)
        && hex(call.data ?? call.input, 64_000) && (call.value === undefined || call.value === '0x0')
        && (call.gas === undefined || quantity(call.gas) && BigInt(call.gas) <= 15_000_000n) && block(tag);
    }
    case 'eth_getCode': return params.length === 2 && allowedAddress(params[0]) && block(params[1]);
    case 'eth_getBalance': case 'eth_getTransactionCount': return params.length === 2 && address(params[0]) && block(params[1]);
    case 'eth_getTransactionByHash': case 'eth_getTransactionReceipt': return params.length === 1 && hash(params[0]);
    case 'eth_getBlockByNumber': return params.length === 2 && block(params[0])
      && (params[1] === false || network === 'testnet' && params[1] === true);
    case 'eth_getLogs': {
      const [filter] = params;
      if (params.length !== 1 || !record(filter) || !exactKeys(filter, ['address', 'fromBlock', 'toBlock', 'topics'])
        || !allowedAddress(filter.address, config.nfts) || !quantity(filter.fromBlock) || !quantity(filter.toBlock)
        || BigInt(filter.fromBlock) > BigInt(filter.toBlock) || BigInt(filter.toBlock) - BigInt(filter.fromBlock) >= MAX_LOG_BLOCKS
        || !Array.isArray(filter.topics) || filter.topics.length < 2 || filter.topics.length > 4
        || filter.topics[0] !== TRANSFER || !filter.topics.slice(1).every(t => t === null || hash(t))) return false;
      // Require one indexed owner. A zero-address mint filter alone is not an owner.
      return filter.topics.slice(1, 3).some(topic => typeof topic === 'string'
        && /^0x0{24}[0-9a-f]{40}$/i.test(topic) && !/^0x0{64}$/i.test(topic));
    }
    default: return false;
  }
}

async function limitedJson(response: Request | Response, limit: number) {
  if (Number(response.headers.get('content-length')) > limit || !response.body) throw new Error('size');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.length; if (bytes > limit) throw new Error('size'); chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const body = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(body)) as unknown;
}

function retryDelay(value: string | null, now: number): number | null {
  if (value === null) return null;
  const seconds = Number(value), delay = value.trim() && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : null;
}
function sleep(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const done = () => { signal.removeEventListener('abort', aborted); resolve(); };
    const timer = setTimeout(done, milliseconds);
    const aborted = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(new Error('aborted')); };
    signal.addEventListener('abort', aborted, { once: true });
  });
}
function untilAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => { signal.removeEventListener('abort', aborted); reject(new Error('aborted')); };
    // Observe the shared work even when this waiter has already cancelled. Its
    // later failure must not become an unhandled rejection with no waiters.
    work.then(value => { signal.removeEventListener('abort', aborted); resolve(value); },
      error => { signal.removeEventListener('abort', aborted); reject(error); });
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
  });
}
class UpstreamBusy extends Error {
  readonly retryAfter: number;
  constructor(retryAfter: number) { super('busy'); this.retryAfter = retryAfter; }
}
function safeReply(value: unknown, calls: RpcCall[], isBatch: boolean) {
  const replies = isBatch ? value : [value];
  if (!Array.isArray(replies) || replies.length !== calls.length) throw new Error('response');
  const expected = new Set(calls.map(call => `${typeof call.id}:${call.id}`));
  const clean = replies.map(reply => {
    if (!record(reply) || reply.jsonrpc !== '2.0' || !expected.delete(`${typeof reply.id}:${reply.id}`)
      || ('error' in reply) === ('result' in reply)) throw new Error('response');
    if (!('error' in reply)) return { jsonrpc: '2.0', id: reply.id, result: reply.result };
    const error = reply.error;
    if (!record(error) || !Number.isInteger(error.code)) throw new Error('response');
    // Providers can include credentials and request URLs in error messages. Keep
    // only useful categories and bounded revert data, never their raw diagnostics.
    const diagnostic = typeof error.message === 'string' ? error.message : '';
    const message = /range|too many|more than|limit|response size/i.test(diagnostic)
      ? 'RPC query exceeds the provider range or response limit. Use smaller block ranges.'
      : error.code === 3 || /revert/i.test(diagnostic) ? 'Contract execution reverted.'
      : 'RPC read could not be completed. Please retry.';
    return { jsonrpc: '2.0', id: reply.id, error: { code: error.code, message,
      ...(hex(error.data, 64_000) ? { data: error.data } : {}) } };
  });
  return isBatch ? clean : clean[0];
}

export function createPrivateRpcProxy(options: ProxyOptions = {}) {
  const fetcher = options.fetcher ?? fetch, now = options.now ?? Date.now, pause = options.sleep ?? sleep;
  const windows = new Map<string, { count: number; until: number }>();
  const chains = new Map<RpcNetwork, { url: string; until: number; pending?: Promise<void> }>();
  async function send(url: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try { response = await fetcher(url, { method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); }
      catch { if (signal.aborted || attempt >= 2) throw new Error('unavailable'); await pause(250 * 2 ** attempt, signal); continue; }
      if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
        const delay = retryDelay(response.headers.get('retry-after'), now()) ?? 250 * 2 ** attempt;
        await response.body?.cancel().catch(() => {});
        if (attempt >= 2 || delay > 3000) throw new UpstreamBusy(Math.min(60, Math.max(1, Math.ceil(delay / 1000))));
        await pause(delay, signal); continue;
      }
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error('unavailable'); }
      const result = await limitedJson(response, RESPONSE_LIMIT);
      const values = Array.isArray(result) ? result : [result];
      if (values.length && values.every(reply => record(reply) && record(reply.error)
        && (reply.error.code === 429 || reply.error.code === -32005 && /rate|throughput|capacity/i.test(String(reply.error.message))))) {
        if (attempt >= 2) throw new UpstreamBusy(1);
        await pause(250 * 2 ** attempt, signal); continue;
      }
      return result;
    }
  }
  async function checkChain(network: RpcNetwork, url: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const cached = chains.get(network);
    if (cached?.url === url && cached.until > now()) return;
    if (cached?.url === url && cached.pending) return untilAbort(cached.pending, signal);
    const state = { url, until: 0, pending: undefined as Promise<void> | undefined };
    state.pending = (async () => {
      // A cancelled portrait/inventory request must not abort the shared probe
      // awaited by another player or by that player's newer selection.
      const reply = await send(url, { jsonrpc: '2.0', id: 'rare-rush-chain', method: 'eth_chainId', params: [] }, AbortSignal.timeout(4000));
      if (!record(reply) || reply.jsonrpc !== '2.0' || reply.id !== 'rare-rush-chain' || !quantity(reply.result)
        || BigInt(reply.result) !== BigInt(NETWORKS[network].chainId)) throw new Error('chain');
      state.until = now() + WINDOW_MS;
    })().finally(() => { state.pending = undefined; });
    chains.set(network, state);
    return untilAbort(state.pending, signal);
  }
  return async function proxy(request: Request, network: RpcNetwork): Promise<Response> {
    if (request.method !== 'POST') return failure(405, 'Method not allowed.');
    const origin = new URL(request.url).origin;
    if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site'
      || request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return failure(403, 'Use Rare Rush on this site.');
    let payload: unknown;
    try { payload = await limitedJson(request, REQUEST_LIMIT); } catch { return failure(400, 'Invalid RPC request.'); }
    const isBatch = Array.isArray(payload);
    // JSON-RPC permits omitted params for parameterless calls. viem sends its
    // chain/head reads in that form; malformed or non-empty methods still fail
    // their exact parameter checks below.
    const calls = (isBatch ? payload : [payload]).map(call =>
      record(call) && !Object.hasOwn(call, 'params') ? { ...call, params: [] } : call);
    if (!calls.length || calls.length > MAX_BATCH || !calls.every(call => validCall(call, network))
      || new Set(calls.map(call => `${typeof call.id}:${call.id}`)).size !== calls.length) return failure(400, 'Only supported Rare Rush reads are available.');
    const time = now(), ip = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim().slice(0, 128) || 'local';
    for (const [key, value] of windows) if (value.until <= time) windows.delete(key);
    const key = `${network}:${ip}`, window = windows.get(key) ?? { count: 0, until: time + WINDOW_MS };
    const cost = calls.reduce((total, call) => total + (call.method === 'eth_getLogs' ? 10 : 1), 0);
    if (window.count + cost > CALL_BUDGET || !windows.has(key) && windows.size >= MAX_CLIENTS) return failure(429, 'Please wait briefly before retrying.', Math.max(1, Math.ceil((window.until - time) / 1000)));
    window.count += cost; windows.set(key, window);
    try {
      const env = typeof options.env === 'function' ? options.env() : options.env ?? process.env;
      const url = privateRpcUrl(network, env), signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
      await checkChain(network, url, signal);
      const result = safeReply(await send(url, isBatch ? calls : calls[0], signal), calls, isBatch);
      return Response.json(result, { headers: HEADERS });
    } catch (error) {
      if (error instanceof UpstreamBusy) return failure(429, 'The private RPC is busy. Please retry shortly.', error.retryAfter);
      return failure(503, 'The private RPC connection is temporarily unavailable. Try again shortly.');
    }
  };
}

export const privateRpcProxy = createPrivateRpcProxy();
