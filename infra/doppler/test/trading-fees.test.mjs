import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zeroAddress } from 'viem';
import {
  buildFeeBeneficiaries, TESTNET_GAME_FEE_RECIPIENT,
  MAINNET_GAME_ADMIN_RECIPIENT, MAINNET_ENTRY_TREASURY_RECIPIENT,
} from '../config/trading-fees.mjs';

test('beneficiary sorting preserves each recipient share in either address order', () => {
  for (const protocol of ['0x0000000000000000000000000000000000000001', '0xffffffffffffffffffffffffffffffffffffffff']) {
    const beneficiaries = buildFeeBeneficiaries(protocol, TESTNET_GAME_FEE_RECIPIENT);
    assert.ok(BigInt(beneficiaries[0].beneficiary) < BigInt(beneficiaries[1].beneficiary));
    assert.equal(beneficiaries.find(item => item.beneficiary.toLowerCase() === protocol).shares, 50_000_000_000_000_000n);
    assert.equal(beneficiaries.find(item => item.beneficiary === TESTNET_GAME_FEE_RECIPIENT).shares, 950_000_000_000_000_000n);
    assert.equal(beneficiaries.reduce((sum, item) => sum + item.shares, 0n), 10n ** 18n);
  }
});

test('invalid or duplicate destinations fail rather than redirecting game revenue', () => {
  for (const invalid of [undefined, null, '', zeroAddress, '0x1234', 123]) {
    assert.throws(() => buildFeeBeneficiaries(invalid, TESTNET_GAME_FEE_RECIPIENT));
    assert.throws(() => buildFeeBeneficiaries(TESTNET_GAME_FEE_RECIPIENT, invalid));
  }
  assert.throws(() => buildFeeBeneficiaries(TESTNET_GAME_FEE_RECIPIENT, TESTNET_GAME_FEE_RECIPIENT.toLowerCase()));
});

test('unset mainnet destination cannot silently reuse the testnet treasury', () => {
  assert.equal(MAINNET_GAME_ADMIN_RECIPIENT, null);
  assert.equal(MAINNET_ENTRY_TREASURY_RECIPIENT, null);
  assert.throws(() => buildFeeBeneficiaries('0x0000000000000000000000000000000000000001', MAINNET_GAME_ADMIN_RECIPIENT));
});
