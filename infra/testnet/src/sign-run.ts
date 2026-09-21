import { readFile, stat } from 'node:fs/promises';
import { createPublicClient, getAddress, http, type Hex } from 'viem';
import { localChain, robinhoodTestnet } from './chain.mjs';
import { MAX_REPLAY_BYTES } from './replay.ts';
import { verifyAndSign } from './verifier.ts';

// Usage: node --env-file=.env.testnet src/sign-run.ts <runId> <replay.json>
try {
  const [runIdText, path] = process.argv.slice(2);
  if (!/^\d+$/.test(runIdText ?? '') || !path) throw new Error('Usage: verify:run -- <runId> <replay.json>');
  const chainId = Number(process.env.RUSH_CHAIN_ID ?? 46630);
  if (chainId !== 46630 && chainId !== 31337) throw new Error('Unsupported chain.');
  const chain = chainId === 46630 ? robinhoodTestnet : localChain;
  const key = process.env.RUSH_VERIFIER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Set the verifier key in the operator environment. Never send it to a browser.');
  if ((await stat(path)).size > MAX_REPLAY_BYTES) throw new Error('Replay file exceeds size limit.');
  const receipt = await verifyAndSign({
    client: createPublicClient({ chain, transport: http(process.env.RUSH_RPC_URL ?? chain.rpcUrls.default.http[0]) }),
    chainId, game: getAddress(process.env.RUSH_GAME_ADDRESS ?? ''), runId: BigInt(runIdText),
    replay: JSON.parse(await readFile(path, 'utf8')), privateKey: key as Hex, confirmations: chainId === 46630 ? 2 : 0,
  });
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  // Avoid dumping RPC request internals or signing configuration.
  console.error(error instanceof Error ? error.message.split('\n')[0] : 'Verification failed.');
  process.exitCode = 1;
}
