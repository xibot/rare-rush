import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeReplayPreview, createReplayPreviewFromCandidate, createReplayPreview, resetReplayPreview } from './replay-preview.ts';
import { createAgentSession, createReplaySession, advanceReplay, runSessionToEnd, exportAgentReplay,
  getSessionMetrics, AGENT_REPLAY_VERSION, PROTOCOL_VERSION, FIXED_STEP, type AgentReplay,
  type InputFrame } from './runner.ts';
import { createRun, setPace, stepRun } from '../games/rare-rush/twist/engine.ts';
import { headingFor } from '../games/rare-rush/twist/presentation.ts';

const seed = `0x${'1a'.repeat(32)}`;

for (const difficulty of ['easy', 'normal', 'degen'] as const) {
  test(`${difficulty}: catalogue kinds describe real stable gameplay and selected clips preserve engine state`, () => {
    const original = runSessionToEnd(createAgentSession(seed, difficulty));
    const replay = exportAgentReplay(original);
    const record = { seed, difficulty, metrics: { score: 999_999_999 } };
    const catalogue = analyzeReplayPreview(record, replay);
    assert.deepEqual(catalogue.metrics, getSessionMetrics(original));
    assert.deepEqual([...new Set(catalogue.candidates.map(item => item.kind))].sort(), ['coins', 'down', 'jump', 'left', 'side', 'up']);
    assert.ok(catalogue.candidates.length <= 24);
    assert.equal(new Set(catalogue.candidates.map(item => `${item.startTick}:${item.endTick}`)).size, catalogue.candidates.length,
      'The same timestamp window must not be relabeled as different actions');
    const representatives = [...new Map(catalogue.candidates.map(candidate => [candidate.kind, candidate])).values()];
    const boundaries = new Set(representatives.flatMap(candidate => [candidate.startTick, candidate.endTick]));
    const snapshots = new Map<number, typeof original.run>();
    const expected = createReplaySession(seed, difficulty, replay);
    const describe = () => ({ phase: expected.run.phase, heading: headingFor(expected.run),
      transition: !!expected.run.transition, grounded: expected.run.player.grounded,
      jumping: !expected.run.player.grounded && expected.run.player.jumps > 0, coins: expected.run.coins });
    const samples = [describe()];
    while (expected.run.status === 'running') {
      advanceReplay(expected); samples.push(describe());
      if (boundaries.has(expected.run._tick)) snapshots.set(expected.run._tick, structuredClone(expected.run));
    }
    for (const candidate of catalogue.candidates) {
      assert.ok(candidate.endTick - candidate.startTick <= 720);
      const samplesInWindow = samples.slice(candidate.startTick, candidate.endTick + 1);
      assert.ok(samplesInWindow.every(sample => !sample.transition));
      const phase = candidate.kind === 'up' || candidate.kind === 'down' ? candidate.kind : 'side';
      assert.ok(samplesInWindow.every(sample => sample.phase === phase));
      if (phase === 'side') assert.ok(samplesInWindow.every(sample => sample.heading === (candidate.kind === 'left' ? -1 : 1)));
      if (candidate.kind === 'side') {
        assert.equal(candidate.endTick - candidate.startTick, 720);
        assert.ok(candidate.jumpingTicks <= candidate.stableTicks / 2);
      }
      if (candidate.kind === 'coins') assert.ok(candidate.coinsCollected > 0);
      if (candidate.kind === 'jump') {
        const takeoff = samplesInWindow.findIndex((sample, index) => index > 0 && sample.jumping && samplesInWindow[index - 1].grounded);
        assert.ok(takeoff > 0, 'Jump previews contain a real takeoff');
        assert.ok(samplesInWindow.slice(takeoff + 1).some(sample => sample.grounded), 'Jump previews contain its landing');
      }
    }
    for (const candidate of representatives) {
      const clip = createReplayPreviewFromCandidate(catalogue, candidate.key);
      assert.equal(clip.kind, candidate.kind);
      assert.equal(clip.candidateKey, candidate.key);
      assert.equal(clip.transitionTick, null);
      assert.equal(clip.start.replay, catalogue.replay, 'Selecting a candidate shares the validated envelope');
      assert.deepEqual(clip.start.run, snapshots.get(clip.startTick));
      const preview = resetReplayPreview(clip);
      while (preview.run._tick < clip.endTick) advanceReplay(preview);
      assert.deepEqual(preview.run, snapshots.get(clip.endTick));
      assert.deepEqual(resetReplayPreview(clip), clip.start);
    }
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
  const catalogue = analyzeReplayPreview({ seed: shortSeed, difficulty: 'degen' }, replay);
  assert.deepEqual(catalogue.candidates.map(candidate => candidate.kind), ['side'], 'Do not invent jumps or unvisited directions');
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

test('default choices vary deterministically, explicit candidates work, and nonexistent directions are not invented', () => {
  const selected = new Set<string>();
  for (let number = 41; number <= 48; number++) {
    const seed = `0x${number.toString(16).padStart(64, '0')}`, difficulty = 'degen' as const;
    const replay = exportAgentReplay(runSessionToEnd(createAgentSession(seed, difficulty)));
    const catalogue = analyzeReplayPreview({ seed, difficulty }, replay);
    const clip = createReplayPreview({ seed, difficulty }, replay);
    selected.add(clip.kind);
    assert.equal(createReplayPreview({ seed, difficulty }, replay).candidateKey, clip.candidateKey);
    assert.equal(createReplayPreview({ seed, difficulty }, replay, clip.candidateKey).candidateKey, clip.candidateKey);
    if (number === 42) {
      assert.equal(catalogue.candidates.some(candidate => candidate.kind === 'left'), false);
      assert.throws(() => createReplayPreview({ seed, difficulty }, replay, 'left'), /no preview/);
    }
    assert.throws(() => createReplayPreviewFromCandidate(catalogue, 'side:999999:1000719'), /does not belong/);
    assert.throws(() => createReplayPreviewFromCandidate(structuredClone(catalogue), clip.candidateKey), /Analyze/);
  }
  assert.ok(selected.size >= 4);
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
