import { readFile } from 'node:fs/promises';
import { createPublicClient, http, formatEther } from 'viem';
import { robinhoodTestnet, assertChain } from '../src/chain.mjs';
import { artifact } from '../src/artifacts.mjs';
import { currentEngineVersion } from '../src/engine-version.ts';
import { ARTIFACT_NAMES, artifactFingerprint, economics, publicConfig } from '../src/deployment-config.mjs';

// Read-only preflight. Public deployment is performed with six explicit approvals
// in the local browser console, which checkpoints each operation before sending.
try {
  if (process.argv.includes('--broadcast')) throw new Error('CLI broadcast is disabled. Use npm run console for the recoverable six-step browser-wallet flow.');
  const config = publicConfig(JSON.parse(await readFile(new URL('../operator-config.json', import.meta.url), 'utf8')));
  if (await currentEngineVersion() !== config.engineVersion) throw new Error('Engine changed. Prepare operator config again before deploying.');
  const artifacts = Object.fromEntries(await Promise.all(ARTIFACT_NAMES.map(async name => [name, await artifact(name)])));
  if (artifacts.RareRushGame.abi.find(item => item.type === 'constructor')?.inputs.length !== 8 ||
      !artifacts.RareRushGame.abi.some(item => item.name === 'bindRewardToken') ||
      artifacts.RareRushToken.abi.find(item => item.type === 'constructor')?.inputs.length !== 4) {
    throw new Error('Artifacts do not match the six-operation deployment. Recompile before continuing.');
  }
  const client = createPublicClient({ chain: robinhoodTestnet, transport: http(robinhoodTestnet.rpcUrls.default.http[0]) });
  await assertChain(client, robinhoodTestnet.id);
  const balance = await client.getBalance({ address: config.owner });
  console.log(JSON.stringify({ ...config, network: robinhoodTestnet.name, testEthBalance: formatEther(balance),
    artifactFingerprint: artifactFingerprint(config, artifacts), economics,
    operations: ['Deploy test RF', 'Deploy test Genesis', 'Deploy test Generations', 'Deploy game', 'Deploy reward token', 'Bind reward token to game'],
    note: 'Read-only preflight; no transactions sent. The 10% reserve is held by the configured owner, not placed in a Doppler pool.' }, null, 2));
  console.log(balance === 0n ? 'Get test ETH from the official faucet, then run npm run console.' : 'Preflight complete. Run npm run console; approve and verify each of the six wallet operations.');
} catch (error) {
  console.error(error instanceof Error ? error.message.split('\n')[0] : 'Preflight failed.');
  process.exitCode = 1;
}
