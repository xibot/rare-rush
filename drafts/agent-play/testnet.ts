/** Local AGENT PLAY adapter. Every wallet request is an explicit public method call. */
import {
  createPublicClient, createWalletClient, custom, encodeFunctionData, getAddress, http,
  isHash, type Address, type Hash, type Hex, type PublicClient,
} from 'viem';
import {
  TESTNET_CHAIN, PLAY_GAME_ABI, ENTRY_FEE, verifyPlayContracts, readOwnedFriend, readRun,
  discoverFriends, entryAllowance, approveEntry, startRun, claimRun, abandonRun, recoverPending,
  retryHashlessPending, cancelHashlessPending, type PlayContext,
} from '../../testnet-app/src/play/chain.ts';
import {
  PLAY_CHAIN_ID, PLAY_CONTRACTS, ENGINE_VERSION, type Collection, type FriendSelection,
  type PlayState, type Replay, type RunSelection, type RunSnapshot, type StorageLike,
} from '../../testnet-app/src/play/types.ts';
import { loadPlayState, savePlayState, maxRunTicks, validateVerifiedClaim } from '../../testnet-app/src/play/storage.ts';
import { createRecorder, REPLAY_VERSION } from '../../testnet-app/src/play/recorder.ts';
import { authorizationTypedData, canonicalReplayHash, createAuthorization } from '../../testnet-app/src/shared/authorization.ts';
import { fetchVerifierJson } from '../../testnet-app/src/play/verifier-status.ts';
import { assertWalletContext, faucetReady } from '../../testnet-app/src/safety.ts';
import { nftAbi, tokenAbi } from '../../testnet-app/src/abi.ts';
import { mintedIds } from '../../testnet-app/src/receipts.ts';
import type { BrowserWallet } from '../../testnet-app/src/wallet-session.ts';

export { PLAY_CHAIN_ID, PLAY_CONTRACTS, ENGINE_VERSION, ENTRY_FEE, TESTNET_CHAIN };
export type { Collection, FriendSelection, PlayState, Replay, RunSelection, RunSnapshot };
export type AssetPending = {
  kind: 'rf' | 'genesis' | 'generations'; account: Address; contract: Address;
  hash: Hash | null; nonce: number; data: Hex; createdAt: number;
};
export type AgentTestnetSnapshot = {
  account: Address | null; chainId: number | null; verified: boolean; paused: boolean;
  busy: string | null; playState: PlayState | null; assetPending: AssetPending | null;
  balances: { eth: bigint; rf: bigint; rush: bigint; allowance: bigint; genesis: bigint; generations: bigint } | null;
  selected: (FriendSelection & { remainingStarts: number; activeRunId: string; utcDay: string }) | null;
  verifier: 'checking' | 'ready' | 'unavailable';
};
export type AgentTestnetOptions = {
  client?: PublicClient; provider?: BrowserWallet; store?: StorageLike; request?: typeof fetch;
  onState?: (snapshot: AgentTestnetSnapshot) => void;
  onError?: (error: unknown) => void;
};
const MODES = ['easy', 'normal', 'degen'] as const;
const PREFIX = 'rare-rush:agent-play:v1:';
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
function requireThat(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const refused = (error: unknown): boolean => !!error && typeof error === 'object' &&
  ((error as { code?: number }).code === 4001 || refused((error as { cause?: unknown }).cause));
const assetData = (kind: AssetPending['kind']) => kind === 'rf'
  ? encodeFunctionData({ abi: tokenAbi, functionName: 'faucet' })
  : encodeFunctionData({ abi: nftAbi, functionName: 'mint' });

export function createTestnetAdapter(options: AgentTestnetOptions = {}) {
  const client = options.client ?? createPublicClient({ chain: TESTNET_CHAIN,
    transport: http('/api/rpc', { timeout: 12_000, retryCount: 1 }), cacheTime: 0 });
  // Same validation and durable-write checks as the deployed app, isolated from its keys.
  const backing = options.store ?? localStorage;
  const store: StorageLike = {
    getItem: key => backing.getItem(PREFIX + key),
    setItem: (key, value) => backing.setItem(PREFIX + key, value),
  };
  const request = options.request ?? fetch;
  let current: AgentTestnetSnapshot = { account: null, chainId: null, verified: false, paused: false,
    busy: null, playState: null, assetPending: null, balances: null, selected: null, verifier: 'checking' };
  let observed: BrowserWallet | undefined;
  let epoch = 0, disposed = false, operation = false;
  const snapshot = () => ({ ...current });
  const emit = () => { if (!disposed) options.onState?.(snapshot()); };
  const assetKey = (account: Address) => `assets:${PLAY_CHAIN_ID}:${account.toLowerCase()}`;
  function loadAsset(account: Address): AssetPending | null {
    const raw = store.getItem(assetKey(account));
    if (raw === null || raw === 'null') return null;
    requireThat(raw.length < 3000, 'Invalid saved asset operation. Keep its recovery data.');
    const p = JSON.parse(raw) as AssetPending;
    requireThat(p && ['rf', 'genesis', 'generations'].includes(p.kind) && same(p.account, account)
      && same(p.contract, PLAY_CONTRACTS[p.kind]) && p.data === assetData(p.kind)
      && Number.isSafeInteger(p.nonce) && p.nonce >= 0 && Number.isSafeInteger(p.createdAt)
      && p.createdAt >= 0 && (p.hash === null || isHash(p.hash)), 'Invalid saved asset operation. Keep its recovery data.');
    return p;
  }
  function saveAsset(account: Address, value: AssetPending | null) {
    const raw = JSON.stringify(value);
    store.setItem(assetKey(account), raw);
    requireThat(store.getItem(assetKey(account)) === raw, 'Could not save asset transaction recovery data.');
    if (same(current.account, account)) { current.assetPending = value; emit(); }
  }
  function persist(state: PlayState) {
    savePlayState(store, state);
    if (same(current.account, state.account)) { current.playState = state; emit(); }
    return state;
  }
  function invalidate() {
    epoch++;
    current = { ...current, account: null, chainId: null, verified: false,
      playState: null, assetPending: null, balances: null, selected: null };
    emit();
  }
  const changed = () => { invalidate(); void restore().catch(error => options.onError?.(error)); };
  const disconnected = () => invalidate();
  function provider() {
    const next = options.provider ?? (window as Window & { ethereum?: BrowserWallet }).ethereum;
    requireThat(next, 'Install or open a browser wallet, then connect.');
    if (next !== observed) {
      detach(); observed = next;
      next.on?.('accountsChanged', changed); next.on?.('chainChanged', changed); next.on?.('disconnect', disconnected);
    }
    return next;
  }
  function detach() {
    observed?.removeListener?.('accountsChanged', changed);
    observed?.removeListener?.('chainChanged', changed);
    observed?.removeListener?.('disconnect', disconnected);
    observed = undefined;
  }
  function context(): PlayContext {
    requireThat(current.account, 'Connect your wallet first.');
    return { client, provider: provider(), account: current.account, store,
      onState: state => { if (same(current.account, state.account)) { current.playState = state; emit(); } } };
  }
  async function walletMatches(ctx: PlayContext) {
    const [accounts, chain] = await Promise.all([
      ctx.provider.request({ method: 'eth_accounts' }), ctx.provider.request({ method: 'eth_chainId' }),
    ]);
    assertWalletContext(ctx.account, accounts, Number(chain));
  }
  function noPending(ctx: PlayContext) {
    requireThat(!loadAsset(ctx.account) && !loadPlayState(store, ctx.account).pending,
      'Recover your pending transaction before requesting another action.');
  }
  async function action<T>(label: string, work: () => Promise<T>): Promise<T> {
    requireThat(!operation, 'Another operation is already in progress.');
    operation = true; current.busy = label; emit();
    try {
      const key = `${PREFIX}operation:${current.account?.toLowerCase() ?? 'wallet'}`;
      if (typeof navigator !== 'undefined' && navigator.locks) return await navigator.locks.request(key, work);
      return await work();
    } finally { operation = false; current.busy = null; emit(); }
  }
  async function checkVerifier() {
    current.verifier = 'checking'; emit();
    try {
      const { response, body } = await fetchVerifierJson('/api/status', { cache: 'no-store' }, 20_000, request);
      const data = body as Record<string, unknown> | null;
      current.verifier = response.ok && data?.ready === true && data.chainId === PLAY_CHAIN_ID
        && typeof data.game === 'string' && same(data.game, PLAY_CONTRACTS.game)
        && typeof data.engineVersion === 'string' && same(data.engineVersion, ENGINE_VERSION) ? 'ready' : 'unavailable';
    } catch { current.verifier = 'unavailable'; }
    emit(); return current.verifier;
  }
  async function refresh() {
    const who = current.account, revision = epoch;
    current.verified = false; emit();
    const verified = await verifyPlayContracts(client);
    await checkVerifier();
    if (revision !== epoch) return snapshot();
    current.verified = true; current.paused = verified.paused; emit();
    if (!who) return snapshot();
    const token = (address: Address) => client.readContract({ address, abi: tokenAbi, functionName: 'balanceOf', args: [who] });
    const [eth, rf, rush, genesis, generations, allowance] = await Promise.all([
      client.getBalance({ address: who }), token(PLAY_CONTRACTS.rf), token(PLAY_CONTRACTS.rewardToken),
      token(PLAY_CONTRACTS.genesis), token(PLAY_CONTRACTS.generations),
      entryAllowance(client, who),
    ]);
    let saved = loadPlayState(store, who);
    const runId = saved.savedRun?.run.runId;
    const live = runId ? await readRun(client, runId) : null;
    saved = loadPlayState(store, who);
    if (live && saved.savedRun?.run.runId === live.runId) {
      saved.savedRun.run = live;
      if (live.claimed) saved.savedRun.status = 'claimed';
      else if (live.abandoned) saved.savedRun.status = 'abandoned';
    }
    if (revision !== epoch || !same(current.account, who)) return snapshot();
    current.balances = { eth, rf, rush, genesis, generations, allowance };
    current.assetPending = loadAsset(who); persist(saved);
    if (current.selected) await inspect(current.selected.collection, current.selected.tokenId);
    return snapshot();
  }
  async function restore() {
    const p = provider(), revision = ++epoch;
    const [accounts, chain] = await Promise.all([p.request({ method: 'eth_accounts' }), p.request({ method: 'eth_chainId' })]);
    if (revision !== epoch || disposed) return snapshot();
    current.account = accounts[0] ? getAddress(accounts[0]) : null; current.chainId = Number(chain);
    current.verified = false; current.balances = null; current.selected = null;
    current.playState = current.account ? loadPlayState(store, current.account) : null;
    current.assetPending = current.account ? loadAsset(current.account) : null; emit();
    if (current.account && current.chainId === PLAY_CHAIN_ID) await refresh();
    else await checkVerifier();
    return snapshot();
  }
  async function inspect(collection: Collection, tokenId: string) {
    const ctx = context(), revision = epoch;
    const friend = await readOwnedFriend(client, ctx.account, collection, tokenId);
    const block = await client.getBlock();
    const key = await client.readContract({ address: PLAY_CONTRACTS.game, abi: PLAY_GAME_ABI,
      functionName: 'nftKey', args: [collection, BigInt(tokenId)], blockNumber: block.number });
    const [starts, active] = await Promise.all(['dailyStarts', 'activeRunByNft'].map(functionName =>
      client.readContract({ address: PLAY_CONTRACTS.game, abi: PLAY_GAME_ABI, functionName,
        args: functionName === 'dailyStarts' ? [key, block.timestamp / 86400n] : [key], blockNumber: block.number })));
    const result = { ...friend, remainingStarts: Math.max(0, 3 - Number(starts)), activeRunId: String(active), utcDay: String(block.timestamp / 86400n) };
    requireThat(revision === epoch && same(current.account, ctx.account), 'Wallet changed while inspecting the Friend.');
    const saved = loadPlayState(store, ctx.account);
    if (!saved.friends.some(f => f.collection === collection && f.tokenId === tokenId)) saved.friends = [...saved.friends, friend].slice(-100);
    current.selected = result; persist(saved); return result;
  }
  function saveReplay(runId: string, replay: Replay, completedTicks: number) {
    const ctx = context(), state = loadPlayState(store, ctx.account), saved = state.savedRun;
    requireThat(saved && saved.run.runId === runId && !state.pending && !loadAsset(ctx.account), 'The saved run changed or has a pending transaction.');
    requireThat(!['claimed', 'abandoned'].includes(saved.status), 'This run is already finalized.');
    requireThat(completedTicks >= saved.completedTicks, 'Newer progress is already saved.');
    // Rebuild from the confirmed seed; never accept a caller-provided score or outcome.
    const recording = createRecorder(saved.run.seed, MODES[saved.run.difficulty], replay, completedTicks);
    const unchanged = completedTicks === saved.completedTicks
      && canonicalReplayHash(saved.replay) === canonicalReplayHash(recording.replay);
    saved.replay = recording.replay; saved.completedTicks = completedTicks;
    saved.status = recording.run.status === 'finished'
      ? recording.run.finishReason === 'time' && recording.run.hearts > 0 ? 'survived' : 'lost'
      : completedTicks ? 'playing' : 'ready';
    if (!unchanged) delete saved.claim;
    return persist(state);
  }
  async function settleAsset(ctx: PlayContext, pending: AssetPending, suppliedHash?: Hash) {
    requireThat(await client.getChainId() === PLAY_CHAIN_ID, 'Testnet RPC network mismatch.');
    if (suppliedHash) {
      requireThat(isHash(suppliedHash), 'Enter a complete transaction hash.');
      const tx = await client.getTransaction({ hash: suppliedHash });
      requireThat(same(tx.from, ctx.account) && tx.nonce === pending.nonce, 'That hash is not this wallet operation or its replacement.');
      pending.hash = suppliedHash; saveAsset(ctx.account, pending);
    }
    requireThat(pending.hash, 'Paste the submitted wallet transaction hash to recover this mint. Do not submit it again.');
    const receipt = await client.waitForTransactionReceipt({ hash: pending.hash, confirmations: 2, timeout: 120_000,
      onReplaced(value) {
        if (same(value.transaction.from, ctx.account) && value.transaction.nonce === pending.nonce) {
          pending.hash = value.transaction.hash; saveAsset(ctx.account, pending);
        }
      } });
    const [tx, head, block] = await Promise.all([client.getTransaction({ hash: receipt.transactionHash }),
      client.getBlockNumber({ cacheTime: 0 }), client.getBlock({ blockNumber: receipt.blockNumber })]);
    requireThat(same(tx.from, ctx.account) && tx.nonce === pending.nonce && (tx.chainId === undefined || tx.chainId === PLAY_CHAIN_ID)
      && receipt.transactionHash === tx.hash && same(receipt.from, tx.from) && same(receipt.to, tx.to)
      && tx.blockHash === receipt.blockHash && tx.blockNumber === receipt.blockNumber
      && block.hash === receipt.blockHash && head >= receipt.blockNumber + 1n, 'Mint requires two canonical confirmations.');
    if (!same(tx.to, pending.contract) || tx.input !== pending.data || tx.value !== 0n || receipt.status !== 'success') {
      saveAsset(ctx.account, null);
      throw new Error('The asset transaction reverted, was cancelled, or was replaced. No mint is credited.');
    }
    const ids = mintedIds(receipt, { ...pending, hash: receipt.transactionHash });
    const state = loadPlayState(store, ctx.account);
    if (pending.kind !== 'rf') for (const tokenId of ids) {
      const collection = pending.kind === 'genesis' ? 1 : 0;
      if (!state.friends.some(f => f.collection === collection && f.tokenId === tokenId)) state.friends.push({ collection, tokenId });
    }
    state.friends = state.friends.slice(-100); persist(state); saveAsset(ctx.account, null);
    return { hash: receipt.transactionHash, tokenIds: ids, collection: pending.kind === 'rf' ? null : pending.kind === 'genesis' ? 1 as const : 0 as const };
  }
  async function mintAsset(kind: AssetPending['kind']) {
    const ctx = context(); noPending(ctx); await walletMatches(ctx); await verifyPlayContracts(client);
    if (kind === 'rf') {
      const [last, block] = await Promise.all([
        client.readContract({ address: PLAY_CONTRACTS.rf, abi: tokenAbi, functionName: 'lastFaucetDayPlusOne', args: [ctx.account] }), client.getBlock(),
      ]);
      requireThat(faucetReady(last, block.timestamp), 'Test RF was already claimed today. It resets at 00:00 UTC.');
    }
    const contract = PLAY_CONTRACTS[kind], data = assetData(kind);
    await client.call({ account: ctx.account, to: contract, data, value: 0n });
    const nonce = await client.getTransactionCount({ address: ctx.account, blockTag: 'pending' });
    await walletMatches(ctx); noPending(ctx);
    const pending: AssetPending = { kind, account: ctx.account, contract, data, nonce, hash: null, createdAt: Date.now() };
    saveAsset(ctx.account, pending);
    try {
      pending.hash = await createWalletClient({ chain: TESTNET_CHAIN, transport: custom(ctx.provider) })
        .sendTransaction({ account: ctx.account, chain: TESTNET_CHAIN, to: contract, data, value: 0n, nonce });
    } catch (error) { if (refused(error)) saveAsset(ctx.account, null); throw error; }
    saveAsset(ctx.account, pending);
    const result = await settleAsset(ctx, pending);
    await refresh();
    if (result.collection !== null && result.tokenIds[0]) await inspect(result.collection, result.tokenIds[0]);
    return result;
  }
  async function verify(replay?: Replay, completedTicks?: number) {
    return action('Verifying replay', async () => {
      const ctx = context(); noPending(ctx); await walletMatches(ctx);
      let saved = loadPlayState(store, ctx.account).savedRun;
      requireThat(saved, 'Start and finish a testnet run first.');
      if (replay) { saveReplay(saved.run.runId, replay, completedTicks ?? maxRunTicks(saved.run.difficulty)); saved = loadPlayState(store, ctx.account).savedRun!; }
      requireThat(saved.status === 'survived', 'Only a run that survived the full timer can be verified.');
      const block = await client.getBlock();
      const end = BigInt(saved.run.startedAt) + BigInt(maxRunTicks(saved.run.difficulty) / 120);
      requireThat(block.timestamp >= end, `Wait ${Number(end - block.timestamp)} seconds for the onchain run timer before verifying.`);
      const auth = createAuthorization({ player: ctx.account, runId: saved.run.runId,
        replay: saved.replay, expiresAt: Math.floor(Date.now() / 1000) + 240 });
      const signature = await createWalletClient({ chain: TESTNET_CHAIN, transport: custom(ctx.provider), account: ctx.account })
        .signTypedData(authorizationTypedData(auth));
      await walletMatches(ctx);
      const { response, body } = await fetchVerifierJson('/api/verify-run', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ authorization: auth, signature, replay: saved.replay }) }, 35_000, request);
      if (!response.ok) throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error : 'Verification unavailable. Your replay is saved; try again.');
      const claim = validateVerifiedClaim(body, saved.run, saved.replay);
      const fresh = loadPlayState(store, ctx.account);
      requireThat(fresh.savedRun?.run.runId === saved.run.runId && fresh.savedRun.status === 'survived', 'Saved run changed. Refresh before claiming.');
      validateVerifiedClaim(claim, fresh.savedRun.run, fresh.savedRun.replay);
      fresh.savedRun.claim = claim; persist(fresh); return claim;
    });
  }
  const api = {
    snapshot, refresh, restore, inspect, inspectFriend: inspect, saveReplay, verify, checkVerifier,
    connect: () => action('Connecting wallet', async () => { await provider().request({ method: 'eth_requestAccounts' }); return restore(); }),
    switchChain: () => action('Switching to testnet', async () => {
      const p = provider();
      try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${PLAY_CHAIN_ID.toString(16)}` }] }); }
      catch (error) {
        if ((error as { code?: number }).code !== 4902) throw error;
        await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: `0x${PLAY_CHAIN_ID.toString(16)}`,
          chainName: TESTNET_CHAIN.name, nativeCurrency: TESTNET_CHAIN.nativeCurrency,
          rpcUrls: [...TESTNET_CHAIN.rpcUrls.default.http], blockExplorerUrls: [TESTNET_CHAIN.blockExplorers!.default.url] }] });
      }
      return restore();
    }),
    disconnect() { detach(); invalidate(); },
    discover: () => action('Finding owned Friends', async () => {
      const ctx = context(); const result = await discoverFriends(client, ctx.account, loadPlayState(store, ctx.account).friends);
      const state = loadPlayState(store, ctx.account); state.friends = result.friends; persist(state); return result;
    }),
    mint: (collection: Collection) => action('Minting test Friend', () => {
      requireThat(collection === 0 || collection === 1, 'Choose Genesis or Generations.');
      return mintAsset(collection === 1 ? 'genesis' : 'generations');
    }),
    faucet: () => action('Claiming test RF', () => mintAsset('rf')),
    approve: () => action('Approving 110 tRF', async () => { const ctx = context(); noPending(ctx); const result = await approveEntry(ctx); await refresh(); return result; }),
    start: (selection: RunSelection) => action('Starting onchain run', async () => {
      const ctx = context(); noPending(ctx);
      const result = await startRun(ctx, selection);
      requireThat(result.savedRun, 'The confirmed start did not return a run.');
      await refresh(); return result.savedRun.run;
    }),
    claim: () => action('Claiming test reward', async () => {
      const ctx = context(); noPending(ctx); const saved = loadPlayState(store, ctx.account).savedRun;
      requireThat(saved?.claim, 'Verify your completed replay first.');
      const state = await claimRun(ctx, saved.claim); await refresh(); return { state, reward: state.savedRun?.reward ?? null };
    }),
    abandon: () => action('Closing run', async () => {
      const ctx = context(); noPending(ctx); const saved = loadPlayState(store, ctx.account).savedRun;
      requireThat(saved, 'There is no saved run to close.');
      const state = await abandonRun(ctx, saved.run.runId); await refresh(); return state;
    }),
    recover: (hash?: Hash) => action('Recovering transaction', async () => {
      const ctx = context(), pending = loadAsset(ctx.account);
      if (pending) await settleAsset(ctx, pending, hash); else await recoverPending(ctx, hash);
      return refresh();
    }),
    retryPending: () => action('Retrying reserved nonce', async () => {
      const ctx = context(); requireThat(!loadAsset(ctx.account), 'For an asset mint, paste its wallet transaction hash to recover.');
      await retryHashlessPending(ctx); return refresh();
    }),
    cancelPending: () => action('Cancelling reserved nonce', async () => {
      const ctx = context(); requireThat(!loadAsset(ctx.account), 'For an asset mint, paste its wallet transaction hash or cancellation hash to recover.');
      await cancelHashlessPending(ctx); return refresh();
    }),
    recoverRun: (runId: string) => action('Recovering saved run', async () => {
      const ctx = context(); noPending(ctx);
      const run = await readRun(client, runId), state = loadPlayState(store, ctx.account);
      requireThat(same(run.player, ctx.account), 'That run belongs to another wallet.');
      if (state.savedRun && state.savedRun.run.runId !== runId && !['claimed', 'abandoned'].includes(state.savedRun.status)) {
        const old = await readRun(client, state.savedRun.run.runId), block = await client.getBlock();
        requireThat(old.claimed || old.abandoned || block.timestamp > BigInt(old.claimUntil), 'Finish or abandon the saved run before recovering another.');
      }
      if (state.savedRun?.run.runId !== runId) state.savedRun = { run, replay: { version: REPLAY_VERSION, frames: [] }, completedTicks: 0, status: 'ready' };
      state.savedRun.run = run;
      if (run.claimed) state.savedRun.status = 'claimed'; else if (run.abandoned) state.savedRun.status = 'abandoned';
      return persist(state);
    }),
    dispose() { disposed = true; epoch++; detach(); },
  };
  return api;
}
export const createAgentTestnet = createTestnetAdapter;
export type AgentTestnetAdapter = ReturnType<typeof createTestnetAdapter>;
