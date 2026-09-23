import { createRun, demoControls, jump, setSliding, setPace, stepRun, FIXED_STEP } from '../../../games/rare-rush/twist/engine.ts';
import { DIFFICULTY_ORDER } from '../../../games/rare-rush/difficulty.ts';
import { PROTOCOL_VERSION } from '../src/protocol.ts';
import type { Replay } from '../src/replay.ts';

/** Test fixture: ordinary legal controls. This intentionally demonstrates that bots are possible. */
export function recordPilot(seed: string, difficultyId = 1): Replay {
  const run = createRun(seed.toLowerCase(), DIFFICULTY_ORDER[difficultyId]);
  const replay: Replay = { version: PROTOCOL_VERSION, frames: [] };
  while (run.status === 'running') {
    const { axis: pace, jump: press, slide } = demoControls(run);
    // Record every tick to preserve the exact ordering of slide fast-fall and jump.
    replay.frames.push({ tick: run._tick, jump: press, slide, pace });
    setSliding(run, slide);
    setPace(run, pace);
    if (press) jump(run);
    stepRun(run, FIXED_STEP);
  }
  return replay;
}
