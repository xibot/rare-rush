import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import solc from 'solc';
import {
  createPublicClient, http, getAddress, isAddress, zeroAddress, keccak256, stringToHex,
  encodeDeployData, encodeFunctionData, getContractAddress, decodeErrorResult, parseEventLogs,
} from 'viem';
import { robinhoodTestnet } from '../src/chain.mjs';
import { artifact } from '../src/artifacts.mjs';
import { currentEngineVersion } from '../src/engine-version.ts';
import {
  ARTIFACT_NAMES, CHAIN_ID, REWARD_CAP, LAUNCH_ALLOCATION, GAMEPLAY_ALLOCATION,
  artifactFingerprint, constructorArgs, economics, publicConfig, validHash, same, json,
  CONFIG_FILE, DEPLOYMENT_VERSION, OPERATIONS, REUSED_ASSETS, verifyReusedAssets,
} from '../src/deployment-config.mjs';

// No wallet, signing key, env loader, user-provided RPC, or transaction-send method is used.
// Fresh V2 game/token state is checked before gameplay or reserve transfers. Reused
// V1 assets are verified by identity only; existing balances and mints are permitted.
const root = new URL('../', import.meta.url);
const evidencePath = new URL('artifacts/public-deployment-v2-verification.json', root);
const operations = OPERATIONS;
const names = { rf: 'TestRF', genesis: 'TestFriends', generations: 'TestFriends', game: 'RareRushGame', rewardToken: 'RareRushToken', bind: 'RareRushGame' };
const check = (condition, message) => { if (!condition) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const address = value => typeof value === 'string' && isAddress(value) && !same(value, zeroAddress);
const normalize = value => {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value)) return value.toLowerCase();
  if (Array.isArray(value)) return value.map(normalize);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  return value;
};
function equal(actual, expected, label) {
  try { assert.deepStrictEqual(normalize(actual), normalize(expected)); }
  catch { throw new Error(`${label} does not match the trusted deployment.`); }
}
async function readJson(path, maximumBytes) {
  const contents = await readFile(path, 'utf8');
  check(Buffer.byteLength(contents) <= maximumBytes, 'Input file is too large.');
  return { contents, value: JSON.parse(contents) };
}
function maskImmutables(code, references) {
  check(typeof code === 'string' && /^0x(?:[0-9a-f]{2})+$/i.test(code), 'Invalid runtime bytecode.');
  const bytes = Buffer.from(code.slice(2), 'hex');
  for (const entries of Object.values(references)) {
    for (const { start, length } of entries) {
      check(Number.isInteger(start) && Number.isInteger(length) && length > 0 && start >= 0 && start + length <= bytes.length, 'Invalid compiler immutable reference.');
      bytes.fill(0, start, start + length);
    }
  }
  return `0x${bytes.toString('hex')}`;
}

try {
  // A failed recheck must not leave old success evidence looking current.
  await rm(evidencePath, { force: true });
  const args = process.argv.slice(2);
  check(args.length >= 1 && args.length <= 2 && !args.some(item => item.startsWith('--')), 'Usage: node scripts/verify-deployment.mjs MANIFEST.json [STANDARD-INPUT.json]');
  const { value: manifest, contents: manifestText } = await readJson(args[0], 128_000);
  check(object(manifest) && manifest.formatVersion === 3 && manifest.deploymentVersion === DEPLOYMENT_VERSION && manifest.network === 'robinhood-testnet' && manifest.chainId === CHAIN_ID, 'Manifest must identify Robinhood testnet V2 format 3.');
  equal(manifest.rpcUrl, robinhoodTestnet.rpcUrls.default.http[0], 'Manifest RPC');
  equal(manifest.explorerUrl, robinhoodTestnet.blockExplorers.default.url, 'Manifest explorer');
  equal(manifest.deploymentMethod, 'browser-wallet-console', 'Deployment method');
  check(object(manifest.deployments), 'Manifest deployments are missing.');
  equal(Object.keys(manifest.deployments).sort(), [...operations].sort(), 'Deployment operations');
  equal(manifest.economics, economics, 'Economics');

  const { value: configRaw } = await readJson(new URL(CONFIG_FILE, root), 16_000);
  const config = publicConfig(configRaw);
  equal(publicConfig(manifest), config, 'Manifest operator config');
  equal(await currentEngineVersion(), config.engineVersion, 'Current engine version');
  const artifacts = Object.fromEntries(await Promise.all(ARTIFACT_NAMES.map(async name => [name, await artifact(name)])));
  equal(manifest.artifactFingerprint, artifactFingerprint(config, artifacts), 'Artifact fingerprint');

  const { contents: trustedInputText, value: trustedInput } = await readJson(new URL('artifacts/standard-input.json', root), 4_000_000);
  if (args[1]) {
    const { contents: submitted } = await readJson(args[1], 4_000_000);
    equal(submitted, trustedInputText, 'Submitted standard compiler input');
  }
  check(trustedInput.language === 'Solidity' && object(trustedInput.sources), 'Trusted compiler input is invalid.');
  // Pin the source contents too, so stale local artifacts cannot authorize an obsolete build.
  for (const [sourceName, source] of Object.entries(trustedInput.sources)) {
    let sourceUrl;
    if (sourceName.startsWith('contracts/') || sourceName === 'test/fixtures/BindingCandidate.sol') sourceUrl = new URL(sourceName, root);
    else if (sourceName === 'doppler/contracts/RareRushDopplerPrototype.sol') sourceUrl = new URL('../doppler/contracts/RareRushDopplerPrototype.sol', root);
    else if (sourceName.startsWith('@openzeppelin/contracts/') && !sourceName.includes('..')) sourceUrl = new URL(`node_modules/${sourceName}`, root);
    else throw new Error('Compiler input contains an unexpected source.');
    equal(source.content, await readFile(sourceUrl, 'utf8'), `Local source ${sourceName}`);
  }
  // Add only output metadata. Solidity output selection does not alter creation/runtime code.
  const compilationInput = structuredClone(trustedInput);
  compilationInput.settings.outputSelection['*']['*'].push('evm.deployedBytecode.immutableReferences');
  const compiled = JSON.parse(solc.compile(JSON.stringify(compilationInput)));
  check(!compiled.errors?.some(error => error.severity === 'error'), 'Trusted compiler input did not compile.');
  for (const [name, item] of Object.entries(artifacts)) {
    const rebuilt = compiled.contracts?.[item.sourceName]?.[name];
    check(rebuilt, 'Compiled contract is missing.');
    equal(solc.version(), item.compiler, `${name} compiler version`);
    equal(`0x${rebuilt.evm.bytecode.object}`, item.bytecode, `${name} creation bytecode`);
    equal(`0x${rebuilt.evm.deployedBytecode.object}`, item.deployedBytecode, `${name} runtime bytecode`);
    equal(rebuilt.abi, item.abi, `${name} ABI`);
  }

  const contracts = { ...config.reusedAssets };
  for (const [id, asset] of Object.entries(REUSED_ASSETS)) equal(manifest[id], asset.address, `${id} reused asset address`);
  const expectedData = {};
  const transactionHashes = new Set();
  for (const id of operations) {
    const item = manifest.deployments[id];
    const contractArtifact = artifacts[names[id]];
    check(object(item) && item.status === 'confirmed' && address(item.address) && validHash(item.hash) && validHash(item.dataHash), `Invalid ${id} deployment record.`);
    check(typeof item.blockNumber === 'string' && /^[1-9][0-9]*$/.test(item.blockNumber) && Number.isSafeInteger(item.confirmations) && item.confirmations >= 2 && Number.isSafeInteger(item.nonce) && item.nonce >= 0, `Invalid ${id} receipt metadata.`);
    check(!transactionHashes.has(item.hash.toLowerCase()), 'Duplicate deployment transaction hash.');
    transactionHashes.add(item.hash.toLowerCase());
    const expectedArgs = constructorArgs(id, config, manifest.deployments);
    if (id === 'bind') {
      equal(item.operation, 'bindRewardToken', 'Bind operation');
      equal(item.address, manifest.game, 'Bind contract');
      equal(item.to, manifest.game, 'Bind destination');
      equal(item.arguments, expectedArgs, 'Bind arguments');
      expectedData[id] = encodeFunctionData({ abi: contractArtifact.abi, functionName: 'bindRewardToken', args: expectedArgs });
    } else {
      equal(item.operation, 'deploy', `${id} operation`);
      equal(item.to, null, `${id} creation destination`);
      equal(item.address, manifest[id], `${id} top-level address`);
      equal(item.constructorArgs, expectedArgs, `${id} constructor arguments`);
      expectedData[id] = encodeDeployData({ abi: contractArtifact.abi, bytecode: contractArtifact.bytecode, args: expectedArgs });
      contracts[id] = getAddress(item.address);
    }
    equal(item.sourceName, contractArtifact.sourceName, `${id} source name`);
    equal(item.contractName, contractArtifact.contractName, `${id} contract name`);
    equal(item.compiler, contractArtifact.compiler, `${id} compiler`);
    equal(item.bytecodeHash, keccak256(contractArtifact.bytecode), `${id} bytecode hash`);
    equal(item.dataHash, keccak256(expectedData[id]), `${id} transaction data hash`);
  }
  equal(manifest.token, manifest.rewardToken, 'Reward token alias');
  check(new Set(Object.values(contracts).map(item => item.toLowerCase())).size === 5, 'Contract addresses must be distinct.');

  const client = createPublicClient({ chain: robinhoodTestnet, transport: http(robinhoodTestnet.rpcUrls.default.http[0], { timeout: 30_000, retryCount: 2 }) });
  equal(await client.getChainId(), CHAIN_ID, 'RPC chain');
  const head = await client.getBlockNumber({ cacheTime: 0 });
  const blockNumber = head - 1n;
  const pinned = await client.getBlock({ blockNumber });
  const reusedAssetVerification = await verifyReusedAssets(client, artifacts, blockNumber);
  equal(manifest.reusedAssetVerification, reusedAssetVerification, 'Reused asset verification');
  const transactions = {};
  let lastNonce = -1;
  let lastBlock = -1n;
  for (const id of operations) {
    const item = manifest.deployments[id];
    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash: item.hash }), client.getTransactionReceipt({ hash: item.hash }),
    ]);
    equal(tx.hash, item.hash, `${id} transaction hash`);
    equal(tx.chainId, CHAIN_ID, `${id} transaction chain`);
    equal(tx.from, config.owner, `${id} sender`);
    equal(tx.to, id === 'bind' ? contracts.game : null, `${id} destination`);
    equal(tx.value, 0n, `${id} transaction value`);
    equal(tx.input, expectedData[id], `${id} transaction calldata`);
    equal(tx.nonce, item.nonce, `${id} fixed nonce`);
    check(tx.nonce > lastNonce, 'Deployment transaction nonces must increase.');
    lastNonce = tx.nonce;
    equal(receipt.status, 'success', `${id} receipt status`);
    equal(receipt.transactionHash, item.hash, `${id} receipt hash`);
    equal(receipt.from, config.owner, `${id} receipt sender`);
    equal(receipt.to, tx.to, `${id} receipt destination`);
    equal(receipt.blockNumber, BigInt(item.blockNumber), `${id} receipt block`);
    equal(receipt.blockNumber, tx.blockNumber, `${id} transaction block`);
    equal(receipt.blockHash, tx.blockHash, `${id} transaction block hash`);
    equal(receipt.transactionIndex, tx.transactionIndex, `${id} transaction index`);
    check(receipt.blockNumber >= lastBlock, 'Deployment blocks must be ordered.');
    lastBlock = receipt.blockNumber;
    const confirmations = blockNumber - receipt.blockNumber + 1n;
    check(confirmations >= 2n, `${id} does not have two confirmations at the pinned block.`);
    const canonical = await client.getBlock({ blockNumber: receipt.blockNumber });
    equal(canonical.hash, receipt.blockHash, `${id} canonical receipt block`);
    if (id === 'bind') {
      equal(receipt.contractAddress, null, 'Bind must not create a contract');
      const logs = parseEventLogs({ abi: artifacts.RareRushGame.abi, eventName: 'RewardTokenBound', logs: receipt.logs.filter(log => same(log.address, contracts.game)), strict: true });
      check(logs.length === 1, 'Expected one RewardTokenBound event.');
      equal(logs[0].args, { token: contracts.rewardToken, launchAllocation: LAUNCH_ALLOCATION, rewardAllocation: GAMEPLAY_ALLOCATION }, 'RewardTokenBound event');
    } else {
      equal(receipt.contractAddress, contracts[id], `${id} receipt contract address`);
      equal(getContractAddress({ from: config.owner, nonce: BigInt(tx.nonce) }), contracts[id], `${id} CREATE address`);
    }
    transactions[id] = { hash: item.hash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, confirmations, nonce: tx.nonce, dataHash: keccak256(tx.input), status: receipt.status };
  }

  const runtimes = {};
  for (const [id, contractAddress] of Object.entries(contracts)) {
    const item = artifacts[names[id]];
    const runtime = await client.getBytecode({ address: contractAddress, blockNumber });
    const references = compiled.contracts[item.sourceName][names[id]].evm.deployedBytecode.immutableReferences ?? {};
    equal(maskImmutables(runtime, references), maskImmutables(item.deployedBytecode, references), `${id} compiled runtime`);
    runtimes[id] = { address: contractAddress, runtimeCodeHash: keccak256(runtime), bytes: (runtime.length - 2) / 2, exactOutsideCompilerImmutableSlots: true, immutableSlots: Object.values(references).reduce((sum, entries) => sum + entries.length, 0) };
  }

  const checks = [];
  const add = (id, fn, expected, args = []) => checks.push({ id, fn, expected, args });
  add('rf', 'name', 'Rare Friends Testnet Faucet'); add('rf', 'symbol', 'tRF'); add('rf', 'decimals', 18);
  add('rf', 'FAUCET_AMOUNT', 1_100n * 10n ** 18n);
  add('genesis', 'name', 'Rare Rush Test Genesis'); add('genesis', 'symbol', 'tGENESIS'); add('genesis', 'isGenesis', true);
  add('generations', 'name', 'Rare Rush Test Generations'); add('generations', 'symbol', 'tGENERATIONS'); add('generations', 'isGenesis', false);
  for (const id of ['genesis', 'generations']) add(id, 'supportsInterface', true, ['0x80ac58cd']);
  for (const [fn, expected] of Object.entries({
    owner: config.owner, pendingOwner: zeroAddress, verifier: config.verifier, verifierEpoch: 1n,
    treasury: config.treasury, engineVersion: config.engineVersion, rf: contracts.rf,
    genesis: contracts.genesis, generations: contracts.generations, token: contracts.rewardToken,
    expectedLaunchAllocation: LAUNCH_ALLOCATION, REWARD_SUPPLY_CAP: REWARD_CAP,
    ENTRY_FEE: 110n * 10n ** 18n, PRIZE_POOL_SHARE: 100n * 10n ** 18n, TREASURY_SHARE: 10n * 10n ** 18n,
    INITIAL_COIN_REWARD: 10_000_000n, MIN_COIN_REWARD: 1_000_000n, HALVING_INTERVAL: 10_000n,
    MAX_DAILY_RUNS: 3n, MAX_PICKUPS: 512n, CLAIM_GRACE: 900n,
    paused: false, runCount: 0n, claimedPickups: 0n, prizePoolBalance: 0n,
  })) add('game', fn, expected);
  for (const [fn, expected] of Object.entries({
    name: 'Rare Rush Testnet', symbol: 'tRARERUSH', decimals: 6, owner: config.owner,
    rewardMinter: contracts.game, CAP: REWARD_CAP, launchAllocation: LAUNCH_ALLOCATION,
    rewardAllocation: GAMEPLAY_ALLOCATION, rewardsMinted: 0n, totalSupply: LAUNCH_ALLOCATION,
    isPoolLocked: false, pool: zeroAddress,
  })) add('rewardToken', fn, expected);
  add('rewardToken', 'balanceOf', LAUNCH_ALLOCATION, [config.launchRecipient]);
  for (const [difficulty, seconds] of [120n, 90n, 60n].entries()) {
    add('game', 'durationFor', seconds, [difficulty]);
    const regular = [7_500_000n, 10_000_000n, 20_000_000n][difficulty];
    for (const collection of [0, 1]) {
      const multiplier = collection === 1 ? 100n : 1n;
      add('game', 'quoteReward', regular * multiplier, ['0x00', collection, difficulty]);
      add('game', 'quoteReward', regular * 10n * multiplier, ['0x01', collection, difficulty]);
    }
  }
  const state = [];
  // Bound RPC concurrency; every eth_call shares the same snapshot block.
  for (let i = 0; i < checks.length; i += 6) {
    const batch = checks.slice(i, i + 6);
    const values = await Promise.all(batch.map(({ id, fn, args: callArgs }) => client.readContract({
      address: contracts[id], abi: artifacts[names[id]].abi, functionName: fn, args: callArgs, blockNumber,
    })));
    batch.forEach((entry, index) => {
      equal(values[index], entry.expected, `${entry.id}.${entry.fn}`);
      state.push({ contract: entry.id, function: entry.fn, args: entry.args, value: values[index] });
    });
  }
  const domain = await client.readContract({ address: contracts.game, abi: artifacts.RareRushGame.abi, functionName: 'eip712Domain', blockNumber });
  equal(domain, ['0x0f', 'RareRushTestnet', '1', BigInt(CHAIN_ID), contracts.game, `0x${'00'.repeat(32)}`, []], 'EIP-712 domain');
  state.push({ contract: 'game', function: 'eip712Domain', args: [], value: domain });

  async function requireCallRevert(id, functionName, callArgs, errorName) {
    let confirmedRevert = false;
    try {
      await client.call({ account: config.owner, to: contracts[id], data: encodeFunctionData({ abi: artifacts[names[id]].abi, functionName, args: callArgs }), blockNumber });
    } catch (error) {
      let current = error;
      while (current && !confirmedRevert) {
        const candidates = [current.data, current.data?.data, current.data?.originalError?.data];
        for (const candidate of candidates) {
          if (typeof candidate !== 'string' || !/^0x[0-9a-f]+$/i.test(candidate)) continue;
          try { confirmedRevert = decodeErrorResult({ abi: artifacts[names[id]].abi, data: candidate }).errorName === errorName; }
          catch { /* Only the exact decoded contract error counts as a passed guard. */ }
          if (confirmedRevert) break;
        }
        current = current.cause;
      }
      if (!confirmedRevert) throw new Error(`${id}.${functionName} did not return the expected ${errorName} revert.`);
    }
    check(confirmedRevert, `${id}.${functionName} unexpectedly allowed the call.`);
    return { contract: id, function: functionName, from: config.owner, expectedError: errorName, method: 'eth_call', passed: true };
  }
  const guards = [
    await requireCallRevert('rewardToken', 'mintReward', [config.owner, 1n], 'OnlyRewardMinter'),
    await requireCallRevert('game', 'bindRewardToken', [contracts.rewardToken], 'RewardTokenAlreadyBound'),
  ];
  equal(await client.getChainId(), CHAIN_ID, 'Final RPC chain');
  equal((await client.getBlock({ blockNumber })).hash, pinned.hash, 'Pinned block after verification');
  const report = {
    formatVersion: 2, deploymentVersion: DEPLOYMENT_VERSION, reusedAssetVerification, verifiedAt: new Date().toISOString(), network: 'robinhood-testnet', chainId: CHAIN_ID,
    rpcUrl: robinhoodTestnet.rpcUrls.default.http[0], blockNumber, blockHash: pinned.hash, blockTimestamp: pinned.timestamp,
    manifestHash: keccak256(stringToHex(manifestText)), standardInputHash: keccak256(stringToHex(trustedInputText)),
    submittedCompilerInputMatched: Boolean(args[1]), compiler: solc.version(), artifactFingerprint: manifest.artifactFingerprint,
    owner: config.owner, treasury: config.treasury, verifier: config.verifier, engineVersion: config.engineVersion,
    contracts, economics, transactions, runtimes, state, guards, checksPassed: checks.length + 1,
    scope: 'Read-only initial deployment verification. No transaction was signed or broadcast. No hosted verifier, playable testnet game, or liquidity pool is asserted by this evidence.',
  };
  await mkdir(new URL('artifacts/', root), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(report, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n');
  console.log(json({ verified: true, chainId: CHAIN_ID, blockNumber, blockHash: pinned.hash, contracts, transactions: operations.length, stateChecks: checks.length + 1, guardChecks: guards.length, evidence: 'artifacts/public-deployment-v2-verification.json' }));
} catch (error) {
  // Do not dump caller-supplied documents, RPC bodies, or unrelated environment contents.
  console.error(`Deployment verification failed: ${error instanceof Error ? error.message.split('\n')[0] : 'Unknown error.'}`);
  process.exitCode = 1;
}
