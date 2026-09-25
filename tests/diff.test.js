import test from 'node:test';
import assert from 'node:assert/strict';
import { charDiff } from '../dist/diff.js';

test('TestudoDiff: Identical strings return null', () => {
  assert.strictEqual(charDiff('1040ES', '1040ES'), null);
  assert.strictEqual(charDiff('', ''), null);
});

test('TestudoDiff: Pinpoints exact divergence index and unexpected token', () => {
  // Classic 1040ES vs 1040-ES bug
  const diff = charDiff('1040ES', '1040-ES');
  assert.notStrictEqual(diff, null);
  assert.strictEqual(diff?.index, 4);
  assert.strictEqual(diff?.expectedChar, 'E');
  assert.strictEqual(diff?.actualChar, '-');
  assert.strictEqual(diff?.message, "Unexpected '-' at index 4 (expected 'E')");
});

test('TestudoDiff: Handles trailing character differences', () => {
  const diffExtra = charDiff('abc', 'abcd');
  assert.strictEqual(diffExtra?.index, 3);
  assert.strictEqual(diffExtra?.actualChar, 'd');
  assert.strictEqual(diffExtra?.expectedChar, '(end of string)');

  const diffMissing = charDiff('abcd', 'abc');
  assert.strictEqual(diffMissing?.index, 3);
  assert.strictEqual(diffMissing?.actualChar, '(end of string)');
  assert.strictEqual(diffMissing?.expectedChar, 'd');
});
