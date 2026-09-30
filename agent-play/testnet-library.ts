import { isAddress, parseAbi, parseAbiItem, zeroAddress, type Address, type PublicClient } from 'viem';
import deployment from '../testnet-app/src/shared/deployment.json' with { type: 'json' };

const TRANSFER = parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)');
const ABI = parseAbi(['function balanceOf(address) view returns(uint256)', 'function ownerOf(uint256) view returns(address)',
  'function generation(uint256) view returns(uint256)']);
const START = BigInt(deployment.assetDeploymentBlock);
// Robinhood Testnet's private provider accepts at most 10,000 blocks per log query.
export const TESTNET_HISTORY_RANGE = 10_000n;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const address = (collection: 0 | 1) => deployment.contracts[collection === 1 ? 'genesis' : 'generations'] as Address;
const validAccount = (account: unknown): account is Address => typeof account === 'string' && isAddress(account) && !same(account, zeroAddress);
type Client = Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getLogs' | 'readContract'>;
export type TestnetInventory = Readonly<{ account: Address; collection: 0 | 1; blockNumber: bigint; balance: bigint }>;
type Search = Readonly<{ nextBlock: bigint; queued: readonly bigint[]; seen: readonly bigint[]; examined: number; owned: number; logCount: number }>;
export type TestnetLibrary = Readonly<{ inventory: TestnetInventory; tokenIds: readonly string[]; nextCursor: number | null; hiddenCount: number; search: Search }>;
async function assertChain(client: Client, signal: AbortSignal) {
  signal.throwIfAborted();
  if (await client.getChainId() !== 46630) throw new Error('Connect to Robinhood Testnet to choose your test Friends.');
  signal.throwIfAborted();
}
function nonexistentToken(error: unknown) {
  let next = error;
  for (let depth = 0; next && typeof next === 'object' && depth < 8; depth++) {
    const value = next as { data?: unknown; cause?: unknown };
    if (typeof value.data === 'string' && /^0x7e273289[0-9a-f]{64}$/i.test(value.data)) return true;
    if (value.data && typeof value.data === 'object' && (value.data as { errorName?: string }).errorName === 'ERC721NonexistentToken') return true;
    next = value.cause;
  }
  return false;
}

/** Begin a pinned snapshot. Transfer history and NFT metadata load progressively. */
export async function discoverTestnetInventory(client: Client, account: Address, collection: 0 | 1, signal: AbortSignal): Promise<TestnetInventory> {
  if (!validAccount(account) || ![0, 1].includes(collection)) throw new Error('Choose a valid wallet and test collection.');
  await assertChain(client, signal);
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  signal.throwIfAborted();
  if (typeof blockNumber !== 'bigint' || blockNumber < START) throw new Error('Testnet collection history is not available yet.');
  const balance = await client.readContract({ address: address(collection), abi: ABI, functionName: 'balanceOf', args: [account], blockNumber });
  signal.throwIfAborted();
  if (typeof balance !== 'bigint' || balance < 0n || balance > 10_000n) throw new Error('This test collection balance exceeds the supported limit.');
  await assertChain(client, signal);
  return Object.freeze({ account, collection, blockNumber, balance });
}

/** Load up to eight playable Friends, with four NFT checks in flight. Incoming
 * transfers are candidates only; ownerOf at the pinned block is the authority.
 * Finding the pinned balance proves completion without scanning later history.
 * Network failures never become empty or missing-NFT results.
 */
export async function readTestnetLibraryPage(client: Client, inventory: TestnetInventory, signal: AbortSignal,
  previous?: TestnetLibrary): Promise<TestnetLibrary> {
  if (previous && previous.inventory !== inventory) throw new Error('Test Friend selection changed. Refresh your Friends.');
  if (previous?.nextCursor === null) return previous;
  await assertChain(client, signal);
  const search = previous?.search;
  let nextBlock = search?.nextBlock ?? START, examined = search?.examined ?? 0, owned = search?.owned ?? 0;
  let hiddenCount = previous?.hiddenCount ?? 0, logCount = search?.logCount ?? 0;
  let historyReads = 0, candidateReads = 0;
  const seen = new Set(search?.seen ?? []), queued = [...(search?.queued ?? [])], added: string[] = [];
  while (BigInt(owned) < inventory.balance && added.length < 8 && candidateReads < 32) {
    signal.throwIfAborted();
    if (!queued.length) {
      if (nextBlock > inventory.blockNumber) throw new Error('Test Friend history is incomplete. Refresh, or enter your Friend ID manually.');
      // Yield regular progress instead of sending hundreds of log requests at once.
      if (historyReads >= 8) break;
      const fromBlock = nextBlock, end = fromBlock + TESTNET_HISTORY_RANGE - 1n;
      const toBlock = end < inventory.blockNumber ? end : inventory.blockNumber;
      const logs = await client.getLogs({ address: address(inventory.collection), event: TRANSFER, strict: true,
        fromBlock, toBlock, args: { to: inventory.account } });
      signal.throwIfAborted(); historyReads++; logCount += logs.length;
      if (logCount > 100_000) throw new Error('Test Friend transfer history exceeds the supported limit.');
      const positions = new Map<string, { from: Address; to: Address; id: bigint }>();
      for (const log of logs) {
        const { from, to, tokenId } = log.args;
        if (!same(log.address, address(inventory.collection)) || log.removed || typeof log.blockNumber !== 'bigint'
          || log.blockNumber < fromBlock || log.blockNumber > toBlock || log.logIndex === null || !Number.isSafeInteger(log.logIndex) || log.logIndex < 0
          || !isAddress(from) || !isAddress(to) || typeof tokenId !== 'bigint' || tokenId <= 0n || tokenId >= (1n << 256n)
          || !same(to, inventory.account)) throw new Error('Test Friend transfer history is invalid. Refresh your Friends.');
        const key = `${log.blockNumber}:${log.logIndex}`, previousLog = positions.get(key);
        if (previousLog && (previousLog.id !== tokenId || !same(previousLog.from, from) || !same(previousLog.to, to))) {
          throw new Error('Test Friend transfer history is inconsistent. Refresh your Friends.');
        }
        positions.set(key, { from, to, id: tokenId });
        if (!seen.has(tokenId)) { seen.add(tokenId); queued.push(tokenId); }
      }
      nextBlock = toBlock + 1n;
      continue;
    }
    const candidates = queued.splice(0, Math.min(4, 8 - added.length, 32 - candidateReads));
    const group = await Promise.all(candidates.map(async id => {
      let owner: unknown;
      try { owner = await client.readContract({ address: address(inventory.collection), abi: ABI, functionName: 'ownerOf', args: [id], blockNumber: inventory.blockNumber }); }
      catch (error) { signal.throwIfAborted(); if (nonexistentToken(error)) return { owned: false, id: null }; throw error; }
      signal.throwIfAborted();
      if (!validAccount(owner)) throw new Error('Invalid test Friend owner. Refresh your Friends.');
      if (!same(owner, inventory.account)) return { owned: false, id: null };
      if (inventory.collection === 0) {
        const generation = await client.readContract({ address: address(0), abi: ABI, functionName: 'generation', args: [id], blockNumber: inventory.blockNumber });
        signal.throwIfAborted();
        if (typeof generation !== 'bigint' || generation < 0n) throw new Error('Invalid test Friend generation.');
        if (!generation) return { owned: true, id: null };
      }
      return { owned: true, id: String(id) };
    }));
    candidateReads += candidates.length; examined += candidates.length;
    for (const item of group) {
      if (item.owned) { owned++; if (item.id === null) hiddenCount++; }
      if (item.id !== null) added.push(item.id);
    }
    if (BigInt(owned) > inventory.balance) throw new Error('Test Friend ownership is inconsistent with its pinned balance. Refresh your Friends.');
  }
  await assertChain(client, signal);
  const complete = BigInt(owned) === inventory.balance;
  return Object.freeze({ inventory, tokenIds: Object.freeze([...(previous?.tokenIds ?? []), ...added]),
    hiddenCount, nextCursor: complete ? null : examined,
    search: Object.freeze({ nextBlock, queued: Object.freeze(queued), seen: Object.freeze([...seen]), examined, owned, logCount }) });
}
