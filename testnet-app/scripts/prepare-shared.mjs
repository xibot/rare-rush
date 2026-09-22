import { readFile, writeFile, mkdir, copyFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const app = fileURLToPath(new URL('../', import.meta.url));
const repo = path.dirname(app);
const output = path.join(app, 'generated');
const files = [
  'games/rare-rush/engine.ts', 'games/rare-rush/difficulty.ts',
  'games/rare-rush/WorldArt.tsx', 'games/rare-rush/RunnerArt.tsx', 'games/rare-rush/CanonicalArt.tsx',
  'games/rare-rush/genesis/GenesisRunnerSprite.tsx', 'games/rare-rush/genesis/bodies.ts',
  'games/rare-rush/genesis/body-data.json', 'games/rare-rush/landing/preview-art.json',
  'infra/testnet/src/verifier-core.ts', 'infra/testnet/src/replay.ts', 'infra/testnet/src/protocol.ts', 'infra/testnet/src/chain.mjs',
  ...['RareRushGame', 'RareRushToken', 'TestRF', 'TestFriends'].map(name => `infra/testnet/artifacts/${name}.json`),
];
const hash = data => createHash('sha256').update(data).digest('hex');
const expectedVersion = '0xd907fa6f48be2aff2712c2e254943dc8afa749e7bfb5d9b28dc865c3a096ba99';
let sourcePresent = true;
try { await access(path.join(repo, files[0])); } catch { sourcePresent = false; }
if (sourcePresent) {
  const require = createRequire(path.join(repo, 'infra/testnet/package.json'));
  const { keccak256, toHex } = require('viem');
  const engine = await readFile(path.join(repo, files[0]), 'utf8');
  const difficulty = await readFile(path.join(repo, files[1]), 'utf8');
  if (keccak256(toHex(`rare-rush-input-v1\n${engine}\n${difficulty}`)) !== expectedVersion) throw new Error('Engine differs from the deployed contract. Do not publish this build.');
  // Only these public files are allowed into the standalone Vercel upload.
  // No recursive infrastructure copies, environment files or operator config.
  const contents = await Promise.all(files.map(async file => [file, await readFile(path.join(repo, file))]));
  contents.push(['genesis-portrait.json', await readFile(path.join(repo, 'drafts/genesis-prototype/portrait.json'))]);
  contents.push(['vendor/rarefriends-friendsdk-0.1.2.tgz', await readFile(path.join(repo, 'rarefriends-friendsdk-0.1.2.tgz'))]);
  contents.push(['engine-version.ts', Buffer.from(`import type { Hex } from 'viem';\nexport const ENGINE_VERSION = '${expectedVersion}' as Hex;\n`)]);
  await rm(output, { recursive: true, force: true });
  const manifest = { engineVersion: expectedVersion, files: {} };
  for (const [file, data] of contents) {
    const target = path.join(output, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    manifest.files[file] = hash(data);
  }
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Staged ${contents.length} allowlisted public shared files. Engine matches deployed game.`);
} else {
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  if (manifest.engineVersion !== expectedVersion) throw new Error('Staged engine version mismatch.');
  for (const [file, digest] of Object.entries(manifest.files)) {
    if (file.includes('..') || path.isAbsolute(file) || hash(await readFile(path.join(output, file))) !== digest) throw new Error('Staged file integrity mismatch.');
  }
  const { keccak256, toHex } = createRequire(path.join(app, 'package.json'))('viem');
  const engine = await readFile(path.join(output, files[0]), 'utf8');
  const difficulty = await readFile(path.join(output, files[1]), 'utf8');
  if (keccak256(toHex(`rare-rush-input-v1\n${engine}\n${difficulty}`)) !== expectedVersion) throw new Error('Staged engine differs from deployed game.');
  console.log('Verified standalone shared package and deployed engine hash.');
}
