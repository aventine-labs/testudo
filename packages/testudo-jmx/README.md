<p align="center">
  <img src="./assets/testudo_transparent_master.png" alt="Testudo Mascot - The Armored Tuxedo Tortoise" width="180" />
</p>

# Testudo-JMX™
### Free Single-Binary Apache JMeter Native Execution Engine & Web Flight Deck

Testudo-JMX is a 100% free, open-source, high-performance native execution engine and live operational cockpit for Apache JMeter test plans (`.jmx`). Built in Go with zero runtime dependencies, Testudo-JMX runs unmodified JMeter scenarios with 1/50th the memory footprint, zero JVM garbage collection pauses, and full flag compatibility with legacy CI/CD pipelines.

---

## The Testudo™ Testing Suite Hierarchy

Testudo-JMX represents the dedicated open-source JMeter execution branch of the broader Testudo testing ecosystem:

1. **Testudo.JS™ (`@aventine/testudo`)**: Synthetic browser testing, Smart Scoping priority cascade, visual DOM Explorer, and Playwright workflows.
2. **Testudo-JMX™ (`@aventine/testudo-jmx`)**: 100% free, open-source single-binary native Go execution engine, local Web Flight Deck, and bundled RegexForge WASM auto-correlator.
3. **LoadForge™ (`@aventine/load-forge`)**: Deep in-process runtime diagnostics, saturation knee detector, runtime shims (PHP, Python, Go, C++), and the SpiderFlow execution DAG.
4. **Loadtest™ / SovereignLoad**: Distributed high-concurrency cloud traffic mesh.

---

## Core Capabilities

* **100% Headless CLI Compatibility**: Drop-in flag parity with legacy Apache JMeter:
  ```bash
  testudo-jmx -n -t scenario.jmx -l results.jtl -e -o ./report
  ```
* **Massive Concurrency Density**: Executes 50,000+ virtual users across a lightweight goroutine pool on a single developer machine with under 150MB of RAM.
* **Elimination of the JVM Garbage Collection Tax**: Pure compiled Go eliminates Java Stop-the-World GC pauses that artificially distort p95 and p99 latency percentiles.
* **Decoupled 60 FPS Web Flight Deck GUI**: Real-time operational dashboard served on `localhost:3014`. Telemetry is sampled via lock-free atomic ring buffers without consuming load-generation CPU cycles.
* **Tactile Concurrency Steering**: Dynamically step up load mid-test using tactile controls (`[ 0.5x ]`, `[ 1x ]`, `[ 2x Double ]`, `[ 5x ]`, `[ 10x ]`) without restarting the run.
* **Configurable HTTP Keep-Alive**: Per-sampler fidelity, global overrides, session connection recycling, and OS socket reuse to prevent ephemeral port exhaustion.
* **Embedded RegexForge Auto-Correlation WASM Enclave**: 1-click automated dynamic token detection (CSRF, JWT, session cookies, ASP.NET ViewState) and linear-time $O(N)$ Thompson NFA ReDoS protection.
* **Native Telemetry Streaming**: Zero-allocation Prometheus metrics scrape endpoint (`:9090/metrics`), InfluxDB line protocol, and Splunk HEC event streaming.

---

## Empirical Benchmark: Apache JMeter 5.6.3 vs Testudo-JMX 1.0.0
Tested against an isolated Magento 2 storefront under identical transaction flows and arrival pacing:

![Head-to-Head Benchmark Infographic: Apache JMeter vs Testudo-JMX](docs/visualizations/testudo_jmeter_head_to_head_infographic.png)

| Virtual Users | Apache JMeter Throughput | Testudo-JMX Throughput | Apache JMeter Memory (RSS) | Testudo-JMX Memory (RSS) | Memory Reduction |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **2 VUs** | 0.49 req/s | **0.49 req/s** | 238.2 MB | **23.1 MB** | **10.3x Lower (-90.3%)** |
| **10 VUs** | 2.35 req/s | **2.39 req/s** | 345.7 MB | **21.6 MB** | **16.0x Lower (-93.8%)** |
| **20 VUs** | 4.62 req/s | **4.71 req/s** | 366.1 MB | **21.4 MB** | **17.1x Lower (-94.2%)** |
| **30 VUs** | 6.93 req/s | **6.98 req/s** | 476.7 MB | **23.7 MB** | **20.1x Lower (-95.0%)** |
| **50 VUs** | 11.46 req/s | **11.55 req/s** | 740.7 MB | **22.4 MB** | **33.1x Lower (-97.0%)** |

*Complete documentation, research methodology, and printable PDF manual available in [docs/wiki/](./docs/wiki/).*

---

## Installation & Quickstart

### 1. Global CLI via npm
Install the multi-platform native binary on Linux, macOS (Apple Silicon & Intel), or Windows:
```bash
npm install -g @aventine/testudo-jmx
```
Or execute directly on-demand via `npx`:
```bash
npx @aventine/testudo-jmx -t scenario.jmx -g
```

### 2. Node.js / TypeScript Programmatic API
Add as a project dependency to integrate JMeter execution directly into automated test suites (Playwright, Jest, Vitest, CI scripts):
```bash
npm install --save-dev @aventine/testudo-jmx
```

```typescript
import { runPlan, runSync } from '@aventine/testudo-jmx';

// Execute a test plan programmatically
const result = await runPlan('fixtures/scenario.jmx', {
  users: 100,
  duration: '1m',
  jtlPath: 'results.jtl',
  reportDir: './dashboard'
});

console.log('Execution finished with status:', result.status);
```

### 3. Build from Source (Go)
```bash
make build
./bin/testudo-jmx --version
```

### Run a Headless Test
```bash
./bin/testudo-jmx -n -t fixtures/login_flow.jmx -l results.jtl
```

### Launch the Web Flight Deck GUI
```bash
./bin/testudo-jmx -t fixtures/login_flow.jmx -g -p 3014
```
Then navigate to `http://localhost:3014` in any modern web browser.

---

## License & Trademark Notice

Testudo-JMX is open-source software licensed under the **Apache License, Version 2.0**. See the [LICENSE](./LICENSE) and [NOTICE](./NOTICE) files for full details.

*Apache, Apache JMeter, JMeter, and the Apache feather logo are trademarks or registered trademarks of the Apache Software Foundation. Testudo-JMX is an independent clean-room native implementation developed by Aventine Labs LLC and is not affiliated with, endorsed by, or sponsored by the Apache Software Foundation.*
