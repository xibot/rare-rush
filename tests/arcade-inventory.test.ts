import assert from 'node:assert/strict';
import test from 'node:test';
import { zeroAddress, type Address } from 'viem';
import { GENERATION_SPRITE_MANIFEST } from '@rarefriends/friendsdk/sprites';
import { GENESIS_DEPLOYMENT } from '../games/rare-rush/genesis/identity.ts';
import { discoverArcadeInventory, readArcadeInventoryPage, type InventoryClient } from '../games/rare-rush/arcade-inventory.ts';

const account = '0x1111111111111111111111111111111111111111' as Address;
const other = '0x2222222222222222222222222222222222222222' as Address;
const tba = '0x3333333333333333333333333333333333333333' as Address;
function fixture(count: number, collection: 0 | 1 = 0) {
  const reads: string[] = []; let history = 0, parallel = 0, peak = 0;
  const state = { wrongOwner: false, incomplete: false, generationZero: false, chain: 4663 };
  const contract = collection === 1 ? GENESIS_DEPLOYMENT.contract : GENERATION_SPRITE_MANIFEST.generations;
  const client = {
    getChainId: async () => state.chain,
    getBlockNumber: async () => 100n,
    getLogs: async (query: any) => {
      history++; assert.equal(query.address, contract); assert.equal(query.toBlock, 100n);
      assert(query.args.to === account || query.args.from === account, 'history must be owner filtered');
      return query.args.from ? [] : Array.from({ length: count - Number(state.incomplete) }, (_, i) => ({
        address: contract, removed: false, blockNumber: 100n, logIndex: i,
        args: { from: zeroAddress, to: account, tokenId: BigInt(i + 1) },
      }));
    },
    readContract: async (call: any) => {
      assert.equal(call.address, contract); assert.equal(call.blockNumber, 100n);
      reads.push(call.functionName); parallel++; peak = Math.max(peak, parallel);
      await new Promise(resolve => setTimeout(resolve, 1)); parallel--;
      if (call.functionName === 'balanceOf') return BigInt(count);
      if (call.functionName === 'ownerOf') return state.wrongOwner ? other : account;
      if (call.functionName === 'generation') return state.generationZero ? 0 : 1;
      if (call.functionName === 'tokenBoundAccount') return tba;
      throw new Error('Unexpected read');
    },
  } as unknown as InventoryClient;
  return { client, state, reads, get history() { return history; }, get peak() { return peak; } };
}

test('1,000 Generations return the first eight with 24 NFT reads, then page without rescanning history', async () => {
  const f = fixture(1000), inventory = await discoverArcadeInventory(f.client, account, 0);
  assert.equal(inventory.ids.length, 1000); assert.deepEqual(f.reads, ['balanceOf']);
  const first = await readArcadeInventoryPage(f.client, inventory);
  assert.equal(first.friends.length, 8); assert.equal(first.nextCursor, 8);
  assert.equal(f.reads.length, 25); assert.equal(f.history, 2); assert(f.peak <= 8);
  const second = await readArcadeInventoryPage(f.client, inventory, { cursor: first.nextCursor! });
  assert.deepEqual(second.friends.map(f => Number(f.id)), [9, 10, 11, 12, 13, 14, 15, 16]);
  assert.equal(f.history, 2); assert.equal(f.reads.length, 49);
  const last = await readArcadeInventoryPage(f.client, inventory, { cursor: 992 });
  assert.equal(last.friends.at(-1)!.id, 1000n); assert.equal(last.nextCursor, null);
});

test('ten Genesis load in two small pages without generation or artwork calls', async () => {
  const f = fixture(10, 1), inventory = await discoverArcadeInventory(f.client, account, 1);
  const first = await readArcadeInventoryPage(f.client, inventory);
  assert.equal(first.friends.length, 8); assert.equal(first.nextCursor, 8); assert.equal(f.reads.length, 17);
  const second = await readArcadeInventoryPage(f.client, inventory, { cursor: 8 });
  assert.deepEqual(second.friends.map(f => f.label), ['Genesis #9', 'Genesis #10']);
  assert.equal(second.nextCursor, null); assert.equal(f.reads.length, 21); assert.equal(f.history, 2);
});

test('an ineligible first page keeps pagination available and does not fetch token-bound wallets', async () => {
  const f = fixture(20); f.state.generationZero = true;
  const inventory = await discoverArcadeInventory(f.client, account, 0);
  const first = await readArcadeInventoryPage(f.client, inventory);
  assert.equal(first.friends.length, 0); assert.equal(first.hiddenCount, 8); assert.equal(first.nextCursor, 8);
  assert(!f.reads.includes('tokenBoundAccount'));
});

test('incomplete history, inconsistent ownership, wrong network and cancellation fail closed', async () => {
  const f = fixture(10); f.state.incomplete = true;
  await assert.rejects(discoverArcadeInventory(f.client, account, 0), /incomplete/);
  f.state.incomplete = false;
  const inventory = await discoverArcadeInventory(f.client, account, 0);
  f.state.wrongOwner = true;
  await assert.rejects(readArcadeInventoryPage(f.client, inventory), /ownership/);
  f.state.wrongOwner = false; f.state.chain = 1;
  await assert.rejects(readArcadeInventoryPage(f.client, inventory), /mainnet/);
  f.state.chain = 4663;
  const controller = new AbortController(); controller.abort(); const before = f.reads.length;
  await assert.rejects(readArcadeInventoryPage(f.client, inventory, { signal: controller.signal }));
  assert.equal(f.reads.length, before);
  await assert.rejects(readArcadeInventoryPage(f.client, inventory, { cursor: -1 }), /Invalid Friend page/);
});
