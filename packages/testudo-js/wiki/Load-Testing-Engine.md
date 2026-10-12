# High-Concurrency Load Testing Engine (`AventineLoadEngine.py`)

Testudo includes a free, multi-threaded high-concurrency Python load testing engine (`engines/python/AventineLoadEngine.py`) designed to stress-test web applications, APIs, and microservices with microsecond latency precision.

---

## 1. Why Free Load Testing Matters

Modern engineering teams face an expensive dilemma:

- They write functional E2E tests in Playwright or Cypress for free.
- But when they need to verify if their infrastructure can handle 50,000 concurrent users for a launch, commercial load testing platforms (BlazeMeter, LoadNinja, k6 Cloud) charge thousands of dollars per month.
- Teams are forced to spend weeks manually rewriting their browser tests into JMeter XML or k6 JavaScript.

Testudo bridges this gap by bundling a high-throughput load testing engine directly into the repository for free.

---

## 2. Key Engine Capabilities

### Microsecond Latency Breakdown

Standard HTTP clients only report total request duration. `AventineLoadEngine.py` uses low-level socket instrumentation (`time.perf_counter_ns`) to decompose every transaction into its constituent network phases:

- **DNS Resolution Time**: Measuring DNS lookup latency.
- **TCP Handshake Time**: Measuring 3-way SYN/ACK connection latency.
- **TLS/SSL Handshake Time**: Measuring cryptographic negotiation latency.
- **Time to First Byte (TTFB)**: Measuring server processing latency before initial response byte.
- **Total Transaction Duration**: End-to-end completion time.

### Statistical Percentile SLAs

The engine automatically computes p50, p90, p95, and p99 percentiles across thousands of requests to catch tail latency spikes.

### Dynamic Auto-Correlation

In real-world applications, user journeys require passing session cookies and CSRF tokens from one step to the next. The engine's built-in `CorrelationExtractor` extracts tokens from response headers, cookies, or JSON bodies and injects them into downstream requests.

---

## 3. CLI Usage & Options

### Single Target Stress Test

```bash
# Run 50 concurrent workers against an endpoint for 30 seconds
python3 engines/python/AventineLoadEngine.py --url https://app.example.com/api/health --workers 50 --duration 30
```

### Multi-Step Scenario Execution

```bash
# Execute a multi-step user journey from a scenario JSON file
python3 engines/python/AventineLoadEngine.py --scenario scenario.json --workers 100 --duration 60 --csv results.csv
```

### Supported Arguments

| Flag         | Default | Description                                |
| :----------- | :------ | :----------------------------------------- |
| `--url`      | None    | Target URL to test.                        |
| `--scenario` | None    | Path to a declarative JSON scenario file.  |
| `--workers`  | `10`    | Number of concurrent worker threads.       |
| `--duration` | `30`    | Test duration in seconds.                  |
| `--headers`  | None    | Custom headers as JSON string.             |
| `--csv`      | None    | Path to export raw request metrics to CSV. |

---

## 4. Sample Terminal Report

```text
================================================================================
                      AVENTINE LOAD ENGINE BENCHMARK REPORT
================================================================================
Target URL:        https://app.example.com/checkout
Concurrent Workers: 50
Test Duration:      30.00s
Total Requests:     14,820 (494.00 RPS)
Successful (2xx):   14,802 (99.88%)
Failed / Errored:   18 (0.12%)

LATENCY WATERFALL PERCENTILES (Microseconds):
+----------------------+------------+------------+------------+------------+
| Metric               | p50 (Med)  | p90        | p95        | p99        |
+----------------------+------------+------------+------------+------------+
| DNS Resolution       | 1,240 µs   | 2,150 µs   | 3,100 µs   | 6,400 µs   |
| TCP Handshake        | 8,420 µs   | 11,200 µs  | 14,800 µs  | 22,500 µs  |
| TLS Handshake        | 16,100 µs  | 21,400 µs  | 28,900 µs  | 42,100 µs  |
| Time to First Byte   | 24,500 µs  | 36,800 µs  | 45,200 µs  | 78,400 µs  |
| Total Request Time   | 52,100 µs  | 73,400 µs  | 92,100 µs  | 152,000 µs |
+----------------------+------------+------------+------------+------------+
================================================================================
```

---

## 5. Load Testing Recorder & Converter Roadmap

Upcoming releases will integrate:

1. **`npx testudo record`**: An in-browser CDP recording bridge that records live browser clicks and network traffic, automatically producing runnable scenario JSON files.
2. **`npx testudo convert <spec>`**: Translates existing Playwright test files directly into high-concurrency `AventineLoadEngine` load scripts with zero manual rewriting.
