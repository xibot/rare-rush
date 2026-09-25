import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { recoverTypedDataAddress, type EIP1193Provider } from 'viem';
import { publishJob, runCli } from './cli.ts';
import { openJob, parseJob, type JobSpec } from './jobs.ts';
import { createAgentSession, runSessionToEnd, exportAgentReplay, checkAgentReplay } from './runner.ts';
import { publicationPayloadHash, publicationTypedData } from '../shared/replay-publication.ts';

const wallet = privateKeyToAccount(`0x${'3'.padStart(64, '0')}`);
const seed = `0x${'41'.padStart(64, '0')}`;
const replay = exportAgentReplay(runSessionToEnd(createAgentSession(seed, 'degen')));
const art = { collection: 1 as const, tokenId: '42', owner: wallet.address, chainId: 4663 as const,
  label: 'Genesis #42', portraitUrl: 'data:image/svg+xml;base64,PHN2Zy8+', bodyId: 'asymmetry' };
function directory(t: { after(callback: () => void): void }) {
  const path = mkdtempSync(join(tmpdir(), 'rare-rush-publish-job-test-'));
  t.after(() => rmSync(path, { recursive: true, force: true })); return path;
}
function specification(mode = 'arcade') {
  return parseJob({ version: 1, id: 'completed-42', mode, collection: 'genesis', tokenId: '42', difficulty: 'degen',
    ...(mode !== 'preview' ? { wallet: { address: wallet.address } } : {}),
    ...(mode === 'testnet' ? { wallet: { address: wallet.address, providerModule: '/tmp/publication-test-unused.mjs' },
      testnet: { allowTransactions: true, claim: true, closeLostRun: false } } : {}) });
}
function completed(root: string, job: JobSpec) {
  const lease = openJob(root, job);
  lease.update({ status: 'completed', record: { source: job.mode === 'preview' ? 'local' : job.mode, collection: 1,
    tokenId: '42', difficulty: 'degen', seed, replay, ...(job.mode !== 'preview' ? { player: wallet.address } : {}),
    ...(job.mode === 'arcade' ? { art } : {}), ...(job.mode === 'testnet' ? { runId: '31' } : {}) } });
  lease.close();
}
function publicationFixture(chainId = 4663) {
  const methods: string[] = [], publications: unknown[] = [];
  const records = new Map<string, unknown>();
  const provider = { async request({ method, params }: { method: string; params?: unknown[] }) {
    methods.push(method);
    if (method === 'eth_accounts') return [wallet.address];
    if (method === 'eth_chainId') return `0x${chainId.toString(16)}`;
    if (method === 'eth_signTypedData_v4') return wallet.signTypedData(JSON.parse(params![1] as string));
    throw new Error(`Forbidden wallet operation: ${method}`);
  } } as EIP1193Provider;
  const fetcher: typeof fetch = async (url, init) => {
    if (init?.method === 'GET') {
      const parsed = new URL(String(url));
      assert.equal(parsed.origin, 'https://rarerush.app');
      assert.match(parsed.pathname, /^\/api\/runs\/[a-f0-9]{64}$/);
      assert.equal(parsed.search, '?publication=1');
      const record = records.get(parsed.pathname.split('/').at(-1)!);
      return record ? Response.json(record) : new Response(null, { status: 404 });
    }
    assert.equal(url, 'https://rarerush.app/api/runs'); assert.equal(init?.method, 'POST');
    const { authorization, ...payload } = JSON.parse(init!.body as string);
    const signer = await recoverTypedDataAddress({ ...publicationTypedData(payload, authorization.expiresAt), signature: authorization.signature });
    assert.equal(signer, wallet.address); publications.push(payload);
    const { replay: _, art: __, ...metadata } = payload;
    const record = { ...metadata, id: publicationPayloadHash(payload).slice(2), createdAt: new Date().toISOString(),
      metrics: checkAgentReplay(payload.seed, payload.difficulty, payload.replay), agent: 'Agentic player', verification: 'wallet-authorized-replay' };
    records.set(record.id, record);
    return Response.json(record);
  };
  return { provider, fetcher, methods, publications };
}

test('publish reads a completed Arcade job, signs only publication, and preserves immutable job bytes', async t => {
  const root = directory(t), job = specification(); completed(root, job);
  const before = readFileSync(join(root, `${job.id}.json`), 'utf8'), f = publicationFixture();
  const saved = await publishJob(job, { directory: root, provider: f.provider, fetcher: f.fetcher });
  assert.match(saved.id, /^[a-f0-9]{64}$/); assert.equal(saved.actor, 'agentic');
  assert.equal(f.publications.length, 1);
  assert.deepEqual([...new Set(f.methods)].sort(), ['eth_accounts', 'eth_chainId', 'eth_signTypedData_v4']);
  assert.equal(f.methods.filter(method => method === 'eth_signTypedData_v4').length, 1);
  assert.equal(readFileSync(join(root, `${job.id}.json`), 'utf8'), before);
  assert.deepEqual(readdirSync(join(root, '.locks')), []);
  const retry = await publishJob(job, { directory: root, provider: f.provider, fetcher: f.fetcher });
  assert.equal(retry.id, saved.id); assert.equal(readFileSync(join(root, `${job.id}.json`), 'utf8'), before);
  assert.equal(retry.createdAt, saved.createdAt);
  assert.equal(f.publications.length, 1);
  assert.equal(f.methods.filter(method => method === 'eth_signTypedData_v4').length, 1);
});

test('Testnet publication uses the completed run identity and cannot start or claim a run', async t => {
  const root = directory(t), job = specification('testnet'); completed(root, job);
  const f = publicationFixture(46630), saved = await publishJob(job, { directory: root, provider: f.provider, fetcher: f.fetcher });
  assert.equal(saved.source, 'testnet'); assert.equal(saved.runId, '31');
  assert.ok(f.methods.every(method => ['eth_accounts', 'eth_chainId', 'eth_signTypedData_v4'].includes(method)));
  assert.equal('art' in (f.publications[0] as object), false);
});

test('missing, pending and Preview jobs are rejected before a provider loads, without creating state', async t => {
  const root = directory(t), job = specification(); let loads = 0;
  const options = { directory: root, loadProvider: async () => { loads++; throw Error('Never load a signer'); } };
  await assert.rejects(publishJob(job, options), /No completed result/);
  assert.deepEqual(readdirSync(root), []);
  const lease = openJob(root, job); lease.update({ status: 'pending' }); lease.close();
  await assert.rejects(publishJob(job, options), /Only an already completed/);
  const preview = { ...specification('preview'), id: 'preview' }; completed(root, preview);
  await assert.rejects(publishJob(preview, options), /Preview runs stay local/);
  assert.equal(loads, 0);
});

test('changed job fingerprints and invalid replay identity fail before signing', async t => {
  const root = directory(t), job = specification(); completed(root, job);
  const f = publicationFixture();
  await assert.rejects(publishJob({ ...job, difficulty: 'easy' }, { directory: root, provider: f.provider }), /different configuration/);
  const file = join(root, `${job.id}.json`), changed = JSON.parse(readFileSync(file, 'utf8'));
  changed.record.tokenId = '43'; writeFileSync(file, JSON.stringify(changed));
  await assert.rejects(publishJob(job, { directory: root, provider: f.provider }), /does not match this job/);
  assert.deepEqual(f.methods, []);
});

test('address-only completed Arcade jobs can choose a publication signer without changing the job configuration', async t => {
  const root = directory(t), job = specification(); completed(root, job);
  await assert.rejects(publishJob(job, { directory: root }), /provider module/);
  const f = publicationFixture(), module = resolve(root, 'trusted-signer.mjs'); let loaded = false;
  await publishJob(job, { directory: root, providerModule: module, fetcher: f.fetcher, loadProvider: async options => {
    loaded = true; assert.equal(options.providerModule, module); assert.equal(options.chainId, 4663);
    assert.equal(options.address, job.wallet!.address); return f.provider;
  } });
  assert.equal(loaded, true); assert.equal(job.wallet!.providerModule, undefined);
});

test('CLI publish emits only the public receipt, and rejected signer errors do not expose secrets', async t => {
  const root = directory(t), job = specification(); completed(root, job);
  const file = join(root, 'job-spec.json'); writeFileSync(file, JSON.stringify(job));
  const lines: string[] = [], f = publicationFixture();
  const options = { directory: root, write: (line: string) => lines.push(line), publication: { provider: f.provider, fetcher: f.fetcher } };
  assert.equal(await runCli(['publish', '--job', file], options), 0);
  const output = JSON.parse(lines.pop()!);
  assert.equal(output.status, 'published'); assert.equal(output.jobId, job.id);
  assert.equal(output.url, `https://rarerush.app/runs-feed/?run=${output.id}`);
  const failing = { request: async () => { throw Error('DO_NOT_PRINT private RPC token'); } } as EIP1193Provider;
  const missing = publicationFixture();
  assert.equal(await runCli(['publish', '--job', file], { ...options, publication: { provider: failing, fetcher: missing.fetcher } }), 1);
  assert.equal(lines.pop()!.includes('DO_NOT_PRINT'), false);
  assert.equal(await runCli(['run', '--job', file, '--provider-module', '/tmp/nope.mjs'], options), 1);
});
