import { getAddress, type Abi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyReplay } from './replay.ts';
import { resultData } from './protocol.ts';

/** Pure operator core: callers inject trusted compiled ABI and pinned engine metadata. */
export async function verifyAndSignCore({ client, chainId, game, runId, replay, privateKey, gameAbi, nftAbi, engineVersion, expectedPlayer, confirmations = 2 }: {
  client: any; chainId: number; game: Address; runId: bigint; replay: unknown; privateKey: Hex; confirmations?: number;
  gameAbi: Abi; nftAbi: Abi; engineVersion: Hex; expectedPlayer?: Address;
}) {
  if (![31337, 46630].includes(chainId)) throw new Error('Only Robinhood testnet and the isolated local chain are allowed.');
  if (await client.getChainId() !== chainId) throw new Error('RPC chain mismatch. Refusing to sign or send.');
  if (!Number.isSafeInteger(confirmations) || confirmations < (chainId === 46630 ? 2 : 0) || confirmations > 64) {
    throw new Error('Invalid confirmation depth. Robinhood testnet requires at least two confirmations.');
  }
  if (runId <= 0n) throw new Error('Invalid run ID.');
  const abi = gameAbi;
  const latest = await client.getBlockNumber({ cacheTime: 0 });
  if (latest < BigInt(confirmations)) throw new Error('Chain has insufficient confirmations.');
  const blockNumber = latest - BigInt(confirmations);
  const read = (functionName: string, args: unknown[] = []) => client.readContract({ address: game, abi, functionName, args, blockNumber });
  const [run, contractVersion, signer, epoch, paused, block, version] = await Promise.all([
    read('runs', [runId]), read('engineVersion'), read('verifier'), read('verifierEpoch'), read('paused'),
    client.getBlock({ blockNumber }), engineVersion,
  ]);
  if (contractVersion !== version) throw new Error('Engine source differs from the deployed version. Refusing to sign.');
  const account = privateKeyToAccount(privateKey);
  if (getAddress(signer) !== account.address) throw new Error('Verifier key does not match the contract.');
  const [player, tokenId, seed, startedAt, claimUntil, collection, difficulty, claimed, runEpoch, abandoned] = run;
  if (startedAt === 0n || claimed || abandoned || paused || runEpoch !== epoch) throw new Error('Run is not claimable.');
  if (expectedPlayer && getAddress(player) !== getAddress(expectedPlayer)) throw new Error('Authorization is not from the run player.');
  if (collection !== 0 && collection !== 1) throw new Error('Invalid run collection.');
  const duration = [120n, 90n, 60n][difficulty];
  if (duration === undefined || block.timestamp < startedAt + duration || block.timestamp >= claimUntil) {
    throw new Error('Run is unfinished or its claim window expired.');
  }
  const nft = await read(collection === 1 ? 'genesis' : 'generations');
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
