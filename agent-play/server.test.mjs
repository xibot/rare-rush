/** Local-only HTTP regression tests. Uses an isolated data directory and never
 * calls a wallet, public RPC, faucet, verifier, or any upstream network route.
 * Run: node --test agent-play/server.test.mjs
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGenerationSprites } from '@rarefriends/friendsdk/sprites';
import { createAgentSession, runSessionToEnd, exportAgentReplay, checkAgentReplay } from './runner.ts';

const directory = fileURLToPath(new URL('.', import.meta.url));
const port = 4221;
const origin = `http://127.0.0.1:${port}`;
const fixtureSeed = `0x${'3b'.repeat(32)}`;
const session = runSessionToEnd(createAgentSession(fixtureSeed, 'degen'));
const replay = exportAgentReplay(session);
const expected = checkAgentReplay(fixtureSeed, 'degen', replay);
const fixture = { source: 'local', collection: 1, tokenId: '424242', difficulty: 'degen', seed: fixtureSeed, replay };
let child;
let temporaryRoot;
let dataDirectory;
let output = '';

async function request(path, options = {}) {
  const response = await fetch(origin + path, { ...options, signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  return { response, text, body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : undefined };
}
function post(body, headers = {}) {
  return request('/api/runs', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body, (_, value) => typeof value === 'bigint' ? value.toString() : value) });
}

before(async () => {
  // Refuse to write any fixtures if isolation support has not been installed.
  const source = await readFile(new URL('./serve.mjs', import.meta.url), 'utf8');
  assert.match(source, /process\.env\.AGENT_PLAY_DATA_DIR/, 'Server must support an isolated test data directory.');
  assert.match(source, /process\.env\.AGENT_PLAY_OUT_DIR/, 'Server must support an isolated output directory.');
  temporaryRoot = await mkdtemp(join(tmpdir(), 'rare-rush-agent-http-test-'));
  dataDirectory = join(temporaryRoot, 'data');
  child = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url))], {
    cwd: directory, env: { ...process.env, AGENT_PLAY_PORT: String(port), AGENT_PLAY_DATA_DIR: dataDirectory, AGENT_PLAY_OUT_DIR: join(temporaryRoot, 'preview') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Local test server did not start. ${output}`)), 20_000);
    const collect = chunk => {
      output = (output + String(chunk)).slice(-32_000);
      if (output.includes(`AGENT PLAY (local only): ${origin}/`)) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Local test server exited (${code}). ${output}`)); });
  });
  const initial = await request('/api/runs');
  assert.equal(initial.response.status, 200);
  assert.deepEqual(initial.body, { runs: [] }, 'Isolated library starts empty');
});

after(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  }
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

test('serves the local application with restrictive response headers', async () => {
  const result = await request('/');
  assert.equal(result.response.status, 200);
  assert.match(result.text, /id="app"/);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.equal(result.response.headers.get('x-frame-options'), 'DENY');
  assert.equal(result.response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(result.response.headers.get('x-robots-tag'), 'noindex,nofollow');
  assert.equal((await request('/checker.mjs')).response.status, 404, 'Node checker is not a public artifact');
});

test('rejects wrong Host, cross-site origins, missing POST origin and wrong content type', async () => {
  // fetch normalizes Host; use the HTTP client for the explicit host attack.
  const wrongHost = await new Promise((resolve, reject) => {
    const req = httpRequest(origin + '/api/runs', { headers: { Host: `localhost:${port}` } }, response => {
      response.resume(); response.once('end', () => resolve(response.statusCode));
    });
    req.once('error', reject); req.end();
  });
  assert.equal(wrongHost, 403);
  for (const headers of [
    { Origin: 'https://example.invalid' },
    { Origin: 'null' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ]) assert.equal((await request('/api/runs', { headers })).response.status, 403, JSON.stringify(headers));
  assert.equal((await request('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).response.status, 403);
  assert.equal((await request('/api/runs', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: '{}' })).response.status, 403);
  assert.equal((await post({}, { Origin: 'https://example.invalid' })).response.status, 403);
  assert.deepEqual((await request('/api/runs')).body, { runs: [] });
});

test('unknown proxy routes and wrong proxy methods are rejected without upstream calls', async () => {
  for (const path of ['/api/proxy?url=https://example.invalid', '/api/unknown', '/api/runs/not-a-hash']) {
    assert.equal((await request(path)).response.status, 404);
  }
  assert.equal((await request('/api/rpc')).response.status, 405);
  assert.equal((await request('/api/verify-run')).response.status, 405);
  for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_sign', 'personal_sign', 'wallet_switchEthereumChain']) {
    const denied = await request('/api/rpc', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }) });
    assert.equal(denied.response.status, 403, `${method} must never reach the proxy`);
  }
  const status = await request('/api/status', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(status.response.status, 405);
});

test('rejects invalid identities, JSON, oversized bodies and malformed or unfinished recordings', async () => {
  for (const patch of [
    { seed: 'not-a-seed' }, { difficulty: 'nightmare' }, { collection: 2 },
    { tokenId: '../example' }, { tokenId: '0' }, { source: 'invented' },
    { source: 'testnet' }, { source: 'testnet', runId: '1', player: '0x12' },
  ]) assert.equal((await post({ ...fixture, ...patch })).response.status, 400);
  const invalidJson = await request('/api/runs', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{invalid' });
  assert.equal(invalidJson.response.status, 400);
  const oversized = await request('/api/runs', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: ' '.repeat(1_800_001) });
  assert.equal(oversized.response.status, 400);
  const invalidFrame = structuredClone(replay);
  invalidFrame.inputs.frames[0].pace = 2;
  const injectedTotal = { ...replay, score: 999999999 };
  const incomplete = structuredClone(replay);
  incomplete.inputs.frames.pop(); incomplete.finalTick--;
  for (const badReplay of [invalidFrame, injectedTotal, incomplete]) {
    const result = await post({ ...fixture, replay: badReplay });
    assert.equal(result.response.status, 400, result.text);
  }
  assert.deepEqual((await request('/api/runs')).body, { runs: [] }, 'Rejected input creates no library entries');
});

test('derives scores from the replay, saves idempotently and loads the full recording', async () => {
  const forged = { ...fixture, score: 999999999, metrics: { score: 999999999, coins: 999999999, outcome: 'survived' }, verification: 'onchain' };
  const first = await post(forged);
  assert.equal(first.response.status, 200, first.text);
  assert.deepEqual(first.body.metrics, expected, 'Caller-supplied totals must not influence verified metrics');
  assert.equal(first.body.verification, 'local-replay');
  assert.match(first.body.id, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(first.body, 'replay'), false, 'Save responses contain a lightweight summary');
  const again = await post(fixture);
  assert.equal(again.response.status, 200, again.text);
  assert.deepEqual(again.body, first.body, 'The same identity and recording produce one stable record');
  const duplicate = await Promise.all([post(fixture), post(fixture)]);
  for (const result of duplicate) assert.deepEqual(result.body, first.body);
  const list = await request('/api/runs');
  assert.deepEqual(list.body, { runs: [first.body] });
  assert.equal((await readdir(dataDirectory)).filter(name => name.endsWith('.json')).length, 1);
  const full = await request(`/api/runs/${first.body.id}`);
  assert.equal(full.response.status, 200);
  assert.deepEqual(full.body.replay, replay);
  assert.deepEqual(full.body.metrics, expected);
  assert.equal(full.body.tokenId, fixture.tokenId);
  assert.equal(full.body.source, 'local');
  assert.equal(full.body.seed, fixtureSeed);
  const missing = await request(`/api/runs/${'0'.repeat(64)}`);
  assert.equal(missing.response.status, 404);
});

test('Arcade preserves the owner and real SDK packed sprites through save and replay loading', async () => {
  const owner = '0x1111111111111111111111111111111111111111';
  const bitmaps = Array.from({ length: 64 }, (_, index) => index === 63 ? (1n << 256n) - 1n : 1n << BigInt(index));
  const sprites = decodeGenerationSprites(BigInt(fixture.tokenId), 8, 0xffffffff, bitmaps);
  const art = { collection: 0, tokenId: fixture.tokenId, owner, chainId: 4663, blockNumber: '99', label: 'Generations #424242 · Hollow', sprites };
  const input = { ...fixture, source: 'arcade', collection: 0, player: owner, art };
  const saved = await post(input);
  assert.equal(saved.response.status, 200, saved.text);
  assert.equal(saved.body.player, owner);
  assert.equal(saved.body.source, 'arcade');
  assert.deepEqual(saved.body.metrics, expected);
  const full = await request(`/api/runs/${saved.body.id}`);
  assert.equal(full.response.status, 200);
  assert.equal(full.body.art.owner, owner);
  assert.equal(full.body.art.tokenId, fixture.tokenId);
  assert.equal(full.body.art.chainId, 4663);
  assert.equal(full.body.art.sprites.seed, 0xffffffff);
  const restored = decodeGenerationSprites(BigInt(full.body.art.tokenId), full.body.art.sprites.familyId,
    full.body.art.sprites.seed, full.body.art.sprites.frames.map(BigInt));
  assert.deepEqual(restored, sprites, 'All SDK animation clips must survive the JSON round trip');
  assert.deepEqual(full.body.replay, replay);
  for (const changed of [
    { ...art, owner: '0x2222222222222222222222222222222222222222' },
    { ...art, chainId: 46630 },
    { ...art, sprites: { ...sprites, familyId: 9 } },
    { ...art, sprites: { ...sprites, seed: 2 ** 32 } },
    { ...art, sprites: { ...sprites, frames: bitmaps.slice(1) } },
    { ...art, sprites: { ...sprites, frames: [1n << 256n, ...bitmaps.slice(1)] } },
  ]) assert.equal((await post({ ...input, art: changed })).response.status, 400);
});

test('imports headless job replays without exposing wallet configuration or trusting scores', async () => {
  const jobs = join(dataDirectory, 'jobs');
  await mkdir(jobs, { recursive: true });
  const id = 'daily-preview-genesis-424243';
  const job = { version: 1, job: { id, wallet: { providerModule: '/private/example-signer.mjs' } },
    status: 'needs-attention', progress: { privateCheckpoint: 'not-for-browser' },
    record: { ...fixture, tokenId: '424243', metrics: { score: 999999999 } } };
  await writeFile(join(jobs, `${id}.json`), JSON.stringify(job));
  await writeFile(join(jobs, 'broken.json'), '{');
  await writeFile(join(jobs, 'invalid.json'), JSON.stringify({ version: 1, job: { id: 'invalid' }, record: { ...fixture, replay: {} } }));
  const first = await request('/api/runs');
  assert.equal(first.response.status, 200);
  const entry = first.body.runs.find(run => run.agentJobId === id);
  assert.ok(entry, 'Finished gameplay is available even when later claim work needs attention');
  assert.deepEqual(entry.metrics, expected);
  assert.equal(entry.verification, 'local-replay');
  assert.ok(!first.text.includes('example-signer') && !first.text.includes('privateCheckpoint'));
  const full = await request(`/api/runs/${entry.id}`);
  assert.deepEqual(full.body.replay, replay);
  assert.ok(!full.text.includes('example-signer') && !full.text.includes('privateCheckpoint'));
  const again = await request('/api/runs');
  assert.equal(again.body.runs.filter(run => run.agentJobId === id).length, 1);
  assert.equal((await request(`/data/jobs/${id}.json`)).response.status, 404);
});
