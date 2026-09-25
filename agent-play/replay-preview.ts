import type { RunRecord } from './feed-types.ts';
import { headingFor } from '../games/rare-rush/twist/presentation.ts';
import { advanceReplay, createAgentSession, createReplaySession, FIXED_STEP, getSessionMetrics,
  type AgentReplay, type Difficulty, type RunMetrics, type RunSession } from './runner.ts';

export const REPLAY_PREVIEW_SECONDS = 6;
export const REPLAY_PREVIEW_LEAD_SECONDS = 1;
const CLIP_TICKS = Math.round(REPLAY_PREVIEW_SECONDS / FIXED_STEP);
const KINDS = ['side', 'jump', 'coins', 'up', 'left', 'down'] as const;
export type PreviewKind = typeof KINDS[number];
export type PreviewCandidate = {
  readonly key: string;
  readonly kind: PreviewKind;
  readonly startTick: number;
  readonly endTick: number;
  readonly stableTicks: number;
  readonly jumpingTicks: number;
  readonly coinsCollected: number;
  readonly quality: number;
};
export type ReplayPreviewCandidate = PreviewCandidate;
export type ReplayPreviewCatalogue = {
  readonly seed: string;
  readonly difficulty: Difficulty;
  readonly replay: AgentReplay;
  readonly metrics: RunMetrics;
  readonly candidates: readonly PreviewCandidate[];
  readonly transitionTicks: readonly number[];
  readonly selectionSeed: string;
};

export type ReplayPreviewClip = {
  /** Deeply frozen baseline. Clone it with resetReplayPreview before advancing. */
  readonly start: RunSession;
  readonly startTick: number;
  /** Stop when the playback session reaches this tick, or finishes. */
  readonly endTick: number;
  readonly transitionTick: number | null;
  readonly kind: PreviewKind;
  readonly candidateKey: string;
  /** Derived from the complete recording, never from the supplied record totals. */
  readonly metrics: RunMetrics;
};
type RecordIdentity = Pick<RunRecord, 'seed' | 'difficulty'> & Partial<Pick<RunRecord, 'id'>>;
type DirectionKind = 'side' | 'up' | 'left' | 'down';
type Segment = { kind: DirectionKind; start: number; end: number };
type Jump = { start: number; landed: number };
const catalogues = new WeakSet<ReplayPreviewCatalogue>();

function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeTree(child);
  }
  return value;
}

function hash(text: string): number {
  let result = 2166136261;
  for (const character of text) result = Math.imul(result ^ character.charCodeAt(0), 16777619) >>> 0;
  return result;
}

/** One bounded full validation pass, retaining only prefix counters and small
 * segment/jump descriptors while analyzing. No engine snapshots per tick are
 * stored. Candidates always belong to one actual stable direction; side, jump,
 * and coin highlights are rightward side gameplay, with no transition inside.
 */
export function analyzeReplayPreview(record: RecordIdentity, replay: unknown): ReplayPreviewCatalogue {
  const verified = createReplaySession(record.seed, record.difficulty, replay);
  const segments: Segment[] = [], jumps: Jump[] = [], transitionTicks: number[] = [];
  const coinPrefix = [0], jumpPrefix = [0];
  let segment: Segment | null = { kind: 'side', start: 0, end: 0 };
  let jumpStart: number | null = null, transitioning = false;
  let remaining = verified.maxTicks;
  while (verified.run.status === 'running' && remaining-- > 0) {
    const events = advanceReplay(verified), run = verified.run, tick = run._tick;
    if (run.transition && !transitioning) transitionTicks.push(tick);
    transitioning = !!run.transition;
    const kind: DirectionKind | null = run.transition ? null : run.phase === 'side'
      ? headingFor(run) === -1 ? 'left' : 'side' : run.phase;
    if (segment && segment.kind !== kind) { segments.push(segment); segment = null; }
    if (kind) {
      segment ??= { kind, start: tick, end: tick };
      segment.end = tick;
    }
    const jumping = kind === 'side' && !run.player.grounded && run.player.jumps > 0;
    coinPrefix.push(coinPrefix[tick - 1] + events.filter(event => event.type === 'coin').length);
    jumpPrefix.push(jumpPrefix[tick - 1] + Number(jumping));
    if (jumping && jumpStart === null) jumpStart = tick;
    if (!jumping && jumpStart !== null) {
      // Only a real landing completes a jump highlight; a turn or death does not.
      if (kind === 'side' && run.player.grounded && run.status === 'running') jumps.push({ start: jumpStart, landed: tick });
      jumpStart = null;
    }
  }
  if (segment) segments.push(segment);
  // This rejects truncated/trailing terminal data even beyond every candidate.
  const metrics = getSessionMetrics(verified);
  const pool = new Map<string, PreviewCandidate>();
  function add(kind: PreviewKind, startTick: number, endTick: number) {
    const duration = endTick - startTick;
    if (duration <= 0) return;
    const jumpingTicks = jumpPrefix[endTick] - jumpPrefix[startTick];
    const coinsCollected = coinPrefix[endTick] - coinPrefix[startTick];
    if (kind === 'coins' && coinsCollected === 0) return;
    if (kind === 'side' && jumpingTicks > duration / 2) return;
    const quality = Number(duration === CLIP_TICKS) * 1_000_000 + duration * 10
      + (kind === 'coins' ? coinsCollected * 100 : kind === 'jump' ? jumpingTicks * 3 + coinsCollected * 10
        : kind === 'side' ? (duration - jumpingTicks) * 2 : coinsCollected);
    const key = `${kind}:${startTick}:${endTick}`;
    pool.set(key, { key, kind, startTick, endTick, stableTicks: duration, jumpingTicks, coinsCollected, quality });
  }
  for (const section of segments) {
    let low = section.start, high = section.end;
    // Keep a little distance from the preceding suction and the upcoming turn
    // when a full six seconds still fits. Short phases retain their real length.
    if (high - low > CLIP_TICKS + (low === 0 ? 120 : 60)) low += low === 0 ? 120 : 60;
    if (high < metrics.ticks && high - low > CLIP_TICKS + 30) high -= 30;
    const latest = Math.max(low, high - CLIP_TICKS);
    const starts = new Set([low, latest, Math.round((low + latest) / 2)]);
    // Half-second scan finds real coin-dense windows without retaining states.
    for (let tick = low; tick <= latest; tick += 60) starts.add(tick);
    for (const tick of starts) {
      const end = Math.min(high, tick + CLIP_TICKS);
      add(section.kind, tick, end);
      if (section.kind === 'side') add('coins', tick, end);
    }
    if (section.kind === 'side') for (const jump of jumps) {
      if (jump.start <= low || jump.landed > high) continue;
      const start = Math.max(low, Math.min(latest, Math.round((jump.start + jump.landed - CLIP_TICKS) / 2)));
      const end = Math.min(high, start + CLIP_TICKS);
      if (start < jump.start && end >= jump.landed) add('jump', start, end);
    }
  }
  const candidates: PreviewCandidate[] = [];
  const selectedWindows = new Set<string>();
  const rankedByKind = new Map(KINDS.map(kind => [kind, [...pool.values()].filter(candidate => candidate.kind === kind)
    .sort((a, b) => b.quality - a.quality || a.startTick - b.startTick)]));
  // Reserve a highlight for each available kind before adding alternatives, so
  // four plain side windows cannot crowd out a short run's actual jump/coins.
  for (let alternative = 0; alternative < 4; alternative++) for (const kind of KINDS) {
    for (const candidate of rankedByKind.get(kind)!) {
      const window = `${candidate.startTick}:${candidate.endTick}`;
      if (!selectedWindows.has(window)
        && (!['side', 'jump', 'coins'].includes(kind) || candidates.every(other =>
          !['side', 'jump', 'coins'].includes(other.kind) || Math.abs(candidate.startTick - other.startTick) >= 120))
        && candidates.every(other => other.kind !== kind || Math.abs(candidate.startTick - other.startTick) >= 120)) {
        candidates.push(candidate); selectedWindows.add(window); break;
      }
    }
  }
  if (!candidates.length) throw new Error('This recording has no playable preview segment.');
  const catalogue = freezeTree({ seed: verified.seed, difficulty: verified.difficulty,
    replay: verified.replay!, metrics, candidates, transitionTicks,
    selectionSeed: `${record.id ?? ''}:${verified.seed}:${verified.difficulty}` });
  catalogues.add(catalogue);
  return catalogue;
}

/** Seek one selected window from a catalogue produced here. Its already checked
 * frozen input envelope is shared, so selecting a moment does not reparse or
 * duplicate all replay frames. Prefix state is derived only by advanceReplay.
 */
export function createReplayPreviewFromCandidate(catalogue: ReplayPreviewCatalogue, key: string): ReplayPreviewClip {
  if (!catalogues.has(catalogue)) throw new Error('Analyze the saved replay before selecting a preview.');
  const candidate = catalogue.candidates.find(item => item.key === key);
  if (!candidate) throw new Error('Preview candidate does not belong to this recording.');
  const { startTick, endTick, kind } = candidate;
  const start = createAgentSession(catalogue.seed, catalogue.difficulty);
  start.kind = 'replay'; start.replay = catalogue.replay;
  while (start.run._tick < startTick) advanceReplay(start);
  return freezeTree({ start, startTick, endTick, kind, candidateKey: key,
    transitionTick: catalogue.transitionTicks.find(tick => tick >= startTick && tick <= endTick) ?? null,
    metrics: catalogue.metrics });
}

/** Compatibility helper: optional selection is a candidate key or an available
 * kind. The default varies deterministically by record identity, rather than
 * always starting at the first twist. Feed-wide assignment belongs to the host.
 */
export function createReplayPreview(record: RecordIdentity, replay: unknown, selection?: string): ReplayPreviewClip {
  const catalogue = analyzeReplayPreview(record, replay);
  const exact = catalogue.candidates.find(candidate => candidate.key === selection);
  if (exact) return createReplayPreviewFromCandidate(catalogue, exact.key);
  const available = KINDS.filter(kind => catalogue.candidates.some(candidate => candidate.kind === kind));
  const kind = selection ?? available[hash(catalogue.selectionSeed) % available.length];
  const choices = catalogue.candidates.filter(candidate => candidate.kind === kind);
  if (!choices.length) throw new Error('This recording has no preview of the requested kind.');
  return createReplayPreviewFromCandidate(catalogue, choices[hash(`${catalogue.selectionSeed}:${kind}`) % choices.length].key);
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
