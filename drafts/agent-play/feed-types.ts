import { decodeGenerationSprites } from '@rarefriends/friendsdk/sprites';
import type { ArcadeFriend } from './arcade.ts';
import type { AgentReplay, Difficulty, RunMetrics } from './runner.ts';

/** Public local replay metadata. Wallet configuration never enters the feed. */
export type SavedRunArt = {
  collection: 0 | 1;
  tokenId: string;
  owner: `0x${string}`;
  chainId: 4663;
  blockNumber?: string;
  label: string;
  portraitUrl?: string;
  bodyId?: string;
  sprites?: { familyId: number; seed: number; frames: (string | bigint)[] };
};

export type RunRecord = {
  id: string;
  source: 'local' | 'arcade' | 'testnet';
  collection: 0 | 1;
  tokenId: string;
  difficulty: Difficulty;
  seed: string;
  runId?: string;
  player?: string;
  createdAt: string;
  metrics: RunMetrics;
  agent: string;
  verification: string;
  agentJobId?: string;
  replay?: AgentReplay;
  art?: SavedRunArt;
};

/** Restore packed artwork only for rendering; this performs no chain reads. */
export function decodeRunArt(record: Pick<RunRecord, 'art'>): ArcadeFriend | undefined {
  const art = record.art;
  if (!art) return undefined;
  return {
    ...art,
    blockNumber: art.blockNumber ?? '0',
    sprites: art.sprites ? decodeGenerationSprites(BigInt(art.tokenId), art.sprites.familyId,
      art.sprites.seed, art.sprites.frames.map(BigInt)) : undefined,
  };
}
