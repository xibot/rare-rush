import { keccak256, toHex, type Hex } from 'viem';
import { createRun, jump, setSliding, setPace, stepRun, FIXED_STEP } from '../../../games/rare-rush/engine.ts';
import { DIFFICULTY_ORDER, difficultySettings } from '../../../games/rare-rush/difficulty.ts';
import { PROTOCOL_VERSION } from './protocol.ts';

/** Apply before advancing tick. A frame supplies held slide/pace plus a jump press. */
export type InputFrame = { tick: number; jump: boolean; slide: boolean; pace: -1 | 0 | 1 };
export type Replay = { version: typeof PROTOCOL_VERSION; frames: InputFrame[] };
export const MAX_REPLAY_BYTES = 1_500_000;

export function parseReplay(input: unknown, maxTicks: number): Replay {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a replay object.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'frames,version' || value.version !== PROTOCOL_VERSION || !Array.isArray(value.frames)) {
    throw new Error('Unsupported replay schema. Scores, seeds, and state overrides are not accepted.');
  }
  if (value.frames.length > maxTicks) throw new Error('Too many input frames.');
  let previous = -1;
  const frames = value.frames.map((input): InputFrame => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid input frame.');
    const frame = input as Record<string, unknown>;
    if (Object.keys(frame).sort().join(',') !== 'jump,pace,slide,tick' ||
      !Number.isSafeInteger(frame.tick) || (frame.tick as number) <= previous || (frame.tick as number) >= maxTicks ||
      typeof frame.jump !== 'boolean' || typeof frame.slide !== 'boolean' || ![-1, 0, 1].includes(frame.pace as number)) {
      throw new Error('Frames must be strictly ordered legal controls within the run.');
    }
    previous = frame.tick as number;
    return { tick: previous, jump: frame.jump, slide: frame.slide, pace: frame.pace as -1 | 0 | 1 };
  });
  return { version: PROTOCOL_VERSION, frames };
}

/** Recompute all pickups from the contract seed and pinned game engine, never client totals. */
export function verifyReplay(seed: Hex, difficultyId: number, input: unknown) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(seed)) throw new Error('Invalid contract seed.');
  const difficulty = DIFFICULTY_ORDER[difficultyId];
  if (!difficulty) throw new Error('Invalid contract difficulty.');
  const maxTicks = difficultySettings(difficulty).seconds * 120;
  const replay = parseReplay(input, maxTicks);
  const run = createRun(seed.toLowerCase(), difficulty);
  const kinds: number[] = [];
  let next = 0;
  for (let tick = 0; tick < maxTicks && run.status === 'running'; tick++) {
    const frame = replay.frames[next];
    if (frame?.tick === tick) {
      setSliding(run, frame.slide);
      setPace(run, frame.pace);
      if (frame.jump) jump(run);
      next++;
    }
    for (const event of stepRun(run, FIXED_STEP)) {
      if (event.type === 'coin') kinds.push(event.rewardMultiplier === 10 ? 1 : 0);
    }
  }
  if (next !== replay.frames.length) throw new Error('Replay has inputs after the run ended.');
  if (run.status !== 'finished' || run.finishReason !== 'time' || run.hearts < 1) {
    throw new Error('Run did not survive the timer. No claim can be issued.');
  }
  if (kinds.length > 512) throw new Error('Pickup limit exceeded.');
  return {
    pickupKinds: toHex(new Uint8Array(kinds)),
    replayHash: keccak256(toHex(JSON.stringify(replay))),
    coins: run.coins, bonusCoins: run.bonusCoins, hearts: run.hearts,
    score: run.score, distance: Math.floor(run.distance), ticks: run._tick,
  };
}
