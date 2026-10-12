# 03. How To Do It: Operational & Developer Guide

Testudo-JMX can be executed through npm, directly via native binary, programmatically in TypeScript/JavaScript, or in headless worker daemon mode.

---

## 1. Quickstart via npm / npx

### A. Run Immediately with `npx`
Run an existing JMeter test plan without installation:
```bash
npx @aventine/testudo-jmx -t fixtures/login_flow.jmx -g -p 3014
```

### B. Global CLI Installation
```bash
npm install -g @aventine/testudo-jmx
```
Verify the installation:
```bash
testudo-jmx -version
```

---

## 2. CLI Execution Examples

### Headless Load Run (Standard CLI Mode)
```bash
testudo-jmx -n -t plan.jmx -l results.jtl -e -o ./report
```

### Override Virtual Users and Duration Mid-Flight
Override the plan's thread count and duration without editing the XML:
```bash
testudo-jmx -n -t plan.jmx -u 500 -d 10m -l results.jtl
```

### Force Keep-Alive Socket Recycling
```bash
testudo-jmx -n -t plan.jmx -k FORCE_ON -recycle
```

### Export Real-Time Prometheus Metrics
```bash
testudo-jmx -n -t plan.jmx -prometheus-port 9090
```
Metrics are served at `http://localhost:9090/metrics` in Prometheus format.

---

## 3. Web Flight Deck GUI (`-g`)

Launch the real-time operational dashboard on port 3014:
```bash
testudo-jmx -t plan.jmx -g -p 3014
```
Open `http://localhost:3014` in any browser:
* **Tactile Concurrency Steering**: Click `[ 0.5x ]`, `[ 1x ]`, `[ 2x Double ]`, `[ 5x ]`, `[ 10x ]` to dynamically step up virtual user concurrency live during the run.
* **1-Click Auto-Correlation**: Switch to the **Plan Studio & RegexForge** tab, review detected dynamic tokens, and click **Auto-Correlate Plan**.

---

## 4. Programmatic Node.js / TypeScript Integration

Install as a development dependency:
```bash
npm install --save-dev @aventine/testudo-jmx
```

Execute inside Playwright, Jest, or custom CI scripts:
```typescript
import { runPlan } from '@aventine/testudo-jmx';

async function executeLoadStage() {
  const result = await runPlan('fixtures/ecommerce_flow.jmx', {
    users: 250,
    duration: '5m',
    jtlPath: 'results.jtl',
    reportDir: './reports'
  });

  if (result.status !== 0) {
    console.error('Test run failed:', result.stderr);
    process.exit(1);
  }

  console.log('Load test completed successfully.');
}
```

---

## 5. Headless Worker Daemon Mode

To deploy Testudo-JMX as a distributed worker leaf driven by external orchestrators:
```bash
testudo-jmx -worker -worker-port 9091 -mesh-telemetry 127.0.0.1:8210
```

Worker HTTP Control Endpoints:
* `GET  /health` -> Health status, active VUs, and memory metrics.
* `POST /api/worker/run` -> Dispatches JMX plan with assigned VU slice.
* `POST /api/worker/stop` -> Gracefully drains active workers.
* `GET  /api/worker/metrics` -> Returns current RPS and p50-p99 latency percentiles.
