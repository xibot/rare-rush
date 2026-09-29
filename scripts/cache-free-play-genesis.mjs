/** Refresh public sample portraits. Read-only: no wallet, signing, or ownership claim. */
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createPublicClient, http } from 'viem';
import { GENESIS_DEPLOYMENT, readGenesisPortrait } from '../games/rare-rush/genesis/identity.ts';

const client = createPublicClient({
  cacheTime: 0,
  transport: http(GENESIS_DEPLOYMENT.rpcUrl, { timeout: 15_000, retryCount: 2 }),
});
if (await client.getChainId() !== GENESIS_DEPLOYMENT.chainId) throw new Error('Unexpected Genesis network.');
const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
const pinnedClient = { ...client, getBlockNumber: async () => blockNumber };
const tokenIds = [1n, 2n, 3n, 4n, 5n, 6n];
const friends = [];
const hashes = new Set();
for (const tokenId of tokenIds) {
  // The existing reader validates chain, encoding, size and static self-contained SVG content.
  const image = await readGenesisPortrait(pinnedClient, tokenId);
  const svg = Buffer.from(image.split(',')[1], 'base64').toString('utf8');
  const sha256 = createHash('sha256').update(svg).digest('hex');
  if (hashes.has(sha256)) throw new Error(`Duplicate Genesis portrait for ${tokenId}.`);
  hashes.add(sha256);
  friends.push({ tokenId: tokenId.toString(), image, sha256 });
  console.log(`Validated Genesis #${tokenId}: ${svg.match(/^<svg[^>]*>/)?.[0]}, ${Buffer.byteLength(svg)} SVG bytes`);
}
const result = {
  schemaVersion: 1,
  provenance: {
    fetchedAt: new Date().toISOString(),
    chainId: GENESIS_DEPLOYMENT.chainId,
    contract: GENESIS_DEPLOYMENT.contract,
    rpcUrl: GENESIS_DEPLOYMENT.rpcUrl,
    blockNumber: blockNumber.toString(),
    tokenIds: tokenIds.map(String),
    method: 'tokenURI(uint256) at one pinned Robinhood mainnet block; validated by readGenesisPortrait',
    note: 'Canonical public static front portraits bundled for no-wallet sample play. These samples do not assert ownership, eligibility, or wallet authority. Runtime use makes no RPC requests.',
  },
  friends,
};
await writeFile(new URL('../games/rare-rush/free-play/genesis-samples.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
console.log(`Cached ${friends.length} distinct Genesis portraits at block ${blockNumber}.`);
