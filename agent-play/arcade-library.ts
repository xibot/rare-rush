import { type Address } from 'viem';
import { createGenerationSpriteReader, spriteFrame } from '@rarefriends/friendsdk/sprites';
import { readGenesisPortrait } from '../games/rare-rush/genesis/identity.ts';
import { createArcadePublicClient, withArcadeHistory, type ArcadeReadClient } from '../games/rare-rush/arcade-client.ts';
import { discoverArcadeInventory, readArcadeInventoryPage, type ArcadeInventory } from '../games/rare-rush/arcade-inventory.ts';
import { ARCADE_CHAIN_ID, type ArcadeProvider } from './arcade.ts';

export type ArcadeChoice = Readonly<{ tokenId: string; label: string }>;
export type ArcadeLibrary = Readonly<{ friends: readonly ArcadeChoice[]; hiddenCount: number; inventory: ArcadeInventory; nextCursor: number | null }>;

/** A picker is a read-only snapshot. Starting a run still verifies ownership afresh. */
async function withPickerClient<T>(provider: ArcadeProvider, account: Address, signal: AbortSignal,
  read: (client: ArcadeReadClient, active: AbortSignal) => Promise<T>, readClient?: ArcadeReadClient): Promise<T> {
  const controller = new AbortController();
  const active = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(25_000)]);
  const events = ['accountsChanged', 'chainChanged', 'disconnect'] as const;
  const changed = () => controller.abort(new Error('Your wallet changed. Reconnect to load its Friends.'));
  const listens = !!provider.on && !!provider.removeListener;
  if (listens) for (const event of events) provider.on!(event, changed);
  let cancel = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => reject(active.reason);
    active.addEventListener('abort', cancel, { once: true });
    if (active.aborted) cancel();
  });
  const request: ArcadeProvider['request'] = async args => {
    active.throwIfAborted();
    if (!['eth_accounts', 'eth_chainId'].includes(args.method)) {
      throw new Error('The Friend picker only uses the wallet to check its connection.');
    }
    const result = await provider.request(args);
    active.throwIfAborted();
    return result;
  };
  const checkWallet = async () => {
    const [chain, accounts] = await Promise.all([request({ method: 'eth_chainId' }), request({ method: 'eth_accounts' })]);
    if (typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== BigInt(ARCADE_CHAIN_ID)) throw new Error('Switch your wallet to Robinhood mainnet (4663) to see your Friends.');
    if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== account.toLowerCase()) {
      throw new Error('Your wallet changed. Reconnect to load its Friends.');
    }
  };
  try {
    return await Promise.race([cancelled, (async () => {
      await checkWallet();
      const client = readClient ? withArcadeHistory(readClient, active) : createArcadePublicClient({ signal: active });
      const result = await read(client, active);
      await checkWallet();
      return result;
    })()]);
  } finally {
    active.removeEventListener('abort', cancel);
    if (listens) for (const event of events) provider.removeListener!(event, changed);
    controller.abort();
  }
}

export async function loadArcadeLibrary(provider: ArcadeProvider, account: Address, collection: 0 | 1,
  signal: AbortSignal, readClient?: ArcadeReadClient): Promise<ArcadeLibrary> {
  return withPickerClient(provider, account, signal, async (client, active) => {
    const inventory = await discoverArcadeInventory(client, account, collection, { signal: active });
    const page = await readArcadeInventoryPage(client, inventory, { signal: active });
    return { friends: page.friends.map(friend => ({ tokenId: String(friend.id),
      label: `${collection === 1 ? 'Genesis' : 'Generations'} #${friend.id}` })),
      hiddenCount: page.hiddenCount, inventory, nextCursor: page.nextCursor };
  }, readClient);
}

/** Continue a pinned inventory without downloading its transfer history again. */
export async function loadMoreArcadeFriends(provider: ArcadeProvider, account: Address, collection: 0 | 1,
  library: ArcadeLibrary, signal: AbortSignal, readClient?: ArcadeReadClient): Promise<ArcadeLibrary> {
  if (library.inventory.account.toLowerCase() !== account.toLowerCase() || library.inventory.collection !== collection) {
    throw new Error('Your wallet or collection changed. Refresh your Friends.');
  }
  if (library.nextCursor === null) return library;
  return withPickerClient(provider, account, signal, async (client, active) => {
    const page = await readArcadeInventoryPage(client, library.inventory, { signal: active, cursor: library.nextCursor! });
    return { ...library, friends: [...library.friends, ...page.friends.map(friend => ({ tokenId: String(friend.id),
      label: `${collection === 1 ? 'Genesis' : 'Generations'} #${friend.id}` }))],
      hiddenCount: library.hiddenCount + page.hiddenCount, nextCursor: page.nextCursor };
  }, readClient);
}

/** Artwork is decorative and cannot authorize a run. */
export async function loadArcadePortrait(provider: ArcadeProvider, account: Address, collection: 0 | 1,
  tokenId: string, signal: AbortSignal, readClient?: ArcadeReadClient): Promise<string> {
  return withPickerClient(provider, account, signal, async (client, active) => {
    if (collection === 1) return readGenesisPortrait(client, BigInt(tokenId), { signal: active });
    const sprites = await createGenerationSpriteReader(client).read(BigInt(tokenId));
    const rows = spriteFrame(sprites, 'down', false, 0).frame.rows;
    const pixels: string[] = [], halo: string[] = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const square = `M${x} ${y}h1v1h-1z`;
      if (rows[y][x] === '#') pixels.push(square);
      if (rows.slice(Math.max(0, y - 1), y + 2).some(row => row.slice(Math.max(0, x - 1), x + 2).includes('#'))) halo.push(square);
    }
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><path fill="#fff" d="${halo.join('')}"/><path fill="#000" d="${pixels.join('')}"/></svg>`)}`;
  }, readClient);
}
