/**
 * @aventine/testudo - Opt-In Browser Telemetry & Prometheus / HDR Counter Exporter (v0.4.0)
 * Strictly OFF (zero network calls) by default in Helper/Trainer mode.
 * When enabled in Automated Testing / Synthetic Monitoring mode, captures microsecond step
 * latencies, DOM flicker counts (instabilityCount), and financial drift deltas, formatting
 * them for Prometheus scrapers, @aventine/testudo-telemetry, and the Aegis SHM Counter Arena.
 * Zero external dependencies.
 */

export const DEFAULT_MAX_TELEMETRY_SAMPLES = 4096;
const MAX_WORKFLOW_RUN_SERIES = 512;

export interface TestudoTelemetryConfig {
  enabled?: boolean;
  endpoint?: string;
  scenarioName?: string;
  maxSamples?: number;
  onEmitStep?: (sample: TestudoStepTelemetrySample) => void;
}

export interface TestudoStepTelemetrySample {
  timestampNs: number;
  workflowName: string;
  stepNumber: number;
  stepTitle: string;
  selector: string;
  action: string;
  status: 'passed' | 'failed' | 'cancelled';
  durationUs: number;
  instabilityCount: number;
  observedStableMs: number;
  pollSamples: number;
  financialDelta?: number;
}

export interface TestudoPercentilesUs {
  count: number;
  minUs: number;
  p50Us: number;
  p95Us: number;
  p99Us: number;
  maxUs: number;
  meanUs: number;
}

function sanitizePromLabel(val: string): string {
  return String(val || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

export class TestudoTelemetryCollector {
  private config: Required<Omit<TestudoTelemetryConfig, 'endpoint' | 'onEmitStep'>> & {
    endpoint?: string;
    onEmitStep?: (sample: TestudoStepTelemetrySample) => void;
  } = {
    enabled: false,
    scenarioName: 'testudo-browser-suite',
    maxSamples: DEFAULT_MAX_TELEMETRY_SAMPLES
  };

  private samples: TestudoStepTelemetrySample[] = [];
  private workflowRunCounts: Map<string, number> = new Map();

  public configure(cfg: TestudoTelemetryConfig = {}): void {
    const nextMax =
      typeof cfg.maxSamples === 'number' && Number.isFinite(cfg.maxSamples) && cfg.maxSamples >= 1
        ? Math.floor(cfg.maxSamples)
        : this.config.maxSamples;
    this.config = {
      enabled: cfg.enabled !== undefined ? Boolean(cfg.enabled) : this.config.enabled,
      scenarioName: cfg.scenarioName || this.config.scenarioName,
      maxSamples: nextMax,
      endpoint: cfg.endpoint ?? this.config.endpoint,
      onEmitStep: cfg.onEmitStep ?? this.config.onEmitStep
    };
    if (this.samples.length > this.config.maxSamples) {
      this.samples = this.samples.slice(-this.config.maxSamples);
    }
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public reset(): void {
    this.samples = [];
    this.workflowRunCounts.clear();
  }

  public recordWorkflowRun(workflowName: string, status: string): void {
    if (!this.config.enabled) return;
    const rawKey = `${workflowName}|${status}`;
    const key =
      this.workflowRunCounts.has(rawKey) || this.workflowRunCounts.size < MAX_WORKFLOW_RUN_SERIES
        ? rawKey
        : `__other__|${status}`;
    this.workflowRunCounts.set(key, (this.workflowRunCounts.get(key) || 0) + 1);
  }

  public recordStepSample(sample: Omit<TestudoStepTelemetrySample, 'timestampNs'>): TestudoStepTelemetrySample | null {
    if (!this.config.enabled) return null;
    const nowNs =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? Math.round(performance.now() * 1e6)
        : Date.now() * 1e6;

    const fullSample: TestudoStepTelemetrySample = {
      timestampNs: nowNs,
      ...sample
    };
    if (this.samples.length >= this.config.maxSamples) {
      this.samples.shift();
    }
    this.samples.push(fullSample);

    if (typeof this.config.onEmitStep === 'function') {
      this.config.onEmitStep(fullSample);
    }

    if (this.config.endpoint && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        navigator.sendBeacon(this.config.endpoint, JSON.stringify(fullSample));
      } catch {
        // Ignore beacon errors in restricted sandboxes
      }
    }

    return fullSample;
  }

  public getSamples(): TestudoStepTelemetrySample[] {
    return this.samples.map((s) => ({ ...s }));
  }

  public computePercentilesUs(): TestudoPercentilesUs {
    if (this.samples.length === 0) {
      return { count: 0, minUs: 0, p50Us: 0, p95Us: 0, p99Us: 0, maxUs: 0, meanUs: 0 };
    }
    const sorted = this.samples.map((s) => s.durationUs).sort((a, b) => a - b);
    const n = sorted.length;
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const pick = (q: number) => sorted[Math.min(n - 1, Math.max(0, Math.floor(q * (n - 1))))];
    return {
      count: n,
      minUs: sorted[0],
      p50Us: pick(0.5),
      p95Us: pick(0.95),
      p99Us: pick(0.99),
      maxUs: sorted[n - 1],
      meanUs: Math.round(sum / n)
    };
  }

  /**
   * Formats all collected browser workflow, latency, DOM flicker, and financial drift counters
   * in standard Prometheus text exposition format (compatible with prom.py & aegis-telemetry-shipper).
   */
  public toPrometheusText(): string {
    const lines: string[] = [
      '# HELP testudo_workflow_runs_total Total Testudo browser workflow executions by status',
      '# TYPE testudo_workflow_runs_total counter'
    ];

    for (const [key, count] of this.workflowRunCounts.entries()) {
      const sepIdx = key.lastIndexOf('|');
      const wf = sepIdx === -1 ? key : key.slice(0, sepIdx);
      const st = sepIdx === -1 ? 'unknown' : key.slice(sepIdx + 1);
      lines.push(
        `testudo_workflow_runs_total{scenario="${sanitizePromLabel(this.config.scenarioName)}",workflow="${sanitizePromLabel(wf)}",status="${sanitizePromLabel(st)}"} ${count}`
      );
    }

    const aggregatedSeries = new Map<
      string,
      { durationUs: number; flickersTotal: number; financialDelta?: number }
    >();

    for (const s of this.samples) {
      const labels = `workflow="${sanitizePromLabel(s.workflowName)}",step="${s.stepNumber}",selector="${sanitizePromLabel(s.selector)}",action="${sanitizePromLabel(s.action)}",status="${sanitizePromLabel(s.status)}"`;
      const prev = aggregatedSeries.get(labels);
      const nextDelta =
        typeof s.financialDelta === 'number' && !Number.isNaN(s.financialDelta)
          ? s.financialDelta
          : prev?.financialDelta;
      aggregatedSeries.set(labels, {
        durationUs: s.durationUs,
        flickersTotal: (prev?.flickersTotal || 0) + s.instabilityCount,
        financialDelta: nextDelta
      });
    }

    lines.push(
      '# HELP testudo_step_duration_microseconds Execution latency of each Testudo browser step in microseconds',
      '# TYPE testudo_step_duration_microseconds gauge'
    );
    for (const [labels, entry] of aggregatedSeries.entries()) {
      lines.push(`testudo_step_duration_microseconds{${labels}} ${entry.durationUs}`);
    }

    lines.push(
      '# HELP testudo_dom_instability_flickers_total Count of DOM value flickers observed during temporal stability polling',
      '# TYPE testudo_dom_instability_flickers_total counter'
    );
    for (const [labels, entry] of aggregatedSeries.entries()) {
      lines.push(`testudo_dom_instability_flickers_total{${labels}} ${entry.flickersTotal}`);
    }

    lines.push(
      '# HELP testudo_financial_assertion_delta Numerical delta between actual and expected financial assertion value',
      '# TYPE testudo_financial_assertion_delta gauge'
    );
    for (const [labels, entry] of aggregatedSeries.entries()) {
      if (typeof entry.financialDelta === 'number' && !Number.isNaN(entry.financialDelta)) {
        lines.push(`testudo_financial_assertion_delta{${labels}} ${entry.financialDelta}`);
      }
    }

    const pct = this.computePercentilesUs();
    lines.push(
      '# HELP testudo_suite_latency_microseconds_summary Microsecond latency percentiles across browser workflow steps',
      '# TYPE testudo_suite_latency_microseconds_summary gauge',
      `testudo_suite_latency_microseconds_summary{quantile="0.5"} ${pct.p50Us}`,
      `testudo_suite_latency_microseconds_summary{quantile="0.95"} ${pct.p95Us}`,
      `testudo_suite_latency_microseconds_summary{quantile="0.99"} ${pct.p99Us}`
    );

    return lines.join('\n') + '\n';
  }
}

export const telemetry = new TestudoTelemetryCollector();
