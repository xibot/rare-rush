/** Local AGENT PLAY adapter. The pilot is deterministic autopilot, not an LLM.
 * Physics and display direction both come from the existing Twist modules.
 * All movement uses recorded public controls; no game state is overridden.
 */
import {
  createRun, demoControls, jump, setSliding, setPace, stepRun, FIXED_STEP,
  type Difficulty, type RunState, type RunEvent, type Phase,
} from '../games/rare-rush/twist/engine.ts';
import { headingFor, canonicalAxis, type Heading } from '../games/rare-rush/twist/presentation.ts';
import { difficultySettings } from '../games/rare-rush/difficulty.ts';
import { parseReplay, MAX_REPLAY_BYTES, MAX_PICKUPS, type InputFrame, type Replay } from '../infra/testnet/src/replay.ts';
import { PROTOCOL_VERSION } from '../infra/testnet/src/protocol.ts';

export { FIXED_STEP, PROTOCOL_VERSION, MAX_REPLAY_BYTES };
export type { Difficulty, InputFrame, Replay, RunState };
export const AUTOPILOT_LABEL = 'Deterministic autopilot';
export const AGENT_REPLAY_VERSION = 'rare-rush-agent-local-v1' as const;

/** The inner input object can be submitted to the existing V2 verifier.
 * The local envelope also binds the terminal tick, including a losing run.
 * There are deliberately no client-supplied scores or state snapshots.
 */
export interface AgentReplay {
  version: typeof AGENT_REPLAY_VERSION;
  finalTick: number;
  inputs: Replay;
}

export interface RunMetrics {
  /** Local deterministic replay verification, not an onchain claim receipt. */
  verified: true;
  outcome: 'survived' | 'lost';
  finishReason: 'time' | 'hearts';
  score: number;
  coins: number;
  bonusCoins: number;
  hearts: number;
  distance: number;
  ticks: number;
  elapsed: number;
  duration: number;
  pickupKinds: `0x${string}`;
  phasesVisited: Phase[];
}

export interface RunSession {
  kind: 'agent' | 'replay';
  seed: string;
  difficulty: Difficulty;
  /** Live simulation state: renderers must not mutate it. */
  run: RunState;
  /** Canonical controls in slide → pace → jump order, one frame per tick. */
  frames: InputFrame[];
  events: RunEvent[];
  lastControl: InputFrame | null;
  maxTicks: number;
  /** Present only for playback; imported arrays are always defensive copies. */
  replay?: AgentReplay;
  pickupKinds: number[];
  phasesVisited: Phase[];
}

function normalizedSeed(seed: string): string {
  if (typeof seed !== 'string' || seed.length < 1 || seed.length > 256 || !seed.trim()) {
    throw new Error('Seed must be a nonempty string of at most 256 characters.');
  }
  // Matches infra/testnet/test/pilot.ts and the contract-seed replay verifier.
  return seed.toLowerCase();
}

function tickLimit(difficulty: Difficulty): number {
  return difficultySettings(difficulty).seconds * 120;
}

export function createAgentSession(seed: string, difficulty: Difficulty = 'normal'): RunSession {
  const normalized = normalizedSeed(seed);
  const maxTicks = tickLimit(difficulty);
  return {
    kind: 'agent', seed: normalized, difficulty, run: createRun(normalized, difficulty),
    frames: [], events: [], lastControl: null, maxTicks,
    pickupKinds: [], phasesVisited: ['side'],
  };
}

/** Dense recordings preserve repeated slide fast-fall and jump ordering.
 * Sparse V2 replays are legal elsewhere but are not complete local recordings.
 */
function parseDenseInputs(input: unknown, ticks: number, maxTicks: number): Replay {
  if (!Number.isSafeInteger(ticks) || ticks < 0 || ticks > maxTicks) {
    throw new Error('Invalid replay tick count.');
  }
  const replay = parseReplay(input, maxTicks);
  if (replay.frames.length !== ticks || replay.frames.some((frame, index) => frame.tick !== index)) {
    throw new Error('Incomplete recording: exactly one ordered control frame is required per tick.');
  }
  return replay;
}

function parseEnvelope(input: unknown, maxTicks: number): AgentReplay {
  if (typeof input === 'string') {
    // Check character count before encoding so a huge import allocates no copy.
    if (input.length > MAX_REPLAY_BYTES || new TextEncoder().encode(input).length > MAX_REPLAY_BYTES) {
      throw new Error('Replay exceeds the 1.5 MB input limit.');
    }
    try { input = JSON.parse(input); }
    catch { throw new Error('Replay must be valid JSON.'); }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a local replay object.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'finalTick,inputs,version' || value.version !== AGENT_REPLAY_VERSION) {
    throw new Error('Unsupported local replay schema. Client scores and state overrides are not accepted.');
  }
  if (!Number.isSafeInteger(value.finalTick) || (value.finalTick as number) < 1) {
    throw new Error('A completed replay needs a positive final tick.');
  }
  const finalTick = value.finalTick as number;
  // parseReplay bounds frames and permits only primitive legal controls. An
  // object input cannot hide oversized strings, arbitrary nested objects, or totals.
  const inputs = parseDenseInputs(value.inputs, finalTick, maxTicks);
  return { version: AGENT_REPLAY_VERSION, finalTick, inputs };
}

function applyFrame(session: RunSession, frame: InputFrame): RunEvent[] {
  const { run } = session;
  if (run.status !== 'running') throw new Error('Replay has inputs after the run ended.');
  if (run._tick >= session.maxTicks || frame.tick !== run._tick) throw new Error('Replay tick does not match the engine.');
  // Exactly the same ordering as the existing protocol and recordPilot fixture.
  setSliding(run, frame.slide);
  setPace(run, frame.pace);
  if (frame.jump) jump(run);
  const events = stepRun(run, FIXED_STEP);
  session.frames.push({ ...frame });
  session.lastControl = { ...frame };
  session.events = events;
  for (const event of events) {
    if (event.type === 'coin') session.pickupKinds.push(event.rewardMultiplier === 10 ? 1 : 0);
  }
  if (session.pickupKinds.length > MAX_PICKUPS) throw new Error('Pickup limit exceeded.');
  if (!session.phasesVisited.includes(run.phase)) session.phasesVisited.push(run.phase);
  return events;
}

/** Advance exactly one fixed tick. Display speed belongs to the host clock. */
export function advanceAgent(session: RunSession): RunEvent[] {
  if (session.kind !== 'agent') throw new Error('Use advanceReplay for playback sessions.');
  if (session.run.status === 'finished') return [];
  const { axis, jump: press, slide } = demoControls(session.run);
  return applyFrame(session, { tick: session.run._tick, jump: press, slide, pace: axis });
}

/** Restore a paused live agent by replaying its recorded prefix. Never trust a
 * saved engine snapshot. Keep rawReplay in the existing {version,frames} format.
 */
export function resumeAgentSession(seed: string, difficulty: Difficulty, rawReplay: unknown, ticks: number): RunSession {
  const session = createAgentSession(seed, difficulty);
  const inputs = parseDenseInputs(rawReplay, ticks, session.maxTicks);
  for (const frame of inputs.frames) applyFrame(session, frame);
  return session;
}

export function createReplaySession(seed: string, difficulty: Difficulty, replay: unknown): RunSession {
  const session = createAgentSession(seed, difficulty);
  session.kind = 'replay';
  session.replay = parseEnvelope(replay, session.maxTicks);
  return session;
}

export function advanceReplay(session: RunSession): RunEvent[] {
  if (session.kind !== 'replay' || !session.replay) throw new Error('Expected a playback session.');
  const { run, replay } = session;
  if (run.status === 'finished') {
    if (run._tick !== replay.finalTick) throw new Error('Replay has inputs after the run ended.');
    return [];
  }
  const frame = replay.inputs.frames[run._tick];
  if (!frame) throw new Error('Incomplete replay: recording ended before the run finished.');
  const events = applyFrame(session, frame);
  if (session.run.status === 'finished' && run._tick !== replay.finalTick) {
    throw new Error('Replay has inputs after the run ended.');
  }
  if (run._tick === replay.finalTick && session.run.status !== 'finished') {
    throw new Error('Incomplete replay: final tick does not finish the run.');
  }
  return events;
}

/** Detached render snapshot; no replay log duplication per visual frame. */
export function snapshotSession(session: RunSession): RunState {
  return structuredClone(session.run);
}

/** Screen-relative control for the HUD; recordings always retain canonical pace. */
export function presentationControl(session: RunSession): { heading: Heading; axis: -1 | 0 | 1 } {
  const heading = headingFor(session.run);
  return { heading, axis: canonicalAxis(session.lastControl?.pace ?? 0, session.run.phase, heading) };
}

/** Bounded synchronous helper for validation and tests, not the animation clock. */
export function runSessionToEnd(session: RunSession): RunSession {
  let remaining = session.maxTicks;
  while (session.run.status === 'running' && remaining-- > 0) {
    if (session.kind === 'agent') advanceAgent(session);
    else advanceReplay(session);
  }
  if (session.run.status !== 'finished') throw new Error('Simulation exceeded the maximum run length.');
  return session;
}

export function getSessionMetrics(session: RunSession): RunMetrics {
  const { run } = session;
  if (run.status !== 'finished' || !run.finishReason) throw new Error('The run is not complete.');
  return {
    verified: true, outcome: run.finishReason === 'time' && run.hearts > 0 ? 'survived' : 'lost',
    finishReason: run.finishReason, score: run.score, coins: run.coins, bonusCoins: run.bonusCoins,
    hearts: run.hearts, distance: Math.floor(run.distance), ticks: run._tick,
    elapsed: run.elapsed, duration: run.duration,
    pickupKinds: `0x${session.pickupKinds.map(kind => kind === 1 ? '01' : '00').join('')}`,
    phasesVisited: [...session.phasesVisited],
  };
}

export function exportAgentReplay(session: RunSession): AgentReplay {
  if (session.run.status !== 'finished') throw new Error('Only completed runs can be exported.');
  return parseEnvelope({
    version: AGENT_REPLAY_VERSION, finalTick: session.run._tick,
    inputs: { version: PROTOCOL_VERSION, frames: session.frames },
  }, session.maxTicks);
}

/** Recompute outcomes from legal inputs and the unchanged engine. This validates
 * losses locally too; only the existing Testnet verifier can issue claim receipts.
 * Legal edits can produce a different valid run: this is not a signed recording.
 */
export function checkAgentReplay(seed: string, difficulty: Difficulty, replay: unknown): RunMetrics {
  return getSessionMetrics(runSessionToEnd(createReplaySession(seed, difficulty, replay)));
}
