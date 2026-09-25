import { createPublicClient, http, parseAbi } from 'viem';
import deployment from '../testnet-app/src/shared/deployment.json' with { type: 'json' };
import { ENGINE_VERSION } from '../shared/testnet-engine-version.ts';

export const PUBLIC_TESTNET_GAME = deployment.contracts.game;
export const PUBLIC_TESTNET_ENGINE_VERSION = ENGINE_VERSION;
const abi = parseAbi([
  'function engineVersion() view returns (bytes32)',
  'function runs(uint256) view returns (address player,uint256 tokenId,bytes32 seed,uint64 startedAt,uint64 claimUntil,uint8 collection,uint8 difficulty,bool claimed,uint256 verifierEpoch,bool abandoned)',
]);

/** A completed replay is tied to a confirmed RunStarted record. This does not
 * assert that the replay was claimed or authorize minting/transactions.
 */
export function createTestnetReplayBinding({ client, engineVersion = PUBLIC_TESTNET_ENGINE_VERSION } = {}) {
  return async (payload, metrics) => {
    if (!client) throw new Error('Testnet RPC is unavailable.');
    if (await client.getChainId() !== 46630) throw new Error('Testnet RPC chain mismatch.');
    const latest = await client.getBlockNumber({ cacheTime: 0 });
    if (latest < 2n) throw new Error('Insufficient confirmed blocks.');
    const blockNumber = latest - 2n;
    const [run, version, block] = await Promise.all([
      client.readContract({ address: PUBLIC_TESTNET_GAME, abi, functionName: 'runs', args: [BigInt(payload.runId)], blockNumber }),
      client.readContract({ address: PUBLIC_TESTNET_GAME, abi, functionName: 'engineVersion', blockNumber }),
      client.getBlock({ blockNumber }),
    ]);
    if (version.toLowerCase() !== engineVersion.toLowerCase()) throw new Error('Pinned engine differs from the game.');
    const [player, tokenId, seed, startedAt, , collection, difficulty] = run;
    if (startedAt === 0n || player.toLowerCase() !== payload.player.toLowerCase() || String(tokenId) !== payload.tokenId
      || seed.toLowerCase() !== payload.seed.toLowerCase() || collection !== payload.collection
      || difficulty !== ['easy', 'normal', 'degen'].indexOf(payload.difficulty)
      || block.timestamp < startedAt + BigInt(Math.floor(metrics.elapsed))) {
      return null;
    }
    return { chainId: 46630, game: PUBLIC_TESTNET_GAME, runId: payload.runId,
      verifiedAtBlock: String(blockNumber), engineVersion: version };
  };
}

export function testnetReplayClient(rpcUrl = process.env.RUSH_TESTNET_RPC_URL || 'https://rpc.testnet.chain.robinhood.com') {
  const url = new URL(rpcUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Invalid Testnet RPC configuration.');
  return createPublicClient({ transport: http(url.href, { timeout: 8000, retryCount: 0, batch: { wait: 10 } }), cacheTime: 0 });
}
