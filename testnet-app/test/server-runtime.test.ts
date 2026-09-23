import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import deployment from '../src/shared/deployment.json' with { type: 'json' };
import { ENGINE_VERSION } from '../generated/engine-version.ts';

const app = fileURLToPath(new URL('../', import.meta.url));

function smokeEntrypoints(statusFile: string, verifyFile: string) {
  // Deliberately execute emitted JavaScript, without source TypeScript, loaders,
  // verifier credentials, or network access. Source-only tests hid a production
  // .ts -> .js import mismatch in Vercel's separately emitted server graph.
  const script = `
    import assert from 'node:assert/strict';
    globalThis.fetch = async () => { throw new Error('Runtime smoke test must not use the network'); };
    const status = (await import(${JSON.stringify(pathToFileURL(statusFile).href)})).default;
    const verify = (await import(${JSON.stringify(pathToFileURL(verifyFile).href)})).default;
    assert.equal(typeof status.fetch, 'function');
    assert.equal(typeof verify.fetch, 'function');
    const response = await status.fetch(new Request('https://testnet.rarerush.app/api/status'));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ready, false);
    assert.equal(body.reason, 'not-configured');
    assert.equal(body.chainId, 46630);
    assert.equal(body.game.toLowerCase(), ${JSON.stringify(deployment.contracts.game.toLowerCase())});
    assert.equal(body.engineVersion, ${JSON.stringify(ENGINE_VERSION)});
    assert.equal(body.verifier, null);
    const invalid = await verify.fetch(new Request('https://testnet.rarerush.app/api/verify-run', {
      method: 'POST', headers: { origin: 'https://testnet.rarerush.app', 'content-type': 'application/json' }, body: '{}',
    }));
    assert.equal(invalid.status, 400);
    assert.equal((await verify.fetch(new Request('https://testnet.rarerush.app/api/verify-run'))).status, 405);
    console.log('Compiled status and verify-run entrypoints executed.');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024,
    // Do not inherit NODE_OPTIONS, dotenv preloaders, or operator secrets.
    env: { PATH: process.env.PATH ?? '' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Compiled status and verify-run entrypoints executed/);
}

test('emitted server JavaScript executes both API exports and their complete import graphs', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'rare-rush-server-runtime-'));
  try {
    const configPath = path.join(app, 'tsconfig.json');
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    assert.equal(config.error, undefined);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, app);
    assert.deepEqual(parsed.errors, []);
    // Keep the project's import-extension policy: forcing it here would mask
    // precisely the hosting regression that this test is intended to catch.
    const program = ts.createProgram(['api/status.ts', 'api/verify-run.ts'].map(file => path.join(app, file)), {
      ...parsed.options, noEmit: false, rootDir: app, outDir: output,
      declaration: false, sourceMap: false, inlineSourceMap: false,
    });
    const emitted = program.emit();
    assert.equal(emitted.emitSkipped, false);
    assert.deepEqual(emitted.diagnostics, []);
    await writeFile(path.join(output, 'package.json'), JSON.stringify({ type: 'module' }));
    await symlink(path.join(app, 'node_modules'), path.join(output, 'node_modules'), 'dir');
    assert.equal(existsSync(path.join(output, 'server/runtime.ts')), false);
    assert.equal(existsSync(path.join(output, 'generated/infra/testnet/src/verifier-core.ts')), false);
    smokeEntrypoints(path.join(output, 'api/status.js'), path.join(output, 'api/verify-run.js'));
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

const functionsOutput = process.env.RUSH_FUNCTIONS_OUTPUT ?? path.join(app, '.vercel/output/functions');
const statusConfig = path.join(functionsOutput, 'api/status.func/.vc-config.json');
const verifyConfig = path.join(functionsOutput, 'api/verify-run.func/.vc-config.json');
test('actual Vercel function artifacts execute when a local Vercel build is present', {
  skip: !process.env.RUSH_FUNCTIONS_OUTPUT && !existsSync(statusConfig) && !existsSync(verifyConfig)
    ? 'Run vercel build first, or set RUSH_FUNCTIONS_OUTPUT to its functions directory.' : false,
}, async () => {
  async function entrypoint(configFile: string) {
    const config = JSON.parse(await readFile(configFile, 'utf8')) as { runtime?: string; handler?: string };
    assert.equal(config.runtime, 'nodejs22.x');
    assert.equal(typeof config.handler, 'string');
    const entrypoint = path.resolve(path.dirname(configFile), config.handler!);
    assert.ok(entrypoint.startsWith(`${path.dirname(configFile)}${path.sep}`));
    assert.equal(existsSync(entrypoint), true);
    return entrypoint;
  }
  smokeEntrypoints(await entrypoint(statusConfig), await entrypoint(verifyConfig));
});
