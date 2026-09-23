import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { keccak256, toHex } from 'viem';
import { verifyReplay, parseReplay, MAX_PICKUPS } from '../src/replay.ts';
import { verifyAndSign } from '../src/verifier.ts';
import { ENGINE_SOURCE_PATHS, engineVersionFromSources, PROTOCOL_VERSION, type EngineSourcePath } from '../src/protocol.ts';
import { currentEngineVersion } from '../src/engine-version.ts';
import { recordPilot } from './pilot.ts';
import { localFixture } from './local-fixture.ts';

const seed = keccak256(toHex('rare-rush-replay-test'));
test('replays real controls deterministically for all three difficulty modes', () => {
  for (const difficulty of [0, 1, 2]) {
    const input = recordPilot(seed, difficulty);
    const result = verifyReplay(seed, difficulty, input);
    assert.ok(result.coins > 0);
    assert.ok(result.hearts > 0);
    assert.equal(result.ticks, [14400, 10800, 7200][difficulty]);
    assert.equal((result.pickupKinds.length - 2) / 2, result.coins);
    assert.deepEqual(verifyReplay(seed, difficulty, input), result);
  }
});

test('V2 legal controls survive contract-shaped seeds in every mode within the pickup cap and preserve 10x bonuses', () => {
  const seeds = [toHex(0n, { size: 32 }), toHex(1n, { size: 32 }), `0x${'ff'.repeat(32)}`,
    ...Array.from({ length: 9 }, (_, index) => keccak256(toHex(`v2-contract-route-${index}`)))] as `0x${string}`[];
  for (const difficulty of [0, 1, 2]) {
    for (const contractSeed of seeds) {
      const replay = recordPilot(contractSeed, difficulty);
      const result = verifyReplay(contractSeed, difficulty, replay);
      const kinds = result.pickupKinds.slice(2).match(/../g) ?? [];
      assert.equal(result.ticks, [14400, 10800, 7200][difficulty]);
      assert.ok(result.hearts > 0, `${difficulty}: ${contractSeed}`);
      assert.ok(result.coins <= MAX_PICKUPS);
      assert.equal(kinds.length, result.coins);
      assert.ok(kinds.every(kind => kind === '00' || kind === '01'));
      assert.equal(kinds.filter(kind => kind === '01').length, result.bonusCoins);
      assert.ok(result.bonusCoins > 0);
      assert.equal(kinds.reduce((weight, kind) => weight + (kind === '01' ? 10 : 1), 0), result.coins + 9 * result.bonusCoins);
      assert.deepEqual(verifyReplay(contractSeed.toUpperCase().replace('0X', '0x') as `0x${string}`, difficulty, replay), result);
    }
  }
});

test('V2 source pin binds every physics dependency, ordered paths and the replay domain', async () => {
  assert.equal(PROTOCOL_VERSION, 'rare-rush-input-v2');
  assert.deepEqual(ENGINE_SOURCE_PATHS, ['difficulty.ts', 'engine.ts', 'twist/engine.ts']);
  const root = new URL('../../../games/rare-rush/', import.meta.url);
  const entries = await Promise.all(ENGINE_SOURCE_PATHS.map(async path => [path, await readFile(new URL(path, root), 'utf8')] as const));
  const sources = Object.fromEntries(entries) as Record<EngineSourcePath, string>;
  const version = engineVersionFromSources(sources);
  assert.equal(version, '0x907ff2967abdd97cc172f53c0c69fbcd17f22fcf4ece263e5846bf2973a3accb');
  assert.equal(await currentEngineVersion(), version);
  assert.equal(engineVersionFromSources(Object.fromEntries([...entries].reverse()) as typeof sources), version);
  for (const path of ENGINE_SOURCE_PATHS) {
    assert.notEqual(engineVersionFromSources({ ...sources, [path]: sources[path] + '\n' }), version);
    assert.throws(() => engineVersionFromSources({ ...sources, [path]: undefined } as unknown as typeof sources), /Missing engine source/);
  }
  assert.notEqual(keccak256(toHex(JSON.stringify(['rare-rush-input-v1', entries]))), version);
  assert.notEqual(keccak256(toHex(`rare-rush-input-v1\n${sources['engine.ts']}\n${sources['difficulty.ts']}`)), version);
});

test('V1 recordings cannot be accepted as V2 and canonical replay hashes include V2 framing', () => {
  const replay = recordPilot(seed, 1);
  assert.throws(() => parseReplay({ ...replay, version: 'rare-rush-input-v1' }, 10800), /Unsupported replay schema/);
  assert.throws(() => verifyReplay(seed, 1, { ...replay, version: 'rare-rush-input-v1' }), /Unsupported replay schema/);
  const result = verifyReplay(seed, 1, replay);
  assert.equal(result.replayHash, keccak256(toHex(JSON.stringify(parseReplay(replay, 10800)))));
  assert.notEqual(result.replayHash, keccak256(toHex(JSON.stringify({ ...replay, version: 'rare-rush-input-v1' }))));
});

test('a lost run never produces a claim receipt', () => {
  assert.throws(() => verifyReplay(seed, 1, { version: PROTOCOL_VERSION, frames: [] }), /did not survive/);
});

test('rejects injected scores, state, malformed controls, duplicate and out-of-range ticks', () => {
  const frame = { tick: 0, jump: false, slide: false, pace: 0 };
  const input = (frames: unknown[]) => ({ version: PROTOCOL_VERSION, frames });
  for (const value of [null, [], { ...input([]), coins: 999 }, { ...input([]), seed }, { ...input([]), version: 'v0' }]) {
    assert.throws(() => parseReplay(value, 14400));
  }
  for (const frames of [
    [{ ...frame, hearts: 3 }], [{ ...frame, tick: -1 }], [{ ...frame, tick: 1.5 }],
    [{ ...frame, tick: 14400 }], [frame, frame], [{ ...frame, pace: 2 }], [{ ...frame, jump: 1 }],
    [{ ...frame, tick: 2 }, { ...frame, tick: 1 }], Array(14401).fill(frame),
  ]) assert.throws(() => parseReplay(input(frames), 14400));
});

test('rejects controls after a failed run and malformed seeds or modes', () => {
  assert.throws(() => verifyReplay(seed, 1, { version: PROTOCOL_VERSION, frames: [{ tick: 10799, jump: true, slide: false, pace: 0 }] }), /after the run ended/);
  assert.throws(() => verifyReplay('0x12', 1, { version: PROTOCOL_VERSION, frames: [] }), /seed/);
  assert.throws(() => verifyReplay(seed, 3, { version: PROTOCOL_VERSION, frames: [] }), /difficulty/);
});

test('real engine → verified receipt → onchain mint, and failed/fabricated runs are rejected', { skip: !process.env.RUSH_TEST_RPC }, async () => {
  const f = await localFixture();
  await f.write(f.rf, f.rfArtifact.abi, 'faucet');
  await f.write(f.generations, f.nftArtifact.abi, 'mint');
  await f.write(f.rf, f.rfArtifact.abi, 'approve', [f.game, 110n * 10n ** 18n]);
  await f.write(f.game, f.gameArtifact.abi, 'startRun', [0, 1n, 1]);
  const run = await f.read('runs', [1n]) as any;
  const frames = recordPilot(run[2], 1);
  const options = { client: f.client, chainId: 31337, game: f.game, runId: 1n, privateKey: f.verifierKey, confirmations: 0 };
  await assert.rejects(verifyAndSign({ ...options, replay: frames }), /unfinished/);
  await f.client.request({ method: 'evm_increaseTime' as any, params: [91] as any });
  await f.client.request({ method: 'evm_mine' as any });
  await assert.rejects(verifyAndSign({ ...options, replay: { version: PROTOCOL_VERSION, frames: [] } }), /did not survive/);
  await assert.rejects(verifyAndSign({ ...options, replay: { ...frames, coins: 999999 } }), /schema/);
  await assert.rejects(verifyAndSign({ ...options, replay: frames, chainId: 4663 }), /Only Robinhood/);
  const receipt = await verifyAndSign({ ...options, replay: frames });
  const expected = await f.read('quoteReward', [receipt.pickupKinds, 0, 1]);
  await f.write(f.game, f.gameArtifact.abi, 'claim', [1n, receipt.pickupKinds, receipt.replayHash, BigInt(receipt.deadline), receipt.signature]);
  const balance = await f.client.readContract({ address: f.token, abi: f.tokenArtifact.abi, functionName: 'balanceOf', args: [f.player.address] });
  assert.equal(balance, expected);
  assert.ok((balance as bigint) > 0n);
  assert.equal(await f.read('prizePoolBalance'), 100n * 10n ** 18n);
  assert.equal(await f.client.readContract({ address: f.rf, abi: f.rfArtifact.abi, functionName: 'balanceOf', args: [f.treasury.address] }), 10n * 10n ** 18n);
  await assert.rejects(verifyAndSign({ ...options, replay: frames }), /not claimable/);
});

test('verifier refuses a wrong signing identity or an engine version different from its local source', { skip: !process.env.RUSH_TEST_RPC }, async () => {
  const f = await localFixture();
  await f.write(f.genesis, f.nftArtifact.abi, 'mint');
  await f.write(f.game, f.gameArtifact.abi, 'startRun', [1, 1n, 1]);
  const run = await f.read('runs', [1n]) as any;
  const options = {
    client: f.client, chainId: 31337, game: f.game, runId: 1n,
    privateKey: f.verifierKey, confirmations: 0, replay: recordPilot(run[2], 1),
  };
  await f.client.request({ method: 'evm_increaseTime' as any, params: [91] as any });
  await f.client.request({ method: 'evm_mine' as any });
  const wrongKey = toHex(f.player.getHdKey().privateKey!);
  await assert.rejects(verifyAndSign({ ...options, privateKey: wrongKey }), /Verifier key does not match/);

  const differentEngine = keccak256(toHex('engine build not installed on this verifier'));
  const deployment = await f.mined(await f.wallet.deployContract({
    abi: f.gameArtifact.abi,
    bytecode: f.gameArtifact.bytecode,
    args: [f.player.address, f.verifier.address, f.treasury.address, f.rf, f.genesis, f.generations, differentEngine, f.launchAllocation],
  }));
  assert.ok(deployment.contractAddress);
  await assert.rejects(verifyAndSign({ ...options, game: deployment.contractAddress }), /Engine source differs/);
  assert.equal(await f.client.readContract({ address: f.token, abi: f.tokenArtifact.abi, functionName: 'totalSupply' }), f.launchAllocation);
});

test('verifier checks current NFT custody, pause, revocation and expiry before signing a valid replay', { skip: !process.env.RUSH_TEST_RPC }, async () => {
  const f = await localFixture();
  await f.write(f.genesis, f.nftArtifact.abi, 'mint');
  await f.write(f.game, f.gameArtifact.abi, 'startRun', [1, 1n, 1]);
  const run = await f.read('runs', [1n]) as any;
  const options = {
    client: f.client, chainId: 31337, game: f.game, runId: 1n,
    privateKey: f.verifierKey, confirmations: 0, replay: recordPilot(run[2], 1),
  };
  await f.client.request({ method: 'evm_increaseTime' as any, params: [91] as any });
  await f.client.request({ method: 'evm_mine' as any });
  // Establish that this exact replay can be signed before independently changing
  // each onchain guard; none of these failures depend on a losing replay.
  const receipt = await verifyAndSign(options);
  assert.ok(receipt.coins > 0);
  const mutations: Array<{ apply: () => Promise<unknown>; error: RegExp }> = [
    {
      apply: () => f.write(f.genesis, f.nftArtifact.abi, 'transferFrom', [f.player.address, f.verifier.address, 1n]),
      error: /no longer owns/,
    },
    { apply: () => f.write(f.game, f.gameArtifact.abi, 'pause'), error: /not claimable/ },
    // Rotating to the same signer invalidates existing run epochs without changing keys.
    { apply: () => f.write(f.game, f.gameArtifact.abi, 'setVerifier', [f.verifier.address]), error: /not claimable/ },
    { apply: () => f.write(f.game, f.gameArtifact.abi, 'abandonRun', [1n]), error: /not claimable/ },
    {
      apply: async () => {
        await f.client.request({ method: 'evm_increaseTime' as any, params: [901] as any });
        await f.client.request({ method: 'evm_mine' as any });
      },
      error: /claim window expired/,
    },
  ];
  for (const mutation of mutations) {
    const snapshot = await f.client.request({ method: 'evm_snapshot' as any });
    try {
      await mutation.apply();
      await assert.rejects(verifyAndSign(options), mutation.error);
    } finally {
      assert.equal(await f.client.request({ method: 'evm_revert' as any, params: [snapshot] as any }), true);
    }
  }
});

test('public-testnet verification rejects zero or one confirmation before reading or signing a run', async () => {
  // This is a guard-only client, not a public RPC or a simulated testnet deployment.
  // If verification proceeds past the depth check the test must fail immediately.
  const client = {
    getChainId: async () => 46630,
    getBlockNumber: async () => assert.fail('Unsafe confirmation depth reached a chain read'),
  };
  const address = '0x0000000000000000000000000000000000000001';
  for (const confirmations of [0, 1, -1, 1.5, Number.NaN, 65]) {
    await assert.rejects(verifyAndSign({
      client, chainId: 46630, game: address, runId: 1n,
      privateKey: `0x${'01'.repeat(32)}`, confirmations,
      replay: { version: PROTOCOL_VERSION, frames: [] },
    }), /Invalid confirmation depth/);
  }
});
