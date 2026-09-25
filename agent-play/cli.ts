/** One bounded headless job. Scheduling and signer custody belong to the host. */
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { createPublicClient, http, type EIP1193Provider } from 'viem';
import { publishRun, type PublishedRun } from '../games/rare-rush/public-runs.ts';
import { publicationPayloadHash, type ReplayPublication, type PublicRunArt } from '../shared/replay-publication.ts';
import { GENESIS_DEPLOYMENT } from '../games/rare-rush/genesis/identity.ts';
import { loadArcadeFriend, type ArcadeFriend, type ArcadeProvider } from './arcade.ts';
import { loadExternalProvider } from './wallet-provider.ts';
import { runHeadlessTestnet, type HeadlessTestnetProgress, type HeadlessTestnetOptions, type HeadlessTestnetResult } from './headless-testnet.ts';
import { PROTOCOL_VERSION, advanceAgent, checkAgentReplay, createAgentSession, exportAgentReplay, resumeAgentSession,
  type Replay } from './runner.ts';
import { JobError, openJob, readJobFile, readJobDocument, type JobSpec, type JobRecord, type JobDocument } from './jobs.ts';

const TESTNET_RPC = 'https://rpc.testnet.chain.robinhood.com';
const collectionId = (job: JobSpec): 0 | 1 => job.collection === 'genesis' ? 1 : 0;
const TESTNET_MESSAGES: Record<string, string> = {
  'already-completed': 'This job is already completed. No wallet request was made.',
  claimed: 'The Testnet reward claim is confirmed.',
  lost: 'The run lost and earned no claim. Its result is saved; the configured close-loss policy was applied.',
  expired: 'The original run expired. This job will not start another run.',
  'timer-running': 'The onchain timer is still running. Resume this exact job after the timer completes.',
  'hashless-pending': 'A wallet operation has no confirmed transaction hash. Inspect the external signer; this job will not resend it.',
  'pending-transaction': 'The existing transaction needs confirmation. Resume this exact job to check it again.',
  'not-ready': 'The Testnet contracts or verifier are not ready. Resume this exact job later.',
  'daily-limit': 'This NFT has used its three starts today. No additional entry was submitted.',
  'active-nft-run': 'This NFT already has an active run. Resolve that existing run before another entry.',
  'insufficient-trf': 'The wallet has insufficient tRF for the configured entry fee.',
  'contract-wallet': 'The hosted verifier currently requires EOA player signatures; this wallet is a contract account.',
  'wrong-wallet': 'The external provider account does not match the configured job wallet.',
  'wrong-chain': 'The external provider or RPC is on the wrong network.',
  'wrong-owner': 'The job wallet does not currently own this NFT.',
  'ineligible-nft': 'This Generations NFT is not eligible for the existing game.',
  'resume-only': 'Recovery lacks enough durable evidence to submit a first start. Inspect this job before proceeding.',
  interrupted: 'This job was interrupted. Resume its exact job ID.',
  'job-attention': 'This existing job needs attention. Inspect its saved state before continuing.',
  'connection-error': 'A connection or signer operation did not finish. Resume this exact job; no automatic resend occurs.',
};
const HELP = `Rare Rush headless Agent Play

Usage:
  node agent-play/cli.mjs run --job <job.json> [--jobs-dir <directory>]
  node agent-play/cli.mjs publish --job <job.json> [--jobs-dir <directory>] [--provider-module <trusted module>]
  node agent-play/cli.mjs --help

Job JSON:
  {"version":1,"id":"daily-2026-09-23-friend-1","mode":"preview",
   "collection":"genesis","tokenId":"1","difficulty":"normal"}

Modes: preview, arcade, testnet. Job IDs are required and never generated.
Repeat the exact same job ID and configuration to resume or read its result;
changing the ID creates a separate run and requires existing authorization.
One job can start at most one run.

publish reads an already completed Arcade/Testnet job and asks its wallet to
sign public replay publication. It never runs, resumes, mints or transacts.
Preview cannot be published. An address-only Arcade job needs an explicit
--provider-module signer; its original job file and fingerprint stay unchanged.
The replay, wallet address, Friend artwork and run statistics become public.
Repeated publication is idempotent on the server and signs a fresh message.

Arcade adds wallet:{address,providerModule?} and optional rpcUrl. Without a
provider module, ownership is observed by address, not wallet-authenticated.
Testnet requires wallet:{address,providerModule} and explicit policy:
  testnet:{allowTransactions:true,claim:true,closeLostRun:false}
It can approve the existing entry fee, start one run, sign verification, claim,
and optionally close a loss. It never mints an NFT or retries hashless sends.

providerModule is a trusted local .mjs/.js file, relative to the job JSON.
It must export createProvider({chainId,address,rpcUrl}) returning an EIP-1193
provider. Keep secrets and transaction policy inside that external signer.
Any agent runtime can supply this interface; no wallet vendor is required.
Named framework integrations need their own configured and tested connector.

Results/checkpoints: agent-play/data/jobs/<id>.json by default.
Pending/ambiguous wallet operations retain a wallet lock. Resume that same ID;
never delete recovery files or change the ID to bypass an unresolved operation.
Exit codes: 0 completed/help, 2 pending, 3 needs-attention, 1 invalid/locked.
No schedule or cron entry is created by this command.
`;

export interface RunJobOptions {
  directory: string;
  /** Test seams also allow an embedding agent to inject its own provider. */
  provider?: EIP1193Provider;
  loadProvider?: typeof loadExternalProvider;
  readArcade?: typeof loadArcadeFriend;
  testnetRunner?: (options: HeadlessTestnetOptions) => Promise<HeadlessTestnetResult>;
  seed?: () => string;
}

export interface PublishJobOptions {
  directory: string;
  providerModule?: string;
  provider?: EIP1193Provider;
  loadProvider?: typeof loadExternalProvider;
  fetcher?: typeof fetch;
}

function publicationPayload(job: JobSpec, document: JobDocument): ReplayPublication {
  if (document.status !== 'completed' || !document.record) {
    throw new JobError('NOT_COMPLETED', 'Only an already completed job with its saved replay can be published.');
  }
  if (job.mode === 'preview' || !job.wallet) throw new JobError('PREVIEW_PRIVATE', 'Preview runs stay local and cannot be published.');
  const record = verifyRecord(job, document.record);
  let art: PublicRunArt | undefined;
  if (job.mode === 'arcade') {
    if (!record.art || typeof record.art !== 'object' || Array.isArray(record.art)) throw new JobError('INVALID_STATE', 'The completed Arcade replay is missing its saved Friend artwork.');
    const saved = record.art as PublicRunArt;
    if (saved.collection !== record.collection || saved.tokenId !== record.tokenId || saved.chainId !== 4663
      || typeof saved.owner !== 'string' || saved.owner.toLowerCase() !== job.wallet.address) {
      throw new JobError('INVALID_STATE', 'The saved artwork does not match this job. Preserve the result for inspection.');
    }
    // Do not transmit arbitrary fields from local job/checkpoint/provider files.
    art = { collection: saved.collection, tokenId: saved.tokenId, owner: saved.owner, chainId: 4663, label: saved.label,
      ...(saved.blockNumber !== undefined ? { blockNumber: saved.blockNumber } : {}),
      ...(record.collection === 1 ? { portraitUrl: saved.portraitUrl, bodyId: saved.bodyId } : {
        sprites: saved.sprites ? { familyId: saved.sprites.familyId, seed: saved.sprites.seed, frames: saved.sprites.frames.map(String) } : undefined,
      }) };
  }
  return { source: job.mode, collection: record.collection, tokenId: record.tokenId, difficulty: record.difficulty,
    seed: record.seed, replay: record.replay, player: job.wallet.address, actor: 'agentic',
    ...(job.mode === 'testnet' ? { runId: record.runId } : {}), ...(art ? { art } : {}) };
}

/** Public publication is separate from run/recovery. Completed job files are
 * never rewritten and no run lease, wallet transaction or nonce is acquired.
 */
export async function publishJob(job: JobSpec, options: PublishJobOptions): Promise<PublishedRun> {
  const document = readJobDocument(options.directory, job);
  if (!document) throw new JobError('NOT_COMPLETED', 'No completed result exists for this exact job. Run it separately before publishing.');
  const payload = publicationPayload(job, document), digest = publicationPayloadHash(payload);
  const module = options.providerModule ?? job.wallet?.providerModule;
  if (!options.provider && !module) throw new JobError('SIGNER_REQUIRED', 'Publishing needs this wallet’s trusted provider module. Use --provider-module without changing the original job file.');
  const provider = options.provider ?? await (options.loadProvider ?? loadExternalProvider)({
    providerModule: module!, chainId: job.mode === 'testnet' ? 46630 : 4663, address: job.wallet!.address,
    rpcUrl: job.rpcUrl ?? (job.mode === 'testnet' ? TESTNET_RPC : GENESIS_DEPLOYMENT.rpcUrl),
  });
  const readonlyPublication = { request: ({ method, params }: { method: string; params?: readonly unknown[] | object }) => {
    if (!['eth_accounts', 'eth_chainId', 'eth_signTypedData_v4'].includes(method)) {
      throw new JobError('PUBLICATION_ONLY', 'Publication cannot request a transaction or a new run.');
    }
    return provider.request({ method, params } as never);
  } };
  const assertActive = () => {
    const latest = readJobDocument(options.directory, job);
    if (!latest || publicationPayloadHash(publicationPayload(job, latest)) !== digest) {
      throw new JobError('JOB_CHANGED', 'The completed replay changed during publication. No new run was started.');
    }
  };
  const saved = await publishRun(payload, readonlyPublication, 'https://rarerush.app/api/runs', { fetcher: options.fetcher, assertActive });
  if (saved.id !== digest.slice(2)) throw new JobError('INVALID_RECEIPT', 'Publication returned an unexpected replay identity.');
  return saved;
}
function cleanArt(art: ArcadeFriend): unknown {
  const { sprites, ...identity } = art;
  return { ...identity, ...(sprites ? { sprites: { familyId: sprites.familyId, seed: sprites.seed,
    frames: sprites.frames.map(String) } } : {}) };
}
function readonlyArcadeProvider(job: JobSpec): EIP1193Provider {
  const client = createPublicClient({ transport: http(job.rpcUrl ?? GENESIS_DEPLOYMENT.rpcUrl, { retryCount: 0, timeout: 15_000 }) });
  return { request: async ({ method, params }: { method: string; params?: unknown }) => {
    // This is address observation, explicitly not proof of signing authority.
    if (method === 'eth_accounts') return [job.wallet!.address];
    if (!['eth_chainId', 'eth_blockNumber', 'eth_call'].includes(method)) throw new JobError('READ_ONLY', 'Arcade jobs permit only ownership and artwork reads.');
    return client.request({ method, params } as never);
  } } as EIP1193Provider;
}
function verifyRecord(job: JobSpec, record: JobRecord): JobRecord {
  if (record.source !== (job.mode === 'preview' ? 'local' : job.mode) || record.collection !== collectionId(job)
    || record.tokenId !== job.tokenId || record.difficulty !== job.difficulty
    || (job.wallet && record.player?.toLowerCase() !== job.wallet.address)
    || (job.mode === 'testnet' && (typeof record.runId !== 'string' || !/^[1-9][0-9]{0,77}$/.test(record.runId)))) {
    throw new JobError('INVALID_STATE', 'The recorded result does not match this job. Preserve it for inspection.');
  }
  return { ...record, metrics: checkAgentReplay(record.seed, job.difficulty, record.replay) };
}
/** Only durable preflight proof can permit a first start after lock recovery.
 * Empty/missing progress from a crashed process deliberately fails closed. */
function cleanPreflight(progress: Record<string, unknown>): boolean {
  return progress.version === 1 && progress.startAttempted === false && progress.completed === false
    && !progress.startedRunId && !!progress.records && typeof progress.records === 'object' && !Array.isArray(progress.records);
}
export async function runJob(job: JobSpec, options: RunJobOptions): Promise<JobDocument> {
  const lease = openJob(options.directory, job);
  if (lease.alreadyCompleted) {
    if (lease.document.record) return { ...lease.document, record: verifyRecord(job, lease.document.record) };
    return lease.document;
  }
  let retainWallet = lease.recovered && job.mode === 'testnet';
  let testnetEntered = false;
  try {
    lease.update({ status: 'running', message: 'Running this exact job.' });
    if (job.mode === 'testnet') {
      const provider = options.provider ?? await (options.loadProvider ?? loadExternalProvider)({
        providerModule: job.wallet!.providerModule!, chainId: 46630, address: job.wallet!.address,
        rpcUrl: job.rpcUrl ?? TESTNET_RPC,
      });
      testnetEntered = true; retainWallet = true;
      const progress = Object.keys(lease.document.progress).length ? lease.document.progress as unknown as HeadlessTestnetProgress : undefined;
      const result = await (options.testnetRunner ?? runHeadlessTestnet)({
        job: { id: job.id, source: 'testnet', address: job.wallet!.address, collection: collectionId(job),
          tokenId: job.tokenId, difficulty: job.difficulty, testnet: job.testnet! },
        provider, rpcUrl: job.rpcUrl, progress,
        resumeOnly: lease.recovered && !cleanPreflight(lease.document.progress),
        persist: next => lease.checkpoint(next as unknown as Record<string, unknown>),
      });
      lease.checkpoint(result.progress as unknown as Record<string, unknown>);
      const candidate = result.record ?? lease.document.record;
      const record = candidate ? verifyRecord(job, candidate) : undefined;
      // Only fixed status text reaches logs. Provider/RPC errors may contain
      // endpoint credentials and are intentionally never printed or persisted.
      const reasonCode = result.reasonCode && Object.hasOwn(TESTNET_MESSAGES, result.reasonCode) ? result.reasonCode : undefined;
      const message = reasonCode ? TESTNET_MESSAGES[reasonCode] : result.status === 'completed' ? 'Job completed. No additional run will be started for this ID.'
        : result.status === 'pending' ? 'This job is pending. Run the same job file again to recover its existing operation.'
        : 'This job needs attention. Inspect the external signer and resume this exact job; no automatic resend occurs.';
      lease.update({ status: result.status, ...(record ? { record } : {}), message, reasonCode });
      retainWallet = result.status !== 'completed';
      return lease.document;
    }

    let art: unknown;
    if (job.mode === 'arcade') {
      const provider = options.provider ?? (job.wallet!.providerModule
        ? await (options.loadProvider ?? loadExternalProvider)({ providerModule: job.wallet!.providerModule,
          chainId: 4663, address: job.wallet!.address, rpcUrl: job.rpcUrl ?? GENESIS_DEPLOYMENT.rpcUrl })
        : readonlyArcadeProvider(job));
      art = cleanArt(await (options.readArcade ?? loadArcadeFriend)(provider as ArcadeProvider,
        job.wallet!.address, collectionId(job), job.tokenId));
    }
    const old = lease.document.progress;
    if (Object.keys(old).length && (old.version !== 1 || old.kind !== 'simulation' || typeof old.seed !== 'string')) {
      throw new JobError('INVALID_STATE', 'The saved simulation checkpoint is invalid. Preserve it for inspection.');
    }
    const runSeed = typeof old.seed === 'string' ? old.seed : (options.seed ?? (() => `0x${randomBytes(32).toString('hex')}`))();
    const session = Object.keys(old).length
      ? resumeAgentSession(runSeed, job.difficulty, old.inputs, old.completedTicks as number)
      : createAgentSession(runSeed, job.difficulty);
    const checkpoint = () => lease.checkpoint({ version: 1, kind: 'simulation', seed: runSeed,
      inputs: { version: PROTOCOL_VERSION, frames: session.frames } satisfies Replay, completedTicks: session.run._tick });
    checkpoint(); // Persist the seed before the first simulated tick.
    while (session.run.status === 'running') {
      advanceAgent(session);
      if (session.run._tick % 480 === 0) { checkpoint(); await setImmediate(); }
    }
    const replay = exportAgentReplay(session);
    const record: JobRecord = { source: job.mode === 'preview' ? 'local' : 'arcade', collection: collectionId(job),
      tokenId: job.tokenId, difficulty: job.difficulty, seed: runSeed, replay,
      metrics: checkAgentReplay(runSeed, job.difficulty, replay),
      ...(job.wallet ? { player: job.wallet.address, art, ownership: 'observed-onchain' as const,
        walletAuthentication: job.wallet.providerModule ? 'external-provider' as const : 'address-only' as const } : {}) };
    lease.checkpoint({ ...lease.document.progress, inputs: replay.inputs, completedTicks: replay.finalTick, record });
    lease.update({ status: 'completed', record, message: job.mode === 'arcade' && !job.wallet?.providerModule
      ? 'Completed. Onchain ownership was observed for the supplied address; wallet signing authority was not authenticated.'
      : 'Job completed. Repeating this ID returns the same recorded result.' });
    return lease.document;
  } catch (error) {
    const message = error instanceof JobError ? error.message
      : testnetEntered ? 'The Testnet job needs recovery. Resume this exact job; no automatic resend occurs.'
      : 'The job could not finish. Check its external provider or saved state, then resume this exact job.';
    lease.update({ status: 'needs-attention', message });
    return lease.document;
  } finally { lease.close(retainWallet); }
}

export async function runCli(args: string[], defaults: { directory: string; write?: (line: string) => void;
  publication?: Pick<PublishJobOptions, 'provider' | 'loadProvider' | 'fetcher'> }): Promise<number> {
  const write = defaults.write ?? (line => process.stdout.write(line + '\n'));
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { write(HELP); return 0; }
  let job: JobSpec | undefined;
  let directory = defaults.directory;
  try {
    if (!['run', 'publish'].includes(args[0])) throw new JobError('INVALID_ARGS', 'Use run --job <job.json>, publish --job <job.json>, or --help.');
    let file: string | undefined, providerModule: string | undefined;
    for (let index = 1; index < args.length; index += 2) {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new JobError('INVALID_ARGS', 'Every CLI option needs a value.');
      if (args[index] === '--job' && !file) file = args[index + 1];
      else if (args[index] === '--jobs-dir' && directory === defaults.directory) directory = resolve(args[index + 1]);
      else if (args[0] === 'publish' && args[index] === '--provider-module' && !providerModule) providerModule = resolve(args[index + 1]);
      else throw new JobError('INVALID_ARGS', 'Unsupported or repeated CLI option.');
    }
    if (!file) throw new JobError('INVALID_ARGS', 'A job JSON path is required. Job IDs are never generated.');
    job = readJobFile(resolve(file));
    if (args[0] === 'publish') {
      const saved = await publishJob(job, { directory, ...(providerModule ? { providerModule } : {}), ...defaults.publication });
      write(JSON.stringify({ version: 1, jobId: job.id, status: 'published', id: saved.id,
        url: `https://rarerush.app/runs-feed/?run=${saved.id}`, actor: saved.actor }));
      return 0;
    }
    const document = await runJob(job, { directory });
    let metrics;
    if (document.record) {
      try { metrics = verifyRecord(job, document.record).metrics; }
      catch { /* Retain invalid recovery evidence, but never print its totals. */ }
    }
    write(JSON.stringify({ version: 1, jobId: job.id, status: document.status,
      resultFile: resolve(directory, `${job.id}.json`), message: document.message,
      ...(document.reasonCode ? { reasonCode: document.reasonCode } : {}), ...(metrics ? { metrics } : {}) }));
    return document.status === 'completed' ? 0 : document.status === 'pending' ? 2 : 3;
  } catch (error) {
    write(JSON.stringify({ version: 1, ...(job ? { jobId: job.id } : {}), status: 'error',
      code: error instanceof JobError ? error.code : 'JOB_UNAVAILABLE',
      message: error instanceof JobError ? error.message : 'The job could not be opened. Check the local job path and recovery files.' }));
    return 1;
  }
}
