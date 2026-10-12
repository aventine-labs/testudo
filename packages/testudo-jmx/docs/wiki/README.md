# 🛡️ Testudo-JMX™ Official Wiki & Documentation

Welcome to the official technical documentation for **Testudo-JMX™**, the free, open-source native Go execution engine, Web Flight Deck, and auto-correlation enclave for Apache JMeter (`.jmx`) workloads.

---

## Documentation Index

1. [01. What It Does](./01_WHAT_IT_DOES.md)
   * Executive Overview & Capabilities
   * Drop-in JMeter CLI Parity (`-n -t scenario.jmx -l results.jtl -e -o ./report`)
   * 60 FPS Web Flight Deck GUI (`localhost:3014`)
   * Bundled RegexForge™ WASM Auto-Correlator
   * Headless Worker Daemon & Off-TCP UDP Telemetry
   * Dual-Track Licensing Boundaries (Apache-2.0 vs Enterprise)

2. [02. Why It Does It](./02_WHY_IT_DOES_IT.md)
   * The JVM Garbage Collection Tax (Eliminating Stop-the-World p99 distortion)
   * Concurrency Density & Memory Footprint (22 MB RSS vs JMeter 310 MB RSS)
   * Ephemeral Socket Pooling & Keep-Alive Recycling
   * Deterministic Linear Time RE2 vs Catastrophic Backtracking (ReDoS)

3. [03. How To Do It (User & Operational Guides)](./03_HOW_TO_DO_IT.md)
   * Instant Global Execution via `npx` & `npm install -g @aventine/testudo-jmx`
   * TypeScript & Node.js Programmatic API (`import { runPlan } from '@aventine/testudo-jmx'`)
   * Headless CLI Load Testing & Custom Flag Overrides
   * Interactive Concurrency Steering in the Web Flight Deck
   * Prometheus, InfluxDB, and Grafana Metrics Export
   * Multi-Node Worker Deployment (`-worker -worker-port 9091`)

4. [04. RegexForge™ Auto-Correlation & Enterprise Recipes](./04_REGEXFORGE_RECIPES.md)
   * Dynamic Token Auto-Detection Architecture
   * 23 Supported Enterprise Framework Recipes (ASP.NET, Magento, Laravel, Rails, Django, OAuth2)
   * ReDoS Immune Thompson NFA Engine
   * Direct Link to the Zero-Telemetry Visual Studio: [aventinelabs.com/forges/regex](https://aventinelabs.com/forges/regex)

5. [05. Migration Guide: From Apache JMeter to Testudo-JMX](./05_MIGRATION_GUIDE.md)
   * 1-Click Drop-In Execution of Unmodified `.jmx` Files
   * Supported Samplers, Controllers, Extractors & Timers
   * CI/CD Pipeline Migration (GitHub Actions, GitLab CI, Jenkins)

6. [06. Engineering Advisory: Running 50,000 VUs from a Laptop](./06_RUNNING_50K_VUS_FROM_A_LAPTOP.md)
   * The Reality of Single-Node vs Distributed Multi-Cloud Testing
   * One-Sided Egress Bottlenecks & Missing Internet Latency Variance
   * Local Router NAT Table Exhaustion & Kernel Socket Buffer Tuning
   * When Single-Node Density is Ideal (DB Contention, Memory Leaks, Query Optimization)

7. [07. Head-to-Head JMeter Benchmark Report & Visualizations](./07_HEAD_TO_HEAD_JMETER_BENCHMARK.md)
   * Empirical 10-Tier Concurrency Ladder on Magento 2 Storefront (VU 2 to VU 50)
   * High-Resolution Visualizations (Infographic, Resident Memory VmRSS, Throughput & Latency Parity)
   * Mathematical Parity: Identical Throughput and Error Rates
   * 33.1x Memory Reduction (22.4 MB vs 740.7 MB RSS)
   * Gunther Universal Scalability Law (USL) Saturation Knee Analysis

---

## Printable Document PDF Manual

For offline reading, enterprise compliance reviews, and air-gapped team handoffs, compile or download the complete manual:
* Location: [docs/Testudo_JMX_Enterprise_Manual.pdf](../Testudo_JMX_Enterprise_Manual.pdf)
