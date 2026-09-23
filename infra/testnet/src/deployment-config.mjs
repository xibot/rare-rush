import { getAddress, isAddress, keccak256, stringToHex } from 'viem';

export const AUTHORIZED_OWNER = '0x6fD155b9D52F80E8A73a8A2537268602978486e2';
export const CHAIN_ID = 46630;
export const DEPLOYMENT_VERSION = 'testnet-v2';
export const CONFIG_FILE = 'operator-config-v2.json';
export const OPERATIONS = ['game', 'rewardToken', 'bind'];
// Pinned to the independently verified V1 deployment. Existing balances, faucet
// usage and NFT ownership are deliberately not part of these identity checks.
export const REUSED_ASSETS = Object.freeze({
  rf: { address: '0xED668133bab94DD83e537F12B68365c4bC0eC2a3', artifact: 'TestRF', runtimeCodeHash: '0x2255d3a4fbaafdc39c6f7be4215449eb8ccb014b5c27c325be66c8080998a736' },
  genesis: { address: '0x7404d2b0461228C6478fdB8850d27d8e65EFD2c3', artifact: 'TestFriends', runtimeCodeHash: '0x8461ccd4fa48cccce7fe5789dfcdce17eea1cff0ad1d1ddc67d11d20a0b28ad8' },
  generations: { address: '0x606dCbFA17b76E4194865a09D6cfb92BE7EE26c3', artifact: 'TestFriends', runtimeCodeHash: '0x98cd06ca67c51f51fcfa892e0dcbe8b88b453dcf37281ed035e0007cfae046aa' },
});
export const REWARD_CAP = 1_024_000_000n * 1_000_000n;
export const LAUNCH_ALLOCATION = 102_400_000n * 1_000_000n;
export const GAMEPLAY_ALLOCATION = REWARD_CAP - LAUNCH_ALLOCATION;
export const ARTIFACT_NAMES = ['TestRF', 'TestFriends', 'RareRushGame', 'RareRushToken'];
export const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
export const validHash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
export const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
export const economics = Object.freeze({
  rewardCap: '1024000000', launchReserve: '102400000', gameplayAllocation: '921600000',
  allocationStatus: 'provisional-test-settings', launchPercent: 10, gameplayPercent: 90,
  generationsEntry: '110', prizePoolShare: '100', treasuryShare: '10', genesisEntry: '0',
  genesisMultiplier: 100, dailyRunsPerNft: 3, initialCoinReward: '10', minimumCoinReward: '1', halvingInterval: 10000,
  rfDecimals: 18, rewardDecimals: 6, liquidityPoolDeployed: false,
});
export function publicConfig(raw) {
  if (raw.deploymentVersion !== DEPLOYMENT_VERSION || raw.chainId !== CHAIN_ID || !same(raw.owner, AUTHORIZED_OWNER) ||
      !isAddress(raw.verifier) || /^0x0{40}$/i.test(raw.verifier) ||
      !same(raw.treasury, AUTHORIZED_OWNER) ||
      !validHash(raw.engineVersion) || /^0x0{64}$/i.test(raw.engineVersion) ||
      raw.launchAllocation !== LAUNCH_ALLOCATION.toString() || !same(raw.launchRecipient, raw.owner)) {
    throw new Error('Public operator config must contain the authorized owner, verifier, treasury, engine version, chain 46630, and approved 10% launch reserve to the owner. Prepare the operator config again.');
  }
  for (const [id, asset] of Object.entries(REUSED_ASSETS)) {
    if (!same(raw.reusedAssets?.[id], asset.address)) throw new Error('V2 must reuse the approved V1 test RF and NFT collections.');
  }
  return { deploymentVersion: DEPLOYMENT_VERSION, chainId: CHAIN_ID, owner: getAddress(raw.owner), treasury: getAddress(raw.treasury),
    verifier: getAddress(raw.verifier), engineVersion: raw.engineVersion,
    launchAllocation: LAUNCH_ALLOCATION.toString(), launchRecipient: getAddress(raw.launchRecipient),
    reusedAssets: Object.fromEntries(Object.entries(REUSED_ASSETS).map(([id, asset]) => [id, asset.address])) };
}
export function artifactFingerprint(config, artifacts) {
  return keccak256(stringToHex(json([config, ARTIFACT_NAMES.map(name => [name, artifacts[name].bytecode])])));
}
export function constructorArgs(id, config, deployments) {
  if (id === 'game') return [config.owner, config.verifier, config.treasury, config.reusedAssets.rf,
    config.reusedAssets.genesis, config.reusedAssets.generations, config.engineVersion, LAUNCH_ALLOCATION];
  if (id === 'rewardToken') return [config.launchRecipient, config.owner, deployments.game.address, LAUNCH_ALLOCATION];
  if (id === 'bind') return [deployments.rewardToken.address];
  throw new Error('Unknown deployment operation.');
}

export async function verifyReusedAssets(client, artifacts, blockNumber) {
  if (await client.getChainId() !== CHAIN_ID) throw new Error('The public RPC returned the wrong chain. Deployment stopped.');
  const evidence = {};
  for (const [id, asset] of Object.entries(REUSED_ASSETS)) {
    const code = await client.getCode({ address: asset.address, blockNumber });
    if (!code || code === '0x' || !same(keccak256(code), asset.runtimeCodeHash)) throw new Error(`Reused ${id} runtime code does not match the verified V1 asset.`);
    const checks = id === 'rf'
      ? [['name', 'Rare Friends Testnet Faucet'], ['symbol', 'tRF'], ['decimals', 18], ['FAUCET_AMOUNT', 1_100n * 10n ** 18n]]
      : [['name', id === 'genesis' ? 'Rare Rush Test Genesis' : 'Rare Rush Test Generations'], ['symbol', id === 'genesis' ? 'tGENESIS' : 'tGENERATIONS'], ['isGenesis', id === 'genesis'], ['supportsInterface', true, ['0x80ac58cd']]];
    for (const [functionName, expected, args = []] of checks) {
      const actual = await client.readContract({ address: asset.address, abi: artifacts[asset.artifact].abi, functionName, args, blockNumber });
      if (actual !== expected) throw new Error(`Reused ${id}.${functionName} does not match the approved test asset.`);
    }
    evidence[id] = { ...asset, operation: 'reuse', verifiedReadOnly: true };
  }
  return evidence;
}
