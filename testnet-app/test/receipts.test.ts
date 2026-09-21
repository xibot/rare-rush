import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeAbiParameters, encodeEventTopics, zeroAddress, type Address, type Hash, type Log, type TransactionReceipt } from 'viem';
import { nftAbi, tokenAbi } from '../src/abi.ts';
import { mintedIds, type PendingMint } from '../src/receipts.ts';
const account = `0x${'1'.repeat(40)}` as Address;
const contract = `0x${'2'.repeat(40)}` as Address;
const hash = `0x${'3'.repeat(64)}` as Hash;
const pending: PendingMint = { account, contract, hash, kind: 'genesis' };
const receipt = (logs: Log[] = [], overrides = {}) => ({ status: 'success', to: contract, transactionHash: hash, logs, ...overrides }) as TransactionReceipt;
const mintLog = (overrides = {}) => ({ address: contract, topics: encodeEventTopics({ abi: nftAbi, eventName: 'Transfer', args: { from: zeroAddress, to: account, tokenId: 12n } }), data: '0x', ...overrides }) as unknown as Log;
test('NFT IDs require actual mint logs from the configured collection and recipient', () => {
  assert.deepEqual(mintedIds(receipt([mintLog()]), pending), ['12']);
  assert.throws(() => mintedIds(receipt([mintLog({ address: account })]), pending), /expected test NFT mint/);
  assert.throws(() => mintedIds(receipt([]), pending), /expected test NFT mint/);
});
test('wallet cancellation and reverted transactions never become successful mint confirmations', () => {
  assert.throws(() => mintedIds(receipt([], { to: account }), pending), /replaced or cancelled/);
  assert.throws(() => mintedIds(receipt([mintLog()], { status: 'reverted' }), pending), /reverted/);
});
test('NFT transfer from an existing holder is not a mint', () => {
  const topics = encodeEventTopics({ abi: nftAbi, eventName: 'Transfer', args: { from: contract, to: account, tokenId: 12n } });
  assert.throws(() => mintedIds(receipt([mintLog({ topics })]), pending), /expected test NFT mint/);
});
test('RF confirmation requires the exact faucet event and 1100 amount', () => {
  const topics = encodeEventTopics({ abi: tokenAbi, eventName: 'FaucetClaimed', args: { recipient: account, utcDay: 1n } });
  const event = (amount: bigint) => ({ address: contract, topics, data: encodeAbiParameters([{ type: 'uint256' }], [amount]) }) as Log;
  assert.deepEqual(mintedIds(receipt([event(1100n * 10n ** 18n)]), { ...pending, kind: 'rf' }), []);
  assert.throws(() => mintedIds(receipt([event(10n)]), { ...pending, kind: 'rf' }), /expected test RF faucet/);
  assert.throws(() => mintedIds(receipt([mintLog()]), { ...pending, kind: 'rf' }), /expected test RF faucet/);
});
