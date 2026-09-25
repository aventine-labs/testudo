import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TestudoReporter } from '../dist/report.js';

describe('TestudoReporter: Multi-Format Enterprise Reporting', () => {
  it('formats clean plain text output with zero ANSI escape codes', () => {
    const rep = new TestudoReporter({ verbosity: 'info', format: 'plain', includeTimestamp: false });
    const output = rep.error('Financial balance mismatch', {
      expected: '$1,250,000.00',
      actual: '$1,249,499.99',
      delta: -0.01,
      tolerance: 0.005,
      selector: '#cell-live-balance'
    });

    assert.ok(output.includes('[TESTUDO ERROR] Financial balance mismatch'));
    assert.ok(output.includes('Expected: $1,250,000.00, Actual: $1,249,499.99'));
    assert.ok(output.includes('Delta: -0.01'));
    assert.ok(output.includes('Selector: #cell-live-balance'));
    assert.ok(!output.includes('\x1b[')); // Zero ANSI codes
  });

  it('formats Splunk key-value format for enterprise SIEM ingestion', () => {
    const rep = new TestudoReporter({ verbosity: 'all', format: 'splunk', includeTimestamp: false });
    const output = rep.error('Calculus mismatch in ledger', {
      testId: 'TRD-90414',
      formula: '[A] + [B] - [C] - [D]',
      expected: '1250000.00',
      actual: '1249499.99',
      delta: -0.01,
      tolerance: 0.005,
      selector: '#cell-live-balance',
      elapsedMs: 3.42
    });

    assert.ok(output.includes('tool="testudo"'));
    assert.ok(output.includes('level="error"'));
    assert.ok(output.includes('test_id="TRD-90414"'));
    assert.ok(output.includes('formula="[A] + [B] - [C] - [D]"'));
    assert.ok(output.includes('expected="1250000.00"'));
    assert.ok(output.includes('actual="1249499.99"'));
    assert.ok(output.includes('delta="-0.01"'));
    assert.ok(output.includes('tolerance="0.005"'));
    assert.ok(output.includes('elapsed_ms=3.42'));
  });

  it('respects verbosity levels (silent drops all output)', () => {
    const rep = new TestudoReporter({ verbosity: 'silent' });
    const output = rep.error('Critical failure');
    assert.strictEqual(output, '');
  });

  it('respects verbosity hierarchy (error hides info and debug)', () => {
    const rep = new TestudoReporter({ verbosity: 'error', format: 'plain', includeTimestamp: false });
    const infoOutput = rep.info('Normal step passed');
    assert.strictEqual(infoOutput, '');

    const errorOutput = rep.error('Assertion failed');
    assert.ok(errorOutput.includes('[TESTUDO ERROR] Assertion failed'));
  });

  it('formats GitHub Actions markdown summary tables', () => {
    const rep = new TestudoReporter({ verbosity: 'all', format: 'github-summary', includeTimestamp: false });
    const output = rep.warn('Near-miss tolerance warning', {
      testId: 'BLOTTER-01',
      expected: 100.00,
      actual: 100.004,
      tolerance: 0.01
    });

    assert.ok(output.includes('### ⚠️ Testudo Forensic Report: Near-miss tolerance warning'));
    assert.ok(output.includes('| **Test ID** | `BLOTTER-01` |'));
    assert.ok(output.includes('| **Expected Value** | `100` |'));
  });
});
