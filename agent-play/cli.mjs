#!/usr/bin/env node
import { build } from 'esbuild';
import { publicTestnetSources } from '../scripts/public-testnet-sources.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repository = resolve(here, '..');
let output;
try {
  output = await mkdtemp(join(tmpdir(), 'rare-rush-agent-cli-'));
  const bundle = join(output, 'cli.mjs');
  await build({ entryPoints: [resolve(here, 'cli.ts')], outfile: bundle, bundle: true,
    platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
    plugins: [publicTestnetSources(repository)],
    banner: { js: "import { createRequire as agentCreateRequire } from 'node:module'; const require = agentCreateRequire(import.meta.url);" } });
  const { runCli } = await import(pathToFileURL(bundle).href);
  process.exitCode = await runCli(process.argv.slice(2), { directory: resolve(here, 'data/jobs') });
} catch {
  process.stdout.write(JSON.stringify({ version: 1, status: 'error', code: 'CLI_UNAVAILABLE',
    message: 'The headless CLI could not start. Use the repository’s installed dependencies and Node 22.18 or newer.' }) + '\n');
  process.exitCode = 1;
} finally {
  if (output) await rm(output, { recursive: true, force: true });
}
