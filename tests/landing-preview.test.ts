import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePreviewRun, createPreviewRun, PREVIEW_SECONDS } from '../games/rare-rush/landing/preview-course.ts';
import { createRun, FIXED_STEP } from '../games/rare-rush/twist/engine.ts';

test('landing showcases both vertical turns and returns sideways using legal inputs at different refresh rates', () => {
  for (let seed = 0; seed < 40; seed++) {
    let expected: ReturnType<typeof createPreviewRun> | undefined;
    for (const fps of [30, 60, 144]) {
      const run = createPreviewRun(`landing-preview-${seed}`);
      const directions = new Set([run.phase]);
      for (let frame = 0; frame < PREVIEW_SECONDS * fps; frame++) {
        advancePreviewRun(run, 1 / fps);
        directions.add(run.phase);
      }
      assert.equal(run.elapsed, PREVIEW_SECONDS, `${seed} at ${fps}fps reaches the loop boundary`);
      assert.equal(run.status, 'running', `${seed} at ${fps}fps survives the showcase`);
      assert.equal(run.phase, 'side');
      assert.deepEqual([...directions], ['side', 'up', 'down']);
      assert.ok(run.coins > 0, 'normal collision pickups produce the displayed coins');
      assert.ok(run.hearts > 0 && run.hearts <= 3);
      if (expected) assert.deepEqual(run, expected, `pilot and physics agree at ${fps}fps`);
      expected = run;
    }
  }
});

test('preview timing is isolated from playable routes and keeps normal run rules', () => {
  const seed = 'landing-route-isolation';
  const original = createRun(seed, 'normal');
  const preview = createPreviewRun(seed);
  const { phasePlan: _previewRoute, ...previewRules } = preview;
  const { phasePlan: _normalRoute, ...normalRules } = original;
  assert.deepEqual(previewRules, normalRules, 'only the presentation route schedule changes');
  assert.deepEqual(createRun(seed, 'normal'), original, 'creating a preview cannot alter the playable route');
  advancePreviewRun(preview, Infinity);
  advancePreviewRun(preview, NaN);
  advancePreviewRun(preview, -1);
  assert.equal(preview.elapsed, 0);
  advancePreviewRun(preview, 20);
  assert.equal(preview.elapsed, 0.25, 'a delayed frame cannot teleport the preview');
  while (preview.elapsed < PREVIEW_SECONDS && preview.status === 'running') advancePreviewRun(preview, FIXED_STEP);
  const end = structuredClone(preview);
  advancePreviewRun(preview, 1);
  assert.deepEqual(preview, end, 'the host owns restarting at the preview loop boundary');
});
