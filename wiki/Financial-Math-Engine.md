# Financial Math Engine (`$T.math`)

The Testudo Math Engine provides high-precision floating-point comparisons, currency tolerance checks, financial rounding algorithms, and statistical SLA analytics with zero external dependencies.

---

## 1. Float Precision Equality (`math.eq`)

JavaScript uses standard IEEE-754 double-precision binary floating-point representation. This causes well-known precision anomalies:

```javascript
0.1 + 0.2 === 0.3; // => false (evaluates to 0.30000000000000004)
```

In automated test suites, asserting strict equality on calculated values causes intermittent test failures. `math.eq` solves this using machine epsilon comparisons:

```javascript
import { math } from '@aventine/testudo';

math.eq(0.1 + 0.2, 0.3); // => true
math.eq(10.0000001, 10.0000002, 1e-6); // => true
```

### Signature
```typescript
function eq(a: number, b: number, epsilon: number = Number.EPSILON * 10): boolean;
```

---

## 2. Currency Closeness Tolerance (`math.isCloseTo`)

When testing checkout flows, tax calculations, currency conversions, and billing tables, different backends and frontends often differ by fractions of a cent (e.g. `$1,249.99` vs `$1,250.00`).

`math.isCloseTo` asserts that two numbers are equal within a specified delta:

```javascript
import { math } from '@aventine/testudo';

// Check if balance matches expected within 1 penny
math.isCloseTo(1249.99, 1250.00, 0.01); // => true

// Negative zero (-0 vs 0) handling
math.isCloseTo(-0, 0, 0.0001); // => true
```

### Signature
```typescript
function isCloseTo(a: number, b: number, tolerance: number = 0.01): boolean;
```

---

## 3. Financial Rounding Modes (`math.round`)

Different financial backends use different rounding rules (e.g. IRS tax tables use Banker's Rounding / Half-Even, while billing ledgers use Half-Up). Standard `Math.round()` always rounds half toward positive infinity, causing test discrepancies.

Testudo supports four standard financial rounding modes:

```javascript
import { math } from '@aventine/testudo';

// HALF_UP: Standard commercial rounding (round half away from zero)
math.round(2.555, 2, 'HALF_UP'); // => 2.56

// HALF_EVEN: Banker's rounding (round half to nearest even digit, eliminates statistical bias)
math.round(2.555, 2, 'HALF_EVEN'); // => 2.56
math.round(2.545, 2, 'HALF_EVEN'); // => 2.54

// FLOOR: Always round down towards negative infinity
math.round(2.559, 2, 'FLOOR'); // => 2.55

// CEIL: Always round up towards positive infinity
math.round(2.551, 2, 'CEIL'); // => 2.56
```

### Signature
```typescript
function round(value: number, decimals: number = 2, mode: 'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL' = 'HALF_UP'): number;
```

---

## 4. Statistical SLA Percentiles (`math.percentile`)

Synthetic transaction monitors and API performance tests need to validate performance SLAs (p50, p90, p95, p99) across request latency arrays.

```javascript
import { math } from '@aventine/testudo';

const latencies = [45, 52, 55, 60, 68, 72, 85, 95, 120, 250, 480];

// Compute p95 latency
const p95 = math.percentile(latencies, 95); // => 480
const p50 = math.percentile(latencies, 50); // => 72
```

### Signature
```typescript
function percentile(values: number[], p: number): number;
```

---

## 5. Rate of Change & Moving Averages

For synthetic monitors measuring queue depth growth, memory leaks, or response time degradation during endurance testing:

```javascript
import { math } from '@aventine/testudo';

// Numerical first derivative (rate of change per second)
const memorySamples = [100, 110, 125, 145, 170];
const growthRate = math.rateOfChange(memorySamples, 1.0); // => [10, 15, 20, 25]

// Moving average smoothing (sliding window of 3)
const smoothed = math.movingAverage([10, 12, 14, 16, 18], 3); // => [12, 14, 16]
```
