import { keccak256, toHex, type Address, type Hex } from 'viem';

export const PROTOCOL_VERSION = 'rare-rush-input-v2';
/** Canonical, sorted physics dependency paths, relative to games/rare-rush. */
export const ENGINE_SOURCE_PATHS = ['difficulty.ts', 'engine.ts', 'twist/engine.ts'] as const;
export type EngineSourcePath = typeof ENGINE_SOURCE_PATHS[number];
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

export function engineVersionFromSources(sources: Readonly<Record<EngineSourcePath, string>>): Hex {
  // JSON framing binds paths and exact source contents without delimiter ambiguity.
  // Caller object insertion order cannot change the version, nor can V1 share it.
  const entries = ENGINE_SOURCE_PATHS.map(path => {
    if (typeof sources[path] !== 'string') throw new Error(`Missing engine source: ${path}`);
    return [path, sources[path]];
  });
  return keccak256(toHex(JSON.stringify([PROTOCOL_VERSION, entries])));
}
