import assert from 'node:assert/strict';
import test from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, toHex, recoverTypedDataAddress, type Abi, type Address, type Hex } from 'viem';
import gameArtifact from '../generated/infra/testnet/artifacts/RareRushGame.json' with { type: 'json' };
import nftArtifact from '../generated/infra/testnet/artifacts/TestFriends.json' with { type: 'json' };
import { ENGINE_VERSION } from '../generated/engine-version.ts';
import { verifyAndSignCore } from '../generated/infra/testnet/src/verifier-core.ts';
import { resultData } from '../generated/infra/testnet/src/protocol.ts';
import { recordPilot } from '../../infra/testnet/test/pilot.ts';
import { AUTH_CHAIN_ID, AUTH_GAME } from '../src/shared/authorization.ts';

const player = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const verifierKey = `0x${'22'.repeat(32)}` as Hex;
const verifier = privateKeyToAccount(verifierKey);
const nft = '0x0000000000000000000000000000000000000001' as Address;
const seed = keccak256(toHex('rare-rush-replay-test'));
const baseRun = () => [player.address, 1n, seed, 1000n, 2000n, 0, 1, false, 1n, false];
type Overrides = {
  run?: unknown[]; chainId?: number; timestamp?: bigint; owner?: Address;
  signer?: Address; epoch?: bigint; paused?: boolean; generation?: bigint; version?: Hex;
};
function client(overrides: Overrides = {}) {
  return {
    getChainId: async () => overrides.chainId ?? AUTH_CHAIN_ID,
    getBlockNumber: async () => 100n,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
      assert.equal(blockNumber, 98n);
      return { number: blockNumber, timestamp: overrides.timestamp ?? 1150n };
    },
    readContract: async ({ functionName, blockNumber }: { functionName: string; blockNumber: bigint }) => {
      assert.equal(blockNumber, 98n, 'Every state read must use the same confirmed block');
      const values: Record<string, unknown> = {
        runs: overrides.run ?? baseRun(), engineVersion: overrides.version ?? ENGINE_VERSION,
        verifier: overrides.signer ?? verifier.address, verifierEpoch: overrides.epoch ?? 1n,
        paused: overrides.paused ?? false, genesis: nft, generations: nft,
        ownerOf: overrides.owner ?? player.address, generation: overrides.generation ?? 1n,
      };
      assert.ok(functionName in values, `Unexpected call ${functionName}`);
      return values[functionName];
    },
  };
}
function options(overrides: Overrides = {}) {
  return {
    client: client(overrides), chainId: AUTH_CHAIN_ID, game: AUTH_GAME, runId: 1n,
    replay: { version: 'rare-rush-input-v1', frames: [] }, privateKey: verifierKey,
    gameAbi: gameArtifact.abi as Abi, nftAbi: nftArtifact.abi as Abi,
    engineVersion: ENGINE_VERSION, expectedPlayer: player.address, confirmations: 2,
  };
}

test('core signs a real deterministic replay using confirmed game state and the pinned engine', async () => {
  const result = await verifyAndSignCore({ ...options(), replay: recordPilot(seed, 1) });
  assert.ok(result.coins > 0);
  assert.equal(result.player, player.address);
  assert.equal(result.verifiedAtBlock, '98');
  assert.equal(result.engineVersion, ENGINE_VERSION);
  assert.equal(result.deadline, '1450');
  const recovered = await recoverTypedDataAddress({
    ...resultData(AUTH_CHAIN_ID, AUTH_GAME, {
      runId: 1n, player: player.address, runSeed: seed, pickupKinds: result.pickupKinds,
      replayHash: result.replayHash, engineVersion: ENGINE_VERSION, deadline: BigInt(result.deadline), verifierEpoch: 1n,
    }),
    signature: result.signature,
  });
  assert.equal(recovered, verifier.address);
});

test('core rejects run-player mismatch before replay execution', async () => {
  await assert.rejects(verifyAndSignCore({ ...options(), expectedPlayer: verifier.address }), /not from the run player/);
});

test('core rejects finalized, paused, revoked, unknown and invalid-option runs', async () => {
  const claimed = baseRun(); claimed[7] = true;
  const abandoned = baseRun(); abandoned[9] = true;
  const unknown = baseRun(); unknown[3] = 0n;
  const invalidCollection = baseRun(); invalidCollection[5] = 2;
  const invalidDifficulty = baseRun(); invalidDifficulty[6] = 3;
  for (const [changes, expected] of [
    [{ run: claimed }, /not claimable/], [{ run: abandoned }, /not claimable/],
    [{ run: unknown }, /not claimable/], [{ paused: true }, /not claimable/],
    [{ epoch: 2n }, /not claimable/], [{ run: invalidCollection }, /Invalid run collection/],
    [{ run: invalidDifficulty }, /unfinished/],
  ] as const) await assert.rejects(verifyAndSignCore(options(changes)), expected);
});

test('core rejects unfinished, expired, transferred and unqualified NFT runs', async () => {
  for (const [changes, expected] of [
    [{ timestamp: 1089n }, /unfinished/], [{ timestamp: 2000n }, /expired/],
    [{ owner: verifier.address }, /no longer owns/], [{ generation: 0n }, /not hardwired/],
  ] as const) await assert.rejects(verifyAndSignCore(options(changes)), expected);
});

test('core rejects wrong RPC chain, signing identity, engine, and shallow confirmations', async () => {
  await assert.rejects(verifyAndSignCore(options({ chainId: 4663 })), /RPC chain mismatch/);
  await assert.rejects(verifyAndSignCore(options({ signer: player.address })), /key does not match/);
  await assert.rejects(verifyAndSignCore(options({ version: `0x${'44'.repeat(32)}` })), /Engine source differs/);
  await assert.rejects(verifyAndSignCore({ ...options(), confirmations: 1 }), /Invalid confirmation depth/);
});

test('core never signs a losing replay or fabricated scores', async () => {
  await assert.rejects(verifyAndSignCore(options()), /did not survive/);
  await assert.rejects(verifyAndSignCore({ ...options(), replay: { ...recordPilot(seed, 1), coins: 100000 } }), /schema/);
});
