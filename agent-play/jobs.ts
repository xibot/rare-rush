/** Durable local job state. No signer secrets belong in this store. */
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import type { AgentReplay, Difficulty, RunMetrics } from './runner.ts';

export const MAX_JOB_INPUT_BYTES = 32_768;
export const MAX_JOB_STATE_BYTES = 12_000_000;
export type JobMode = 'preview' | 'arcade' | 'testnet';
export interface JobSpec {
  version: 1;
  id: string;
  mode: JobMode;
  collection: 'genesis' | 'generations';
  tokenId: string;
  difficulty: Difficulty;
  wallet?: { address: `0x${string}`; providerModule?: string };
  rpcUrl?: string;
  testnet?: { allowTransactions: true; claim: true; closeLostRun: boolean };
}
export interface JobRecord {
  source: 'local' | 'arcade' | 'testnet';
  seed: string;
  difficulty: Difficulty;
  collection: 0 | 1;
  tokenId: string;
  replay: AgentReplay;
  player?: string;
  runId?: string;
  art?: unknown;
  metrics?: RunMetrics;
  ownership?: 'observed-onchain';
  walletAuthentication?: 'external-provider' | 'address-only';
}
export type JobStatus = 'running' | 'pending' | 'needs-attention' | 'completed';
export interface JobDocument {
  version: 1;
  id: string;
  job: JobSpec;
  jobHash: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  progress: Record<string, unknown>;
  record?: JobRecord;
  message?: string;
  reasonCode?: string;
}
export class JobError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = 'JobError'; }
}
function requireThat(value: unknown, code: string, message: string): asserts value {
  if (!value) throw new JobError(code, message);
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  requireThat(Object.keys(value).every(key => allowed.includes(key)), 'INVALID_JOB', 'The job contains an unsupported field. Keep signer secrets in the external provider.');
}
export function parseJob(input: unknown, baseDirectory = process.cwd()): JobSpec {
  requireThat(object(input), 'INVALID_JOB', 'Expected a job object.');
  keys(input, ['version', 'id', 'mode', 'collection', 'tokenId', 'difficulty', 'wallet', 'rpcUrl', 'testnet']);
  requireThat(input.version === 1, 'INVALID_JOB', 'Job version must be 1.');
  requireThat(typeof input.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.id), 'INVALID_JOB', 'Supply a stable lowercase job ID of at most 64 letters, numbers, hyphens or underscores.');
  requireThat(['preview', 'arcade', 'testnet'].includes(input.mode as string), 'INVALID_JOB', 'Choose preview, arcade or testnet mode.');
  requireThat(['genesis', 'generations'].includes(input.collection as string), 'INVALID_JOB', 'Choose genesis or generations.');
  requireThat(typeof input.tokenId === 'string' && /^[1-9][0-9]{0,76}$/.test(input.tokenId), 'INVALID_JOB', 'Token ID must be a positive decimal string of at most 77 digits.');
  requireThat(['easy', 'normal', 'degen'].includes(input.difficulty as string), 'INVALID_JOB', 'Choose easy, normal or degen difficulty.');
  const job: JobSpec = { version: 1, id: input.id, mode: input.mode as JobMode,
    collection: input.collection as JobSpec['collection'], tokenId: input.tokenId, difficulty: input.difficulty as Difficulty };
  if (input.wallet !== undefined) {
    requireThat(object(input.wallet), 'INVALID_JOB', 'Wallet must be an address and optional local provider module.');
    keys(input.wallet, ['address', 'providerModule']);
    requireThat(typeof input.wallet.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(input.wallet.address)
      && !/^0x0{40}$/.test(input.wallet.address), 'INVALID_JOB', 'Supply a nonzero wallet address.');
    job.wallet = { address: input.wallet.address.toLowerCase() as `0x${string}` };
    if (input.wallet.providerModule !== undefined) {
      requireThat(typeof input.wallet.providerModule === 'string' && input.wallet.providerModule.length > 0
        && input.wallet.providerModule.length <= 1024 && !input.wallet.providerModule.includes('\0')
        && /\.(mjs|js)$/.test(input.wallet.providerModule) && !/^[a-z]+:/i.test(input.wallet.providerModule),
      'INVALID_JOB', 'Provider module must be a local .mjs or .js path, relative to the job file or absolute.');
      job.wallet.providerModule = resolve(baseDirectory, input.wallet.providerModule);
    }
  }
  if (input.rpcUrl !== undefined) {
    requireThat(typeof input.rpcUrl === 'string' && input.rpcUrl.length <= 2048, 'INVALID_JOB', 'Invalid RPC URL.');
    let url: URL;
    try { url = new URL(input.rpcUrl); } catch { throw new JobError('INVALID_JOB', 'RPC URL must be an absolute HTTP(S) URL.'); }
    requireThat(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.hash,
      'INVALID_JOB', 'RPC URL must use HTTP(S), without credentials or a fragment.');
    job.rpcUrl = url.href;
  }
  if (job.mode === 'preview') {
    requireThat(!job.wallet && !job.rpcUrl && input.testnet === undefined, 'INVALID_JOB', 'Preview jobs do not use wallet, RPC or transaction settings.');
  } else requireThat(job.wallet, 'INVALID_JOB', 'Arcade and Testnet jobs require a wallet address.');
  if (job.mode === 'testnet') {
    requireThat(job.wallet?.providerModule, 'INVALID_JOB', 'Testnet requires an external signer provider module.');
    requireThat(object(input.testnet), 'INVALID_JOB', 'Testnet requires explicit transaction and claim opt-in.');
    keys(input.testnet, ['allowTransactions', 'claim', 'closeLostRun']);
    requireThat(input.testnet.allowTransactions === true && input.testnet.claim === true
      && (input.testnet.closeLostRun === undefined || typeof input.testnet.closeLostRun === 'boolean'),
    'INVALID_JOB', 'Testnet requires allowTransactions:true and claim:true; closeLostRun defaults to false.');
    job.testnet = { allowTransactions: true, claim: true, closeLostRun: input.testnet.closeLostRun === true };
  } else requireThat(input.testnet === undefined, 'INVALID_JOB', 'Transaction settings are only valid for Testnet.');
  return job;
}
export function readJobFile(file: string): JobSpec {
  requireThat(statSync(file).size <= MAX_JOB_INPUT_BYTES, 'INVALID_JOB', 'Job JSON exceeds the 32 KB limit.');
  let value: unknown;
  try { value = JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new JobError('INVALID_JOB', 'Job must be valid JSON.'); }
  return parseJob(value, dirname(resolve(file)));
}
export function jobFingerprint(job: JobSpec): string {
  return createHash('sha256').update(JSON.stringify(job)).digest('hex');
}
export function atomicJson(file: string, value: unknown): void {
  const raw = JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
  requireThat(Buffer.byteLength(raw) <= MAX_JOB_STATE_BYTES, 'STATE_TOO_LARGE', 'Job state exceeds its bounded storage limit.');
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, raw); fsyncSync(fd); }
  finally { closeSync(fd); }
  try { renameSync(temporary, file); }
  catch (error) { rmSync(temporary, { force: true }); throw error; }
  const directory = openSync(dirname(file), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
}
function readBounded(file: string): unknown {
  requireThat(statSync(file).size <= MAX_JOB_STATE_BYTES, 'INVALID_STATE', 'Stored job state is too large.');
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new JobError('INVALID_STATE', 'Stored job state is invalid. Preserve it for recovery.'); }
}
export function readJobDocument(directory: string, job: JobSpec): JobDocument | null {
  const file = join(directory, `${job.id}.json`);
  if (!existsSync(file)) return null;
  const doc = readBounded(file);
  requireThat(object(doc) && doc.version === 1 && doc.id === job.id && object(doc.job)
    && typeof doc.jobHash === 'string' && object(doc.progress)
    && ['running', 'pending', 'needs-attention', 'completed'].includes(doc.status as string),
  'INVALID_STATE', 'Stored job state is invalid. Preserve it for recovery.');
  requireThat(doc.jobHash === jobFingerprint(job) && jobFingerprint(parseJob(doc.job)) === doc.jobHash,
    'JOB_CHANGED', 'This job ID already belongs to a different configuration. Resume using its original job file.');
  requireThat(typeof doc.createdAt === 'string' && typeof doc.updatedAt === 'string', 'INVALID_STATE', 'Stored job timestamps are invalid.');
  return doc as unknown as JobDocument;
}

interface LockRecord { version: 1; token: string; jobId: string; pid: number; host: string; active: boolean; createdAt: string }
interface HeldLock { file: string; token: string; recovered: boolean }
function activeProcess(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
/** The short guard serializes lock recovery. A crashed guard fails closed and
 * requires explicit inspection; it is never silently removed by another job. */
function underGuard<T>(file: string, action: () => T): T {
  const guard = `${file}.guard`;
  // A competing process can hold this filesystem mutex briefly while fsyncing.
  // Bound the wait; a crashed guard is never deleted or treated as permission.
  const waitUntil = Date.now() + 300;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try { mkdirSync(guard, { mode: 0o700 }); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() >= waitUntil) {
        throw new JobError('JOB_LOCKED', 'Another lock operation is active or requires recovery. No action was submitted.');
      }
      Atomics.wait(sleeper, 0, 0, 5);
    }
  }
  try { return action(); } finally { rmSync(guard, { recursive: true }); }
}
function acquireLock(file: string, jobId: string): HeldLock {
  return underGuard(file, () => {
    let recovered = false;
    if (existsSync(file)) {
      const old = readBounded(file);
      requireThat(object(old) && old.version === 1 && typeof old.token === 'string' && typeof old.jobId === 'string'
        && Number.isSafeInteger(old.pid) && typeof old.host === 'string' && typeof old.active === 'boolean',
      'JOB_LOCKED', 'Lock state is invalid. Preserve it and inspect before running.');
      requireThat(old.jobId === jobId, 'WALLET_LOCKED', 'This wallet has another unfinished job. Resume that exact job before starting a new one.');
      requireThat(old.host === hostname(), 'JOB_LOCKED', 'This job is locked by a different host. Inspect its state before continuing.');
      requireThat(!old.active || !activeProcess(old.pid as number), 'JOB_LOCKED', 'This job is already running. No second run was started.');
      recovered = true;
    }
    const lock: LockRecord = { version: 1, token: randomUUID(), jobId, pid: process.pid, host: hostname(), active: true, createdAt: new Date().toISOString() };
    atomicJson(file, lock);
    return { file, token: lock.token, recovered };
  });
}
function releaseLock(lock: HeldLock, keep: boolean): void {
  underGuard(lock.file, () => {
    const current = readBounded(lock.file);
    requireThat(object(current) && current.token === lock.token, 'JOB_LOCKED', 'Lock ownership changed. No lock was removed.');
    if (keep) atomicJson(lock.file, { ...current, active: false });
    else rmSync(lock.file);
  });
}
function releaseCompletedLock(file: string, jobId: string): void {
  if (!existsSync(file)) return;
  // A result reader must not contend with its still-living owner's close().
  // The completion file is readable while that owner removes its own locks.
  try {
    const current = readBounded(file);
    if (object(current) && current.jobId === jobId && current.host === hostname()
      && current.active === true && Number.isSafeInteger(current.pid) && activeProcess(current.pid as number)) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  underGuard(file, () => {
    if (!existsSync(file)) return;
    const lock = readBounded(file);
    requireThat(object(lock) && lock.version === 1 && typeof lock.active === 'boolean'
      && Number.isSafeInteger(lock.pid), 'JOB_LOCKED', 'Completed job has invalid lock metadata. Preserve it for inspection.');
    // Another job may already have acquired this wallet. A living owner still
    // finishes its own cleanup; reading a completed result never steals a lock.
    if (lock.jobId !== jobId || lock.host !== hostname() || (lock.active && activeProcess(lock.pid as number))) return;
    rmSync(file);
  });
}
export interface JobLease {
  file: string;
  document: JobDocument;
  /** A prior wallet execution was interrupted or left unfinished. */
  recovered: boolean;
  alreadyCompleted: boolean;
  checkpoint(progress: Record<string, unknown>): void;
  update(patch: Pick<JobDocument, 'status'> & Partial<Pick<JobDocument, 'record' | 'message' | 'reasonCode'>>): void;
  close(retainWalletLock?: boolean): void;
}
function completedLease(file: string, document: JobDocument): JobLease {
  return { file, document, recovered: false, alreadyCompleted: true,
    checkpoint() { throw new JobError('JOB_COMPLETED', 'Completed jobs are immutable.'); },
    update() { throw new JobError('JOB_COMPLETED', 'Completed jobs are immutable.'); }, close() {} };
}
export function openJob(directory: string, job: JobSpec): JobLease {
  directory = resolve(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const locks = join(directory, '.locks'); mkdirSync(locks, { recursive: true, mode: 0o700 });
  const file = join(directory, `${job.id}.json`);
  let document = readJobDocument(directory, job);
  if (document?.status === 'completed') {
    releaseCompletedLock(join(locks, `job-${job.id}.json`), job.id);
    if (job.wallet) releaseCompletedLock(join(locks, `wallet-${job.mode === 'testnet' ? 46630 : 4663}-${job.wallet.address}.json`), job.id);
    return completedLease(file, document);
  }
  const jobLock = acquireLock(join(locks, `job-${job.id}.json`), job.id);
  let walletLock: HeldLock | undefined;
  let completedDuringAcquire = false;
  try {
    if (job.wallet) walletLock = acquireLock(join(locks, `wallet-${job.mode === 'testnet' ? 46630 : 4663}-${job.wallet.address}.json`), job.id);
    document = readJobDocument(directory, job);
    completedDuringAcquire = document?.status === 'completed';
    const now = new Date().toISOString();
    document ??= { version: 1, id: job.id, job, jobHash: jobFingerprint(job), createdAt: now, updatedAt: now, status: 'running', progress: {} };
    if (!completedDuringAcquire) atomicJson(file, document);
  } catch (error) {
    if (walletLock) releaseLock(walletLock, walletLock.recovered);
    releaseLock(jobLock, false); throw error;
  }
  if (completedDuringAcquire) {
    if (walletLock) releaseLock(walletLock, false);
    releaseLock(jobLock, false);
    return completedLease(file, document);
  }
  let closed = false;
  const lease: JobLease = {
    file, document, recovered: walletLock?.recovered ?? jobLock.recovered, alreadyCompleted: false,
    checkpoint(progress) {
      requireThat(!closed && object(progress), 'INVALID_STATE', 'Cannot checkpoint a closed job or invalid progress.');
      const record = object(progress.record) ? progress.record as unknown as JobRecord : lease.document.record;
      lease.document = { ...lease.document, progress, ...(record ? { record } : {}), updatedAt: new Date().toISOString() };
      atomicJson(file, lease.document);
    },
    update(patch) {
      requireThat(!closed, 'INVALID_STATE', 'Cannot update a closed job.');
      lease.document = { ...lease.document, ...patch, updatedAt: new Date().toISOString() };
      atomicJson(file, lease.document);
    },
    close(retainWalletLock = false) {
      if (closed) return;
      try { if (walletLock) releaseLock(walletLock, retainWalletLock); }
      finally { releaseLock(jobLock, false); closed = true; }
    },
  };
  return lease;
}
