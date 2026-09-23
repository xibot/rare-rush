import { getAddress, isAddress, isHash, keccak256, toHex, zeroAddress } from 'viem';
import type { Address, Hex } from 'viem';
import { parseReplay } from '../../generated/infra/testnet/src/replay.ts';
import { PLAY_CHAIN_ID, PLAY_CONTRACTS, ENGINE_VERSION, type PlayState, type StorageLike, type RunSnapshot, type VerifiedClaim, type FriendSelection } from './types.ts';

const MAX_STATE_BYTES = 1_800_000;
export const maxRunTicks = (difficulty: number) => [14400, 10800, 7200][difficulty];
const fail = (message = 'Saved testnet run data is invalid. Keep the saved data and recover the transaction before retrying.'): never => { throw new Error(message); };
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : fail();
export const decimal = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
const address = (value: unknown): value is Address => typeof value === 'string' && isAddress(value) && value.toLowerCase() !== zeroAddress;
const hex = (value: unknown, maxBytes: number): value is Hex => typeof value === 'string' && /^0x(?:[a-fA-F0-9]{2})*$/.test(value) && value.length <= 2 + maxBytes * 2;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function friend(input: unknown): FriendSelection {
  const value = object(input);
  if (![0, 1].includes(value.collection) || !decimal(value.tokenId) || value.tokenId === '0') fail();
  return { collection: value.collection, tokenId: value.tokenId };
}
export function validateRun(input: unknown): RunSnapshot {
  const value = object(input);
  friend(value);
  if (![0, 1, 2].includes(value.difficulty) || !decimal(value.runId) || value.runId === '0' || !address(value.player) || !isHash(value.seed) ||
      !decimal(value.startedAt) || value.startedAt === '0' || !decimal(value.claimUntil) ||
      BigInt(value.claimUntil) !== BigInt(value.startedAt) + BigInt(maxRunTicks(value.difficulty) / 120 + 900) ||
      !decimal(value.verifierEpoch) || value.verifierEpoch === '0' || typeof value.claimed !== 'boolean' || typeof value.abandoned !== 'boolean' ||
      (value.claimed && value.abandoned)) fail();
  return value as RunSnapshot;
}
/** Untrusted server/localStorage receipts may never redirect or change a wallet call. */
export function validateVerifiedClaim(input: unknown, run: RunSnapshot, replay?: unknown): VerifiedClaim {
  const value = object(input);
  if (value.chainId !== PLAY_CHAIN_ID || !address(value.game) || !same(value.game, PLAY_CONTRACTS.game) ||
      value.runId !== run.runId || !address(value.player) || !same(value.player, run.player) || value.engineVersion !== ENGINE_VERSION ||
      !hex(value.pickupKinds, 512) || !/^0x(?:00|01)*$/.test(value.pickupKinds) || !isHash(value.replayHash) || /^0x0+$/.test(value.replayHash) ||
      !decimal(value.deadline) || value.deadline === '0' || BigInt(value.deadline) > BigInt(run.claimUntil) ||
      !hex(value.signature, 65) || value.signature.length !== 132 || !Array.isArray(value.claimArgs) || value.claimArgs.length !== 5) fail('Invalid verifier receipt. No claim transaction was requested.');
  const expected = [value.runId, value.pickupKinds, value.replayHash, value.deadline, value.signature];
  if (!expected.every((item, index) => item === value.claimArgs[index])) fail('Verifier claim arguments do not match this run.');
  if (replay !== undefined) {
    const normalized = parseReplay(replay, maxRunTicks(run.difficulty));
    if (keccak256(toHex(JSON.stringify(normalized))) !== value.replayHash) fail('Verifier receipt belongs to another replay.');
  }
  return { chainId: PLAY_CHAIN_ID, game: PLAY_CONTRACTS.game, runId: run.runId, player: run.player,
    engineVersion: ENGINE_VERSION, pickupKinds: value.pickupKinds, replayHash: value.replayHash,
    deadline: value.deadline, signature: value.signature, claimArgs: expected as VerifiedClaim['claimArgs'] };
}
export function stateKey(account: Address) { return `rare-rush:play:v2:${PLAY_CHAIN_ID}:${PLAY_CONTRACTS.game}:${account.toLowerCase()}`; }
const LEGACY_GAME = '0x24bca5bf559e0353801f719ebc3885441cb49fd3';
/** Reuse remembered NFT IDs only. V1 replays, receipts and pending writes stay untouched. */
function rememberedV1Friends(storage: StorageLike, account: Address): FriendSelection[] {
  try {
    const raw = storage.getItem(`rare-rush:play:v1:${PLAY_CHAIN_ID}:${LEGACY_GAME}:${account.toLowerCase()}`);
    if (!raw || raw.length > MAX_STATE_BYTES) return [];
    const prior = JSON.parse(raw);
    if (prior.version !== 1 || prior.chainId !== PLAY_CHAIN_ID || !same(prior.game, LEGACY_GAME) ||
      typeof prior.account !== 'string' || !same(prior.account, account) || !Array.isArray(prior.friends)) return [];
    const ids = new Map<string, FriendSelection>();
    for (const value of prior.friends.slice(0, 100)) {
      try { const item = friend(value); ids.set(`${item.collection}:${item.tokenId}`, item); } catch { /* Invalid IDs confer no ownership. */ }
    }
    return [...ids.values()];
  } catch { return []; }
}
export function emptyPlayState(account: Address): PlayState {
  if (!address(account)) fail();
  return { version: 2, chainId: PLAY_CHAIN_ID, game: PLAY_CONTRACTS.game, account: getAddress(account), pending: null, savedRun: null, friends: [], history: [] };
}
export function validatePlayState(input: unknown, account: Address): PlayState {
  const value = object(input);
  if (value.version !== 2 || value.chainId !== PLAY_CHAIN_ID || value.game !== PLAY_CONTRACTS.game || !address(value.account) || !same(value.account, account) ||
      !Array.isArray(value.friends) || value.friends.length > 100 || !Array.isArray(value.history) || value.history.length > 20) fail();
  value.friends = value.friends.map(friend);
  for (const item of value.history) {
    if (!['approve', 'start', 'claim', 'abandon'].includes(item?.kind) || !isHash(item.hash) || !['confirmed', 'reverted', 'replaced'].includes(item.status) || !Number.isSafeInteger(item.at) || item.at < 0) fail();
  }
  if (value.savedRun !== null) {
    const saved = object(value.savedRun);
    saved.run = validateRun(saved.run);
    if (!same(saved.run.player, account) || !['ready', 'playing', 'survived', 'lost', 'interrupted', 'claimed', 'abandoned'].includes(saved.status) ||
        !Number.isSafeInteger(saved.completedTicks) || saved.completedTicks < 0 || saved.completedTicks > maxRunTicks(saved.run.difficulty)) fail();
    saved.replay = parseReplay(saved.replay, maxRunTicks(saved.run.difficulty));
    if (saved.replay.frames.some((frame: {tick: number}) => frame.tick >= saved.completedTicks)) fail();
    if (saved.status === 'survived' && saved.completedTicks !== maxRunTicks(saved.run.difficulty)) fail();
    if (saved.claim !== undefined) saved.claim = validateVerifiedClaim(saved.claim, saved.run, saved.replay);
    if (saved.reward !== undefined && !decimal(saved.reward)) fail();
  }
  if (value.pending !== null) {
    const pending = object(value.pending);
    if (!['approve', 'start', 'claim', 'abandon'].includes(pending.kind) || !address(pending.to) || !hex(pending.data, 2048) || pending.value !== '0' ||
        !Number.isSafeInteger(pending.nonce) || pending.nonce < 0 || (pending.hash !== null && !isHash(pending.hash)) ||
        !Number.isSafeInteger(pending.createdAt) || pending.createdAt < 0) fail();
    if (!same(pending.to, pending.kind === 'approve' ? PLAY_CONTRACTS.rf : PLAY_CONTRACTS.game)) fail();
    if (pending.kind === 'start') {
      friend(pending.selection);
      if (![0, 1, 2].includes(pending.selection.difficulty)) fail();
    }
    if (pending.kind === 'claim' || pending.kind === 'abandon') {
      if (!decimal(pending.runId) || pending.runId === '0' || value.savedRun?.run.runId !== pending.runId) fail();
      if (pending.kind === 'claim') pending.claim = validateVerifiedClaim(pending.claim, value.savedRun.run, value.savedRun.replay);
    }
  }
  return value as PlayState;
}
export function loadPlayState(storage: StorageLike, account: Address): PlayState {
  const raw = storage.getItem(stateKey(account));
  if (raw === null) return { ...emptyPlayState(account), friends: rememberedV1Friends(storage, account) };
  if (raw.length > MAX_STATE_BYTES) fail();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { fail(); }
  return validatePlayState(parsed, account);
}
export function savePlayState(storage: StorageLike, state: PlayState) {
  const serialized = JSON.stringify(validatePlayState(state, state.account));
  if (serialized.length > MAX_STATE_BYTES) fail();
  // Persistence failure is fatal before a wallet send; never fall back to volatile state.
  storage.setItem(stateKey(state.account), serialized);
  if (storage.getItem(stateKey(state.account)) !== serialized) throw new Error('Could not save transaction recovery data.');
}
