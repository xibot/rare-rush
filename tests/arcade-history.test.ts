import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicClient, custom, decodeFunctionData, encodeEventTopics, encodeFunctionResult, parseAbi,
  parseAbiItem, zeroAddress, type Address, type Hex } from 'viem';
import { readOwnedFriends } from '@rarefriends/friendsdk/owned';
import { GENERATION_SPRITE_MANIFEST } from '@rarefriends/friendsdk/sprites';
import { ARCADE_LOG_BLOCK_LIMIT, withArcadeHistory } from '../games/rare-rush/arcade-client.ts';
import { GENESIS_DEPLOYMENT, readOwnedGenesis } from '../games/rare-rush/genesis/identity.ts';

const account = '0x1111111111111111111111111111111111111111' as Address;
const other = '0x2222222222222222222222222222222222222222' as Address;
const bound = '0x3333333333333333333333333333333333333333' as Address;
const head = 76_094_632n; // Actual head when the ten-million-block RPC limit broke discovery.
const hex = (value: bigint) => `0x${value.toString(16)}` as Hex;
const abi = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'function balanceOf(address account) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function generation(uint256 tokenId) view returns (uint8)',
  'function tokenBoundAccount(uint256 tokenId) view returns (address)',
]);
const transfer = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');

function fixture(collection: 'generations' | 'genesis') {
  const address = collection === 'generations' ? GENERATION_SPRITE_MANIFEST.generations : GENESIS_DEPLOYMENT.contract;
  const state = { missing: false, wrongOwner: false, failedPage: false, inflight: 0, peak: 0 };
  const ranges: { from: bigint; to: bigint; direction: string }[] = [];
  const ownership: bigint[] = [];
  const events = [
    [42n, 9_999_999n, zeroAddress, account], [42n, 10_000_000n, account, other],
    [42n, 30_000_000n, other, account], [43n, 40_000_000n, zeroAddress, account],
    [44n, 55_000_000n, zeroAddress, account], [44n, 60_000_000n, account, other],
    [42n, 70_000_000n, account, account],
  ] as const;
  const client = createPublicClient({ cacheTime: 0, transport: custom({ async request({ method, params }) {
    if (method === 'eth_chainId') return '0x1237';
    if (method === 'eth_blockNumber') return hex(head);
    if (method === 'eth_getLogs') {
      const [query] = params as [{ address: string; fromBlock: Hex; toBlock: Hex; topics: (string | null)[] }];
      assert.equal(query.address.toLowerCase(), address.toLowerCase());
      const from = BigInt(query.fromBlock), to = BigInt(query.toBlock);
      const ownerTopic = `0x${account.slice(2).padStart(64, '0')}`;
      assert.ok(query.topics[1] === ownerTopic || query.topics[2] === ownerTopic, 'Every page stays owner filtered');
      if (to - from + 1n > ARCADE_LOG_BLOCK_LIMIT) {
        throw Object.assign(new Error('query spans too many blocks; only 10000000 are allowed'), { code: -32602 });
      }
      ranges.push({ from, to, direction: query.topics[1] ? 'sent' : 'received' });
      state.inflight++; state.peak = Math.max(state.peak, state.inflight);
      await new Promise(resolve => setTimeout(resolve, 1));
      state.inflight--;
      if (state.failedPage && from === 10_000_000n) throw new Error('RPC unavailable');
      return events.filter(([id, block, sender, recipient]) => block >= from && block <= to &&
        (!state.missing || id !== 43n) && (query.topics[1] ? sender === account : recipient === account))
        .map(([tokenId, block, sender, recipient]) => ({ address, blockNumber: hex(block), logIndex: '0x0',
          transactionIndex: '0x0', blockHash: `0x${'ab'.repeat(32)}`, transactionHash: `0x${'cd'.repeat(32)}`,
          removed: false, data: '0x', topics: encodeEventTopics({ abi, eventName: 'Transfer', args: { from: sender, to: recipient, tokenId } }) }));
    }
    assert.equal(method, 'eth_call', 'Discovery cannot sign, write, or scan IDs');
    const [call, block] = params as [{ to: string; data: Hex }, Hex];
    assert.equal(call.to.toLowerCase(), address.toLowerCase());
    assert.equal(block, hex(head), 'Every ownership check uses the same snapshot block');
    const { functionName, args } = decodeFunctionData({ abi, data: call.data });
    let result: unknown;
    switch (functionName) {
      case 'balanceOf': result = 2n; break;
      case 'ownerOf': ownership.push(args[0]); result = state.wrongOwner ? other : account; break;
      case 'generation': result = args[0] === 43n ? 0 : 1; break;
      case 'tokenBoundAccount': result = bound; break;
    }
    return encodeFunctionResult({ abi, functionName, result: result as never });
  } }, { retryCount: 0 }) });
  const read = (reader = withArcadeHistory(client)) => collection === 'generations'
    ? readOwnedFriends(reader, account) : readOwnedGenesis(reader, account);
  return { client, state, ranges, ownership, read };
}

test('whole-chain discovery reproduces the live range error; paginated SDK and Genesis discovery succeed', async () => {
  for (const collection of ['generations', 'genesis'] as const) {
    const f = fixture(collection);
    await assert.rejects(f.read(f.client));
    const result = await f.read();
    assert.deepEqual(result.friends.map(friend => friend.id), collection === 'generations' ? [42n] : [42n, 43n]);
    if ('hiddenCount' in result) assert.equal(result.hiddenCount, 1, 'Generation zero stays ineligible');
    assert.equal(result.blockNumber, head);
    assert.deepEqual(f.ownership.sort(), [42n, 43n], 'Only currently held IDs receive ownership checks');
    assert.ok(f.state.peak <= 4, 'At most two pages per transfer direction run together');
    for (const direction of ['received', 'sent']) {
      const pages = f.ranges.filter(page => page.direction === direction).sort((a, b) => Number(a.from - b.from));
      assert.equal(pages.length, 8);
      assert.equal(pages[0].from, 0n);
      assert.equal(pages.at(-1)!.to, head);
      pages.forEach((page, index) => {
        assert.ok(page.to - page.from + 1n <= ARCADE_LOG_BLOCK_LIMIT);
        if (index) assert.equal(page.from, pages[index - 1].to + 1n, 'No gaps or overlap at inclusive range boundaries');
      });
    }
  }
});

test('incomplete pages, RPC failure, and stale ownership remain failures instead of playable or empty results', async () => {
  for (const collection of ['generations', 'genesis'] as const) {
    for (const problem of ['missing', 'failedPage', 'wrongOwner'] as const) {
      const f = fixture(collection); f.state[problem] = true;
      await assert.rejects(f.read());
    }
  }
});

test('unfiltered history and unsupported collections cannot trigger RPC scans', async () => {
  const f = fixture('generations'), client = withArcadeHistory(f.client);
  await assert.rejects(client.getLogs({ address: GENERATION_SPRITE_MANIFEST.generations, event: transfer, fromBlock: 0n, toBlock: head }), /owner-filtered/);
  await assert.rejects(client.getLogs({ address: other, event: transfer, args: { to: account }, fromBlock: 0n, toBlock: head }), /owner-filtered/);
  assert.equal(f.ranges.length, 0);
});

test('cancellation releases a stalled discovery and prevents additional pages', async () => {
  const f = fixture('generations'), controller = new AbortController();
  let calls = 0;
  const client = withArcadeHistory({ ...f.client, getLogs: (() => { calls++; return new Promise(() => {}); }) as typeof f.client.getLogs }, controller.signal);
  const pending = client.getLogs({ address: GENERATION_SPRITE_MANIFEST.generations, event: transfer, args: { to: account }, fromBlock: 0n, toBlock: head });
  controller.abort(new Error('Wallet changed'));
  await assert.rejects(pending, /Wallet changed/);
  assert.equal(calls, 2);
});
