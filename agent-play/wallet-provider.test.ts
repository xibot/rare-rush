import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadExternalProvider } from './wallet-provider.ts';

test('only an explicit trusted local factory is loaded and its exposed chain/account must match', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rare-rush-provider-test-'));
  const path = join(dir, 'provider.mjs'), address = '0x1111111111111111111111111111111111111111';
  try {
    await writeFile(path, `export function createProvider({chainId,address,rpcUrl}) {
      if(rpcUrl!=='https://rpc.test.invalid')throw Error('Unexpected RPC');
      return {request:async({method})=>{if(method==='eth_accounts')return [address];if(method==='eth_chainId')return '0x'+chainId.toString(16);throw Error('No writes expected');}};
    }`);
    const provider = await loadExternalProvider({ providerModule: path, chainId: 46630, address, rpcUrl: 'https://rpc.test.invalid' });
    assert.deepEqual(await provider.request({ method: 'eth_accounts' }), [address]);
    await assert.rejects(loadExternalProvider({ providerModule: 'https://untrusted.invalid/provider.mjs', chainId: 46630, address, rpcUrl: 'https://rpc.test.invalid' }), /absolute path/);
    const wrong = join(dir, 'wrong.mjs');
    await writeFile(wrong, `export function createProvider(){return {request:async({method})=>method==='eth_accounts'?['${address}']:'0x1'}}`);
    await assert.rejects(loadExternalProvider({ providerModule: wrong, chainId: 46630, address, rpcUrl: 'https://rpc.test.invalid' }), /chain does not match/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
