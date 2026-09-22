import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toHex } from 'viem';
import { createRecorder, advanceRecorder, exportReplay, queueControls, releaseControls, snapshotRun, REPLAY_VERSION, type DifficultyId, type Recording } from '../src/play/recorder.ts';
import { verifyReplay } from '../generated/infra/testnet/src/replay.ts';
import { createRun, jump, setPace, setSliding, stepRun, FIXED_STEP } from '../generated/games/rare-rush/engine.ts';

const seed = keccak256(toHex('rare-rush-replay-test'));
// Test fixture only. No automated input source is imported into the public renderer.
function testControls(recording: Recording) {
  const run = recording.run;
  const next = run.entities.filter(entity => ['crystal', 'block', 'drone'].includes(entity.kind) && !entity.hit && entity.x + entity.w > run.player.x)
    .sort((first, second) => first.x - second.x)[0];
  const until = next ? (next.x - run.player.x - run.player.w) / run.speed : Infinity;
  queueControls(recording, {
    slide: Boolean(next?.kind === 'drone' && until < .6), pace: 0,
    jump: Boolean(next && next.kind !== 'drone' && (until < .24 && run.player.grounded || until < .3 && run.player.jumps === 1 && run.player.vy >= -80)),
  });
}
function finish(recording: Recording) {
  while (recording.run.status === 'running') { testControls(recording); advanceRecorder(recording); }
}

test('recorder matches the authoritative verifier for all difficulties with the chain seed', () => {
  const modes: DifficultyId[] = ['easy', 'normal', 'degen'];
  modes.forEach((difficulty, id) => {
    const recording = createRecorder(seed, difficulty);
    finish(recording);
    const replay = exportReplay(recording);
    const result = verifyReplay(seed, id, replay);
    const snapshot = snapshotRun(recording);
    assert.deepEqual({ coins: result.coins, bonusCoins: result.bonusCoins, hearts: result.hearts, score: result.score, distance: result.distance, ticks: result.ticks },
      { coins: snapshot.coins, bonusCoins: snapshot.bonusCoins, hearts: snapshot.hearts, score: snapshot.score, distance: Math.floor(snapshot.distance), ticks: snapshot.completedTicks });
    assert.equal(replay.frames.length, snapshot.completedTicks);
    assert.ok(Buffer.byteLength(JSON.stringify(replay)) < 1_500_000, 'max duration replay stays under server payload limit');
  });
});

test('inputs are queued without mutating physics, then applied in verifier order', () => {
  const recording = createRecorder(seed, 'normal');
  const expected = createRun(seed, 'normal');
  const before = snapshotRun(recording);
  queueControls(recording, { slide: true, pace: 1, jump: true });
  assert.deepEqual(snapshotRun(recording), before);
  const result = advanceRecorder(recording);
  setSliding(expected, true); setPace(expected, 1); jump(expected); stepRun(expected, FIXED_STEP);
  assert.deepEqual(recording.run, expected);
  assert.equal(result.inputChanged, true);
  assert.deepEqual(recording.replay.frames[0], { tick: 0, jump: true, slide: true, pace: 1 });
  // The held slide is reapplied on the next tick, which is essential after jump clears it.
  advanceRecorder(recording);
  setSliding(expected, true); setPace(expected, 1); stepRun(expected, FIXED_STEP);
  assert.deepEqual(recording.run, expected);
});

test('resuming reconstructs exact state and all future outcomes from saved inputs', () => {
  for (const difficulty of ['easy', 'normal', 'degen'] as const) {
    const original = createRecorder(seed, difficulty);
    for (let i = 0; i < 1901; i++) { testControls(original); advanceRecorder(original); }
    const saved = exportReplay(original);
    const restored = createRecorder(seed, difficulty, saved, original.run._tick);
    assert.deepEqual(restored.run, original.run);
    finish(original); finish(restored);
    assert.deepEqual(restored.run, original.run);
    assert.deepEqual(exportReplay(restored), exportReplay(original));
    assert.deepEqual(verifyReplay(seed, ['easy', 'normal', 'degen'].indexOf(difficulty), exportReplay(restored)),
      verifyReplay(seed, ['easy', 'normal', 'degen'].indexOf(difficulty), exportReplay(original)));
  }
});

test('pause releases held controls and discards unconsumed jump presses without advancing ticks', () => {
  const recording = createRecorder(seed, 'normal');
  queueControls(recording, { slide: true, pace: -1 }); advanceRecorder(recording);
  const before = snapshotRun(recording);
  queueControls(recording, { jump: true });
  releaseControls(recording);
  assert.deepEqual(snapshotRun(recording), before);
  advanceRecorder(recording);
  assert.deepEqual(recording.replay.frames.at(-1), { tick: 1, jump: false, slide: false, pace: 0 });
});

test('finished recordings never add extra inputs; lost runs cannot pass verification', () => {
  const recording = createRecorder(seed, 'normal');
  while (recording.run.status === 'running') advanceRecorder(recording);
  assert.equal(recording.run.finishReason, 'hearts');
  const replay = exportReplay(recording);
  queueControls(recording, { jump: true, pace: 1 }); advanceRecorder(recording);
  assert.deepEqual(exportReplay(recording), replay);
  assert.throws(() => verifyReplay(seed, 1, replay), /did not survive/);
  assert.deepEqual(createRecorder(seed, 'normal', replay, recording.run._tick).run, recording.run);
  assert.throws(() => createRecorder(seed, 'normal', replay, recording.run._tick + 1), /after this run ended/);
});

test('restore rejects invalid chain seeds, ticks, frames and injected client state', () => {
  const replay = { version: REPLAY_VERSION, frames: [{ tick: 0, jump: true, slide: false, pace: 0 as const }] };
  assert.throws(() => createRecorder('0x1234', 'normal'), /contract seed/);
  for (const ticks of [-1, .1, NaN, 10801]) assert.throws(() => createRecorder(seed, 'normal', replay, ticks));
  assert.throws(() => createRecorder(seed, 'normal', undefined, 1), /saved replay/);
  assert.throws(() => createRecorder(seed, 'normal', replay, 0), /completed ticks/);
  for (const input of [
    { ...replay, score: 999999 }, { ...replay, seed }, { ...replay, version: 'other' },
    { ...replay, frames: [{ ...replay.frames[0], hearts: 3 }] },
    { ...replay, frames: [replay.frames[0], replay.frames[0]] },
    { ...replay, frames: [{ ...replay.frames[0], pace: 2 }] },
  ]) assert.throws(() => createRecorder(seed, 'normal', input as never, 1));
});

test('exported replay and snapshots cannot mutate the live recording', () => {
  const recording = createRecorder(seed, 'normal');
  advanceRecorder(recording);
  const replay = exportReplay(recording);
  const snapshot = snapshotRun(recording);
  replay.frames[0].jump = true;
  snapshot.player.y = -500;
  snapshot.entities.length = 0;
  assert.equal(recording.replay.frames[0].jump, false);
  assert.equal(recording.run.player.y, 400);
  assert.ok(recording.run.entities.length > 0);
});
