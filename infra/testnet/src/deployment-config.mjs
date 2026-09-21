import { getAddress, isAddress, keccak256, stringToHex } from 'viem';

export const AUTHORIZED_OWNER = '0x6fD155b9D52F80E8A73a8A2537268602978486e2';
export const CHAIN_ID = 46630;
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
  if (raw.chainId !== CHAIN_ID || !same(raw.owner, AUTHORIZED_OWNER) ||
      !isAddress(raw.verifier) || /^0x0{40}$/i.test(raw.verifier) ||
      !isAddress(raw.treasury) || /^0x0{40}$/i.test(raw.treasury) ||
      !validHash(raw.engineVersion) || /^0x0{64}$/i.test(raw.engineVersion) ||
      raw.launchAllocation !== LAUNCH_ALLOCATION.toString() || !same(raw.launchRecipient, raw.owner)) {
    throw new Error('Public operator config must contain the authorized owner, verifier, treasury, engine version, chain 46630, and approved 10% launch reserve to the owner. Prepare the operator config again.');
  }
  return { chainId: CHAIN_ID, owner: getAddress(raw.owner), treasury: getAddress(raw.treasury),
    verifier: getAddress(raw.verifier), engineVersion: raw.engineVersion,
    launchAllocation: LAUNCH_ALLOCATION.toString(), launchRecipient: getAddress(raw.launchRecipient) };
}
export function artifactFingerprint(config, artifacts) {
  return keccak256(stringToHex(json([config, ARTIFACT_NAMES.map(name => [name, artifacts[name].bytecode])])));
}
export function constructorArgs(id, config, deployments) {
  if (id === 'rf') return [];
  if (id === 'genesis') return [true];
  if (id === 'generations') return [false];
  if (id === 'game') return [config.owner, config.verifier, config.treasury, deployments.rf.address,
    deployments.genesis.address, deployments.generations.address, config.engineVersion, LAUNCH_ALLOCATION];
  if (id === 'rewardToken') return [config.launchRecipient, config.owner, deployments.game.address, LAUNCH_ALLOCATION];
  if (id === 'bind') return [deployments.rewardToken.address];
  throw new Error('Unknown deployment operation.');
}
