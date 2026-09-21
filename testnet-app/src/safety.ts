import { getAddress, isAddress, zeroAddress, type Address } from 'viem';

export const CHAIN_ID = 46630;
export const RPC_URL = 'https://rpc.testnet.chain.robinhood.com';
export const EXPLORER_URL = 'https://explorer.testnet.chain.robinhood.com';
export const FAUCET_URL = 'https://faucet.testnet.chain.robinhood.com';
export const REWARD_CAP = 1_024_000_000n * 1_000_000n;
export const LAUNCH_ALLOCATION = REWARD_CAP / 10n;
export const GAMEPLAY_ALLOCATION = REWARD_CAP - LAUNCH_ALLOCATION;
export type Contracts = Record<'game' | 'rf' | 'genesis' | 'generations' | 'rewardToken', Address>;
export type PublicConfig = { version: 1; chainId: typeof CHAIN_ID; contracts: Contracts | null; deploymentConsoleUrl: string | null };
export const CONTRACT_KEYS = ['game', 'rf', 'genesis', 'generations', 'rewardToken'] as const;

export function assertRewardEconomics(value: {
  cap: bigint; decimals: number; minter: Address; game: Address;
  launch: bigint; expectedLaunch: bigint; gameplay: bigint; minted: bigint; supply: bigint;
  initial: bigint; minimum: bigint; interval: bigint;
}) {
  if (value.cap !== REWARD_CAP || value.decimals !== 6 ||
      value.minter.toLowerCase() !== value.game.toLowerCase() ||
      value.launch !== LAUNCH_ALLOCATION || value.expectedLaunch !== LAUNCH_ALLOCATION ||
      value.gameplay !== GAMEPLAY_ALLOCATION || value.minted < 0n || value.minted > GAMEPLAY_ALLOCATION ||
      value.supply !== value.launch + value.minted ||
      value.initial !== 10_000_000n || value.minimum !== 1_000_000n || value.interval !== 10_000n) {
    throw new Error('The reward token or test emission settings do not match this test kit. Actions are disabled.');
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid public configuration.');
  return value as Record<string, unknown>;
}

export function parseConfig(value: unknown): PublicConfig {
  const input = record(value);
  if (Object.keys(input).some(key => !['version', 'chainId', 'contracts', 'deploymentConsoleUrl'].includes(key))) {
    throw new Error('Unexpected field in public configuration.');
  }
  if (input.version !== 1 || input.chainId !== CHAIN_ID) throw new Error('This app only supports Robinhood testnet (46630).');
  let contracts: Contracts | null = null;
  if (input.contracts !== null) {
    const addresses = record(input.contracts);
    if (Object.keys(addresses).length !== CONTRACT_KEYS.length) throw new Error('All five contract addresses are required.');
    const entries = CONTRACT_KEYS.map(key => {
      const value = addresses[key];
      if (typeof value !== 'string' || !isAddress(value) || value.toLowerCase() === zeroAddress) throw new Error(`Invalid ${key} address.`);
      return [key, getAddress(value)] as const;
    });
    if (new Set(entries.map(([, value]) => value.toLowerCase())).size !== CONTRACT_KEYS.length) throw new Error('Contract addresses must be distinct.');
    contracts = Object.fromEntries(entries) as Contracts;
  }
  let deploymentConsoleUrl: string | null = null;
  if (input.deploymentConsoleUrl !== null && input.deploymentConsoleUrl !== undefined) {
    // A same-origin route only: never pass the user to an arbitrary wallet-connecting site.
    if (input.deploymentConsoleUrl !== '/deploy/') throw new Error('Invalid deployment console route.');
    deploymentConsoleUrl = '/deploy/';
  }
  return { version: 1, chainId: CHAIN_ID, contracts, deploymentConsoleUrl };
}

export type ActionState = { account: Address | null; walletChain: number | null; verified: boolean; busy: boolean; contracts: Contracts | null };
export function actionBlockReason(state: ActionState): string | null {
  if (!state.contracts) return 'Contracts awaiting deployment.';
  if (!state.account) return 'Connect your wallet first.';
  if (state.walletChain !== CHAIN_ID) return 'Switch to Robinhood testnet first.';
  if (!state.verified) return 'Contract checks must pass before using test assets.';
  if (state.busy) return 'Wait for the current transaction to finish.';
  return null;
}

export function assertWalletContext(expected: Address, accounts: readonly string[], chain: number) {
  if (chain !== CHAIN_ID) throw new Error('Wrong network. This action requires Robinhood testnet (46630).');
  if (!accounts[0] || accounts[0].toLowerCase() !== expected.toLowerCase()) throw new Error('Your wallet account changed. Reconnect and try again.');
}

export function faucetReady(lastDayPlusOne: bigint, blockTimestamp: bigint) {
  return lastDayPlusOne < blockTimestamp / 86_400n + 1n;
}

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
