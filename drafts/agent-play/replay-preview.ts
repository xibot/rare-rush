import type { RunRecord } from './feed-types.ts';
import { advanceReplay, createReplaySession, FIXED_STEP, getSessionMetrics,
  type RunMetrics, type RunSession } from './runner.ts';

export const REPLAY_PREVIEW_SECONDS = 6;
export const REPLAY_PREVIEW_LEAD_SECONDS = 1;

export type ReplayPreviewClip = {
  /** Deeply frozen baseline. Clone it with resetReplayPreview before advancing. */
  readonly start: RunSession;
  readonly startTick: number;
  /** Stop when the playback session reaches this tick, or finishes. */
  readonly endTick: number;
  readonly transitionTick: number | null;
  /** Derived from the complete recording, never from the supplied record totals. */
  readonly metrics: RunMetrics;
};

function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeTree(child);
  }
  return value;
}

/** Validate the whole recorded run once, then seek a short, faithful excerpt.
 * This performs at most two bounded passes of existing replay controls. It has
 * no rendering, clock, fetch, wallet, or score-submission side effects.
 */
export function createReplayPreview(record: Pick<RunRecord, 'seed' | 'difficulty'>, replay: unknown): ReplayPreviewClip {
  const verified = createReplaySession(record.seed, record.difficulty, replay);
  let transitionTick: number | null = null;
  let remaining = verified.maxTicks;
  while (verified.run.status === 'running' && remaining-- > 0) {
    advanceReplay(verified);
    if (transitionTick === null && verified.run.transition) transitionTick = verified.run._tick;
  }
  // Completion and exact final-tick checks must succeed even beyond the excerpt.
  const metrics = getSessionMetrics(verified);
  const startTick = Math.max(0, (transitionTick ?? 0) - Math.round(REPLAY_PREVIEW_LEAD_SECONDS / FIXED_STEP));
  const endTick = Math.min(metrics.ticks, startTick + Math.round(REPLAY_PREVIEW_SECONDS / FIXED_STEP));
  const start = createReplaySession(record.seed, record.difficulty, verified.replay);
  while (start.run._tick < startTick) advanceReplay(start);
  return freezeTree({ start, startTick, endTick, transitionTick, metrics });
}

/** Restart only the excerpt; no revalidation, new controls, or random run.
 * The frozen replay envelope and frozen prefix frame/event objects are shared.
 * advanceReplay only reads those inputs, appends newly copied controls to its
 * writable frames array, and replaces events. Physics state and writable arrays
 * remain independent, avoiding a full recording copy on every thumbnail loop.
 * DirectionScene remembers transition artwork in a ref: its React host should
 * also change that scene's key on a loop so the old arrival art is discarded.
 */
export function resetReplayPreview(clip: ReplayPreviewClip): RunSession {
  const { start } = clip;
  return {
    ...start,
    run: structuredClone(start.run),
    frames: start.frames.slice(),
    events: start.events.slice(),
    pickupKinds: start.pickupKinds.slice(),
    phasesVisited: start.phasesVisited.slice(),
    lastControl: start.lastControl ? { ...start.lastControl } : null,
  };
}
