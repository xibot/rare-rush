import assert from 'node:assert/strict';
import test from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { type Address, type Hex } from 'viem';
import {
  AUTH_GAME, AUTH_SITE, AUTH_CHAIN_ID, MAX_VERIFY_REQUEST_BYTES,
  createAuthorization, authorizationTypedData, type VerifyRunRequest,
} from '../src/shared/authorization.ts';
import { createVerifierHandlers, RunVerificationRejected, type VerifierReceipt, type VerifierStatus } from '../server/handler.ts';

// Disposable fixtures; these keys never leave the test process or touch a network.
const wallet = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const other = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const version = `0x${'33'.repeat(32)}` as Hex;
const time = 1_800_000_000;
const status: VerifierStatus = { ready: true, chainId: AUTH_CHAIN_ID, game: AUTH_GAME, engineVersion: version, verifier: other.address, reason: 'ready' };
const replay = { version: 'rare-rush-input-v2' as const, frames: [] };

async function payload(options: { expiresAt?: number; runId?: string; signer?: typeof wallet } = {}): Promise<VerifyRunRequest> {
  const authorization = createAuthorization({ player: wallet.address, runId: options.runId ?? '1', replay, expiresAt: options.expiresAt ?? time + 180 });
  return { authorization, signature: await (options.signer ?? wallet).signTypedData(authorizationTypedData(authorization)), replay };
}
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${AUTH_SITE}/api/verify-run`, { method: 'POST', headers: { origin: AUTH_SITE, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}
function receiptFor(input: { runId: bigint; expectedPlayer: Address; replay: unknown }): VerifierReceipt {
  const authorization = createAuthorization({ player: input.expectedPlayer, runId: input.runId, replay: input.replay, expiresAt: time + 180 });
  return {
    chainId: AUTH_CHAIN_ID, game: AUTH_GAME, runId: input.runId.toString(), player: input.expectedPlayer,
    engineVersion: version, verifiedAtBlock: '42', replayHash: authorization.replayHash,
    pickupKinds: '0x00', deadline: String(time + 300), signature: `0x${'44'.repeat(65)}`,
    claimArgs: [input.runId.toString(), '0x00', authorization.replayHash, String(time + 300), `0x${'44'.repeat(65)}`],
  };
}
function fixture(overrides: Partial<Parameters<typeof createVerifierHandlers>[0]> = {}) {
  let calls = 0;
  const handlers = createVerifierHandlers({
    now: () => time, status: async () => status,
    verify: async input => { calls++; return receiptFor(input); },
    ...overrides,
  });
  return { ...handlers, calls: () => calls };
}

test('an authenticated player receives only the server-selected game receipt', async () => {
  const server = fixture();
  const result = await server.verify(request(await payload()));
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.player, wallet.address);
  assert.equal(body.game, AUTH_GAME);
  assert.equal(server.calls(), 1);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('access-control-allow-origin'), null);
});

test('wrong signer and chain/game/site signing domains fail before replay verification', async () => {
  const original = await payload();
  const typed = authorizationTypedData(original.authorization);
  const alternatives = [
    await other.signTypedData(typed),
    await wallet.signTypedData({ ...typed, domain: { ...typed.domain, chainId: 4663 } }),
    await wallet.signTypedData({ ...typed, domain: { ...typed.domain, verifyingContract: other.address } }),
    await wallet.signTypedData({ ...typed, message: { ...typed.message, site: 'https://rarerush.app' } }),
  ];
  for (const signature of alternatives) {
    const server = fixture();
    assert.equal((await server.verify(request({ ...original, signature }))).status, 401);
    assert.equal(server.calls(), 0);
  }
});

test('authorization binds the run and exact canonical replay', async () => {
  const original = await payload();
  const server = fixture();
  assert.equal((await server.verify(request({ ...original, authorization: { ...original.authorization, runId: '2' } }))).status, 401);
  assert.equal((await server.verify(request({ ...original, replay: { ...replay, frames: [{ tick: 0, jump: true, slide: false, pace: 0 }] } }))).status, 400);
  assert.equal(server.calls(), 0);
});

test('expired and excessively long-lived authorizations fail', async () => {
  for (const expiresAt of [time, time - 1, time + 301]) {
    const server = fixture();
    assert.equal((await server.verify(request(await payload({ expiresAt })))).status, 401);
    assert.equal(server.calls(), 0);
  }
});

test('extra fields, client configuration and supplied scores are rejected', async () => {
  const original = await payload();
  for (const changed of [
    { ...original, rpcUrl: 'https://malicious.invalid' },
    { ...original, privateKey: 'not-accepted' },
    { ...original, authorization: { ...original.authorization, chainId: 46630 } },
    { ...original, replay: { ...replay, score: 10000 } },
    { ...original, replay: { ...replay, frames: [{ tick: 0, jump: true, slide: false, pace: 0, coins: 10 }] } },
  ]) {
    const server = fixture();
    assert.equal((await server.verify(request(changed))).status, 400);
    assert.equal(server.calls(), 0);
  }
});

test('origin, host, method and content-type are constrained', async () => {
  const original = await payload();
  const server = fixture();
  assert.equal((await server.verify(request(original, { origin: 'https://evil.invalid' }))).status, 403);
  assert.equal((await server.verify(request(original, { origin: '' }))).status, 403);
  assert.equal((await server.verify(request(original, { 'sec-fetch-site': 'cross-site' }))).status, 403);
  assert.equal((await server.verify(request(original, { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await server.verify(request(original, { 'content-encoding': 'gzip' }))).status, 415);
  assert.equal((await server.verify(new Request(`${AUTH_SITE}/api/verify-run`))).status, 405);
  assert.equal((await server.verify(new Request('https://evil.invalid/api/verify-run', { method: 'POST', headers: { origin: AUTH_SITE, 'content-type': 'application/json' }, body: JSON.stringify(original) }))).status, 403);
  assert.equal(server.calls(), 0);
});

test('oversized content-length and streamed bodies stop before verification', async () => {
  const server = fixture();
  assert.equal((await server.verify(request('{}', { 'content-length': String(MAX_VERIFY_REQUEST_BYTES + 1) }))).status, 413);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(800_000)); },
    cancel() { cancelled = true; },
  });
  const streamed = new Request(`${AUTH_SITE}/api/verify-run`, { method: 'POST', headers: { origin: AUTH_SITE, 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit);
  assert.equal((await server.verify(streamed)).status, 413);
  assert.equal(cancelled, true);
  assert.equal(server.calls(), 0);
});

test('malformed JSON and signatures return bounded errors', async () => {
  const server = fixture();
  assert.equal((await server.verify(request('{'))).status, 400);
  assert.equal((await server.verify(request({ ...await payload(), signature: '0x1234' }))).status, 400);
  assert.equal(server.calls(), 0);
});

test('authenticated ineligible runs return 422 without internal details', async () => {
  const server = fixture({ verify: async () => { throw new RunVerificationRejected('Private detail'); } });
  const result = await server.verify(request(await payload()));
  assert.equal(result.status, 422);
  assert.equal((await result.text()).includes('Private detail'), false);
});

test('service errors release concurrency and never expose secrets', async () => {
  let count = 0;
  const server = fixture({ maxActive: 1, verify: async input => {
    if (++count === 1) throw new Error('private key secret upstream body');
    return receiptFor(input);
  } });
  const result = await server.verify(request(await payload()));
  assert.equal(result.status, 503);
  assert.equal((await result.text()).includes('private key'), false);
  assert.equal((await server.verify(request(await payload()))).status, 200);
});

test('one run cannot be verified concurrently and locks release afterward', async () => {
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const server = fixture({ verify: async input => { entered(); await blocked; return receiptFor(input); } });
  const original = await payload();
  const first = server.verify(request(original));
  await enteredPromise;
  assert.equal((await server.verify(request(original))).status, 409);
  release();
  assert.equal((await first).status, 200);
  assert.equal((await server.verify(request(original))).status, 200);
});

test('per-wallet rate limits apply before repeated replay work', async () => {
  const server = fixture();
  const original = await payload();
  for (let index = 0; index < 10; index++) assert.equal((await server.verify(request(original))).status, 200);
  const denied = await server.verify(request(original));
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get('retry-after'), '60');
  assert.equal(server.calls(), 10);
});

test('status is cached, read-only, and readiness gates verification', async () => {
  let checks = 0;
  const server = fixture({ status: async () => { checks++; return { ...status, ready: false, verifier: null, reason: 'not-configured' }; } });
  for (let index = 0; index < 2; index++) {
    const result = await server.status(new Request(`${AUTH_SITE}/api/status`));
    assert.equal(result.status, 200);
    assert.equal((await result.json()).reason, 'not-configured');
  }
  assert.equal(checks, 1);
  assert.equal((await server.verify(request(await payload()))).status, 503);
  assert.equal(server.calls(), 0);
});

test('a transient RPC outage recovers on the next status check without waiting for cache expiry', async () => {
  let checks = 0;
  const server = fixture({ status: async () => ++checks === 1
    ? { ...status, ready: false, verifier: null, reason: 'rpc-unavailable' }
    : status });
  const probe = () => server.status(new Request(`${AUTH_SITE}/api/status`));
  assert.equal((await (await probe()).json()).ready, false);
  // The fixture clock has not advanced: CHECK AGAIN must reach the recovered RPC.
  assert.equal((await (await probe()).json()).ready, true);
  assert.equal((await (await probe()).json()).ready, true);
  assert.equal(checks, 2, 'successful readiness is still cached');
  assert.equal((await server.verify(request(await payload()))).status, 200);
});

test('concurrent outage probes share one request and release it for recovery', async () => {
  let checks = 0;
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const server = fixture({ status: async () => {
    checks++;
    if (checks === 1) { await wait; return { ...status, ready: false, reason: 'rpc-unavailable' }; }
    return status;
  } });
  const probe = () => server.status(new Request(`${AUTH_SITE}/api/status`));
  const first = probe();
  const second = probe();
  release();
  assert.equal((await (await first).json()).ready, false);
  assert.equal((await (await second).json()).ready, false);
  assert.equal(checks, 1);
  assert.equal((await (await probe()).json()).ready, true);
  assert.equal(checks, 2);
});

test('a mismatched backend receipt is never returned to the browser', async () => {
  const server = fixture({ verify: async input => ({ ...receiptFor(input), player: other.address }) });
  assert.equal((await server.verify(request(await payload()))).status, 503);
});

test('authorization expiry is checked again after replay work', async () => {
  let current = time;
  const server = fixture({ now: () => current, verify: async input => { current += 200; return receiptFor(input); } });
  assert.equal((await server.verify(request(await payload()))).status, 401);
});
