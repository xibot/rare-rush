import type { Hex } from 'viem';
import { createRun, FIXED_STEP, jump, setPace, setSliding, stepRun, type Pace, type RunEvent, type RunState } from '../../generated/games/rare-rush/engine.ts';
import { difficultySettings, type Difficulty } from '../../generated/games/rare-rush/difficulty.ts';

export type DifficultyId = Difficulty;
export const REPLAY_VERSION = 'rare-rush-input-v1' as const;
export type InputFrame = { tick: number; jump: boolean; slide: boolean; pace: Pace };
export type Replay = { version: typeof REPLAY_VERSION; frames: InputFrame[] };
export type RunSnapshot = Readonly<RunState> & { readonly completedTicks: number };
export type QueuedControls = { jump?: boolean; slide?: boolean; pace?: Pace };
export type Recording = {
  readonly run: RunState;
  readonly replay: Replay;
  held: { slide: boolean; pace: Pace };
  pendingJumps: number;
  inputChanged: boolean;
};

function validateReplay(input: unknown, completedTicks: number, maxTicks: number): Replay {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid saved replay.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'frames,version' || value.version !== REPLAY_VERSION || !Array.isArray(value.frames) || value.frames.length > maxTicks) {
    throw new Error('Unsupported saved replay.');
  }
  let previous = -1;
  const frames = value.frames.map(input => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid saved input.');
    const frame = input as Record<string, unknown>;
    if (Object.keys(frame).sort().join(',') !== 'jump,pace,slide,tick' ||
      !Number.isSafeInteger(frame.tick) || (frame.tick as number) < 0 || (frame.tick as number) <= previous ||
      (frame.tick as number) >= completedTicks || typeof frame.jump !== 'boolean' || typeof frame.slide !== 'boolean' ||
      ![-1, 0, 1].includes(frame.pace as number)) throw new Error('Saved inputs do not match the completed ticks.');
    previous = frame.tick as number;
    return { tick: previous, jump: frame.jump, slide: frame.slide, pace: frame.pace as Pace };
  });
  return { version: REPLAY_VERSION, frames };
}

function applyFrame(run: RunState, frame: InputFrame) {
  // This ordering is part of rare-rush-input-v1 and must match the verifier.
  setSliding(run, frame.slide);
  setPace(run, frame.pace);
  if (frame.jump) jump(run);
}

/** Rebuild only from the chain seed plus legal inputs; persisted scores/state are never used. */
export function createRecorder(seed: Hex, difficulty: DifficultyId, initialReplay?: Replay, completedTicks = 0): Recording {
  if (!/^0x[0-9a-fA-F]{64}$/.test(seed)) throw new Error('A confirmed contract seed is required.');
  const maxTicks = difficultySettings(difficulty).seconds * 120;
  if (!Number.isSafeInteger(completedTicks) || completedTicks < 0 || completedTicks > maxTicks) throw new Error('Invalid completed tick count.');
  if (!initialReplay && completedTicks !== 0) throw new Error('A saved replay is required to resume.');
  const replay = validateReplay(initialReplay ?? { version: REPLAY_VERSION, frames: [] }, completedTicks, maxTicks);
  const run = createRun(seed.toLowerCase(), difficulty);
  let next = 0;
  for (let tick = 0; tick < completedTicks; tick++) {
    if (run.status !== 'running') throw new Error('Saved inputs continue after this run ended.');
    const frame = replay.frames[next];
    if (frame?.tick === tick) { applyFrame(run, frame); next++; }
    stepRun(run, FIXED_STEP);
  }
  if (next !== replay.frames.length) throw new Error('Saved inputs continue after this run ended.');
  const last = replay.frames.at(-1);
  return { run, replay, held: { slide: last?.slide ?? false, pace: last?.pace ?? 0 }, pendingJumps: 0, inputChanged: false };
}

/** Browser input only changes a queue. The simulation is advanced exclusively by advanceRecorder. */
export function queueControls(recording: Recording, input: QueuedControls) {
  if (recording.run.status !== 'running') return;
  if (input.pace !== undefined && ![-1, 0, 1].includes(input.pace)) throw new Error('Invalid pace.');
  if (input.slide !== undefined && typeof input.slide !== 'boolean') throw new Error('Invalid slide input.');
  if (input.jump !== undefined && typeof input.jump !== 'boolean') throw new Error('Invalid jump input.');
  if (input.slide !== undefined && input.slide !== recording.held.slide) { recording.held.slide = input.slide; recording.inputChanged = true; }
  if (input.pace !== undefined && input.pace !== recording.held.pace) { recording.held.pace = input.pace; recording.inputChanged = true; }
  if (input.jump) { recording.pendingJumps = Math.min(2, recording.pendingJumps + 1); recording.inputChanged = true; }
}

export function releaseControls(recording: Recording) {
  queueControls(recording, { slide: false, pace: 0 });
  recording.pendingJumps = 0;
}

/** One call = one 120 Hz tick, including one ordered control frame, exactly like server replay. */
export function advanceRecorder(recording: Recording): { events: RunEvent[]; inputChanged: boolean } {
  if (recording.run.status !== 'running') return { events: [], inputChanged: false };
  const frame: InputFrame = { tick: recording.run._tick, jump: recording.pendingJumps > 0, ...recording.held };
  if (recording.pendingJumps) recording.pendingJumps--;
  const changed = recording.inputChanged || frame.jump;
  recording.inputChanged = false;
  recording.replay.frames.push(frame);
  applyFrame(recording.run, frame);
  return { events: stepRun(recording.run, FIXED_STEP), inputChanged: changed };
}

export function exportReplay(recording: Recording): Replay {
  return { version: REPLAY_VERSION, frames: recording.replay.frames.map(frame => ({ ...frame })) };
}

export function snapshotRun(recording: Recording): RunSnapshot {
  return Object.freeze({ ...structuredClone(recording.run), completedTicks: recording.run._tick });
}
