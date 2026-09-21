import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHAIN_ID, actionBlockReason, assertWalletContext, escapeHtml, faucetReady, parseConfig } from '../src/safety.ts';
import type { Address } from 'viem';
const address = (id: number) => `0x${id.toString(16).padStart(40, '0')}` as Address;
const configured = () => parseConfig({ version: 1, chainId: CHAIN_ID, contracts: { game: address(1), rf: address(2), genesis: address(3), generations: address(4), rewardToken: address(5) }, deploymentConsoleUrl: null });
test('undeployed config is a valid read-only lab', () => {
  const config = parseConfig({ version: 1, chainId: CHAIN_ID, contracts: null, deploymentConsoleUrl: null });
  assert.equal(config.contracts, null);
  assert.equal(actionBlockReason({ account: address(6), walletChain: CHAIN_ID, verified: true, busy: false, contracts: null }), 'Contracts awaiting deployment.');
});
test('only testnet config is accepted; mainnet and local chains fail closed', () => {
  for (const chainId of [1, 4663, 31337, '46630']) assert.throws(() => parseConfig({ ...configured(), chainId }), /only supports/);
});
test('partial, duplicate and zero contract addresses are rejected', () => {
  assert.throws(() => parseConfig({ ...configured(), contracts: { game: address(1) } }), /five/);
  assert.throws(() => parseConfig({ ...configured(), contracts: { ...configured().contracts, rf: address(1) } }), /distinct/);
  assert.throws(() => parseConfig({ ...configured(), contracts: { ...configured().contracts, rf: address(0) } }), /Invalid rf/);
});
test('unexpected public fields and arbitrary operator links are rejected', () => {
  assert.throws(() => parseConfig({ ...configured(), verifierPrivateKey: 'not-a-real-key' }), /Unexpected/);
  for (const url of ['https://example.com/deploy/', '//example.com/', 'javascript:alert(1)']) assert.throws(() => parseConfig({ ...configured(), deploymentConsoleUrl: url }), /console route/);
  assert.equal(parseConfig({ ...configured(), deploymentConsoleUrl: '/deploy/' }).deploymentConsoleUrl, '/deploy/');
});
test('writes require account, verified contracts, correct chain and no pending write', () => {
  const ready = { account: address(6), walletChain: CHAIN_ID, verified: true, busy: false, contracts: configured().contracts };
  assert.equal(actionBlockReason(ready), null);
  assert.match(actionBlockReason({ ...ready, account: null })!, /Connect/);
  assert.match(actionBlockReason({ ...ready, walletChain: 4663 })!, /Switch/);
  assert.match(actionBlockReason({ ...ready, verified: false })!, /checks/);
  assert.match(actionBlockReason({ ...ready, busy: true })!, /Wait/);
});
test('fresh wallet context catches chain and account changes before sending', () => {
  assert.doesNotThrow(() => assertWalletContext(address(6), [address(6)], CHAIN_ID));
  assert.throws(() => assertWalletContext(address(6), [address(6)], 4663), /Wrong network/);
  assert.throws(() => assertWalletContext(address(6), [address(7)], CHAIN_ID), /account changed/);
  assert.throws(() => assertWalletContext(address(6), [], CHAIN_ID), /account changed/);
});
test('daily faucet availability uses chain UTC midnight boundaries', () => {
  assert.equal(faucetReady(0n, 86_399n), true);
  assert.equal(faucetReady(1n, 86_399n), false);
  assert.equal(faucetReady(1n, 86_400n), true);
  assert.equal(faucetReady(2n, 86_400n), false);
});
test('wallet and provider error strings cannot inject markup', () => {
  assert.equal(escapeHtml('<img src=x onerror="run()">'), '&lt;img src=x onerror=&quot;run()&quot;&gt;');
});
