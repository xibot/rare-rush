import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, parseAbi, toHex, type Address, type EIP1193Provider, type Hash, type Hex, type Log, type PublicClient, type TransactionReceipt } from 'viem';
import { PLAY_GAME_ABI, PLAY_CONTRACTS, DEPLOYMENT_BLOCK, ENTRY_FEE, approveEntry, startRun, recoverPending, retryHashlessPending, cancelHashlessPending, assertRunStarted, assertRunClaimed, discoverFriends, type PlayContext } from '../src/play/chain.ts';
import { emptyPlayState, loadPlayState, savePlayState } from '../src/play/storage.ts';
import { ENGINE_VERSION, type PendingOperation, type VerifiedClaim } from '../src/play/types.ts';
import deployedRuntimes from './fixtures/play-runtimes.json' with { type: 'json' };

const account = `0x${'1'.repeat(40)}` as Address;
const other = `0x${'2'.repeat(40)}` as Address;
const hash = `0x${'3'.repeat(64)}` as Hash;
const replacement = `0x${'4'.repeat(64)}` as Hash;
const blockHash = `0x${'5'.repeat(64)}` as Hash;
const seed = `0x${'6'.repeat(64)}` as Hash;
const selection = { collection: 0 as const, tokenId: '7', difficulty: 1 as const };
const approvalAbi = parseAbi(['function approve(address spender,uint256 value) returns(bool)', 'event Approval(address indexed owner,address indexed spender,uint256 value)']);
function memory() { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } }; }
function startedLog(patch: Partial<TransactionReceipt['logs'][number]> = {}): TransactionReceipt['logs'][number] {
  const nft = keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }], [0, 7n]));
  return { address: PLAY_CONTRACTS.game, topics: encodeEventTopics({ abi: PLAY_GAME_ABI, eventName: 'RunStarted', args: { runId: 5n, player: account, nft } }),
    data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }, { type: 'uint8' }, { type: 'bytes32' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'uint256' }], [0, 7n, 1, seed, 1000n, 1990n, 1n]), ...patch } as unknown as TransactionReceipt['logs'][number];
}
function pending(): PendingOperation { return { kind: 'start', to: PLAY_CONTRACTS.game, data: encodeFunctionData({ abi: PLAY_GAME_ABI, functionName: 'startRun', args: [0, 7n, 1] }), value: '0', nonce: 9, hash, createdAt: 1000, selection }; }
function fixture(overrides: Record<string, any> = {}) {
  const store = memory(); const state = emptyPlayState(account); state.pending = pending(); savePlayState(store, state);
  const receipt = { status: 'success', from: account, to: PLAY_CONTRACTS.game, transactionHash: hash, blockHash, blockNumber: 100n, logs: [startedLog()] } as unknown as TransactionReceipt;
  const tx = { from: account, to: PLAY_CONTRACTS.game, nonce: 9, chainId: 46630, hash, input: state.pending!.data, value: 0n, blockHash, blockNumber: 100n };
  const requests: string[] = [];
  const provider = { request: async ({ method }: { method: string }) => { requests.push(method); if (method === 'eth_accounts') return [account]; if (method === 'eth_chainId') return '0xb626'; throw new Error('No wallet writes expected'); } } as EIP1193Provider;
  const client = { getChainId: async () => 46630, getBlockNumber: async () => 101n, getBlock: async () => ({ hash: blockHash }), getTransaction: async () => tx,
    waitForTransactionReceipt: async (args: any) => { assert.equal(args.confirmations, 2); assert.equal(loadPlayState(store, account).pending?.hash, args.hash); return receipt; }, ...overrides } as unknown as PublicClient;
  return { ctx: { client, provider, account, store } as PlayContext, store, state, receipt, tx, requests };
}
test('confirmed start recovers after reload into the exact selected run, ready to play', async () => {
  const f = fixture(); const result = await recoverPending(f.ctx);
  assert.equal(result.pending, null); assert.equal(result.savedRun?.run.runId, '5');
  assert.equal(result.savedRun?.run.seed, seed); assert.equal(result.savedRun?.status, 'ready');
  assert.deepEqual(result.savedRun?.replay, { version: 'rare-rush-input-v2', frames: [] });
  assert.equal(loadPlayState(f.store, account).history.at(-1)?.status, 'confirmed');
  assert.deepEqual(f.requests, []);
});
test('timeout preserves the checkpoint and blocks duplicate starts and approvals', async () => {
  const f = fixture({ waitForTransactionReceipt: async () => { throw new Error('timeout'); } });
  await assert.rejects(recoverPending(f.ctx), /timeout/);
  assert.equal(loadPlayState(f.store, account).pending?.hash, hash);
  await assert.rejects(startRun(f.ctx, selection), /pending transaction/);
  await assert.rejects(approveEntry(f.ctx), /pending transaction/);
  assert.deepEqual(f.requests, []);
});
test('two confirmations and canonical block are required even if receipt waiter returns early', async () => {
  for (const overrides of [{ getBlockNumber: async () => 100n }, { getBlock: async () => ({ hash: replacement }) }]) {
    const f = fixture(overrides); await assert.rejects(recoverPending(f.ctx), /two canonical confirmations/);
    assert.ok(loadPlayState(f.store, account).pending);
  }
});
test('confirmation checks run concurrently but do not settle until every canonical check finishes', async () => {
  const f = fixture();
  const entered = new Set<string>();
  let releaseTransaction!: () => void;
  const transactionReady = new Promise<void>(resolve => { releaseTransaction = resolve; });
  f.ctx.client.getTransaction = (async () => { entered.add('transaction'); await transactionReady; return f.tx; }) as unknown as PublicClient['getTransaction'];
  f.ctx.client.getBlockNumber = (async () => { entered.add('head'); return 101n; }) as PublicClient['getBlockNumber'];
  f.ctx.client.getBlock = (async () => { entered.add('canonical'); return { hash: blockHash }; }) as PublicClient['getBlock'];
  const recovery = recoverPending(f.ctx);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual([...entered].sort(), ['canonical', 'head', 'transaction']);
  assert.equal(loadPlayState(f.store, account).pending?.hash, hash);
  assert.equal(loadPlayState(f.store, account).savedRun, null);
  releaseTransaction();
  assert.equal((await recovery).savedRun?.run.runId, '5');
});
test('wrong sender, nonce, chain or contract logs cannot finalize a pending operation', async () => {
  for (const patch of [{ from: other }, { nonce: 10 }, { chainId: 4663 }]) {
    const f = fixture(); Object.assign(f.tx, patch);
    await assert.rejects(recoverPending(f.ctx), /another sender/); assert.ok(loadPlayState(f.store, account).pending);
  }
  const f = fixture(); f.receipt.logs = [startedLog({ address: other })];
  await assert.rejects(recoverPending(f.ctx), /Expected one RunStarted/); assert.ok(loadPlayState(f.store, account).pending);
});
test('a confirmed cancellation clears only that consumed nonce and records replacement', async () => {
  const f = fixture(); Object.assign(f.tx, { hash: replacement, to: account, input: '0x', value: 0n });
  Object.assign(f.receipt, { transactionHash: replacement, to: account, logs: [] });
  await assert.rejects(recoverPending(f.ctx), /cancelled or replaced/);
  assert.equal(loadPlayState(f.store, account).pending, null);
  assert.deepEqual(loadPlayState(f.store, account).history.map(item => [item.hash, item.status]), [[replacement, 'replaced']]);
});
test('repriced identical transaction checkpoints its replacement hash and confirms once', async () => {
  const f = fixture(); Object.assign(f.tx, { hash: replacement }); Object.assign(f.receipt, { transactionHash: replacement });
  f.ctx.client.waitForTransactionReceipt = (async ({ onReplaced }: any) => { onReplaced({ reason: 'repriced', transaction: f.tx }); assert.equal(loadPlayState(f.store, account).pending?.hash, replacement); return f.receipt; }) as PublicClient['waitForTransactionReceipt'];
  const result = await recoverPending(f.ctx); assert.equal(result.history.at(-1)?.hash, replacement); assert.equal(result.savedRun?.status, 'ready');
});
test('ambiguous hashless wallet submission requires manual recovery, never automatic resubmission', async () => {
  const f = fixture(); f.state.pending!.hash = null; savePlayState(f.store, f.state);
  await assert.rejects(recoverPending(f.ctx), /Paste the submitted/);
  Object.assign(f.tx, { from: other }); await assert.rejects(recoverPending(f.ctx, hash), /not this wallet operation/);
  assert.equal(loadPlayState(f.store, account).pending?.hash, null);
  Object.assign(f.tx, { from: account }); assert.equal((await recoverPending(f.ctx, hash)).savedRun?.run.runId, '5');
});
test('a hashless cancellation consumes only the reserved nonce and clears on canonical confirmation', async () => {
  const f = fixture({ getTransactionCount: async ({ blockTag }: { blockTag: string }) => { assert.equal(blockTag, 'latest'); return 9; } });
  f.state.pending!.hash = null; savePlayState(f.store, f.state);
  Object.assign(f.tx, { hash: replacement, to: account, input: '0x', value: 0n });
  Object.assign(f.receipt, { transactionHash: replacement, to: account, logs: [] });
  let sends = 0;
  f.ctx.provider = { request: async ({ method, params }: { method: string; params?: any[] }) => {
    if (method === 'eth_accounts') return [account];
    if (method === 'eth_chainId') return '0xb626';
    if (method === 'eth_sendTransaction') {
      sends++;
      assert.equal(params?.[0].nonce, '0x9'); assert.equal(params?.[0].to, account);
      assert.equal(params?.[0].data, '0x'); assert.equal(params?.[0].value, '0x0');
      assert.equal(loadPlayState(f.store, account).pending?.nonce, 9);
      return replacement;
    }
    throw new Error(`Unexpected wallet method ${method}`);
  } } as EIP1193Provider;
  await assert.rejects(cancelHashlessPending(f.ctx), /cancelled or replaced/);
  assert.equal(sends, 1);
  assert.equal(loadPlayState(f.store, account).pending, null);
  assert.equal(loadPlayState(f.store, account).history.at(-1)?.status, 'replaced');
});
test('an explicit hashless retry sends identical intent at the same nonce after contract validation', async () => {
  const launch = 102_400_000n * 1_000_000n;
  const gameplay = 921_600_000n * 1_000_000n;
  const fields: Record<string, unknown> = {
    rf: PLAY_CONTRACTS.rf, genesis: PLAY_CONTRACTS.genesis, generations: PLAY_CONTRACTS.generations,
    token: PLAY_CONTRACTS.rewardToken, ENTRY_FEE, PRIZE_POOL_SHARE: 100n * 10n ** 18n,
    TREASURY_SHARE: 10n * 10n ** 18n, MAX_DAILY_RUNS: 3n, engineVersion: ENGINE_VERSION, paused: false,
    CAP: launch + gameplay, rewardMinter: PLAY_CONTRACTS.game, decimals: 6,
    launchAllocation: launch, expectedLaunchAllocation: launch, rewardAllocation: gameplay,
    rewardsMinted: 0n, totalSupply: launch, INITIAL_COIN_REWARD: 10_000_000n,
    MIN_COIN_REWARD: 1_000_000n, HALVING_INTERVAL: 10_000n,
  };
  let simulated = false;
  const f = fixture({
    getTransactionCount: async ({ blockTag }: { blockTag: string }) => { assert.equal(blockTag, 'latest'); return 9; },
    getBytecode: async ({ address }: { address: Address }) => {
      const key = (Object.keys(PLAY_CONTRACTS) as (keyof typeof PLAY_CONTRACTS)[]).find(key => PLAY_CONTRACTS[key] === address);
      assert.ok(key); return deployedRuntimes.code[key];
    },
    readContract: async ({ functionName }: { functionName: string }) => { assert.ok(functionName in fields); return fields[functionName]; },
    call: async ({ to, data, value }: { to: Address; data: Hex; value: bigint }) => {
      assert.equal(to, PLAY_CONTRACTS.game); assert.equal(data, pending().data); assert.equal(value, 0n); simulated = true;
    },
  });
  f.state.pending!.hash = null; savePlayState(f.store, f.state);
  let sends = 0;
  f.ctx.provider = { request: async ({ method, params }: { method: string; params?: any[] }) => {
    if (method === 'eth_accounts') return [account];
    if (method === 'eth_chainId') return '0xb626';
    if (method === 'eth_sendTransaction') {
      assert.equal(simulated, true); sends++;
      assert.equal(params?.[0].nonce, '0x9'); assert.equal(params?.[0].to, PLAY_CONTRACTS.game);
      assert.equal(params?.[0].data, pending().data); assert.equal(params?.[0].value, '0x0');
      assert.equal(loadPlayState(f.store, account).pending?.hash, null);
      return hash;
    }
    throw new Error(`Unexpected wallet method ${method}`);
  } } as EIP1193Provider;
  const result = await retryHashlessPending(f.ctx);
  assert.equal(sends, 1);
  assert.equal(result.pending, null);
  assert.equal(result.savedRun?.run.runId, '5');
  assert.equal(result.history.at(-1)?.hash, hash);
});
test('already-mined nonces and known hashes cannot trigger a fresh submission', async () => {
  const f = fixture({ getTransactionCount: async () => 10 });
  await assert.rejects(retryHashlessPending(f.ctx), /Only a hashless/);
  f.state.pending!.hash = null; savePlayState(f.store, f.state);
  await assert.rejects(retryHashlessPending(f.ctx), /nonce is already confirmed/);
  await assert.rejects(cancelHashlessPending(f.ctx), /nonce is already confirmed/);
  assert.equal(loadPlayState(f.store, account).pending?.nonce, 9);
  assert.ok(!f.requests.includes('eth_sendTransaction'));
});
test('failed recovery requests never delete an earlier ambiguous send checkpoint', async () => {
  for (const code of [4001, 4900, -32002]) {
    const f = fixture({ getTransactionCount: async () => 9 });
    f.state.pending!.hash = null; savePlayState(f.store, f.state);
    f.ctx.provider = { request: async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') return [account];
      if (method === 'eth_chainId') return '0xb626';
      throw Object.assign(new Error('Wallet recovery declined or unavailable'), { code });
    } } as EIP1193Provider;
    await assert.rejects(cancelHashlessPending(f.ctx));
    assert.deepEqual(loadPlayState(f.store, account).pending, f.state.pending);
  }
});
test('hashless recovery rejects altered saved calldata before opening a wallet', async () => {
  const f = fixture();
  f.state.pending!.hash = null; f.state.pending!.data = '0x12345678'; savePlayState(f.store, f.state);
  await assert.rejects(retryHashlessPending(f.ctx), /calldata does not match/);
  await assert.rejects(cancelHashlessPending(f.ctx), /calldata does not match/);
  assert.deepEqual(f.requests, []);
});
test('reverted operations do not become successful starts', async () => {
  const f = fixture(); f.receipt.status = 'reverted';
  await assert.rejects(recoverPending(f.ctx), /reverted/);
  const state = loadPlayState(f.store, account); assert.equal(state.pending, null); assert.equal(state.savedRun, null); assert.equal(state.history.at(-1)?.status, 'reverted');
});
test('a fresh wrong wallet account or network is rejected before checkpoint or wallet write', async () => {
  for (const network of [false, true]) {
    const f = fixture(); f.state.pending = null; savePlayState(f.store, f.state);
    f.ctx.provider = { request: async ({ method }: { method: string }) => method === 'eth_accounts' ? [network ? account : other] : network ? '0x1237' : '0xb626' } as EIP1193Provider;
    await assert.rejects(startRun(f.ctx, selection), /Wrong network|wallet account changed/);
    assert.equal(loadPlayState(f.store, account).pending, null);
  }
});
test('unexpected deployed runtime blocks a new transaction before checkpointing', async () => {
  const f = fixture({ getBytecode: async () => '0x01' }); f.state.pending = null; savePlayState(f.store, f.state);
  await assert.rejects(approveEntry(f.ctx), /Unexpected .* runtime/);
  assert.equal(loadPlayState(f.store, account).pending, null);
  assert.ok(!f.requests.includes('eth_sendTransaction'));
});
test('approval recovery accepts only exact 110 tRF to the verified game', async () => {
  const f = fixture(); const data = encodeFunctionData({ abi: approvalAbi, functionName: 'approve', args: [PLAY_CONTRACTS.game, ENTRY_FEE] });
  f.state.pending = { ...pending(), kind: 'approve', to: PLAY_CONTRACTS.rf, data, selection: undefined }; savePlayState(f.store, f.state);
  Object.assign(f.tx, { to: PLAY_CONTRACTS.rf, input: data });
  Object.assign(f.receipt, { to: PLAY_CONTRACTS.rf, logs: [{ address: PLAY_CONTRACTS.rf, topics: encodeEventTopics({ abi: approvalAbi, eventName: 'Approval', args: { owner: account, spender: PLAY_CONTRACTS.game } }), data: encodeAbiParameters([{ type: 'uint256' }], [ENTRY_FEE]) }] });
  assert.equal((await recoverPending(f.ctx)).history.at(-1)?.kind, 'approve');
  f.state.pending.data = encodeFunctionData({ abi: approvalAbi, functionName: 'approve', args: [other, 2n ** 256n - 1n] }); savePlayState(f.store, f.state);
  await assert.rejects(recoverPending(f.ctx), /calldata does not match/);
});
test('start event binds the NFT, selected mode, destination, player and successful status', () => {
  const f = fixture(); assert.equal(assertRunStarted(f.receipt, account, selection).tokenId, '7');
  assert.throws(() => assertRunStarted(f.receipt, account, { ...selection, difficulty: 2 }), /does not match/);
  assert.throws(() => assertRunStarted(f.receipt, account, { ...selection, tokenId: '8' }), /does not match/);
  assert.throws(() => assertRunStarted({ ...f.receipt, status: 'reverted' }, account, selection), /does not match/);
});
test('claim event requires exact run, player, replay and pickup count; reward comes from chain', () => {
  const f = fixture(); const replayHash = keccak256(toHex('replay'));
  const claim = { chainId: 46630, game: PLAY_CONTRACTS.game, runId: '5', player: account, engineVersion: ENGINE_VERSION, pickupKinds: '0x0001', replayHash, deadline: '1500', signature: '0x', claimArgs: [] } as unknown as VerifiedClaim;
  f.receipt.logs = [{ address: PLAY_CONTRACTS.game, topics: encodeEventTopics({ abi: PLAY_GAME_ABI, eventName: 'RunClaimed', args: { runId: 5n, player: account } }), data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }], [2n, 75_000_000n, replayHash]) }] as unknown as TransactionReceipt['logs'];
  assert.equal(assertRunClaimed(f.receipt, account, claim), '75000000');
  assert.throws(() => assertRunClaimed(f.receipt, other, claim), /does not match/);
  assert.throws(() => assertRunClaimed(f.receipt, account, { ...claim, runId: '6' }), /does not match/);
  assert.throws(() => assertRunClaimed(f.receipt, account, { ...claim, pickupKinds: '0x00' }), /does not match/);
});
test('claim recovery persists the chain reward, and a finalized abandon is tracked separately', async () => {
  for (const kind of ['claim', 'abandon'] as const) {
    const f = fixture(); const run = assertRunStarted(f.receipt, account, selection);
    const replay = { version: 'rare-rush-input-v2' as const, frames: [] };
    const replayHash = keccak256(toHex(JSON.stringify(replay)));
    const signature = `0x${'7'.repeat(130)}` as Hex;
    const claim: VerifiedClaim = { chainId: 46630, game: PLAY_CONTRACTS.game, runId: '5', player: account, engineVersion: ENGINE_VERSION, pickupKinds: '0x0001', replayHash, deadline: '1500', signature, claimArgs: ['5', '0x0001', replayHash, '1500', signature] };
    f.state.savedRun = { run, replay, completedTicks: 10800, status: 'survived', claim };
    const data = encodeFunctionData({ abi: PLAY_GAME_ABI, functionName: kind === 'claim' ? 'claim' : 'abandonRun', args: kind === 'claim' ? [5n, claim.pickupKinds, replayHash, 1500n, signature] : [5n] });
    f.state.pending = { ...pending(), kind, runId: '5', data, claim: kind === 'claim' ? claim : undefined };
    savePlayState(f.store, f.state); Object.assign(f.tx, { input: data });
    f.receipt.logs = [{ address: PLAY_CONTRACTS.game, topics: encodeEventTopics({ abi: PLAY_GAME_ABI, eventName: kind === 'claim' ? 'RunClaimed' : 'RunAbandoned', args: { runId: 5n, player: account } }), data: kind === 'claim' ? encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }], [2n, 75_000_000n, replayHash]) : '0x' }] as unknown as TransactionReceipt['logs'];
    const result = await recoverPending(f.ctx);
    assert.equal(result.pending, null); assert.equal(result.savedRun?.status, kind === 'claim' ? 'claimed' : 'abandoned');
    if (kind === 'claim') assert.equal(result.savedRun?.reward, '75000000');
    else assert.equal(result.savedRun?.run.abandoned, true);
  }
});
test('NFT discovery bounds RPC scans and retains verified manual IDs when history is unavailable', async () => {
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  const f = fixture({ getBlockNumber: async () => DEPLOYMENT_BLOCK + 100_000n,
    getLogs: async (args: { fromBlock: bigint; toBlock: bigint }) => { ranges.push(args); return []; },
    readContract: async ({ functionName }: { functionName: string }) => functionName === 'ownerOf' ? account : 1n,
  });
  const known = [{ collection: 0 as const, tokenId: '999' }];
  const result = await discoverFriends(f.ctx.client, account, known);
  assert.deepEqual(result.friends, known); assert.equal(result.incomplete, true);
  assert.equal(ranges.length, 10);
  assert.ok(ranges.every(range => range.fromBlock >= DEPLOYMENT_BLOCK && range.toBlock < DEPLOYMENT_BLOCK + 50_000n && range.toBlock - range.fromBlock < 10_000n));
  f.ctx.client.getLogs = (async () => { throw new Error('RPC limit'); }) as PublicClient['getLogs'];
  assert.deepEqual((await discoverFriends(f.ctx.client, account, known)).friends, known);
});
