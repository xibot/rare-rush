import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toHex, type Address, type Hash } from 'viem';
import { emptyPlayState, loadPlayState, savePlayState, stateKey, validateVerifiedClaim } from '../src/play/storage.ts';
import { ENGINE_VERSION, PLAY_CONTRACTS, type RunSnapshot, type VerifiedClaim } from '../src/play/types.ts';

const account = `0x${'1'.repeat(40)}` as Address;
const other = `0x${'2'.repeat(40)}` as Address;
const seed = `0x${'3'.repeat(64)}` as Hash;
const replay = { version: 'rare-rush-input-v2' as const, frames: [] };
const run: RunSnapshot = { runId: '5', player: account, tokenId: '7', seed, startedAt: '1000', claimUntil: '1990', verifierEpoch: '1', collection: 0, difficulty: 1, claimed: false, abandoned: false };
function memory() { const items = new Map<string, string>(); return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } }; }
function receipt(): VerifiedClaim {
  const hash = keccak256(toHex(JSON.stringify(replay)));
  const signature = `0x${'4'.repeat(130)}` as const;
  return { chainId: 46630, game: PLAY_CONTRACTS.game, runId: '5', player: account, engineVersion: ENGINE_VERSION, pickupKinds: '0x0001', replayHash: hash, deadline: '1500', signature, claimArgs: ['5', '0x0001', hash, '1500', signature] };
}
test('saved progress survives reload and is isolated by account, game and chain', () => {
  const store = memory(); const state = emptyPlayState(account);
  state.savedRun = { run, replay, completedTicks: 10800, status: 'survived', claim: receipt() };
  savePlayState(store, state);
  assert.deepEqual(loadPlayState(store, account), state);
  assert.equal(loadPlayState(store, other).savedRun, null);
  store.setItem(stateKey(other), JSON.stringify(state));
  assert.throws(() => loadPlayState(store, other), /invalid/);
});
test('corrupt or cross-chain checkpoints never silently reset to an empty playable state', () => {
  for (const patch of [{ version: 1 }, { chainId: 4663 }, { game: other }, { account: other }]) {
    const store = memory(); store.setItem(stateKey(account), JSON.stringify({ ...emptyPlayState(account), ...patch }));
    assert.throws(() => loadPlayState(store, account), /invalid/);
  }
  const store = memory(); store.setItem(stateKey(account), '{broken');
  assert.throws(() => loadPlayState(store, account), /invalid/);
});
test('replay controls, completed ticks and serialized size are bounded on reload', () => {
  const invalid = [
    { completedTicks: 10801 },
    { completedTicks: 1, replay: { ...replay, frames: [{ tick: 1, jump: false, slide: false, pace: 0 }] } },
    { completedTicks: 10, replay: { ...replay, frames: [{ tick: 2, jump: false, slide: false, pace: 0 }, { tick: 1, jump: false, slide: false, pace: 0 }] } },
    { completedTicks: 10, replay: { ...replay, frames: [{ tick: 1, jump: true, slide: false, pace: 9 }] } },
    { completedTicks: 0, status: 'survived' },
  ];
  for (const patch of invalid) {
    const state = emptyPlayState(account);
    state.savedRun = Object.assign({ run, replay, completedTicks: 0, status: 'ready' }, patch) as typeof state.savedRun;
    assert.throws(() => savePlayState(memory(), state));
  }
  const store = memory(); store.setItem(stateKey(account), ' '.repeat(1_800_001));
  assert.throws(() => loadPlayState(store, account), /invalid/);
});
test('claim data must bind the exact player, game, run, engine, replay and tuple', () => {
  for (const patch of [{ chainId: 4663 }, { player: other }, { game: other }, { runId: '8' }, { engineVersion: seed }, { deadline: '2000' }, { pickupKinds: '0x02' }, { claimArgs: ['5', '0x0000', seed, '1500', receipt().signature] }]) {
    assert.throws(() => validateVerifiedClaim({ ...receipt(), ...patch }, run, replay));
  }
  const altered = { ...replay, frames: [{ tick: 1, jump: true, slide: false, pace: 0 }] };
  assert.throws(() => validateVerifiedClaim(receipt(), run, altered), /another replay/);
});
test('pending transaction metadata must be safe, bounded and attached to its saved run', () => {
  for (const patch of [{ to: other }, { nonce: -1 }, { hash: '0x123' }, { value: '1' }, { data: `0x${'00'.repeat(2049)}` }, { kind: 'claim', runId: '6', claim: receipt() }]) {
    const state = emptyPlayState(account);
    state.pending = { kind: 'start', to: PLAY_CONTRACTS.game, data: '0x12345678', value: '0', nonce: 3, hash: null, createdAt: 1000, selection: { collection: 0, tokenId: '7', difficulty: 1 }, ...patch } as typeof state.pending;
    assert.throws(() => savePlayState(memory(), state));
  }
});
test('storage failure fails closed instead of pretending a checkpoint was persisted', () => {
  const store = { getItem: () => null, setItem: () => {} };
  assert.throws(() => savePlayState(store, emptyPlayState(account)), /Could not save/);
  assert.throws(() => savePlayState({ ...store, setItem: () => { throw new Error('quota'); } }, emptyPlayState(account)), /quota/);
});
test('V2 remembers existing test NFT IDs without moving or overwriting any V1 transaction or run', () => {
  const store = memory();
  const key = `rare-rush:play:v1:46630:0x24bca5bf559e0353801f719ebc3885441cb49fd3:${account}`;
  const old = JSON.stringify({ version: 1, chainId: 46630, game: '0x24bca5bf559e0353801f719ebc3885441cb49fd3', account,
    friends: [{ collection: 0, tokenId: '7' }, { collection: 1, tokenId: '2' }, { collection: 4, tokenId: '9' }],
    pending: { hash: seed }, savedRun: { replay: { version: 'rare-rush-input-v1', frames: [] } } });
  store.setItem(key, old);
  const next = loadPlayState(store, account);
  assert.equal(next.version, 2);
  assert.deepEqual(next.friends, [{ collection: 0, tokenId: '7' }, { collection: 1, tokenId: '2' }]);
  assert.equal(next.pending, null); assert.equal(next.savedRun, null);
  savePlayState(store, next);
  assert.equal(store.getItem(key), old);
  assert.notEqual(stateKey(account), key);
});
test('V1 replay data cannot become a V2 run even when copied into the new storage key', () => {
  const state = emptyPlayState(account);
  state.savedRun = { run, replay: { version: 'rare-rush-input-v1', frames: [] } as any, completedTicks: 0, status: 'ready' };
  assert.throws(() => savePlayState(memory(), state), /Unsupported replay schema/);
});
