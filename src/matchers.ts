/**
 * @aventine/testudo - Playwright & Jest Custom Matchers
 * Extends Playwright expect() with toEqualCurrency and toEqualNumber assertions.
 * Zero external dependencies.
 */

import { format } from './format.js';
import { math } from './math.js';
import { charDiff } from './diff.js';

export interface CurrencyMatcherOptions {
  tolerance?: number;
  message?: string;
}

export const testudoMatchers = {
  /**
   * Asserts that a Locator's text content or raw string equals an expected currency string within tolerance.
   * Example: await expect(page.locator('#balance')).toEqualCurrency('$1,250.00', { tolerance: 0.01 });
   */
  async toEqualCurrency(
    received: any,
    expected: string | number,
    options: CurrencyMatcherOptions = {}
  ) {
    const { tolerance = 0.01 } = options;

    let rawText = '';

    // Handle Playwright Locator vs Raw String
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

    // Guard against intermediate empty states during framework hydration
    if (!rawText.trim()) {
      return {
        pass: false,
        message: () => `[Testudo] Element text is empty or not yet populated by framework.`
      };
    }

    const actualVal = format.parse(rawText);
    const expectedVal = typeof expected === 'number' ? expected : format.parse(expected);

    const delta = Math.abs(actualVal - expectedVal);
    const pass = delta <= tolerance;

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
   * Asserts that a Locator or raw value equals an expected number within floating-point tolerance.
   */
  async toEqualNumber(received: any, expected: number, options: { tolerance?: number } = {}) {
    const { tolerance = 0.000001 } = options;
    let rawVal = 0;

    if (received && typeof received.textContent === 'function') {
      try {
        const text = (await received.textContent()) || '';
        rawVal = format.parse(text);
      } catch {
        return {
          pass: false,
          message: () => `[Testudo] Locator could not resolve text during polling.`
        };
      }
    } else if (typeof received === 'number') {
      rawVal = received;
    } else if (typeof received === 'string') {
      rawVal = format.parse(received);
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
