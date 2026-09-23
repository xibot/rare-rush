import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getContractAddress, keccak256, stringToHex, type Hex } from 'viem';
import { validateActivationReport, fetchVerifiedRuntimes, activationDocuments, activateV2 } from '../scripts/activate-v2.mjs';
import { ENGINE_VERSION } from '../generated/engine-version.ts';

const oldReport = JSON.parse(await readFile(new URL('../../infra/testnet/deployments/robinhood-testnet-verification.json', import.meta.url), 'utf8'));
const oldRuntimes = JSON.parse(await readFile(new URL('./fixtures/play-runtimes.json', import.meta.url), 'utf8'));
const standardInputText = '{"synthetic":"activation guard unit test only"}';
const hash = (text: string) => keccak256(stringToHex(text));

/** Synthetic evidence tests activation guards; it never runs the public verifier or submits a transaction. */
function fixture() {
  const report = structuredClone(oldReport);
  Object.assign(report, { formatVersion: 2, deploymentVersion: 'testnet-v2', verifiedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION, submittedCompilerInputMatched: false, standardInputHash: hash(standardInputText) });
  const code = { ...oldRuntimes.code, game: '0x60016000', rewardToken: '0x60026000' } as Record<string, Hex>;
  const deployments: Record<string, any> = {};
  for (const [index, id] of ['game', 'rewardToken', 'bind'].entries()) {
    const nonce = 148 + index;
    report.transactions[id].nonce = nonce;
    if (id !== 'bind') {
      report.contracts[id] = getContractAddress({ from: report.owner, nonce: BigInt(nonce) });
      report.runtimes[id] = { ...report.runtimes[id], address: report.contracts[id],
        runtimeCodeHash: keccak256(code[id]), bytes: (code[id].length - 2) / 2 };
    }
    deployments[id] = { ...report.transactions[id], status: 'confirmed' };
  }
  report.transactions = Object.fromEntries(['game', 'rewardToken', 'bind'].map(id => [id, report.transactions[id]]));
  for (const entry of report.state) {
    if (entry.contract === 'game' && entry.function === 'engineVersion') entry.value = ENGINE_VERSION;
    if (entry.contract === 'game' && entry.function === 'token') entry.value = report.contracts.rewardToken;
    if (entry.contract === 'rewardToken' && entry.function === 'rewardMinter') entry.value = report.contracts.game;
  }
  const manifest = { formatVersion: 3, deploymentVersion: 'testnet-v2', chainId: 46630, owner: report.owner,
    treasury: report.treasury, verifier: report.verifier, engineVersion: ENGINE_VERSION,
    artifactFingerprint: report.artifactFingerprint, ...report.contracts, deployments };
  const manifestText = JSON.stringify(manifest);
  report.manifestHash = hash(manifestText);
  const options = { manifestText, standardInputText, expectedEngineVersion: ENGINE_VERSION,
    notBefore: Date.parse(report.verifiedAt) - 1, submittedCompilerInput: false };
  const validated = validateActivationReport(report, options);
  let reads = 0;
  const client = {
    getChainId: async () => 46630,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
      assert.equal(blockNumber, BigInt(report.blockNumber));
      return { hash: report.blockHash };
    },
    getBytecode: async ({ address, blockNumber }: { address: string; blockNumber: bigint }) => {
      assert.equal(blockNumber, BigInt(report.blockNumber));
      const id = Object.keys(validated.contracts).find(id => validated.contracts[id] === address)!;
      reads++;
      return code[id];
    },
  };
  return { report, manifest, options, validated, code, client, reads: () => reads };
}

test('activation reads exact runtimes at one verified block and preserves the original asset scan block and public schema', async () => {
  const f = fixture();
  const code = await fetchVerifiedRuntimes(f.client, f.report, f.validated);
  assert.deepEqual(code, f.code);
  assert.equal(f.reads(), 5);
  const current = { status: 'local-rehearsal', deploymentVersion: 'testnet-v2', chainId: 46630, assetDeploymentBlock: '122550772' };
  const publicConfig = { version: 1, chainId: 46630, contracts: {}, deploymentConsoleUrl: null };
  const documents = activationDocuments(current, publicConfig, f.report, JSON.stringify(f.report), f.validated, code);
  assert.equal(current.status, 'local-rehearsal', 'Validation does not mutate its source inputs');
  assert.equal(documents.deployment.status, 'verified');
  assert.equal(documents.deployment.assetDeploymentBlock, '122550772');
  assert.equal(documents.deployment.engineVersion, ENGINE_VERSION);
  assert.deepEqual(documents.deployment.deploymentNonces, { rf: 126, genesis: 127, generations: 128, game: 148, rewardToken: 149 });
  assert.equal(documents.deployment.verification.reportHash, hash(JSON.stringify(f.report)));
  assert.equal(documents.publicConfig.version, 1);
  assert.equal(documents.publicConfig.deploymentConsoleUrl, null);
  assert.deepEqual(documents.fixtures.code, code);
  assert.deepEqual(documents.fixtures.hashes, f.validated.runtimeHashes);
  assert.deepEqual(documents.publicConfig.contracts, f.validated.contracts);
});

test('activation rejects V1, stale, mismatched-engine, modified-input and incomplete verification evidence', () => {
  const changes = [
    (r: any) => { r.deploymentVersion = 'testnet-v1'; },
    (r: any) => { r.formatVersion = 1; },
    (r: any) => { r.verifiedAt = '2020-01-01T00:00:00Z'; },
    (r: any) => { r.engineVersion = oldReport.engineVersion; },
    (r: any) => { r.manifestHash = hash('different manifest'); },
    (r: any) => { r.standardInputHash = hash('different compiler input'); },
    (r: any) => { r.artifactFingerprint = hash('different artifacts'); },
    (r: any) => { r.rpcUrl = 'https://untrusted.invalid'; },
    (r: any) => { r.contracts.rf = r.contracts.game; },
    (r: any) => { r.runtimes.game.exactOutsideCompilerImmutableSlots = false; },
    (r: any) => { r.transactions.game.nonce++; },
    (r: any) => { r.transactions.game.confirmations = '1'; },
    (r: any) => { r.checksPassed = 0; },
    (r: any) => { r.state.find((x: any) => x.contract === 'rewardToken' && x.function === 'rewardMinter').value = r.owner; },
    (r: any) => { r.guards = []; },
  ];
  for (const change of changes) {
    const f = fixture();
    change(f.report);
    assert.throws(() => validateActivationReport(f.report, f.options));
  }
  const f = fixture();
  assert.throws(() => validateActivationReport(f.report, { ...f.options, expectedEngineVersion: oldReport.engineVersion }), /Engine version/);
  assert.throws(() => validateActivationReport(f.report, { ...f.options, submittedCompilerInput: true }), /Compiler input/);
});

test('runtime confirmation rejects an RPC chain change, reorg, missing code or mismatching bytecode', async () => {
  const f = fixture();
  await assert.rejects(fetchVerifiedRuntimes({ ...f.client, getChainId: async () => 1 }, f.report, f.validated), /chain mismatch/);
  await assert.rejects(fetchVerifiedRuntimes({ ...f.client, getBlock: async () => ({ hash: hash('changed block') }) }, f.report, f.validated), /block changed/);
  for (const code of [undefined, '0x', '0x6003', '0x60016001']) {
    await assert.rejects(fetchVerifiedRuntimes({ ...f.client, getBytecode: async () => code }, f.report, f.validated), /runtime changed/);
  }
  let blockReads = 0;
  await assert.rejects(fetchVerifiedRuntimes({ ...f.client, getBlock: async () => ({ hash: ++blockReads === 1 ? f.report.blockHash : hash('reorg after reads') }) }, f.report, f.validated), /during runtime reads/);
  let chainReads = 0;
  await assert.rejects(fetchVerifiedRuntimes({ ...f.client, getChainId: async () => ++chainReads === 1 ? 46630 : 1 }, f.report, f.validated), /chain changed/);
});

test('activation requires explicit manifest input and rejects invalid target schemas before writing', async () => {
  await assert.rejects(activateV2([]), /Usage:/);
  await assert.rejects(activateV2(['--rpc=https://untrusted.invalid']), /Usage:/);
  const f = fixture();
  assert.throws(() => activationDocuments({ deploymentVersion: 'testnet-v2', chainId: 46630, assetDeploymentBlock: '1' },
    { version: 1, chainId: 46630 }, f.report, JSON.stringify(f.report), f.validated, f.code), /profile is invalid/);
  assert.throws(() => activationDocuments({ deploymentVersion: 'testnet-v2', chainId: 46630, assetDeploymentBlock: '122550772' },
    { version: 2, chainId: 46630 }, f.report, JSON.stringify(f.report), f.validated, f.code), /schema version 1/);
});
