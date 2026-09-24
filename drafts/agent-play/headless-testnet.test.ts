import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, keccak256, parseAbi, toHex, type EIP1193Provider, type PublicClient } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { runHeadlessTestnet, type HeadlessTestnetJob, type HeadlessTestnetProgress } from './headless-testnet.ts';
import { PLAY_CONTRACTS, ENGINE_VERSION, ENTRY_FEE } from './testnet.ts';
import { PLAY_GAME_ABI } from '../../testnet-app/src/play/chain.ts';
import { canonicalReplayHash, AUTH_SITE } from '../../testnet-app/src/shared/authorization.ts';
import { createVerifierHandlers } from '../../testnet-app/server/handler.ts';
import { resultData } from '../../testnet-app/generated/infra/testnet/src/protocol.ts';
import { verifyReplay } from '../../testnet-app/generated/infra/testnet/src/replay.ts';
import runtimes from '../../testnet-app/test/fixtures/play-runtimes.json' with { type: 'json' };

// Published Hardhat fixture identities; all chain/provider calls below are mocks.
const mnemonic = 'test test test test test test test test test test test junk';
const player = mnemonicToAccount(mnemonic), verifier = mnemonicToAccount(mnemonic, { addressIndex: 2 });
const seed = keccak256(toHex('rare-rush-replay-test')), blockHash = keccak256(toHex('mock block'));
const approvalAbi = parseAbi(['function approve(address spender,uint256 value) returns(bool)', 'event Approval(address indexed owner,address indexed spender,uint256 value)']);
function fixture() {
  const job: HeadlessTestnetJob = { id: 'morning-1', source: 'testnet', address: player.address,
    collection: 0, tokenId: '7', difficulty: 'normal', testnet: { allowTransactions: true, claim: true, closeLostRun: false } };
  const launch = 102_400_000n * 1_000_000n, allocation = 921_600_000n * 1_000_000n;
  const fields: Record<string, any> = { ...PLAY_CONTRACTS, token: PLAY_CONTRACTS.rewardToken,
    ENTRY_FEE, PRIZE_POOL_SHARE: 100n * 10n ** 18n, TREASURY_SHARE: 10n * 10n ** 18n,
    MAX_DAILY_RUNS: 3n, engineVersion: ENGINE_VERSION, paused: false, CAP: launch + allocation,
    rewardMinter: PLAY_CONTRACTS.game, decimals: 6, launchAllocation: launch, expectedLaunchAllocation: launch,
    rewardAllocation: allocation, rewardsMinted: 0n, totalSupply: launch, INITIAL_COIN_REWARD: 10_000_000n,
    MIN_COIN_REWARD: 1_000_000n, HALVING_INTERVAL: 10_000n, balanceOf: 1100n * 10n ** 18n,
    allowance: 0n, ownerOf: player.address, generation: 1n, nftKey: seed, dailyStarts: 0n, activeRunByNft: 0n,
    verifier: verifier.address, verifierEpoch: 1n };
  let timestamp = 1000n, blockNumber = 100n, nonce = 9, claimed = false;
  let code: string | undefined, hashless = false, waiting = false;
  let progress: HeadlessTestnetProgress | undefined, tx: any, receipt: any;
  const calls: string[] = [], wallet: string[] = [];
  const client = {
    getChainId: async () => 46630, getBlockNumber: async () => blockNumber + 1n,
    getBlock: async () => ({ timestamp, number: blockNumber, hash: blockHash }), getBalance: async () => 1n,
    getBytecode: async ({ address }: any) => {
      if (address.toLowerCase() === player.address.toLowerCase()) return code;
      const key = Object.keys(PLAY_CONTRACTS).find(k => PLAY_CONTRACTS[k as keyof typeof PLAY_CONTRACTS] === address)!;
      return runtimes.code[key as keyof typeof runtimes.code];
    },
    readContract: async ({ functionName }: any) => functionName === 'runs'
      ? [player.address, 7n, seed, 1000n, 1990n, 0, 1, claimed, 1n, false] : fields[functionName],
    call: async () => ({}), getTransactionCount: async () => nonce,
    getTransaction: async () => tx,
    waitForTransactionReceipt: async () => { if (waiting) throw new Error('Timeout fetching https://private.invalid/?key=secret'); return receipt; },
  } as unknown as PublicClient;
  const provider = { request: async ({ method, params }: any) => {
    wallet.push(method);
    if (method === 'eth_accounts') return [player.address];
    if (method === 'eth_chainId') return '0xb626';
    if (method === 'eth_signTypedData_v4') {
      assert.ok(progress?.record, 'terminal replay is durable before authorization');
      return player.signTypedData(JSON.parse(params[1]));
    }
    assert.equal(method, 'eth_sendTransaction', 'unattended job never requests connection, faucet, or mint');
    const sent = params[0];
    const persisted = Object.values(progress!.records).map(value => JSON.parse(value)).find(value => value.version === 2);
    assert.equal(persisted.pending.nonce, nonce); assert.equal(persisted.pending.hash, null);
    assert.equal(persisted.pending.data, sent.data);
    const decoded = decodeFunctionData({ abi: sent.to.toLowerCase() === PLAY_CONTRACTS.rf ? approvalAbi : PLAY_GAME_ABI, data: sent.data }) as { functionName: string; args: any[] };
    calls.push(decoded.functionName); const hash = toHex(BigInt(nonce), { size: 32 }); blockNumber++;
    tx = { from: player.address, to: sent.to, nonce: nonce++, chainId: 46630, hash, input: sent.data,
      value: 0n, blockHash, blockNumber };
    let log: any;
    if (decoded.functionName === 'approve') {
      assert.equal(decoded.args[1], ENTRY_FEE); fields.allowance = ENTRY_FEE;
      log = { address: PLAY_CONTRACTS.rf, topics: encodeEventTopics({ abi: approvalAbi, eventName: 'Approval',
        args: { owner: player.address, spender: PLAY_CONTRACTS.game } }), data: encodeAbiParameters([{ type: 'uint256' }], [ENTRY_FEE]) };
    } else if (decoded.functionName === 'startRun') {
      assert.equal(progress!.startAttempted, true); fields.dailyStarts = 1n; fields.activeRunByNft = 5n; fields.allowance = 0n;
      const nft = keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }], [0, 7n]));
      log = { address: PLAY_CONTRACTS.game, topics: encodeEventTopics({ abi: PLAY_GAME_ABI, eventName: 'RunStarted',
        args: { runId: 5n, player: player.address, nft } }), data: encodeAbiParameters([
          { type: 'uint8' }, { type: 'uint256' }, { type: 'uint8' }, { type: 'bytes32' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'uint256' },
        ], [0, 7n, 1, seed, 1000n, 1990n, 1n]) };
    } else {
      assert.equal(decoded.functionName, 'claim'); claimed = true; fields.activeRunByNft = 0n;
      assert.ok(progress!.record);
      log = { address: PLAY_CONTRACTS.game, topics: encodeEventTopics({ abi: PLAY_GAME_ABI, eventName: 'RunClaimed',
        args: { runId: 5n, player: player.address } }), data: encodeAbiParameters([
          { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' },
        ], [BigInt((decoded.args[1].length - 2) / 2), 12_345_000n, decoded.args[2]]) };
    }
    receipt = { status: 'success', from: player.address, to: sent.to, transactionHash: hash, blockHash, blockNumber, logs: [log] };
    if (decoded.functionName === 'startRun' && hashless) throw new Error('Uncertain send to https://private.invalid/?key=secret');
    return hash;
  } } as EIP1193Provider;
  const handlers = createVerifierHandlers({
    status: async () => ({ ready: true, chainId: 46630, game: PLAY_CONTRACTS.game, engineVersion: ENGINE_VERSION, verifier: verifier.address, reason: 'ready' }),
    verify: async ({ runId, replay, expectedPlayer }) => {
      const result = verifyReplay(seed, 1, replay), replayHash = canonicalReplayHash(replay), deadline = '1900';
      const signature = await verifier.signTypedData(resultData(46630, PLAY_CONTRACTS.game, { runId, player: expectedPlayer,
        runSeed: seed, pickupKinds: result.pickupKinds, replayHash, engineVersion: ENGINE_VERSION, deadline: 1900n, verifierEpoch: 1n }));
      return { chainId: 46630, game: PLAY_CONTRACTS.game, runId: String(runId), player: expectedPlayer,
        engineVersion: ENGINE_VERSION, pickupKinds: result.pickupKinds, replayHash, deadline, signature,
        verifiedAtBlock: String(blockNumber), claimArgs: [String(runId), result.pickupKinds, replayHash, deadline, signature] };
    },
  });
  const request: typeof fetch = async (input, init) => {
    assert.ok(String(input).startsWith(AUTH_SITE));
    const req = new Request(input, init);
    assert.equal(req.headers.get('Origin'), AUTH_SITE);
    return String(input).endsWith('/api/status') ? handlers.status(req) : handlers.verify(req);
  };
  const options = { job, client, provider, request,
    persist: (value: HeadlessTestnetProgress) => { progress = structuredClone(value); },
    sleep: async () => { timestamp += 2n; }, now: () => Number(timestamp) * 1000 };
  return { options, calls, wallet, getProgress: () => progress!,
    setTime: (value: bigint) => { timestamp = value; }, setCode: (value: string) => { code = value; },
    setHashless: () => { hashless = true; }, setWaiting: (value: boolean) => { waiting = value; } };
}

test('full unattended job uses one entry, signed verified claim, durable replay, and offline duplicate completion', async () => {
  const f = fixture(); const result = await runHeadlessTestnet(f.options);
  assert.equal(result.status, 'completed', result.message); assert.equal(result.progress.outcome, 'claimed');
  assert.equal(result.record?.metrics.outcome, 'survived'); assert.ok(result.record!.replay.inputs.frames.length);
  assert.deepEqual(f.calls, ['approve', 'startRun', 'claim']);
  assert.equal(f.wallet.includes('eth_requestAccounts'), false);
  const callsBefore = f.wallet.length;
  const repeated = await runHeadlessTestnet({ ...f.options, progress: result.progress });
  assert.equal(repeated.status, 'completed'); assert.equal(f.wallet.length, callsBefore);
});

test('timer wait is bounded and saved replay resumes without paying a second entry', async () => {
  const f = fixture(); const first = await runHeadlessTestnet({ ...f.options, maxTimerWaitMs: 0 });
  assert.equal(first.status, 'pending'); assert.equal(first.reasonCode, 'timer-running'); assert.ok(first.record); assert.deepEqual(f.calls, ['approve', 'startRun']);
  assert.equal(f.wallet.includes('eth_signTypedData_v4'), false);
  f.setTime(1091n);
  const resumed = await runHeadlessTestnet({ ...f.options, progress: first.progress, resumeOnly: true });
  assert.equal(resumed.status, 'completed', resumed.message); assert.deepEqual(f.calls, ['approve', 'startRun', 'claim']);
});

test('expired interrupted run completes without a new entry or signature', async () => {
  const f = fixture(); const first = await runHeadlessTestnet({ ...f.options, maxTimerWaitMs: 0 });
  f.setTime(2000n);
  const result = await runHeadlessTestnet({ ...f.options, progress: first.progress });
  assert.equal(result.status, 'completed'); assert.equal(result.progress.outcome, 'expired'); assert.ok(result.record);
  assert.deepEqual(f.calls, ['approve', 'startRun']); assert.equal(f.wallet.includes('eth_signTypedData_v4'), false);
});

test('hashless start is never resubmitted and raw provider diagnostics do not leak', async () => {
  const f = fixture(); f.setHashless();
  const first = await runHeadlessTestnet(f.options);
  assert.equal(first.status, 'needs-attention'); assert.equal(first.progress.startAttempted, true);
  assert.doesNotMatch(first.message, /private|secret/);
  const result = await runHeadlessTestnet({ ...f.options, progress: first.progress });
  assert.equal(result.status, 'needs-attention'); assert.equal(result.reasonCode, 'hashless-pending'); assert.match(result.message, /Hashless/);
  assert.deepEqual(f.calls, ['approve', 'startRun']);
});

test('pending approval is recovered read-only; no fresh nonce or second approval is sent', async () => {
  const f = fixture(); f.setWaiting(true);
  const first = await runHeadlessTestnet(f.options);
  assert.equal(first.status, 'pending'); assert.deepEqual(f.calls, ['approve']);
  f.setWaiting(false);
  const result = await runHeadlessTestnet({ ...f.options, progress: first.progress });
  assert.equal(result.status, 'completed', result.message); assert.deepEqual(f.calls, ['approve', 'startRun', 'claim']);
});

test('contract wallets, missing policy, changed job, and asynchronous persistence fail before sends', async () => {
  const f = fixture(); f.setCode('0x6000');
  const result = await runHeadlessTestnet(f.options);
  assert.equal(result.status, 'needs-attention'); assert.equal(result.reasonCode, 'contract-wallet'); assert.match(result.message, /Contract wallets/); assert.deepEqual(f.calls, []);
  await assert.rejects(runHeadlessTestnet({ ...f.options, job: { ...f.options.job, testnet: { ...f.options.job.testnet, allowTransactions: false } } as any }), /explicit/);
  await assert.rejects(runHeadlessTestnet({ ...f.options, progress: { ...result.progress, jobId: 'different' } }), /exact job/);
  await assert.rejects(runHeadlessTestnet({ ...f.options, persist: (async () => {}) as any }), /synchronous/);
  assert.deepEqual(f.calls, []);
});
