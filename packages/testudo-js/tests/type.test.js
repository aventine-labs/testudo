import test from 'node:test';
import assert from 'node:assert/strict';
import { type } from '../dist/type.js';

test('TestudoType: Input masks format correctly', () => {
  assert.strictEqual(type.applyMask('4111222233334444', 'creditCard'), '4111 2222 3333 4444');
  assert.strictEqual(type.applyMask('5551234567', 'phone'), '(555) 123-4567');
  assert.strictEqual(type.applyMask('123456789', 'ssn'), '123-45-6789');
  assert.strictEqual(type.applyMask('20260925', 'date'), '2026-09-25');
});
