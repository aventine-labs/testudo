/**
 * @aventine/testudo - Playwright Fixture Adapter
 * Pre-wires page.$T and automatically attaches failure screenshots to Playwright HTML Reports.
 * Zero external dependencies.
 */

import { testudoMatchers } from '../matchers.js';
import { math } from '../math.js';
import { format } from '../format.js';
import { type } from '../type.js';
import { scan } from '../scan.js';
import { visual } from '../visual.js';

export interface TestudoFixture {
  $T: {
    math: typeof math;
    format: typeof format;
    type: typeof type;
    scan: typeof scan.scan;
    explore: typeof scan.explore;
    visual: typeof visual;
  };
}

/**
 * Playwright Fixture Definition.
 * Usage:
 *   import { test as base } from '@playwright/test';
 *   import { testudoFixture } from '@aventine/testudo/playwright';
 *   export const test = base.extend(testudoFixture);
 */
export const testudoFixture = {
  $T: async ({ page }: { page: any }, use: (r: any) => Promise<void>, testInfo: any) => {
    // 1. In-page bridge helpers
    const testudoInstance = {
      math,
      format,
      type,
      scan: (scope?: string) => scan.scan(scope),
      explore: (scope?: string) => scan.explore(scope),
      visual
    };

    // 2. Automatically register matchers on global expect if available
    try {
      const globalAny = globalThis as any;
      if (globalAny.expect && typeof globalAny.expect.extend === 'function') {
        globalAny.expect.extend(testudoMatchers);
      }
    } catch {
      // Clean fallback
    }

    // 3. Provide fixture to test runner
    await use(testudoInstance);

    // 4. Teardown hook: If test failed, capture screenshot and attach to testInfo
    if (
      testInfo &&
      testInfo.status !== testInfo.expectedStatus &&
      page &&
      typeof page.screenshot === 'function'
    ) {
      try {
        const screenshot = await page.screenshot({ fullPage: false });
        await testInfo.attach('testudo-failure-forensics', {
          body: screenshot,
          contentType: 'image/png'
        });
      } catch {
        // Safe skip if page closed
      }
    }
  }
};
