import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openJob, parseJob, readJobDocument, readJobFile, MAX_JOB_INPUT_BYTES } from './jobs.ts';

const sample = { version: 1, id: 'daily-friend-1', mode: 'preview', collection: 'genesis', tokenId: '1', difficulty: 'degen' };
const address = '0x1111111111111111111111111111111111111111';
function directory(t: { after: (callback: () => void) => void }) {
  const path = mkdtempSync(join(tmpdir(), 'rare-rush-agent-job-test-'));
  t.after(() => rmSync(path, { recursive: true, force: true })); return path;
}

test('job input is bounded, exact and requires explicit Testnet transaction opt-in', t => {
  const root = directory(t);
  assert.deepEqual(parseJob(sample), sample);
  for (const patch of [{ id: '../escape' }, { id: '' }, { id: 'Upper' }, { version: 2 }, { difficulty: 'max' },
    { tokenId: 1 }, { tokenId: '0' }, { tokenId: '1'.repeat(78) }, { secret: 'not-allowed' }, { wallet: { address } }]) {
    assert.throws(() => parseJob({ ...sample, ...patch }));
  }
  const testnet = { ...sample, mode: 'testnet', wallet: { address, providerModule: './signer.mjs' } };
  assert.throws(() => parseJob(testnet), /opt-in/);
  assert.throws(() => parseJob({ ...testnet, testnet: { allowTransactions: false, claim: true } }));
  assert.throws(() => parseJob({ ...testnet, testnet: { allowTransactions: true, claim: false } }));
  const parsed = parseJob({ ...testnet, testnet: { allowTransactions: true, claim: true } }, root);
  assert.equal(parsed.wallet?.providerModule, join(root, 'signer.mjs'));
  assert.equal(parsed.testnet?.closeLostRun, false);
  assert.throws(() => parseJob({ ...testnet, rpcUrl: 'https://username:password@example.test', testnet: { allowTransactions: true, claim: true } }));
  const input = join(root, 'job.json'); writeFileSync(input, ' '.repeat(MAX_JOB_INPUT_BYTES + 1));
  assert.throws(() => readJobFile(input), /32 KB/);
});

test('same ID resumes its exact durable checkpoint and refuses conflicting configurations', t => {
  const root = directory(t), job = parseJob(sample);
  const lease = openJob(root, job);
  lease.checkpoint({ version: 1, seed: 'persist-before-work', completedTicks: 120 });
  assert.throws(() => openJob(root, job), /already running/);
  lease.close();
  const resumed = openJob(root, job);
  assert.deepEqual(resumed.document.progress, { version: 1, seed: 'persist-before-work', completedTicks: 120 });
  resumed.close();
  assert.throws(() => openJob(root, parseJob({ ...sample, difficulty: 'easy' })), /different configuration/);
  const saved = readJobDocument(root, job)!;
  assert.equal(saved.id, job.id);
  assert.equal(saved.job.id, job.id);
});

test('per-wallet lock blocks concurrent jobs and remains reserved through ambiguous operations', t => {
  const root = directory(t);
  const first = parseJob({ ...sample, mode: 'arcade', wallet: { address } });
  const second = parseJob({ ...first, id: 'another-job' });
  const active = openJob(root, first);
  assert.throws(() => openJob(root, second), /unfinished job/);
  active.close(true);
  assert.throws(() => openJob(root, second), /unfinished job/);
  const recovery = openJob(root, first);
  assert.equal(recovery.recovered, true);
  recovery.close(false);
  openJob(root, second).close();
});

test('completed jobs are immutable and never allocate new execution state', t => {
  const root = directory(t), job = parseJob(sample);
  const lease = openJob(root, job);
  lease.checkpoint({ finished: 'stable' }); lease.update({ status: 'completed' }); lease.close();
  const before = readFileSync(lease.file, 'utf8');
  const cached = openJob(root, job);
  assert.equal(cached.alreadyCompleted, true);
  assert.deepEqual(cached.document.progress, { finished: 'stable' });
  assert.throws(() => cached.checkpoint({ reset: true }), /immutable/);
  cached.close();
  assert.equal(readFileSync(lease.file, 'utf8'), before);
});

test('a crashed owner can resume the same job, and completed stale locks are cleaned safely', t => {
  const root = directory(t);
  const job = parseJob({ ...sample, mode: 'arcade', wallet: { address } });
  const moduleUrl = new URL('./jobs.ts', import.meta.url).href;
  const crash = (complete: boolean) => spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {openJob} from ${JSON.stringify(moduleUrl)};
     const lease = openJob(process.argv[1], JSON.parse(process.argv[2]));
     lease.checkpoint({durable:true});
     if (process.argv[3] === 'yes') lease.update({status:'completed'});
     process.exit(0);`, root, JSON.stringify(job), complete ? 'yes' : 'no'], { encoding: 'utf8' });
  assert.equal(crash(false).status, 0);
  const resumed = openJob(root, job);
  assert.equal(resumed.recovered, true);
  assert.equal(resumed.document.progress.durable, true);
  resumed.close();
  assert.equal(crash(true).status, 0);
  assert.equal(openJob(root, job).alreadyCompleted, true);
  const next = parseJob({ ...job, id: 'next-daily-run' });
  openJob(root, next).close();
});
