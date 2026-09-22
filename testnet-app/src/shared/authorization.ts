import { getAddress, isAddress, keccak256, toHex, type Address, type Hex } from 'viem';
import { parseReplay, type Replay } from '../../generated/infra/testnet/src/replay.ts';

export const AUTH_CHAIN_ID = 46630;
export const AUTH_GAME = '0x24BcA5Bf559e0353801F719EbC3885441CB49Fd3' as Address;
export const AUTH_SITE = 'https://testnet.rarerush.app';
export const AUTH_TTL_SECONDS = 300;
export const MAX_VERIFY_REQUEST_BYTES = 1_500_000;
export const MAX_AUTH_REPLAY_TICKS = 120 * 120;

export type ReplayAuthorization = {
  player: Address;
  runId: string;
  replayHash: Hex;
  expiresAt: string;
};
export type VerifyRunRequest = {
  authorization: ReplayAuthorization;
  signature: Hex;
  replay: Replay;
};

const authorizationTypes = {
  VerifyReplay: [
    { name: 'player', type: 'address' },
    { name: 'runId', type: 'uint256' },
    { name: 'replayHash', type: 'bytes32' },
    { name: 'site', type: 'string' },
    { name: 'expiresAt', type: 'uint256' },
  ],
} as const;

export function canonicalReplay(input: unknown): Replay {
  return parseReplay(input, MAX_AUTH_REPLAY_TICKS);
}

export function canonicalReplayHash(input: unknown): Hex {
  return keccak256(toHex(JSON.stringify(canonicalReplay(input))));
}

export function parseAuthorization(input: unknown): ReplayAuthorization {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid replay authorization.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'expiresAt,player,replayHash,runId'
    || typeof value.player !== 'string' || !isAddress(value.player) || /^0x0{40}$/i.test(value.player)
    || typeof value.runId !== 'string' || !/^[1-9][0-9]{0,77}$/.test(value.runId) || BigInt(value.runId) >= 2n ** 256n
    || typeof value.expiresAt !== 'string' || !/^[1-9][0-9]{0,11}$/.test(value.expiresAt)
    || typeof value.replayHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value.replayHash)) {
    throw new Error('Invalid replay authorization.');
  }
  return { player: getAddress(value.player), runId: value.runId, replayHash: value.replayHash.toLowerCase() as Hex, expiresAt: value.expiresAt };
}

/** Sign this wallet message after a completed run; it authorizes no transaction. */
export function authorizationTypedData(input: ReplayAuthorization) {
  const authorization = parseAuthorization(input);
  return {
    domain: { name: 'RareRushTestnetReplayAuthorization', version: '1', chainId: AUTH_CHAIN_ID, verifyingContract: AUTH_GAME },
    types: authorizationTypes, primaryType: 'VerifyReplay' as const,
    message: {
      player: authorization.player, runId: BigInt(authorization.runId), replayHash: authorization.replayHash,
      site: AUTH_SITE, expiresAt: BigInt(authorization.expiresAt),
    },
  };
}

export function createAuthorization({ player, runId, replay, expiresAt }: {
  player: Address; runId: bigint | string; replay: unknown; expiresAt: bigint | number | string;
}): ReplayAuthorization {
  return parseAuthorization({ player, runId: runId.toString(), replayHash: canonicalReplayHash(replay), expiresAt: expiresAt.toString() });
}
