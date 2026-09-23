import type { Address, Hash, Hex } from 'viem';
import deployment from '../shared/deployment.json' with { type: 'json' };
import type { Replay } from '../../generated/infra/testnet/src/replay.ts';
export type { Replay };

export const PLAY_CHAIN_ID = 46630 as const;
export const PLAY_CONTRACTS = deployment.contracts as Record<'rf' | 'genesis' | 'generations' | 'game' | 'rewardToken', Address>;
export { ENGINE_VERSION } from '../../generated/engine-version.ts';
export const DEPLOYMENT_BLOCK = BigInt(deployment.assetDeploymentBlock);
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
  version: 2; chainId: typeof PLAY_CHAIN_ID; game: Address; account: Address;
  pending: PendingOperation | null; savedRun: SavedRun | null;
  friends: FriendSelection[]; history: OperationHistory[];
};
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
