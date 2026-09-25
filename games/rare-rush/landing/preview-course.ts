import {
  createRun, demoControls, FIXED_STEP, jump, setPace, setSliding, stepRun,
  type RunState,
} from '../twist/engine.ts';

export const PREVIEW_SECONDS = 32;

// Separate from the engine's accumulator so the pilot chooses a legal input on
// every physics tick, regardless of the display's refresh rate.
const pendingTime = new WeakMap<RunState, number>();

/**
 * Edited showcase timing for the watch-only landing preview. Playable runs keep
 * their own seeded routes and normal timer. Most of this preview is classic
 * running; the occasional backwards exit stays a surprise in the game.
 */
export function createPreviewRun(seed: string): RunState {
  const run = createRun(seed, 'normal');
  run.phasePlan = [
    { phase: 'side', start: 0, end: 10 },
    { phase: 'up', start: 10, end: 16 },
    { phase: 'side', start: 16, end: 20 },
    { phase: 'down', start: 20, end: 26 },
    { phase: 'side', start: 26, end: run.duration },
  ];
  pendingTime.set(run, 0);
  return run;
}

/** Advance normal physics using only the existing legal-input demo pilot. */
export function advancePreviewRun(run: RunState, deltaSeconds: number): void {
  if (run.status !== 'running' || run.elapsed >= PREVIEW_SECONDS ||
      !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
  let pending = (pendingTime.get(run) ?? 0) + Math.min(deltaSeconds, 0.25);
  while (pending + 1e-10 >= FIXED_STEP && run.status === 'running' && run.elapsed < PREVIEW_SECONDS) {
    const controls = demoControls(run);
    setPace(run, controls.axis);
    setSliding(run, controls.slide);
    if (controls.jump) jump(run);
    stepRun(run, FIXED_STEP);
    pending = Math.max(0, pending - FIXED_STEP);
  }
  pendingTime.set(run, pending);
}
