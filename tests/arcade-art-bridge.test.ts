import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeGenerationSprites } from '@rarefriends/friendsdk/sprites';
import { decodeArcadeArt, parseArcadeArtRequest } from '../games/rare-rush/art-bridge.ts';
import { bindGenerationsArtwork } from '../games/rare-rush/host-art.ts';

const requestId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const payload = { tokenId: '42', familyId: 2, seed: 42, frames: Array(64).fill('17') };
const request = { type: 'rarerush:request-art', requestId, tokenId: '42' };

test('art bridge accepts only bounded selected-token bitmap data', () => {
  assert.deepEqual(parseArcadeArtRequest(request), { requestId, tokenId: '42' });
  for (const tokenId of ['0', '-1', '0x2a', String(1n << 256n), '4'.repeat(79)]) {
    assert.equal(parseArcadeArtRequest({ ...request, tokenId }), null);
  }
  assert.equal(parseArcadeArtRequest({ ...request, type: 'eth_call' }), null);
  assert.equal(decodeArcadeArt(payload, 42n).tokenId, 42n);
  for (const changed of [{ tokenId: '43' }, { familyId: -1 }, { seed: 0x100000000 },
    { frames: Array(65).fill('1') }, { frames: Array(64).fill(String(1n << 256n)) }, { frames: Array(64).fill('<svg/>') }]) {
    assert.throws(() => decodeArcadeArt({ ...payload, ...changed }, 42n));
  }
});

function fixture(t: { after: (fn: () => void) => void }, read: Parameters<typeof bindGenerationsArtwork>[1]) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const windowMock = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowMock });
  const identity = new MessageChannel();
  const state = { tokenId: '42', connected: true };
  const frame = { get isConnected() { return state.connected; }, contentWindow: identity.port1 };
  const root = { querySelector(selector: string) {
    return selector === '.rf-frame-viewport > iframe' ? frame : { textContent: `Friend #${state.tokenId}` };
  } } as unknown as HTMLElement;
  const bridge = bindGenerationsArtwork(root, read);
  t.after(() => {
    bridge.close(); identity.port1.close(); identity.port2.close();
    if (previous) Object.defineProperty(globalThis, 'window', previous); else delete (globalThis as Record<string, unknown>).window;
  });
  const send = (data = request, origin = 'null', source = identity.port1) => {
    const channel = new MessageChannel();
    t.after(() => { channel.port1.close(); channel.port2.close(); });
    const response = new Promise<Record<string, unknown>>(resolve => { channel.port1.onmessage = event => resolve(event.data); });
    windowMock.dispatchEvent(new MessageEvent('message', { data, origin, source, ports: [channel.port2] }));
    return { response, channel };
  };
  return { state, send, bridge };
}

test('only the active opaque child receives its selected Friend artwork', async t => {
  let reads = 0;
  const f = fixture(t, async id => { reads++; assert.equal(id, 42n); return decodeGenerationSprites(42n, 2, 42, Array(64).fill(17n)); });
  f.send({ ...request, tokenId: '43' });
  f.send(request, 'https://example.invalid');
  const unrelated = new MessageChannel();
  f.send(request, 'null', unrelated.port1); unrelated.port1.close(); unrelated.port2.close();
  await Promise.resolve(); assert.equal(reads, 0);
  const reply = await f.send().response;
  assert.equal(reads, 1);
  assert.deepEqual(reply, { type: 'rarerush:art-result', requestId, art: payload });
});

test('selection changes cancel pending artwork and late results cannot reach a new selection', async t => {
  let release!: (art: ReturnType<typeof decodeGenerationSprites>) => void;
  let signal!: AbortSignal;
  const f = fixture(t, async (_, active) => { signal = active; return new Promise(resolve => { release = resolve; }); });
  const pending = f.send(); await Promise.resolve();
  f.state.tokenId = '43'; f.bridge.update();
  assert.equal(signal.aborted, true);
  assert.deepEqual(await pending.response, { type: 'rarerush:art-result', requestId, error: true });
  release(decodeGenerationSprites(42n, 2, 42, Array(64).fill(17n)));
  await Promise.resolve();
});

test('art RPC failure returns fixed safe text and never an endpoint or provider object', async t => {
  const f = fixture(t, async () => { throw new Error('https://private.example/SECRET'); });
  const response = await f.send().response;
  assert.deepEqual(response, { type: 'rarerush:art-result', requestId, error: true });
  assert.equal(JSON.stringify(response).includes('SECRET'), false);
});
