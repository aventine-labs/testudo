# AventineLoadEngine: High-Concurrency Python Load Testing Engine

`AventineLoadEngine.py` is a zero-telemetry, multi-threaded load testing engine designed to run high-concurrency performance tests with microsecond timing resolution.

---

## Key Features

1. **Microsecond Precision**: Measures DNS resolution, TCP handshake, TLS negotiation, and Time to First Byte (TTFB) using `time.perf_counter_ns`.
2. **Statistical Percentiles**: Computes p50, p90, p95, and p99 percentiles for strict SLA validation.
3. **Dynamic Correlation**: Automatically extracts and injects session cookies, CSRF tokens, and dynamic JSON values across sequential request steps.
4. **Zero Cloud Telemetry**: Executes 100% locally or inside air-gapped CI environments with zero data egress or external SaaS bills.

---

## Quickstart

Run a high-concurrency load test against a target URL:

```bash
python3 AventineLoadEngine.py --url https://app.example.com --workers 25 --duration 15
```

Execute a multi-step user journey scenario from a JSON scenario file:

```bash
python3 AventineLoadEngine.py --scenario scenario.json --workers 50 --duration 30
```

---

## License

Apache-2.0. Copyright (c) 2026 Aventine Labs LLC.
