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

## Quickstart

### Build from Source
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
