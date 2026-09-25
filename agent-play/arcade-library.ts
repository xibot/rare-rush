import { createPublicClient, custom, type Address } from 'viem';
import { readOwnedFriends } from '@rarefriends/friendsdk/owned';
import { createGenerationSpriteReader, spriteFrame } from '@rarefriends/friendsdk/sprites';
import { readOwnedGenesis, readGenesisPortrait } from '../games/rare-rush/genesis/identity.ts';
import { ARCADE_CHAIN_ID, type ArcadeProvider } from './arcade.ts';

export type ArcadeChoice = Readonly<{ tokenId: string; label: string }>;
export type ArcadeLibrary = Readonly<{ friends: readonly ArcadeChoice[]; hiddenCount: number }>;

/** A picker is a read-only snapshot. Starting a run still verifies ownership afresh. */
async function withPickerClient<T>(provider: ArcadeProvider, account: Address, signal: AbortSignal,
  read: (client: ReturnType<typeof createPublicClient>, active: AbortSignal) => Promise<T>): Promise<T> {
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
    if (!['eth_accounts', 'eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_getLogs'].includes(args.method)) {
      throw new Error('The Friend picker only supports read-only requests.');
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
      const client = createPublicClient({ cacheTime: 0, transport: custom({ request }, { retryCount: 0 }) });
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
  signal: AbortSignal): Promise<ArcadeLibrary> {
  return withPickerClient(provider, account, signal, async (client, active) => {
    const result = collection === 1
      ? await readOwnedGenesis(client, account, { signal: active })
      : await readOwnedFriends(client, account, { signal: active });
    return { friends: result.friends.map(friend => ({ tokenId: String(friend.id),
      label: `${collection === 1 ? 'Genesis' : 'Generations'} #${friend.id}` })),
      hiddenCount: 'hiddenCount' in result && typeof result.hiddenCount === 'number' ? result.hiddenCount : 0 };
  });
}

/** Artwork is decorative and cannot authorize a run. */
export async function loadArcadePortrait(provider: ArcadeProvider, account: Address, collection: 0 | 1,
  tokenId: string, signal: AbortSignal): Promise<string> {
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
  });
}
