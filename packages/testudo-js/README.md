<div align="center">
  <img src="https://raw.githubusercontent.com/aventine-labs/testudo/main/assets/testudo_mascot_master.png" width="180" height="180" alt="Testudo Mascot" />
  <h1>@aventine/testudo</h1>
  <p><strong>The Zero-Dependency Master of Test Suites</strong></p>
  <p>High-Precision Financial Math, Framework-Safe Typing, Single-Click Uniqueness Guarantees, and In-Browser Visual Forensics for Playwright, Puppeteer, and Synthetic Monitors.</p>

  <p>
    <a href="https://github.com/aventine-labs/testudo/actions"><img src="https://img.shields.io/badge/tests-49%2F49%20passing-brightgreen?style=flat-square" alt="Tests"></a>
    <a href="https://www.npmjs.com/package/@aventine/testudo"><img src="https://img.shields.io/npm/v/@aventine/testudo?style=flat-square&color=blue" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/@aventine/testudo"><img src="https://img.shields.io/badge/dependencies-0-success?style=flat-square" alt="Dependencies"></a>
    <a href="https://github.com/aventine-labs/testudo/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License"></a>
    <img src="https://img.shields.io/badge/size-%3C5KB%20gzip-informational?style=flat-square" alt="Bundle Size">
  </p>

  <p>
    <a href="https://github.com/aventine-labs/testudo/wiki"><strong>Official GitHub Wiki</strong></a> •
    <a href="https://github.com/aventine-labs/testudo/blob/main/docs/wiki/README.md"><strong>In-Repo Unified Wiki (Testudo-JS & Testudo-JMX)</strong></a> •
    <a href="https://github.com/aventine-labs/testudo"><strong>Monorepo Root</strong></a>
  </p>
</div>

---

## What is Testudo-JS?

Testudo (`$T`) is an ultra-lightweight, zero-dependency browser testing utility and forensic shield designed to eliminate the brittle edge cases that consume 90% of a QA engineer's debugging time:

1. **Penny Rounding & Float Drift**: Compare numbers and currencies with allowable tolerance (`isCloseTo`, `0.1 + 0.2 === 0.3`).
2. **Framework Synthetic Setter Bypass**: Type directly into React, Vue, and Angular inputs without losing internal component state (`_valueTracker` bypass) and select dropdown options (`$T('#filter').select('value')`).
3. **Single-Click & Strict Uniqueness Guarantee**: Executes exactly one native `element.click()` in standalone mode or `locator.click()` in Playwright mode (never synthesizing redundant pointer/mouse events that double-fire trading orders or toggles) and throws an explicit ambiguity error if a selector matches more than one DOM node.
4. **Visual Error Forensics (100% `textContent` Safe)**: Highlights failing elements in glowing neon red with a character-level diff HUD constructed purely via DOM nodes and `textContent` (zero `innerHTML` injection), automatically attaching forensic screenshots to Playwright HTML Reports.
5. **Smart Scope DOM Explorer**: Instant DOM scanning (`$T.scan('blotter-controls')`) stopping at the highest matching priority tier and emitting 100% standards-compliant, unique CSS selectors.
6. **Universal Currency Parsing**: Ingest European commas (`1.249,50 €`), SAP trailing minuses (`1.249,50- EUR`), and accounting parens (`(€1,249.50)`) into clean numbers.
7. **Whitespace Normalization**: Automatically converts invisible narrow non-breaking spaces (`\u202F`, `\u00A0`) into standard ASCII space (`\u0020`).

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

Extend Playwright's native `expect` with custom Testudo matchers and the in-page `page.evaluate()` bridge:

```typescript
// playwright.config.ts or test file
import { test as base, expect } from '@playwright/test';
import { testudoFixture, createPlaywrightTestudo } from '@aventine/testudo/playwright';
import { testudoMatchers } from '@aventine/testudo/matchers';

// Register custom matchers on Playwright expect
expect.extend(testudoMatchers);

// Extend Playwright test runner with pre-wired $T fixture
export const test = base.extend(testudoFixture);

test('validate checkout balance, dropdowns, and masks', async ({ page, $T }) => {
  await page.goto('https://app.example.com/checkout');

  // 1. Framework-safe typing with credit card mask
  await $T('#card-number').type('4111222233334444', { mask: 'creditCard' });

  // 2. Framework-safe select & single native click with uniqueness guard
  await $T('#asset-filter').select('structured-credit');
  await $T('#btn-recalc').click();

  // 3. High-precision financial tolerance assertion
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

### 2. Framework-Safe Typing, Selection & Single-Click (`$T.type`, `$T.select`, `$T.click`)

React and Vue intercept native property setters. Setting `input.value = "foo"` directly often fails to trigger component state changes. Testudo bypasses prototype trackers and dispatches the full event lifecycle while guaranteeing single-click execution:

```javascript
await $T('#phone').type('5551234567', {
  mask: 'phone',
  delay: 20, // Optional human typing cadence simulation
  jitter: 5
});
// Result: React state updates to "(555) 123-4567"

await $T('#asset-filter').select('structured-credit');
await $T('#btn-recalc').click(); // Executes exactly one click; throws if selector is ambiguous
```

### 3. Visual Error Forensics & Multi-Cell Financial Calculus

When an assertion fails, Testudo does not just dump unformatted text into a log. It renders an in-DOM forensic HUD using safe DOM nodes (`textContent`), centers the viewport, and highlights every contributing operand in distinct, color-coded bounding boxes:

![Testudo Visual Forensics Full Blotter](https://raw.githubusercontent.com/aventine-labs/testudo/main/assets/screenshots/testudo_fintech_full_settlement_screengrab.png)

#### Multi-Cell Financial Calculus Inspector
In enterprise accounting and prime brokerage trading (Tier-1 Clearing / Institutional Blotter style), balances depend on multiple contributing cells. Testudo highlights each operand with non-colliding colors so you can inspect the entire audit trail at a glance:

![Testudo Tight Calculus Crop](https://raw.githubusercontent.com/aventine-labs/testudo/main/assets/screenshots/testudo_calculus_tight_crop.png)

- **Operand [A] Principal**: Highlighted in Electric Cyan (`#38BDF8`).
- **Operand [B] Interest (+)**: Highlighted in Vibrant Amber (`#F59E0B`).
- **Operand [C] Regulatory Fee (-)**: Highlighted in Neon Purple (`#C084FC`).
- **Operand [D] Tax Withheld (-)**: Highlighted in Emerald Green (`#34D399`).
- **Target Live Balance**: Snapped in Pulsing Crimson (`#F43F5E`) with micro-magnified character-by-character diff callout.

> **Live Interactive Demo**: You can run and inspect this live settlement blotter by opening [`demo/fintech_settlement.html`](./demo/fintech_settlement.html) directly in any browser.

### 4. Enterprise Multi-Format Reporting (Splunk, Clean Text, ANSI, GitHub Actions)

Configure verbosity and log formatting to match your infrastructure requirements:

```javascript
import { reporter } from '@aventine/testudo';

// 1. Splunk / Datadog / Sumo Logic SIEM Format (key="value")
reporter.configure({ format: 'splunk', verbosity: 'all' });

// 2. Clean Plain Text Format (No ANSI codes, raw CI log friendly)
reporter.configure({ format: 'plain', verbosity: 'info' });

// 3. GitHub Actions Step Summary (Markdown)
reporter.configure({ format: 'github-summary', verbosity: 'error' });
```

### 5. Interactive DOM Explorer & Smart Scoping (`$T.scan` & `$T.explore`)

Testudo provides an interactive in-browser DOM exploration and scoping system that indexes all actionable elements, resolves smart containers via a deterministic 8-tier priority cascade (stopping at the highest matching tier), and generates resilient, 100% standards-compliant CSS selector snippets:

![Testudo DOM Explorer Blotter Screengrab](https://raw.githubusercontent.com/aventine-labs/testudo/main/assets/screenshots/testudo_dom_explorer_blotter_screengrab.png)

#### In-Browser Visual HUD Badges (`$T.explore`)
Running `$T.explore('blotter-controls')` injects numbered blue badges (`[1]`, `[2]`, `[3]`, ...) directly over every interactive target in the live browser:

![Testudo DOM Explorer Tight Crop](https://raw.githubusercontent.com/aventine-labs/testudo/main/assets/screenshots/testudo_dom_explorer_tight_crop.png)

- **Hovering**: Displays element details, target attributes, and the recommended selector snippet.
- **Clicking a Badge**: Automatically copies the runnable code snippet (`await $T('#btn-recalc').click();`) directly to your clipboard, flashing green with a `[✓ Copied!]` confirmation indicator.
- **Deterministic Priority Cascade Stop**: Plain English queries like `'blotter-controls'` resolve using a strict 8-level hierarchy (`data-testid` > `data-test` > `id` > `name` > `aria-label` > `heading` > `class` > `tag`) and stop immediately at the highest matching priority tier.
- **Standards-Compliant CSS Selectors & Action Mapping**: Emits `.type('example')` for inputs/textareas, `.select(...)` for `<select>` dropdowns, and `.click()` for buttons/links/tabs using standards-compliant unique CSS selectors.

> **Live Interactive Demo**: You can run and inspect this live DOM Explorer by opening [`demo/dom_explorer.html`](./demo/dom_explorer.html) directly in any browser.

```javascript
import { scan } from '@aventine/testudo';

// Smart Scope: Accepts plain words, test IDs, or standard CSS selectors
const elements = scan.scan('blotter-controls');
console.table(elements);
```

Output in DevTools Console:

```text
[TESTUDO SCOPED SCAN] Target Scope: <div data-testid="blotter-controls"> (Priority 1: data-testid matched)
Found 8 Actionable Interactive Elements:

├── [1] <input data-testid="search-input"> (Text Field)
│       Snippet: await $T('[data-testid="search-input"]').type('example');
│
├── [2] <select id="asset-filter"> (Dropdown Selector)
│       Snippet: await $T('#asset-filter').select('structured-credit');
│
├── [3] <input name="settlement-date"> (Date Field)
│       Snippet: await $T('input[name="settlement-date"]').type('example');
│
├── [4] <button role="tab"> (Filter Tab: "All Positions")
│       Snippet: await $T('[data-testid="blotter-controls"] > button:nth-of-type(1)').click();
│
├── [5] <button role="tab"> (Filter Tab: "Discrepancies")
│       Snippet: await $T('[data-testid="blotter-controls"] > button:nth-of-type(2)').click();
│
├── [6] <button id="btn-recalc"> (Recalculate Button)
│       Snippet: await $T('#btn-recalc').click();
│
├── [7] <button data-testid="flag-dispute"> (Action Button)
│       Snippet: await $T('[data-testid="flag-dispute"]').click();
│
└── [8] <button id="btn-export-csv"> (Export Button)
        Snippet: await $T('#btn-export-csv').click();
```

---

## 🛡️ Part of the Aventine Labs Sovereign Developer Suite

`@aventine/testudo` is part of Aventine Labs' open ecosystem of 100% client-side, zero-telemetry engineering workbenches:

| Tool | Focus Area | Live Application |
| :--- | :--- | :--- |
| **[PromptForge™](https://aventinelabs.com/forges/prompt)** | In-browser AST prompt sanitizer and lossless bi-directional entity restorer for LLMs. | [Launch Tool](https://aventinelabs.com/forges/prompt) |
| **[JWTForge™](https://aventinelabs.com/forges/jwt)** | RFC 7519 token claims studio, header inspector, and signature verification with zero token leakage. | [Launch Tool](https://aventinelabs.com/forges/jwt) |
| **[EnvForge™](https://aventinelabs.com/forges/env)** | In-browser `.env` diff engine, secret rotation planner, and Shannon entropy scanner. | [Launch Tool](https://aventinelabs.com/forges/env) |
| **[RegexForge™](https://aventinelabs.com/forges/regex)** | ReDoS catastrophic backtracking analyzer, dialect transpiler, and visual AST sandbox. | [Launch Tool](https://aventinelabs.com/forges/regex) |
| **[CertForge™](https://aventinelabs.com/forges/cert)** | X.509 certificate chain visualizer, SAN parser, and in-browser local development Root CA generator. | [Launch Tool](https://aventinelabs.com/forges/cert) |
| **[SQLForge™](https://aventinelabs.com/forges/sql)** | EXPLAIN ANALYZE visualizer, index selectivity advisor, and N+1 query detector. | [Launch Tool](https://aventinelabs.com/forges/sql) |

Explore all 16 client-side developer utilities at [aventinelabs.com/forges](https://aventinelabs.com/forges).

---

## License

Apache-2.0. Copyright (c) 2026 Aventine Labs LLC.
