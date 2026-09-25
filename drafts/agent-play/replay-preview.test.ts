import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplayPreview, resetReplayPreview } from './replay-preview.ts';
import { createAgentSession, createReplaySession, advanceReplay, runSessionToEnd, exportAgentReplay,
  getSessionMetrics, AGENT_REPLAY_VERSION, PROTOCOL_VERSION, FIXED_STEP, type AgentReplay,
  type InputFrame } from './runner.ts';
import { createRun, setPace, stepRun } from '../../games/rare-rush/twist/engine.ts';

const seed = `0x${'1a'.repeat(32)}`;

for (const difficulty of ['easy', 'normal', 'degen'] as const) {
  test(`${difficulty}: excerpt includes the actual first twist and preserves every engine state`, () => {
    const original = runSessionToEnd(createAgentSession(seed, difficulty));
    const replay = exportAgentReplay(original);
    const record = { seed, difficulty, metrics: { score: 999_999_999 } };
    const clip = createReplayPreview(record, replay);
    assert.deepEqual(clip.metrics, getSessionMetrics(original));
    assert.ok(clip.transitionTick !== null);
    assert.equal(clip.startTick, clip.transitionTick - 120);
    assert.equal(clip.endTick - clip.startTick, 720);
    assert.equal(clip.start.run._tick, clip.startTick);

    const expected = createReplaySession(seed, difficulty, replay);
    while (expected.run._tick < clip.startTick) advanceReplay(expected);
    assert.deepEqual(clip.start, expected, 'The baseline is reached only through the saved controls');
    const preview = resetReplayPreview(clip);
    let firstTwist: number | null = null;
    while (preview.run._tick < clip.endTick) {
      advanceReplay(preview); advanceReplay(expected);
      assert.deepEqual(preview.run, expected.run);
      if (preview.run.transition && firstTwist === null) firstTwist = preview.run._tick;
    }
    assert.equal(firstTwist, clip.transitionTick);
    assert.deepEqual(resetReplayPreview(clip), clip.start, 'Every loop restarts at the same recorded state');
  });
}

test('a legal loss shorter than six seconds uses its opening and stops exactly at the terminal tick', () => {
  const shortSeed = 'preview-loss-16';
  const run = createRun(shortSeed, 'degen');
  const frames: InputFrame[] = [];
  while (run.status === 'running') {
    frames.push({ tick: run._tick, jump: false, slide: false, pace: 1 });
    setPace(run, 1); stepRun(run, FIXED_STEP);
  }
  assert.equal(run.finishReason, 'hearts');
  assert.ok(run._tick < 720);
  const replay: AgentReplay = { version: AGENT_REPLAY_VERSION, finalTick: run._tick, inputs: { version: PROTOCOL_VERSION, frames } };
  const clip = createReplayPreview({ seed: shortSeed, difficulty: 'degen' }, replay);
  assert.equal(clip.transitionTick, null);
  assert.equal(clip.startTick, 0);
  assert.equal(clip.endTick, run._tick);
  assert.equal(clip.metrics.outcome, 'lost');
  const preview = resetReplayPreview(clip);
  while (preview.run._tick < clip.endTick) advanceReplay(preview);
  assert.equal(preview.run.status, 'finished');
  assert.deepEqual(preview.run, run);
});

test('loops share frozen inputs while mutable state and writable arrays remain independent', () => {
  const replay = exportAgentReplay(runSessionToEnd(createAgentSession(seed, 'degen')));
  const clip = createReplayPreview({ seed, difficulty: 'degen' }, replay);
  assert.ok(Object.isFrozen(clip));
  assert.ok(Object.isFrozen(clip.start.run.player));
  assert.ok(Object.isFrozen(clip.start.replay!.inputs.frames[0]));
  assert.throws(() => { clip.start.run.player.x = 9999; }, TypeError);
  const first = resetReplayPreview(clip), second = resetReplayPreview(clip);
  assert.equal(first.replay, clip.start.replay, 'Do not copy the complete recording on every loop');
  assert.equal(second.replay, first.replay);
  assert.equal(first.frames[0], clip.start.frames[0], 'Frozen prefix controls are safe to share');
  for (const key of ['frames', 'events', 'pickupKinds', 'phasesVisited'] as const) {
    assert.notEqual(first[key], second[key]);
    assert.notEqual(first[key], clip.start[key]);
    assert.equal(Object.isFrozen(first[key]), false);
  }
  assert.notEqual(first.run, second.run);
  assert.notEqual(first.run.player, second.run.player);
  assert.notEqual(first.run.phasePlan, second.run.phasePlan);
  assert.notEqual(first.lastControl, second.lastControl);
  advanceReplay(first);
  assert.equal(second.run._tick, clip.startTick);
  assert.equal(clip.start.run._tick, clip.startTick);
  const originalPace = clip.start.replay!.inputs.frames[0].pace;
  replay.inputs.frames[0].pace = originalPace === 1 ? -1 : 1;
  assert.throws(() => { first.replay!.inputs.frames[0].pace = originalPace === -1 ? 1 : -1; }, TypeError);
  assert.throws(() => { first.frames[0].pace = originalPace === -1 ? 1 : -1; }, TypeError);
  first.run.player.x = 9999;
  first.run.phasePlan[0].end = 0;
  first.frames.length = 0;
  first.pickupKinds.push(0);
  first.phasesVisited.push('down');
  assert.notEqual(second.run.player.x, 9999);
  assert.notEqual(second.run.phasePlan[0].end, 0);
  assert.deepEqual(second, clip.start);
  assert.equal(clip.start.replay!.inputs.frames[0].pace, originalPace);
  assert.equal(second.replay!.inputs.frames[0].pace, originalPace);
});

test('invalid or unfinished data beyond the selected excerpt still rejects the entire preview', () => {
  const replay = exportAgentReplay(runSessionToEnd(createAgentSession(seed, 'degen')));
  const record = { seed, difficulty: 'degen' as const };
  const truncated = structuredClone(replay);
  truncated.inputs.frames.pop(); truncated.finalTick--;
  assert.throws(() => createReplayPreview(record, truncated), /Incomplete.*final tick/);
  const trailing = structuredClone(replay);
  trailing.inputs.frames.push({ tick: trailing.finalTick++, jump: false, slide: false, pace: 0 });
  assert.throws(() => createReplayPreview(record, trailing));
  const invalid = structuredClone(replay);
  invalid.inputs.frames[invalid.finalTick - 1].pace = 7 as InputFrame['pace'];
  assert.throws(() => createReplayPreview(record, invalid));
  assert.throws(() => createReplayPreview(record, { ...replay, score: 999999 }));
});
