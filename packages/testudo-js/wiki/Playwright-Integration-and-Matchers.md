# Playwright Integration & Matchers

Testudo deeply integrates with Microsoft Playwright by extending Playwright's native `expect` assertion engine with custom financial and tolerance matchers, while providing an in-page evaluation bridge (`createPlaywrightTestudo` / `testudoFixture`) that executes DOM scanning, numbered step highlights, and failure forensics directly inside the browser `page` via `page.evaluate()`.

---

## 1. Custom Matchers (`expect.extend`)

Testudo provides custom matchers that seamlessly participate in Playwright's native polling and retry loop:

```typescript
import { expect } from '@playwright/test';
import { testudoMatchers } from '@aventine/testudo/matchers';

// Register custom matchers on global expect
expect.extend(testudoMatchers);
```

### `toEqualCurrency(expected, options)`

Asserts that a Playwright `Locator`, string, or number matches the expected currency value within an allowable tolerance:

```typescript
// Assert locator balance matches within 1 penny (default tolerance: 0.01)
await expect(page.locator('#balance')).toEqualCurrency('$1,250.00');

// Custom tolerance
await expect(page.locator('#subtotal')).toEqualCurrency('€1.249,50', { tolerance: 0.05 });

// European comma formats and SAP trailing minuses
await expect(page.locator('#refund')).toEqualCurrency('(€1,250.00)');
await expect(page.locator('#adjustment')).toEqualCurrency('1.250,00- EUR');
```

#### How Polling Retries Work Without Crashing

During React or Vue page re-renders, `locator.textContent()` can momentarily return an empty string `""` before the framework populates data.

If a custom matcher throws an uncaught exception on an empty string, Playwright aborts immediately. Testudo guards intermediate states by returning `{ pass: false, message: () => 'Element text is not yet populated' }`, allowing Playwright to continue retrying every 100ms until the timeout expires or the data settles.

### `toEqualNumber(expected, options)`

Asserts numeric equality with floating-point tolerance:

```typescript
await expect(page.locator('#tax-rate')).toEqualNumber(0.0825, { tolerance: 0.0001 });
```

---

## 2. Playwright Fixture (`testudoFixture`) & In-Page Bridge (`createPlaywrightTestudo`)

The official Testudo fixture extends Playwright's test runner, injecting `$T` into your test functions, establishing the in-page `window.__TESTUDO_BRIDGE__` via `page.evaluate()`, and wiring automatic failure screenshots:

```typescript
// test-setup.ts or individual test file
import { test as base, expect } from '@playwright/test';
import { testudoFixture, createPlaywrightTestudo } from '@aventine/testudo/playwright';
import { testudoMatchers } from '@aventine/testudo/matchers';

expect.extend(testudoMatchers);

export const test = base.extend(testudoFixture);
```

### Using `$T` Inside Playwright Tests

```typescript
test('complete checkout flow', async ({ page, $T }) => {
  await page.goto('https://app.example.com/checkout');

  // 1. Scan checkout section inside the browser DOM via page.evaluate()
  const controls = await $T.scan('checkout');
  console.log(`Found ${controls.length} actionable controls.`);

  // 2. Type phone with automatic mask (verifies uniqueness count === 1)
  await $T('#phone').type('5551234567', { mask: 'phone' });

  // 3. Select dropdown option and execute single native Playwright locator.click()
  await $T('#shipping-method').select('express');
  await $T('#btn-recalc').click();

  // 4. Assert balance with tolerance (renders in-page red HUD + diff callout on mismatch)
  await $T('#balance').assertCurrency('$1,250.00', { tolerance: 0.01 });
});
```

---

## 3. Automatic Failure Forensics & HTML Report Attachment

When an assertion fails, Testudo highlights the target DOM element in glowing neon red, renders the character-level diff HUD inside the browser page, captures a high-resolution screenshot, and attaches it directly to the Playwright HTML Report (`testudo-failure-forensics`).
