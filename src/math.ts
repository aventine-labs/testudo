/**
 * @aventine/testudo - Math Engine
 * High-precision financial math, epsilon floating-point comparisons, and calculus rates of change.
 * Zero external dependencies.
 */

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL';

export class TestudoMath {
  /**
   * Compare two numbers with floating-point epsilon tolerance.
   * Handles IEEE-754 float drift (e.g. 0.1 + 0.2 === 0.3).
   * Also safely handles negative zero (-0 vs 0).
   */
  public eq(a: number, b: number, epsilon: number = 0.000001): boolean {
    return Math.abs(a - b) <= epsilon;
  }

  /**
   * Checks if value 'a' is close to 'b' within an allowable absolute or relative tolerance.
   * Essential for financial assertion checks (e.g. within 1 penny / 0.01).
   */
  public isCloseTo(a: number, b: number, tolerance: number = 0.01): boolean {
    return Math.abs(a - b) <= tolerance;
  }

  /**
   * Deterministic decimal rounding avoiding floating point rounding drift.
   */
  public round(value: number, decimals: number = 2, mode: RoundingMode = 'HALF_UP'): number {
    const factor = Math.pow(10, decimals);
    const scaled = value * factor;

    if (mode === 'HALF_UP') {
      return Math.round(scaled) / factor;
    } else if (mode === 'FLOOR') {
      return Math.floor(scaled) / factor;
    } else if (mode === 'CEIL') {
      return Math.ceil(scaled) / factor;
    } else if (mode === 'HALF_EVEN') {
      const floor = Math.floor(scaled);
      const diff = scaled - floor;
      if (Math.abs(diff - 0.5) < 0.000001) {
        return (floor % 2 === 0 ? floor : floor + 1) / factor;
      }
      return Math.round(scaled) / factor;
    }

    return Math.round(scaled) / factor;
  }

  /**
   * Calculates the p-th percentile of a numerical array (0 to 100).
   * Essential for SLA and latency assertions (p50, p90, p95, p99).
   */
  public percentile(values: number[], p: number): number {
    if (!values || values.length === 0) return 0;
    if (p <= 0) return Math.min(...values);
    if (p >= 100) return Math.max(...values);

    const sorted = [...values].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;

    if (lower === upper) return sorted[lower];
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  /**
   * Calculates numerical rate of change (first derivative) across sequential samples.
   * Useful for auditing heap memory growth rate or request latency acceleration.
   */
  public rateOfChange(series: number[]): number[] {
    if (!series || series.length <= 1) return [];
    const deltas: number[] = [];
    for (let i = 1; i < series.length; i++) {
      deltas.push(series[i] - series[i - 1]);
    }
    return deltas;
  }

  /**
   * Simple moving average smoothing across a sliding window.
   */
  public movingAverage(series: number[], windowSize: number): number[] {
    if (!series || windowSize <= 0) return [];
    if (windowSize === 1) return [...series];

    const result: number[] = [];
    for (let i = 0; i < series.length; i++) {
      const start = Math.max(0, i - windowSize + 1);
      const window = series.slice(start, i + 1);
      const sum = window.reduce((acc, v) => acc + v, 0);
      result.push(sum / window.length);
    }
    return result;
  }
}

export const math = new TestudoMath();
