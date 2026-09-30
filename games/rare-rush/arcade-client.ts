import { createPublicClient, http, isAddress, zeroAddress, type PublicClient } from 'viem';
import { GENERATION_SPRITE_MANIFEST } from '@rarefriends/friendsdk/sprites';
import { GENESIS_DEPLOYMENT } from './genesis/identity.ts';

// Robinhood's public RPC rejects eth_getLogs ranges larger than ten million
// blocks, including indexed owner queries. Never replace those with a scan.
export const ARCADE_LOG_BLOCK_LIMIT = 10_000_000n;
const MAX_LOG_PAGES = 256;
const MAX_TRANSFER_LOGS = 100_000;
const HISTORY_TIMEOUT_MS = 25_000;
type LogQuery = Parameters<PublicClient['getLogs']>[0];

/** Keep the SDK's discovery and ownership checks; adapt only its history reads. */
export function withArcadeHistory<T extends Pick<PublicClient, 'getLogs'>>(client: T, signal?: AbortSignal): T {
  return { ...client, getLogs: async (query: LogQuery = {}) => {
    const { address, fromBlock, toBlock, event } = query;
    const args = query.args as { from?: unknown; to?: unknown } | undefined;
    const owner = args?.from ?? args?.to;
    if (typeof address !== 'string' || ![GENERATION_SPRITE_MANIFEST.generations, GENESIS_DEPLOYMENT.contract]
      .some(contract => contract.toLowerCase() === address.toLowerCase()) ||
      event?.name !== 'Transfer' || event.inputs.length !== 3 ||
      !event.inputs.every((input, index) => input.indexed && input.name === ['from', 'to', 'tokenId'][index] && input.type === ['address', 'address', 'uint256'][index]) ||
      typeof owner !== 'string' || !isAddress(owner) || owner === zeroAddress ||
      typeof fromBlock !== 'bigint' || typeof toBlock !== 'bigint' || fromBlock < 0n || toBlock < fromBlock) {
      throw new Error('Arcade history requires a pinned, owner-filtered Friend transfer query.');
    }
    const firstBlock = fromBlock, lastBlock = toBlock;
    const pages = Number((lastBlock - firstBlock) / ARCADE_LOG_BLOCK_LIMIT + 1n);
    if (pages > MAX_LOG_PAGES) throw new Error('This Friend history is too large to load. Please retry with an indexed provider.');
    let next = 0, logCount = 0, stopped = false;
    const results: Awaited<ReturnType<PublicClient['getLogs']>>[] = new Array(pages);
    let timer: ReturnType<typeof setTimeout>;
    let cancel = () => {};
    const deadline = new Promise<never>((_, reject) => {
      cancel = () => { stopped = true; reject(signal?.reason ?? new Error('Friend history took too long to load. Please retry.')); };
      timer = setTimeout(cancel, HISTORY_TIMEOUT_MS);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
    });
    async function worker() {
      while (!stopped) {
        signal?.throwIfAborted();
        const page = next++;
        if (page >= pages) return;
        const start = firstBlock + BigInt(page) * ARCADE_LOG_BLOCK_LIMIT;
        const end = start + ARCADE_LOG_BLOCK_LIMIT - 1n;
        const logs = await client.getLogs({ ...query, fromBlock: start, toBlock: end < lastBlock ? end : lastBlock } as LogQuery);
        if (stopped) return;
        logCount += logs.length;
        if (logCount > MAX_TRANSFER_LOGS) throw new Error('This account’s Friend transfer history exceeds the discovery limit.');
        results[page] = logs;
      }
    }
    try {
      // Two workers per direction: at most four requests during SDK discovery.
      await Promise.race([Promise.all(Array.from({ length: Math.min(2, pages) }, worker)), deadline]);
      return results.flat();
    } finally {
      stopped = true;
      clearTimeout(timer!);
      signal?.removeEventListener('abort', cancel);
    }
  } } as T;
}

export function createArcadePublicClient() {
  return withArcadeHistory(createPublicClient({ cacheTime: 0, pollingInterval: 1_000,
    transport: http(GENERATION_SPRITE_MANIFEST.rpcUrl, { retryCount: 1, timeout: 8_000 }) }));
}
