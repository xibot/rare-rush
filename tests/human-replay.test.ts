import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceHumanRecording, createHumanRecording, exportHumanReplay, queueHumanJump, releaseHumanControls } from '../games/rare-rush/replay-recorder.ts';
import { demoControls } from '../games/rare-rush/twist/engine.ts';
import { canonicalAxis, headingFor } from '../games/rare-rush/twist/presentation.ts';
import { advanceReplay, checkAgentReplay, createReplaySession } from '../drafts/agent-play/runner.ts';

const seed = `0x${'1'.padStart(64,'0')}`;
for (const mode of ['easy', 'normal', 'degen'] as const) {
  test(`${mode}: recorded human controls reproduce every engine state and terminal metrics`, () => {
    const recording = createHumanRecording(seed, mode);
    const states: string[] = [];
    const headings = new Set<number>();
    while (recording.run.status === 'running') {
      const { axis, jump, slide } = demoControls(recording.run);
      headings.add(headingFor(recording.run));
      if (jump) queueHumanJump(recording);
      recording.slide = slide;
      const screenAxis = canonicalAxis(axis, recording.run.phase, headingFor(recording.run));
      advanceHumanRecording(recording, screenAxis);
      states.push(JSON.stringify(recording.run));
    }
    const replay = exportHumanReplay(recording);
    const playback = createReplaySession(seed, mode, replay);
    let tick = 0;
    while (playback.run.status === 'running') {
      advanceReplay(playback);
      assert.equal(JSON.stringify(playback.run), states[tick++]);
    }
    assert.equal(tick, replay.finalTick);
    const metrics = checkAgentReplay(seed, mode, replay);
    assert.equal(metrics.score, recording.run.score);
    assert.equal(metrics.coins, recording.run.coins);
    assert.equal(metrics.hearts, recording.run.hearts);
    assert.equal(metrics.outcome, 'survived');
    if (mode === 'degen') assert(headings.has(-1), 'screen arrows remap on an actual reverse-heading track');
  });
}

test('input queues do not mutate physics between ticks; double jump and release are captured legally', () => {
  const recording = createHumanRecording(seed, 'normal');
  const before = structuredClone(recording.run);
  queueHumanJump(recording); queueHumanJump(recording); queueHumanJump(recording);
  recording.slide = true;
  assert.deepEqual(recording.run, before);
  advanceHumanRecording(recording, 1);
  advanceHumanRecording(recording, 0);
  assert.deepEqual(recording.frames.map(f => f.jump), [true, true]);
  queueHumanJump(recording); releaseHumanControls(recording);
  const paused = structuredClone(recording.run);
  assert.deepEqual(recording.run, paused);
  advanceHumanRecording(recording, 0);
  assert.deepEqual(recording.frames[2], { tick: 2, jump: false, slide: false, pace: 0 });
  assert.throws(() => exportHumanReplay(recording), /Finish/);
});

test('a short loss saves exactly its final tick and defensive replay copies', () => {
  const recording = createHumanRecording(seed, 'degen');
  while (recording.run.status === 'running') advanceHumanRecording(recording, 0);
  const replay = exportHumanReplay(recording), frames = recording.frames.length;
  assert.equal(checkAgentReplay(seed, 'degen', replay).outcome, 'lost');
  advanceHumanRecording(recording, 1); queueHumanJump(recording);
  assert.equal(recording.frames.length, frames);
  replay.inputs.frames[0].pace = 1;
  assert.equal(recording.frames[0].pace, 0);
  const incomplete = exportHumanReplay(recording); incomplete.finalTick--; incomplete.inputs.frames.pop();
  assert.throws(() => checkAgentReplay(seed, 'degen', incomplete), /ended|terminal|finish/i);
});
