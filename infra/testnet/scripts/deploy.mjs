import { readFile } from 'node:fs/promises';
import { createPublicClient, http, formatEther, getContractAddress } from 'viem';
import { robinhoodTestnet, assertChain } from '../src/chain.mjs';
import { artifact } from '../src/artifacts.mjs';
import { currentEngineVersion } from '../src/engine-version.ts';
import { ARTIFACT_NAMES, artifactFingerprint, economics, publicConfig, CONFIG_FILE, verifyReusedAssets } from '../src/deployment-config.mjs';

// Read-only preflight. Public deployment is performed with three explicit approvals
// in the local browser console, which checkpoints each operation before sending.
try {
  if (process.argv.includes('--broadcast')) throw new Error('CLI broadcast is disabled. Use npm run console for the recoverable three-step V2 browser-wallet flow.');
  const config = publicConfig(JSON.parse(await readFile(new URL(`../${CONFIG_FILE}`, import.meta.url), 'utf8')));
  if (await currentEngineVersion() !== config.engineVersion) throw new Error('Engine changed. Prepare operator config again before deploying.');
  const artifacts = Object.fromEntries(await Promise.all(ARTIFACT_NAMES.map(async name => [name, await artifact(name)])));
  if (artifacts.RareRushGame.abi.find(item => item.type === 'constructor')?.inputs.length !== 8 ||
      !artifacts.RareRushGame.abi.some(item => item.name === 'bindRewardToken') ||
      artifacts.RareRushToken.abi.find(item => item.type === 'constructor')?.inputs.length !== 4) {
    throw new Error('Artifacts do not match the three-operation V2 deployment. Recompile before continuing.');
  }
  const client = createPublicClient({ chain: robinhoodTestnet, transport: http(robinhoodTestnet.rpcUrls.default.http[0]) });
  await assertChain(client, robinhoodTestnet.id);
  const reusedAssetVerification = await verifyReusedAssets(client, artifacts);
  const [balance, latestNonce, pendingNonce] = await Promise.all([
    client.getBalance({ address: config.owner }),
    client.getTransactionCount({ address: config.owner, blockTag: 'latest' }),
    client.getTransactionCount({ address: config.owner, blockTag: 'pending' }),
  ]);
  if (latestNonce !== pendingNonce) throw new Error('Owner wallet has pending transactions. Confirm them before preparing the V2 deployment.');
  const predictedDeployment = {
    nonces: { game: pendingNonce, rewardToken: pendingNonce + 1, bind: pendingNonce + 2 },
    addresses: {
      game: getContractAddress({ from: config.owner, nonce: BigInt(pendingNonce) }),
      rewardToken: getContractAddress({ from: config.owner, nonce: BigInt(pendingNonce + 1) }),
    },
    status: 'prediction-only-not-deployed',
    condition: 'Valid only if these are the next three owner transactions. The console checkpoints each nonce before the wallet request; activation requires confirmed deployment verification.',
  };
  console.log(JSON.stringify({ ...config, network: robinhoodTestnet.name, testEthBalance: formatEther(balance),
    artifactFingerprint: artifactFingerprint(config, artifacts), economics, reusedAssetVerification, predictedDeployment,
    operations: ['Deploy V2 game', 'Deploy V2 reward token', 'Bind V2 reward token to game'],
    note: 'Read-only preflight; no transactions sent. The 10% reserve is held by the configured owner, not placed in a Doppler pool.' }, null, 2));
  console.log(balance === 0n ? 'Get test ETH from the official faucet, then run npm run console.' : 'Preflight complete. Run npm run console; approve and verify each of the three wallet operations.');
} catch (error) {
  console.error(error instanceof Error ? error.message.split('\n')[0] : 'Preflight failed.');
  process.exitCode = 1;
}
