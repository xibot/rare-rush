import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, getAddress, keccak256, parseAbi, toHex, type Address, type Hash, type PublicClient } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { createTestnetAdapter, createTestnetReadClient, isRetryableTestnetReadError, testnetFriendReadMessage, PLAY_CONTRACTS, ENGINE_VERSION, ENTRY_FEE } from './testnet.ts';
import { nftAbi } from '../testnet-app/src/abi.ts';
import { emptyPlayState, savePlayState, stateKey } from '../testnet-app/src/play/storage.ts';
import { createRecorder, advanceRecorder, exportReplay, queueControls } from '../testnet-app/src/play/recorder.ts';
import { PLAY_GAME_ABI } from '../testnet-app/src/play/chain.ts';
import { demoControls } from '../testnet-app/generated/games/rare-rush/twist/engine.ts';
import { verifyReplay } from '../testnet-app/generated/infra/testnet/src/replay.ts';
import { resultData } from '../testnet-app/generated/infra/testnet/src/protocol.ts';
import { canonicalReplayHash, AUTH_SITE } from '../testnet-app/src/shared/authorization.ts';
import { createVerifierHandlers } from '../testnet-app/server/handler.ts';
import type { BrowserWallet } from '../testnet-app/src/wallet-session.ts';
import runtimes from '../testnet-app/test/fixtures/play-runtimes.json' with { type: 'json' };

// Public, deterministic test identities. No wallet files, credentials or live RPC are used.
const testMnemonic = 'test test test test test test test test test test test junk';
const player = mnemonicToAccount(testMnemonic, { addressIndex: 0 });
const verifier = mnemonicToAccount(testMnemonic, { addressIndex: 2 });
const account = player.address;
const hash = `0x${'2'.repeat(64)}` as Hash;
const blockHash = `0x${'3'.repeat(64)}` as Hash;
const seed = `0x${'4'.repeat(64)}` as Hash;
const prefix = 'rare-rush:agent-play:v1:';
function memory() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
function fixture() {
  const store = memory(), methods: string[] = [];
  const launch = 102_400_000n * 1_000_000n, gameplay = 921_600_000n * 1_000_000n;
  const fields: Record<string, unknown> = {
    ...PLAY_CONTRACTS, token: PLAY_CONTRACTS.rewardToken, ENTRY_FEE,
    PRIZE_POOL_SHARE: 100n * 10n ** 18n, TREASURY_SHARE: 10n * 10n ** 18n, MAX_DAILY_RUNS: 3n,
    engineVersion: ENGINE_VERSION, paused: false, CAP: launch + gameplay, rewardMinter: PLAY_CONTRACTS.game,
    decimals: 6, launchAllocation: launch, expectedLaunchAllocation: launch, rewardAllocation: gameplay,
    rewardsMinted: 0n, totalSupply: launch, INITIAL_COIN_REWARD: 10_000_000n, MIN_COIN_REWARD: 1_000_000n,
    HALVING_INTERVAL: 10_000n, balanceOf: 1100n * 10n ** 18n, allowance: 0n, ownerOf: account,
    generation: 1n, nftKey: seed, dailyStarts: 2n, activeRunByNft: 0n, lastFaucetDayPlusOne: 0n,
  };
  let chain = '0xb626', sendFailure: unknown = null;
  let submitted: Record<string, string> | undefined;
  const provider = { request: async ({ method, params }: { method: string; params?: any[] }) => {
    methods.push(method);
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
    if (method === 'eth_chainId') return chain;
    if (method === 'eth_sendTransaction') {
      submitted = params![0];
      const persisted = JSON.parse(store.getItem(`${prefix}assets:46630:${account.toLowerCase()}`)!);
      assert.equal(persisted.nonce, 9); assert.equal(persisted.hash, null);
      if (sendFailure) throw sendFailure;
      return hash;
    }
    throw new Error(`Unexpected wallet call ${method}`);
  } } as BrowserWallet;
  const client = {
    getChainId: async () => 46630, getBlockNumber: async () => 101n,
    getBytecode: async ({ address }: { address: Address }) => {
      const key = (Object.keys(PLAY_CONTRACTS) as (keyof typeof PLAY_CONTRACTS)[]).find(key => PLAY_CONTRACTS[key] === address)!;
      return runtimes.code[key];
    },
    getBalance: async () => 10n ** 18n, getBlock: async () => ({ number: 100n, hash: blockHash, timestamp: 1000n }),
    readContract: async ({ functionName }: { functionName: string }) => {
      assert.ok(functionName in fields, functionName); return fields[functionName];
    },
    call: async () => ({}), getTransactionCount: async () => 9,
    getTransaction: async () => ({ from: account, to: submitted!.to, nonce: 9, chainId: 46630,
      hash, input: submitted!.data, value: 0n, blockHash, blockNumber: 100n }),
    waitForTransactionReceipt: async () => ({ status: 'success', from: account, to: submitted!.to,
      transactionHash: hash, blockHash, blockNumber: 100n, logs: [{ address: PLAY_CONTRACTS.genesis,
        topics: encodeEventTopics({ abi: nftAbi, eventName: 'Transfer', args: {
          from: `0x${'0'.repeat(40)}`, to: account, tokenId: 42n } }), data: '0x' }] }),
  } as unknown as PublicClient;
  const requests: string[] = [];
  const request: typeof fetch = async input => {
    requests.push(String(input));
    assert.equal(input, '/api/status');
    return Response.json({ ready: true, chainId: 46630, game: PLAY_CONTRACTS.game, engineVersion: ENGINE_VERSION });
  };
  const adapter = createTestnetAdapter({ client, provider, store, request });
  return { adapter, store, fields, methods, requests, request, provider, client,
    wrongChain: () => { chain = '0x1'; }, failSend: (error: unknown) => { sendFailure = error; } };
}

test('restore and NFT inspection are read-only, isolated, and reflect three starts per NFT', async () => {
  const f = fixture(); await f.adapter.restore();
  const selected = await f.adapter.inspect(0, '7');
  assert.equal(selected.remainingStarts, 1);
  assert.equal(f.adapter.snapshot().verified, true);
  assert.equal(f.adapter.snapshot().verifier, 'ready');
  assert.deepEqual(f.requests, ['/api/status']);
  assert.equal(f.adapter.snapshot().balances?.rf, 1100n * 10n ** 18n);
  assert.ok(f.methods.every(method => ['eth_accounts', 'eth_chainId'].includes(method)));
  assert.equal(f.store.getItem(stateKey(account)), null, 'production namespace stays untouched');
  assert.ok(f.store.getItem(prefix + stateKey(account)));
});

test('Friend preparation recovers failed initial RPC readiness without a wallet prompt or transaction', async () => {
  const f = fixture(), original = f.client.getChainId;
  f.client.getChainId = (async () => { throw new Error('HTTP request failed.'); }) as typeof original;
  await assert.rejects(f.adapter.restore(), /HTTP request failed/);
  assert.equal(f.adapter.snapshot().account, account);
  assert.equal(f.adapter.snapshot().verified, false);
  f.client.getChainId = original;
  const selected = await f.adapter.prepareFriend(0, '7');
  assert.equal(selected.tokenId, '7'); assert.equal(f.adapter.snapshot().verified, true);
  assert.equal(f.adapter.snapshot().verifier, 'ready'); assert.ok(f.adapter.snapshot().balances);
  assert.ok(f.methods.every(method => ['eth_accounts', 'eth_chainId'].includes(method)));
  assert.equal(isRetryableTestnetReadError(new Error('HTTP request failed.')), true);
  assert.equal(isRetryableTestnetReadError(new Error('This wallet does not own that test Friend.')), false);
  assert.match(testnetFriendReadMessage(new Error('HTTP request failed.')), /No transaction was requested/);
});

test('balance failure clears readiness data and preparation retries all missing reads', async () => {
  const f = fixture(); await f.adapter.restore(); await f.adapter.inspect(0, '7');
  const original = f.client.getBalance;
  f.client.getBalance = (async () => { throw new Error('HTTP request failed.'); }) as typeof original;
  await assert.rejects(f.adapter.refresh());
  assert.equal(f.adapter.snapshot().balances, null);
  f.client.getBalance = original;
  await f.adapter.prepareFriend(0, '7');
  assert.ok(f.adapter.snapshot().balances); assert.equal(f.adapter.snapshot().selected?.tokenId, '7');
});

test('a slower old selection cannot overwrite the newer checked Friend', async () => {
  const f = fixture(); await f.adapter.restore();
  const original = f.client.readContract;
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  f.client.readContract = (async (input: any) => {
    if(input.functionName === 'ownerOf' && input.args[0] === 7n) await delayed;
    return original(input);
  }) as typeof original;
  const old = f.adapter.prepareFriend(0, '7');
  const rejection = assert.rejects(old, /selected Friend changed/);
  await f.adapter.prepareFriend(0, '8'); release(); await rejection;
  assert.equal(f.adapter.snapshot().selected?.tokenId, '8');
  assert.ok(f.methods.every(method => ['eth_accounts', 'eth_chainId'].includes(method)));
});

test('the actual read transport batches parallel RPC requests into groups of at most twenty', async () => {
  const batches: any[][] = [];
  const client = createTestnetReadClient('https://rpc.test.invalid', async (_url, init) => {
    const input = JSON.parse(String(init?.body));
    assert.ok(Array.isArray(input)); batches.push(input);
    return Response.json(input.map(item => ({ jsonrpc: '2.0', id: item.id,
      result: item.method === 'eth_chainId' ? '0xb626' : '0x64' })));
  });
  const results = await Promise.all(Array.from({ length: 45 }, (_, index) => client.getBalance({ address: `0x${(index + 1).toString(16).padStart(40, '0')}` as Address })));
  assert.ok(results.every(value => value === 100n));
  assert.equal(batches.length, 3); assert.ok(batches.every(batch => batch.length <= 20));
  assert.ok(batches.every(batch => batch.every(item => item.method === 'eth_getBalance')));
});

test('mint requires explicit call, persists before wallet send, validates receipt and remembers the minted ID', async () => {
  const f = fixture(); await f.adapter.restore();
  assert.equal(f.methods.filter(method => method === 'eth_sendTransaction').length, 0);
  const result = await f.adapter.mint(1);
  assert.deepEqual(result.tokenIds, ['42']);
  assert.equal(f.methods.filter(method => method === 'eth_sendTransaction').length, 1);
  assert.equal(f.adapter.snapshot().assetPending, null);
  assert.deepEqual(f.adapter.snapshot().playState?.friends, [{ collection: 1, tokenId: '42' }]);
});

test('an ambiguous mint error survives reload and prevents duplicate asset or run writes', async () => {
  const f = fixture(); await f.adapter.restore(); f.failSend(new Error('connection lost after submit'));
  await assert.rejects(f.adapter.mint(1), /connection lost/);
  assert.equal(f.adapter.snapshot().assetPending?.nonce, 9);
  assert.equal(f.adapter.snapshot().assetPending?.hash, null);
  const recovered = createTestnetAdapter({ client: f.client, provider: f.provider, store: f.store, request: f.request });
  await recovered.restore();
  await assert.rejects(recovered.mint(1), /pending transaction/);
  await assert.rejects(recovered.start({ collection: 1, tokenId: '42', difficulty: 1 }), /pending transaction/);
  await assert.rejects(recovered.recover(), /Paste the submitted/);
  assert.equal(f.methods.filter(method => method === 'eth_sendTransaction').length, 1);
  await recovered.recover(hash);
  assert.equal(recovered.snapshot().assetPending, null);
  assert.equal(recovered.snapshot().playState?.friends[0].tokenId, '42');
});

test('wallet rejection clears unsent mint intent and contract mismatch blocks the wallet', async () => {
  const f = fixture(); await f.adapter.restore(); f.failSend({ code: 4001, message: 'User rejected' });
  await assert.rejects(f.adapter.mint(1));
  assert.equal(f.adapter.snapshot().assetPending, null);
  f.fields.MAX_DAILY_RUNS = 4n;
  await assert.rejects(f.adapter.mint(1), /Unexpected game settings/);
  assert.equal(f.methods.filter(method => method === 'eth_sendTransaction').length, 1);
});

test('saved replay outcome is rebuilt from the chain seed and cannot be rewound or fabricated', async () => {
  const f = fixture(); f.wrongChain();
  const state = emptyPlayState(account);
  state.savedRun = { run: { runId: '5', player: account, collection: 1, tokenId: '42', difficulty: 1,
    seed, startedAt: '1000', claimUntil: '1990', verifierEpoch: '1', claimed: false, abandoned: false },
    replay: { version: 'rare-rush-input-v2', frames: [] }, completedTicks: 0, status: 'ready' };
  savePlayState({ getItem: key => f.store.getItem(prefix + key), setItem: (key, value) => f.store.setItem(prefix + key, value) }, state);
  await f.adapter.restore();
  const recording = createRecorder(seed, 'normal');
  advanceRecorder(recording);
  f.adapter.saveReplay('5', exportReplay(recording), 1);
  assert.equal(f.adapter.snapshot().playState?.savedRun?.status, 'playing');
  assert.throws(() => f.adapter.saveReplay('5', { version: 'rare-rush-input-v2', frames: [] }, 0), /Newer progress/);
  while (recording.run.status === 'running') advanceRecorder(recording);
  const ended = f.adapter.saveReplay('5', exportReplay(recording), recording.run._tick);
  assert.equal(ended.savedRun?.status, 'lost');
  assert.throws(() => f.adapter.saveReplay('5', exportReplay(recording), 10800), /after this run ended/);
  assert.ok(f.methods.every(method => ['eth_accounts', 'eth_chainId'].includes(method)));
});

test('explicit approve → start → complete → wallet authorization → verifier → claim with durable recovery state', async () => {
  const f = fixture();
  const runSeed = keccak256(toHex('rare-rush-replay-test'));
  const approvalAbi = parseAbi(['function approve(address spender,uint256 value) returns(bool)', 'event Approval(address indexed owner,address indexed spender,uint256 value)']);
  const fields = f.fields;
  fields.verifier = verifier.address; fields.verifierEpoch = 1n; fields.dailyStarts = 0n;
  let nonce = 9, timestamp = 1000n, blockNumber = 100n, claimed = false;
  let exposedAccount = account;
  let transaction: any, receipt: any;
  const methods: string[] = [], calls: string[] = [];
  const originalRead = f.client.readContract;
  f.client.readContract = (async (input: any) => input.functionName === 'runs'
    ? [account, 7n, runSeed, 1000n, 1990n, 0, 1, claimed, 1n, false]
    : originalRead(input)) as typeof originalRead;
  f.client.getBlock = (async () => ({ number: blockNumber, hash: blockHash, timestamp })) as typeof f.client.getBlock;
  f.client.getBlockNumber = (async () => blockNumber + 1n) as typeof f.client.getBlockNumber;
  f.client.getTransactionCount = (async () => nonce) as typeof f.client.getTransactionCount;
  f.client.getTransaction = (async () => transaction) as typeof f.client.getTransaction;
  f.client.waitForTransactionReceipt = (async () => receipt) as typeof f.client.waitForTransactionReceipt;
  const provider = { request: async ({ method, params }: { method: string; params?: any[] }) => {
    methods.push(method);
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [exposedAccount];
    if (method === 'eth_chainId') return '0xb626';
    if (method === 'eth_signTypedData_v4') {
      assert.equal(params![0].toLowerCase(), account.toLowerCase());
      return player.signTypedData(JSON.parse(params![1]));
    }
    assert.equal(method, 'eth_sendTransaction');
    const sent = params![0];
    const state = JSON.parse(f.store.getItem(prefix + stateKey(account))!);
    assert.equal(state.pending.hash, null, 'operation persists before wallet submission');
    assert.equal(state.pending.nonce, nonce);
    assert.equal(state.pending.data, sent.data);
    assert.equal(sent.nonce, toHex(nonce));
    const abi = sent.to.toLowerCase() === PLAY_CONTRACTS.rf ? approvalAbi : PLAY_GAME_ABI;
    const decoded = decodeFunctionData({ abi, data: sent.data }) as { functionName: string; args: any[] };
    calls.push(decoded.functionName);
    const txHash = toHex(BigInt(nonce), { size: 32 });
    blockNumber++;
    transaction = { from: account, to: sent.to, nonce: nonce++, chainId: 46630,
      hash: txHash, input: sent.data, value: 0n, blockHash, blockNumber };
    let log: any;
    if (decoded.functionName === 'approve') {
      assert.deepEqual(decoded.args, [getAddress(PLAY_CONTRACTS.game), ENTRY_FEE]);
      fields.allowance = ENTRY_FEE;
      log = { address: PLAY_CONTRACTS.rf, topics: encodeEventTopics({ abi: approvalAbi, eventName: 'Approval',
        args: { owner: account, spender: PLAY_CONTRACTS.game } }), data: encodeAbiParameters([{ type: 'uint256' }], [ENTRY_FEE]) };
    } else if (decoded.functionName === 'startRun') {
      assert.deepEqual(decoded.args, [0, 7n, 1]);
      fields.allowance = 0n; fields.dailyStarts = 1n; fields.activeRunByNft = 5n;
      const nft = keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }], [0, 7n]));
      log = { address: PLAY_CONTRACTS.game, topics: encodeEventTopics({ abi: PLAY_GAME_ABI, eventName: 'RunStarted',
        args: { runId: 5n, player: account, nft } }), data: encodeAbiParameters([
          { type: 'uint8' }, { type: 'uint256' }, { type: 'uint8' }, { type: 'bytes32' },
          { type: 'uint64' }, { type: 'uint64' }, { type: 'uint256' },
        ], [0, 7n, 1, runSeed, 1000n, 1990n, 1n]) };
    } else {
      assert.equal(decoded.functionName, 'claim');
      assert.equal(decoded.args[0], 5n);
      claimed = true; fields.activeRunByNft = 0n;
      log = { address: PLAY_CONTRACTS.game, topics: encodeEventTopics({ abi: PLAY_GAME_ABI, eventName: 'RunClaimed',
        args: { runId: 5n, player: account } }), data: encodeAbiParameters([
          { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' },
        ], [BigInt((decoded.args[1].length - 2) / 2), 12_345_000n, decoded.args[2]]) };
    }
    receipt = { status: 'success', from: account, to: sent.to, transactionHash: txHash, blockHash, blockNumber, logs: [log] };
    return txHash;
  } } as BrowserWallet;
  let verificationRequests = 0;
  const handlers = createVerifierHandlers({
    status: async () => ({ ready: true, chainId: 46630, game: PLAY_CONTRACTS.game,
      engineVersion: ENGINE_VERSION, verifier: verifier.address, reason: 'ready' }),
    verify: async ({ runId, replay, expectedPlayer }) => {
      assert.equal(runId, 5n); assert.equal(expectedPlayer, account);
      const result = verifyReplay(runSeed, 1, replay);
      const replayHash = canonicalReplayHash(replay), deadline = '1900';
      const signature = await verifier.signTypedData(resultData(46630, PLAY_CONTRACTS.game, {
        runId, player: expectedPlayer, runSeed, pickupKinds: result.pickupKinds, replayHash,
        engineVersion: ENGINE_VERSION, deadline: BigInt(deadline), verifierEpoch: 1n,
      }));
      return { chainId: 46630, game: PLAY_CONTRACTS.game, runId: String(runId), player: expectedPlayer,
        engineVersion: ENGINE_VERSION, pickupKinds: result.pickupKinds, replayHash, deadline, signature,
        verifiedAtBlock: String(blockNumber), claimArgs: [String(runId), result.pickupKinds, replayHash, deadline, signature] };
    },
  });
  const request: typeof fetch = async (input, init) => {
    if (input === '/api/status') return handlers.status(new Request(AUTH_SITE + input));
    assert.equal(input, '/api/verify-run'); verificationRequests++;
    return handlers.verify(new Request(AUTH_SITE + input, { ...init,
      headers: { 'Content-Type': 'application/json', Origin: AUTH_SITE } }));
  };
  const adapter = createTestnetAdapter({ client: f.client, provider, store: f.store, request });
  await adapter.connect();
  assert.equal(adapter.snapshot().verifier, 'ready');
  assert.deepEqual(calls, []); assert.equal(verificationRequests, 0);
  await adapter.inspect(0, '7'); await adapter.approve();
  assert.deepEqual(calls, ['approve']);
  const run = await adapter.start({ collection: 0, tokenId: '7', difficulty: 1 });
  assert.equal(run.seed, runSeed); assert.equal(run.runId, '5');
  assert.equal(adapter.snapshot().selected?.remainingStarts, 2);
  const recording = createRecorder(run.seed, 'normal');
  while (recording.run.status === 'running') {
    const controls = demoControls(recording.run);
    queueControls(recording, { pace: controls.axis, jump: controls.jump, slide: controls.slide });
    advanceRecorder(recording);
  }
  const replay = exportReplay(recording);
  adapter.saveReplay(run.runId, replay, recording.run._tick);
  assert.equal(adapter.snapshot().playState?.savedRun?.status, 'survived');
  assert.equal(verificationRequests, 0); assert.equal(methods.includes('eth_signTypedData_v4'), false);
  await assert.rejects(adapter.verify(), /Wait 90 seconds/);
  assert.equal(methods.includes('eth_signTypedData_v4'), false, 'timer check occurs before wallet prompt');
  timestamp = 1091n;
  const claim = await adapter.verify();
  assert.equal(verificationRequests, 1); assert.equal(methods.filter(m => m === 'eth_signTypedData_v4').length, 1);
  adapter.saveReplay(run.runId, replay, recording.run._tick); // pagehide checkpoint
  assert.deepEqual(adapter.snapshot().playState?.savedRun?.claim, claim, 'identical checkpoint preserves the signed claim');
  const restored = createTestnetAdapter({ client: f.client, provider, store: f.store, request });
  await restored.restore();
  assert.deepEqual(restored.snapshot().playState?.savedRun?.claim, claim);
  assert.deepEqual(calls, ['approve', 'startRun'], 'reload does not submit a claim');
  exposedAccount = verifier.address;
  await assert.rejects(restored.claim(), /wallet account changed/);
  assert.deepEqual(calls, ['approve', 'startRun'], 'changed wallet cannot claim the old player run');
  exposedAccount = account;
  const result = await restored.claim();
  assert.equal(result.reward, '12345000'); assert.equal(result.state.savedRun?.status, 'claimed');
  assert.deepEqual(calls, ['approve', 'startRun', 'claim']);
  assert.equal(result.state.pending, null);
  assert.deepEqual(result.state.history.map(h => h.kind), ['approve', 'start', 'claim']);
  await assert.rejects(restored.claim(), /already finalized/);
  assert.deepEqual(calls, ['approve', 'startRun', 'claim']);
});
