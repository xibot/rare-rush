import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EIP1193Provider } from 'viem';
import { runCli, runJob } from './cli.ts';
import { openJob, parseJob } from './jobs.ts';
import { PROTOCOL_VERSION, advanceAgent, createAgentSession, exportAgentReplay, runSessionToEnd } from './runner.ts';
import type { HeadlessTestnetProgress } from './headless-testnet.ts';

const seed = `0x${'7c'.repeat(32)}`;
const address = '0x1111111111111111111111111111111111111111';
const base = { version: 1, id: 'scheduled-friend-1', mode: 'preview', collection: 'genesis', tokenId: '1', difficulty: 'degen' };
const provider = { request: async () => { throw new Error('A real wallet method must never run in this test.'); } } as EIP1193Provider;
function directory(t: { after: (callback: () => void) => void }) {
  const path = mkdtempSync(join(tmpdir(), 'rare-rush-agent-cli-test-'));
  t.after(() => rmSync(path, { recursive: true, force: true })); return path;
}

test('Preview executes without a browser or wallet, saves the exact result, and repeated ID is inert', async t => {
  const root = directory(t), job = parseJob(base); let seedCalls = 0;
  const first = await runJob(job, { directory: root, seed: () => { seedCalls++; return seed; } });
  assert.equal(first.status, 'completed'); assert.equal(first.id, job.id);
  assert.equal(first.record?.source, 'local'); assert.equal(first.record?.seed, seed);
  assert.equal(first.record?.replay.finalTick, 7200);
  const before = readFileSync(join(root, `${job.id}.json`), 'utf8');
  const again = await runJob(job, { directory: root, seed: () => { throw new Error('Must not create another seed'); } });
  assert.deepEqual(again, first); assert.equal(seedCalls, 1);
  assert.equal(readFileSync(join(root, `${job.id}.json`), 'utf8'), before);
});

test('interrupted Preview resumes its saved seed and legal input prefix', async t => {
  const root = directory(t), job = parseJob(base), session = createAgentSession(seed, 'degen');
  for (let i = 0; i < 1200; i++) advanceAgent(session);
  const lease = openJob(root, job);
  lease.checkpoint({ version: 1, kind: 'simulation', seed, inputs: { version: PROTOCOL_VERSION, frames: session.frames }, completedTicks: session.run._tick });
  lease.close();
  const resumed = await runJob(job, { directory: root, seed: () => { throw new Error('Resume must keep the original seed'); } });
  assert.equal(resumed.status, 'completed');
  assert.deepEqual(resumed.record?.replay, exportAgentReplay(runSessionToEnd(createAgentSession(seed, 'degen'))));
});

test('two scheduled jobs cannot read or act concurrently through the same wallet', async t => {
  const root = directory(t);
  const first = parseJob({ ...base, mode: 'arcade', wallet: { address } });
  const second = parseJob({ ...first, id: 'second-job' });
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  const active = runJob(first, { directory: root, provider, seed: () => seed,
    readArcade: async () => { reads++; await waiting; return {
      collection: 1, tokenId: '1', owner: address, chainId: 4663, blockNumber: '99', label: 'Genesis #1',
      portraitUrl: 'data:image/svg+xml;base64,PHN2Zy8+', bodyId: 'default',
    }; } });
  await assert.rejects(runJob(second, { directory: root, provider }), /unfinished job/);
  release();
  const completed = await active;
  assert.equal(reads, 1); assert.equal(completed.status, 'completed');
  assert.equal(completed.record?.walletAuthentication, 'address-only');
  assert.match(completed.message!, /not authenticated/);
});

test('terminal Testnet replay survives later failure and another job cannot bypass recovery', async t => {
  const root = directory(t);
  const job = parseJob({ ...base, mode: 'testnet', wallet: { address, providerModule: './unused.mjs' },
    testnet: { allowTransactions: true, claim: true, closeLostRun: false } });
  const replay = exportAgentReplay(runSessionToEnd(createAgentSession(seed, 'degen')));
  const record = { source: 'testnet' as const, collection: 1 as const, tokenId: '1', difficulty: 'degen' as const,
    seed, runId: '42', player: address, replay, metrics: undefined as never };
  const progress: HeadlessTestnetProgress = { version: 1, jobId: job.id, address, fingerprint: 'fixture', records: {},
    startAttempted: true, startedRunId: '42', completed: false, record };
  const first = await runJob(job, { directory: root, provider, testnetRunner: async options => {
    options.persist(progress); throw new Error('Private RPC https://secret.invalid/token=DO_NOT_LOG');
  } });
  assert.equal(first.status, 'needs-attention'); assert.equal(first.record?.runId, '42');
  assert.equal(readFileSync(join(root, `${job.id}.json`), 'utf8').includes('DO_NOT_LOG'), false);
  const other = parseJob({ ...job, id: 'different-id' });
  await assert.rejects(runJob(other, { directory: root, provider }), /unfinished job/);
  const resumed = await runJob(job, { directory: root, provider, testnetRunner: async options => {
    assert.equal(options.resumeOnly, true); assert.equal(options.progress?.startedRunId, '42');
    return { status: 'completed', record, progress: { ...progress, completed: true, outcome: 'claimed' }, message: 'fixture' };
  } });
  assert.equal(resumed.status, 'completed'); assert.ok(resumed.record?.metrics?.score);
  assert.equal((await runJob(job, { directory: root, loadProvider: async () => { throw new Error('Completed must not load a signer'); } })).status, 'completed');
});

test('durable clean preflight can retry reads and first start; missing crash progress remains read-only', async t => {
  const root = directory(t);
  const job = parseJob({ ...base, mode: 'testnet', wallet: { address, providerModule: './unused.mjs' },
    testnet: { allowTransactions: true, claim: true } });
  let lease = openJob(root, job);
  lease.checkpoint({ version: 1, jobId: job.id, address, fingerprint: 'fixture', records: {}, startAttempted: false, completed: false });
  lease.close(true);
  await runJob(job, { directory: root, provider, testnetRunner: async options => {
    assert.equal(options.resumeOnly, false);
    return { status: 'pending', progress: options.progress!, message: 'fixture' };
  } });
  lease = openJob(root, job); lease.checkpoint({}); lease.close(true);
  await runJob(job, { directory: root, provider, testnetRunner: async options => {
    assert.equal(options.resumeOnly, true);
    return { status: 'needs-attention', progress: { version: 1, jobId: job.id, address, fingerprint: 'fixture', records: {}, startAttempted: false, completed: false }, message: 'fixture' };
  } });
});

test('CLI has structured output, requires an explicit ID and never echoes arbitrary exception details', async t => {
  const root = directory(t), lines: string[] = [];
  const defaults = { directory: join(root, 'jobs'), write: (value: string) => lines.push(value) };
  assert.equal(await runCli(['--help'], defaults), 0);
  assert.match(lines.pop()!, /No schedule or cron entry is created/);
  const file = join(root, 'job.json'); writeFileSync(file, JSON.stringify(base));
  assert.equal(await runCli(['run', '--job', file], defaults), 0);
  const output = JSON.parse(lines.pop()!);
  assert.equal(output.jobId, base.id); assert.equal(output.status, 'completed');
  assert.equal(output.resultFile, join(root, 'jobs', `${base.id}.json`));
  assert.equal(await runCli(['run', '--job', join(root, 'DO_NOT_LOG_missing.json')], defaults), 1);
  assert.equal(lines.pop()!.includes('DO_NOT_LOG'), false);
  writeFileSync(file, JSON.stringify({ ...base, id: undefined }));
  assert.equal(await runCli(['run', '--job', file], defaults), 1);
});
