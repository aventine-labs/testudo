# Playwright Integration & Matchers

Testudo deeply integrates with Microsoft Playwright by extending Playwright's native `expect` assertion engine with custom financial and tolerance matchers, while pre-wiring page fixtures to automatically capture forensic screenshots on test failures.

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

## 2. Playwright Fixture (`testudoFixture`)

The official Testudo fixture extends Playwright's test runner, injecting `$T` into your test functions and wiring teardown hooks:

```typescript
// test-setup.ts or individual test file
import { test as base, expect } from '@playwright/test';
import { testudoFixture } from '@aventine/testudo/playwright';
import { testudoMatchers } from '@aventine/testudo/matchers';

expect.extend(testudoMatchers);

export const test = base.extend(testudoFixture);
```

### Using `$T` Inside Tests
```typescript
test('complete checkout flow', async ({ page, $T }) => {
  await page.goto('https://app.example.com/checkout');

  // Type phone with automatic mask
  await $T('#phone').type('5551234567', { mask: 'phone' });

  // Scan checkout section
  const buttons = $T.scan('checkout');
  console.log(`Found ${buttons.length} actionable buttons.`);

  // Assert balance with tolerance
  await expect(page.locator('#balance')).toEqualCurrency('$1,250.00');
});
```

---

## 3. Automatic Failure Forensics & HTML Report Attachment

When a test assertion fails, the Testudo fixture teardown automatically captures a high-resolution screenshot and attaches it directly to the official Playwright HTML Report:

```typescript
// Inside testudoFixture teardown
if (testInfo.status !== testInfo.expectedStatus) {
  const screenshot = await page.screenshot({ fullPage: false });
  await testInfo.attach('testudo-failure-forensics', {
    body: screenshot,
    contentType: 'image/png'
  });
}
```

In your Playwright HTML report (`npx playwright show-report`), the failure report displays:
* The glowing neon red outline around the failing element.
* The floating HUD detailing the exact character-level diff.
* The complete error stack trace.
