import { decodeGenerationSprites, type GenerationSpriteManifest } from '@rarefriends/friendsdk/sprites';
import cachedArt from '../../generated/games/rare-rush/landing/preview-art.json' with { type: 'json' };
import genesisPortrait from '../../generated/genesis-portrait.json' with { type: 'json' };
import { GENESIS_BODIES } from '../../generated/games/rare-rush/genesis/bodies.ts';

// Canonical cached artwork is cosmetic. A test NFT ID never represents mainnet ownership.
const friends = cachedArt.friends.map(friend => decodeGenerationSprites(
  BigInt(friend.tokenId), friend.familyId, friend.seed, friend.frames.map(BigInt),
  cachedArt.provenance.manifest as GenerationSpriteManifest,
));
function cosmeticIndex(value: string, count: number) {
  let hash = 2166136261;
  for (const letter of value) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
  return (hash >>> 0) % count;
}
export function testRunArt(collection: 0 | 1, tokenId: string | bigint, runId: string | bigint) {
  return {
    sprites: friends[cosmeticIndex(`test-generations:${tokenId}`, friends.length)],
    bodyId: GENESIS_BODIES[cosmeticIndex(`test-genesis:${tokenId}:run:${runId}`, GENESIS_BODIES.length)].id,
    portraitUrl: genesisPortrait.image,
    label: `TEST ${collection === 1 ? 'GENESIS' : 'GENERATIONS'} #${tokenId}`,
  };
}
