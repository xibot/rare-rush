import { readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const app = fileURLToPath(new URL('../', import.meta.url));
const repo = path.dirname(app);
const output = path.join(app, 'generated');
// A local rehearsal uses predicted CREATE addresses. Never upload those as a
// live Vercel release until the three wallet operations are independently verified.
if (process.env.VERCEL === '1') {
  const deployment = JSON.parse(await readFile(path.join(app, 'src/shared/deployment.json'), 'utf8'));
  if (deployment.status !== 'verified' || deployment.deploymentVersion !== 'testnet-v2') {
    throw new Error('Testnet V2 contracts are not verified. Finish wallet deployment and activate-v2 before publishing.');
  }
}
const files = [
  'games/rare-rush/public-runs.ts', 'shared/replay-publication.ts',
  'shared/site-footer.ts', 'shared/site-footer.css',
  'games/rare-rush/engine.ts', 'games/rare-rush/difficulty.ts',
  ...['engine.ts', 'DirectionScene.tsx', 'presentation.ts', 'VerticalWorld.tsx', 'TrackGate.tsx', 'transition-motion.ts'].map(name => `games/rare-rush/twist/${name}`),
  'games/rare-rush/WorldArt.tsx', 'games/rare-rush/RunnerArt.tsx', 'games/rare-rush/CanonicalArt.tsx',
  'games/rare-rush/genesis/GenesisRunnerSprite.tsx', 'games/rare-rush/genesis/bodies.ts',
  'games/rare-rush/genesis/body-data.json', 'games/rare-rush/landing/preview-art.json',
  'infra/testnet/src/verifier-core.ts', 'infra/testnet/src/replay.ts', 'infra/testnet/src/protocol.ts', 'infra/testnet/src/chain.mjs',
  ...['RareRushGame', 'RareRushToken', 'TestRF', 'TestFriends'].map(name => `infra/testnet/artifacts/${name}.json`),
];
const hash = data => createHash('sha256').update(data).digest('hex');
const expectedVersion = '0x907ff2967abdd97cc172f53c0c69fbcd17f22fcf4ece263e5846bf2973a3accb';
const expectedProtocol = 'rare-rush-input-v2';
async function verifyEngine(root) {
  const { ENGINE_SOURCE_PATHS, PROTOCOL_VERSION, engineVersionFromSources } = await import(pathToFileURL(path.join(root, 'infra/testnet/src/protocol.ts')).href);
  if (PROTOCOL_VERSION !== expectedProtocol) throw new Error('Unsupported shared replay protocol.');
  const entries = await Promise.all(ENGINE_SOURCE_PATHS.map(async file => [file, await readFile(path.join(root, 'games/rare-rush', file), 'utf8')]));
  if (engineVersionFromSources(Object.fromEntries(entries)) !== expectedVersion) throw new Error('Engine differs from the approved Testnet V2 source pin. Do not publish this build.');
}
let sourcePresent = true;
try { await access(path.join(repo, files[0])); } catch { sourcePresent = false; }
if (sourcePresent) {
  await verifyEngine(repo);
  // Only these public files are allowed into the standalone Vercel upload.
  // No recursive infrastructure copies, environment files or operator config.
  const contents = await Promise.all(files.map(async file => [file, await readFile(path.join(repo, file))]));
  contents.push(['genesis-portrait.json', await readFile(path.join(repo, 'drafts/genesis-prototype/portrait.json'))]);
  contents.push(['vendor/rarefriends-friendsdk-0.1.2.tgz', await readFile(path.join(repo, 'rarefriends-friendsdk-0.1.2.tgz'))]);
  contents.push(['engine-version.ts', Buffer.from(`import type { Hex } from 'viem';\nexport const ENGINE_VERSION = '${expectedVersion}' as Hex;\n`)]);
  await rm(output, { recursive: true, force: true });
  const manifest = { engineVersion: expectedVersion, protocolVersion: expectedProtocol, files: {} };
  for (const [file, data] of contents) {
    const target = path.join(output, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    manifest.files[file] = hash(data);
  }
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Staged ${contents.length} allowlisted public shared files. Engine matches the approved Testnet V2 source pin.`);
} else {
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  if (manifest.engineVersion !== expectedVersion || manifest.protocolVersion !== expectedProtocol) throw new Error('Staged engine/protocol version mismatch.');
  for (const [file, digest] of Object.entries(manifest.files)) {
    if (file.includes('..') || path.isAbsolute(file) || hash(await readFile(path.join(output, file))) !== digest) throw new Error('Staged file integrity mismatch.');
  }
  await verifyEngine(output);
  console.log('Verified standalone shared package and approved Testnet V2 engine hash.');
}
