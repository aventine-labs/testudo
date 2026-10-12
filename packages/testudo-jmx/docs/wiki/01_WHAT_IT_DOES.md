# 01. What Testudo-JMX™ Does

Testudo-JMX is a free, single-binary, drop-in native execution engine, 60 FPS real-time Web Flight Deck, and dynamic token auto-correlator for Apache JMeter test plans (`.jmx`).

---

## 1. Core Capabilities Summary

### A. 100% Drop-In Apache JMeter CLI Parity
Execute existing JMeter test plans directly without installing Java, the JVM, or legacy jar plugins:
```bash
testudo-jmx -n -t test_plan.jmx -l results.jtl -e -o ./report_output
```
All standard CLI flags (`-n`, `-t`, `-l`, `-e`, `-o`, `-v`, `-version`) behave identically to Apache JMeter 5.x.

### B. High-Density Concurrency
Sustains **50,000+ virtual users** on standard developer laptops and cloud instances using lightweight Go goroutines and a 16-way striped HTTP transport pool.

### C. 60 FPS Web Flight Deck GUI
Real-time operational dashboard served on `localhost:3014`:
* Interactive live VU concurrency stepping (`[ 0.5x ]`, `[ 1x ]`, `[ 2x Double ]`, `[ 5x ]`, `[ 10x ]`).
* Live latency percentiles (p50, p90, p95, p99, p99.9) refreshed every 500ms via lock-free atomic ring buffers.
* Real-time HTTP status distribution (2xx, 3xx, 4xx, 5xx) and request throughput (RPS).

### D. Bundled RegexForge™ WASM Auto-Correlator
Automatically scans `.jmx` test plans for un-correlated dynamic tokens (CSRF tokens, session IDs, ASP.NET ViewState, OAuth authorization codes) and injects regex extractors with a single click or CLI invocation (`-correlate`).

### E. Headless Worker Daemon & Off-TCP UDP Telemetry
Can be launched as a distributed worker leaf (`-worker -worker-port 9091`). It emits real-time latency percentiles over connectionless UDP datagrams (`-mesh-telemetry host:port`), ensuring internal telemetry never competes with load generators for ephemeral TCP sockets.

### F. Multi-Platform npm Package
Packaged and distributed directly on npm as `@aventine/testudo-jmx`:
```bash
npx @aventine/testudo-jmx -t scenario.jmx -g
```
Supported on Linux (x64, ARM64), macOS (Intel, Apple Silicon M1-M4), and Windows (x64).

---

## 2. Dual-Track Licensing Scope

Testudo enforces an unambiguous intellectual property boundary:

* **Testudo-JS™ (`packages/testudo-js`)**: Free & open-source software under the **Apache License, Version 2.0**.
* **Testudo-JMX™ (`packages/testudo-jmx`)**: Free & open-source software under the **Apache License, Version 2.0**.
* **Testudo LoadForge™ (`packages/load-forge`)**: Closed-source proprietary software owned by Aventine Labs LLC.
* **Testudo LoadTest™ / SovereignLoad™ (`packages/sovereign-load`)**: Closed-source proprietary software owned by Aventine Labs LLC.
