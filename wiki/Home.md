# Welcome to the Testudo Wiki

Testudo (`$T`) is an ultra-lightweight, zero-dependency browser testing utility, visual forensic shield, and high-concurrency load testing suite developed by Aventine Labs.

Named after the ancient Roman defensive shield formation, Testudo armors automated end-to-end test suites (Playwright, Puppeteer, Selenium) and synthetic transaction monitors (Apica, Datadog Synthetics, Dynatrace) against the brittle edge cases that consume 90% of a QA engineer's debugging time.

---

## The Core Problem Testudo Solves

Automated browser testing often fails not because the application logic is broken, but because modern web standards introduce subtle execution anomalies:

1. **Floating-Point Rounding & Float Drift**: Intermittent test failures on currency balances, tax tables, and interest calculations due to IEEE-754 precision drift (`0.1 + 0.2 === 0.30000000000000004`).
2. **Framework Synthetic Setter Drops**: Programmatically setting `input.value = "foo"` in synthetic scripts fails because React, Vue, and Angular hook native prototype setters (`_valueTracker`), discarding automated input upon form submission.
3. **Invisible Character Differences**: Visual equality failing strict string comparison due to non-breaking spaces (`\u202F`, `\u00A0`, `\uFEFF`) common in localized European currency strings.
4. **Cryptic Assertion Failures**: CI logs reporting whole-string mismatches without pinpointing the exact character difference or capturing visual evidence in CI artifacts.
5. **Junior Tester Onboarding Friction**: Junior testers struggling to discover actionable DOM elements and construct resilient selectors on complex enterprise single-page applications.
6. **Expensive Load Testing Bills**: Enterprise teams forced to rewrite functional Playwright suites into separate load testing tools and pay thousands of dollars per month to cloud load testing platforms.

---

## Feature Overview

| Capability | Module | Description |
| :--- | :--- | :--- |
| **Financial Math** | `$T.math` | Epsilon float equality, currency penny tolerance (`isCloseTo`), negative zero handling, and statistical SLA percentiles (p50-p99). |
| **Format & Currency** | `$T.format` | Universal currency parser (`(€1,249.50)`, `1.249,50- EUR`), Excel pattern masks (`€#.##0,00`), and invisible space normalization. |
| **Framework-Safe Typing** | `$T.type` | React/Vue `_valueTracker` bypass, full synthetic event lifecycle dispatch, typing cadence jitter, and standard input masks. |
| **Linear Character Diff** | `$T.diff` | Sub-300-byte character walk divergence scanner pinpointing the exact first index of mismatch with localized context snippet. |
| **Visual Error Forensics** | `$T.visual` | Two-mode non-destructive highlighting (hidden mirror div for inputs, native Range for text), glowing neon outline, floating HUD, and SPA cleanup. |
| **Interactive DOM Explorer** | `$T.scan` | Smart Scope Resolver with deterministic priority cascade, resilient snippet generator, visual numbered badges, and production kill switch. |
| **Playwright Matchers** | `$T.matchers` | Native `expect.extend` matchers (`toEqualCurrency`, `toEqualNumber`) with polling retry support and automatic HTML report screenshot attachment. |
| **High-Concurrency Load Engine** | `AventineLoadEngine.py` | Free, multi-threaded load testing engine with microsecond DNS/TLS/TTFB breakdown and dynamic auto-correlation. |

---

## 1-Minute Quickstart

### Installation

```bash
npm install @aventine/testudo
```

### Playwright Test Example

```typescript
import { test as base, expect } from '@playwright/test';
import { testudoFixture } from '@aventine/testudo/playwright';
import { testudoMatchers } from '@aventine/testudo/matchers';

// Register custom matchers on Playwright expect
expect.extend(testudoMatchers);

// Extend test runner with pre-wired $T fixture
export const test = base.extend(testudoFixture);

test('validate checkout invoice and phone mask', async ({ page, $T }) => {
  await page.goto('https://app.example.com/checkout');

  // Framework-safe typing with automatic phone masking
  await $T('#phone').type('5551234567', { mask: 'phone' });

  // High-precision financial tolerance assertion
  await expect(page.locator('#balance')).toEqualCurrency('$1,250.00', { tolerance: 0.01 });
});
```

---

## Documentation Index

Explore the detailed engine guides in the sidebar:
* [Architecture & Philosophy](Architecture-and-Philosophy)
* [Financial Math Engine](Financial-Math-Engine)
* [Format & Currency Parser](Format-and-Currency-Parser)
* [Framework-Safe Typing](Framework-Safe-Typing)
* [Linear Character Diff](Linear-Character-Diff)
* [Visual Forensics & HUD](Visual-Forensics-and-HUD)
* [DOM Explorer & Smart Scoping](DOM-Explorer-and-Smart-Scoping)
* [Playwright Integration & Matchers](Playwright-Integration-and-Matchers)
* [Standalone Browser & Synthetics](Standalone-Browser-and-Synthetics)
* [High-Concurrency Load Testing Engine](Load-Testing-Engine)
