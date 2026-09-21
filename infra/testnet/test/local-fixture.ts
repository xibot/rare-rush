import { createPublicClient, createWalletClient, http, toHex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { localChain, assertChain } from '../src/chain.mjs';
import { artifact } from '../src/artifacts.mjs';
import { currentEngineVersion } from '../src/engine-version.ts';

export async function localFixture() {
  const rpc = process.env.RUSH_TEST_RPC;
  if (!rpc || !/^http:\/\/127\.0\.0\.1:\d+$/.test(rpc)) throw new Error('Fixture requires an isolated loopback test node.');
  const chain = localChain;
  const transport = http(rpc);
  const client = createPublicClient({ chain, transport, pollingInterval: 20 });
  await assertChain(client, 31337);
  // These are Hardhat's publicly known development identities, never public-testnet signers.
  const mnemonic = 'test test test test test test test test test test test junk';
  const player = mnemonicToAccount(mnemonic, { addressIndex: 0 });
  const verifier = mnemonicToAccount(mnemonic, { addressIndex: 2 });
  const treasury = mnemonicToAccount(mnemonic, { addressIndex: 3 });
  const verifierKey = toHex(verifier.getHdKey().privateKey!);
  const wallet = createWalletClient({ account: player, chain, transport });
  const gameArtifact = await artifact('RareRushGame');
  const rfArtifact = await artifact('TestRF');
  const nftArtifact = await artifact('TestFriends');
  const tokenArtifact = await artifact('RareRushToken');
  async function mined(hash: `0x${string}`) {
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error('Fixture transaction reverted.');
    return receipt;
  }
  async function deploy(data: any, args: unknown[] = []) {
    const receipt = await mined(await wallet.deployContract({ abi: data.abi, bytecode: data.bytecode, args }));
    return receipt.contractAddress!;
  }
  const rf = await deploy(rfArtifact);
  const genesis = await deploy(nftArtifact, [true]);
  const generations = await deploy(nftArtifact, [false]);
  const version = await currentEngineVersion();
  const game = await deploy(gameArtifact, [player.address, verifier.address, treasury.address, rf, genesis, generations, version]);
  const read = (functionName: string, args: unknown[] = []) => client.readContract({ address: game, abi: gameArtifact.abi, functionName, args });
  const write = async (address: `0x${string}`, abi: any, functionName: string, args: unknown[] = []) => mined(await wallet.writeContract({ address, abi, functionName, args }));
  const token = await read('token') as `0x${string}`;
  return { client, wallet, player, verifier, treasury, verifierKey, game, rf, genesis, generations, token, version, gameArtifact, rfArtifact, nftArtifact, tokenArtifact, read, write, mined };
}
