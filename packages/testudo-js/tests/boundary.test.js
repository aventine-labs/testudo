import test from 'node:test';
import assert from 'node:assert/strict';
import { math } from '../dist/math.js';
import { calc } from '../dist/calc.js';
import { format } from '../dist/format.js';
import { diff } from '../dist/diff.js';
import { TestudoReporter } from '../dist/report.js';

test('TestudoBoundary: IEEE-754 Half-Up Decimal Boundary Rounding', () => {
  // 1.005 * 100 in double precision is 100.49999999999999
  // Standard Math.round(1.005 * 100) / 100 incorrectly returns 1.00
  // Testudo exponential half-up must return 1.01
  assert.strictEqual(math.round(1.005, 2, 'HALF_UP'), 1.01, '1.005 rounded to 2 decimals must be 1.01');
  assert.strictEqual(math.round(2.555, 2, 'HALF_UP'), 2.56, '2.555 rounded to 2 decimals must be 2.56');
  assert.strictEqual(math.round(1.0005, 3, 'HALF_UP'), 1.001, '1.0005 rounded to 3 decimals must be 1.001');
  assert.strictEqual(math.round(124.555, 2, 'HALF_UP'), 124.56, '124.555 rounded to 2 decimals must be 124.56');
});

test('TestudoBoundary: High-Balance ($1B+) Relative Epsilon Tolerances', () => {
  const oneBillionA = 1000000000.00;
  // A tiny delta that exceeds absolute 0.000001 (1e-6)
  // 1e9 * 1e-6 = 1000 allowable relative drift
  const oneBillionB = 1000000000.00005; // delta is 0.00005 > 1e-6

  // Native absolute check with 1e-6 fails:
  assert.strictEqual(Math.abs(oneBillionA - oneBillionB) <= 0.000001, false);

  // Testudo math.eq with relative epsilon scales correctly for sovereign ledgers:
  assert.strictEqual(math.eq(oneBillionA, oneBillionB), true, 'Billion dollar balances scale with relative epsilon');
  assert.strictEqual(math.isCloseTo(oneBillionA, oneBillionB), true, 'isCloseTo scales with relative epsilon');
});

test('TestudoBoundary: Calc Multi-Argument Variable Arity and Zero Division', () => {
  // Variable arity: sum, avg, min, max
  assert.strictEqual(calc.evaluate('sum(10, 20, 30)'), 60);
  assert.strictEqual(calc.evaluate('sum(42)'), 42);
  assert.strictEqual(calc.evaluate('avg(10, 20, 30)'), 20);
  assert.strictEqual(calc.evaluate('avg(50)'), 50);
  assert.strictEqual(calc.evaluate('min(5, 2, 9, 1, 8)'), 1);
  assert.strictEqual(calc.evaluate('max(5, 2, 9, 1, 8)'), 9);
  assert.strictEqual(calc.evaluate('sum(10, 20) + min(3, 7)'), 33);

  // Explicit division by zero error guard:
  assert.throws(
    () => calc.evaluate('100 / 0'),
    /TestudoCalc: Division by zero in expression/
  );
  assert.throws(
    () => calc.evaluate('100 / (5 - 5)'),
    /TestudoCalc: Division by zero in expression/
  );
});

test('TestudoBoundary: Format Parsing Edge Cases (SAP Trailing Minus, Indian Grouping, Locale)', () => {
  // Case-insensitive SAP trailing minus
  assert.strictEqual(format.parseCurrency('1.249,50- EUR'), -1249.50);
  assert.strictEqual(format.parseCurrency('1.249,50- eur'), -1249.50);
  assert.strictEqual(format.parseCurrency('500.00- USD'), -500.00);

  // Indian numbering system (lakhs/crores comma grouping: 12,34,567.89)
  assert.strictEqual(format.parseCurrency('₹12,34,567.89'), 1234567.89);
  assert.strictEqual(format.parseCurrency('1,00,00,000.00 INR'), 10000000.00);

  // Disambiguation via explicit locale
  assert.strictEqual(format.parseCurrency('1.250', { locale: 'de-DE' }), 1250);
  assert.strictEqual(format.parseCurrency('1.250', { locale: 'en-US' }), 1.25);
  assert.strictEqual(format.parseCurrency('1,250', { locale: 'de-DE' }), 1.25);
  assert.strictEqual(format.parseCurrency('1,250', { locale: 'en-US' }), 1250);
});

test('TestudoBoundary: Diff Unicode Surrogate Pairs (Multi-byte Emoji)', () => {
  // UTF-16 surrogate pairs: 👍 (\ud83d\udc4d) vs 🎉 (\ud83c\udf89)
  const diffResult = diff.chars('Status: 👍 Approved', 'Status: 🎉 Approved');
  assert.strictEqual(diffResult !== null, true);
  assert.strictEqual(diffResult.index, 8);
  assert.strictEqual(diffResult.expectedChar, '👍');
  assert.strictEqual(diffResult.actualChar, '🎉');
  // Ensure the reported diff contains the intact emoji without broken half-surrogates
  assert.ok(diffResult.message.includes('👍'));
  assert.ok(diffResult.message.includes('🎉'));
});

test('TestudoBoundary: Reporter GFM Pipe/Newline Escaping and Splunk Escaping', () => {
  const reporter = new TestudoReporter({ format: 'github-summary' });

  // GFM Markdown Summary escaping
  const gfmOutput = reporter.formatGithubSummary({
    level: 'error',
    event: 'assertion_failed',
    message: 'Expected A|B split\nSecond line',
    selector: 'td[data-col="a|b"]',
    formula: 'sum(#a|1, #b|2)',
    expected: 'A|B',
    actual: 'C|D'
  });

  // Table must not break with unescaped pipes or unescaped newlines
  assert.ok(gfmOutput.includes('td[data-col="a\\|b"]'));
  assert.ok(gfmOutput.includes('sum(#a\\|1, #b\\|2)'));
  assert.ok(gfmOutput.includes('A\\|B'));
  assert.ok(gfmOutput.includes('Expected A\\|B split Second line'));

  // Splunk SIEM escaping
  const splunkReporter = new TestudoReporter({ format: 'splunk' });
  const splunkOutput = splunkReporter.formatSplunk({
    level: 'error',
    event: 'assertion_failed',
    message: 'Invalid "quote" and path C:\\vault\\data\nnewline alert',
    selector: 'input[name="user\\"name"]'
  });

  // Splunk output must be a single line
  assert.strictEqual(splunkOutput.includes('\n'), false, 'Splunk event must not contain raw newlines');
  // Backslashes and quotes must be properly escaped
  assert.ok(splunkOutput.includes('msg="Invalid \\"quote\\" and path C:\\\\vault\\\\data newline alert"'));

  // Shallow cloning test: event object passed to log() must not be mutated
  const inputEvent = {
    level: 'info',
    event: 'test_event',
    message: 'Test immutability'
  };
  reporter.log(inputEvent);
  assert.strictEqual(inputEvent.timestamp, undefined, 'Caller event must not have timestamp mutated');
});
