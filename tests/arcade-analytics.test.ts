import assert from 'node:assert/strict';
import test from 'node:test';
import { createArcadeEventReporter, EXCLUDED_ARCADE_WALLET, isArcadeAnalyticsOrigin, parseArcadeSignal, startArcadeAnalytics, type ArcadeSignal } from '../games/rare-rush/analytics.ts';

const id = '11111111-1111-4111-8111-111111111111';
const start: ArcadeSignal = { version: 1, type: 'rarerush:arcade-start', runId: id, collection: 'generations', difficulty: 'normal' };
const finish: ArcadeSignal = { version: 1, type: 'rarerush:arcade-finish', runId: id, finishReason: 'time', elapsedSeconds: 90 };
const wallet = '0x1111111111111111111111111111111111111111';
const flush = () => new Promise(resolve => setTimeout(resolve, 10));

test('only exact production Arcade origins and bounded lifecycle signals are accepted', () => {
  for (const origin of ['https://rarerush.app', 'https://rarerush.vercel.app']) assert.equal(isArcadeAnalyticsOrigin(origin), true);
  for (const origin of ['null', 'http://rarerush.app', 'http://localhost:4173', 'https://www.rarerush.app', 'https://testnet.rarerush.app', 'https://rarerush-git-preview.vercel.app', 'https://rarerush.app.evil.example']) assert.equal(isArcadeAnalyticsOrigin(origin), false);
  assert.deepEqual(parseArcadeSignal(start), start);
  assert.deepEqual(parseArcadeSignal(finish), finish);
  for (const bad of [null, [], { ...start, wallet }, { ...start, runId: 'not-a-uuid' }, { ...start, difficulty: 'expert' }, { ...finish, finishReason: 'abandoned' }, { ...finish, elapsedSeconds: Infinity }, { ...finish, elapsedSeconds: 121 }, { ...finish, elapsedSeconds: 0 }]) assert.equal(parseArcadeSignal(bad), null);
});

test('reporter excludes owner and all preview/local/testnet origins without a fetch', async () => {
  const fetcher = (async () => { assert.fail('Excluded telemetry must never fetch'); }) as typeof fetch;
  for (const origin of ['http://localhost:4173', 'https://testnet.rarerush.app', 'https://preview.vercel.app']) {
    const reporter = createArcadeEventReporter(origin, fetcher); reporter.start(start, wallet); reporter.finish(finish);
  }
  const reporter = createArcadeEventReporter('https://rarerush.app', fetcher);
  reporter.start(start, EXCLUDED_ARCADE_WALLET.toUpperCase().replace('0X', '0x')); reporter.finish(finish);
  await flush();
});

test('finish waits for its start receipt; duplicate lifecycle messages do not duplicate requests', async () => {
  const calls: Record<string, unknown>[] = [];
  let resolveStart!: (response: Response) => void;
  const fetcher = (async (_url, options) => {
    const body = JSON.parse(options!.body as string); calls.push(body);
    assert.equal(options!.credentials, 'same-origin'); assert.equal(options!.keepalive, true);
    return body.type === 'start' ? new Promise<Response>(resolve => { resolveStart = resolve; }) : Response.json({ accepted: true });
  }) as typeof fetch;
  const reporter = createArcadeEventReporter('https://rarerush.app', fetcher);
  reporter.start(start, wallet); reporter.start(start, wallet); reporter.finish(finish); reporter.finish(finish);
  assert.equal(calls.length, 1);
  resolveStart(Response.json({ accepted: true, receipt: 'private-receipt' }));
  await flush();
  assert.deepEqual(calls, [{ version: 1, type: 'start', runId: id, wallet, collection: 'generations', difficulty: 'normal' }, { version: 1, type: 'finish', receipt: 'private-receipt', finishReason: 'time', elapsedSeconds: 90 }]);
});

test('transient retry uses the same UUID and receipt; unknown or invalid finishes are ignored', async () => {
  const calls: Record<string, unknown>[] = [];
  const fetcher = (async (_url, options) => {
    const body = JSON.parse(options!.body as string); calls.push(body);
    if (calls.length === 1) throw new Error('Temporary network failure');
    return Response.json({ accepted: true, receipt: 'same-receipt' });
  }) as typeof fetch;
  const reporter = createArcadeEventReporter('https://rarerush.app', fetcher);
  reporter.finish(finish); reporter.start(start, wallet);
  reporter.finish({ ...finish, elapsedSeconds: 2 });
  await new Promise(resolve => setTimeout(resolve, 330));
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
  reporter.finish(finish); await flush();
  assert.equal(calls.length, 3); assert.equal(calls[2].receipt, 'same-receipt');
});

test('child emits no identity and one natural completion; local standalone captures are silent', () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { parent: {}, location: { href: 'https://rarerush.app/genesis/game.html' } } });
    const signals: ArcadeSignal[] = [];
    const run = startArcadeAnalytics('genesis', 'easy', signal => signals.push(signal));
    assert.ok(run); run.finish('hearts', 35); run.finish('time', 120);
    assert.equal(signals.length, 2);
    assert.equal(signals[0].type, 'rarerush:arcade-start'); assert.equal(signals[1].type, 'rarerush:arcade-finish');
    assert.equal(signals[0].runId, signals[1].runId);
    assert.equal('wallet' in signals[0], false); assert.equal('receipt' in signals[1], false);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { parent: {}, location: { href: 'http://localhost:4173/play/game.html' } } });
    assert.equal(startArcadeAnalytics('genesis', 'easy', () => assert.fail('No local telemetry')), null);
    const standalone = { parent: null as unknown, location: { href: 'https://rarerush.app/play/game.html' } };
    standalone.parent = standalone;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: standalone });
    assert.equal(startArcadeAnalytics('generations', 'easy', () => assert.fail('No standalone telemetry')), null);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { parent: {}, location: { href: 'https://rarerush.app/play/game.html' } } });
    assert.equal(startArcadeAnalytics('genesis', 'easy', () => { throw new Error('Closed port'); }), null);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
