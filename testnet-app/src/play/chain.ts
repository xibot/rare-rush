import { createWalletClient, custom, defineChain, encodeAbiParameters, encodeFunctionData, getAddress, isHash, keccak256, parseAbi, parseAbiItem, parseEventLogs, recoverTypedDataAddress, type Abi, type Address, type EIP1193Provider, type Hash, type Hex, type PublicClient, type TransactionReceipt } from 'viem';
import deployment from '../shared/deployment.json' with { type: 'json' };
import gameArtifact from '../../generated/infra/testnet/artifacts/RareRushGame.json' with { type: 'json' };
import { resultData, PROTOCOL_VERSION } from '../../generated/infra/testnet/src/protocol.ts';
import { tokenAbi, nftAbi } from '../abi.ts';
import { RPC_URL, EXPLORER_URL, assertWalletContext, assertRewardEconomics } from '../safety.ts';
import { PLAY_CHAIN_ID, PLAY_CONTRACTS, ENGINE_VERSION, DEPLOYMENT_BLOCK, type Collection, type FriendSelection, type RunSelection, type RunSnapshot, type PendingOperation, type PlayState, type StorageLike, type VerifiedClaim } from './types.ts';
import { decimal, loadPlayState, savePlayState, stateKey, validateRun, validateVerifiedClaim } from './storage.ts';
export { PLAY_CHAIN_ID, PLAY_CONTRACTS, ENGINE_VERSION, DEPLOYMENT_BLOCK } from './types.ts';

export const PLAY_GAME_ABI = gameArtifact.abi as Abi;
export const ENTRY_FEE = 110n * 10n ** 18n;
export const TESTNET_CHAIN = defineChain({ id: PLAY_CHAIN_ID, name: 'Robinhood Testnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } }, blockExplorers: { default: { name: 'Robinhood Explorer', url: EXPLORER_URL } }, testnet: true });
const approvalAbi = parseAbi(['function allowance(address owner,address spender) view returns(uint256)', 'function approve(address spender,uint256 value) returns(bool)', 'event Approval(address indexed owner,address indexed spender,uint256 value)']);
const generationAbi = parseAbi(['function generation(uint256) view returns(uint256)']);
const same = (a: string | null | undefined, b: string | null | undefined) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
function requireThat(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const runtimeHashes = deployment.runtimeHashes;
export type PlayContext = {
  client: PublicClient; provider: EIP1193Provider; account: Address; store: StorageLike;
  onState?: (state: PlayState) => void;
};
function persist(ctx: PlayContext, state: PlayState) { savePlayState(ctx.store, state); ctx.onState?.(state); return state; }
async function walletContext(ctx: PlayContext) {
  const [accounts, chain] = await Promise.all([ctx.provider.request({ method: 'eth_accounts' }), ctx.provider.request({ method: 'eth_chainId' })]);
  assertWalletContext(ctx.account, accounts, Number(chain));
  requireThat(await ctx.client.getChainId() === PLAY_CHAIN_ID, 'Testnet RPC network mismatch.');
}
const localLocks = new Set<string>();
async function locked<T>(ctx: PlayContext, action: () => Promise<T>): Promise<T> {
  const key = stateKey(ctx.account);
  const execute = async () => {
    requireThat(!localLocks.has(key), 'Another operation is already in progress.');
    localLocks.add(key);
    try { return await action(); } finally { localLocks.delete(key); }
  };
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(key, execute);
  return execute();
}
/** Read one pinned state snapshot and compare the verified deployment's exact runtimes. */
export async function verifyPlayContracts(client: PublicClient) {
  requireThat(await client.getChainId() === PLAY_CHAIN_ID, 'Testnet RPC network mismatch.');
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  await Promise.all((Object.keys(PLAY_CONTRACTS) as (keyof typeof PLAY_CONTRACTS)[]).map(async key => {
    const code = await client.getBytecode({ address: PLAY_CONTRACTS[key], blockNumber });
    requireThat(code && keccak256(code) === runtimeHashes[key], `Unexpected ${key} runtime. Transactions are disabled.`);
  }));
  const gameRead = (functionName: string) => client.readContract({ address: PLAY_CONTRACTS.game, abi: PLAY_GAME_ABI, functionName, blockNumber });
  const tokenRead = (functionName: string) => client.readContract({ address: PLAY_CONTRACTS.rewardToken, abi: tokenAbi as Abi, functionName, blockNumber });
  const [rf, genesis, generations, token, fee, prize, treasury, daily, engine, paused, cap, minter, decimals, launch, expectedLaunch, gameplay, minted, supply, initial, minimum, interval] = await Promise.all([
    ...['rf', 'genesis', 'generations', 'token', 'ENTRY_FEE', 'PRIZE_POOL_SHARE', 'TREASURY_SHARE', 'MAX_DAILY_RUNS', 'engineVersion', 'paused'].map(gameRead),
    ...['CAP', 'rewardMinter', 'decimals', 'launchAllocation'].map(tokenRead), gameRead('expectedLaunchAllocation'),
    ...['rewardAllocation', 'rewardsMinted', 'totalSupply'].map(tokenRead), ...['INITIAL_COIN_REWARD', 'MIN_COIN_REWARD', 'HALVING_INTERVAL'].map(gameRead),
  ]) as [Address, Address, Address, Address, bigint, bigint, bigint, bigint, Hash, boolean, bigint, Address, number, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
  requireThat(same(rf, PLAY_CONTRACTS.rf) && same(genesis, PLAY_CONTRACTS.genesis) && same(generations, PLAY_CONTRACTS.generations) && same(token, PLAY_CONTRACTS.rewardToken) && fee === ENTRY_FEE && prize === 100n * 10n ** 18n && treasury === 10n * 10n ** 18n && daily === 3n && engine === ENGINE_VERSION, 'Unexpected game settings. Transactions are disabled.');
  assertRewardEconomics({ cap, decimals, minter, game: PLAY_CONTRACTS.game, launch, expectedLaunch, gameplay, minted, supply, initial, minimum, interval });
  return { blockNumber, paused };
}
export async function readRun(client: PublicClient, runId: string | bigint): Promise<RunSnapshot> {
  requireThat(decimal(String(runId)) && BigInt(runId) > 0n, 'Invalid run ID.');
  const tuple = await client.readContract({ address: PLAY_CONTRACTS.game, abi: PLAY_GAME_ABI, functionName: 'runs', args: [BigInt(runId)] }) as [Address, bigint, Hash, bigint, bigint, number, number, boolean, bigint, boolean];
  return validateRun({ runId: String(runId), player: tuple[0], tokenId: String(tuple[1]), seed: tuple[2], startedAt: String(tuple[3]), claimUntil: String(tuple[4]), collection: tuple[5], difficulty: tuple[6], claimed: tuple[7], verifierEpoch: String(tuple[8]), abandoned: tuple[9] });
}
export async function readOwnedFriend(client: PublicClient, account: Address, collection: Collection, tokenId: string): Promise<FriendSelection> {
  requireThat([0, 1].includes(collection) && decimal(tokenId) && tokenId !== '0', 'Enter a valid test NFT ID.');
  const address = collection === 1 ? PLAY_CONTRACTS.genesis : PLAY_CONTRACTS.generations;
  const owner = await client.readContract({ address, abi: nftAbi, functionName: 'ownerOf', args: [BigInt(tokenId)] });
  requireThat(same(owner, account), 'This wallet does not own that test Friend.');
  if (collection === 0) requireThat(await client.readContract({ address, abi: generationAbi, functionName: 'generation', args: [BigInt(tokenId)] }) >= 1n, 'The test Generations NFT must be hardwired.');
  return { collection, tokenId };
}
/** Optional bounded discovery. Known/manual IDs remain usable when logs are unavailable. */
export async function discoverFriends(client: PublicClient, account: Address, known: FriendSelection[] = []) {
  const candidates = new Map<string, FriendSelection>();
  const add = (friend: FriendSelection) => { if (candidates.size < 100 && decimal(friend.tokenId) && friend.tokenId !== '0' && [0, 1].includes(friend.collection)) candidates.set(`${friend.collection}:${friend.tokenId}`, friend); };
  known.slice(0, 100).forEach(add);
  const latest = await client.getBlockNumber({ cacheTime: 0 });
  const end = latest < DEPLOYMENT_BLOCK + 49_999n ? latest : DEPLOYMENT_BLOCK + 49_999n;
  let incomplete = end < latest;
  try {
    for (let fromBlock = DEPLOYMENT_BLOCK; fromBlock <= end && candidates.size < 100; fromBlock += 10_000n) {
      const toBlock = fromBlock + 9_999n < end ? fromBlock + 9_999n : end;
      for (const collection of [0, 1] as const) {
        const logs = await client.getLogs({ address: collection === 1 ? PLAY_CONTRACTS.genesis : PLAY_CONTRACTS.generations, event: parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)'), args: { to: account }, fromBlock, toBlock, strict: true });
        for (const log of logs) add({ collection, tokenId: String(log.args.tokenId) });
      }
    }
  } catch { incomplete = true; }
  const checked = await Promise.allSettled([...candidates.values()].map(item => readOwnedFriend(client, account, item.collection, item.tokenId)));
  return { friends: checked.flatMap(item => item.status === 'fulfilled' ? [item.value] : []), incomplete: incomplete || candidates.size === 100 };
}
export async function entryAllowance(client: PublicClient, account: Address) {
  return client.readContract({ address: PLAY_CONTRACTS.rf, abi: approvalAbi, functionName: 'allowance', args: [account, PLAY_CONTRACTS.game] });
}
function operationData(pending: Pick<PendingOperation, 'kind' | 'selection' | 'runId' | 'claim'>): Hex {
  if (pending.kind === 'approve') return encodeFunctionData({ abi: approvalAbi, functionName: 'approve', args: [PLAY_CONTRACTS.game, ENTRY_FEE] });
  if (pending.kind === 'start') {
    const value = pending.selection!;
    requireThat(value && [0, 1].includes(value.collection) && [0, 1, 2].includes(value.difficulty) && decimal(value.tokenId) && value.tokenId !== '0', 'Invalid run selection.');
    return encodeFunctionData({ abi: PLAY_GAME_ABI, functionName: 'startRun', args: [value.collection, BigInt(value.tokenId), value.difficulty] });
  }
  requireThat(decimal(pending.runId) && pending.runId !== '0', 'Invalid run ID.');
  if (pending.kind === 'abandon') return encodeFunctionData({ abi: PLAY_GAME_ABI, functionName: 'abandonRun', args: [BigInt(pending.runId)] });
  const claim = pending.claim!;
  return encodeFunctionData({ abi: PLAY_GAME_ABI, functionName: 'claim', args: [BigInt(claim.runId), claim.pickupKinds, claim.replayHash, BigInt(claim.deadline), claim.signature] });
}
function event(receipt: TransactionReceipt, eventName: string, address: Address, abi: Abi = PLAY_GAME_ABI) {
  const events = parseEventLogs({ abi, eventName, logs: receipt.logs.filter(log => same(log.address, address)), strict: true });
  requireThat(events.length === 1, `Expected one ${eventName} event from the verified contract.`);
  return events[0].args as Record<string, any>;
}
export function assertRunStarted(receipt: TransactionReceipt, account: Address, selection: RunSelection): RunSnapshot {
  const value = event(receipt, 'RunStarted', PLAY_CONTRACTS.game);
  const nft = keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }], [selection.collection, BigInt(selection.tokenId)]));
  requireThat(receipt.status === 'success' && same(receipt.to, PLAY_CONTRACTS.game) && same(receipt.from, account) && value.nft === nft && same(value.player, account) && value.collection === selection.collection && value.tokenId === BigInt(selection.tokenId) && value.difficulty === selection.difficulty, 'RunStarted does not match your selected Friend and difficulty.');
  return validateRun({ ...selection, runId: String(value.runId), player: getAddress(account), seed: value.seed, startedAt: String(value.startedAt), claimUntil: String(value.claimUntil), verifierEpoch: String(value.verifierEpoch), claimed: false, abandoned: false });
}
export function assertRunClaimed(receipt: TransactionReceipt, account: Address, claim: VerifiedClaim): string {
  const value = event(receipt, 'RunClaimed', PLAY_CONTRACTS.game);
  requireThat(receipt.status === 'success' && same(receipt.to, PLAY_CONTRACTS.game) && same(receipt.from, account) && value.runId === BigInt(claim.runId) && same(value.player, account) && value.replayHash === claim.replayHash && value.pickups === BigInt((claim.pickupKinds.length - 2) / 2) && typeof value.reward === 'bigint', 'RunClaimed does not match the verified run.');
  return String(value.reward);
}
function finish(ctx: PlayContext, state: PlayState, hash: Hash, status: 'confirmed' | 'reverted' | 'replaced') {
  state.history = [...state.history, { kind: state.pending!.kind, hash, status, at: Date.now() }].slice(-20);
  state.pending = null;
  return persist(ctx, state);
}
/** Every recovery verifies the mined transaction, canonical block and event—not just its hash. */
async function settle(ctx: PlayContext, state: PlayState, receipt: TransactionReceipt): Promise<PlayState> {
  const pending = state.pending!;
  const tx = await ctx.client.getTransaction({ hash: receipt.transactionHash });
  const [head, canonical] = await Promise.all([ctx.client.getBlockNumber({ cacheTime: 0 }), ctx.client.getBlock({ blockNumber: receipt.blockNumber })]);
  requireThat(same(tx.from, ctx.account) && tx.nonce === pending.nonce && (tx.chainId === undefined || tx.chainId === PLAY_CHAIN_ID), 'Recovery transaction belongs to another sender, nonce or chain.');
  requireThat(receipt.transactionHash === tx.hash && same(receipt.from, tx.from) && same(receipt.to, tx.to) && receipt.blockNumber === tx.blockNumber && receipt.blockHash === tx.blockHash && canonical.hash === receipt.blockHash && head >= receipt.blockNumber + 1n, 'Transaction needs two canonical confirmations.');
  if (!same(tx.to, pending.to) || tx.input.toLowerCase() !== pending.data.toLowerCase() || tx.value !== 0n) {
    finish(ctx, state, receipt.transactionHash, 'replaced');
    throw new Error('The wallet cancelled or replaced this operation with a different transaction. The requested action was not confirmed.');
  }
  if (receipt.status !== 'success') {
    finish(ctx, state, receipt.transactionHash, 'reverted');
    throw new Error('The transaction reverted. It did not complete the requested action.');
  }
  if (pending.kind === 'start') {
    const run = assertRunStarted(receipt, ctx.account, pending.selection!);
    state.savedRun = { run, replay: { version: PROTOCOL_VERSION, frames: [] }, completedTicks: 0, status: 'ready' };
    if (!state.friends.some(item => item.collection === run.collection && item.tokenId === run.tokenId)) state.friends = [...state.friends, { collection: run.collection, tokenId: run.tokenId }].slice(-100);
  } else if (pending.kind === 'claim') {
    state.savedRun!.reward = assertRunClaimed(receipt, ctx.account, pending.claim!);
    state.savedRun!.status = 'claimed'; state.savedRun!.run.claimed = true;
  } else if (pending.kind === 'abandon') {
    const value = event(receipt, 'RunAbandoned', PLAY_CONTRACTS.game);
    requireThat(value.runId === BigInt(pending.runId!) && same(value.player, ctx.account), 'RunAbandoned belongs to another run.');
    state.savedRun!.status = 'abandoned'; state.savedRun!.run.abandoned = true;
  } else {
    const value = event(receipt, 'Approval', PLAY_CONTRACTS.rf, approvalAbi);
    requireThat(same(value.owner, ctx.account) && same(value.spender, PLAY_CONTRACTS.game) && value.value === ENTRY_FEE, 'Approval does not match the exact entry fee.');
  }
  return finish(ctx, state, receipt.transactionHash, 'confirmed');
}
async function waitPending(ctx: PlayContext, state: PlayState): Promise<PlayState> {
  requireThat(state.pending?.hash, 'Paste the submitted wallet transaction hash to recover this operation. Do not submit it again.');
  const pending = state.pending;
  const receipt = await ctx.client.waitForTransactionReceipt({ hash: pending.hash!, confirmations: 2, timeout: 120_000, pollingInterval: 1500,
    onReplaced(replacement) {
      if (same(replacement.transaction.from, ctx.account) && replacement.transaction.nonce === pending.nonce) {
        pending.hash = replacement.transaction.hash;
        persist(ctx, state);
      }
    },
  });
  return settle(ctx, state, receipt);
}
async function execute(ctx: PlayContext, intent: Pick<PendingOperation, 'kind' | 'selection' | 'runId' | 'claim'>): Promise<PlayState> {
  return locked(ctx, async () => {
    let state = loadPlayState(ctx.store, ctx.account);
    requireThat(!state.pending, 'Recover your pending transaction before requesting another action.');
    await walletContext(ctx);
    const verified = await verifyPlayContracts(ctx.client);
    requireThat(!verified.paused || intent.kind === 'abandon', 'The test game is paused.');
    if (intent.kind === 'start') {
      if (state.savedRun && !['claimed', 'abandoned'].includes(state.savedRun.status)) {
        const [live, block] = await Promise.all([readRun(ctx.client, state.savedRun.run.runId), ctx.client.getBlock()]);
        requireThat(live.claimed || live.abandoned || block.timestamp > BigInt(live.claimUntil), 'Finish or abandon the saved run before starting another.');
      }
      await readOwnedFriend(ctx.client, ctx.account, intent.selection!.collection, intent.selection!.tokenId);
      if (intent.selection!.collection === 0) requireThat(await entryAllowance(ctx.client, ctx.account) >= ENTRY_FEE, 'Approve exactly 110 tRF before starting a Generations run.');
    } else if (intent.kind === 'approve') {
      if (await entryAllowance(ctx.client, ctx.account) >= ENTRY_FEE) return state;
    } else {
      requireThat(state.savedRun?.run.runId === intent.runId, 'This action does not match your saved run.');
      const liveRun = await readRun(ctx.client, intent.runId!);
      requireThat(same(liveRun.player, ctx.account) && !liveRun.claimed && !liveRun.abandoned, 'This run is already finalized or belongs to another wallet.');
      if (intent.kind === 'claim') {
        requireThat(state.savedRun!.status === 'survived', 'Only a saved run that survived the timer can be claimed.');
        intent.claim = validateVerifiedClaim(intent.claim, liveRun, state.savedRun!.replay);
        const [signer, epoch, block] = await Promise.all([
          ctx.client.readContract({ address: PLAY_CONTRACTS.game, abi: PLAY_GAME_ABI, functionName: 'verifier' }),
          ctx.client.readContract({ address: PLAY_CONTRACTS.game, abi: PLAY_GAME_ABI, functionName: 'verifierEpoch' }), ctx.client.getBlock(),
        ]);
        requireThat(epoch === BigInt(liveRun.verifierEpoch) && block.timestamp <= BigInt(intent.claim.deadline) && block.timestamp >= BigInt(liveRun.startedAt) + BigInt([120, 90, 60][liveRun.difficulty]), 'The run is unfinished or its verification window changed or expired.');
        const recovered = await recoverTypedDataAddress({ ...resultData(PLAY_CHAIN_ID, PLAY_CONTRACTS.game, { runId: BigInt(liveRun.runId), player: ctx.account, runSeed: liveRun.seed, pickupKinds: intent.claim.pickupKinds, replayHash: intent.claim.replayHash, engineVersion: ENGINE_VERSION, deadline: BigInt(intent.claim.deadline), verifierEpoch: BigInt(liveRun.verifierEpoch) }), signature: intent.claim.signature });
        requireThat(same(recovered, signer as Address), 'The verifier signature is not valid for this run.');
      }
    }
    const to = intent.kind === 'approve' ? PLAY_CONTRACTS.rf : PLAY_CONTRACTS.game;
    const data = operationData(intent);
    // Simulate exact calldata before opening the wallet. Never trust client-side totals.
    await ctx.client.call({ account: ctx.account, to, data, value: 0n });
    const nonce = await ctx.client.getTransactionCount({ address: ctx.account, blockTag: 'pending' });
    await walletContext(ctx);
    state = loadPlayState(ctx.store, ctx.account);
    requireThat(!state.pending, 'Another tab has a pending operation. Recover it first.');
    state.pending = { ...intent, to, data, value: '0', nonce, hash: null, createdAt: Date.now() };
    persist(ctx, state);
    const wallet = createWalletClient({ chain: TESTNET_CHAIN, transport: custom(ctx.provider) });
    let hash: Hash;
    try { hash = await wallet.sendTransaction({ account: ctx.account, chain: TESTNET_CHAIN, to, data, value: 0n, nonce }); }
    catch (error) {
      const refused = (value: unknown): boolean => Boolean(value && typeof value === 'object' && ((value as {code?: number}).code === 4001 || ((value as {cause?: unknown}).cause && refused((value as {cause?: unknown}).cause))));
      if (refused(error)) { state.pending = null; persist(ctx, state); }
      throw error;
    }
    state.pending!.hash = hash;
    persist(ctx, state);
    return waitPending(ctx, state);
  });
}
export function approveEntry(ctx: PlayContext) { return execute(ctx, { kind: 'approve' }); }
export function startRun(ctx: PlayContext, selection: RunSelection) { operationData({ kind: 'start', selection }); return execute(ctx, { kind: 'start', selection }); }
export function claimRun(ctx: PlayContext, claim: VerifiedClaim) { return execute(ctx, { kind: 'claim', runId: claim.runId, claim }); }
export function abandonRun(ctx: PlayContext, runId: string) { return execute(ctx, { kind: 'abandon', runId }); }
/** Explicit recovery only: reuse the reserved nonce, never allocate a fresh nonce. */
async function resubmitHashless(ctx: PlayContext, cancel: boolean): Promise<PlayState> {
  return locked(ctx, async () => {
    let state = loadPlayState(ctx.store, ctx.account);
    requireThat(state.pending && !state.pending.hash, 'Only a hashless operation can use this recovery action. Check the existing transaction hash instead.');
    const original = { ...state.pending };
    requireThat(original.data.toLowerCase() === operationData(original).toLowerCase(), 'Saved transaction calldata does not match its requested action.');
    await walletContext(ctx);
    // If the nonce has landed already, sending a new nonce would risk a second entry.
    requireThat(await ctx.client.getTransactionCount({ address: ctx.account, blockTag: 'latest' }) <= original.nonce,
      'This nonce is already confirmed. Paste its transaction hash from your wallet to recover the result.');
    if (!cancel) {
      const verified = await verifyPlayContracts(ctx.client);
      requireThat(!verified.paused || original.kind === 'abandon', 'The test game is paused. You may cancel the reserved nonce instead.');
      await ctx.client.call({ account: ctx.account, to: original.to, data: original.data, value: 0n });
    }
    await walletContext(ctx);
    state = loadPlayState(ctx.store, ctx.account);
    const latest = state.pending;
    requireThat(latest && !latest.hash && latest.nonce === original.nonce && latest.kind === original.kind
      && latest.createdAt === original.createdAt && same(latest.to, original.to) && same(latest.data, original.data),
    'Your pending operation changed. Check its current transaction status.');
    // Keep the original intent persisted, even if this retry is rejected. An earlier
    // ambiguous send may still exist. Exactly one transaction can consume this nonce.
    persist(ctx, state);
    const wallet = createWalletClient({ chain: TESTNET_CHAIN, transport: custom(ctx.provider) });
    const hash = await wallet.sendTransaction({
      account: ctx.account, chain: TESTNET_CHAIN,
      to: cancel ? ctx.account : original.to, data: cancel ? '0x' : original.data,
      value: 0n, nonce: original.nonce,
    });
    state = loadPlayState(ctx.store, ctx.account);
    requireThat(state.pending && state.pending.nonce === original.nonce && state.pending.kind === original.kind
      && same(state.pending.data, original.data), 'Recovery data changed after wallet submission. Keep the wallet transaction hash for recovery.');
    state.pending.hash = hash;
    persist(ctx, state);
    return waitPending(ctx, state);
  });
}
export function retryHashlessPending(ctx: PlayContext) { return resubmitHashless(ctx, false); }
export function cancelHashlessPending(ctx: PlayContext) { return resubmitHashless(ctx, true); }
export function recoverPending(ctx: PlayContext, suppliedHash?: Hash): Promise<PlayState> {
  return locked(ctx, async () => {
    const state = loadPlayState(ctx.store, ctx.account);
    requireThat(state.pending, 'There is no pending operation for this account.');
    // Recovery is read-only and remains available after an account/network change.
    requireThat(await ctx.client.getChainId() === PLAY_CHAIN_ID, 'Testnet RPC network mismatch.');
    requireThat(state.pending.data.toLowerCase() === operationData(state.pending).toLowerCase(), 'Saved transaction calldata does not match its requested action.');
    if (suppliedHash) {
      requireThat(isHash(suppliedHash), 'Enter a complete transaction hash.');
      const tx = await ctx.client.getTransaction({ hash: suppliedHash });
      requireThat(same(tx.from, ctx.account) && tx.nonce === state.pending.nonce, 'That hash is not this wallet operation or its replacement.');
      state.pending.hash = suppliedHash;
      persist(ctx, state);
    }
    return waitPending(ctx, state);
  });
}
