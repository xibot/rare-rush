import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseAbi, type Address, type Hex } from 'viem';
import { loadArcadeLibrary, loadArcadePortrait } from './arcade-library.ts';
import { loadArcadeFriend, type ArcadeProvider } from './arcade.ts';
import { GENESIS_DEPLOYMENT } from '../games/rare-rush/genesis/identity.ts';
import { GENERATION_SPRITE_MANIFEST } from '@rarefriends/friendsdk/sprites';

const account = '0x1111111111111111111111111111111111111111' as Address;
const other = '0x2222222222222222222222222222222222222222' as Address;
const bound = '0x3333333333333333333333333333333333333333' as Address;
const abi = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'function balanceOf(address account) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function generation(uint256 tokenId) view returns (uint8)',
  'function tokenBoundAccount(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function familyOf(uint256 tokenId) pure returns (uint8)',
  'function seedOf(uint256 tokenId) pure returns (uint32)',
  'function frames(uint8 id, uint32 seed) view returns (uint256[64])',
]);
const portrait = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path d="M0 0h8v8H0z"/></svg>').toString('base64')}`;
const metadata = `data:application/json;base64,${Buffer.from(JSON.stringify({ image: portrait })).toString('base64')}`;
function fixture(collection: 0 | 1) {
  const address = collection === 1 ? GENESIS_DEPLOYMENT.contract : GENERATION_SPRITE_MANIFEST.generations;
  const state = { account, chain: '0x1237', owner: account, balance: 2n, noLogs: false, logError: false, missing: false };
  const calls: { method: string; name?: string; id?: bigint }[] = [];
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const provider: ArcadeProvider = {
    on(event, listener) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); },
    removeListener(event, listener) { listeners.get(event)?.delete(listener); },
    async request({ method, params }) {
      calls.push({ method });
      if (method === 'eth_chainId') return state.chain;
      if (method === 'eth_accounts') return [state.account];
      if (method === 'eth_blockNumber') return '0x63';
      if (method === 'eth_getLogs') {
        const [filter] = params as [{ address: string; topics: (string | null)[]; fromBlock: string; toBlock: string }];
        assert.equal(filter.address.toLowerCase(), address.toLowerCase());
        assert.equal(filter.toBlock, '0x63');
        assert.equal(filter.fromBlock, '0x0');
        assert.ok(filter.topics[1]?.endsWith(account.slice(2)) || filter.topics[2]?.endsWith(account.slice(2)), 'Only indexed wallet history');
        if (state.logError) throw new Error('RPC history unavailable');
        if (state.noLogs || filter.topics[1]) return [];
        return [42n, 43n].map((id, index) => ({ address, blockNumber: '0x30', logIndex: `0x${index}`, transactionIndex: '0x0',
          blockHash: `0x${'aa'.repeat(32)}`, transactionHash: `0x${'bb'.repeat(32)}`, removed: false, data: '0x',
          topics: encodeEventTopics({ abi, eventName: 'Transfer', args: { from: other, to: account, tokenId: id } }) }));
      }
      assert.equal(method, 'eth_call', 'Picker and play checks never sign or spend');
      const [call, block] = params as [{ to: string; data: Hex }, string];
      const { functionName, args } = decodeFunctionData({ abi, data: call.data });
      calls.at(-1)!.name = functionName; calls.at(-1)!.id = args[0] as bigint;
      if (!['familyOf', 'seedOf', 'frames'].includes(functionName)) assert.equal(block, '0x63');
      switch (functionName) {
        case 'balanceOf': return encodeAbiParameters([{ type: 'uint256' }], [state.balance]);
        case 'ownerOf': {
          if (state.missing) throw Object.assign(new Error('execution reverted'), { code: 3, data: `0x7e273289${BigInt(args[0]).toString(16).padStart(64, '0')}` });
          return encodeAbiParameters([{ type: 'address' }], [state.owner]);
        }
        case 'generation': return encodeAbiParameters([{ type: 'uint8' }], [args[0] === 43n ? 0 : 1]);
        case 'tokenBoundAccount': return encodeAbiParameters([{ type: 'address' }], [bound]);
        case 'tokenURI': return encodeAbiParameters([{ type: 'string' }], [metadata]);
        case 'familyOf': return encodeAbiParameters([{ type: 'uint8' }], [2]);
        case 'seedOf': return encodeAbiParameters([{ type: 'uint32' }], [42]);
        case 'frames': return encodeAbiParameters([{ type: 'uint256[64]' }], [Array(64).fill(17n)]);
        default: throw new Error(`Unexpected read: ${functionName}`);
      }
    },
  };
  return { state, calls, listeners, provider };
}
const signal = () => new AbortController().signal;

test('picker finds both Genesis NFTs and only playable Generations from wallet-filtered history', async () => {
  for (const collection of [0, 1] as const) {
    const f = fixture(collection), result = await loadArcadeLibrary(f.provider, account, collection, signal());
    assert.deepEqual(result.friends.map(friend => friend.tokenId), collection === 1 ? ['42', '43'] : ['42']);
    assert.equal(result.hiddenCount, collection === 1 ? 0 : 1);
    assert.ok([...f.listeners.values()].every(set => !set.size));
    assert.ok(!f.calls.some(call => call.name === 'frames' || call.name === 'tokenURI'), 'Artwork loads separately');
  }
});

test('empty wallet is a valid empty result, RPC errors and truncated history are not', async () => {
  for (const collection of [0, 1] as const) {
    const f = fixture(collection); f.state.balance = 0n;
    assert.deepEqual((await loadArcadeLibrary(f.provider, account, collection, signal())).friends, []);
    assert.ok(!f.calls.some(call => call.method === 'eth_getLogs'));
    f.state.balance = 2n; f.state.noLogs = true;
    await assert.rejects(loadArcadeLibrary(f.provider, account, collection, signal()));
    f.state.noLogs = false; f.state.logError = true;
    await assert.rejects(loadArcadeLibrary(f.provider, account, collection, signal()));
  }
});

test('picker cancels pending reads on wallet changes and explicit cancellation', async () => {
  for (const event of ['accountsChanged', 'chainChanged', 'disconnect', 'abort'] as const) {
    const f = fixture(0), controller = new AbortController();
    const request = f.provider.request;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    f.provider.request = async args => {
      if (args.method === 'eth_getLogs') { started(); return new Promise(() => {}); }
      return request(args);
    };
    const pending = loadArcadeLibrary(f.provider, account, 0, controller.signal);
    await waiting;
    if (event === 'abort') controller.abort();
    else for (const listener of f.listeners.get(event) ?? []) listener();
    await assert.rejects(pending);
    assert.ok([...f.listeners.values()].every(set => !set.size));
  }
});

test('wrong wallet and chain cannot return a picker snapshot', async () => {
  const f = fixture(0); f.state.chain = '0x1';
  await assert.rejects(loadArcadeLibrary(f.provider, account, 0, signal()), /mainnet/);
  assert.ok(!f.calls.some(call => call.method === 'eth_call'));
  f.state.chain = '0x1237'; f.state.account = other;
  await assert.rejects(loadArcadeLibrary(f.provider, account, 0, signal()), /wallet changed/);
});

test('both collections render actual art and a picker snapshot cannot authorize a transferred Friend', async () => {
  for (const collection of [0, 1] as const) {
    const f = fixture(collection);
    await loadArcadeLibrary(f.provider, account, collection, signal());
    const art = await loadArcadePortrait(f.provider, account, collection, '42', signal());
    assert.match(art, /^data:image\/svg\+xml/);
    if (collection === 1) assert.equal(art, portrait);
    f.state.owner = other;
    await assert.rejects(loadArcadeFriend(f.provider, account, collection, '42'), /not owned|no longer owned/);
  }
});

test('manual nonexistent ID has clear mainnet guidance; RPC failure is not misreported as missing NFT', async () => {
  const f = fixture(0); f.state.missing = true;
  await assert.rejects(loadArcadeFriend(f.provider, account, 0, '1'), /Generations #1 does not exist.*Testnet NFT IDs are separate/);
  f.state.missing = false;
  const request = f.provider.request;
  f.provider.request = async args => { if (args.method === 'eth_call') throw new Error('HTTP request failed'); return request(args); };
  await assert.rejects(loadArcadeFriend(f.provider, account, 0, '42'), error => {
    assert.match((error as Error).message, /Could not check/);
    assert.doesNotMatch((error as Error).message, /does not exist/); return true;
  });
});
