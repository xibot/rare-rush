import { createPublicClient, getAddress, http, isAddress, keccak256, toHex, type EIP1193Provider, type PublicClient } from 'viem';
import { createTestnetAdapter, PLAY_CHAIN_ID, PLAY_CONTRACTS, TESTNET_CHAIN, ENTRY_FEE, type PlayState } from './testnet.ts';
import { readRun } from '../../testnet-app/src/play/chain.ts';
import { RPC_URL } from '../../testnet-app/src/safety.ts';
import { AUTH_SITE } from '../../testnet-app/src/shared/authorization.ts';
import type { BrowserWallet } from '../../testnet-app/src/wallet-session.ts';
import { assertProviderIdentity } from './wallet-provider.ts';
import { resumeAgentSession, runSessionToEnd, exportAgentReplay, getSessionMetrics, PROTOCOL_VERSION,
  type AgentReplay, type RunMetrics, type Difficulty } from './runner.ts';

export type HeadlessTestnetJob = {
  id: string; source: 'testnet'; address: string; collection: 0 | 1; tokenId: string;
  difficulty: Difficulty; testnet: { allowTransactions: true; claim: true; closeLostRun: boolean };
};
export type HeadlessTestnetRecord = {
  source: 'testnet'; collection: 0 | 1; tokenId: string; difficulty: Difficulty;
  seed: string; runId: string; player: string; replay: AgentReplay; metrics: RunMetrics;
};
export type HeadlessTestnetProgress = {
  version: 1; jobId: string; address: string; fingerprint: string; records: Record<string, string>;
  startAttempted: boolean; startedRunId?: string; completed: boolean;
  outcome?: 'claimed' | 'lost' | 'expired'; record?: HeadlessTestnetRecord;
};
export type HeadlessTestnetResult = {
  status: 'completed' | 'pending' | 'needs-attention'; progress: HeadlessTestnetProgress;
  record?: HeadlessTestnetRecord; message: string; reasonCode?: HeadlessTestnetReason;
};
export type HeadlessTestnetReason = 'already-completed' | 'claimed' | 'lost' | 'expired' | 'timer-running'
  | 'hashless-pending' | 'pending-transaction' | 'not-ready' | 'daily-limit' | 'active-nft-run'
  | 'insufficient-trf' | 'contract-wallet' | 'wrong-wallet' | 'wrong-chain' | 'wrong-owner'
  | 'ineligible-nft' | 'resume-only' | 'interrupted' | 'job-attention' | 'connection-error';
export type HeadlessTestnetOptions = {
  job: HeadlessTestnetJob; progress?: HeadlessTestnetProgress;
  /** Must atomically persist and fsync before returning. Async callbacks are rejected. */
  persist: (progress: HeadlessTestnetProgress) => void;
  provider: EIP1193Provider; client?: PublicClient; rpcUrl?: string; request?: typeof fetch;
  signal?: AbortSignal; resumeOnly?: boolean; maxTimerWaitMs?: number;
  now?: () => number; sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};
const MODES = ['easy', 'normal', 'degen'] as const;
class JobAttention extends Error {
  readonly reasonCode: HeadlessTestnetReason;
  constructor(message: string, reasonCode: HeadlessTestnetReason = 'job-attention') { super(message); this.reasonCode = reasonCode; }
}
const requireThat = (value: unknown, message: string, reasonCode?: HeadlessTestnetReason): void => { if (!value) throw new JobAttention(message, reasonCode); };
function validateJob(job: HeadlessTestnetJob) {
  requireThat(job && job.source === 'testnet' && typeof job.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(job.id), 'Invalid Testnet job ID.');
  requireThat(isAddress(job.address) && !/^0x0{40}$/i.test(job.address), 'A nonzero job wallet is required.');
  requireThat([0, 1].includes(job.collection) && typeof job.tokenId === 'string' && /^[1-9][0-9]{0,77}$/.test(job.tokenId)
    && BigInt(job.tokenId) < 2n ** 256n && MODES.includes(job.difficulty), 'Invalid Testnet NFT or difficulty.');
  requireThat(job.testnet?.allowTransactions === true && job.testnet.claim === true && typeof job.testnet.closeLostRun === 'boolean',
    'An unattended Testnet job requires explicit allowTransactions:true, claim:true, and closeLostRun policy.');
}
function fingerprint(job: HeadlessTestnetJob) {
  return keccak256(toHex(JSON.stringify([job.id, job.source, job.address.toLowerCase(), job.collection,
    job.tokenId, job.difficulty, job.testnet.allowTransactions, job.testnet.claim, job.testnet.closeLostRun])));
}
function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(new Error('Job interrupted. Its saved run can be resumed with the same job ID.')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve(); }, ms);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}

/** One authorized job, at most one start. No mint/faucet, wallet connection
 * prompt, hashless resend, nonce cancellation, or fresh run on resume occurs. */
export async function runHeadlessTestnet(options: HeadlessTestnetOptions): Promise<HeadlessTestnetResult> {
  const { job } = options;
  validateJob(job);
  const expected = fingerprint(job), address = getAddress(job.address);
  const progress: HeadlessTestnetProgress = options.progress ? structuredClone(options.progress) : {
    version: 1, jobId: job.id, address, fingerprint: expected, records: {}, startAttempted: false, completed: false,
  };
  requireThat(progress.version === 1 && progress.jobId === job.id && progress.address.toLowerCase() === address.toLowerCase()
    && progress.fingerprint === expected && typeof progress.startAttempted === 'boolean' && typeof progress.completed === 'boolean'
    && progress.records && typeof progress.records === 'object' && !Array.isArray(progress.records), 'Saved progress does not match this exact job.');
  requireThat(Object.entries(progress.records).length <= 8 && Object.entries(progress.records).every(([key, value]) =>
    key.startsWith('rare-rush:agent-play:v1:') && typeof value === 'string' && value.length <= 1_800_000), 'Invalid job recovery storage.');
  if (progress.startedRunId !== undefined) requireThat(/^[1-9][0-9]{0,77}$/.test(progress.startedRunId), 'Invalid saved run ID.');
  if (progress.outcome !== undefined) requireThat(['claimed', 'lost', 'expired'].includes(progress.outcome), 'Invalid saved job outcome.');
  const persist = () => {
    const result = options.persist(structuredClone(progress)) as unknown;
    requireThat(!(result && typeof (result as PromiseLike<unknown>).then === 'function'), 'Job persistence must be synchronous and durable before any wallet send.');
  };
  const outcome = (status: HeadlessTestnetResult['status'], message: string, reasonCode?: HeadlessTestnetReason): HeadlessTestnetResult => ({ status,
    progress: structuredClone(progress), ...(progress.record ? { record: structuredClone(progress.record) } : {}), message,
    ...(reasonCode ? { reasonCode } : {}) });
  const done = (value: HeadlessTestnetProgress['outcome'], message: string) => {
    progress.completed = true; progress.outcome = value; persist(); return outcome('completed', message, value);
  };
  // The receipt is authoritative for idempotency even if the wallet is offline.
  if (progress.completed) return outcome('completed', `This job is already ${progress.outcome ?? 'completed'}. No wallet request was made.`, 'already-completed');
  persist();
  const now = options.now ?? Date.now, sleep = options.sleep ?? pause;
  const maxWait = options.maxTimerWaitMs ?? 180_000;
  requireThat(Number.isSafeInteger(maxWait) && maxWait >= 0 && maxWait <= 180_000, 'Timer wait must be between 0 and 180000 ms.');
  const rpcUrl = options.rpcUrl ?? RPC_URL;
  const url = new URL(rpcUrl);
  requireThat(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'Use an HTTP(S) RPC without embedded credentials.');
  const client = options.client ?? createPublicClient({ chain: TESTNET_CHAIN, cacheTime: 0,
    transport: http(rpcUrl, { timeout: 12_000, retryCount: 1 }) });
  const stopped = () => requireThat(!options.signal?.aborted, 'Job interrupted. Resume its existing job ID.', 'interrupted');
  const upstreamRequest = options.request ?? fetch;
  const request: typeof fetch = async (input, init) => {
    stopped();
    requireThat(input === '/api/status' || input === '/api/verify-run', 'Unexpected verifier endpoint.');
    const headers = new Headers(init?.headers); headers.set('Origin', AUTH_SITE); headers.set('Sec-Fetch-Site', 'same-origin');
    return upstreamRequest(`${AUTH_SITE}${String(input)}`, { ...init, headers, redirect: 'error' });
  };
  const store = {
    getItem: (key: string) => progress.records[key] ?? null,
    setItem: (key: string, value: string) => {
      const parsed = JSON.parse(value) as PlayState;
      if (parsed?.version === 2) {
        if (parsed.pending?.kind === 'start') progress.startAttempted = true;
        if (parsed.savedRun) {
          requireThat(!progress.startedRunId || progress.startedRunId === parsed.savedRun.run.runId, 'This job cannot replace its original run.');
          progress.startedRunId = parsed.savedRun.run.runId; progress.startAttempted = true;
        }
      }
      progress.records[key] = value; persist();
    },
  };
  // The headless process checks identity before every operation; it needs no
  // browser event listeners or connection prompts from the external provider.
  const provider = { request: options.provider.request.bind(options.provider) } as BrowserWallet;
  const adapter = createTestnetAdapter({ client, provider, store, request });
  const checkIdentity = async () => {
    stopped(); await assertProviderIdentity(options.provider, { chainId: PLAY_CHAIN_ID, address });
    requireThat(await client.getChainId() === PLAY_CHAIN_ID, 'RPC chain does not match Robinhood Testnet.', 'wrong-chain');
  };
  try {
    await checkIdentity();
    const code = await client.getBytecode({ address });
    requireThat(!code || code === '0x', 'Contract wallets are unsupported by the current verifier; use an ECDSA wallet provider.', 'contract-wallet');
    await adapter.restore();
    let snap = adapter.snapshot();
    requireThat(!snap.assetPending, 'Automated jobs cannot recover an unrelated asset mint.');
    if (snap.playState?.pending) {
      if (!snap.playState.pending.hash) return outcome('needs-attention', 'Hashless pending operation: recover its transaction hash manually. This job will not resend it.', 'hashless-pending');
      // Recovery does not open the wallet or allocate a new nonce.
      await adapter.recover(); snap = adapter.snapshot();
    }
    let saved = snap.playState?.savedRun;
    if (!saved) {
      requireThat(!progress.startAttempted && !progress.startedRunId && !options.resumeOnly,
        'This job already attempted a start or is resume-only. Recover its original run; a second entry is forbidden.', 'resume-only');
      requireThat(snap.verified && !snap.paused && snap.verifier === 'ready', 'Testnet contracts or verifier are not ready.', 'not-ready');
      await checkIdentity();
      const selected = await adapter.inspect(job.collection, job.tokenId);
      requireThat(selected.remainingStarts > 0, 'This NFT has used all three starts today.', 'daily-limit');
      if (selected.activeRunId !== '0') {
        const [active, block] = await Promise.all([readRun(client, selected.activeRunId), client.getBlock()]);
        requireThat(active.claimed || active.abandoned || block.timestamp > BigInt(active.claimUntil),
          'This NFT already has an active run from another job. Recover or close that run first.', 'active-nft-run');
      }
      if (job.collection === 0) {
        requireThat((snap.balances?.rf ?? 0n) >= ENTRY_FEE, 'This wallet needs 110 tRF. Automated jobs do not call faucets.', 'insufficient-trf');
        if ((snap.balances?.allowance ?? 0n) < ENTRY_FEE) { await checkIdentity(); await adapter.approve(); }
      }
      await checkIdentity();
      await adapter.start({ collection: job.collection, tokenId: job.tokenId, difficulty: MODES.indexOf(job.difficulty) as 0 | 1 | 2 });
      saved = adapter.snapshot().playState?.savedRun;
    }
    requireThat(saved, 'The original run could not be recovered. No new entry will be submitted.');
    const run = saved!.run;
    requireThat(run.player.toLowerCase() === address.toLowerCase() && run.collection === job.collection
      && run.tokenId === job.tokenId && run.difficulty === MODES.indexOf(job.difficulty)
      && progress.startedRunId === run.runId, 'The recovered run does not match this job identity.');
    if (run.claimed) return done('claimed', 'The original run is already claimed. No additional entry or claim was submitted.');
    if (run.abandoned) return done('lost', 'The original run is already closed. This job will not start another.');
    let block = await client.getBlock();
    if (block.timestamp > BigInt(run.claimUntil)) return done('expired', 'The interrupted run expired. This job will not buy another entry.');
    stopped();
    const session = resumeAgentSession(run.seed, job.difficulty, saved!.replay, saved!.completedTicks);
    runSessionToEnd(session);
    // Both local and deployed engines validate the same legal input stream.
    adapter.saveReplay(run.runId, { version: PROTOCOL_VERSION, frames: session.frames }, session.run._tick);
    progress.record = { source: 'testnet', collection: job.collection, tokenId: job.tokenId, difficulty: job.difficulty,
      seed: run.seed, runId: run.runId, player: run.player, replay: exportAgentReplay(session), metrics: getSessionMetrics(session) };
    persist(); // Complete replay exists on disk before any authorization signature.
    if (session.run.finishReason !== 'time' || session.run.hearts <= 0) {
      if (job.testnet.closeLostRun) { await checkIdentity(); await adapter.abandon(); }
      return done('lost', job.testnet.closeLostRun ? 'Lost run saved and closed onchain.' : 'Lost run saved. The onchain run remains open until expiry or manual close.');
    }
    const endsAt = BigInt(run.startedAt) + BigInt([120, 90, 60][run.difficulty]);
    const waitStarted = now();
    for (let probe = 0; block.timestamp < endsAt; probe++) {
      stopped();
      if (now() - waitStarted >= maxWait || probe >= 90) return outcome('pending', 'Replay saved; onchain timer is still running. Resume this job to verify and claim.', 'timer-running');
      await sleep(Math.min(2_000, maxWait - (now() - waitStarted)), options.signal);
      block = await client.getBlock();
    }
    if (block.timestamp > BigInt(run.claimUntil)) return done('expired', 'The claim window expired. Replay saved; no second entry will be submitted.');
    await checkIdentity();
    saved = adapter.snapshot().playState?.savedRun;
    if (!saved?.claim || BigInt(saved.claim.deadline) <= block.timestamp + 15n) await adapter.verify();
    await checkIdentity();
    const result = await adapter.claim();
    return done('claimed', `Original run claimed ${result.reward ?? '0'} reward units (6 decimals).`);
  } catch (error) {
    const snap = adapter.snapshot();
    const pending = snap.playState?.pending;
    const known: Record<string, HeadlessTestnetReason> = {
      'External provider account does not match the job wallet.': 'wrong-wallet',
      'External provider chain does not match the job network.': 'wrong-chain',
      'Your wallet account changed. Reconnect and try again.': 'wrong-wallet',
      'Wrong network. This action requires Robinhood testnet (46630).': 'wrong-chain',
      'This wallet does not own that test Friend.': 'wrong-owner',
      'The test Generations NFT must be hardwired.': 'ineligible-nft',
    };
    const reasonCode = error instanceof JobAttention ? error.reasonCode
      : error instanceof Error && Object.hasOwn(known, error.message) ? known[error.message]
        : pending ? (pending.hash ? 'pending-transaction' : 'hashless-pending') : 'connection-error';
    const safeKnown = error instanceof Error && Object.hasOwn(known, error.message);
    return outcome(pending?.hash ? 'pending' : 'needs-attention', error instanceof JobAttention || safeKnown ? (error as Error).message
      : pending ? 'A wallet operation needs recovery. Its nonce and any transaction hash are saved; this job will not resubmit it automatically.'
        : 'The Testnet job could not complete. Its run and replay are saved when available. Check the trusted wallet provider locally, then resume the same job ID.', reasonCode);
  } finally { adapter.dispose(); }
}
