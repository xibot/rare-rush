import { writeFile } from 'node:fs/promises';
import { formatUnits } from 'viem';
import { localFixture } from '../test/local-fixture.ts';
import { recordPilot } from '../test/pilot.ts';
import { verifyAndSign } from '../src/verifier.ts';

const f = await localFixture();
await f.write(f.rf, f.rfArtifact.abi, 'faucet');
await f.write(f.generations, f.nftArtifact.abi, 'mint');
await f.write(f.genesis, f.nftArtifact.abi, 'mint');
await f.write(f.rf, f.rfArtifact.abi, 'approve', [f.game, 10n ** 18n]);
const results = [];
for (const [collection, label] of [[0, 'Generations'], [1, 'Genesis']] as const) {
  await f.write(f.game, f.gameArtifact.abi, 'startRun', [collection, 1n, 1]);
  const runId = await f.read('runCount') as bigint;
  const run = await f.read('runs', [runId]) as any;
  const replay = recordPilot(run[2], 1);
  await f.client.request({ method: 'evm_increaseTime' as any, params: [91] as any });
  await f.client.request({ method: 'evm_mine' as any });
  const receipt = await verifyAndSign({ client: f.client, chainId: 31337, game: f.game, runId, replay, privateKey: f.verifierKey, confirmations: 0 });
  const reward = await f.read('quoteReward', [receipt.pickupKinds, collection, 1]) as bigint;
  const tx = await f.write(f.game, f.gameArtifact.abi, 'claim', [runId, receipt.pickupKinds, receipt.replayHash, BigInt(receipt.deadline), receipt.signature]);
  const result = { collection: label, coins: receipt.coins, bonusCoins: receipt.bonusCoins, hearts: receipt.hearts, minted: formatUnits(reward, 6), symbol: 'tRARERUSH', transaction: tx.transactionHash };
  results.push(result);
  console.log(`${label}: survived with ${result.hearts} hearts, ${result.coins} coins (${result.bonusCoins} bonus), minted ${result.minted} tRARERUSH.`);
}
const report = { network: 'Isolated local EVM — not public Robinhood testnet', chainId: 31337, game: f.game, token: f.token, engineVersion: f.version, runs: results, prizePool: formatUnits(await f.read('prizePoolBalance') as bigint, 18) + ' tRF' };
await writeFile(new URL('../artifacts/demo-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(`Prize pool: ${report.prizePool}. Evidence saved to artifacts/demo-result.json.`);
