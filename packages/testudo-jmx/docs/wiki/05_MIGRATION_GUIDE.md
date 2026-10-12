# 05. Migration Guide: From Apache JMeter to Testudo-JMX™

Migrating from legacy Apache JMeter to Testudo-JMX requires **zero changes to existing test plans (`.jmx`)** and minimal adjustments to CI/CD command lines.

---

## 1. CLI Command Comparison

| Task | Legacy Apache JMeter | Testudo-JMX™ |
| :--- | :--- | :--- |
| **Run Headless Test** | `jmeter -n -t scenario.jmx -l res.jtl` | `testudo-jmx -n -t scenario.jmx -l res.jtl` |
| **Generate HTML Report** | `jmeter -n -t scenario.jmx -l res.jtl -e -o ./report` | `testudo-jmx -n -t scenario.jmx -l res.jtl -e -o ./report` |
| **Override Virtual Users** | Requires `-Jthreads=100` + JMX property editing | `testudo-jmx -n -t scenario.jmx -u 100` |
| **Override Duration** | Requires property editing | `testudo-jmx -n -t scenario.jmx -d 15m` |
| **Launch Local GUI** | Launches heavy Java Swing desktop GUI | Launches 60 FPS Web GUI on `localhost:3014` (`-g -p 3014`) |
| **Auto-Correlate Plan** | Manual BlazeMeter or third-party plugin | Built-in native `-correlate` command |

---

## 2. CI/CD Pipeline Migration

### GitHub Actions Workflow

#### Before (Apache JMeter with Java Setup)
```yaml
- name: Set up Java
  uses: actions/setup-java@v3
  with:
    java-version: '17'
    distribution: 'temurin'

- name: Install JMeter
  run: |
    wget https://archive.apache.org/dist/jmeter/binaries/apache-jmeter-5.6.3.tgz
    tar -xzf apache-jmeter-5.6.3.tgz

- name: Run JMeter Load Test
  run: apache-jmeter-5.6.3/bin/jmeter -n -t test.jmx -l results.jtl
```

#### After (Testudo-JMX via npm/npx)
```yaml
- name: Set up Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20.x'

- name: Run Testudo-JMX Load Test
  run: npx @aventine/testudo-jmx -n -t test.jmx -l results.jtl -e -o ./report
```

---

## 3. Supported JMeter Plan Elements

* **Thread Groups**: Standard `ThreadGroup` with thread count, ramp-up time, and loop count.
* **HTTP Samplers**: `HTTPSamplerProxy` supporting GET, POST, PUT, DELETE, PATCH, query parameters, header managers, and raw request bodies.
* **Controllers**: `LoopController`, nested loops, and page break delimiters (ZebraTester style).
* **Extractors**: `RegexExtractor` (JMeter `$1$` template syntax), `BoundaryExtractor` (left/right string boundaries), and `JSONPostProcessor` (JSONPath queries).
* **Timers**: `ConstantTimer` and `UniformRandomTimer`.
* **Assertions**: `ResponseAssertion` (substring and regex matching on status code and response body).
