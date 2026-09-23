import assert from 'node:assert/strict';
import test from 'node:test';
import { verifierRpcUrl } from '../server/rpc-config.ts';

test('server RPC defaults only when unset and accepts an HTTPS provider credential path', () => {
  assert.equal(verifierRpcUrl(undefined), 'https://rpc.testnet.chain.robinhood.com');
  assert.equal(verifierRpcUrl('  https://robinhood-testnet.g.alchemy.com/v2/disposable-test-api-key  '),
    'https://robinhood-testnet.g.alchemy.com/v2/disposable-test-api-key');
});

test('invalid or unsafe explicit RPC configuration fails closed without echoing its value', () => {
  for (const configured of [
    '', ' ', 'not-a-url', '/v2/disposable-test-api-key',
    'http://provider.invalid/v2/disposable-test-api-key',
    'wss://provider.invalid/v2/disposable-test-api-key',
    'https://user:disposable-test-api-key@provider.invalid',
    'https://provider.invalid/v2/disposable-test-api-key#fragment',
  ]) assert.equal(verifierRpcUrl(configured), null);
});
