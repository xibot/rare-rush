import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, beforeEach, describe, it } from 'node:test';
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  http,
  keccak256,
  parseEther,
  stringToHex,
  toHex,
  zeroAddress,
  zeroHash,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { currentEngineVersion } from '../src/engine-version.ts';

// These are Hardhat's publicly documented, disposable local accounts. Never use
// these accounts, this mnemonic, or this test signer on a public network.
const mnemonic = 'test test test test test test test test test test test junk';
const verifier = mnemonicToAccount(mnemonic, { addressIndex: 1 });
const rotatedVerifier = mnemonicToAccount(mnemonic, { addressIndex: 4 });
const chain = defineChain({
  id: 31337,
  name: 'Rare Rush local contract tests',
  nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [process.env.RUSH_TEST_RPC ?? 'http://127.0.0.1:18545'] } },
});
const transport = http(chain.rpcUrls.default.http[0]);
const publicClient = createPublicClient({ chain, transport });
const wallet = createWalletClient({ chain, transport });
const artifactCache = new Map();
const digest = (value) => keccak256(stringToHex(value));

async function artifact(name) {
  if (!artifactCache.has(name)) {
    artifactCache.set(name, JSON.parse(await readFile(new URL(`../artifacts/${name}.json`, import.meta.url), 'utf8')));
  }
  return artifactCache.get(name);
}

async function deployed(name, args, account) {
  const { abi, bytecode } = await artifact(name);
  const hash = await wallet.deployContract({ abi, bytecode, args, account });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success', `${name} deployment must succeed`);
  assert.ok(receipt.contractAddress);
  return { address: receipt.contractAddress, abi };
}

async function read(contract, functionName, args = []) {
  return publicClient.readContract({ ...contract, functionName, args });
}

async function send(contract, functionName, args, account) {
  const { request } = await publicClient.simulateContract({ ...contract, functionName, args, account });
  const hash = await wallet.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success', `${functionName} transaction must succeed`);
  return receipt;
}

async function reverts(contract, functionName, args, account, expectedError) {
  await assert.rejects(
    publicClient.simulateContract({ ...contract, functionName, args, account }),
    (error) => {
      const decoded = error.walk?.((cause) => cause?.data?.errorName)?.data?.errorName;
      assert.equal(decoded, expectedError, error.shortMessage ?? error.message);
      return true;
    },
    `${functionName} should revert with ${expectedError}`,
  );
}

async function revertedTransaction(contract, functionName, args, account, expectedError) {
  await reverts(contract, functionName, args, account, expectedError);
  // Submit with explicit gas so the node actually executes and rolls back the
  // transaction; a rejected simulation alone cannot prove state rollback.
  const before = await publicClient.getBlock({ blockTag: 'latest' });
  let hash;
  try {
    hash = await wallet.writeContract({ ...contract, functionName, args, account, gas: 1_000_000n });
  } catch (error) {
    // Hardhat reports mined reverts as RPC errors. Recover that newly mined
    // transaction from its block, then require a real failed receipt below.
    const decoded = error.walk?.((cause) => cause?.data?.errorName)?.data?.errorName;
    assert.equal(decoded, expectedError, error.shortMessage ?? error.message);
    const block = await publicClient.getBlock({ blockTag: 'latest', includeTransactions: true });
    assert.equal(block.number, before.number + 1n, 'Failure must be a mined transaction');
    const transaction = block.transactions.find((tx) => tx.from.toLowerCase() === account.toLowerCase() && tx.to?.toLowerCase() === contract.address.toLowerCase());
    assert.ok(transaction, 'Failed entry transaction must be present in the new block');
    hash = transaction.hash;
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'reverted', `${functionName} must revert onchain`);
}

async function advance(seconds) {
  await publicClient.request({ method: 'evm_increaseTime', params: [Number(seconds)] });
  await publicClient.request({ method: 'evm_mine', params: [] });
}

async function now() {
  return (await publicClient.getBlock()).timestamp;
}

function event(receipt, contract, name) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contract.address.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: contract.abi, data: log.data, topics: log.topics });
      if (decoded.eventName === name) return decoded.args;
    } catch { /* Another contract's event may share this transaction. */ }
  }
  assert.fail(`Missing ${name} event`);
}

const engineVersion = digest('rare-rush-local-engine-v1');
const launchAllocation = 102_400_000n * 1_000_000n;
const types = {
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
};
let f;
let snapshot;

async function start(collection = 0, difficulty = 1, tokenId = 1n, player = f.player, game = f.game) {
  const receipt = await send(game, 'startRun', [collection, tokenId, difficulty], player);
  return event(receipt, game, 'RunStarted');
}

async function signed(run, pickups = '0x00', options = {}) {
  const game = options.game ?? f.game;
  const replayHash = options.replayHash ?? digest(`replay-${run.runId}`);
  const deadline = options.deadline ?? run.claimUntil;
  const storedRun = await read(game, 'runs', [run.runId]);
  const signature = await (options.signer ?? verifier).signTypedData({
    domain: {
      name: 'RareRushTestnet', version: '1', chainId: chain.id,
      verifyingContract: game.address, ...options.domain,
    },
    types,
    primaryType: 'RunResult',
    message: {
      runId: run.runId, player: run.player, runSeed: storedRun[2], pickupKindsHash: keccak256(pickups),
      replayHash, engineVersion, deadline, verifierEpoch: run.verifierEpoch,
      ...options.message,
    },
  });
  return [run.runId, pickups, replayHash, deadline, signature];
}

async function finish(run, pickups = '0x00', options = {}) {
  const duration = [120, 90, 60][run.difficulty];
  await advance(duration);
  const args = await signed(run, pickups, options);
  const receipt = await send(options.game ?? f.game, 'claim', args, run.player);
  return event(receipt, options.game ?? f.game, 'RunClaimed');
}

before(async () => {
  const actualChainId = await publicClient.getChainId();
  assert.equal(actualChainId, 31337, 'Contract tests only run on the disposable local chain');
  const [owner, , player, other, , treasury] = await wallet.getAddresses();
  const rf = await deployed('TestRF', [], owner);
  const genesis = await deployed('TestFriends', [true], owner);
  const generations = await deployed('TestFriends', [false], owner);
  const game = await deployed('RareRushGame', [owner, verifier.address, treasury, rf.address, genesis.address, generations.address, engineVersion, launchAllocation], owner);
  const token = await deployed('RareRushToken', [owner, owner, game.address, launchAllocation], owner);
  await send(game, 'bindRewardToken', [token.address], owner);
  f = { owner, player, other, treasury, rf, genesis, generations, game, token };
  for (const playerAccount of [player, other]) {
    await send(rf, 'faucet', [], playerAccount);
    await send(rf, 'approve', [game.address, parseEther('10000')], playerAccount);
    await send(generations, 'mint', [], playerAccount);
    await send(genesis, 'mint', [], playerAccount);
  }
  // Avoid a midnight rollover during the daily-limit tests.
  const nextDay = ((await now()) / 86_400n + 1n) * 86_400n + 3_600n;
  await publicClient.request({ method: 'evm_setNextBlockTimestamp', params: [Number(nextDay)] });
  await publicClient.request({ method: 'evm_mine', params: [] });
  snapshot = await publicClient.request({ method: 'evm_snapshot', params: [] });
});

beforeEach(async () => {
  assert.equal(await publicClient.request({ method: 'evm_revert', params: [snapshot] }), true);
  snapshot = await publicClient.request({ method: 'evm_snapshot', params: [] });
});

async function unboundGame(allocation = launchAllocation) {
  return deployed('RareRushGame', [f.owner, verifier.address, f.treasury, f.rf.address, f.genesis.address, f.generations.address, engineVersion, allocation], f.owner);
}

describe('V2 deployment with reused test assets', () => {
  it('binds a fresh game/token to V2 while preserving V1 state and rejecting V1 signatures', async () => {
    const v1Run = await start();
    const rfBalance = await read(f.rf, 'balanceOf', [f.player]);
    const nftCount = await read(f.generations, 'nextTokenId');
    const v2Version = await currentEngineVersion();
    assert.notEqual(v2Version, engineVersion);
    const game = await deployed('RareRushGame', [f.owner, verifier.address, f.treasury,
      f.rf.address, f.genesis.address, f.generations.address, v2Version, launchAllocation], f.owner);
    await reverts(game, 'bindRewardToken', [f.token.address], f.owner, 'InvalidRewardToken');
    const token = await deployed('RareRushToken', [f.owner, f.owner, game.address, launchAllocation], f.owner);
    await send(game, 'bindRewardToken', [token.address], f.owner);
    assert.equal(await read(game, 'engineVersion'), v2Version);
    assert.equal(await read(game, 'MAX_PICKUPS'), 512n);
    assert.equal(await read(f.game, 'engineVersion'), engineVersion);
    assert.equal(await read(f.game, 'runCount'), 1n);
    assert.equal((await read(f.game, 'token')).toLowerCase(), f.token.address.toLowerCase());
    assert.equal((await read(token, 'rewardMinter')).toLowerCase(), game.address.toLowerCase());
    assert.equal(await read(f.rf, 'balanceOf', [f.player]), rfBalance);
    assert.equal(await read(f.generations, 'nextTokenId'), nftCount);
    assert.equal((await read(f.generations, 'ownerOf', [1n])).toLowerCase(), f.player.toLowerCase());
    await send(f.rf, 'approve', [game.address, parseEther('110')], f.player);
    const run = await start(0, 1, 1n, f.player, game);
    await advance(90);
    await reverts(game, 'claim', await signed(run, '0x00', { game }), f.player, 'InvalidVerifierSignature');
    await send(game, 'claim', await signed(run, '0x00', { game, message: { engineVersion: v2Version } }), f.player);
    assert.equal(await read(token, 'balanceOf', [f.player]), 10_000_000n);
    assert.equal(await read(f.token, 'balanceOf', [f.player]), 0n);
    // The old game's pending run is still independently claimable.
    await send(f.game, 'claim', await signed(v1Run), f.player);
    assert.equal(await read(f.token, 'balanceOf', [f.player]), 10_000_000n);
  });
});

describe('external capped reward token binding', () => {
  it('uses the same source implementation validated by the Doppler proof', async () => {
    const compiled = await artifact('RareRushToken');
    const sharedSource = await readFile(new URL('../../doppler/contracts/RareRushDopplerPrototype.sol', import.meta.url), 'utf8');
    assert.equal(compiled.metadata.sources['doppler/contracts/RareRushDopplerPrototype.sol'].keccak256, keccak256(stringToHex(sharedSource)));
    assert.equal(await read(f.token, 'name'), 'Rare Rush Testnet');
    assert.equal(await read(f.token, 'launchAllocation'), launchAllocation);
    assert.equal(await read(f.token, 'rewardAllocation'), 921_600_000n * 1_000_000n);
    assert.equal(await read(f.token, 'totalSupply'), launchAllocation);
    assert.equal(await read(f.token, 'rewardsMinted'), 0n);
  });

  it('blocks starts, reward quotes and claims until its separate token is bound', async () => {
    const game = await unboundGame();
    assert.equal(await read(game, 'token'), zeroAddress);
    for (const collection of [0, 1]) {
      await reverts(game, 'startRun', [collection, 1n, 1], f.player, 'RewardTokenNotBound');
    }
    await reverts(game, 'quoteReward', ['0x00', 0, 1], f.player, 'RewardTokenNotBound');
    await reverts(game, 'claim', [1n, '0x00', digest('unbound'), 1n, '0x'], f.player, 'RewardTokenNotBound');
    assert.equal(await read(game, 'runCount'), 0n);
    assert.equal(await read(game, 'prizePoolBalance'), 0n);
    assert.equal(await read(f.rf, 'balanceOf', [f.player]), parseEther('1100'));
  });

  it('allows only the owner to bind once and never to replace the token', async () => {
    const game = await unboundGame();
    const token = await deployed('RareRushToken', [f.owner, f.owner, game.address, launchAllocation], f.owner);
    await reverts(game, 'bindRewardToken', [token.address], f.player, 'OwnableUnauthorizedAccount');
    await reverts(game, 'bindRewardToken', [zeroAddress], f.owner, 'InvalidAddress');
    await reverts(game, 'bindRewardToken', [f.player], f.owner, 'ContractRequired');
    const receipt = await send(game, 'bindRewardToken', [token.address], f.owner);
    const bound = event(receipt, game, 'RewardTokenBound');
    assert.equal(bound.token.toLowerCase(), token.address.toLowerCase());
    assert.equal(bound.launchAllocation, launchAllocation);
    assert.equal(bound.rewardAllocation, 921_600_000n * 1_000_000n);
    await reverts(game, 'bindRewardToken', [token.address], f.owner, 'RewardTokenAlreadyBound');
    await reverts(game, 'bindRewardToken', [f.token.address], f.owner, 'RewardTokenAlreadyBound');
    await start(1, 1, 1n, f.player, game);
  });

  it('rejects every incorrect token configuration without consuming the binding slot', async () => {
    const game = await unboundGame();
    const cap = 1_024_000_000n * 1_000_000n;
    const valid = [cap, 6, game.address, launchAllocation, cap - launchAllocation, 0n, launchAllocation];
    const wrongValues = [cap + 1n, 18, f.game.address, launchAllocation - 1n, cap - launchAllocation - 1n, 1n, launchAllocation + 1n];
    for (const [index, value] of wrongValues.entries()) {
      const args = [...valid];
      args[index] = value;
      const candidate = await deployed('BindingCandidate', args, f.owner);
      await reverts(game, 'bindRewardToken', [candidate.address], f.owner, 'InvalidRewardToken');
      assert.equal(await read(game, 'token'), zeroAddress);
    }
    // Real tokens tied to another game or with the wrong launch reserve also fail.
    await reverts(game, 'bindRewardToken', [f.token.address], f.owner, 'InvalidRewardToken');
    const wrongAllocation = await deployed('RareRushToken', [f.owner, f.owner, game.address, launchAllocation - 1n], f.owner);
    await reverts(game, 'bindRewardToken', [wrongAllocation.address], f.owner, 'InvalidRewardToken');
    const fresh = await deployed('RareRushToken', [f.owner, f.owner, game.address, launchAllocation], f.owner);
    await send(game, 'bindRewardToken', [fresh.address], f.owner);
  });

  it('rejects an already-used token even when its immutable game and allocation match', async () => {
    const game = await unboundGame();
    const token = await deployed('RareRushToken', [f.owner, f.owner, game.address, launchAllocation], f.owner);
    await publicClient.request({ method: 'hardhat_impersonateAccount', params: [game.address] });
    await publicClient.request({ method: 'hardhat_setBalance', params: [game.address, toHex(parseEther('1'))] });
    try { await send(token, 'mintReward', [f.player, 1n], game.address); }
    finally { await publicClient.request({ method: 'hardhat_stopImpersonatingAccount', params: [game.address] }); }
    await reverts(game, 'bindRewardToken', [token.address], f.owner, 'InvalidRewardToken');
    assert.equal(await read(game, 'token'), zeroAddress);
  });

  it('requires a nonzero launch reserve smaller than the cap at game construction', async () => {
    for (const allocation of [0n, 1_024_000_000n * 1_000_000n, 1_024_000_000n * 1_000_000n + 1n]) {
      await assert.rejects(unboundGame(allocation), error => {
        const selector = error.details?.match(/return data: (0x[0-9a-f]{8})/i)?.[1];
        assert.equal(selector, digest('InvalidLaunchAllocation()').slice(0, 10), error.shortMessage);
        return true;
      });
    }
  });
});

describe('test economy and custody', () => {
  it('charges Generations 110 tRF, sends 100 to the prize pool and 10 to the separate treasury', async () => {
    assert.notEqual(f.treasury.toLowerCase(), f.owner.toLowerCase());
    assert.notEqual(f.treasury.toLowerCase(), f.player.toLowerCase());
    const receipt = await send(f.game, 'startRun', [0, 1n, 1], f.player);
    const run = event(receipt, f.game, 'RunStarted');
    const fee = event(receipt, f.game, 'EntryFeePaid');
    assert.equal(fee.runId, run.runId);
    assert.equal(fee.totalFee, parseEther('110'));
    assert.equal(fee.prizePoolShare, parseEther('100'));
    assert.equal(fee.treasuryShare, parseEther('10'));
    assert.equal(fee.treasury.toLowerCase(), f.treasury.toLowerCase());
    assert.equal(await read(f.rf, 'balanceOf', [f.player]), parseEther('990'));
    assert.equal(await read(f.rf, 'balanceOf', [f.game.address]), parseEther('100'));
    assert.equal(await read(f.rf, 'balanceOf', [f.treasury]), parseEther('10'));
    assert.equal(await read(f.game, 'prizePoolBalance'), parseEther('100'));
    assert.equal(await read(f.game, 'ENTRY_FEE'), parseEther('110'));
    assert.equal(await read(f.game, 'PRIZE_POOL_SHARE'), parseEther('100'));
    assert.equal(await read(f.game, 'TREASURY_SHARE'), parseEther('10'));
    assert.equal(run.player.toLowerCase(), f.player.toLowerCase());
    assert.equal(run.collection, 0);
    assert.equal(run.difficulty, 1);
    assert.notEqual(run.seed, zeroHash);
    assert.equal(run.claimUntil - run.startedAt, 990n);
    const key = await read(f.game, 'nftKey', [0, 1n]);
    assert.equal(await read(f.game, 'dailyStarts', [key, run.startedAt / 86_400n]), 1n);
    assert.equal(await read(f.game, 'activeRunByNft', [key]), run.runId);
  });

  it('gives Genesis free entry and a 100x reward on top of the difficulty and bonus multipliers', async () => {
    const run = await start(1, 2);
    const result = await finish(run, '0x0001');
    assert.equal(result.reward, 22_000n * 1_000_000n);
    assert.equal(await read(f.token, 'balanceOf', [f.player]), result.reward);
    assert.equal(await read(f.rf, 'balanceOf', [f.player]), parseEther('1100'));
    assert.equal(await read(f.rf, 'balanceOf', [f.game.address]), 0n);
    assert.equal(await read(f.rf, 'balanceOf', [f.treasury]), 0n);
    assert.equal(await read(f.game, 'prizePoolBalance'), 0n);
    assert.equal(await read(f.token, 'decimals'), 6);
    assert.equal(await read(f.token, 'symbol'), 'tRARERUSH');
  });

  it('computes Easy, Normal and Degen rewards from ordinary and 10x coins', async () => {
    for (const [difficulty, expected] of [[0, 90_000_000n], [1, 120_000_000n], [2, 240_000_000n]]) {
      const result = await finish(await start(0, difficulty), '0x000100');
      assert.equal(result.reward, expected);
      assert.equal(result.pickups, 3n);
    }
    assert.equal(await read(f.token, 'balanceOf', [f.player]), 450_000_000n);
    assert.equal(await read(f.game, 'claimedPickups'), 9n);
  });

  it('halves the global reward across a pickup boundary, including inside one claim', async () => {
    for (let i = 0; i < 19; i++) {
      if (i > 0 && i % 3 === 0) {
        await advance(86_400);
        await send(f.rf, 'faucet', [], f.player);
      }
      await finish(await start(), `0x${'00'.repeat(512)}`);
    }
    assert.equal(await read(f.game, 'claimedPickups'), 9_728n);
    const result = await finish(await start(), `0x${'00'.repeat(280)}`);
    assert.equal(result.reward, 272n * 10_000_000n + 8n * 5_000_000n);
    assert.equal(await read(f.game, 'quoteReward', ['0x0001', 0, 1]), 55_000_000n);
    assert.equal(await read(f.game, 'claimedPickups'), 10_008n);
  });

  it('reaches the provisional one-token floor through real claims and preserves multipliers', async () => {
    // Exercise all four halvings through normal signed claims; no storage or reward-rate overrides.
    for (let i = 0; i < 78; i++) {
      if (i > 0 && i % 3 === 0) await advance(86_400);
      await finish(await start(1, 1), `0x${'00'.repeat(512)}`);
    }
    assert.equal(await read(f.game, 'claimedPickups'), 39_936n);
    await advance(86_400);
    const boundary = await finish(await start(1, 1), `0x${'00'.repeat(72)}`);
    assert.equal(boundary.reward, (64n * 1_250_000n + 8n * 1_000_000n) * 100n);
    assert.equal(await read(f.game, 'MIN_COIN_REWARD'), 1_000_000n);
    assert.equal(await read(f.game, 'quoteReward', ['0x00', 0, 1]), 1_000_000n);
    assert.equal(await read(f.game, 'quoteReward', ['0x00', 0, 0]), 750_000n);
    assert.equal(await read(f.game, 'quoteReward', ['0x01', 1, 2]), 2_000_000_000n);
    const floored = await finish(await start(0, 1), '0x0001');
    assert.equal(floored.reward, 11_000_000n);
  });

  it('clips rewards at the shared cap and never mints above it across claims', async () => {
    const cap = await read(f.token, 'CAP');
    assert.equal(cap, 1_024_000_000n * 1_000_000n);
    // Local-only boundary fixture: impersonate the authorized game minter to
    // approach the cap without spending hundreds of millions of gameplay pickups.
    // This uses the real mint guard, without altering contract storage or rates.
    await publicClient.request({ method: 'hardhat_impersonateAccount', params: [f.game.address] });
    await publicClient.request({ method: 'hardhat_setBalance', params: [f.game.address, toHex(parseEther('1'))] });
    try {
      await send(f.token, 'mintReward', [f.other, cap - launchAllocation - 25_000n * 1_000_000n], f.game.address);
    } finally {
      await publicClient.request({ method: 'hardhat_stopImpersonatingAccount', params: [f.game.address] });
    }
    const first = await finish(await start(1, 2), '0x01');
    assert.equal(first.reward, 20_000n * 1_000_000n);
    const second = await finish(await start(1, 2), '0x01');
    assert.equal(second.reward, 5_000n * 1_000_000n);
    const third = await finish(await start(1, 2), '0x01');
    assert.equal(third.reward, 0n);
    assert.equal(await read(f.token, 'totalSupply'), cap);
    assert.equal(await read(f.token, 'rewardsMinted'), cap - launchAllocation);
    assert.equal(await read(f.token, 'balanceOf', [f.owner]), launchAllocation);
    assert.equal(await read(f.token, 'balanceOf', [f.player]), 25_000n * 1_000_000n);
    assert.equal(await read(f.game, 'claimedPickups'), 3n);
  });

  it('lets only the game mint and independently enforces the token cap', async () => {
    await reverts(f.token, 'mintReward', [f.player, 1n], f.owner, 'OnlyRewardMinter');
    await reverts(f.token, 'mintReward', [f.player, 1n], f.player, 'OnlyRewardMinter');
    // Token ownership controls the migration lock, never reward minting.
    await send(f.token, 'transferOwnership', [f.other], f.owner);
    await reverts(f.token, 'mintReward', [f.player, 1n], f.other, 'OnlyRewardMinter');
    assert.equal((await read(f.token, 'rewardMinter')).toLowerCase(), f.game.address.toLowerCase());
    const cap = await read(f.token, 'CAP');
    assert.equal(cap, 1_024_000_000n * 1_000_000n);
    await publicClient.request({ method: 'hardhat_impersonateAccount', params: [f.game.address] });
    await publicClient.request({ method: 'hardhat_setBalance', params: [f.game.address, toHex(parseEther('1'))] });
    try {
      await send(f.token, 'mintReward', [f.player, cap - launchAllocation], f.game.address);
      await reverts(f.token, 'mintReward', [f.player, 1n], f.game.address, 'RewardAllocationExceeded');
    } finally {
      await publicClient.request({ method: 'hardhat_stopImpersonatingAccount', params: [f.game.address] });
    }
    assert.equal(await read(f.token, 'totalSupply'), cap);
  });

  it('requires all 110 tRF of allowance and reverts without charging or consuming an attempt', async () => {
    // Approval for the pool's 100 alone must not authorize the full entry.
    await send(f.rf, 'approve', [f.game.address, parseEther('100')], f.player);
    await revertedTransaction({ ...f.game, abi: [...f.game.abi, ...f.rf.abi] }, 'startRun', [0, 1n, 1], f.player, 'ERC20InsufficientAllowance');
    const key = await read(f.game, 'nftKey', [0, 1n]);
    assert.equal(await read(f.game, 'runCount'), 0n);
    assert.equal(await read(f.game, 'dailyStarts', [key, (await now()) / 86_400n]), 0n);
    assert.equal(await read(f.game, 'activeRunByNft', [key]), 0n);
    assert.equal(await read(f.game, 'prizePoolBalance'), 0n);
    assert.equal(await read(f.rf, 'balanceOf', [f.player]), parseEther('1100'));
    assert.equal(await read(f.rf, 'balanceOf', [f.game.address]), 0n);
    assert.equal(await read(f.rf, 'balanceOf', [f.treasury]), 0n);
    assert.equal(await read(f.rf, 'allowance', [f.player, f.game.address]), parseEther('100'));
  });

  it('requires all 110 tRF of balance and leaves fee, allowance and daily accounting unchanged on failure', async () => {
    await send(f.rf, 'transfer', [f.other, parseEther('991')], f.player);
    await send(f.rf, 'approve', [f.game.address, parseEther('110')], f.player);
    await revertedTransaction({ ...f.game, abi: [...f.game.abi, ...f.rf.abi] }, 'startRun', [0, 1n, 1], f.player, 'ERC20InsufficientBalance');
    const key = await read(f.game, 'nftKey', [0, 1n]);
    assert.equal(await read(f.game, 'runCount'), 0n);
    assert.equal(await read(f.game, 'dailyStarts', [key, (await now()) / 86_400n]), 0n);
    assert.equal(await read(f.game, 'activeRunByNft', [key]), 0n);
    assert.equal(await read(f.game, 'prizePoolBalance'), 0n);
    assert.equal(await read(f.rf, 'balanceOf', [f.player]), parseEther('109'));
    assert.equal(await read(f.rf, 'balanceOf', [f.game.address]), 0n);
    assert.equal(await read(f.rf, 'balanceOf', [f.treasury]), 0n);
    assert.equal(await read(f.rf, 'allowance', [f.player, f.game.address]), parseEther('110'));
  });
});

describe('NFT eligibility and run lifecycle', () => {
  it('checks current NFT ownership, collection, difficulty and hardwired generation before charging', async () => {
    await reverts(f.game, 'startRun', [0, 1n, 1], f.other, 'NotNftOwner');
    await reverts(f.game, 'startRun', [1, 1n, 1], f.other, 'NotNftOwner');
    await reverts(f.game, 'startRun', [2, 1n, 1], f.player, 'InvalidCollection');
    await reverts(f.game, 'startRun', [0, 1n, 3], f.player, 'InvalidDifficulty');
    const mismatch = await deployed('RareRushGame', [f.owner, verifier.address, f.treasury, f.rf.address, f.genesis.address, f.genesis.address, engineVersion, launchAllocation], f.owner);
    const mismatchToken = await deployed('RareRushToken', [f.owner, f.owner, mismatch.address, launchAllocation], f.owner);
    await send(mismatch, 'bindRewardToken', [mismatchToken.address], f.owner);
    await reverts(mismatch, 'startRun', [0, 1n, 1], f.player, 'NotHardwiredGenerations');
    assert.equal(await read(f.game, 'runCount'), 0n);
  });

  it('prevents parallel runs with one NFT and allows abandonment without refunding or resetting its attempt', async () => {
    const run = await start();
    await reverts(f.game, 'startRun', [0, 1n, 2], f.player, 'NftRunActive');
    await reverts(f.game, 'abandonRun', [run.runId], f.other, 'NotRunPlayer');
    await send(f.game, 'abandonRun', [run.runId], f.player);
    await reverts(f.game, 'abandonRun', [run.runId], f.player, 'RunFinalized');
    await advance(90);
    await reverts(f.game, 'claim', await signed(run), f.player, 'RunFinalized');
    await start();
    assert.equal(await read(f.game, 'prizePoolBalance'), parseEther('200'));
    assert.equal(await read(f.rf, 'balanceOf', [f.treasury]), parseEther('20'));
    const key = await read(f.game, 'nftKey', [0, 1n]);
    assert.equal(await read(f.game, 'dailyStarts', [key, run.startedAt / 86_400n]), 2n);
  });

  it('limits starts to three per NFT per UTC day, survives transfers, and resets the next day', async () => {
    for (let i = 0; i < 3; i++) {
      const run = await start();
      await send(f.game, 'abandonRun', [run.runId], f.player);
    }
    await reverts(f.game, 'startRun', [0, 1n, 1], f.player, 'DailyRunLimitReached');
    await send(f.generations, 'transferFrom', [f.player, f.other, 1n], f.player);
    await reverts(f.game, 'startRun', [0, 1n, 1], f.other, 'DailyRunLimitReached');
    // Another NFT owned by the same wallet retains its independent allowance.
    await start(0, 1, 2n, f.other);
    // Genesis ID 1 has a distinct collection key from Generations ID 1.
    await start(1, 1, 1n, f.player);
    await advance(86_400);
    const next = await start(0, 1, 1n, f.other);
    assert.equal(next.player.toLowerCase(), f.other.toLowerCase());
  });

  it('blocks a transferred NFT from claiming and blocks its new owner from stealing the existing run', async () => {
    const run = await start();
    const args = await signed(run);
    await send(f.generations, 'transferFrom', [f.player, f.other, 1n], f.player);
    await advance(90);
    await reverts(f.game, 'claim', args, f.player, 'NotNftOwner');
    await reverts(f.game, 'claim', args, f.other, 'NotRunPlayer');
    await reverts(f.game, 'startRun', [0, 1n, 1], f.other, 'NftRunActive');
    await send(f.game, 'abandonRun', [run.runId], f.player);
    await start(0, 1, 1n, f.other);
  });

  it('releases an expired run slot without letting an old run clear the new one', async () => {
    const expired = await start();
    await advance(991);
    const current = await start();
    await send(f.game, 'abandonRun', [expired.runId], f.player);
    const key = await read(f.game, 'nftKey', [0, 1n]);
    assert.equal(await read(f.game, 'activeRunByNft', [key]), current.runId);
    await reverts(f.game, 'startRun', [0, 1n, 1], f.player, 'NftRunActive');
  });
});

describe('signed receipt authorization', () => {
  it('rejects early, expired, unknown and replayed claims, then mints exactly once', async () => {
    const run = await start();
    const args = await signed(run);
    await reverts(f.game, 'claim', [999n, ...args.slice(1)], f.player, 'UnknownRun');
    await reverts(f.game, 'claim', args, f.player, 'RunNotFinished');
    await advance(90);
    await reverts(f.game, 'claim', await signed(run, '0x00', { deadline: 0n }), f.player, 'InvalidDeadline');
    await reverts(f.game, 'claim', await signed(run, '0x00', { deadline: run.claimUntil + 1n }), f.player, 'InvalidDeadline');
    await reverts(f.game, 'claim', await signed(run, '0x00', { deadline: run.startedAt + 1n }), f.player, 'ClaimExpired');
    await send(f.game, 'claim', args, f.player);
    await reverts(f.game, 'claim', args, f.player, 'RunFinalized');
    assert.equal(await read(f.token, 'balanceOf', [f.player]), 10_000_000n);
    const key = await read(f.game, 'nftKey', [0, 1n]);
    assert.equal(await read(f.game, 'activeRunByNft', [key]), 0n);
  });

  it('rejects a late receipt even when signed by the real verifier', async () => {
    const run = await start();
    await advance(991);
    await reverts(f.game, 'claim', await signed(run), f.player, 'ClaimExpired');
    assert.equal(await read(f.token, 'totalSupply'), launchAllocation);
  });

  it('binds the signature to verifier, chain, contract, player, engine, run, seed, deadline and ordered pickups', async () => {
    const run = await start();
    await advance(90);
    const badSignatures = [
      { signer: rotatedVerifier },
      { domain: { chainId: 46630 } },
      { domain: { verifyingContract: f.other } },
      { message: { player: f.other } },
      // A receipt for a run from a reorganized fork cannot authorize the replacement run.
      { message: { runSeed: digest('same-run-id-other-fork-seed') } },
      { message: { engineVersion: digest('other-engine') } },
      { message: { runId: run.runId + 1n } },
      { message: { deadline: run.claimUntil - 1n } },
      { message: { pickupKindsHash: keccak256('0x0001') } },
      { message: { replayHash: digest('other-replay') } },
      { message: { verifierEpoch: run.verifierEpoch + 1n } },
    ];
    for (const options of badSignatures) {
      await reverts(f.game, 'claim', await signed(run, '0x0100', options), f.player, 'InvalidVerifierSignature');
    }
    const valid = await signed(run, '0x0100');
    await reverts(f.game, 'claim', [valid[0], '0x0101', ...valid.slice(2)], f.player, 'InvalidVerifierSignature');
    await reverts(f.game, 'claim', [valid[0], valid[1], digest('tampered-replay'), ...valid.slice(3)], f.player, 'InvalidVerifierSignature');
    await reverts(f.game, 'claim', valid, f.other, 'NotRunPlayer');
    assert.equal(await read(f.token, 'totalSupply'), launchAllocation);
    await send(f.game, 'claim', valid, f.player);
    assert.equal(await read(f.token, 'balanceOf', [f.player]), 110_000_000n);
  });

  it('validates pickup kinds and replay hashes even for a trusted signer', async () => {
    const run = await start();
    await advance(90);
    await reverts(f.game, 'claim', await signed(run, '0x02'), f.player, 'InvalidPickupKind');
    await reverts(f.game, 'claim', await signed(run, `0x${'00'.repeat(513)}`), f.player, 'TooManyPickups');
    await reverts(f.game, 'claim', await signed(run, '0x00', { replayHash: zeroHash }), f.player, 'InvalidReplayHash');
    assert.equal(await read(f.game, 'claimedPickups'), 0n);
    assert.equal(await read(f.token, 'totalSupply'), launchAllocation);
  });
});

describe('administration and emergency controls', () => {
  it('restricts pausing and blocks starts, claims and payouts while allowing abandonment', async () => {
    const run = await start();
    await advance(90);
    await reverts(f.game, 'pause', [], f.player, 'OwnableUnauthorizedAccount');
    await send(f.game, 'pause', [], f.owner);
    await reverts(f.game, 'startRun', [1, 1n, 1], f.player, 'EnforcedPause');
    await reverts(f.game, 'claim', await signed(run), f.player, 'EnforcedPause');
    await reverts(f.game, 'awardPrize', [digest('paused-prize'), f.player, 1n], f.owner, 'EnforcedPause');
    await send(f.game, 'abandonRun', [run.runId], f.player);
    await reverts(f.game, 'unpause', [], f.other, 'OwnableUnauthorizedAccount');
    await send(f.game, 'unpause', [], f.owner);
    await start();
  });

  it('rotates verifier authority, revokes old epochs and only accepts new receipts on new runs', async () => {
    const old = await start();
    await reverts(f.game, 'setVerifier', [rotatedVerifier.address], f.other, 'OwnableUnauthorizedAccount');
    await reverts(f.game, 'setVerifier', [zeroAddress], f.owner, 'InvalidAddress');
    await send(f.game, 'setVerifier', [rotatedVerifier.address], f.owner);
    await advance(90);
    await reverts(f.game, 'claim', await signed(old), f.player, 'InvalidVerifierEpoch');
    await reverts(f.game, 'claim', await signed(old, '0x00', { signer: rotatedVerifier }), f.player, 'InvalidVerifierEpoch');
    await send(f.game, 'abandonRun', [old.runId], f.player);
    const current = await start();
    await advance(90);
    await reverts(f.game, 'claim', await signed(current), f.player, 'InvalidVerifierSignature');
    await send(f.game, 'claim', await signed(current, '0x00', { signer: rotatedVerifier }), f.player);
    assert.equal(await read(f.token, 'balanceOf', [f.player]), 10_000_000n);
  });

  it('allows bounded, non-replayable prize payouts but cannot spend the separate treasury share', async () => {
    await start();
    const award = digest('tournament-1');
    await reverts(f.game, 'awardPrize', [award, f.other, parseEther('100')], f.player, 'OwnableUnauthorizedAccount');
    await reverts(f.game, 'awardPrize', [award, f.other, parseEther('110')], f.owner, 'PrizePoolInsufficient');
    await reverts(f.game, 'awardPrize', [zeroHash, f.other, 1n], f.owner, 'InvalidAward');
    await reverts(f.game, 'awardPrize', [award, zeroAddress, 1n], f.owner, 'InvalidAward');
    await reverts(f.game, 'awardPrize', [award, f.game.address, 1n], f.owner, 'InvalidAward');
    await reverts(f.game, 'awardPrize', [award, f.other, 0n], f.owner, 'InvalidAward');
    const receipt = await send(f.game, 'awardPrize', [award, f.other, parseEther('60')], f.owner);
    assert.equal(event(receipt, f.game, 'PrizeAwarded').amount, parseEther('60'));
    assert.equal(await read(f.rf, 'balanceOf', [f.other]), parseEther('1160'));
    assert.equal(await read(f.rf, 'balanceOf', [f.game.address]), parseEther('40'));
    assert.equal(await read(f.game, 'prizePoolBalance'), parseEther('40'));
    assert.equal(await read(f.rf, 'balanceOf', [f.treasury]), parseEther('10'));
    await reverts(f.game, 'awardPrize', [digest('overdraw-after-payout'), f.other, parseEther('41')], f.owner, 'PrizePoolInsufficient');
    await reverts(f.game, 'awardPrize', [award, f.other, 1n], f.owner, 'InvalidAward');
    assert.equal(await read(f.game, 'prizeAwards', [award]), true);
  });

  it('requires two steps for ownership transfer and keeps the treasury destination immutable', async () => {
    await send(f.game, 'transferOwnership', [f.other], f.owner);
    assert.equal((await read(f.game, 'owner')).toLowerCase(), f.owner.toLowerCase());
    await reverts(f.game, 'acceptOwnership', [], f.player, 'OwnableUnauthorizedAccount');
    await send(f.game, 'acceptOwnership', [], f.other);
    await reverts(f.game, 'pause', [], f.owner, 'OwnableUnauthorizedAccount');
    await send(f.game, 'pause', [], f.other);
    await send(f.game, 'unpause', [], f.other);
    assert.equal((await read(f.game, 'treasury')).toLowerCase(), f.treasury.toLowerCase());
    await start();
    assert.equal(await read(f.rf, 'balanceOf', [f.treasury]), parseEther('10'));
    assert.equal(await read(f.rf, 'balanceOf', [f.owner]), 0n);
    assert.equal(await read(f.rf, 'balanceOf', [f.other]), parseEther('1100'));
  });

  it('keeps the tRF faucet limited to one claim per address per UTC day', async () => {
    await send(f.rf, 'faucet', [], f.player);
    await reverts(f.rf, 'faucet', [], f.player, 'FaucetAlreadyUsed');
    await advance(86_400);
    await send(f.rf, 'faucet', [], f.player);
    assert.equal(await read(f.rf, 'balanceOf', [f.player]), parseEther('3300'));
  });
});
