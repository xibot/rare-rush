import { decodeGenerationSprites, type GenerationSpriteManifest } from '@rarefriends/friendsdk/sprites';
import cachedArt from '../landing/preview-art.json';

// One locally cached public portrait from each family. These are sample artwork,
// never an ownership claim or a live wallet/registry request.
const SAMPLE_INDICES = [0, 1, 3, 4, 5, 6];

export const SAMPLE_FRIENDS = SAMPLE_INDICES.map(index => {
  const source = cachedArt.friends[index];
  return {
    label: `Sample Friend #${source.tokenId}`,
    sprites: decodeGenerationSprites(
      BigInt(source.tokenId), source.familyId, source.seed, source.frames.map(BigInt),
      cachedArt.provenance.manifest as GenerationSpriteManifest,
    ),
  };
});
