import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createPublicClient, http, isAddress, getContractAddress, keccak256, stringToHex } from 'viem';
import { robinhoodTestnet } from '../../infra/testnet/src/chain.mjs';
import { currentEngineVersion } from '../../infra/testnet/src/engine-version.ts';
import { ENGINE_VERSION } from '../generated/engine-version.ts';
import { AUTHORIZED_OWNER, CHAIN_ID, DEPLOYMENT_VERSION, REUSED_ASSETS, same, validHash } from '../../infra/testnet/src/deployment-config.mjs';

// Repository-only activation. Verification and code reads use the public RPC;
// this module has no wallet client, signing method, or transaction submission.
const app = fileURLToPath(new URL('../', import.meta.url));
const repo = path.dirname(app);
const infrastructure = path.join(repo, 'infra/testnet');
const reportFile = 'infra/testnet/artifacts/public-deployment-v2-verification.json';
const ids = ['rf', 'genesis', 'generations', 'game', 'rewardToken'];
const check = (condition, message) => { if (!condition) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const address = value => typeof value === 'string' && isAddress(value) && !/^0x0{40}$/i.test(value);
const positiveInteger = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
const digest = text => keccak256(stringToHex(text));
const json = value => JSON.stringify(value, null, 2) + '\n';

async function readJson(file, maximumBytes) {
  const contents = await readFile(file, 'utf8');
  check(Buffer.byteLength(contents) <= maximumBytes, 'Input file is too large.');
  return { contents, value: JSON.parse(contents) };
}

/** Validate evidence produced by the fresh verifier, including its exact inputs. */
export function validateActivationReport(report, { manifestText, standardInputText, expectedEngineVersion, notBefore, submittedCompilerInput = false }) {
  const manifest = JSON.parse(manifestText);
  check(object(report) && report.formatVersion === 2 && report.deploymentVersion === DEPLOYMENT_VERSION &&
    report.network === 'robinhood-testnet' && report.chainId === CHAIN_ID, 'Expected a Testnet V2 verification report.');
  check(manifest.formatVersion === 3 && manifest.deploymentVersion === DEPLOYMENT_VERSION && manifest.chainId === CHAIN_ID,
    'Expected a Testnet V2 deployment manifest.');
  check(report.rpcUrl === robinhoodTestnet.rpcUrls.default.http[0], 'Report RPC does not match Robinhood testnet.');
  check(Number.isFinite(Date.parse(report.verifiedAt)) && Date.parse(report.verifiedAt) >= notBefore &&
    Date.parse(report.verifiedAt) <= Date.now() + 60_000, 'Verification report is not from this activation run.');
  check(same(report.manifestHash, digest(manifestText)) && same(report.standardInputHash, digest(standardInputText)),
    'Verification report input hashes do not match.');
  check(report.submittedCompilerInputMatched === submittedCompilerInput, 'Compiler input verification status does not match.');
  check(validHash(report.artifactFingerprint) && same(report.artifactFingerprint, manifest.artifactFingerprint), 'Artifact fingerprint does not match.');
  check(validHash(expectedEngineVersion) && same(report.engineVersion, expectedEngineVersion) &&
    same(manifest.engineVersion, expectedEngineVersion), 'Engine version does not match the V2 source and browser pin.');
  check(same(report.owner, AUTHORIZED_OWNER) && same(report.owner, manifest.owner) &&
    same(report.treasury, AUTHORIZED_OWNER) && same(report.treasury, manifest.treasury), 'Deployment owner or treasury does not match.');
  check(address(report.verifier) && same(report.verifier, manifest.verifier), 'Deployment verifier does not match.');
  check(positiveInteger(report.blockNumber) && validHash(report.blockHash), 'Report pinned block is invalid.');
  check(object(report.contracts) && Object.keys(report.contracts).sort().join(',') === [...ids].sort().join(','), 'Report contract set is invalid.');
  /** @type {Record<string, `0x${string}`>} */
  const contracts = {};
  /** @type {Record<string, `0x${string}`>} */
  const runtimeHashes = {};
  /** @type {Record<string, number>} */
  const deploymentNonces = { rf: 126, genesis: 127, generations: 128 };
  for (const id of ids) {
    const contract = report.contracts[id], runtime = report.runtimes?.[id];
    check(address(contract) && same(contract, manifest[id]), `${id} contract does not match the manifest.`);
    check(object(runtime) && same(runtime.address, contract) && validHash(runtime.runtimeCodeHash) &&
      runtime.exactOutsideCompilerImmutableSlots === true && Number.isSafeInteger(runtime.bytes) && runtime.bytes > 0,
    `${id} compiled runtime verification is missing.`);
    contracts[id] = contract.toLowerCase();
    runtimeHashes[id] = runtime.runtimeCodeHash.toLowerCase();
    if (REUSED_ASSETS[id]) {
      const asset = REUSED_ASSETS[id];
      check(same(contract, asset.address) && same(runtime.runtimeCodeHash, asset.runtimeCodeHash), `${id} is not the approved reused asset.`);
    }
  }
  check(new Set(Object.values(contracts)).size === ids.length, 'Contract addresses must be distinct.');
  let previousNonce = 128;
  for (const id of ['game', 'rewardToken', 'bind']) {
    const tx = report.transactions?.[id], submitted = manifest.deployments?.[id];
    check(object(tx) && object(submitted) && tx.status === 'success' && submitted.status === 'confirmed' && validHash(tx.hash) &&
      same(tx.hash, submitted.hash) && validHash(tx.dataHash) && same(tx.dataHash, submitted.dataHash) &&
      Number.isSafeInteger(tx.nonce) && tx.nonce > previousNonce && tx.nonce === submitted.nonce &&
      positiveInteger(tx.blockNumber) && tx.blockNumber === submitted.blockNumber && BigInt(tx.blockNumber) <= BigInt(report.blockNumber) &&
      positiveInteger(tx.confirmations) && BigInt(tx.confirmations) >= 2n, `${id} verified transaction does not match.`);
    previousNonce = tx.nonce;
    if (id !== 'bind') {
      check(same(getContractAddress({ from: report.owner, nonce: BigInt(tx.nonce) }), contracts[id]), `${id} CREATE address does not match.`);
      deploymentNonces[id] = tx.nonce;
    }
  }
  check(Array.isArray(report.state) && report.checksPassed === report.state.length && report.checksPassed >= 66,
    'Deployment state verification is incomplete.');
  for (const [contract, fn, value] of [['game', 'engineVersion', expectedEngineVersion], ['game', 'token', contracts.rewardToken],
    ['rewardToken', 'rewardMinter', contracts.game], ['game', 'verifier', report.verifier]]) {
    const matches = report.state.filter(item => item.contract === contract && item.function === fn && item.args?.length === 0);
    check(matches.length === 1 && same(matches[0].value, value), `${contract}.${fn} state verification does not match.`);
  }
  for (const [contract, fn, error] of [['rewardToken', 'mintReward', 'OnlyRewardMinter'], ['game', 'bindRewardToken', 'RewardTokenAlreadyBound']]) {
    check(report.guards?.some(item => item.contract === contract && item.function === fn && item.expectedError === error &&
      item.method === 'eth_call' && item.passed === true), `${contract}.${fn} guard verification is missing.`);
  }
  return { contracts, runtimeHashes, deploymentNonces };
}

/** Read every runtime at the verified block, then confirm that block stayed canonical. */
export async function fetchVerifiedRuntimes(client, report, validated) {
  const blockNumber = BigInt(report.blockNumber);
  check(await client.getChainId() === CHAIN_ID, 'Activation RPC chain mismatch.');
  check(same((await client.getBlock({ blockNumber })).hash, report.blockHash), 'Verified block changed before runtime reads.');
  const entries = await Promise.all(ids.map(async id => {
    const code = await client.getBytecode({ address: validated.contracts[id], blockNumber });
    check(typeof code === 'string' && /^0x(?:[0-9a-f]{2})+$/i.test(code) &&
      (code.length - 2) / 2 === report.runtimes[id].bytes && same(keccak256(code), validated.runtimeHashes[id]),
    `${id} runtime changed or does not match the verified hash.`);
    return [id, code];
  }));
  check(await client.getChainId() === CHAIN_ID, 'Activation RPC chain changed.');
  check(same((await client.getBlock({ blockNumber })).hash, report.blockHash), 'Verified block changed during runtime reads.');
  return Object.fromEntries(entries);
}

export function activationDocuments(current, publicConfig, report, reportText, validated, code) {
  check(object(current) && current.deploymentVersion === DEPLOYMENT_VERSION && current.chainId === CHAIN_ID &&
    current.assetDeploymentBlock === '122550772', 'Existing V2 deployment profile is invalid.');
  check(object(publicConfig) && publicConfig.version === 1 && publicConfig.chainId === CHAIN_ID, 'Public config must retain schema version 1.');
  const verification = {
    reportFile, reportHash: digest(reportText), manifestHash: report.manifestHash, standardInputHash: report.standardInputHash,
    artifactFingerprint: report.artifactFingerprint, verifiedAt: report.verifiedAt, blockNumber: report.blockNumber, blockHash: report.blockHash,
  };
  return {
    deployment: { ...current, status: 'verified', engineVersion: report.engineVersion, owner: report.owner,
      verifier: report.verifier, ...validated, verification },
    publicConfig: { ...publicConfig, version: 1, chainId: CHAIN_ID, contracts: validated.contracts },
    fixtures: { chainId: CHAIN_ID, rpcUrl: report.rpcUrl, deploymentVersion: DEPLOYMENT_VERSION,
      blockNumber: report.blockNumber, blockHash: report.blockHash, engineVersion: report.engineVersion,
      contracts: validated.contracts, hashes: validated.runtimeHashes, deploymentNonces: validated.deploymentNonces, code },
  };
}

async function runVerifier(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(infrastructure, 'scripts/verify-deployment.mjs'), ...args], { cwd: infrastructure, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Fresh deployment verification failed; activation files were not changed.')));
  });
}

async function installDocuments(documents) {
  // Stage all files after validation; enable the shared profile last. Roll back
  // completed replacements if a filesystem error interrupts the installation.
  const entries = [
    ['public/testnet-config.json', documents.publicConfig],
    ['test/fixtures/play-runtimes.json', documents.fixtures],
    ['src/shared/deployment.json', documents.deployment],
  ].map(([file, value]) => ({ target: path.join(app, file), contents: json(value) }));
  const completed = [];
  try {
    for (const entry of entries) {
      entry.previous = await readFile(entry.target, 'utf8');
      entry.staged = `${entry.target}.activate-${process.pid}.tmp`;
      await writeFile(entry.staged, entry.contents, { flag: 'wx' });
    }
    for (const entry of entries) { await rename(entry.staged, entry.target); completed.push(entry); }
  } catch (error) {
    for (const entry of completed.reverse()) await writeFile(entry.target, entry.previous);
    throw error;
  } finally {
    await Promise.all(entries.filter(entry => entry.staged).map(entry => rm(entry.staged, { force: true })));
  }
}

export async function activateV2(args) {
  check(args.length >= 1 && args.length <= 2 && !args.some(item => item.startsWith('--')),
    'Usage: node scripts/activate-v2.mjs MANIFEST.json [STANDARD-INPUT.json]');
  const paths = args.map(file => path.resolve(file));
  const { contents: manifestText } = await readJson(paths[0], 128_000);
  const standardInputFile = path.join(infrastructure, 'artifacts/standard-input.json');
  const { contents: standardInputText } = await readJson(standardInputFile, 4_000_000);
  const sourceVersion = await currentEngineVersion();
  check(same(sourceVersion, ENGINE_VERSION), 'Local engine source differs from the generated browser pin. Prepare the shared package first.');
  const started = Date.now();
  await runVerifier(paths);
  check(await readFile(paths[0], 'utf8') === manifestText && await readFile(standardInputFile, 'utf8') === standardInputText,
    'Verification inputs changed during activation.');
  const { value: report, contents: reportText } = await readJson(path.join(repo, reportFile), 4_000_000);
  const validated = validateActivationReport(report, { manifestText, standardInputText, expectedEngineVersion: sourceVersion,
    notBefore: started, submittedCompilerInput: paths.length === 2 });
  const client = createPublicClient({ chain: robinhoodTestnet,
    transport: http(robinhoodTestnet.rpcUrls.default.http[0], { timeout: 30_000, retryCount: 2 }) });
  const code = await fetchVerifiedRuntimes(client, report, validated);
  const current = (await readJson(path.join(app, 'src/shared/deployment.json'), 128_000)).value;
  const publicConfig = (await readJson(path.join(app, 'public/testnet-config.json'), 16_000)).value;
  const documents = activationDocuments(current, publicConfig, report, reportText, validated, code);
  check(same(await currentEngineVersion(), sourceVersion), 'Engine source changed during activation.');
  await installDocuments(documents);
  console.log(json({ activated: true, chainId: CHAIN_ID, engineVersion: sourceVersion, contracts: validated.contracts,
    blockNumber: report.blockNumber, blockHash: report.blockHash, reportFile }));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await activateV2(process.argv.slice(2)); }
  catch (error) {
    console.error(`V2 activation failed: ${error instanceof Error ? error.message.split('\n')[0] : 'Unknown error.'}`);
    process.exitCode = 1;
  }
}
