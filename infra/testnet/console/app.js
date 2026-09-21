import {
  createPublicClient, createWalletClient, custom, defineChain, encodeDeployData,
  formatEther, http, isAddress, keccak256, stringToHex,
} from 'viem';

const RPC = 'https://rpc.testnet.chain.robinhood.com';
const EXPLORER = 'https://explorer.testnet.chain.robinhood.com';
const OWNER = '0x6fd155b9d52f80e8a73a8a2537268602978486e2';
const chain = defineChain({ id: 46630, name: 'Robinhood Chain Testnet', testnet: true,
  nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } }, blockExplorers: { default: { name: 'Explorer', url: EXPLORER } } });
const client = createPublicClient({ chain, transport: http(RPC, { retryCount: 1, timeout: 15_000 }) });
const steps = [
  { id: 'rf', artifact: 'TestRF', title: 'Test RF', description: 'Free faucet: 1,100 tRF per wallet per UTC day for test entry fees.' },
  { id: 'genesis', artifact: 'TestFriends', title: 'Test Genesis', description: 'Test NFTs for free entry and the 100× reward multiplier.' },
  { id: 'generations', artifact: 'TestFriends', title: 'Test Generations', description: '110 tRF per run: 100 into the prize pool + 10 sent to the treasury.' },
  { id: 'game', artifact: 'RareRushGame', title: 'Rare Rush Game + Token', description: 'Verified claims with a 1,024,000,000 tRARERUSH cap. Genesis enters free with 100× rewards; three starts per NFT daily.' },
];
const $ = id => document.getElementById(id);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const validHash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
let config, artifacts, key, fingerprint, state, account, walletChain, busy = false, ready = false;
const verified = new Set();
const estimates = new Map();
let walletClient;

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
  const stored = localStorage.getItem(key);
  if (!stored) return { fingerprint, deployments: {} };
  const parsed = JSON.parse(stored);
  if (!parsed.deployments || typeof parsed.deployments !== 'object') throw new Error('Saved deployment progress is invalid. Do not redeploy until the existing transactions are checked.');
  if (parsed.fingerprint !== fingerprint) {
    // An untouched page is safe to refresh after an economics/configuration change.
    // Any actual or ambiguous deployment must remain visible for reconciliation.
    if (Object.keys(parsed.deployments).length === 0) return { fingerprint, deployments: {} };
    throw new Error('The compiled contracts or treasury changed. Existing deployment progress was preserved. Reconcile previous transactions before starting a new deployment.');
  }
  for (const [id, value] of Object.entries(parsed.deployments)) {
    if (!steps.some(step => step.id === id) || !value || !['awaiting-wallet', 'pending', 'confirmed', 'failed'].includes(value.status) ||
      (value.hash && !validHash(value.hash)) || (value.address && !isAddress(value.address))) {
      throw new Error('Saved deployment progress is invalid. Existing transactions must be checked before continuing.');
    }
  }
  return parsed;
}
function persist() { localStorage.setItem(key, JSON.stringify(state)); }
function argumentsFor(id) {
  if (id === 'rf') return [];
  if (id === 'genesis') return [true];
  if (id === 'generations') return [false];
  return [config.owner, config.verifier, config.treasury, state.deployments.rf.address, state.deployments.genesis.address,
    state.deployments.generations.address, config.engineVersion];
}
function deploymentData(step) {
  const artifact = artifacts[step.artifact];
  return encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: argumentsFor(step.id) });
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
    ? await client.waitForTransactionReceipt({ hash, timeout: 60_000, pollingInterval: 2_000,
      onReplaced: ({ transaction }) => { state.deployments[step.id].hash = transaction.hash; persist(); render(); } })
    : await client.getTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    state.deployments[step.id] = { status: 'failed', hash: receipt.transactionHash, error: 'Transaction reverted. No contract was deployed; you can retry.' };
    persist(); verified.delete(step.id); return;
  }
  const transaction = await client.getTransaction({ hash: receipt.transactionHash });
  if (!same(transaction.from, config.owner) || transaction.to !== null || transaction.input.toLowerCase() !== deploymentData(step).toLowerCase()) {
    throw new Error('This transaction does not match the required deployer, compiled contract and constructor arguments. Progress remains blocked for review.');
  }
  const address = receipt.contractAddress;
  if (!address || !isAddress(address) || !same(transaction.from, config.owner)) throw new Error('The receipt does not identify the expected contract creation.');
  const code = await client.getCode({ address });
  if (!code || code === '0x') throw new Error('No contract code was found at the receipt address.');
  const record = { status: 'confirmed', address, hash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(),
    constructorArgs: argumentsFor(step.id), sourceName: artifacts[step.artifact].sourceName,
    contractName: step.artifact, compiler: artifacts[step.artifact].compiler,
    bytecodeHash: keccak256(artifacts[step.artifact].bytecode) };
  if (step.id === 'game') {
    const read = functionName => client.readContract({ address, abi: artifacts.RareRushGame.abi, functionName });
    const [actualOwner, actualVerifier, actualTreasury, actualEngine, token, rf, genesis, generations, entry, poolShare, treasuryShare] = await Promise.all(
      ['owner', 'verifier', 'treasury', 'engineVersion', 'token', 'rf', 'genesis', 'generations', 'ENTRY_FEE', 'PRIZE_POOL_SHARE', 'TREASURY_SHARE'].map(read));
    if (!same(actualOwner, config.owner) || !same(actualVerifier, config.verifier) || !same(actualTreasury, config.treasury) || !same(actualEngine, config.engineVersion) ||
        !same(rf, state.deployments.rf.address) || !same(genesis, state.deployments.genesis.address) || !same(generations, state.deployments.generations.address)) {
      throw new Error('The deployed game configuration does not match this console.');
    }
    if (entry !== 110n * 10n ** 18n || poolShare !== 100n * 10n ** 18n || treasuryShare !== 10n * 10n ** 18n) {
      throw new Error('The deployed entry fee or treasury split does not match the reviewed economics.');
    }
    if (!isAddress(token) || !(await client.getCode({ address: token })) || await client.getCode({ address: token }) === '0x') {
      throw new Error('The game reward token has no deployed code.');
    }
    const tokenGame = await client.readContract({ address: token, abi: artifacts.RareRushToken.abi, functionName: 'game' });
    if (!same(tokenGame, address)) throw new Error('The reward token does not belong to this game.');
    const cap = await client.readContract({ address: token, abi: artifacts.RareRushToken.abi, functionName: 'CAP' });
    if (cap !== 1_024_000_000n * 1_000_000n) throw new Error('The reward token cap does not match the reviewed economics.');
    record.token = token;
  }
  state.deployments[step.id] = record; persist(); verified.add(step.id);
}
async function verifyProgress() {
  verified.clear();
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
    const [gas, gasPrice, balance] = await Promise.all([
      client.estimateGas({ account: config.owner, data }), client.getGasPrice(), client.getBalance({ address: config.owner }),
    ]);
    const estimate = gas * gasPrice;
    estimates.set(step.id, `Estimated network cost: ${formatEther(estimate)} test ETH. Your wallet shows the final fee.`);
    if (balance < estimate) throw new Error('Not enough test ETH for the estimated deployment fee. Use the official faucet.');
    // Persist before opening the wallet. If the tab closes before a hash returns,
    // the next visit requires a receipt hash; it never silently sends again.
    state.deployments[step.id] = { status: 'awaiting-wallet', startedAt: new Date().toISOString() };
    persist(); render();
    let hash;
    try {
      await requireWallet();
      hash = await walletClient.sendTransaction({ account: config.owner, chain, data });
    } catch (error) {
      if (rejected(error)) { delete state.deployments[step.id]; persist(); }
      else {
        state.deployments[step.id].error = 'The wallet did not return a transaction hash. Check wallet activity. If it was sent, paste its hash below; do not redeploy.';
        persist();
      }
      throw error;
    }
    state.deployments[step.id] = { status: 'pending', hash }; persist(); render();
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
    else status.textContent = 'NOT DEPLOYED';
    node.append(status);
    if (record?.hash) { const link = document.createElement('a'); link.href = `${EXPLORER}/tx/${record.hash}`; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = 'View transaction ↗'; node.append(link); }
    if (estimates.has(step.id)) { const estimate = document.createElement('p'); estimate.className = 'estimate'; estimate.textContent = estimates.get(step.id); node.append(estimate); }
    const controls = document.createElement('div'); controls.className = 'actions';
    if (!record || record.status === 'failed') {
      const button = document.createElement('button'); button.textContent = `DEPLOY ${step.title.toUpperCase()} ↗`;
      button.disabled = !ready || busy || !same(account, OWNER) || walletChain !== 46630 || !steps.slice(0, index).every(value => verified.has(value.id));
      button.addEventListener('click', () => void deploy(step)); controls.append(button);
    } else if (record.status === 'pending') {
      const button = document.createElement('button'); button.textContent = 'RESUME VERIFICATION'; button.disabled = busy;
      button.addEventListener('click', () => void resume(step)); controls.append(button);
    } else if (record.status === 'awaiting-wallet') {
      controls.className = 'recover';
      const label = document.createElement('label'); label.htmlFor = `hash-${step.id}`; label.textContent = 'Already approved? Paste the transaction hash from wallet activity to recover safely.';
      const input = document.createElement('input'); input.id = label.htmlFor; input.placeholder = '0x… transaction hash'; input.autocomplete = 'off'; input.spellcheck = false;
      const button = document.createElement('button'); button.textContent = 'VERIFY HASH'; button.disabled = busy;
      button.addEventListener('click', () => void resume(step, input.value.trim())); controls.append(label, input, button);
    }
    node.append(controls); container.append(node);
  }
  const complete = steps.every(step => verified.has(step.id));
  $('download').disabled = !complete || busy;
  if (complete) message('summary', `All contracts verified. tRARERUSH: ${state.deployments.game.token}. Download and save your manifest.`);
}
function downloadManifest() {
  if (!steps.every(step => verified.has(step.id))) return;
  const manifest = { formatVersion: 1, network: 'robinhood-testnet', chainId: 46630, rpcUrl: RPC, explorerUrl: EXPLORER,
    owner: config.owner, verifier: config.verifier, treasury: config.treasury, engineVersion: config.engineVersion,
    economics: { rewardCap: '1024000000', generationsEntry: '110', prizePoolShare: '100', treasuryShare: '10', rfDecimals: 18, rewardDecimals: 6 },
    rf: state.deployments.rf.address, genesis: state.deployments.genesis.address,
    generations: state.deployments.generations.address, game: state.deployments.game.address, token: state.deployments.game.token,
    deployedAt: new Date().toISOString(), deploymentMethod: 'browser-wallet-console', deployments: state.deployments,
    sourceInput: 'rare-rush-standard-input.json', note: 'Test assets only. Not real Rare Friends ownership or a live market.' };
  const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'rare-rush-robinhood-testnet.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
async function initialize() {
  const names = ['TestRF', 'TestFriends', 'RareRushGame', 'RareRushToken'];
  const readJson = async path => { const response = await fetch(path); if (!response.ok) throw new Error(`Could not load ${path}. Restart the local console after compiling.`); return response.json(); };
  [config, artifacts] = await Promise.all([readJson('/config.json'), Promise.all(names.map(async name => [name, await readJson(`/artifacts/${name}.json`)])).then(Object.fromEntries)]);
  if (config.chainId !== 46630 || !same(config.owner, OWNER) || !isAddress(config.verifier) || !isAddress(config.treasury) || /^0x0{40}$/i.test(config.treasury) || !validHash(config.engineVersion)) throw new Error('Invalid public deployment configuration.');
  for (const name of names) if (!Array.isArray(artifacts[name].abi) || !/^0x[0-9a-f]+$/i.test(artifacts[name].bytecode)) throw new Error(`Invalid ${name} artifact. Recompile before deployment.`);
  $('owner').textContent = config.owner; $('treasury').textContent = config.treasury; $('verifier').textContent = config.verifier; $('engine').textContent = config.engineVersion;
  fingerprint = keccak256(stringToHex(JSON.stringify([config.treasury.toLowerCase(), names.map(name => [name, artifacts[name].bytecode])])));
  key = `rare-rush-testnet-deploy:${config.owner.toLowerCase()}:${config.verifier.toLowerCase()}:${config.engineVersion.toLowerCase()}`;
  state = loadState(); persist();
  await verifyProgress(); ready = true; render(); await refreshWallet();
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
