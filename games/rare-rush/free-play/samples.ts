import { decodeGenerationSprites, type GenerationSprites, type GenerationSpriteManifest } from '@rarefriends/friendsdk/sprites';
import cachedArt from '../landing/preview-art.json';
import genesisArt from './genesis-samples.json';

export type FreePlayFriend = {
  collection: 'generations'; tokenId: string; label: string; sprites: GenerationSprites;
} | {
  collection: 'genesis'; tokenId: string; label: string; portraitUrl: string;
};

// One locally cached public portrait from each family. These are sample artwork,
// never an ownership claim or a live wallet/registry request.
const SAMPLE_INDICES = [0, 1, 3, 4, 5, 6];

export const SAMPLE_GENERATIONS: FreePlayFriend[] = SAMPLE_INDICES.map(index => {
  const source = cachedArt.friends[index];
  return {
    collection: 'generations', tokenId: source.tokenId,
    label: `Sample Friend #${source.tokenId}`,
    sprites: decodeGenerationSprites(
      BigInt(source.tokenId), source.familyId, source.seed, source.frames.map(BigInt),
      cachedArt.provenance.manifest as GenerationSpriteManifest,
    ),
  };
});

export const SAMPLE_GENESIS: FreePlayFriend[] = genesisArt.friends.map(source => ({
  collection: 'genesis', tokenId: source.tokenId, label: `Sample Genesis #${source.tokenId}`, portraitUrl: source.image,
}));

export const SAMPLE_FRIENDS = [...SAMPLE_GENESIS, ...SAMPLE_GENERATIONS];
