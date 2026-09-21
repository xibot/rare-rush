import { defineChain } from 'viem';

export const robinhoodTestnet = defineChain({
  id: 46630, name: 'Robinhood Testnet', testnet: true,
  nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Robinhood Explorer', url: 'https://explorer.testnet.chain.robinhood.com' } },
});
export const localChain = defineChain({
  id: 31337, name: 'Rare Rush Local', testnet: true,
  nativeCurrency: { name: 'Local Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
});

export async function assertChain(client, expected) {
  if (![46630, 31337].includes(expected)) throw new Error('Only Robinhood testnet and the isolated local chain are allowed.');
  if (await client.getChainId() !== expected) throw new Error('RPC chain mismatch. Refusing to sign or send.');
}
