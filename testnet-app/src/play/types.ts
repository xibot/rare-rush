import type { Address, Hash, Hex } from 'viem';
import type { Replay } from '../../generated/infra/testnet/src/replay.ts';
export type { Replay };

export const PLAY_CHAIN_ID = 46630 as const;
export const PLAY_CONTRACTS = {
  rf: '0xed668133bab94dd83e537f12b68365c4bc0ec2a3',
  genesis: '0x7404d2b0461228c6478fdb8850d27d8e65efd2c3',
  generations: '0x606dcbfa17b76e4194865a09d6cfb92be7ee26c3',
  game: '0x24bca5bf559e0353801f719ebc3885441cb49fd3',
  rewardToken: '0x9fce27c074281709d0ccd9bd0439f223e8f83844',
} as const satisfies Record<string, Address>;
export const ENGINE_VERSION: Hash = '0xd907fa6f48be2aff2712c2e254943dc8afa749e7bfb5d9b28dc865c3a096ba99';
export const DEPLOYMENT_BLOCK = 122550772n;
export type Collection = 0 | 1;
export type Difficulty = 0 | 1 | 2;
export type FriendSelection = { collection: Collection; tokenId: string };
export type RunSelection = FriendSelection & { difficulty: Difficulty };
export type RunSnapshot = RunSelection & {
  runId: string; player: Address; seed: Hash; startedAt: string; claimUntil: string;
  verifierEpoch: string; claimed: boolean; abandoned: boolean;
};
export type VerifiedClaim = {
  chainId: typeof PLAY_CHAIN_ID; game: Address; runId: string; player: Address;
  engineVersion: Hash; pickupKinds: Hex; replayHash: Hash; deadline: string;
  signature: Hex; claimArgs: [string, Hex, Hash, string, Hex];
};
export type SavedRun = {
  run: RunSnapshot; replay: Replay; completedTicks: number;
  status: 'ready' | 'playing' | 'survived' | 'lost' | 'interrupted' | 'claimed' | 'abandoned';
  claim?: VerifiedClaim; reward?: string;
};
export type PendingOperation = {
  kind: 'approve' | 'start' | 'claim' | 'abandon';
  to: Address; data: Hex; value: '0'; nonce: number; hash: Hash | null;
  createdAt: number; selection?: RunSelection; runId?: string; claim?: VerifiedClaim;
};
export type OperationHistory = {
  kind: PendingOperation['kind']; hash: Hash;
  status: 'confirmed' | 'reverted' | 'replaced'; at: number;
};
export type PlayState = {
  version: 1; chainId: typeof PLAY_CHAIN_ID; game: Address; account: Address;
  pending: PendingOperation | null; savedRun: SavedRun | null;
  friends: FriendSelection[]; history: OperationHistory[];
};
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
