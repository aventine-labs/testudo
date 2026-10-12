import test from 'node:test';
import assert from 'node:assert/strict';
import { testudoMatchers } from '../dist/matchers.js';

test('TestudoMatchers: toEqualCurrency passes within allowable tolerance', async () => {
  // Within 1 penny tolerance
  const res = await testudoMatchers.toEqualCurrency('$1,249.99', '$1,250.00', { tolerance: 0.01 });
  assert.strictEqual(res.pass, true);
});

test('TestudoMatchers: toEqualCurrency fails outside tolerance', async () => {
  // Outside 1 penny tolerance
  const res = await testudoMatchers.toEqualCurrency('$1,249.98', '$1,250.00', { tolerance: 0.01 });
  assert.strictEqual(res.pass, false);
  assert.ok(res.message().includes('[Testudo Assertion Error]'));
});

test('TestudoMatchers: toEqualCurrency handles SAP trailing minus and accounting parens', async () => {
  const sap = await testudoMatchers.toEqualCurrency('1.250,00- EUR', -1250.0, { tolerance: 0.01 });
  assert.strictEqual(sap.pass, true);

  const parens = await testudoMatchers.toEqualCurrency('(€1,250.00)', -1250.0, { tolerance: 0.01 });
  assert.strictEqual(parens.pass, true);
});

test('TestudoMatchers: toEqualNumber passes with epsilon tolerance', async () => {
  const res = await testudoMatchers.toEqualNumber(0.1 + 0.2, 0.3, { tolerance: 0.000001 });
  assert.strictEqual(res.pass, true);
});
