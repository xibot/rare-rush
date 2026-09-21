import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createPublicClient, createWalletClient, getAddress, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { robinhoodTestnet, assertChain } from '../src/chain.mjs';
import { artifact } from '../src/artifacts.mjs';
import { currentEngineVersion } from '../src/engine-version.ts';

// Public deployment is deliberately explicit; never fall back to a local dev key.
try {
  const config = JSON.parse(await readFile(new URL('../operator-config.json', import.meta.url), 'utf8'));
  const chain = robinhoodTestnet;
  if (config.chainId !== chain.id) throw new Error('Operator config must target Robinhood testnet.');
  const owner = getAddress(config.owner), verifier = getAddress(config.verifier);
  const version = await currentEngineVersion();
  if (version !== config.engineVersion) throw new Error('Engine changed. Prepare operator config again before deploying.');
  const transport = http(process.env.RUSH_RPC_URL ?? chain.rpcUrls.default.http[0]);
  const client = createPublicClient({ chain, transport });
  await assertChain(client, chain.id);
  console.log(JSON.stringify({ network: chain.name, owner, verifier, engineVersion: version, assets: 'tRF / tGENESIS / tGENERATIONS / tRARERUSH; no real funds or liquidity pair' }, null, 2));
  if (!process.argv.includes('--broadcast')) {
    console.log('Preflight complete. For browser-wallet deployment use npm run console. CLI broadcast additionally requires RUSH_DEPLOYER_PRIVATE_KEY and --broadcast.');
  } else {
    const key = process.env.RUSH_DEPLOYER_PRIVATE_KEY;
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Set a dedicated testnet deployer key in the operator environment, or use the browser-wallet console.');
    const account = privateKeyToAccount(key);
    if (account.address !== owner) throw new Error('Deployer must be the configured owner wallet.');
    const balance = await client.getBalance({ address: account.address });
    if (balance === 0n) throw new Error('Fund the owner with faucet test ETH first.');
    console.log(`Deployer: ${account.address}; test ETH: ${formatEther(balance)}`);
    const wallet = createWalletClient({ chain, account, transport });
    const directory = new URL('../deployments/', import.meta.url);
    await mkdir(directory, { recursive: true });
    const path = new URL(`robinhood-${Date.now()}.json`, directory);
    const manifest = { ...config, deployedAt: new Date().toISOString(), compiler: '0.8.30', evmVersion: 'cancun', contracts: {} };
    await writeFile(path, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    async function deploy(name, label, args) {
      await assertChain(client, chain.id);
      const { abi, bytecode } = await artifact(name);
      const hash = await wallet.deployContract({ abi, bytecode, args });
      manifest.contracts[label] = { transaction: hash, args };
      await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
      const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 2 });
      if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`${label} deployment failed; see saved manifest.`);
      const address = getAddress(receipt.contractAddress);
      if (!await client.getCode({ address })) throw new Error(`${label} has no deployed code.`);
      manifest.contracts[label].address = address;
      await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
      console.log(`${label}: ${chain.blockExplorers.default.url}/address/${address}`);
      return address;
    }
    const rf = await deploy('TestRF', 'rf', []);
    const genesis = await deploy('TestFriends', 'genesis', [true]);
    const generations = await deploy('TestFriends', 'generations', [false]);
    const game = await deploy('RareRushGame', 'game', [owner, verifier, rf, genesis, generations, version]);
    const { abi } = await artifact('RareRushGame');
    manifest.contracts.rewardToken = { address: await client.readContract({ address: game, abi, functionName: 'token' }) };
    await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Deployment complete. Manifest: ${path.pathname}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message.split('\n')[0] : 'Deployment failed.');
  process.exitCode = 1;
}
