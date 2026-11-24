/**
 * @aventine/testudo - Standard TypeScript Unified Runner, Spy & Semantic Queries (src/runner.ts)
 * Unifies Unit, Component, and E2E testing in plain TypeScript (zero proprietary DSL, zero dependencies):
 * - describe, it, test, beforeEach, afterEach, expect, spyFn
 * - Testing-Library-compatible semantic queries (byRole, byLabel, byText, byTestId)
 * - Zero Silent Magic Retries: surfaces explicit SELECTOR_DRIFT_ADVISORY & DOM_FLICKER_WARNING
 * Zero external dependencies. Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

import { math } from './math.js';
import { format } from './format.js';
import { computeAccessibleName, computeImplicitRole } from './probe.js';

export interface RunnerCaseResult {
  suiteName: string;
  testName: string;
  status: 'passed' | 'failed';
  durationUs: number;
  warnings: string[];
  error?: string;
}

export interface RunnerSuiteReport {
  passed: boolean;
  total: number;
  passedCount: number;
  failedCount: number;
  totalDurationUs: number;
  advisories: string[];
  results: RunnerCaseResult[];
}

export interface SpyFunction<TArgs extends any[] = any[], TRet = any> {
  (...args: TArgs): TRet;
  calls: TArgs[];
  callCount: number;
  reset: () => void;
}

export function spyFn<TArgs extends any[] = any[], TRet = any>(
  impl?: (...args: TArgs) => TRet
): SpyFunction<TArgs, TRet> {
  const calls: TArgs[] = [];
  const fn = ((...args: TArgs): TRet => {
    calls.push(args);
    return impl ? impl(...args) : (undefined as unknown as TRet);
  }) as SpyFunction<TArgs, TRet>;
  Object.defineProperty(fn, 'calls', { get: () => calls });
  Object.defineProperty(fn, 'callCount', { get: () => calls.length });
  fn.reset = () => {
    calls.length = 0;
  };
  return fn;
}

export function expectValue<T>(actual: T) {
  return {
    toBe(expected: T) {
      if (!Object.is(actual, expected)) {
        throw new Error(`[Testudo Expect] Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toEqual(expected: unknown) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`[Testudo Expect] Deep equality failed: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toBeTruthy() {
      if (!actual) throw new Error(`[Testudo Expect] Expected truthy value, got ${JSON.stringify(actual)}`);
    },
    toEqualCurrency(expected: string | number, tolerance = 0.01) {
      const actNum = typeof actual === 'number' ? actual : format.parseMonetary(String(actual));
      const expNum = typeof expected === 'number' ? expected : format.parseMonetary(expected);
      if (!math.isCloseTo(actNum, expNum, tolerance)) {
        throw new Error(`[Testudo Expect] Currency mismatch: expected ${expNum}, got ${actNum}`);
      }
    },
    toEqualBasisPoints(expectedBps: string | number, tolerance = 0.01) {
      const actBps = format.parseBasisPoints(actual as any).bps;
      const expBps = format.parseBasisPoints(expectedBps).bps;
      if (!math.isCloseTo(actBps, expBps, tolerance)) {
        throw new Error(`[Testudo Expect] Basis points mismatch: expected ${expBps} bps, got ${actBps} bps`);
      }
    },
    toHaveBeenCalledTimes(count: number) {
      const c = (actual as any)?.callCount;
      if (c !== count) {
        throw new Error(`[Testudo Expect] Expected spy to be called ${count} time(s), got ${c}`);
      }
    }
  };
}

export const semanticQueries = {
  byTestId(testId: string, root?: Document | Element | null): HTMLElement | null {
    const doc = root ?? (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof doc.querySelector !== 'function') return null;
    const esc = testId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return doc.querySelector(`[data-testid="${esc}"]`) as HTMLElement | null;
  },
  byRole(role: string, options: { name?: string; root?: Document | Element | null } = {}): HTMLElement | null {
    const doc = (options.root ?? (typeof document !== 'undefined' ? document : null)) as Document | null;
    if (!doc || typeof doc.querySelectorAll !== 'function') return null;
    const targetRole = role.trim().toLowerCase();
    const candidates = Array.from(doc.querySelectorAll('button, a, input, select, textarea, [role]')) as HTMLElement[];
    for (const el of candidates) {
      if (computeImplicitRole(el) !== targetRole) continue;
      if (options.name) {
        const nm = computeAccessibleName(el, doc);
        if (nm.toLowerCase() !== options.name.trim().toLowerCase()) continue;
      }
      return el;
    }
    return null;
  },
  byLabel(labelText: string, root?: Document | Element | null): HTMLElement | null {
    const doc = (root ?? (typeof document !== 'undefined' ? document : null)) as Document | null;
    if (!doc || typeof doc.querySelectorAll !== 'function') return null;
    const candidates = Array.from(doc.querySelectorAll('input, select, textarea')) as HTMLElement[];
    for (const el of candidates) {
      if (computeAccessibleName(el, doc).toLowerCase().includes(labelText.trim().toLowerCase())) {
        return el;
      }
    }
    return null;
  },
  byText(text: string, root?: Document | Element | null): HTMLElement | null {
    const doc = root ?? (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof doc.querySelectorAll !== 'function') return null;
    const target = text.trim().toLowerCase();
    const all = Array.from(doc.querySelectorAll('*')) as HTMLElement[];
    for (const el of all) {
      if (el.children.length === 0 && (el.textContent || '').trim().toLowerCase().includes(target)) {
        return el;
      }
    }
    return null;
  }
};

export class TestudoSuiteRunner {
  private suites: Array<{
    name: string;
    beforeEachFns: Array<() => void | Promise<void>>;
    afterEachFns: Array<() => void | Promise<void>>;
    cases: Array<{ name: string; fn: (ctx: { warnAdvisory: (msg: string) => void }) => void | Promise<void> }>;
  }> = [];

  public describe(name: string, registerFn: (api: {
    it: (testName: string, fn: (ctx: { warnAdvisory: (msg: string) => void }) => void | Promise<void>) => void;
    beforeEach: (fn: () => void | Promise<void>) => void;
    afterEach: (fn: () => void | Promise<void>) => void;
  }) => void): void {
    const suite = {
      name,
      beforeEachFns: [] as Array<() => void | Promise<void>>,
      afterEachFns: [] as Array<() => void | Promise<void>>,
      cases: [] as Array<{ name: string; fn: (ctx: { warnAdvisory: (msg: string) => void }) => void | Promise<void> }>
    };
    registerFn({
      it: (testName, fn) => suite.cases.push({ name: testName, fn }),
      beforeEach: (fn) => suite.beforeEachFns.push(fn),
      afterEach: (fn) => suite.afterEachFns.push(fn)
    });
    this.suites.push(suite);
  }

  public async runAll(): Promise<RunnerSuiteReport> {
    const results: RunnerCaseResult[] = [];
    const advisories: string[] = [];
    const tStart = typeof performance !== 'undefined' ? performance.now() : Date.now();

    for (const suite of this.suites) {
      for (const c of suite.cases) {
        const warnings: string[] = [];
        const c0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
        try {
          for (const bf of suite.beforeEachFns) await bf();
          await c.fn({
            warnAdvisory: (msg: string) => {
              warnings.push(msg);
              advisories.push(`[${suite.name} > ${c.name}] ${msg}`);
            }
          });
          for (const af of suite.afterEachFns) await af();
          const durUs = Math.max(1, Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - c0) * 1000));
          results.push({ suiteName: suite.name, testName: c.name, status: 'passed', durationUs: durUs, warnings });
        } catch (err: any) {
          for (const af of suite.afterEachFns) {
            try {
              await af();
            } catch {
              // ignore teardown error
            }
          }
          const durUs = Math.max(1, Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - c0) * 1000));
          results.push({
            suiteName: suite.name,
            testName: c.name,
            status: 'failed',
            durationUs: durUs,
            warnings,
            error: err?.message || String(err)
          });
        }
      }
    }

    const totalDurationUs = Math.max(1, Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - tStart) * 1000));
    const passedCount = results.filter((r) => r.status === 'passed').length;
    const failedCount = results.length - passedCount;
    return {
      passed: failedCount === 0,
      total: results.length,
      passedCount,
      failedCount,
      totalDurationUs,
      advisories,
      results
    };
  }
}
