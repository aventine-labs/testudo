/**
 * Testudo Multi-Format Enterprise Reporter (src/report.ts)
 * Zero-dependency enterprise reporting engine supporting:
 * - Verbosity: 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'all'
 * - Formats: 'formatted' (ANSI) | 'plain' (Clean Text) | 'splunk' (Key-Value) | 'json' | 'github-summary' (Markdown)
 */

export type VerbosityLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'all';
export type ReportFormat = 'formatted' | 'plain' | 'splunk' | 'json' | 'github-summary';

export interface ReportEvent {
  timestamp?: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  event: string;
  message: string;
  testId?: string;
  selector?: string;
  expected?: string | number;
  actual?: string | number;
  delta?: number;
  tolerance?: number;
  divergenceIndex?: number;
  formula?: string;
  elapsedMs?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface ReporterConfig {
  verbosity: VerbosityLevel;
  format: ReportFormat;
  stream?: (output: string) => void;
  includeTimestamp?: boolean;
}

const LEVEL_WEIGHTS: Record<VerbosityLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  all: 5
};

const EVENT_WEIGHTS: Record<string, number> = {
  error: 1,
  warn: 2,
  info: 3,
  debug: 4
};

export class TestudoReporter {
  private config: ReporterConfig = {
    verbosity: 'info',
    format: 'formatted',
    includeTimestamp: true
  };

  constructor(customConfig?: Partial<ReporterConfig>) {
    if (customConfig) {
      this.configure(customConfig);
    }
  }

  public configure(newConfig: Partial<ReporterConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig(): ReporterConfig {
    return { ...this.config };
  }

  public log(event: ReportEvent): string {
    const minWeight = LEVEL_WEIGHTS[this.config.verbosity] || 0;
    const eventWeight = EVENT_WEIGHTS[event.level] || 3;

    if (this.config.verbosity === 'silent' || eventWeight > minWeight) {
      return '';
    }

    const ev: ReportEvent = { ...event };
    if (!ev.timestamp && this.config.includeTimestamp) {
      ev.timestamp = new Date().toISOString();
    }

    let output = '';
    switch (this.config.format) {
      case 'splunk':
        output = this.formatSplunk(ev);
        break;
      case 'plain':
        output = this.formatPlain(ev);
        break;
      case 'json':
        output = this.formatJson(ev);
        break;
      case 'github-summary':
        output = this.formatGithubSummary(ev);
        break;
      case 'formatted':
      default:
        output = this.formatAnsi(ev);
        break;
    }

    if (this.config.stream) {
      this.config.stream(output);
    }

    return output;
  }

  public debug(message: string, meta?: Partial<ReportEvent>): string {
    return this.log({ level: 'debug', event: 'debug_trace', message, ...meta });
  }

  public info(message: string, meta?: Partial<ReportEvent>): string {
    return this.log({ level: 'info', event: 'info_event', message, ...meta });
  }

  public warn(message: string, meta?: Partial<ReportEvent>): string {
    return this.log({ level: 'warn', event: 'assertion_warning', message, ...meta });
  }

  public error(message: string, meta?: Partial<ReportEvent>): string {
    return this.log({ level: 'error', event: 'assertion_failed', message, ...meta });
  }

  private escapeSplunk(val: string): string {
    return val
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r?\n/g, ' ');
  }

  private escapeGfmCell(val: string): string {
    return val
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .replace(/`/g, "'")
      .replace(/\r?\n/g, ' ');
  }

  /**
   * Splunk SIEM Key-Value Format: key="value"
   * Automatically indexed by Splunk, Datadog, and Sumo Logic into searchable dimensions
   */
  public formatSplunk(ev: ReportEvent): string {
    const esc = (v: string): string => this.escapeSplunk(v);
    const fields: string[] = [];
    if (ev.timestamp) fields.push(`timestamp="${esc(ev.timestamp)}"`);
    fields.push(`tool="testudo"`);
    fields.push(`level="${esc(ev.level)}"`);
    fields.push(`event="${esc(ev.event)}"`);
    fields.push(`msg="${esc(ev.message)}"`);

    if (ev.testId) fields.push(`test_id="${esc(ev.testId)}"`);
    if (ev.selector) fields.push(`selector="${esc(ev.selector)}"`);
    if (ev.formula) fields.push(`formula="${esc(ev.formula)}"`);
    if (ev.expected !== undefined) fields.push(`expected="${esc(String(ev.expected))}"`);
    if (ev.actual !== undefined) fields.push(`actual="${esc(String(ev.actual))}"`);
    if (ev.delta !== undefined) fields.push(`delta="${ev.delta}"`);
    if (ev.tolerance !== undefined) fields.push(`tolerance="${ev.tolerance}"`);
    if (ev.divergenceIndex !== undefined) fields.push(`divergence_index=${ev.divergenceIndex}`);
    if (ev.elapsedMs !== undefined) fields.push(`elapsed_ms=${ev.elapsedMs.toFixed(2)}`);

    if (ev.metadata) {
      for (const [k, v] of Object.entries(ev.metadata)) {
        fields.push(`${esc(k)}="${esc(String(v))}"`);
      }
    }

    return fields.join(' ');
  }

  /**
   * Clean Plain Text Format (No ANSI codes, raw CI friendly)
   */
  public formatPlain(ev: ReportEvent): string {
    const prefix = ev.timestamp ? `[${ev.timestamp}] ` : '';
    const lvl = ev.level.toUpperCase().padEnd(5);
    let line = `${prefix}[TESTUDO ${lvl}] ${ev.message}`;

    if (ev.expected !== undefined && ev.actual !== undefined) {
      line += ` (Expected: ${ev.expected}, Actual: ${ev.actual}`;
      if (ev.delta !== undefined) line += `, Delta: ${ev.delta}`;
      if (ev.tolerance !== undefined) line += `, Tolerance: ${ev.tolerance}`;
      line += ')';
    }

    if (ev.selector) line += ` | Selector: ${ev.selector}`;
    if (ev.formula) line += ` | Formula: ${ev.formula}`;
    return line;
  }

  /**
   * Rich ANSI Terminal Format (Terminal Colors)
   */
  public formatAnsi(ev: ReportEvent): string {
    const colors = {
      reset: '\x1b[0m',
      dim: '\x1b[2m',
      bold: '\x1b[1m',
      cyan: '\x1b[36m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      red: '\x1b[31m',
      magenta: '\x1b[35m'
    };

    const levelColor = {
      debug: colors.dim,
      info: colors.cyan,
      warn: colors.yellow,
      error: colors.red
    }[ev.level] || colors.reset;

    const prefix = ev.timestamp ? `${colors.dim}[${ev.timestamp}]${colors.reset} ` : '';
    const badge = `${levelColor}${colors.bold}[TESTUDO ${ev.level.toUpperCase()}]${colors.reset}`;
    let output = `${prefix}${badge} ${ev.message}`;

    if (ev.formula) {
      output += `\n  ${colors.dim}Formula:${colors.reset} ${colors.magenta}${ev.formula}${colors.reset}`;
    }

    if (ev.expected !== undefined && ev.actual !== undefined) {
      output += `\n  ${colors.green}Expected: ${ev.expected}${colors.reset} vs ${colors.red}Actual: ${ev.actual}${colors.reset}`;
      if (ev.delta !== undefined) {
        output += ` ${colors.dim}(Delta: ${ev.delta}, Tol: ${ev.tolerance || 0})${colors.reset}`;
      }
    }

    if (ev.selector) {
      output += `\n  ${colors.dim}Target:${colors.reset} ${colors.cyan}${ev.selector}${colors.reset}`;
    }

    return output;
  }

  /**
   * JSON Output for OTel / Structured Log Collectors
   */
  public formatJson(ev: ReportEvent): string {
    return JSON.stringify({
      tool: 'testudo',
      ...ev
    });
  }

  /**
   * GitHub Actions Step Summary Format (Markdown Table)
   */
  public formatGithubSummary(ev: ReportEvent): string {
    const icon = {
      debug: '🔍',
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌'
    }[ev.level];

    const esc = (v: string | number | undefined): string => {
      if (v === undefined) return '';
      return this.escapeGfmCell(String(v));
    };

    let md = `### ${icon} Testudo Forensic Report: ${esc(ev.message)}\n\n`;
    md += `| Property | Value |\n| :--- | :--- |\n`;
    md += `| **Event** | \`${esc(ev.event)}\` |\n`;
    md += `| **Level** | \`${esc(ev.level.toUpperCase())}\` |\n`;
    if (ev.testId) md += `| **Test ID** | \`${esc(ev.testId)}\` |\n`;
    if (ev.formula) md += `| **Calculus Formula** | \`${esc(ev.formula)}\` |\n`;
    if (ev.selector) md += `| **DOM Selector** | \`${esc(ev.selector)}\` |\n`;
    if (ev.expected !== undefined) md += `| **Expected Value** | \`${esc(ev.expected)}\` |\n`;
    if (ev.actual !== undefined) md += `| **Actual DOM Value** | \`${esc(ev.actual)}\` |\n`;
    if (ev.delta !== undefined) md += `| **Numerical Delta** | \`${esc(ev.delta)}\` |\n`;
    if (ev.tolerance !== undefined) md += `| **Allowable Epsilon** | \`${esc(ev.tolerance)}\` |\n`;
    if (ev.divergenceIndex !== undefined) md += `| **Divergence Index** | \`${esc(ev.divergenceIndex)}\` |\n`;
    if (ev.elapsedMs !== undefined) md += `| **Duration** | \`${ev.elapsedMs.toFixed(2)}ms\` |\n`;

    return md;
  }
}

export const reporter = new TestudoReporter();
