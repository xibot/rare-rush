import { createRun, jump, setSliding, setPace, stepRun, FIXED_STEP } from '../../../games/rare-rush/engine.ts';
import { DIFFICULTY_ORDER } from '../../../games/rare-rush/difficulty.ts';
import { PROTOCOL_VERSION } from '../src/protocol.ts';
import type { Replay } from '../src/replay.ts';

/** Test fixture: ordinary legal controls. This intentionally demonstrates that bots are possible. */
export function recordPilot(seed: string, difficultyId = 1): Replay {
  const run = createRun(seed.toLowerCase(), DIFFICULTY_ORDER[difficultyId]);
  const replay: Replay = { version: PROTOCOL_VERSION, frames: [] };
  while (run.status === 'running') {
    const next = run.entities.filter(entity => ['crystal', 'block', 'drone'].includes(entity.kind) && !entity.hit && entity.x + entity.w > run.player.x)
      .sort((first, second) => first.x - second.x)[0];
    const until = next ? (next.x - run.player.x - run.player.w) / run.speed : Infinity;
    const slide = Boolean(next?.kind === 'drone' && until < 0.6);
    const press = Boolean(next && next.kind !== 'drone' && (
      until < 0.24 && run.player.grounded || until < 0.3 && run.player.jumps === 1 && run.player.vy >= -80
    ));
    // Record every tick to preserve the exact ordering of slide fast-fall and jump.
    replay.frames.push({ tick: run._tick, jump: press, slide, pace: 0 });
    setSliding(run, slide);
    setPace(run, 0);
    if (press) jump(run);
    stepRun(run, FIXED_STEP);
  }
  return replay;
}
