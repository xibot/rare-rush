import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createPublicClient, createWalletClient, http, keccak256, parseEther, toHex } from 'viem';
import { artifact } from '../../infra/testnet/src/artifacts.mjs';
import { currentEngineVersion } from '../../infra/testnet/src/engine-version.ts';
import { publicConfig, CONFIG_FILE, LAUNCH_ALLOCATION } from '../../infra/testnet/src/deployment-config.mjs';

// Local EVM only. The public owner's identity is impersonated on a disposable
// loopback chain; no wallet credentials or public RPC connection are used.
const app = new URL('../', import.meta.url);
const infra = new URL('../../infra/testnet/', import.meta.url);
const [gameNonce, tokenNonce] = process.argv.slice(2).map(Number);
assert.ok(Number.isSafeInteger(gameNonce) && gameNonce > 130 && tokenNonce > gameNonce && Number.isSafeInteger(tokenNonce),
  'Usage: node scripts/rehearse-v2.mjs PREDICTED_GAME_NONCE PREDICTED_TOKEN_NONCE');
const config = publicConfig(JSON.parse(await readFile(new URL(CONFIG_FILE, infra), 'utf8')));
assert.equal(config.engineVersion, await currentEngineVersion());
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject).listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});
const rpc = `http://127.0.0.1:${port}`;
const node = spawn(process.execPath, ['node_modules/hardhat/dist/src/cli.js', 'node', '--chain-id', '46630', '--hostname', '127.0.0.1', '--port', String(port)],
  { cwd: fileURLToPath(infra), stdio: ['ignore', 'ignore', 'ignore'], env: { PATH: process.env.PATH, DO_NOT_TRACK: '1' } });
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (node.exitCode !== null) throw new Error('Local rehearsal EVM exited.');
    try {
      const result = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
      if ((await result.json()).result === '0xb626') { ready = true; break; }
    } catch { /* Wait for our local child only. */ }
    await delay(100);
  }
  assert.ok(ready, 'Local rehearsal EVM was not ready.');
  const chain = { id: 46630, name: 'Disposable local V2 rehearsal', nativeCurrency: { name: 'Test ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } };
  const client = createPublicClient({ chain, transport: http(rpc), cacheTime: 0 });
  const request = (method, params) => client.request({ method, params });
  await request('hardhat_impersonateAccount', [config.owner]);
  await request('hardhat_setBalance', [config.owner, toHex(parseEther('100'))]);
  const wallet = createWalletClient({ account: config.owner, chain, transport: http(rpc) });
  const [rf, nft, game, token] = await Promise.all(['TestRF', 'TestFriends', 'RareRushGame', 'RareRushToken'].map(artifact));
  const contracts = {};
  const nonces = { rf: 126, genesis: 127, generations: 128, game: gameNonce, rewardToken: tokenNonce };
  async function deploy(id, item, args = []) {
    await request('hardhat_setNonce', [config.owner, toHex(nonces[id])]);
    const receipt = await client.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: item.abi, bytecode: item.bytecode, args }) });
    assert.equal(receipt.status, 'success'); assert.ok(receipt.contractAddress);
    contracts[id] = receipt.contractAddress.toLowerCase();
  }
  await deploy('rf', rf); await deploy('genesis', nft, [true]); await deploy('generations', nft, [false]);
  for (const id of ['rf', 'genesis', 'generations']) assert.equal(contracts[id], config.reusedAssets[id].toLowerCase());
  await deploy('game', game, [config.owner, config.verifier, config.treasury, contracts.rf, contracts.genesis, contracts.generations, config.engineVersion, LAUNCH_ALLOCATION]);
  await deploy('rewardToken', token, [config.launchRecipient, config.owner, contracts.game, LAUNCH_ALLOCATION]);
  const receipt = await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: contracts.game, abi: game.abi, functionName: 'bindRewardToken', args: [contracts.rewardToken] }) });
  assert.equal(receipt.status, 'success');
  const code = Object.fromEntries(await Promise.all(Object.entries(contracts).map(async ([id, address]) => [id, await client.getBytecode({ address })])));
  const hashes = Object.fromEntries(Object.entries(code).map(([id, value]) => [id, keccak256(value)]));
  const profile = {
    status: 'local-rehearsal', deploymentVersion: 'testnet-v2', chainId: 46630, engineVersion: config.engineVersion,
    verifier: config.verifier, owner: config.owner, contracts, runtimeHashes: hashes, deploymentNonces: nonces, assetDeploymentBlock: '122550772',
  };
  const pretty = value => JSON.stringify(value, null, 2) + '\n';
  const publicConfigPath = new URL('public/testnet-config.json', app);
  const publicSettings = JSON.parse(await readFile(publicConfigPath, 'utf8'));
  // The hosting build refuses this profile. Only activate-v2, after independent
  // public-chain verification, can turn it into a production deployment profile.
  await writeFile(new URL('src/shared/deployment.json', app), pretty(profile));
  await writeFile(new URL('test/fixtures/play-runtimes.json', app), pretty({ source: 'disposable-local-v2-rehearsal', chainId: 46630, contracts, hashes, code, engineVersion: config.engineVersion, deploymentNonces: nonces }));
  await writeFile(publicConfigPath, pretty({ ...publicSettings, contracts }));
  console.log(pretty({ rehearsedLocally: true, publicTransactions: 0, contracts, engineVersion: config.engineVersion, releaseBlockedUntilVerified: true }));
} finally {
  node.kill();
  await new Promise(resolve => { if (node.exitCode !== null) resolve(); else { node.once('exit', resolve); setTimeout(resolve, 1500).unref(); } });
}
