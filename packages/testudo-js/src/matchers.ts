/**
 * @aventine/testudo - Playwright & Jest Custom Matchers
 * Extends Playwright expect() with toEqualCurrency, toEqualBasisPoints, and toEqualNumber assertions.
 * Zero external dependencies.
 */

import { format, MonetaryParseOptions } from './format.js';
import { math } from './math.js';
import { charDiff } from './diff.js';

export interface CurrencyMatcherOptions extends MonetaryParseOptions {
  tolerance?: number;
  message?: string;
}

export const testudoMatchers = {
  /**
   * Asserts that a Locator's text content or raw string equals an expected currency string within tolerance.
   * Fails closed on AMBIGUOUS_NUMERIC_VALUE, INVALID_NUMERIC_FORMAT, and UNIT_MISMATCH_BPS.
   */
  async toEqualCurrency(
    received: any,
    expected: string | number,
    options: CurrencyMatcherOptions = {}
  ) {
    const { tolerance = 0.01, tokenIndex, locale, applyMagnitude } = options;

    let rawText = '';

    if (received && typeof received.textContent === 'function') {
      try {
        rawText = (await received.textContent()) || '';
      } catch {
        return {
          pass: false,
          message: () => `[Testudo] Locator could not resolve text content during polling.`
        };
      }
    } else if (typeof received === 'string') {
      rawText = received;
    } else if (typeof received === 'number') {
      rawText = String(received);
    }

    if (!rawText.trim()) {
      return {
        pass: false,
        message: () => `[Testudo] Element text is empty or not yet populated by framework.`
      };
    }

    const actualVal = format.parseMonetary(rawText, { tokenIndex, locale, applyMagnitude });
    const expectedVal =
      typeof expected === 'number'
        ? expected
        : format.parseMonetary(expected, { locale, applyMagnitude });

    const delta = Math.abs(actualVal - expectedVal);
    const pass = math.isCloseTo(actualVal, expectedVal, tolerance);

    const diff =
      typeof expected === 'string' ? charDiff(expected, format.normalizeWhitespace(rawText)) : null;

    return {
      pass,
      message: () => {
        const diffInfo = diff ? `\nCharacter Diff: ${diff.message}` : '';
        return pass
          ? `Expected currency NOT to equal ${expectedVal} (within ±${tolerance}), but got ${actualVal} (raw: "${rawText}")`
          : `[Testudo Assertion Error] Expected currency: ${expectedVal} (within ±${tolerance})\n` +
              `Actual: ${actualVal} (raw: "${rawText}") | Delta: ${delta.toFixed(4)}${diffInfo}`;
      }
    };
  },

  /**
   * Asserts that a Locator or raw value equals an expected basis-points value within tolerance.
   */
  async toEqualBasisPoints(
    received: any,
    expectedBps: string | number,
    options: { tolerance?: number; tokenIndex?: number } = {}
  ) {
    const { tolerance = 0.01, tokenIndex } = options;
    let rawText = '';

    if (received && typeof received.textContent === 'function') {
      try {
        rawText = (await received.textContent()) || '';
      } catch {
        return {
          pass: false,
          message: () => `[Testudo] Locator could not resolve text content during polling.`
        };
      }
    } else if (typeof received === 'string' || typeof received === 'number') {
      rawText = String(received);
    }

    if (!rawText.trim()) {
      return {
        pass: false,
        message: () => `[Testudo] Element text is empty or not yet populated by framework.`
      };
    }

    const actual = format.parseBasisPoints(rawText, { tokenIndex });
    const expected = format.parseBasisPoints(expectedBps);
    const pass = math.isCloseTo(actual.bps, expected.bps, tolerance);

    return {
      pass,
      message: () =>
        pass
          ? `Expected basis points NOT to equal ${expected.bps} bps (within ±${tolerance}), but got ${actual.bps} bps`
          : `[Testudo Assertion Error] Expected basis points: ${expected.bps} bps (within ±${tolerance}), but got ${actual.bps} bps (raw: "${rawText}")`
    };
  },

  /**
   * Asserts that a Locator or raw value equals an expected number within floating-point tolerance.
   */
  async toEqualNumber(
    received: any,
    expected: number,
    options: { tolerance?: number; tokenIndex?: number; locale?: string } = {}
  ) {
    const { tolerance = 0.000001, tokenIndex, locale } = options;
    let rawVal = 0;

    if (received && typeof received.textContent === 'function') {
      try {
        const text = (await received.textContent()) || '';
        if (!text.trim()) {
          return {
            pass: false,
            message: () => `[Testudo] Element text is empty or not yet populated by framework.`
          };
        }
        rawVal = format.parseMonetary(text, { tokenIndex, locale });
      } catch (err: any) {
        if (err && err.code) throw err;
        return {
          pass: false,
          message: () => `[Testudo] Locator could not resolve text during polling.`
        };
      }
    } else if (typeof received === 'number') {
      rawVal = received;
    } else if (typeof received === 'string') {
      rawVal = format.parseMonetary(received, { tokenIndex, locale });
    }

    const pass = math.isCloseTo(rawVal, expected, tolerance);
    return {
      pass,
      message: () =>
        pass
          ? `Expected number NOT to equal ${expected} (within ±${tolerance}), but got ${rawVal}`
          : `[Testudo Assertion Error] Expected number: ${expected} (within ±${tolerance}), but got ${rawVal} (Delta: ${Math.abs(rawVal - expected)})`
    };
  }
};
