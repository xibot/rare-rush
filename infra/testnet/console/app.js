import {
  createPublicClient, createWalletClient, custom, defineChain, encodeDeployData, encodeFunctionData,
  formatEther, http, isAddress, keccak256,
} from 'viem';
import { ARTIFACT_NAMES, AUTHORIZED_OWNER, LAUNCH_ALLOCATION, GAMEPLAY_ALLOCATION, REWARD_CAP,
  same, validHash, json, economics, publicConfig, artifactFingerprint, constructorArgs, DEPLOYMENT_VERSION, REUSED_ASSETS, verifyReusedAssets } from '../src/deployment-config.mjs';

const RPC = 'https://rpc.testnet.chain.robinhood.com';
const EXPLORER = 'https://explorer.testnet.chain.robinhood.com';
const OWNER = AUTHORIZED_OWNER;
const chain = defineChain({ id: 46630, name: 'Robinhood Chain Testnet', testnet: true,
  nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } }, blockExplorers: { default: { name: 'Explorer', url: EXPLORER } } });
const client = createPublicClient({ chain, transport: http(RPC, { retryCount: 1, timeout: 15_000 }) });
const steps = [
  { id: 'game', artifact: 'RareRushGame', title: 'Rare Rush V2 Game', description: 'Verified runs, three NFT starts daily, Genesis 100× rewards. Gameplay stays disabled until its token is bound.' },
  { id: 'rewardToken', artifact: 'RareRushToken', title: 'V2 Reward Token', description: '1.024B cap: 102.4M launch reserve to your owner wallet + 921.6M reserved for verified gameplay. Test allocation; no liquidity pool is deployed.' },
  { id: 'bind', artifact: 'RareRushGame', title: 'Bind Reward Token', description: 'One-time connection of this reward token to this game. The game is the only authorized reward minter.' },
];
const $ = id => document.getElementById(id);
let config, artifacts, key, fingerprint, state, account, walletChain, busy = false, ready = false;
const verified = new Set();
const estimates = new Map();
let walletClient;
let reusedEvidence;

function message(id, text, error = false) {
  $(id).textContent = text;
  $(id).classList.toggle('error', error);
}
function readable(error) {
  let current = error;
  for (let depth = 0; current && depth < 8; depth++, current = current.cause) {
    if (current.code === 4001) return 'Wallet request declined. Nothing was sent. Try again when ready.';
  }
  return error.shortMessage ?? error.message ?? 'The request could not finish. Please retry.';
}
function rejected(error) {
  for (let current = error, depth = 0; current && depth < 8; current = current.cause, depth++) {
    if (current.code === 4001) return true;
  }
  return false;
}
function loadState() {
  // Detect older engine/verifier-scoped records rather than hiding progress behind a new key.
  for (const existingKey of Object.keys(localStorage)) {
    if (existingKey === key || !existingKey.startsWith(`rare-rush-${DEPLOYMENT_VERSION}-deploy:${config.owner.toLowerCase()}`)) continue;
    let older;
    try { older = JSON.parse(localStorage.getItem(existingKey)); } catch { throw new Error('Older deployment progress is unreadable. It has been preserved for reconciliation.'); }
    if (Object.keys(older?.deployments ?? {}).length) throw new Error('An older deployment has saved transactions. Existing progress was preserved; reconcile it before using this updated package.');
  }
  const stored = localStorage.getItem(key);
  if (!stored) return { fingerprint, deployments: {} };
  const parsed = JSON.parse(stored);
  if (!parsed.deployments || typeof parsed.deployments !== 'object') throw new Error('Saved deployment progress is invalid. Do not redeploy until the existing transactions are checked.');
  if (parsed.fingerprint !== fingerprint) {
    // An untouched page is safe to refresh after an economics/configuration change.
    // Any actual or ambiguous deployment must remain visible for reconciliation.
    if (Object.keys(parsed.deployments).length === 0) return { fingerprint, deployments: {} };
    throw new Error('The compiled contracts or public configuration changed. Existing deployment progress was preserved. Reconcile previous transactions before starting a new deployment.');
  }
  for (const [id, value] of Object.entries(parsed.deployments)) {
    if (!steps.some(step => step.id === id) || !value || !['awaiting-wallet', 'pending', 'confirmed', 'failed'].includes(value.status) ||
      (value.hash && !validHash(value.hash)) || (value.address && !isAddress(value.address)) || !Number.isSafeInteger(value.nonce) || value.nonce < 0) {
      throw new Error('Saved deployment progress is invalid. Existing transactions must be checked before continuing.');
    }
  }
  return parsed;
}
function persist() { localStorage.setItem(key, json(state)); }
function argumentsFor(id) { return constructorArgs(id, config, state.deployments); }
function deploymentData(step) {
  const artifact = artifacts[step.artifact];
  if (step.id === 'bind') return encodeFunctionData({ abi: artifact.abi, functionName: 'bindRewardToken', args: argumentsFor('bind') });
  return encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: argumentsFor(step.id) });
}
function destinationFor(step) { return step.id === 'bind' ? state.deployments.game.address : undefined; }
async function validateGame(address, requireBound = false) {
  const names = ['owner', 'verifier', 'treasury', 'engineVersion', 'token', 'rf', 'genesis', 'generations', 'ENTRY_FEE', 'PRIZE_POOL_SHARE', 'TREASURY_SHARE', 'expectedLaunchAllocation', 'MAX_DAILY_RUNS', 'INITIAL_COIN_REWARD', 'MIN_COIN_REWARD', 'HALVING_INTERVAL'];
  const values = await Promise.all(names.map(functionName => client.readContract({ address, abi: artifacts.RareRushGame.abi, functionName })));
  const result = Object.fromEntries(names.map((name, index) => [name, values[index]]));
  if (!same(result.owner, config.owner) || !same(result.verifier, config.verifier) || !same(result.treasury, config.treasury) || !same(result.engineVersion, config.engineVersion) ||
      !same(result.rf, config.reusedAssets.rf) || !same(result.genesis, config.reusedAssets.genesis) || !same(result.generations, config.reusedAssets.generations)) {
    throw new Error('The deployed game configuration does not match this console.');
  }
  if (result.ENTRY_FEE !== 110n * 10n ** 18n || result.PRIZE_POOL_SHARE !== 100n * 10n ** 18n || result.TREASURY_SHARE !== 10n * 10n ** 18n) throw new Error('The deployed fee split does not match the reviewed economics.');
  if (result.expectedLaunchAllocation !== LAUNCH_ALLOCATION || Number(result.MAX_DAILY_RUNS) !== 3 || result.INITIAL_COIN_REWARD !== 10_000_000n || result.MIN_COIN_REWARD !== 1_000_000n || result.HALVING_INTERVAL !== 10_000n) throw new Error('The deployed reward allocation or test emission settings do not match this console.');
  const zero = /^0x0{40}$/i.test(result.token);
  if ((requireBound && !same(result.token, state.deployments.rewardToken?.address)) || (!zero && !same(result.token, state.deployments.rewardToken?.address))) throw new Error('The game is bound to an unexpected reward token.');
}
async function validateToken(address) {
  const names = ['owner', 'rewardMinter', 'launchAllocation', 'rewardAllocation', 'CAP', 'decimals'];
  const values = await Promise.all(names.map(functionName => client.readContract({ address, abi: artifacts.RareRushToken.abi, functionName })));
  const result = Object.fromEntries(names.map((name, index) => [name, values[index]]));
  if (!same(result.owner, config.owner) || !same(result.rewardMinter, state.deployments.game.address)) throw new Error('The reward token owner or authorized minter does not match this game.');
  if (result.CAP !== REWARD_CAP || Number(result.decimals) !== 6) throw new Error('The reward token cap or decimals do not match the reviewed economics.');
  if (result.launchAllocation !== LAUNCH_ALLOCATION || result.rewardAllocation !== GAMEPLAY_ALLOCATION) throw new Error('The reward token allocation does not match the approved 10% / 90% test split.');
}
async function checkRpc() {
  if (await client.getChainId() !== 46630) throw new Error('The public RPC returned the wrong chain. Deployment stopped.');
}
async function requireWallet() {
  if (!window.ethereum) throw new Error('Open this page in a browser with an injected Ethereum wallet.');
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  const chainId = await window.ethereum.request({ method: 'eth_chainId' });
  account = accounts[0]; walletChain = Number(chainId);
  if (!same(account, OWNER)) throw new Error('Select the required deployer wallet before continuing.');
  if (walletChain !== 46630) throw new Error('Switch the wallet to Robinhood Chain testnet (46630).');
  await checkRpc();
  walletClient = createWalletClient({ account, chain, transport: custom(window.ethereum) });
}
async function refreshWallet() {
  await checkRpc();
  $('balance').textContent = `${formatEther(await client.getBalance({ address: config.owner }))} test ETH`;
  if (window.ethereum && account) {
    account = (await window.ethereum.request({ method: 'eth_accounts' }))[0];
    walletChain = Number(await window.ethereum.request({ method: 'eth_chainId' }));
  }
  $('account').textContent = account ?? 'Not connected';
  $('switch').hidden = !account || walletChain === 46630;
  if (account && !same(account, OWNER)) message('wallet-status', 'Wrong account. Select the required deployer wallet in your wallet extension.', true);
  else if (account && walletChain !== 46630) message('wallet-status', 'Your wallet is on another network. Switch to Robinhood Chain testnet to deploy.', true);
  else if (account) message('wallet-status', 'Correct wallet and network. Every deployment still needs your approval.');
  render();
}
async function verifyReceipt(step, hash, wait = false) {
  await checkRpc();
  const receipt = wait
    ? await client.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 60_000, pollingInterval: 2_000,
      onReplaced: ({ transaction }) => { state.deployments[step.id].hash = transaction.hash; persist(); render(); } })
    : await client.getTransactionReceipt({ hash });
  const block = await client.getBlockNumber({ cacheTime: 0 });
  if (block < receipt.blockNumber + 1n) throw new Error('Waiting for two block confirmations. Resume verification once another block is mined.');
  const transaction = await client.getTransaction({ hash: receipt.transactionHash });
  const correctDestination = step.id === 'bind' ? same(transaction.to, destinationFor(step)) : transaction.to === null;
  if (!same(transaction.hash, receipt.transactionHash) || !same(transaction.from, config.owner) || !correctDestination ||
      transaction.chainId !== 46630 || transaction.nonce !== state.deployments[step.id].nonce ||
      transaction.value !== 0n || transaction.input.toLowerCase() !== deploymentData(step).toLowerCase()) {
    throw new Error('This transaction does not match the required sender, destination, nonce, value and operation data. Progress remains blocked for review.');
  }
  if (receipt.status !== 'success') {
    state.deployments[step.id] = { status: 'failed', nonce: transaction.nonce, hash: receipt.transactionHash, error: 'The matching transaction reverted. This operation can be retried.' };
    persist(); verified.delete(step.id); return;
  }
  const address = step.id === 'bind' ? destinationFor(step) : receipt.contractAddress;
  if (!address || !isAddress(address) || (step.id === 'bind' && receipt.contractAddress !== null)) throw new Error('The receipt does not identify the expected operation.');
  const code = await client.getCode({ address });
  if (!code || code === '0x') throw new Error('No contract code was found at the expected address.');
  if (step.id === 'game') await validateGame(address);
  if (step.id === 'rewardToken') await validateToken(address);
  if (step.id === 'bind') { await validateGame(address, true); await validateToken(state.deployments.rewardToken.address); }
  const record = { status: 'confirmed', nonce: transaction.nonce, address, hash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), confirmations: 2,
    operation: step.id === 'bind' ? 'bindRewardToken' : 'deploy', to: destinationFor(step) ?? null,
    dataHash: keccak256(deploymentData(step)), constructorArgs: step.id === 'bind' ? undefined : argumentsFor(step.id),
    arguments: step.id === 'bind' ? argumentsFor(step.id) : undefined,
    sourceName: artifacts[step.artifact].sourceName, contractName: step.artifact, compiler: artifacts[step.artifact].compiler,
    bytecodeHash: keccak256(artifacts[step.artifact].bytecode) };
  state.deployments[step.id] = record; persist(); verified.add(step.id);
}
async function verifyProgress() {
  verified.clear();
  reusedEvidence = await verifyReusedAssets(client, artifacts);
  for (const step of steps) {
    const record = state.deployments[step.id];
    if (!record || record.status !== 'confirmed') break;
    await verifyReceipt(step, record.hash);
    if (!verified.has(step.id)) break;
  }
}
async function locked(action) {
  if (busy) return;
  const execute = async () => {
    busy = true; render();
    try { state = loadState(); await action(); }
    catch (error) { message('wallet-status', readable(error), true); }
    finally { busy = false; render(); }
  };
  if (!navigator.locks) { message('wallet-status', 'This browser does not support safe cross-tab deployment locking. Use a current Chrome, Edge, or Firefox browser.', true); return; }
  await navigator.locks.request(key, { ifAvailable: true }, lock => {
    if (!lock) { message('wallet-status', 'Another console tab is handling a deployment. Continue there.', true); return; }
    return execute();
  });
}
async function deploy(step) {
  await locked(async () => {
    await requireWallet(); await verifyProgress();
    const previous = state.deployments[step.id];
    if (previous && previous.status !== 'failed') throw new Error('This deployment already exists or is pending. Use receipt verification instead.');
    const index = steps.indexOf(step);
    if (!steps.slice(0, index).every(value => verified.has(value.id))) throw new Error('Verify the preceding deployments first.');
    const data = deploymentData(step);
    const [gas, gasPrice, balance, latestNonce, nonce] = await Promise.all([
      client.estimateGas({ account: config.owner, data, to: destinationFor(step) }), client.getGasPrice(), client.getBalance({ address: config.owner }),
      client.getTransactionCount({ address: config.owner, blockTag: 'latest' }),
      client.getTransactionCount({ address: config.owner, blockTag: 'pending' }),
    ]);
    if (latestNonce !== nonce) throw new Error('This wallet already has a pending transaction. Confirm it before starting the next V2 operation.');
    const estimate = gas * gasPrice;
    estimates.set(step.id, `Estimated network cost: ${formatEther(estimate)} test ETH. Your wallet shows the final fee.`);
    if (balance < estimate) throw new Error('Not enough test ETH for the estimated deployment fee. Use the official faucet.');
    // Persist before opening the wallet. If the tab closes before a hash returns,
    // the next visit requires a receipt hash; it never silently sends again.
    await requireWallet(); // Pre-send account/network failures have no ambiguous transaction to recover.
    state.deployments[step.id] = { status: 'awaiting-wallet', nonce, dataHash: keccak256(data), startedAt: new Date().toISOString() };
    persist(); render();
    let hash;
    try {
      hash = await walletClient.sendTransaction({ account: config.owner, chain, data, nonce, to: destinationFor(step), value: 0n });
    } catch (error) {
      if (rejected(error)) { delete state.deployments[step.id]; persist(); }
      else {
        state.deployments[step.id].error = 'The wallet did not return a transaction hash. Check wallet activity. If it was sent, paste its hash below; do not redeploy.';
        persist();
      }
      throw error;
    }
    state.deployments[step.id] = { ...state.deployments[step.id], status: 'pending', hash }; persist(); render();
    try { await verifyReceipt(step, hash, true); }
    catch (error) { state.deployments[step.id].error = `Receipt not verified yet. Use Resume verification. ${readable(error)}`; persist(); throw error; }
    await refreshWallet();
  });
}
async function resume(step, manualHash) {
  await locked(async () => {
    await verifyProgress();
    const hash = manualHash ?? state.deployments[step.id]?.hash;
    if (!validHash(hash)) throw new Error('Paste the complete 0x transaction hash from your wallet activity.');
    if (!steps.slice(0, steps.indexOf(step)).every(value => verified.has(value.id))) throw new Error('Verify preceding deployments first.');
    state.deployments[step.id] = { ...state.deployments[step.id], status: 'pending', hash }; persist(); render();
    await verifyReceipt(step, hash, true);
    message('wallet-status', state.deployments[step.id].status === 'confirmed' ? 'Deployment verified against the fixed testnet RPC.' : state.deployments[step.id].error);
    await refreshWallet();
  });
}
function render() {
  if (!state) return;
  $('connect').disabled = !ready || busy;
  $('refresh').disabled = !ready || busy;
  $('switch').disabled = busy;
  const container = $('steps'); container.replaceChildren();
  for (const [index, step] of steps.entries()) {
    const record = state.deployments[step.id];
    const node = document.createElement('article'); node.className = 'step';
    const heading = document.createElement('h3'); heading.textContent = `${index + 1}. ${step.title}`; node.append(heading);
    const description = document.createElement('p'); description.textContent = step.description; node.append(description);
    const status = document.createElement('p'); status.className = 'step-status';
    if (record?.status === 'confirmed') {
      status.textContent = `${verified.has(step.id) ? 'VERIFIED' : 'RECHECKING'} · ${record.address}`;
      status.classList.add('success');
    } else if (record?.status === 'pending') status.textContent = `PENDING · ${record.hash}\n${record.error ?? 'Waiting for the testnet receipt.'}`;
    else if (record?.status === 'awaiting-wallet') status.textContent = record.error ?? 'Awaiting wallet response. If the tab was closed, check your wallet activity before doing anything else.';
    else if (record?.status === 'failed') { status.textContent = record.error; status.classList.add('error'); }
    else status.textContent = step.id === 'bind' ? 'NOT BOUND' : 'NOT DEPLOYED';
    node.append(status);
    if (record?.hash) { const link = document.createElement('a'); link.href = `${EXPLORER}/tx/${record.hash}`; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = 'View transaction ↗'; node.append(link); }
    if (estimates.has(step.id)) { const estimate = document.createElement('p'); estimate.className = 'estimate'; estimate.textContent = estimates.get(step.id); node.append(estimate); }
    const controls = document.createElement('div'); controls.className = 'actions';
    if (!record || record.status === 'failed') {
      const button = document.createElement('button'); button.textContent = step.id === 'bind' ? 'BIND REWARD TOKEN ↗' : `DEPLOY ${step.title.toUpperCase()} ↗`;
      button.disabled = !ready || busy || !same(account, OWNER) || walletChain !== 46630 || !steps.slice(0, index).every(value => verified.has(value.id));
      button.addEventListener('click', () => void deploy(step)); controls.append(button);
    } else if (record.status === 'pending') {
      const button = document.createElement('button'); button.textContent = 'RESUME VERIFICATION'; button.disabled = busy;
      button.addEventListener('click', () => void resume(step)); controls.append(button);
    } else if (record.status === 'awaiting-wallet') {
      controls.className = 'recover';
      const label = document.createElement('label'); label.htmlFor = `hash-${step.id}`; label.textContent = 'Already approved? Paste the transaction hash from wallet activity to recover safely.';
      const input = document.createElement('input'); input.disabled = busy; input.id = label.htmlFor; input.placeholder = '0x… transaction hash'; input.autocomplete = 'off'; input.spellcheck = false;
      const button = document.createElement('button'); button.textContent = 'VERIFY HASH'; button.disabled = busy;
      button.addEventListener('click', () => void resume(step, input.value.trim())); controls.append(label, input, button);
    }
    node.append(controls); container.append(node);
  }
  const complete = steps.every(step => verified.has(step.id));
  $('download').disabled = !complete || busy;
  if (complete) message('summary', `All three V2 operations verified. tRARERUSH: ${state.deployments.rewardToken.address}. Download and save your manifest. No Doppler pool is deployed.`);
}
function downloadManifest() {
  if (!steps.every(step => verified.has(step.id))) return;
  const manifest = { formatVersion: 3, deploymentVersion: DEPLOYMENT_VERSION, reusedAssets: config.reusedAssets, reusedAssetVerification: reusedEvidence, network: 'robinhood-testnet', chainId: 46630, rpcUrl: RPC, explorerUrl: EXPLORER,
    owner: config.owner, verifier: config.verifier, treasury: config.treasury, engineVersion: config.engineVersion,
    economics, launchRecipient: config.launchRecipient, launchAllocation: config.launchAllocation, artifactFingerprint: fingerprint,
    rf: config.reusedAssets.rf, genesis: config.reusedAssets.genesis,
    generations: config.reusedAssets.generations, game: state.deployments.game.address, token: state.deployments.rewardToken.address, rewardToken: state.deployments.rewardToken.address,
    deployedAt: new Date().toISOString(), deploymentMethod: 'browser-wallet-console', deployments: state.deployments,
    sourceInput: 'rare-rush-v2-standard-input.json', note: 'Test assets only. Not real Rare Friends ownership or a live market.' };
  const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'rare-rush-robinhood-testnet-v2.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
async function initialize() {
  const names = ARTIFACT_NAMES;
  const readJson = async path => { const response = await fetch(path); if (!response.ok) throw new Error(`Could not load ${path}. Restart the local console after compiling.`); return response.json(); };
  [config, artifacts] = await Promise.all([readJson('/config.json'), Promise.all(names.map(async name => [name, await readJson(`/artifacts/${name}.json`)])).then(Object.fromEntries)]);
  config = publicConfig(config);
  for (const name of names) if (!Array.isArray(artifacts[name].abi) || !/^0x[0-9a-f]+$/i.test(artifacts[name].bytecode)) throw new Error(`Invalid ${name} artifact. Recompile before deployment.`);
  $('owner').textContent = config.owner; $('treasury').textContent = config.treasury; $('verifier').textContent = config.verifier; $('engine').textContent = config.engineVersion; $('reserve').textContent = config.launchRecipient;
  for (const [id, asset] of Object.entries(REUSED_ASSETS)) {
    const term = document.createElement('dt'); term.textContent = id === 'rf' ? 'Test RF · tRF' : `Test ${id}`;
    const value = document.createElement('dd'); value.textContent = asset.address; $('reused-assets').append(term, value);
  }
  fingerprint = artifactFingerprint(config, artifacts);
  key = `rare-rush-${DEPLOYMENT_VERSION}-deploy:${config.owner.toLowerCase()}`;
  if (!navigator.locks) throw new Error('This browser does not support safe cross-tab deployment locking. Use a current browser.');
  busy = true;
  message('wallet-status', 'Waiting for the shared deployment lock, then checking saved progress…');
  try {
    await navigator.locks.request(key, async () => {
      state = loadState(); persist();
      await verifyProgress(); ready = true; render(); await refreshWallet();
    });
  } finally { busy = false; render(); }
  message('wallet-status', window.ethereum ? 'Connect when ready. No wallet request opens until you click.' : 'Install or enable a browser wallet, then reload this local page.');
  if (window.ethereum?.on) {
    window.ethereum.on('accountsChanged', accounts => { account = accounts[0]; void refreshWallet().catch(error => message('wallet-status', readable(error), true)); });
    window.ethereum.on('chainChanged', value => { walletChain = Number(value); void refreshWallet().catch(error => message('wallet-status', readable(error), true)); });
    window.ethereum.on('disconnect', () => { account = undefined; walletChain = undefined; $('account').textContent = 'Not connected'; render(); });
  }
  window.addEventListener('storage', event => { if (event.key === key && !busy) void locked(async () => { await verifyProgress(); render(); }); });
}
$('connect').addEventListener('click', () => void locked(async () => {
  if (!window.ethereum) throw new Error('No browser wallet found. Enable your wallet extension and reload.');
  account = (await window.ethereum.request({ method: 'eth_requestAccounts' }))[0];
  await refreshWallet();
}));
$('switch').addEventListener('click', () => void locked(async () => {
  try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xb626' }] }); }
  catch (error) {
    if (error.code !== 4902) throw error;
    await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0xb626', chainName: chain.name,
      nativeCurrency: chain.nativeCurrency, rpcUrls: [RPC], blockExplorerUrls: [EXPLORER] }] });
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xb626' }] });
  }
  await refreshWallet();
}));
$('refresh').addEventListener('click', () => void locked(async () => { await verifyProgress(); await refreshWallet(); }));
$('download').addEventListener('click', downloadManifest);
void initialize().catch(error => { ready = false; message('wallet-status', readable(error), true); render(); });
