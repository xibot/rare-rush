import { stat } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getAddress, isAddress, zeroAddress, type Address, type EIP1193Provider } from 'viem';

export type ExternalProviderOptions = {
  providerModule: string; chainId: 4663 | 46630; address: string; rpcUrl: string;
};
export async function assertProviderIdentity(provider: EIP1193Provider, expected: { chainId: number; address: string }) {
  if (!isAddress(expected.address) || expected.address.toLowerCase() === zeroAddress) throw new Error('A nonzero wallet address is required.');
  const [accounts, chain] = await Promise.all([
    provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' }),
  ]);
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string'
    || accounts[0].toLowerCase() !== expected.address.toLowerCase()) throw new Error('External provider account does not match the job wallet.');
  if (typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== BigInt(expected.chainId)) {
    throw new Error('External provider chain does not match the job network.');
  }
  return getAddress(expected.address);
}

/** Import only an explicitly chosen trusted local module. Signer custody and
 * wallet policy stay in that module; this loader never reads credentials. */
export async function loadExternalProvider(options: ExternalProviderOptions): Promise<EIP1193Provider> {
  if (![4663, 46630].includes(options.chainId)) throw new Error('Unsupported wallet network.');
  if (!isAbsolute(options.providerModule) || !['.mjs', '.js', '.cjs', '.ts'].includes(extname(options.providerModule))) {
    throw new Error('providerModule must be an absolute path to a trusted local JavaScript or TypeScript module.');
  }
  const rpc = new URL(options.rpcUrl);
  if (!['http:', 'https:'].includes(rpc.protocol) || rpc.username || rpc.password || rpc.hash) throw new Error('Use an HTTP(S) RPC URL without embedded credentials.');
  if (!isAddress(options.address) || options.address.toLowerCase() === zeroAddress) throw new Error('A nonzero wallet address is required.');
  if (!(await stat(options.providerModule)).isFile()) throw new Error('providerModule must be a regular file.');
  const module = await import(pathToFileURL(options.providerModule).href);
  if (typeof module.createProvider !== 'function') throw new Error('Wallet module must export createProvider({chainId,address,rpcUrl}).');
  const provider = await module.createProvider({ chainId: options.chainId, address: getAddress(options.address), rpcUrl: options.rpcUrl });
  if (!provider || typeof provider.request !== 'function') throw new Error('Wallet module did not return an EIP-1193 provider.');
  await assertProviderIdentity(provider, options);
  return provider;
}
export type ExternalProviderFactory = (options: { chainId: 4663 | 46630; address: Address; rpcUrl: string }) => EIP1193Provider | Promise<EIP1193Provider>;
