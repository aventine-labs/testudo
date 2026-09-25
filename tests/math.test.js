import test from 'node:test';
import assert from 'node:assert/strict';
import { math } from '../dist/math.js';

test('TestudoMath: Float precision equality with epsilon', () => {
  // Classic IEEE-754 drift: 0.1 + 0.2 === 0.30000000000000004
  assert.strictEqual(0.1 + 0.2 === 0.3, false, 'Native JS equality must fail');
  assert.strictEqual(math.eq(0.1 + 0.2, 0.3), true, 'Testudo math.eq must succeed');
  assert.strictEqual(math.eq(0.1 + 0.2, 0.30001, 0.0001), true, 'Tolerance check');
});

test('TestudoMath: Handles negative zero (-0 vs 0) and non-finite values', () => {
  assert.strictEqual(math.eq(-0, 0), true);
  assert.strictEqual(math.eq(0, -0), true);
  assert.strictEqual(math.eq(Infinity, Infinity), true);
  assert.strictEqual(math.eq(-Infinity, -Infinity), true);
  assert.strictEqual(math.eq(Infinity, -Infinity), false);
  assert.strictEqual(math.eq(NaN, 5), false);
  assert.strictEqual(math.isCloseTo(Infinity, Infinity), true);
});

test('TestudoMath: Currency closeness tolerance', () => {
  assert.strictEqual(math.isCloseTo(1249.99, 1250.0, 0.01), true, 'Within 1 penny');
  assert.strictEqual(math.isCloseTo(1249.98, 1250.0, 0.01), false, 'Outside 1 penny');
  assert.strictEqual(math.isCloseTo(1250.0, 1250.0, 0.0), true, 'Exact match');
});

test('TestudoMath: Rounding modes (HALF_UP, HALF_EVEN, FLOOR, CEIL)', () => {
  assert.strictEqual(math.round(124.555, 2, 'HALF_UP'), 124.56);
  assert.strictEqual(math.round(124.554, 2, 'HALF_UP'), 124.55);
  assert.strictEqual(math.round(124.555, 2, 'FLOOR'), 124.55);
  assert.strictEqual(math.round(124.551, 2, 'CEIL'), 124.56);
  // Banker's rounding (HALF_EVEN)
  assert.strictEqual(math.round(2.5, 0, 'HALF_EVEN'), 2); // rounds to even 2
  assert.strictEqual(math.round(3.5, 0, 'HALF_EVEN'), 4); // rounds to even 4
});

test('TestudoMath: Percentile calculations for SLAs', () => {
  const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.strictEqual(math.percentile(latencies, 50), 55);
  assert.strictEqual(math.percentile(latencies, 90), 91);
  assert.strictEqual(math.percentile(latencies, 100), 100);
  assert.strictEqual(math.percentile(latencies, 0), 10);
});

test('TestudoMath: Numerical rate of change (first derivative)', () => {
  const heapSamples = [100, 105, 112, 120]; // Growth rates: +5, +7, +8
  const rates = math.rateOfChange(heapSamples);
  assert.deepStrictEqual(rates, [5, 7, 8]);
});

test('TestudoMath: Moving average smoothing', () => {
  const series = [10, 20, 30, 40];
  const smoothed = math.movingAverage(series, 2);
  assert.deepStrictEqual(smoothed, [10, 15, 25, 35]);
});
