import { createPublicClient, http, parseAbi } from 'viem';
import { GENERATION_SPRITE_MANIFEST } from '@rarefriends/friendsdk/sprites';
import { GENESIS_DEPLOYMENT } from '../games/rare-rush/genesis/identity.ts';

const abi = parseAbi(['function ownerOf(uint256 tokenId) view returns(address)', 'function generation(uint256 tokenId) view returns(uint256)']);

/** Recheck the NFT gate on the server. The signed artwork is a bounded saved
 * snapshot supplied by this owner, not an independent onchain artwork attestation.
 */
export function createArcadeReplayBinding({ client } = {}) {
  return async payload => {
    if (!client || await client.getChainId() !== 4663) throw new Error('Arcade RPC is unavailable.');
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
    const address = payload.collection === 1 ? GENESIS_DEPLOYMENT.contract : GENERATION_SPRITE_MANIFEST.generations;
    const read = functionName => client.readContract({ address, abi, functionName, args: [BigInt(payload.tokenId)], blockNumber });
    const [owner, generation] = await Promise.all([read('ownerOf'), payload.collection === 0 ? read('generation') : 1n]);
    if (typeof owner !== 'string' || owner.toLowerCase() !== payload.player.toLowerCase() || generation < 1n) return null;
    return { chainId: 4663, collection: address, tokenId: payload.tokenId, owner: owner.toLowerCase(), verifiedAtBlock: String(blockNumber) };
  };
}

export function arcadeReplayClient(rpcUrl = process.env.RUSH_MAINNET_RPC_URL || GENESIS_DEPLOYMENT.rpcUrl) {
  const url = new URL(rpcUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Invalid Arcade RPC configuration.');
  return createPublicClient({ transport: http(url.href, { timeout: 8000, retryCount: 0, batch: { wait: 10 } }), cacheTime: 0 });
}
