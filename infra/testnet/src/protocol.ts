import { keccak256, toHex, type Address, type Hex } from 'viem';

export const PROTOCOL_VERSION = 'rare-rush-input-v1';
export const resultTypes = {
  RunResult: [
    { name: 'runId', type: 'uint256' },
    { name: 'player', type: 'address' },
    { name: 'runSeed', type: 'bytes32' },
    { name: 'pickupKindsHash', type: 'bytes32' },
    { name: 'replayHash', type: 'bytes32' },
    { name: 'engineVersion', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
    { name: 'verifierEpoch', type: 'uint256' },
  ],
} as const;

export function resultData(chainId: number, game: Address, result: {
  runId: bigint; player: Address; runSeed: Hex; pickupKinds: Hex; replayHash: Hex;
  engineVersion: Hex; deadline: bigint; verifierEpoch: bigint;
}) {
  if (chainId !== 31337 && chainId !== 46630) throw new Error('Unsupported signing chain.');
  const { pickupKinds, ...message } = result;
  return {
    domain: { name: 'RareRushTestnet', version: '1', chainId, verifyingContract: game },
    types: resultTypes, primaryType: 'RunResult' as const,
    message: { ...message, pickupKindsHash: keccak256(pickupKinds) },
  };
}

export function engineVersionFromSources(engine: string, difficulty: string): Hex {
  return keccak256(toHex(`${PROTOCOL_VERSION}\n${engine}\n${difficulty}`));
}
