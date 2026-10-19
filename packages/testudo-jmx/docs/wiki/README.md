# 🛡️ Testudo™ Official Unified Wiki & Documentation (`Testudo-JS` & `Testudo-JMX`)

Welcome to the unified technical documentation hub for the **Testudo™ Testing Suite** by Aventine Labs LLC. This wiki covers **both** open-source pillars of the Testudo ecosystem in one place:

1. **Shield 1: Testudo-JS™ (`@aventine/testudo` v0.2.3)** - Zero-dependency in-browser DOM exploration, single-click uniqueness guarantees, framework-safe typing (`_valueTracker` bypass), multi-cell financial calculus, and visual error forensics for Playwright, Puppeteer, and synthetic monitors.
2. **Shield 2: Testudo-JMX™ (`@aventine/testudo-jmx` v1.0.0)** - Single-binary native Go execution engine, 60 FPS Web Flight Deck (`localhost:3014`), and RegexForge™ WASM auto-correlation enclave for Apache JMeter (`.jmx`) workloads.

---

## 📸 Visual Screengrab Gallery (Quick Access)

All product screengrabs are embedded directly below and in their respective technical guides so you never have to hunt through the repository tree.

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

## 📚 Part I: Testudo-JS™ (`@aventine/testudo`) Documentation Index

1. **[Architecture & Engineering Philosophy](./Architecture-and-Philosophy.md)**
   * Zero Runtime Dependencies (`dependencies: {}`, `< 5 KB` core gzip)
   * Two-Mode Non-Destructive DOM Highlighting (Input Mirror vs Text Range)
   * Zero Outbound Telemetry & Production Guard Kill Switch
2. **[Visual Error Forensics, Multi-Cell Calculus & HUD](./Visual-Forensics-and-HUD.md)**
   * 100% XSS-Safe DOM Node Construction (`textContent`) & Strict Color Allowlist
   * Non-Colliding Operand Color Mapping (`[A]` Cyan, `[B]` Amber, `[C]` Purple, `[D]` Emerald, Target Crimson)
   * Automated Bounding-Box Union Cropping (`computeBoundingUnion`)
3. **[Interactive DOM Explorer & Smart Scoping (`$T.scan` & `$T.explore`)](./DOM-Explorer-and-Smart-Scoping.md)**
   * In-Browser Numbered Blue Badges (`[1]`, `[2]`, `[3]`) with 1-Click Snippet Copy
   * Deterministic 8-Tier Priority Cascade (Stop-at-Highest-Match Invariant)
   * 100% Standards-Compliant CSS Selector Generation & Element-Appropriate Actions (`.type()`, `.select()`, `.click()`)
4. **[Framework-Safe Typing, Select & Single-Click Engine (`$T.type`)](./Framework-Safe-Typing.md)**
   * React/Vue `_valueTracker` Prototype Setter Bypass
   * Single Native Click Invariant (Zero Duplicate Pointer/Mouse Synthesis)
   * Built-In Input Masks (`phone`, `creditCard`, `ssn`, `date`, `currency`, `zip`)
5. **[Financial Math Engine (`$T.math`)](./Financial-Math-Engine.md)**
   * IEEE-754 Epsilon Equality, Relative Tolerance (`isCloseTo`), Half-Up Rounding, and SLA Percentiles (p50-p99)
6. **[Format & Universal Currency Parser (`$T.format`)](./Format-and-Currency-Parser.md)**
   * European Comma Formats (`1.249,50 €`), SAP Trailing Minuses (`1.249,50- EUR`), Accounting Parens (`($1,249.50)`), and NBSP Normalization
7. **[Linear Character Diff (`$T.diff`)](./Linear-Character-Diff.md)**
   * Sub-300-Byte Character Walk Divergence Scanner with Unicode Surrogate Pair Safety
8. **[Playwright Integration, In-Page Bridge & Matchers](./Playwright-Integration-and-Matchers.md)**
   * `createPlaywrightTestudo(page, testInfo)` & `ensureInPageBridge(page)` via `page.evaluate()`
   * `expect.extend(testudoMatchers)` (`toEqualCurrency`, `toEqualNumber`) with Polling Retry Safety
9. **[Standalone Browser & Synthetic Monitors](./Standalone-Browser-and-Synthetics.md)**
   * CDN Drop-In (`standalone.js`), DevTools Console Exploration, and Strict Selector Uniqueness Guard
10. **[Python High-Concurrency Load Engine (`AventineLoadEngine.py`)](./Load-Testing-Engine.md)**
    * Multi-Threaded Protocol Runner with Microsecond DNS/TLS/TTFB Breakdown

---

## 🚀 Part II: Testudo-JMX™ (`@aventine/testudo-jmx`) Documentation Index

1. **[01. What Testudo-JMX Does](./01_WHAT_IT_DOES.md)**
   * Drop-in JMeter CLI Parity (`-n -t scenario.jmx -l results.jtl -e -o ./report`)
   * 60 FPS Web Flight Deck GUI (`localhost:3014`) & Bundled RegexForge™ WASM Auto-Correlator
   * Headless Worker Daemon & Off-TCP UDP Telemetry
2. **[02. Why Testudo-JMX Does It](./02_WHY_IT_DOES_IT.md)**
   * Eliminating the JVM Garbage Collection Tax (Stop-the-World p99 distortion)
   * Concurrency Density & Memory Footprint (`22.4 MB` RSS vs JMeter `740.7 MB` RSS)
   * Deterministic Linear-Time RE2 vs Catastrophic Backtracking (ReDoS)
3. **[03. How To Do It (User & Operational Guides)](./03_HOW_TO_DO_IT.md)**
   * Instant Execution via `npx @aventine/testudo-jmx` & Programmatic TypeScript/Node.js API
   * Interactive Concurrency Steering (`[ 0.5x ]`, `[ 2x Double ]`, `[ 5x ]`, `[ 10x ]`)
   * Prometheus, InfluxDB, and Multi-Node Worker Deployment
4. **[04. RegexForge™ Auto-Correlation & Enterprise Recipes](./04_REGEXFORGE_RECIPES.md)**
   * 23 Supported Enterprise Framework Recipes (ASP.NET, Magento, Laravel, Rails, Django, OAuth2)
5. **[05. Migration Guide: From Apache JMeter to Testudo-JMX](./05_MIGRATION_GUIDE.md)**
   * 1-Click Drop-In Execution of Unmodified `.jmx` Files & CI/CD Pipeline Migration
6. **[06. Engineering Advisory: Running 50,000 VUs from a Laptop](./06_RUNNING_50K_VUS_FROM_A_LAPTOP.md)**
   * Single-Node vs Distributed Multi-Cloud Testing, NAT Table Exhaustion & Kernel Socket Tuning
7. **[07. Head-to-Head JMeter Benchmark Report & Visualizations](./07_HEAD_TO_HEAD_JMETER_BENCHMARK.md)**
   * Empirical 10-Tier Concurrency Ladder on Magento 2 Storefront (VU 2 to VU 50) & Gunther USL Analysis
8. **[08. Plugin Architecture Specification](./08_PLUGIN_ARCHITECTURE_SPECIFICATION.md)**
   * Extensible Protocol Samplers, Custom Assertions, and Telemetry Sinks
9. **[09. Testudo Scudo Architecture Specification](./09_TESTUDO_SCUDO_ARCHITECTURE_SPECIFICATION.md)**
   * Defensive Load Shielding & Coordinated Fault Injection

---

## 📄 Printable Enterprise Manual (PDF)

* [docs/Testudo_JMX_Enterprise_Manual.pdf](../Testudo_JMX_Enterprise_Manual.pdf)
