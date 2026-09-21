/** Read-only artwork cache. No wallet, ownership lookup, signing, or game actions. */
import { mkdir, writeFile } from 'node:fs/promises';
import {
  createFriendReader,
  decodeGenerationSprites,
  GENERATION_SPRITE_MANIFEST,
} from '@rarefriends/friendsdk/sprites';

const tokenIds = [1n, 42n, 420n, 1337n, 7730n, 8888n, 2026n, 666n, 1234n];
const reader = createFriendReader();
const friends = [];
for (let offset = 0; offset < tokenIds.length; offset += 3) {
  const sprites = await Promise.all(tokenIds.slice(offset, offset + 3).map((tokenId) => reader.read(tokenId)));
  for (const art of sprites) {
    // Validate all64 frames with the public SDK decoder before caching anything.
    decodeGenerationSprites(art.tokenId, art.familyId, art.seed, art.frames);
    friends.push({
      tokenId: art.tokenId.toString(),
      familyId: art.familyId,
      familyName: art.familyName,
      seed: art.seed,
      frames: art.frames.map((bitmap) => bitmap.toString()),
    });
    console.log(`Read Friend #${art.tokenId}: ${art.familyName}, ${art.frames.length} canonical frames`);
  }
}

const output = new URL('../games/rare-rush/landing/preview-art.json', import.meta.url);
await mkdir(new URL('.', output), { recursive: true });
await writeFile(output, `${JSON.stringify({
  schemaVersion: 1,
  fetchedAt: new Date().toISOString(),
  provenance: {
    sdk: '@rarefriends/friendsdk',
    version: '0.1.2',
    source: 'https://github.com/spokesz/friendsdk/blob/main/src/generation-sprites.ts',
    method: 'createFriendReader().read(tokenId), validated with decodeGenerationSprites',
    manifest: GENERATION_SPRITE_MANIFEST,
    note: 'Canonical public registry artwork for a noninteractive autoplay preview. Artwork does not verify ownership, eligibility, or token mint status. No wallet or economic actions are involved.',
  },
  friends,
}, null, 2)}\n`);
console.log(`Cached ${friends.length} Friends in ${output.pathname}`);
