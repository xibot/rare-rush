import { createPublicClient, createWalletClient, custom, defineChain, formatUnits, http, isAddress, isHash, type Address, type EIP1193Provider, type Hash, type TransactionReceipt } from 'viem';
import { tokenAbi, nftAbi, gameAbi } from './abi.ts';
import { mintedIds, type PendingMint } from './receipts.ts';
import { CHAIN_ID, CONTRACT_KEYS, EXPLORER_URL, FAUCET_URL, RPC_URL, actionBlockReason, assertRewardEconomics, assertWalletContext, escapeHtml as e, faucetReady, parseConfig, type PublicConfig } from './safety.ts';
import './style.css';
import './navbar.css';
import { loadPlayState, savePlayState } from './play/storage.ts';
import { createWalletSession } from './wallet-session.ts';

type BrowserProvider = EIP1193Provider & { on?: (event: string, listener: (...args: unknown[]) => void) => void };
declare global { interface Window { ethereum?: BrowserProvider } }
const chain = defineChain({ id: CHAIN_ID, name: 'Robinhood Testnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } }, blockExplorers: { default: { name: 'Robinhood Explorer', url: EXPLORER_URL } }, testnet: true });
const client = createPublicClient({ chain, transport: http(RPC_URL, { timeout: 12_000, retryCount: 1 }) });
const root = document.querySelector<HTMLDivElement>('#app')!;
const state = {
  config: null as PublicConfig | null, configLoading: true, verified: false,
  account: null as Address | null, walletChain: null as number | null, busy: false,
  balances: null as null | { eth: string; rf: string; rush: string; genesis: string; generations: string },
  readyForFaucet: null as boolean | null, message: '', error: '',
  tx: null as Hash | null, txStatus: '' as 'pending' | 'confirmed' | 'failed' | 'not-minted' | '',
  friends: [] as { collection: 'genesis' | 'generations'; tokenId: string }[],
  pending: null as PendingMint | null,
};
let contextVersion = 0;
const walletSession = createWalletSession({
  invalidated() {
    contextVersion++;
    state.account = null; state.walletChain = null; state.friends = []; state.balances = null; state.readyForFaucet = null;
    render();
  },
  async changed({ account, chainId }) {
    state.account = account; state.walletChain = chainId; state.error = ''; state.message = '';
    render();
    if (account) await refresh();
  },
  error(error) { state.error = errorMessage(error); render(); },
});
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const number = (value: bigint, decimals: number) => Number(formatUnits(value, decimals)).toLocaleString('en-US', { maximumFractionDigits: decimals === 18 ? 5 : 3 });
const blockReason = () => state.pending ? 'A transaction is pending. Refresh its status before minting again.' : actionBlockReason({ ...state, contracts: state.config?.contracts ?? null });
const disabled = (extra = false) => blockReason() || extra ? 'disabled' : '';
function errorMessage(error: unknown): string {
  const value = error as { shortMessage?: string; message?: string; code?: number };
  if (value?.code === 4001 || /rejected|denied/i.test(value?.message ?? '')) return 'Request declined. Your wallet is still yours—try again when ready.';
  return value?.shortMessage ?? value?.message ?? 'Something did not connect. Please try again.';
}
function statusLabel() {
  if (state.configLoading) return 'CHECKING CONFIGURATION';
  if (!state.config) return 'CONFIGURATION UNAVAILABLE';
  if (!state.config.contracts) return 'CONTRACTS AWAITING DEPLOYMENT';
  if (!state.verified) return 'CONTRACT CHECKS INCOMPLETE';
  return 'TEST CONTRACTS VERIFIED';
}
function render() {
  const contracts = state.config?.contracts;
  const account = state.account;
  root.innerHTML = `
    <div class="lab-shell">
      <header class="site-header">
        <a class="brand" href="/" aria-label="Rare Rush testnet home"><img src="/assets/rare-friend.svg" width="60" height="60" alt=""/><span><strong>RARE<span>RUSH</span></strong><small>BY XIBOT</small></span></a>
        <nav aria-label="Main navigation"><a href="/dashboard/">DASHBOARD</a><a href="https://rarerush.app" class="arcade-link">TRY ARCADE</a><a href="/play/" class="outline-link play-link">PLAY TESTNET <span aria-hidden="true">↗</span></a></nav>
      </header>
      <main>
        <section class="hero" aria-labelledby="hero-title">
          <div class="hero-copy"><span class="eyebrow"><i></i> NEXT LEVEL / TESTNET LAB</span><h1 id="hero-title">SMALL FRIEND.<br><span>REAL TEST.</span></h1><p>The next chapter of the rush.<br>Test the tokens. Meet your test Friends.<br>Help bring play-to-mint to life.</p><a href="#test-kit" class="primary-link">BUILD YOUR TEST KIT <span>↓</span></a><span class="tiny hero-note">ROBINHOOD TESTNET · CHAIN 46630</span></div>
          <div class="lab-display" aria-label="Testnet development status"><div class="display-top"><span>RARE RUSH / EXPERIMENT 001</span><span class="status-dot">TESTNET</span></div><div class="coin-orbit" aria-hidden="true"><span class="orbit orbit-one"></span><span class="orbit orbit-two"></span><span class="cross cross-one">+</span><span class="cross cross-two">+</span><span class="cross cross-three">+</span><img class="hero-coin" src="/assets/rare-friend.svg" alt=""/><span class="orbit-label">PLAY → VERIFY → MINT</span></div><div class="display-bottom"><strong>${statusLabel()}</strong><span>${state.verified ? 'Faucets ready. Choose a Friend and play to mint.' : 'The lab is open. Play to mint is ready on the testnet.'}</span></div></div>
        </section>
        <div class="test-banner"><strong>TEST TOKENS. ZERO REAL VALUE.</strong><span>No real RF needed. Test NFTs are separate from your real Rare Friends.</span></div>
        <section class="kit-section" id="test-kit" aria-labelledby="kit-title">
          <div class="section-heading"><div><span class="eyebrow">01 / GET SET</span><h2 id="kit-title">YOUR TEST KIT.</h2></div><span class="phase-tag">${state.verified ? 'FAUCETS AVAILABLE' : 'PREPARING FOR DEPLOYMENT'}</span></div>
          <div class="wallet-panel"><div><span class="tiny">YOUR WALLET</span><strong>${account ? e(short(account)) : 'BRING YOUR CURIOSITY.'}</strong><p>${account ? (state.walletChain === CHAIN_ID ? 'Connected to Robinhood testnet.' : 'Switch to Robinhood testnet to use the lab.') : 'Connect a browser wallet to get started. No signature or payment is needed to connect.'}</p></div><div class="wallet-actions">${account ? `${state.walletChain !== CHAIN_ID ? '<button id="switch-network" class="primary-button" ' + (state.busy ? 'disabled' : '') + '>SWITCH TO TESTNET ↗</button>' : '<button id="refresh" class="outline-button" ' + (state.busy ? 'disabled' : '') + '>REFRESH ↻</button>'}<button id="disconnect" class="text-button" ${state.busy ? 'disabled' : ''}>DISCONNECT</button>` : `<button id="connect" class="primary-button" ${state.busy ? 'disabled' : ''}>CONNECT WALLET ↗</button>`}</div></div>
          <div class="balance-row"><div><span>GAS / TEST ETH</span><strong>${state.balances?.eth ?? '—'}</strong></div><div><span>TEST RF</span><strong>${state.balances?.rf ?? '—'}</strong></div><div><span>TEST RARERUSH</span><strong>${state.balances?.rush ?? '—'}</strong></div></div>
          <div id="feedback" class="feedback ${state.error ? 'error' : ''}" aria-live="polite" role="status">${state.error ? e(state.error) : e(state.message || (contracts ? blockReason() ?? 'Your test kit is ready. Each mint needs a wallet transaction.' : 'Contracts awaiting deployment. Connect your wallet and get free test gas while we prepare the faucets.'))}${state.tx ? `<a href="${EXPLORER_URL}/tx/${state.tx}" target="_blank" rel="noopener noreferrer">${state.txStatus === 'confirmed' ? 'CONFIRMED' : state.txStatus === 'failed' ? 'FAILED' : state.txStatus === 'not-minted' ? 'CONFIRMED WITHOUT MINT' : 'PENDING'} · VIEW TRANSACTION ↗</a>` : ''}</div>
          <div class="kit-grid">
            <article class="kit-card"><div class="card-top"><span>01 / FUEL UP</span><span class="card-glyph" aria-hidden="true">↗</span></div><h3>A LITTLE GAS.</h3><p>Get free test ETH from the official Robinhood faucet. It pays the testnet transaction fees.</p><div class="card-meta">FREE TEST ETH · EXTERNAL FAUCET</div><a class="outline-link full" href="${FAUCET_URL}" target="_blank" rel="noopener noreferrer">GET TEST ETH ↗</a></article>
            <article class="kit-card"><div class="card-top"><span>02 / STACK TEST RF</span><img src="/assets/rare-friend.svg" width="52" height="52" alt=""/></div><h3>1,100 <span>tRF</span>.</h3><p>Our test RF faucet gives each wallet 1,100 tRF per UTC day. Enough for 10 Generations entries.</p><div class="card-meta">${state.readyForFaucet === false ? 'CLAIMED TODAY · RESETS AT 00:00 UTC' : 'ONCE PER WALLET / UTC DAY'}</div><button id="claim-rf" class="primary-button full" ${disabled(state.readyForFaucet !== true)}>CLAIM TEST RF ↗</button></article>
            <article class="kit-card"><div class="card-top"><span>03 / MEET A FRIEND</span><span class="card-glyph pixel-friend" aria-hidden="true">▟▙</span></div><h3>PICK YOUR CREW.</h3><p>Mint free test NFTs to try both collections. These are test identities, not real Rare Friends.</p><div class="card-meta">${state.balances ? `${state.balances.genesis} GENESIS · ${state.balances.generations} GENERATIONS` : 'GENESIS + GENERATIONS'}</div><div class="mint-actions"><button id="mint-genesis" class="outline-button" ${disabled()}>GENESIS +</button><button id="mint-generations" class="outline-button" ${disabled()}>GENERATIONS +</button></div></article>
          </div>
          ${state.friends.length ? `<div class="minted-panel"><span class="eyebrow">FRESHLY MINTED IN THIS SESSION</span><div class="minted-list">${state.friends.map(friend => `<a href="${EXPLORER_URL}/token/${contracts![friend.collection]}/instance/${friend.tokenId}" target="_blank" rel="noopener noreferrer"><img src="/assets/rare-friend.svg" width="36" height="36" alt=""/><span>TEST ${friend.collection.toUpperCase()}<strong>#${friend.tokenId} ↗</strong></span></a>`).join('')}</div><p>IDs come from confirmed mint receipts. The balances above include all test NFTs currently in your wallet.</p></div>` : ''}
        </section>
        <section class="rules-section" aria-labelledby="rules-title"><div class="section-heading"><div><span class="eyebrow">02 / KNOW THE RULES</span><h2 id="rules-title">SAME RUSH.<br><span>NEW POSSIBILITIES.</span></h2></div><p>Start a run. Beat the timer.<br>Verify and claim your testnet reward.</p></div><div class="rules-grid"><article><span class="tiny">GENERATIONS ENTRY</span><strong>110 <small>tRF</small></strong><p>100 to the prize pool.<br>10 to the treasury.</p></article><article><span class="tiny">GENESIS ENTRY</span><strong>FREE</strong><p>100× gameplay rewards.<br>A big rush for the originals.</p></article><article><span class="tiny">DAILY ATTEMPTS</span><strong>3 <small>/ NFT</small></strong><p>Three starts per UTC day.<br>Across all difficulties.</p></article><article><span class="tiny">TEST TOKEN CAP</span><strong>1.024B</strong><p>102.4M launch reserve.<br>921.6M gameplay rewards.</p></article></div><div class="mode-strip"><span>EASY <b>120s · 0.75×</b></span><span>NORMAL <b>90s · 1×</b></span><span>DEGEN <b>60s · 2×</b></span></div></section>
        <section class="next-section" aria-labelledby="next-title"><div><span class="eyebrow">03 / WHAT WE’RE BUILDING</span><h2 id="next-title">EARN THE RUSH.</h2><p>Collect coins. Survive the timer. Verify the run. Mint your reward.</p></div><ol class="progress-list"><li><span>01</span><div><strong>TEST ECONOMY</strong><p>${state.verified ? 'Contracts are deployed and checked. Test RF and NFT faucets are ready.' : 'The deployed test contracts are ready. Connect to check your test kit.'}</p></div><b>${state.verified ? 'DEPLOYED' : 'IN PROGRESS'}</b></li><li><span>02</span><div><strong>PLAY TO MINT</strong><p>Start with your wallet, survive the timer, verify your replay and claim test RARERUSH.</p></div><b>READY</b></li><li><span>03</span><div><strong>RARERUSH / RF</strong><p>Launch, swaps and signed reward minting verified locally. Public factory approval and liquidity deployment are pending. No public pool is live.</p></div><b>LOCAL FORK<br>PASSED</b></li></ol><div class="play-callout"><p>Test kit ready?<br><strong>Make your next run count.</strong></p><a href="/play/" class="primary-link">PLAY TESTNET ↗</a><small>Uses test NFTs and wallet-confirmed testnet transactions. All tokens are valueless.</small></div></section>
        <section class="contracts-section" aria-labelledby="contracts-title"><div class="section-heading"><div><span class="eyebrow">OPEN LAB / PUBLIC ADDRESSES</span><h2 id="contracts-title">CHECK THE CHAIN.</h2></div><a href="${EXPLORER_URL}" target="_blank" rel="noopener noreferrer">TESTNET EXPLORER ↗</a></div>${contracts ? `<dl class="contract-list">${CONTRACT_KEYS.map(key => `<div><dt>${{ game: 'Game', rf: 'Test RF', genesis: 'Test Genesis', generations: 'Test Generations', rewardToken: 'Test RARERUSH' }[key]}</dt><dd><a href="${EXPLORER_URL}/address/${contracts[key]}" target="_blank" rel="noopener noreferrer">${contracts[key]} ↗</a></dd></div>`).join('')}</dl>` : '<div class="empty-contracts"><span class="status-square"></span><p><strong>Contracts awaiting deployment.</strong><br>Verified addresses will appear here when the testnet deployment is ready.</p></div>'}${state.config?.deploymentConsoleUrl ? '<a class="outline-link deploy-link" href="/deploy/">OPERATOR DEPLOYMENT CONSOLE ↗</a>' : ''}</section>
      </main><footer><span>RARE RUSH <b>BY XIBOT</b></span><span>TEST IDEAS. KEEP IT RARE.</span><a href="https://github.com/xibot/rare-rush" target="_blank" rel="noopener noreferrer">SOURCE ↗</a></footer>
    </div>`;
  document.querySelector('#connect')?.addEventListener('click', connect);
  document.querySelector('#disconnect')?.addEventListener('click', disconnect);
  document.querySelector('#switch-network')?.addEventListener('click', switchNetwork);
  document.querySelector('#refresh')?.addEventListener('click', () => void refresh());
  document.querySelector('#claim-rf')?.addEventListener('click', () => void transact('rf'));
  document.querySelector('#mint-genesis')?.addEventListener('click', () => void transact('genesis'));
  document.querySelector('#mint-generations')?.addEventListener('click', () => void transact('generations'));
}

function provider() {
  const value = window.ethereum;
  if (!value) throw new Error('Open this page in a wallet browser, or install a browser wallet, then connect.');
  return value;
}

async function connect() {
  state.error = ''; state.busy = true; render();
  try {
    await walletSession.connect();
  } catch (error) { state.error = errorMessage(error); }
  finally { state.busy = false; render(); }
}
function disconnect() {
  walletSession.disconnect();
  state.error = ''; state.message = 'Disconnected from Rare Rush testnet.'; render();
}
async function switchNetwork() {
  state.error = ''; state.busy = true; render();
  try {
    const wallet = provider();
    try { await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }] }); }
    catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      await wallet.request({ method: 'wallet_addEthereumChain', params: [{ chainId: `0x${CHAIN_ID.toString(16)}`, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [RPC_URL], blockExplorerUrls: [EXPLORER_URL] }] });
      await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }] });
    }
    await walletSession.sync(true);
  } catch (error) { state.error = errorMessage(error); }
  finally { state.busy = false; render(); }
}

async function verifyContracts() {
  state.verified = false;
  const contracts = state.config?.contracts;
  if (!contracts) return;
  if (await client.getChainId() !== CHAIN_ID) throw new Error('RPC network mismatch. Contract actions are disabled.');
  // Compare supply and minted counters from one block, even when another player claims mid-read.
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const code = await Promise.all(CONTRACT_KEYS.map(key => client.getBytecode({ address: contracts[key], blockNumber })));
  if (code.some(value => !value || value === '0x')) throw new Error('A configured contract is not deployed. Contract actions are disabled.');
  const [rf, genesis, generations, rewardToken, fee, prize, treasury, daily, cap, minter, decimals, amount, isGenesis, isGenerations,
    launch, expectedLaunch, gameplay, minted, supply, initial, minimum, interval] = await Promise.all([
    client.readContract({ address: contracts.game, abi: gameAbi, functionName: 'rf', blockNumber }),
    client.readContract({ address: contracts.game, abi: gameAbi, functionName: 'genesis', blockNumber }),
    client.readContract({ address: contracts.game, abi: gameAbi, functionName: 'generations', blockNumber }),
    client.readContract({ address: contracts.game, abi: gameAbi, functionName: 'token', blockNumber }),
    client.readContract({ address: contracts.game, abi: gameAbi, functionName: 'ENTRY_FEE', blockNumber }),
    client.readContract({ address: contracts.game, abi: gameAbi, functionName: 'PRIZE_POOL_SHARE', blockNumber }),
    client.readContract({ address: contracts.game, abi: gameAbi, functionName: 'TREASURY_SHARE', blockNumber }),
    client.readContract({ address: contracts.game, abi: gameAbi, functionName: 'MAX_DAILY_RUNS', blockNumber }),
    client.readContract({ address: contracts.rewardToken, abi: tokenAbi, functionName: 'CAP', blockNumber }),
    client.readContract({ address: contracts.rewardToken, abi: tokenAbi, functionName: 'rewardMinter', blockNumber }),
    client.readContract({ address: contracts.rewardToken, abi: tokenAbi, functionName: 'decimals', blockNumber }),
    client.readContract({ address: contracts.rf, abi: tokenAbi, functionName: 'FAUCET_AMOUNT', blockNumber }),
    client.readContract({ address: contracts.genesis, abi: nftAbi, functionName: 'isGenesis', blockNumber }),
    client.readContract({ address: contracts.generations, abi: nftAbi, functionName: 'isGenesis', blockNumber }),
    client.readContract({ address: contracts.rewardToken, abi: tokenAbi, functionName: 'launchAllocation', blockNumber }),
    client.readContract({ address: contracts.game, abi: gameAbi, functionName: 'expectedLaunchAllocation', blockNumber }),
    client.readContract({ address: contracts.rewardToken, abi: tokenAbi, functionName: 'rewardAllocation', blockNumber }),
    client.readContract({ address: contracts.rewardToken, abi: tokenAbi, functionName: 'rewardsMinted', blockNumber }),
    client.readContract({ address: contracts.rewardToken, abi: tokenAbi, functionName: 'totalSupply', blockNumber }),
    client.readContract({ address: contracts.game, abi: gameAbi, functionName: 'INITIAL_COIN_REWARD', blockNumber }),
    client.readContract({ address: contracts.game, abi: gameAbi, functionName: 'MIN_COIN_REWARD', blockNumber }),
    client.readContract({ address: contracts.game, abi: gameAbi, functionName: 'HALVING_INTERVAL', blockNumber }),
  ]);
  const same = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase();
  if (!same(rf, contracts.rf) || !same(genesis, contracts.genesis) || !same(generations, contracts.generations) || !same(rewardToken, contracts.rewardToken) || fee !== 110n * 10n ** 18n || prize !== 100n * 10n ** 18n || treasury !== 10n * 10n ** 18n || daily !== 3n || amount !== 1100n * 10n ** 18n || !isGenesis || isGenerations) {
    throw new Error('The deployed contracts do not match this test kit. Actions are disabled.');
  }
  assertRewardEconomics({ cap, decimals, minter, game: contracts.game, launch, expectedLaunch, gameplay, minted, supply, initial, minimum, interval });
  state.verified = true;
}

async function refresh() {
  const version = contextVersion;
  const account = state.account;
  const contracts = state.config?.contracts;
  if (!account) return;
  state.error = '';
  try {
    if (state.pending) {
      const pending = state.pending;
      try {
        const receipt = await client.getTransactionReceipt({ hash: pending.hash });
        const block = await client.getBlockNumber({ cacheTime: 0 });
        if (block >= receipt.blockNumber + 1n) settleReceipt(receipt, pending);
      }
      catch (error) { if ((error as { name?: string }).name !== 'TransactionReceiptNotFoundError') throw error; }
    }
    const eth = await client.getBalance({ address: account });
    let balances = { eth: number(eth, 18), rf: '—', rush: '—', genesis: '—', generations: '—' };
    let ready: boolean | null = null;
    if (contracts) {
      await verifyContracts();
      const [rf, rush, genesis, generations, lastDay, block] = await Promise.all([
        client.readContract({ address: contracts.rf, abi: tokenAbi, functionName: 'balanceOf', args: [account] }),
        client.readContract({ address: contracts.rewardToken, abi: tokenAbi, functionName: 'balanceOf', args: [account] }),
        client.readContract({ address: contracts.genesis, abi: nftAbi, functionName: 'balanceOf', args: [account] }),
        client.readContract({ address: contracts.generations, abi: nftAbi, functionName: 'balanceOf', args: [account] }),
        client.readContract({ address: contracts.rf, abi: tokenAbi, functionName: 'lastFaucetDayPlusOne', args: [account] }),
        client.getBlock(),
      ]);
      balances = { eth: number(eth, 18), rf: number(rf, 18), rush: number(rush, 6), genesis: genesis.toString(), generations: generations.toString() };
      ready = faucetReady(lastDay, block.timestamp);
    }
    if (version !== contextVersion || state.account !== account) return;
    state.balances = balances; state.readyForFaucet = ready;
  } catch (error) { if (version === contextVersion) { state.error = errorMessage(error); state.readyForFaucet = null; } }
  render();
}

function savePending(pending: PendingMint | null) {
  state.pending = pending;
  try { if (pending) sessionStorage.setItem('rare-rush-testnet-pending', JSON.stringify(pending)); else sessionStorage.removeItem('rare-rush-testnet-pending'); } catch { /* Wallet transaction tracking remains available for this session. */ }
}
function settleReceipt(receipt: TransactionReceipt, pending: PendingMint) {
  if (!state.pending || state.pending.hash !== pending.hash || receipt.transactionHash !== pending.hash) return;
  state.tx = receipt.transactionHash;
  savePending(null);
  let ids: string[];
  try { ids = mintedIds(receipt, pending); }
  catch (error) { state.txStatus = receipt.status === 'reverted' ? 'failed' : 'not-minted'; throw error; }
  state.txStatus = 'confirmed';
  const currentAccount = state.account?.toLowerCase() === pending.account.toLowerCase();
  if (pending.kind === 'rf') {
    state.message = `Confirmed: 1,100 test RF minted to ${short(pending.account)}.`;
    return;
  }
  const kind = pending.kind;
  if (currentAccount) {
    for (const id of ids) if (!state.friends.some(friend => friend.collection === kind && friend.tokenId === id)) state.friends.unshift({ collection: kind, tokenId: id });
    state.friends = state.friends.slice(0, 12);
  }
  // Remember confirmed mint IDs for the game; no additional transaction is needed.
  try {
    const play = loadPlayState(localStorage, pending.account);
    for (const tokenId of ids) {
      const collection = kind === 'genesis' ? 1 : 0;
      if (!play.friends.some(f => f.collection === collection && f.tokenId === tokenId)) play.friends.push({ collection, tokenId });
    }
    play.friends = play.friends.slice(-100);
    savePlayState(localStorage, play);
  } catch { /* Confirmed mint stays visible; manual NFT-ID entry also works in the game. */ }
  state.message = `Confirmed: test ${kind === 'genesis' ? 'Genesis' : 'Generations'} NFT minted to ${short(pending.account)}. Keep the receipt below.`;
}

async function transact(kind: 'rf' | 'genesis' | 'generations') {
  const blocked = blockReason();
  if (blocked) { state.error = blocked; render(); return; }
  const contracts = state.config!.contracts!;
  const account = state.account!;
  const version = contextVersion;
  state.busy = true; state.error = ''; state.tx = null; state.txStatus = ''; state.message = 'Checking your wallet and testnet contracts…'; render();
  try {
    const wallet = provider();
    await verifyContracts();
    if (kind === 'rf') {
      const [lastDay, block] = await Promise.all([
        client.readContract({ address: contracts.rf, abi: tokenAbi, functionName: 'lastFaucetDayPlusOne', args: [account] }), client.getBlock(),
      ]);
      if (!faucetReady(lastDay, block.timestamp)) throw new Error('You already claimed test RF today. Come back after 00:00 UTC.');
    }
    // Query the wallet again immediately before sending. A previous UI state is not authorization.
    const [accounts, chainId] = await Promise.all([wallet.request({ method: 'eth_accounts' }), wallet.request({ method: 'eth_chainId' })]);
    assertWalletContext(account, accounts, Number(chainId));
    if (version !== contextVersion) throw new Error('Wallet changed during this request. Try again.');
    const writer = createWalletClient({ account, chain, transport: custom(wallet) });
    state.message = kind === 'rf' ? 'Confirm the free test RF claim in your wallet. Only test ETH gas is needed.' : 'Confirm your free test NFT mint in your wallet. Only test ETH gas is needed.'; render();
    const hash = kind === 'rf'
      ? await writer.writeContract({ address: contracts.rf, abi: tokenAbi, functionName: 'faucet', account, chain })
      : await writer.writeContract({ address: contracts[kind], abi: nftAbi, functionName: 'mint', account, chain });
    const pending = { hash, account, contract: contracts[kind], kind };
    savePending(pending);
    state.tx = hash; state.txStatus = 'pending'; state.message = 'Transaction sent. Waiting for testnet confirmation…'; render();
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000, onReplaced(replacement) {
      pending.hash = replacement.transaction.hash;
      savePending(pending);
      state.tx = pending.hash;
      state.message = replacement.reason === 'cancelled' ? 'Cancellation sent. Checking its testnet receipt…' : 'Transaction replacement detected. Checking the new receipt…';
      render();
    } });
    settleReceipt(receipt, pending);
    if (version === contextVersion) await refresh();
  } catch (error) { state.error = state.pending ? 'Your transaction is still tracked. Use Refresh to check confirmation before minting again.' : errorMessage(error); }
  finally { state.busy = false; render(); }
}

async function init() {
  render();
  try {
    const response = await fetch('/testnet-config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Public testnet configuration could not be loaded.');
    state.config = parseConfig(await response.json());
    try {
      const pending = JSON.parse(sessionStorage.getItem('rare-rush-testnet-pending') ?? 'null') as PendingMint | null;
      if (pending && isHash(pending.hash) && isAddress(pending.account) && isAddress(pending.contract) && ['rf', 'genesis', 'generations'].includes(pending.kind) && state.config.contracts?.[pending.kind]?.toLowerCase() === pending.contract.toLowerCase()) {
        state.pending = pending; state.tx = pending.hash; state.txStatus = 'pending';
      }
    } catch { /* Ignore malformed browser storage. */ }
    await verifyContracts();
  } catch (error) { state.error = errorMessage(error); }
  finally { state.configLoading = false; render(); walletSession.start(); }
}
void init();
