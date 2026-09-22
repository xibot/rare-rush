import { type Address, type Hex } from 'viem';
import { artifact } from './artifacts.mjs';
import { currentEngineVersion } from './engine-version.ts';
import { verifyAndSignCore } from './verifier-core.ts';

/** CLI/local wrapper; the hosted API supplies bundled trusted metadata to the pure core. */
export async function verifyAndSign(options: {
  client: any; chainId: number; game: Address; runId: bigint; replay: unknown; privateKey: Hex; confirmations?: number;
}) {
  const [game, nft, engineVersion] = await Promise.all([
    artifact('RareRushGame'), artifact('TestFriends'), currentEngineVersion(),
  ]);
  return verifyAndSignCore({ ...options, gameAbi: game.abi, nftAbi: nft.abi, engineVersion });
}
