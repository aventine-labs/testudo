<div align="center">
  <img src="./assets/testudo_mascot_master.png" width="180" height="180" alt="Testudo Mascot" />
  <h1>@aventine/testudo</h1>
  <p><strong>The Zero-Dependency Master of Test Suites</strong></p>
  <p>High-Precision Financial Math, Framework-Safe Typing, and In-Browser Visual Forensics for Playwright, Puppeteer, and Synthetic Monitors.</p>

  <p>
    <a href="https://github.com/aventine-labs/testudo/actions"><img src="https://img.shields.io/badge/tests-19%2F19%20passing-brightgreen?style=flat-square" alt="Tests"></a>
    <a href="https://www.npmjs.com/package/@aventine/testudo"><img src="https://img.shields.io/badge/dependencies-0-success?style=flat-square" alt="Dependencies"></a>
    <a href="https://github.com/aventine-labs/testudo/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License"></a>
    <img src="https://img.shields.io/badge/size-%3C5KB%20gzip-informational?style=flat-square" alt="Bundle Size">
  </p>
</div>

---

## What is Testudo?

Testudo (`$T`) is an ultra-lightweight, zero-dependency browser testing utility and forensic shield designed to eliminate the brittle edge cases that consume 90% of a QA engineer's debugging time:

1. **Penny Rounding & Float Drift**: Compare numbers and currencies with allowable tolerance (`isCloseTo`, `0.1 + 0.2 === 0.3`).
2. **Framework Synthetic Setter Bypass**: Type directly into React, Vue, and Angular inputs without losing internal component state (`_valueTracker` bypass).
3. **Visual Error Forensics**: Highlight failing elements in glowing neon red with a character-level diff HUD, automatically attaching screenshots directly to Playwright HTML Reports.
4. **Smart Scope DOM Explorer**: Instant DOM scanning for junior testers (`$T.scan('contact')`) generating copy-paste Playwright snippets.
5. **Universal Currency Parsing**: Ingest European commas (`1.249,50 €`), SAP trailing minuses (`1.249,50- EUR`), and accounting parens (`(€1,249.50)`) into clean numbers.
6. **Whitespace Normalization**: Automatically converts invisible narrow non-breaking spaces (`\u202F`, `\u00A0`) into standard ASCII space (`\u0020`).
7. **Free High-Concurrency Load Testing Engine**: Includes `AventineLoadEngine.py` under `engines/python/` for running multi-threaded load tests with microsecond DNS/TLS/TTFB breakdown with zero cloud fees.

---

## Installation

```bash
npm install @aventine/testudo
```

Or drop directly into synthetic transaction monitors (Apica, Datadog Synthetics) via CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/@aventine/testudo/dist/adapters/standalone.js"></script>
```

---

## 1-Minute Playwright Quickstart

Extend Playwright's native `expect` with custom Testudo matchers:

```typescript
// playwright.config.ts or test file
import { test as base, expect } from '@playwright/test';
import { testudoFixture } from '@aventine/testudo/playwright';
import { testudoMatchers } from '@aventine/testudo/matchers';

// Register custom matchers on Playwright expect
expect.extend(testudoMatchers);

// Extend Playwright test runner with pre-wired $T fixture
export const test = base.extend(testudoFixture);

test('validate checkout balance and masks', async ({ page, $T }) => {
  await page.goto('https://app.example.com/checkout');

  // 1. Framework-safe typing with credit card mask
  await $T('#card-number').type('4111222233334444', { mask: 'creditCard' });

  // 2. High-precision financial tolerance assertion
  await expect(page.locator('#invoice-total')).toEqualCurrency('$1,250.00', { tolerance: 0.01 });
});
```

---

## Core Feature Showcase

### 1. Financial Math with Allowable Tolerance

Prevent brittle test failures caused by floating point drift or rounding differences:

```javascript
import { math, format } from '@aventine/testudo';

// Float precision equality with epsilon
math.eq(0.1 + 0.2, 0.3); // => true

// Closeness check within 1 penny
math.isCloseTo(1249.99, 1250.0, 0.01); // => true

// Excel pattern formatting
format.pattern(1249.5, '€#.##0,00'); // => "€1.249,50"

// Universal parsing
format.parse('(€1,249.50)'); // => -1249.50
format.parse('1.249,50- EUR'); // => -1249.50
format.parse('1 249,50 €'); // => 1249.50
```

### 2. Framework-Safe Typing (`$T.type`)

React and Vue intercept native property setters. Setting `input.value = "foo"` directly often fails to trigger component state changes. Testudo bypasses prototype trackers and dispatches the full event lifecycle:

```javascript
await $T('#phone').type('5551234567', {
  mask: 'phone',
  delay: 20, // Optional human typing cadence simulation
  jitter: 5
});
// Result: React state updates to "(555) 123-4567"
```

### 3. Visual Error Forensics & Character Diff HUD

When an assertion fails, Testudo does not just throw text. It highlights the target element in glowing neon red, centers the viewport, and renders a character-level diff:

```text
+--------------------------------------------------------------+
| [TESTUDO FAIL] Assertion Failed                              |
| Unexpected '-' at index 4 (expected 'E')                     |
+--------------------------------------------------------------+
```

- **Input Mode**: Uses a non-destructive absolute-positioned ghost overlay over `<input>` elements. Zero React hydration breakage.
- **Read Mode**: Uses native `Range.getBoundingClientRect()` for sub-pixel character accuracy across variable web fonts and emojis.

### 4. Interactive DOM Explorer (`$T.scan`)

Designed for junior testers exploring a complex web application:

```javascript
// Smart Scope: Accepts plain words or selectors
$T.scan('contact');
```

Output in DevTools Console:

```text
[TESTUDO SCOPED SCAN] Target Scope: <form id="contact-form">
Found 3 Interactive Elements inside Scope:

├── [1] <input name="fullName"> (Text Field)
│       Snippet: await $T('#contact-form input[name="fullName"]').type('Mark Gilbert');
│
├── [2] <input name="email"> (Email Field)
│       Snippet: await $T('#contact-form input[name="email"]').type('mark@example.com');
│
└── [3] <button type="submit"> (Button)
        Snippet: await $T('#contact-form button[type="submit"]').click();
```

### 5. Free High-Concurrency Load Testing Engine

Included directly in the repository under `engines/python/AventineLoadEngine.py` to eliminate expensive SaaS load testing bills:

```bash
# Run multi-threaded load test with 50 concurrent workers for 30 seconds
python3 engines/python/AventineLoadEngine.py --url https://app.example.com --workers 50 --duration 30
```

- **Microsecond Latency Breakdown**: Separate DNS, TCP handshake, TLS negotiation, and TTFB metrics.
- **SLA Percentiles**: Accurate p50, p90, p95, and p99 percentile computation.
- **Auto-Correlation**: Built-in cookie and dynamic token extraction.

---

## 🛡️ Part of the Aventine Labs Sovereign Developer Suite

`@aventine/testudo` is part of Aventine Labs' open ecosystem of 100% client-side, zero-telemetry engineering workbenches. All tools execute purely in your browser's WebAssembly sandbox with zero network home-calls and zero server-side telemetry:

| Tool | Focus Area | Live Application |
| :--- | :--- | :--- |
| **[PromptForge™](https://aventinelabs.com/forges/prompt)** | In-browser AST prompt sanitizer and lossless bi-directional entity restorer for LLMs. | [Launch Tool](https://aventinelabs.com/forges/prompt) |
| **[JWTForge™](https://aventinelabs.com/forges/jwt)** | RFC 7519 token claims studio, header inspector, and signature verification with zero token leakage. | [Launch Tool](https://aventinelabs.com/forges/jwt) |
| **[EnvForge™](https://aventinelabs.com/forges/env)** | In-browser `.env` diff engine, secret rotation planner, and Shannon entropy scanner. | [Launch Tool](https://aventinelabs.com/forges/env) |
| **[RegexForge™](https://aventinelabs.com/forges/regex)** | ReDoS catastrophic backtracking analyzer, dialect transpiler, and visual AST sandbox. | [Launch Tool](https://aventinelabs.com/forges/regex) |
| **[CertForge™](https://aventinelabs.com/forges/cert)** | X.509 certificate chain visualizer, SAN parser, and in-browser local development Root CA generator. | [Launch Tool](https://aventinelabs.com/forges/cert) |
| **[SQLForge™](https://aventinelabs.com/forges/sql)** | EXPLAIN ANALYZE visualizer, index selectivity advisor, and N+1 query detector. | [Launch Tool](https://aventinelabs.com/forges/sql) |

👉 Explore all 16 client-side developer utilities at [aventinelabs.com/forges](https://aventinelabs.com/forges).

---

## License

Apache-2.0. Copyright (c) 2026 Aventine Labs LLC.
