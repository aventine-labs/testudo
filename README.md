# 🛡️ Testudo™ Testing Suite
### Unified Defensive Software Testing: Front-End Synthetic Verification & Native Protocol Load Testing
**Parent Organization:** Aventine Labs LLC • **Open-Source License:** Apache-2.0 (Testudo-JS & Testudo-JMX only)

Testudo is an open-source testing ecosystem engineered to deliver zero-dependency, mathematically rigorous software verification. The open-source suite comprises Testudo-JS (in-browser DOM exploration and float-precision accounting math) and Testudo-JMX (high-concurrency native Apache JMeter protocol execution), licensed under the Apache License 2.0. Advanced enterprise tools (Testudo LoadForge™ and Testudo LoadTest™) are developed separately as closed-source proprietary software by Aventine Labs LLC.

---

## The Shields of Testudo

```text
                               Aventine Labs LLC
                     (Deep-Tech Research & Corporate Trust)
                                       │
                                       ▼
                                   Testudo™
              (Defensive Software Testing & Regression Suite)
                     Mascot: The Armored Tuxedo Tortoise
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
      Testudo JS™                                           Testudo-JMX™
  Front-End Precision & QA                             Native Go JMeter Engine
   (@aventine/testudo)                                (@aventine/testudo-jmx)
            │                                                     │
            ▼                                                     ▼
   [ In-Browser DOM & Math ]                            [ High-Density CLI & GUI ]
   • Smart Scoping Cascade                              • 100% JMeter CLI flag parity
   • Zero-alloc blotter math                            • 50k+ VUs on a single box
   • SAP/European currency parsing                      • Zero JVM GC tail latency tax
   • Playwright & Puppeteer adapters                    • Web Flight Deck GUI (localhost:3014)
                                                        • Off-TCP UDP telemetry streamer
```

---

## 1. Testudo-JS™ (`packages/testudo-js`)
**Package:** `@aventine/testudo` (npm) • **Runtime:** Browser / Node.js / Playwright / Puppeteer

Testudo JS provides zero-dependency front-end synthetic testing and financial assertion mathematics:
* **Smart Scoping Priority Cascade**: Pinpoint DOM elements through a 6-tier fallback heuristic (`data-testid` -> `aria-label` -> `name` -> `role` -> text content -> visual anchor).
* **High-Precision Financial Math**: Exact IEEE-754 decimal arithmetic, relative epsilon tolerances, half-up rounding, and SAP/European trailing minus currency parser.
* **Visual DOM Forensic Matchers**: Automated canvas bounding-box inspection and regression detection.
* **Zero Runtime Dependencies**: Bounded bundle size (<5KB core / <15KB full).

```bash
npm install @aventine/testudo
```

---

## 2. Testudo-JMX™ (`packages/testudo-jmx`)
**Package:** `@aventine/testudo-jmx` • **Runtime:** Native Go Single-Binary

Testudo-JMX is a 100% free, drop-in native execution engine and real-time Web Flight Deck for Apache JMeter test plans (`.jmx`):
* **Drop-In JMeter CLI Parity**: Run unmodified test plans without Java:
  ```bash
  testudo-jmx -n -t scenario.jmx -l results.jtl -e -o ./report
  ```
* **Elimination of the JVM Garbage Collection Tax**: Eliminates Stop-the-World JVM pauses that artificially inflate p99 tail latency. Delivers 14x memory reduction (22 MB vs. JMeter's 310 MB RSS).
* **Massive Concurrency Density**: Striped 16-way transport pool and sharded mutex tables sustain 50,000+ virtual users on standard developer hardware.
* **Hierarchical Page Breaks & Inner Loops**: Full support for ZebraTester page breaks and nested JMeter LoopControllers.
* **Decoupled 60 FPS Web Flight Deck**: Live operational dashboard on `localhost:3014` with tactile concurrency steering (`[ 0.5x ]`, `[ 2x Double ]`, `[ 5x ]`, `[ 10x ]`).
* **Headless Worker Daemon & Off-TCP UDP Telemetry**:
  ```bash
  testudo-jmx -worker -worker-port 9091 -mesh-telemetry 127.0.0.1:8210
  ```

### Empirical Head-to-Head Benchmark: Apache JMeter 5.6.3 vs Testudo-JMX 1.0.0
Tested against an isolated Magento 2 storefront under identical transaction flows and arrival pacing:

![Head-to-Head Benchmark Infographic: Apache JMeter vs Testudo-JMX](./benchmarks/visualizations/testudo_jmeter_head_to_head_infographic.png)

| Virtual Users | Apache JMeter Throughput | Testudo-JMX Throughput | Apache JMeter Memory (RSS) | Testudo-JMX Memory (RSS) | Memory Reduction |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **2 VUs** | 0.49 req/s | **0.49 req/s** | 238.2 MB | **23.1 MB** | **10.3x Lower (-90.3%)** |
| **10 VUs** | 2.35 req/s | **2.39 req/s** | 345.7 MB | **21.6 MB** | **16.0x Lower (-93.8%)** |
| **20 VUs** | 4.62 req/s | **4.71 req/s** | 366.1 MB | **21.4 MB** | **17.1x Lower (-94.2%)** |
| **30 VUs** | 6.93 req/s | **6.98 req/s** | 476.7 MB | **23.7 MB** | **20.1x Lower (-95.0%)** |
| **50 VUs** | 11.46 req/s | **11.55 req/s** | 740.7 MB | **22.4 MB** | **33.1x Lower (-97.0%)** |

*Full 10-tier matrix, high-resolution charts, per-URL breakdown, and Gunther USL saturation analysis available in [benchmarks/jmeter_vs_testudo_magento_benchmark.md](./benchmarks/jmeter_vs_testudo_magento_benchmark.md) and in the [Official Wiki](./docs/wiki/07_HEAD_TO_HEAD_JMETER_BENCHMARK.md).*

---

## Monorepo Quickstart

### Build All Products
```bash
make build
```

### Run All Test Suites
```bash
make test
```

### Sub-Package Workspaces
* **Testudo JS**: `cd packages/testudo-js && npm test`
* **Testudo-JMX**: `cd packages/testudo-jmx && make build && go test ./...`

---

## Dual-Track Architecture & Licensing Boundaries

The Testudo Testing Suite enforces a strict separation between open-source developer tooling and enterprise proprietary software:

### 1. Free & Open-Source (Apache License 2.0)
* **Testudo-JS™ (`packages/testudo-js`)**: 100% free and open-source software licensed under the **Apache License, Version 2.0**. Zero-dependency browser and Node.js testing.
* **Testudo-JMX™ (`packages/testudo-jmx`)**: 100% free and open-source software licensed under the **Apache License, Version 2.0**. Single-binary native Go execution engine for Apache JMeter with local Web Flight Deck.

### 2. Proprietary & Closed-Source Enterprise Tools (Commercial License)
* **Testudo LoadForge™ (`@aventine/load-forge`)**: Closed-source proprietary software. Deep in-process C++ runtime diagnostics, Linux hardware PMU counters, and Gunther Universal Scalability Law saturation knee detection.
* **Testudo LoadTest™ / SovereignLoad™ (`@aventine/sovereign-load`)**: Closed-source proprietary software. 4-Tier Hierarchical Cascade Tree (Root -> Region -> Zone -> Leaf) with $O(K)$ log-linear DDSketch histogram merging for planetary multi-cloud traffic generation.

---

## License & Trademark Notice

* **Open-Source Components**: Testudo-JS and Testudo-JMX are licensed under the [Apache License, Version 2.0](./LICENSE).
* **Proprietary Components**: Testudo LoadForge™ and Testudo LoadTest™ / SovereignLoad™ are closed-source commercial products owned exclusively by Aventine Labs LLC. All rights reserved.
* **Trademarks**: Apache, Apache JMeter, JMeter, and the Apache feather logo are trademarks or registered trademarks of the Apache Software Foundation. Testudo-JMX is an independent clean-room native implementation developed by Aventine Labs LLC and is not affiliated with, endorsed by, or sponsored by the Apache Software Foundation.
