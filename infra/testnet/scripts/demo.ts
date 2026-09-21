import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { formatUnits } from 'viem';
import { localFixture } from '../test/local-fixture.ts';
import { recordPilot } from '../test/pilot.ts';
import { verifyAndSign } from '../src/verifier.ts';

const f = await localFixture();
await f.write(f.rf, f.rfArtifact.abi, 'faucet');
await f.write(f.generations, f.nftArtifact.abi, 'mint');
await f.write(f.genesis, f.nftArtifact.abi, 'mint');
await f.write(f.rf, f.rfArtifact.abi, 'approve', [f.game, 110n * 10n ** 18n]);
const results = [];
const balanceOf = (address: `0x${string}`) => f.client.readContract({ address: f.rf, abi: f.rfArtifact.abi, functionName: 'balanceOf', args: [address] }) as Promise<bigint>;
for (const [collection, label] of [[0, 'Generations'], [1, 'Genesis']] as const) {
  const before = { player: await balanceOf(f.player.address), pool: await balanceOf(f.game), treasury: await balanceOf(f.treasury.address) };
  const entryTx = await f.write(f.game, f.gameArtifact.abi, 'startRun', [collection, 1n, 1]);
  const entryFee = before.player - await balanceOf(f.player.address);
  const prizePoolContribution = await balanceOf(f.game) - before.pool;
  const treasuryContribution = await balanceOf(f.treasury.address) - before.treasury;
  assert.equal(entryFee, BigInt(collection === 0 ? 110 : 0) * 10n ** 18n);
  assert.equal(prizePoolContribution, BigInt(collection === 0 ? 100 : 0) * 10n ** 18n);
  assert.equal(treasuryContribution, BigInt(collection === 0 ? 10 : 0) * 10n ** 18n);
  assert.equal(entryFee, prizePoolContribution + treasuryContribution);
  const runId = await f.read('runCount') as bigint;
  const run = await f.read('runs', [runId]) as any;
  const replay = recordPilot(run[2], 1);
  await f.client.request({ method: 'evm_increaseTime' as any, params: [91] as any });
  await f.client.request({ method: 'evm_mine' as any });
  const receipt = await verifyAndSign({ client: f.client, chainId: 31337, game: f.game, runId, replay, privateKey: f.verifierKey, confirmations: 0 });
  const reward = await f.read('quoteReward', [receipt.pickupKinds, collection, 1]) as bigint;
  const tx = await f.write(f.game, f.gameArtifact.abi, 'claim', [runId, receipt.pickupKinds, receipt.replayHash, BigInt(receipt.deadline), receipt.signature]);
  const result = {
    collection: label, coins: receipt.coins, bonusCoins: receipt.bonusCoins, hearts: receipt.hearts,
    minted: formatUnits(reward, 6), symbol: 'tRARERUSH',
    entryFee: formatUnits(entryFee, 18) + ' tRF',
    prizePoolContribution: formatUnits(prizePoolContribution, 18) + ' tRF',
    treasuryContribution: formatUnits(treasuryContribution, 18) + ' tRF',
    entryTransaction: entryTx.transactionHash, transaction: tx.transactionHash,
  };
  results.push(result);
  console.log(`${label}: entry ${result.entryFee} (${result.prizePoolContribution} pool + ${result.treasuryContribution} treasury); survived with ${result.hearts} hearts, ${result.coins} coins (${result.bonusCoins} bonus), minted ${result.minted} tRARERUSH.`);
}
const report = {
  network: 'Isolated local EVM — not public Robinhood testnet', chainId: 31337,
  game: f.game, token: f.token, engineVersion: f.version, runs: results,
  supplyCap: formatUnits(await f.client.readContract({ address: f.token, abi: f.tokenArtifact.abi, functionName: 'CAP' }) as bigint, 6) + ' tRARERUSH',
  treasuryAddress: f.treasury.address,
  treasuryBalance: formatUnits(await balanceOf(f.treasury.address), 18) + ' tRF',
  prizePool: formatUnits(await f.read('prizePoolBalance') as bigint, 18) + ' tRF',
};
await writeFile(new URL('../artifacts/demo-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(`Prize pool: ${report.prizePool}; separate treasury: ${report.treasuryBalance}; supply cap: ${report.supplyCap}. Evidence saved to artifacts/demo-result.json.`);
