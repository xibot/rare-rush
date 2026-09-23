import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { privateKeyToAccount } from 'viem/accounts';
import deployment from '../src/shared/deployment.json' with { type: 'json' };
import { ENGINE_VERSION } from '../generated/engine-version.ts';

const app = fileURLToPath(new URL('../', import.meta.url));
// Disposable fixture only. It is used solely with a mocked fetch in child processes.
const fixtureKey = `0x${'11'.repeat(32)}` as const;
const fixtureVerifier = privateKeyToAccount(fixtureKey).address;

function smokeRpcConfiguration(output: string, scenario: string) {
  const script = `
    import assert from 'node:assert/strict';
    import { decodeFunctionData, encodeFunctionResult } from 'viem';
    import { privateKeyToAccount } from 'viem/accounts';
    import { readFileSync } from 'node:fs';
    const scenario = ${JSON.stringify(scenario)};
    const endpoint = 'https://robinhood-testnet.g.alchemy.com/v2/disposable-test-api-key';
    const publicEndpoint = 'https://rpc.testnet.chain.robinhood.com';
    process.env.RUSH_VERIFIER_PRIVATE_KEY = ${JSON.stringify(fixtureKey)};
    if (scenario !== 'default') process.env.RUSH_RPC_URL = scenario === 'malformed' ? 'not-a-url/disposable-test-api-key' : endpoint;
    const abi = JSON.parse(readFileSync(${JSON.stringify(path.join(output, 'generated/infra/testnet/artifacts/RareRushGame.json'))}, 'utf8')).abi;
    const calls = [];
    const methods = [];
    let failProvider = scenario === 'provider-error';
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      assert.equal(new URL(url).href, new URL(scenario === 'default' ? publicEndpoint : endpoint).href);
      if (failProvider) throw new Error('Provider failure at ' + endpoint);
      const raw = input instanceof Request ? await input.clone().text() : String(init.body);
      const body = JSON.parse(raw);
      function reply(request) {
        methods.push(request.method);
        let result;
        if (request.method === 'eth_chainId') result = scenario === 'wrong-chain' ? '0x1' : '0xb626';
        else if (request.method === 'eth_blockNumber') result = '0x64';
        else {
          assert.equal(request.method, 'eth_call');
          assert.equal(request.params[0].to.toLowerCase(), ${JSON.stringify(deployment.contracts.game)});
          assert.equal(request.params[1], '0x62');
          const { functionName } = decodeFunctionData({ abi, data: request.params[0].data });
          const values = {
            verifier: ${JSON.stringify(fixtureVerifier)},
            engineVersion: ${JSON.stringify(ENGINE_VERSION)},
            token: ${JSON.stringify(deployment.contracts.rewardToken)},
            paused: false,
          };
          assert.ok(Object.hasOwn(values, functionName));
          result = encodeFunctionResult({ abi, functionName, result: values[functionName] });
        }
        return { jsonrpc: '2.0', id: request.id, result };
      }
      return Response.json(Array.isArray(body) ? body.map(reply) : reply(body));
    };
    const status = (await import(${JSON.stringify(pathToFileURL(path.join(output, 'api/status.js')).href)})).default;
    const response = await status.fetch(new Request('https://testnet.rarerush.app/api/status'));
    assert.equal(response.status, 200);
    const text = await response.text();
    const body = JSON.parse(text);
    assert.ok(!text.includes('disposable-test-api-key'));
    assert.ok(!text.includes('alchemy.com'));
    if (scenario === 'malformed') {
      assert.equal(body.ready, false);
      assert.equal(body.reason, 'configuration-mismatch');
      assert.equal(calls.length, 0);
    } else if (scenario === 'wrong-chain') {
      assert.equal(body.ready, false);
      assert.equal(body.reason, 'configuration-mismatch');
      assert.ok(calls.length > 0);
      assert.ok(!methods.includes('eth_call'));
    } else if (scenario === 'provider-error') {
      assert.equal(body.ready, false);
      assert.equal(body.reason, 'rpc-unavailable');
      assert.ok(calls.length > 0);
    } else {
      assert.equal(body.ready, true);
      assert.equal(body.reason, 'ready');
      assert.equal(body.verifier, ${JSON.stringify(fixtureVerifier)});
      assert.equal(methods.filter(method => method === 'eth_call').length, 4);
      if (scenario === 'verify-provider-error') {
        // Readiness is cached; exercise a real authenticated verification request
        // that then encounters an upstream error containing the credential URL.
        failProvider = true;
        const account = privateKeyToAccount(${JSON.stringify(fixtureKey)});
        const { createAuthorization, authorizationTypedData } = await import(${JSON.stringify(pathToFileURL(path.join(output, 'src/shared/authorization.js')).href)});
        const replay = { version: 'rare-rush-input-v2', frames: [] };
        const authorization = createAuthorization({ player: account.address, runId: '1', replay, expiresAt: Math.floor(Date.now() / 1000) + 180 });
        const signature = await account.signTypedData(authorizationTypedData(authorization));
        const verify = (await import(${JSON.stringify(pathToFileURL(path.join(output, 'api/verify-run.js')).href)})).default;
        const before = calls.length;
        const result = await verify.fetch(new Request('https://testnet.rarerush.app/api/verify-run', {
          method: 'POST', headers: { origin: 'https://testnet.rarerush.app', 'content-type': 'application/json' },
          body: JSON.stringify({ authorization, signature, replay }),
        }));
        assert.equal(result.status, 503);
        const resultText = await result.text();
        assert.ok(calls.length > before);
        assert.ok(!resultText.includes('disposable-test-api-key'));
        assert.ok(!resultText.includes('alchemy.com'));
        assert.ok(!resultText.includes(${JSON.stringify(fixtureKey)}));
      }
    }
    console.log('RPC configuration scenario passed.');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: app, encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024,
    env: { PATH: process.env.PATH ?? '' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /RPC configuration scenario passed/);
}

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

test('emitted server JavaScript executes both API exports and their complete import graphs', async t => {
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
    // Mutate only the emitted disposable fixture, never the tracked deployment.
    await writeFile(path.join(output, 'src/shared/deployment.json'), JSON.stringify({ ...deployment, verifier: fixtureVerifier }));
    for (const scenario of ['default', 'configured', 'wrong-chain', 'provider-error', 'verify-provider-error', 'malformed']) {
      await t.test(`server RPC ${scenario}`, () => smokeRpcConfiguration(output, scenario));
    }
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
