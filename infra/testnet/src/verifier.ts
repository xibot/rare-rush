import { getAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { artifact } from './artifacts.mjs';
import { assertChain } from './chain.mjs';
import { currentEngineVersion } from './engine-version.ts';
import { verifyReplay } from './replay.ts';
import { resultData } from './protocol.ts';

/** Trusted operator library. No public HTTP endpoint or client-selected RPC/signing key. */
export async function verifyAndSign({ client, chainId, game, runId, replay, privateKey, confirmations = 2 }: {
  client: any; chainId: number; game: Address; runId: bigint; replay: unknown; privateKey: Hex; confirmations?: number;
}) {
  await assertChain(client, chainId);
  if (!Number.isSafeInteger(confirmations) || confirmations < (chainId === 46630 ? 2 : 0) || confirmations > 64) {
    throw new Error('Invalid confirmation depth. Robinhood testnet requires at least two confirmations.');
  }
  if (runId <= 0n) throw new Error('Invalid run ID.');
  const { abi } = await artifact('RareRushGame');
  const latest = await client.getBlockNumber({ cacheTime: 0 });
  if (latest < BigInt(confirmations)) throw new Error('Chain has insufficient confirmations.');
  const blockNumber = latest - BigInt(confirmations);
  const read = (functionName: string, args: unknown[] = []) => client.readContract({ address: game, abi, functionName, args, blockNumber });
  const [run, contractVersion, signer, epoch, paused, block, version] = await Promise.all([
    read('runs', [runId]), read('engineVersion'), read('verifier'), read('verifierEpoch'), read('paused'),
    client.getBlock({ blockNumber }), currentEngineVersion(),
  ]);
  if (contractVersion !== version) throw new Error('Engine source differs from the deployed version. Refusing to sign.');
  const account = privateKeyToAccount(privateKey);
  if (getAddress(signer) !== account.address) throw new Error('Verifier key does not match the contract.');
  const [player, tokenId, seed, startedAt, claimUntil, collection, difficulty, claimed, runEpoch, abandoned] = run;
  if (startedAt === 0n || claimed || abandoned || paused || runEpoch !== epoch) throw new Error('Run is not claimable.');
  const duration = [120n, 90n, 60n][difficulty];
  if (duration === undefined || block.timestamp < startedAt + duration || block.timestamp >= claimUntil) {
    throw new Error('Run is unfinished or its claim window expired.');
  }
  const nft = await read(collection === 1 ? 'genesis' : 'generations');
  const { abi: nftAbi } = await artifact('TestFriends');
  const owner = await client.readContract({ address: nft, abi: nftAbi, functionName: 'ownerOf', args: [tokenId], blockNumber });
  if (getAddress(owner) !== getAddress(player)) throw new Error('Player no longer owns the test NFT.');
  if (collection === 0 && await client.readContract({ address: nft, abi: nftAbi, functionName: 'generation', args: [tokenId], blockNumber }) < 1n) {
    throw new Error('Generations Friend is not hardwired.');
  }
  const result = verifyReplay(seed, difficulty, replay);
  // Short-lived receipts fit within the onchain run window. A stale RPC may produce
  // an expired receipt, but cannot extend that window or bypass contract checks.
  const deadline = block.timestamp + 300n < claimUntil ? block.timestamp + 300n : claimUntil;
  const signed = resultData(chainId, game, {
    runId, player, runSeed: seed, pickupKinds: result.pickupKinds, replayHash: result.replayHash,
    engineVersion: version, deadline, verifierEpoch: epoch,
  });
  const signature = await account.signTypedData(signed);
  return {
    chainId, game, runId: runId.toString(), player, engineVersion: version,
    verifiedAtBlock: blockNumber.toString(), ...result, deadline: deadline.toString(), signature,
    claimArgs: [runId.toString(), result.pickupKinds, result.replayHash, deadline.toString(), signature],
  };
}
