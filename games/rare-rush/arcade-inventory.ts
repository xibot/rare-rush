import { isAddress, parseAbi, parseAbiItem, zeroAddress, type Address, type PublicClient } from 'viem';
import { GENERATION_SPRITE_MANIFEST } from '@rarefriends/friendsdk/sprites';
import { GENESIS_DEPLOYMENT } from './genesis/identity.ts';

export type InventoryClient = Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getLogs' | 'readContract'>;
export type ArcadeInventory = Readonly<{ account: Address; collection: 0 | 1; blockNumber: bigint; ids: readonly bigint[] }>;
export type InventoryFriend = Readonly<{ id: bigint; label: string; kind: 'owned'; walletAddress: Address; generation?: number }>;
export type ArcadeInventoryPage = Readonly<{ friends: readonly InventoryFriend[]; hiddenCount: number; nextCursor: number | null }>;
const ABI = parseAbi(['function balanceOf(address account) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)', 'function generation(uint256 tokenId) view returns (uint8)',
  'function tokenBoundAccount(uint256 tokenId) view returns (address)']);
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const address = (value: unknown): value is Address => typeof value === 'string' && isAddress(value) && !same(value, zeroAddress);
const contract = (collection: 0 | 1) => collection === 1 ? GENESIS_DEPLOYMENT.contract : GENERATION_SPRITE_MANIFEST.generations;
const active = (signal?: AbortSignal) => signal?.throwIfAborted();
async function chain(client: InventoryClient, signal?: AbortSignal) {
  active(signal);
  if (await client.getChainId() !== 4663) throw new Error('Friend discovery requires Robinhood mainnet (4663).');
  active(signal);
}

/** Discover IDs at one block, without reading artwork or every NFT's metadata.
 * This selection snapshot never authorizes play: the selected NFT is verified afresh.
 */
export async function discoverArcadeInventory(client: InventoryClient, account: Address, collection: 0 | 1,
  options: { signal?: AbortSignal } = {}): Promise<ArcadeInventory> {
  if (!address(account) || (collection !== 0 && collection !== 1)) throw new Error('Choose a valid wallet and collection.');
  const { signal } = options;
  await chain(client, signal);
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  active(signal);
  if (typeof blockNumber !== 'bigint' || blockNumber < 0n) throw new Error('Could not read the latest Robinhood block.');
  const balance = await client.readContract({ address: contract(collection), abi: ABI,
    functionName: 'balanceOf', args: [account], blockNumber });
  active(signal);
  const maximum = collection === 1 ? 1024n : 10_000n;
  if (typeof balance !== 'bigint' || balance < 0n || balance > maximum) throw new Error('This wallet balance exceeds the supported collection limit.');
  if (!balance) {
    await chain(client, signal);
    return Object.freeze({ account, collection, blockNumber, ids: Object.freeze([]) });
  }
  const query = { address: contract(collection), event: TRANSFER, fromBlock: 0n, toBlock: blockNumber, strict: true } as const;
  const [received, sent] = await Promise.all([
    client.getLogs({ ...query, args: { to: account } }), client.getLogs({ ...query, args: { from: account } }),
  ]);
  active(signal);
  if (received.length + sent.length > 100_000) throw new Error('This wallet transfer history exceeds the supported limit.');
  const events = new Map<string, typeof received[number]>();
  for (const log of [...received, ...sent]) {
    const { from, to, tokenId } = log.args;
    if (!same(log.address, query.address) || log.removed || typeof log.blockNumber !== 'bigint' ||
      log.blockNumber < 0n || log.blockNumber > blockNumber || log.logIndex === null ||
      !Number.isSafeInteger(log.logIndex) || log.logIndex < 0 || !isAddress(from) || !isAddress(to) ||
      typeof tokenId !== 'bigint' || tokenId <= 0n || tokenId >= (1n << 256n) || (!same(from, account) && !same(to, account))) {
      throw new Error('Friend transfer history could not be verified. Please retry.');
    }
    const key = `${log.blockNumber}:${log.logIndex}`;
    const previous = events.get(key);
    if (previous && (previous.args.tokenId !== tokenId || !same(previous.args.from, from) || !same(previous.args.to, to))) {
      throw new Error('Friend transfer history is inconsistent. Please retry.');
    }
    events.set(key, log);
  }
  const ordered = [...events.values()].sort((a, b) => a.blockNumber! === b.blockNumber!
    ? a.logIndex! - b.logIndex! : a.blockNumber! < b.blockNumber! ? -1 : 1);
  const held = new Set<bigint>();
  for (const log of ordered) {
    if (same(log.args.to, account)) held.add(log.args.tokenId);
    else held.delete(log.args.tokenId);
  }
  if (BigInt(held.size) !== balance) throw new Error('Friend transfer history is incomplete or changed. Please retry.');
  await chain(client, signal);
  return Object.freeze({ account, collection, blockNumber, ids: Object.freeze([...held].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) });
}

/** Each page checks at most eight IDs. A large holder can play the first page
 * immediately; remaining metadata and portraits are requested only on demand.
 */
export async function readArcadeInventoryPage(client: InventoryClient, inventory: ArcadeInventory,
  options: { signal?: AbortSignal; cursor?: number } = {}): Promise<ArcadeInventoryPage> {
  const { signal, cursor = 0 } = options;
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > inventory.ids.length) throw new Error('Invalid Friend page.');
  await chain(client, signal);
  const address = contract(inventory.collection), blockNumber = inventory.blockNumber;
  const ids = inventory.ids.slice(cursor, cursor + 8);
  let stopped = false;
  try {
    const friends: (InventoryFriend | null)[] = [];
    // Four NFTs at a time, at most eight parallel contract reads. Transport batches them.
    for (let offset = 0; offset < ids.length; offset += 4) {
      active(signal);
      const page = await Promise.all(ids.slice(offset, offset + 4).map(async id => {
        const [owner, generation] = await Promise.all([
          client.readContract({ address, abi: ABI, functionName: 'ownerOf', args: [id], blockNumber }),
          inventory.collection === 0 ? client.readContract({ address, abi: ABI, functionName: 'generation', args: [id], blockNumber }) : undefined,
        ]);
        active(signal);
        if (stopped) throw new Error('Friend page cancelled.');
        if (typeof owner !== 'string' || !isAddress(owner) || !same(owner, inventory.account)) throw new Error('Friend ownership changed or history is inconsistent. Refresh your Friends.');
        if (inventory.collection === 0 && (!Number.isInteger(generation) || generation! < 0 || generation! > 255)) throw new Error('Invalid Friend generation.');
        if (generation === 0) return null;
        const walletAddress = await client.readContract({ address, abi: ABI, functionName: 'tokenBoundAccount', args: [id], blockNumber });
        active(signal);
        if (typeof walletAddress !== 'string' || !isAddress(walletAddress) || same(walletAddress, zeroAddress)) throw new Error('Invalid canonical Friend wallet.');
        return Object.freeze({ id, label: `${inventory.collection === 1 ? 'Genesis' : 'Friend'} #${id}`, kind: 'owned' as const,
          walletAddress, ...(generation === undefined ? {} : { generation }) });
      }));
      friends.push(...page);
    }
    await chain(client, signal);
    const visible = friends.filter((friend): friend is InventoryFriend => friend !== null);
    const next = cursor + ids.length;
    return Object.freeze({ friends: Object.freeze(visible), hiddenCount: ids.length - visible.length,
      nextCursor: next < inventory.ids.length ? next : null });
  } finally { stopped = true; }
}
