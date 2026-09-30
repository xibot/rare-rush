import assert from 'node:assert/strict';
import test from 'node:test';
import { zeroAddress, type Address, type PublicClient } from 'viem';
import deployment from '../testnet-app/src/shared/deployment.json' with { type: 'json' };
import { discoverTestnetInventory, readTestnetLibraryPage } from './testnet-library.ts';
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address;
const OTHER = '0x2222222222222222222222222222222222222222' as Address;
const START = BigInt(deployment.assetDeploymentBlock);
const signal = () => new AbortController().signal;
function fixture(collection: 0 | 1, count: number) {
  const contract = deployment.contracts[collection === 1 ? 'genesis' : 'generations'];
  const state = { chain: 46630, head: START + 20_000_007n, balance: BigInt(count), owner: ACCOUNT,
    omitLogs: false, generation: 1n, invalid: false };
  const reads: string[] = [], ranges: [bigint, bigint][] = [];
  let activeReads = 0, maxActive = 0;
  const client = {
    async getChainId() { return state.chain; },
    async getBlockNumber() { return state.head; },
    async readContract(query: { address: string; functionName: string; blockNumber: bigint; args: unknown[] }) {
      assert.equal(query.address.toLowerCase(), contract); assert.equal(query.blockNumber, state.head);
      reads.push(query.functionName);
      activeReads++; maxActive = Math.max(activeReads, maxActive);
      await Promise.resolve(); activeReads--;
      if (query.functionName === 'balanceOf') return state.balance;
      if (query.functionName === 'ownerOf') return state.owner;
      if (query.functionName === 'generation') return state.generation;
      throw Error('Unexpected read');
    },
    async getLogs(query: { address: string; fromBlock: bigint; toBlock: bigint; args: { to?: Address; from?: Address } }) {
      assert.equal(query.address.toLowerCase(), contract); assert.equal(query.args.to ?? query.args.from, ACCOUNT);
      ranges.push([query.fromBlock, query.toBlock]);
      assert.ok(query.toBlock - query.fromBlock < 10_000n, 'Provider accepts at most 10,000 blocks');
      if (state.omitLogs || !query.args.to || query.fromBlock > START + 1n || query.toBlock < START + 1n) return [];
      return Array.from({ length: count }, (_, i) => ({ address: contract, blockNumber: START + 1n, logIndex: i,
        removed: state.invalid, args: { from: zeroAddress, to: ACCOUNT, tokenId: BigInt(i + 1) } }));
    },
  } as unknown as PublicClient;
  return { client, state, reads, ranges, maxActive: () => maxActive };
}

test('1,000 test Generations use bounded history and only eight initial NFT checks', async () => {
  const f = fixture(0, 1000);
  const inventory = await discoverTestnetInventory(f.client, ACCOUNT, 0, signal());
  assert.equal(inventory.balance, 1000n);
  assert.deepEqual(f.reads, ['balanceOf']);
  assert.equal(f.ranges.length, 0);
  const first = await readTestnetLibraryPage(f.client, inventory, signal());
  assert.deepEqual(first.tokenIds, ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.equal(first.nextCursor, 8);
  assert.equal(f.reads.filter(name => name === 'ownerOf').length, 8);
  assert.equal(f.reads.filter(name => name === 'generation').length, 8);
  assert.ok(f.maxActive() <= 4);
  const next = await readTestnetLibraryPage(f.client, inventory, signal(), first);
  assert.equal(next.tokenIds.length, 16); assert.equal(next.nextCursor, 16);
  assert.equal(f.ranges.length, 1, 'More Friends reuses incoming candidates without scanning later history');
});

test('10 test Genesis are two pages, with no unnecessary Generations or artwork requests', async () => {
  const f = fixture(1, 10), inventory = await discoverTestnetInventory(f.client, ACCOUNT, 1, signal());
  const first = await readTestnetLibraryPage(f.client, inventory, signal());
  const second = await readTestnetLibraryPage(f.client, inventory, signal(), first);
  assert.equal(first.tokenIds.length, 8); assert.equal(second.tokenIds.length, 10);
  assert.equal(second.nextCursor, null); assert.equal(second.hiddenCount, 0);
  assert.ok(f.reads.every(name => ['balanceOf', 'ownerOf'].includes(name)));
});

test('empty wallets do not fetch transfer history; failures are never shown as empty success', async () => {
  const f = fixture(0, 0), inventory = await discoverTestnetInventory(f.client, ACCOUNT, 0, signal());
  assert.deepEqual((await readTestnetLibraryPage(f.client, inventory, signal())).tokenIds, []);
  assert.deepEqual(f.ranges, []);
  const incomplete = fixture(0, 2); incomplete.state.omitLogs = true; incomplete.state.head = START + 8n;
  await assert.rejects(readTestnetLibraryPage(incomplete.client, await discoverTestnetInventory(incomplete.client, ACCOUNT, 0, signal()), signal()), /incomplete/);
  const invalid = fixture(0, 2); invalid.state.invalid = true;
  await assert.rejects(readTestnetLibraryPage(invalid.client, await discoverTestnetInventory(invalid.client, ACCOUNT, 0, signal()), signal()), /invalid/);
  const rpcError = fixture(0, 2); rpcError.client.getLogs = async () => { throw Error('HTTP request failed'); };
  await assert.rejects(readTestnetLibraryPage(rpcError.client, await discoverTestnetInventory(rpcError.client, ACCOUNT, 0, signal()), signal()), /HTTP/);
});

test('wrong network, account, changed ownership and cancelled pages cannot return selectable assets', async () => {
  const f = fixture(0, 10); f.state.head = START + 8n;
  await assert.rejects(discoverTestnetInventory(f.client, zeroAddress, 0, signal()), /valid wallet/);
  f.state.chain = 4663;
  await assert.rejects(discoverTestnetInventory(f.client, ACCOUNT, 0, signal()), /Testnet/);
  f.state.chain = 46630;
  const inventory = await discoverTestnetInventory(f.client, ACCOUNT, 0, signal());
  f.state.owner = OTHER;
  await assert.rejects(readTestnetLibraryPage(f.client, inventory, signal()), /incomplete/);
  f.state.owner = ACCOUNT;
  const controller = new AbortController();
  const read = f.client.readContract;
  f.client.readContract = (async query => { controller.abort(); return read(query); }) as typeof read;
  await assert.rejects(readTestnetLibraryPage(f.client, inventory, controller.signal), { name: 'AbortError' });
});

test('generation zero pages can continue and snapshots cannot cross wallets or collections', async () => {
  const f = fixture(0, 40), inventory = await discoverTestnetInventory(f.client, ACCOUNT, 0, signal());
  f.state.generation = 0n;
  const first = await readTestnetLibraryPage(f.client, inventory, signal());
  assert.deepEqual(first.tokenIds, []); assert.equal(first.hiddenCount, 32); assert.equal(first.nextCursor, 32);
  f.state.generation = 1n;
  const final = await readTestnetLibraryPage(f.client, inventory, signal(), first);
  assert.deepEqual(final.tokenIds, ['33', '34', '35', '36', '37', '38', '39', '40']); assert.equal(final.nextCursor, null);
  await assert.rejects(readTestnetLibraryPage(f.client, { ...inventory, account: OTHER }, signal(), first), /selection changed/);
});


test('small early holder stops after one 10k incoming query rather than scanning millions of blocks', async () => {
  const f = fixture(1, 2), inventory = await discoverTestnetInventory(f.client, ACCOUNT, 1, signal());
  const page = await readTestnetLibraryPage(f.client, inventory, signal());
  assert.deepEqual(page.tokenIds, ['1', '2']); assert.equal(page.nextCursor, null);
  assert.deepEqual(f.ranges, [[START, START + 9_999n]]);
});

test('incoming transfers sent away are skipped; later incoming owned NFTs complete the pinned balance', async () => {
  const f = fixture(1, 3); f.state.balance = 1n;
  const read = f.client.readContract;
  f.client.readContract = (async query => query.functionName === 'ownerOf' ? query.args[0] === 3n ? ACCOUNT : OTHER : read(query)) as typeof read;
  const page = await readTestnetLibraryPage(f.client, await discoverTestnetInventory(f.client, ACCOUNT, 1, signal()), signal());
  assert.deepEqual(page.tokenIds, ['3']); assert.equal(page.nextCursor, null);
  assert.equal(f.ranges.length, 1);
});

test('late mints yield search progress without a false empty result or repeated history ranges', async () => {
  const f = fixture(1, 1); f.state.head = START + 85_000n;
  const target = START + 82_000n;
  f.client.getLogs = (async query => {
    const from = query.fromBlock, to = query.toBlock;
    assert.ok(to - from < 10_000n); f.ranges.push([from, to]);
    return from <= target && to >= target ? [{ address: deployment.contracts.genesis, blockNumber: target, logIndex: 0,
      removed: false, args: { from: zeroAddress, to: ACCOUNT, tokenId: 1n } }] : [];
  }) as typeof f.client.getLogs;
  const inventory = await discoverTestnetInventory(f.client, ACCOUNT, 1, signal());
  const first = await readTestnetLibraryPage(f.client, inventory, signal());
  assert.deepEqual(first.tokenIds, []); assert.notEqual(first.nextCursor, null);
  assert.equal(f.ranges.length, 8); assert.equal(first.search.nextBlock, START + 80_000n);
  const next = await readTestnetLibraryPage(f.client, inventory, signal(), first);
  assert.deepEqual(next.tokenIds, ['1']); assert.equal(next.nextCursor, null); assert.equal(f.ranges.length, 9);
});
