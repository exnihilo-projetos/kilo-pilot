import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addAmounts,
  assertNonNegative,
  formatBRL,
  parseAmount,
} from '../src/money.js';

test('[AC-1] parses canonical decimal strings into integer cents', () => {
  assert.equal(parseAmount('12.34'), 1234);
  assert.equal(parseAmount('12.3'), 1230);
  assert.equal(parseAmount('12'), 1200);
  assert.equal(parseAmount(' 0.05 '), 5);
});

test('[AC-1] rejects more than two decimals', () => {
  assert.throws(() => parseAmount('12.345'), { code: 'INVALID_AMOUNT' });
});

test('[AC-1] rejects non-canonical or non-string amounts', () => {
  for (const value of ['abc', '1,23', '', '1.2.3', '12.', '+12']) {
    assert.throws(() => parseAmount(value), { code: 'INVALID_AMOUNT' }, value);
  }
  assert.throws(() => parseAmount(12), { code: 'INVALID_AMOUNT' });
});

test('[AC-2] adds cents exactly without float drift', () => {
  assert.equal(addAmounts(10, 20), 30);
  assert.equal(addAmounts(1, 2, 3), 6);
  assert.equal(addAmounts(0.1 * 100, 0.2 * 100), 30);
});

test('[AC-2] treats an empty sum as zero', () => {
  assert.equal(addAmounts(), 0);
});

test('[AC-2] rejects non-integer cents', () => {
  assert.throws(() => addAmounts(1.5, 2), { code: 'INVALID_CENTS' });
});

test('[AC-3] formats integer cents as BRL', () => {
  assert.equal(formatBRL(1234).replace(/\u00a0/g, ' '), 'R$ 12,34');
  assert.equal(formatBRL(0).replace(/\u00a0/g, ' '), 'R$ 0,00');
});

test('[AC-3] formats negative amounts as BRL', () => {
  assert.match(formatBRL(-1234).replace(/\u00a0/g, ' '), /^-R\$ 12,34$/);
});

test('[AC-4] accepts zero and positive amounts', () => {
  assert.equal(assertNonNegative(0), 0);
  assert.equal(assertNonNegative(42), 42);
});

test('[AC-4] rejects negative amounts with a typed code', () => {
  assert.throws(() => assertNonNegative(-1), { code: 'NEGATIVE_AMOUNT' });
});

test('[AC-4] rejects non-integer cents', () => {
  assert.throws(() => assertNonNegative(1.5), { code: 'INVALID_CENTS' });
});
