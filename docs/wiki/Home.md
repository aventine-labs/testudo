# 🛡️ Welcome to the Unified Testudo™ Wiki (`Testudo-JS` & `Testudo-JMX`)

Welcome to the official technical wiki for the **Testudo™ Testing Suite** by Aventine Labs LLC. Named after the ancient Roman defensive shield formation, Testudo unifies two open-source verification engines under the Apache 2.0 License:

1. **Shield 1: Testudo-JS™ (`@aventine/testudo` v0.2.3)** - Zero-dependency in-browser DOM exploration, single-click uniqueness guarantees, framework-safe typing (`_valueTracker` bypass), multi-cell financial calculus, and visual error forensics for Playwright, Puppeteer, and synthetic transaction monitors.
2. **Shield 2: Testudo-JMX™ (`@aventine/testudo-jmx` v1.0.0)** - Single-binary native Go execution engine, 60 FPS Web Flight Deck (`localhost:3014`), and RegexForge™ WASM auto-correlation enclave for Apache JMeter (`.jmx`) workloads.

---

## 📸 Visual Screengrab Gallery (Testudo-JS & Testudo-JMX)

### A. Testudo-JS (`@aventine/testudo`) Visual Forensics & DOM Explorer

#### 1. Multi-Cell Financial Calculus & Character-Level Diff HUD (`$T.visual` & `$T.calc`)
![Testudo-JS Multi-Cell Financial Calculus & Diff HUD](https://raw.githubusercontent.com/aventine-labs/testudo/main/assets/screenshots/testudo_fintech_full_settlement_screengrab.png)

#### 2. Automated High-DPI Bounding-Box Union Crop & Zoomed Diff Callout
![Testudo-JS Tight Calculus Crop](https://raw.githubusercontent.com/aventine-labs/testudo/main/assets/screenshots/testudo_calculus_tight_crop.png)

![Testudo-JS Zoomed Character Diff Callout](https://raw.githubusercontent.com/aventine-labs/testudo/main/assets/screenshots/testudo_zoomed_diff_callout.png)

#### 3. Interactive DOM Explorer & Smart Scoping Badges (`$T.explore` & `$T.scan`)
![Testudo-JS DOM Explorer Blotter Screengrab](https://raw.githubusercontent.com/aventine-labs/testudo/main/assets/screenshots/testudo_dom_explorer_blotter_screengrab.png)

![Testudo-JS DOM Explorer Tight Crop](https://raw.githubusercontent.com/aventine-labs/testudo/main/assets/screenshots/testudo_dom_explorer_tight_crop.png)

---

### B. Testudo-JMX (`@aventine/testudo-jmx`) Flight Deck & Head-to-Head JMeter Benchmarks

#### 1. Empirical Head-to-Head Benchmark: Apache JMeter 5.6.3 vs Testudo-JMX 1.0.0
![Head-to-Head Benchmark Infographic: Apache JMeter vs Testudo-JMX](https://raw.githubusercontent.com/aventine-labs/testudo/main/docs/wiki/visualizations/testudo_jmeter_head_to_head_infographic.png)

#### 2. Resident Memory (VmRSS) & Throughput / Tail-Latency Parity
![Resident Memory Comparison](https://raw.githubusercontent.com/aventine-labs/testudo/main/docs/wiki/visualizations/01_memory_rss_comparison.png)

![Throughput and Latency Parity](https://raw.githubusercontent.com/aventine-labs/testudo/main/docs/wiki/visualizations/02_throughput_and_latency_parity.png)

#### 3. 60 FPS Web Flight Deck GUI (`localhost:3014`)
![Testudo-JMX Tab 1: Plan Studio & Auto-Correlator](https://raw.githubusercontent.com/aventine-labs/testudo/main/assets/screenshots/testudo_jmx_tab1_plan_studio.png)

![Testudo-JMX Tab 2: Live Web Flight Deck & Concurrency Steering](https://raw.githubusercontent.com/aventine-labs/testudo/main/assets/screenshots/testudo_jmx_tab2_flight_deck.png)

![Testudo-JMX Tab 3: Historical Run Ledger & Comparison](https://raw.githubusercontent.com/aventine-labs/testudo/main/assets/screenshots/testudo_jmx_tab3_run_history.png)

---

## ⚡ Quickstarts

### 1. Testudo-JS (`@aventine/testudo`) Quickstart

```bash
npm install @aventine/testudo
```

```typescript
import { test as base, expect } from '@playwright/test';
import { testudoFixture } from '@aventine/testudo/playwright';
import { testudoMatchers } from '@aventine/testudo/matchers';

expect.extend(testudoMatchers);
export const test = base.extend(testudoFixture);

test('validate checkout invoice, select dropdown, and single-click', async ({ page, $T }) => {
  await page.goto('https://app.example.com/checkout');
  await $T('#phone').type('5551234567', { mask: 'phone' });
  await $T('#asset-filter').select('structured-credit');
  await $T('#btn-recalc').click();
  await expect(page.locator('#balance')).toEqualCurrency('$1,250.00', { tolerance: 0.01 });
});
```

### 2. Testudo-JMX (`@aventine/testudo-jmx`) Quickstart

```bash
# Run any unmodified Apache JMeter (.jmx) plan natively without Java
npx @aventine/testudo-jmx -n -t scenario.jmx -l results.jtl -e -o ./report

# Launch the 60 FPS Web Flight Deck GUI on http://localhost:3014
npx @aventine/testudo-jmx -gui
```

---

## 📚 Unified Documentation Index

### Part I: Testudo-JS (`@aventine/testudo`)
* [Architecture & Philosophy](Architecture-and-Philosophy)
* [Visual Forensics & HUD](Visual-Forensics-and-HUD)
* [DOM Explorer & Smart Scoping](DOM-Explorer-and-Smart-Scoping)
* [Framework-Safe Typing](Framework-Safe-Typing)
* [Financial Math Engine](Financial-Math-Engine)
* [Format & Currency Parser](Format-and-Currency-Parser)
* [Linear Character Diff](Linear-Character-Diff)
* [Playwright Integration & Matchers](Playwright-Integration-and-Matchers)
* [Standalone Browser & Synthetics](Standalone-Browser-and-Synthetics)
* [High-Concurrency Load Testing Engine](Load-Testing-Engine)

### Part II: Testudo-JMX (`@aventine/testudo-jmx`)
* [01. What Testudo-JMX Does](01_WHAT_IT_DOES)
* [02. Why Testudo-JMX Does It](02_WHY_IT_DOES_IT)
* [03. How To Do It (CLI, API & Flight Deck)](03_HOW_TO_DO_IT)
* [04. RegexForge Auto-Correlation Recipes](04_REGEXFORGE_RECIPES)
* [05. JMeter to Testudo-JMX Migration Guide](05_MIGRATION_GUIDE)
* [06. Running 50,000 VUs from a Laptop](06_RUNNING_50K_VUS_FROM_A_LAPTOP)
* [07. Head-to-Head JMeter Benchmark Report](07_HEAD_TO_HEAD_JMETER_BENCHMARK)
* [08. Plugin Architecture Specification](08_PLUGIN_ARCHITECTURE_SPECIFICATION)
* [09. Testudo Scudo Architecture Specification](09_TESTUDO_SCUDO_ARCHITECTURE_SPECIFICATION)
