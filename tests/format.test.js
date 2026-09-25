import test from 'node:test';
import assert from 'node:assert/strict';
import { format } from '../dist/format.js';

test('TestudoFormat: Whitespace normalizer removes invisible NBSP characters', () => {
  const dirty = '1.249,50\u202F€\u00A0 \uFEFF';
  const clean = format.normalizeWhitespace(dirty);
  assert.strictEqual(clean, '1.249,50 €');
});

test('TestudoFormat: Excel pattern formatting', () => {
  assert.strictEqual(format.pattern(1249.50, '€#,##0.00'), '€1,249.50');
  assert.strictEqual(format.pattern(1249.50, '€#.##0,00'), '€1.249,50');
  assert.strictEqual(format.pattern(1249.50, '#.##0,00 €'), '1.249,50 €');
  assert.strictEqual(format.pattern(1249.50, 'EUR #,##0.00'), 'EUR 1,249.50');
  assert.strictEqual(format.pattern(-1249.50, '€#,##0.00'), '-€1,249.50');
});

test('TestudoFormat: Universal currency parsing across global standards', () => {
  assert.strictEqual(format.parse('€1.249,50'), 1249.50, 'Dutch/European prefix');
  assert.strictEqual(format.parse('1.249,50 €'), 1249.50, 'German/French suffix');
  assert.strictEqual(format.parse('$1,249.50'), 1249.50, 'US/UK dollar');
  assert.strictEqual(format.parse('1 249,50 €'), 1249.50, 'French thin-space thousands');
  assert.strictEqual(format.parse('(€1,249.50)'), -1249.50, 'Accounting negative parentheses');
  assert.strictEqual(format.parse('1.249,50- EUR'), -1249.50, 'SAP mainframe trailing minus');
  assert.strictEqual(format.parse('-€1.249,50'), -1249.50, 'Standard negative prefix');
  assert.strictEqual(format.parse('$ 5,420.00 USD'), 5420.00, 'Currency code combo');
});

test('TestudoFormat: Granular currency options formatting', () => {
  const result = format.currency(1249.50, {
    currency: 'EUR',
    position: 'prefix',
    decimal: ',',
    thousand: '.',
    space: false
  });
  assert.strictEqual(result, 'EUR1.249,50');
});
