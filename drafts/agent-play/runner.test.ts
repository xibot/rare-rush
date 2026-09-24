import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_REPLAY_VERSION, MAX_REPLAY_BYTES, PROTOCOL_VERSION, FIXED_STEP,
  createAgentSession, advanceAgent, createReplaySession, advanceReplay,
  resumeAgentSession, snapshotSession, runSessionToEnd, getSessionMetrics,
  exportAgentReplay, checkAgentReplay, presentationControl,
  type AgentReplay, type Difficulty, type InputFrame,
} from './runner.ts';
import { recordPilot } from '../../infra/testnet/test/pilot.ts';
import { verifyReplay } from '../../infra/testnet/src/replay.ts';
import { createRun, setSliding, setPace, jump, stepRun } from '../../games/rare-rush/twist/engine.ts';
import { headingPlan } from '../../games/rare-rush/twist/presentation.ts';

const seed = `0x${'1a'.repeat(32)}` as const;
const modes = ['easy', 'normal', 'degen'] as const;

/** A deliberately poor legal controller exercises local losing recordings. */
function losingReplay(difficulty: Difficulty = 'normal', opening: Partial<InputFrame>[] = []): AgentReplay {
  const run = createRun(seed, difficulty);
  const frames: InputFrame[] = [];
  while (run.status === 'running') {
    const frame: InputFrame = { tick: run._tick, jump: false, slide: false, pace: 0, ...opening[run._tick] };
    frames.push(frame);
    setSliding(run, frame.slide);
    setPace(run, frame.pace);
    if (frame.jump) jump(run);
    stepRun(run, FIXED_STEP);
  }
  assert.equal(run.finishReason, 'hearts');
  return { version: AGENT_REPLAY_VERSION, finalTick: run._tick, inputs: { version: PROTOCOL_VERSION, frames } };
}

for (const [difficultyId, difficulty] of modes.entries()) {
  test(`${difficulty}: autopilot matches existing pilot and verified V2 metrics`, () => {
    const session = runSessionToEnd(createAgentSession(seed, difficulty));
    const replay = exportAgentReplay(session);
    const pilot = recordPilot(seed, difficultyId);
    assert.deepEqual(replay.inputs, pilot, 'Every control and its ordering must match the existing pilot');
    const metrics = checkAgentReplay(seed, difficulty, replay);
    const verified = verifyReplay(seed, difficultyId, replay.inputs);
    assert.equal(metrics.outcome, 'survived');
    assert.equal(metrics.ticks, [14400, 10800, 7200][difficultyId]);
    for (const field of ['score', 'coins', 'bonusCoins', 'hearts', 'distance', 'ticks', 'pickupKinds'] as const) {
      assert.equal(metrics[field], verified[field], field);
    }
    assert.deepEqual(metrics, getSessionMetrics(session));
    assert.deepEqual([...metrics.phasesVisited].sort(), ['down', 'side', 'up']);
    assert.ok(metrics.coins > 0);
    assert.ok(metrics.bonusCoins > 0);
    assert.ok(JSON.stringify(replay).length < MAX_REPLAY_BYTES);

    const playback = runSessionToEnd(createReplaySession(seed, difficulty, JSON.stringify(replay)));
    assert.deepEqual(playback.run, session.run, 'Playback must reproduce the full final physics state');
    assert.deepEqual(getSessionMetrics(playback), metrics);
    assert.deepEqual(exportAgentReplay(playback), replay);
    assert.deepEqual(advanceAgent(session), []);
    assert.deepEqual(advanceReplay(playback), []);
  });
}

test('lost runs are locally replayable and cannot be mistaken for successful claim receipts', () => {
  for (const [id, mode] of modes.entries()) {
    const replay = losingReplay(mode);
    const result = checkAgentReplay(seed, mode, replay);
    assert.equal(result.outcome, 'lost');
    assert.equal(result.finishReason, 'hearts');
    assert.equal(result.hearts, 0);
    assert.ok(result.ticks < [14400, 10800, 7200][id]);
    assert.throws(() => verifyReplay(seed, id, replay.inputs), /did not survive/);
  }
});

test('restoring a dense saved prefix reproduces the same state and continuation', () => {
  const agent = createAgentSession(seed.toUpperCase().replace('0X', '0x'), 'normal');
  for (let i = 0; i < 5001; i++) advanceAgent(agent);
  const prefix = { version: PROTOCOL_VERSION, frames: agent.frames };
  const resumed = resumeAgentSession(seed, 'normal', prefix, agent.run._tick);
  assert.equal(resumed.seed, seed);
  assert.deepEqual(resumed.run, agent.run);
  assert.deepEqual(resumed.pickupKinds, agent.pickupKinds);
  assert.deepEqual(resumed.phasesVisited, agent.phasesVisited);
  assert.deepEqual(exportAgentReplay(runSessionToEnd(resumed)), exportAgentReplay(runSessionToEnd(agent)));
  assert.deepEqual(resumeAgentSession(seed, 'normal', { version: PROTOCOL_VERSION, frames: [] }, 0).run,
    createAgentSession(seed, 'normal').run);
  assert.throws(() => resumeAgentSession(seed, 'normal', prefix, 5000), /Incomplete/);
  assert.throws(() => resumeAgentSession(seed, 'normal', prefix, Number.NaN), /tick count/);
});

test('replay, prefix and snapshots detach data from callers', () => {
  const session = createAgentSession(seed, 'degen');
  advanceAgent(session);
  const snapshot = snapshotSession(session);
  snapshot.player.x = 99999;
  snapshot.phasePlan[0].end = 0;
  assert.notEqual(session.run.player.x, snapshot.player.x);
  assert.notEqual(session.run.phasePlan[0].end, 0);
  const restored = resumeAgentSession(seed, 'degen', { version: PROTOCOL_VERSION, frames: session.frames }, 1);
  restored.frames[0].pace = 1;
  assert.equal(session.frames[0].pace, 0);
  const replay = exportAgentReplay(runSessionToEnd(session));
  const playback = createReplaySession(seed, 'degen', replay);
  replay.inputs.frames[0].pace = -1;
  assert.equal(playback.replay?.inputs.frames[0].pace, 0);
  assert.equal(session.frames[0].pace, 0);
});

test('slide fast-fall is applied before a simultaneous jump, one fixed tick at a time', () => {
  const replay = losingReplay('normal', [{ slide: true, jump: true }, { slide: true, jump: true }]);
  const playback = createReplaySession(seed, 'normal', replay);
  advanceReplay(playback);
  assert.equal(playback.run._tick, 1);
  assert.equal(playback.run.player.slide, false);
  assert.equal(playback.run.player.jumps, 1);
  assert.ok(playback.run.player.vy < 0);
  const firstJumpY = playback.run.player.y;
  advanceReplay(playback);
  assert.equal(playback.run._tick, 2);
  assert.equal(playback.run.player.slide, false);
  assert.equal(playback.run.player.jumps, 2);
  assert.ok(playback.run.player.y < firstJumpY);
  assert.ok(playback.run.player.vy < 0);
  assert.equal(checkAgentReplay(seed, 'normal', replay).outcome, 'lost');
});

test('reverse exits use cosmetic presentation and preserve canonical replay controls', () => {
  const reverseSeed = `0x${'0'.repeat(63)}2`;
  const session = createAgentSession(reverseSeed, 'normal');
  assert.ok(headingPlan(session.run).includes(-1));
  let sawReverse = false;
  while (session.run.status === 'running') {
    advanceAgent(session);
    const shown = presentationControl(session);
    if (session.run.phase === 'side' && shown.heading === -1) sawReverse = true;
    assert.equal(shown.axis, session.run.phase === 'side'
      ? (session.lastControl?.pace ?? 0) * shown.heading : session.lastControl?.pace);
  }
  assert.ok(sawReverse);
  assert.deepEqual(checkAgentReplay(reverseSeed, 'normal', exportAgentReplay(session)), getSessionMetrics(session));
});

test('strict import rejects injected totals, malformed controls, oversized and noncontiguous inputs', () => {
  const replay = losingReplay();
  const badValues: unknown[] = [
    null, [], {}, { ...replay, coins: 999999 }, { ...replay, seed },
    { ...replay, version: 'unknown' }, { ...replay, finalTick: 0 },
    { ...replay, finalTick: Infinity }, { ...replay, finalTick: 10801 },
    { ...replay, inputs: { ...replay.inputs, score: 999999 } },
    { ...replay, inputs: { ...replay.inputs, version: 'rare-rush-input-v1' } },
    '{broken', ' '.repeat(MAX_REPLAY_BYTES + 1),
    { ...replay, inputs: { ...replay.inputs, frames: Array(10801).fill(replay.inputs.frames[0]) } },
  ];
  for (const value of badValues) assert.throws(() => checkAgentReplay(seed, 'normal', value));
  for (const changed of [
    { tick: -1 }, { tick: 0.5 }, { tick: 10800 }, { tick: 1 },
    { jump: 1 }, { slide: 'true' }, { pace: 2 }, { hearts: 3 },
  ]) {
    const inputs = { ...replay.inputs, frames: [{ ...replay.inputs.frames[0], ...changed }, ...replay.inputs.frames.slice(1)] };
    assert.throws(() => checkAgentReplay(seed, 'normal', { ...replay, inputs }));
  }
  const hole = structuredClone(replay);
  hole.inputs.frames.splice(100, 1);
  hole.finalTick--;
  assert.throws(() => checkAgentReplay(seed, 'normal', hole), /Incomplete/);
});

test('terminal tick is checked against actual simulation, including truncated and trailing recordings', () => {
  const replay = losingReplay();
  const incomplete = structuredClone(replay);
  incomplete.inputs.frames.pop();
  assert.throws(() => checkAgentReplay(seed, 'normal', incomplete), /Incomplete/);
  incomplete.finalTick--;
  assert.throws(() => checkAgentReplay(seed, 'normal', incomplete), /Incomplete.*final tick/);
  const trailing = structuredClone(replay);
  trailing.inputs.frames.push({ tick: trailing.finalTick++, jump: false, slide: false, pace: 0 });
  assert.throws(() => checkAgentReplay(seed, 'normal', trailing), /after the run ended/);
  assert.throws(() => resumeAgentSession(seed, 'normal', trailing.inputs, trailing.finalTick), /after the run ended/);
  const active = createAgentSession(seed, 'normal');
  assert.throws(() => exportAgentReplay(active), /completed/);
  assert.throws(() => getSessionMetrics(active), /not complete/);
});

test('invalid seed, difficulty and mixed session APIs are rejected', () => {
  for (const invalid of ['', ' ', 'x'.repeat(257), null, 8]) {
    assert.throws(() => createAgentSession(invalid as string, 'normal'), /Seed/);
  }
  assert.throws(() => createAgentSession(seed, 'invalid' as Difficulty), /Unknown difficulty/);
  const agent = createAgentSession(seed, 'normal');
  assert.throws(() => advanceReplay(agent), /playback session/);
  const playback = createReplaySession(seed, 'normal', losingReplay());
  assert.throws(() => advanceAgent(playback), /advanceReplay/);
});
