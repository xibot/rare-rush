import { getAddress, isAddress, zeroAddress } from 'viem';

// Selected Rare Rush pool policy. Uniswap V3 expresses fees in millionths:
// 10,000 / 1,000,000 = 1%; its corresponding tick spacing is 200.
export const POOL_FEE = 10_000;
export const TICK_SPACING = 200;
export const PROTOCOL_FEE_SHARES = 50_000_000_000_000_000n;
export const GAME_FEE_SHARES = 950_000_000_000_000_000n;

// Public recipient choices only; this does not deploy a pool. Mainnet destinations
// must be supplied separately when preparing its launch, with no testnet fallback.
export const TESTNET_GAME_FEE_RECIPIENT = '0x6fD155b9D52F80E8A73a8A2537268602978486e2';
export const MAINNET_GAME_ADMIN_RECIPIENT = null;
export const MAINNET_ENTRY_TREASURY_RECIPIENT = null;

// Read the protocol owner from the chosen Airlock. Supply the designated revenue
// recipient explicitly: neither the launcher nor the gameplay contract is a default.
export function buildFeeBeneficiaries(protocolOwner, gameFeeRecipient) {
  for (const value of [protocolOwner, gameFeeRecipient]) {
    if (typeof value !== 'string' || !isAddress(value) || value.toLowerCase() === zeroAddress) {
      throw new Error('Trading-fee beneficiaries must be explicit nonzero addresses.');
    }
  }
  const protocol = getAddress(protocolOwner);
  const game = getAddress(gameFeeRecipient);
  if (protocol === game) throw new Error('Game and Doppler fee recipients must be distinct.');
  return [
    { beneficiary: protocol, shares: PROTOCOL_FEE_SHARES },
    { beneficiary: game, shares: GAME_FEE_SHARES },
  ].sort((a, b) => BigInt(a.beneficiary) < BigInt(b.beneficiary) ? -1 : 1);
}
