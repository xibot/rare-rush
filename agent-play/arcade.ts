import { createPublicClient, custom, isAddress, zeroAddress, type Address } from 'viem';
import { readGenerationEligibility } from '@rarefriends/friendsdk/identity';
import { createGenerationSpriteReader, GENERATION_SPRITE_MANIFEST, type GenerationSprites } from '@rarefriends/friendsdk/sprites';
import { createFriendWalletSession, type FriendWalletProvider, type FriendWalletSession } from '@rarefriends/friendsdk/wallet';
import { readGenesisIdentity, GENESIS_DEPLOYMENT } from '../games/rare-rush/genesis/identity.ts';
import { DEFAULT_BODY_ID } from '../games/rare-rush/genesis/bodies.ts';

export const ARCADE_CHAIN_ID = 4663;
export type ArcadeProvider = Pick<FriendWalletProvider, 'request'> & Partial<Pick<FriendWalletProvider, 'on' | 'removeListener'>>;

export type ArcadeFriend = Readonly<{
  collection: 0 | 1;
  tokenId: string;
  owner: Address;
  chainId: 4663;
  blockNumber: string;
  label: string;
  portraitUrl?: string;
  bodyId?: string;
  sprites?: GenerationSprites;
}>;

let walletSession: FriendWalletSession | undefined;

/** Trusted page only. The SDK owns wallet discovery, connection, and invalidation. */
export function getArcadeSession(): FriendWalletSession {
  walletSession ??= createFriendWalletSession();
  return walletSession;
}

/** Call from a connect button. Account permission only; never signs or spends. */
export async function connectArcade() {
  const session = getArcadeSession();
  const snapshot = await session.connect();
  const provider = session.getProvider();
  if (!snapshot.account || !provider || snapshot.chainId === null) {
    throw new Error(snapshot.error || 'Connect a browser wallet to load your real Rare Friend.');
  }
  return Object.freeze({ account: snapshot.account, chainId: snapshot.chainId, provider });
}

function tokenNumber(tokenId: string): bigint {
  if (!/^[1-9]\d{0,77}$/.test(tokenId)) throw new Error('Enter a positive decimal token ID.');
  const value = BigInt(tokenId);
  if (value >= 1n << 256n) throw new Error('Token ID is too large.');
  return value;
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

async function assertConnection(provider: ArcadeProvider, account: Address) {
  const [chain, accounts] = await Promise.all([
    provider.request({ method: 'eth_chainId' }),
    provider.request({ method: 'eth_accounts' }),
  ]);
  if (typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== BigInt(ARCADE_CHAIN_ID)) {
    throw new Error('Switch your wallet to Robinhood mainnet (4663), then load your Friend again.');
  }
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || !sameAddress(accounts[0], account)) {
    throw new Error('The connected wallet changed. Connect and load your Friend again.');
  }
}

/**
 * Fresh ownership and real artwork for one explicit token. Call before every
 * Arcade start. No scanning, cached permission, transaction, or private RPC key.
 * The host must stop a running session on account/network/selection changes.
 */
export async function loadArcadeFriend(
  provider: ArcadeProvider,
  account: Address,
  collection: 0 | 1,
  tokenId: string,
): Promise<ArcadeFriend> {
  if (!isAddress(account) || sameAddress(account, zeroAddress)) throw new Error('Connect a valid wallet first.');
  if (collection !== 0 && collection !== 1) throw new Error('Choose Genesis or Generations.');
  const id = tokenNumber(tokenId);
  let invalidated = false;
  const invalidate = () => { invalidated = true; };
  const events = ['accountsChanged', 'chainChanged', 'disconnect'] as const;
  const listens = typeof provider.on === 'function' && typeof provider.removeListener === 'function';
  if (listens) for (const event of events) provider.on!(event, invalidate);
  const assertActive = () => {
    if (invalidated) throw new Error('The wallet connection changed while loading. Load your Friend again.');
  };
  try {
    await assertConnection(provider, account);
    assertActive();
    // A public client over the selected wallet's RPC keeps all reads on its
    // actual network. This boundary deliberately accepts only read methods.
    const client = createPublicClient({
      cacheTime: 0,
      transport: custom({ request: async ({ method, params }) => {
        if (!['eth_chainId', 'eth_blockNumber', 'eth_call'].includes(method)) {
          throw new Error('The Arcade identity adapter only supports read-only RPC methods.');
        }
        assertActive();
        const result = await provider.request({ method, params });
        assertActive();
        return result;
      } }, { retryCount: 0 }),
    });
    let friend: ArcadeFriend;
    if (collection === 1) {
      const identity = await readGenesisIdentity(client, id, account);
      friend = Object.freeze({ collection, tokenId: identity.tokenId, owner: identity.owner,
        chainId: GENESIS_DEPLOYMENT.chainId, blockNumber: identity.blockNumber,
        label: identity.label, portraitUrl: identity.image, bodyId: DEFAULT_BODY_ID });
    } else {
      const eligibility = await readGenerationEligibility(client, id, account, GENERATION_SPRITE_MANIFEST);
      assertActive();
      if (eligibility.ownedByPlayer !== true) throw new Error('This Generations Friend is not owned by the connected wallet.');
      if (eligibility.eligible !== true) throw new Error('This Generations Friend is generation 0. Arcade requires a hardwired Friend (generation 1 or higher).');
      const sprites = await createGenerationSpriteReader(client, GENERATION_SPRITE_MANIFEST).read(id);
      friend = Object.freeze({ collection, tokenId: String(id), owner: eligibility.owner,
        chainId: ARCADE_CHAIN_ID, blockNumber: String(eligibility.blockNumber),
        label: `Generations #${id} · ${sprites.familyName}`, sprites });
    }
    assertActive();
    await assertConnection(provider, account);
    assertActive();
    return friend;
  } finally {
    if (listens) for (const event of events) provider.removeListener!(event, invalidate);
  }
}
