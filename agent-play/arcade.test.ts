import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFunctionData, encodeAbiParameters, parseAbi, type Address, type Hex } from 'viem';
import { GENERATION_SPRITE_MANIFEST } from '@rarefriends/friendsdk/sprites';
import { GENESIS_DEPLOYMENT } from '../games/rare-rush/genesis/identity.ts';
import { loadArcadeFriend, type ArcadeProvider } from './arcade.ts';

const account = '0x1111111111111111111111111111111111111111' as Address;
const other = '0x2222222222222222222222222222222222222222' as Address;
const wallet = '0x3333333333333333333333333333333333333333' as Address;
const abi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function generation(uint256 tokenId) view returns (uint8)',
  'function tokenBoundAccount(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function familyOf(uint256 tokenId) pure returns (uint8)',
  'function seedOf(uint256 tokenId) pure returns (uint32)',
  'function frames(uint8 id, uint32 seed) view returns (uint256[64])',
]);
const data = (mime: string, value: string) => `data:${mime};base64,${Buffer.from(value).toString('base64')}`;
const portrait = data('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path d="M0 0h8v8H0z"/></svg>');
const metadata = data('application/json', JSON.stringify({ image: portrait }));

function mock(options: { owner?: Address; generation?: number; chain?: string; invalidateAt?: string } = {}) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const calls: { method: string; functionName?: string; to?: string; block?: unknown }[] = [];
  const provider: ArcadeProvider = {
    on(event, listener) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); },
    removeListener(event, listener) { listeners.get(event)?.delete(listener); },
    async request({ method, params }) {
      if (method !== 'eth_call') calls.push({ method });
      if (method === 'eth_accounts') return [account];
      if (method === 'eth_chainId') return options.chain ?? '0x1237';
      if (method === 'eth_blockNumber') return '0x63';
      assert.equal(method, 'eth_call', 'No signing, transactions, or collection scans');
      const [call, block] = params as [{ to: string; data: Hex }, string];
      const { functionName } = decodeFunctionData({ abi, data: call.data });
      calls.push({ method, functionName, to: call.to, block });
      if (functionName === options.invalidateAt) for (const listener of listeners.get('chainChanged') ?? []) listener('0x1');
      switch (functionName) {
        case 'ownerOf': return encodeAbiParameters([{ type: 'address' }], [options.owner ?? account]);
        case 'generation': return encodeAbiParameters([{ type: 'uint8' }], [options.generation ?? 1]);
        case 'tokenBoundAccount': return encodeAbiParameters([{ type: 'address' }], [wallet]);
        case 'tokenURI': return encodeAbiParameters([{ type: 'string' }], [metadata]);
        case 'familyOf': return encodeAbiParameters([{ type: 'uint8' }], [2]);
        case 'seedOf': return encodeAbiParameters([{ type: 'uint32' }], [42]);
        case 'frames': return encodeAbiParameters([{ type: 'uint256[64]' }], [Array(64).fill(17n)]);
      }
    },
  };
  return { provider, calls, listeners };
}

test('Arcade loads the owned Generations identity and its actual SDK frames', async () => {
  const { provider, calls, listeners } = mock();
  const friend = await loadArcadeFriend(provider, account, 0, '42');
  assert.equal(friend.owner, account);
  assert.equal(friend.sprites?.tokenId, 42n);
  assert.equal(friend.sprites?.familyName, 'Family');
  assert.equal(friend.sprites?.frames[0], 17n);
  assert.equal(friend.blockNumber, '99');
  const ownership = calls.filter(call => ['ownerOf', 'generation'].includes(call.functionName ?? ''));
  assert.ok(ownership.every(call => call.to?.toLowerCase() === GENERATION_SPRITE_MANIFEST.generations.toLowerCase() && call.block === '0x63'));
  assert.ok([...listeners.values()].every(set => set.size === 0));
  await loadArcadeFriend(provider, account, 0, '42');
  assert.equal(calls.filter(call => call.functionName === 'ownerOf').length, 2, 'Each start performs fresh ownership reads');
});

test('Arcade loads the owned Genesis actual portrait at the verified block', async () => {
  const { provider, calls } = mock();
  const friend = await loadArcadeFriend(provider, account, 1, '7');
  assert.equal(friend.owner, account);
  assert.equal(friend.portraitUrl, portrait);
  assert.equal(friend.tokenId, '7');
  assert.ok(calls.filter(call => call.method === 'eth_call').every(call => call.to?.toLowerCase() === GENESIS_DEPLOYMENT.contract.toLowerCase() && call.block === '0x63'));
});

test('Arcade rejects unowned Friends and generation 0', async () => {
  for (const collection of [0, 1] as const) {
    await assert.rejects(loadArcadeFriend(mock({ owner: other }).provider, account, collection, '42'), /not owned|no longer owned/);
  }
  await assert.rejects(loadArcadeFriend(mock({ generation: 0 }).provider, account, 0, '42'), /generation 0/);
});

test('Arcade rejects the wrong chain before contract reads', async () => {
  const { provider, calls } = mock({ chain: '0x1' });
  await assert.rejects(loadArcadeFriend(provider, account, 0, '42'), /4663/);
  assert.ok(calls.every(call => call.method !== 'eth_call'));
});

test('Arcade cancels a wallet change during either artwork read', async () => {
  for (const [collection, invalidateAt] of [[0, 'frames'], [1, 'tokenURI']] as const) {
    const { provider, listeners } = mock({ invalidateAt });
    await assert.rejects(loadArcadeFriend(provider, account, collection, '42'), /connection changed|Could not verify/);
    assert.ok([...listeners.values()].every(set => set.size === 0));
  }
});

test('Arcade rejects malformed token IDs without requesting the wallet', async () => {
  for (const id of ['0', '-1', '0x2a', '1.0', String(1n << 256n)]) {
    const { provider, calls } = mock();
    await assert.rejects(loadArcadeFriend(provider, account, 0, id), /token ID|Token ID/);
    assert.equal(calls.length, 0);
  }
});
