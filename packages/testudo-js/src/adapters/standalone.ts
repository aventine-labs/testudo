/**
 * @aventine/testudo - Standalone Browser & ESM Adapter
 * Attaches window.testudo and window.$T for synthetic monitors (Apica, Datadog) and DevTools console.
 * Zero external dependencies.
 */

import { math } from '../math.js';
import { format, FormatParseOptions, TestudoFormatError } from '../format.js';
import { type } from '../type.js';
import { scan, resolveElement } from '../scan.js';
import { visual } from '../visual.js';
import { charDiff } from '../diff.js';
import { calc } from '../calc.js';
import { reporter } from '../report.js';
import { createWorkflow, pollDomAssertion, PollOptions, WorkflowStep } from '../workflow.js';

export interface AssertCurrencyOptions extends FormatParseOptions, PollOptions {
  tolerance?: number;
  message?: string;
}

export interface AssertBasisPointsOptions extends FormatParseOptions, PollOptions {
  tolerance?: number;
  message?: string;
}

export interface AssertTextOptions extends PollOptions {
  message?: string;
}

function readElementText(target: HTMLElement): string {
  if (
    (target as HTMLInputElement).value !== undefined &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
  ) {
    return String((target as HTMLInputElement).value).trim();
  }
  return (target.innerText || target.textContent || '').trim();
}

export function createTestudoInstance() {
  const instance: any = function (selectorOrElement: string | HTMLElement) {
    const getElement = (requireUnique: boolean = false): HTMLElement | null => {
      if (typeof selectorOrElement === 'string') {
        return resolveElement(selectorOrElement, undefined, { requireUnique });
      }
      return selectorOrElement;
    };

    const el = getElement(false);

    return {
      element: el,
      click: async () => {
        const target = getElement(true);
        if (!target) throw new Error(`[Testudo] Element not found for click: ${selectorOrElement}`);
        return type.click(target);
      },
      type: async (text: string, options?: any) => {
        const target = getElement(true);
        if (!target) throw new Error(`[Testudo] Element not found for type: ${selectorOrElement}`);
        return type.type(target as HTMLInputElement, text, options);
      },
      select: async (value: string) => {
        const target = getElement(true);
        if (!target) throw new Error(`[Testudo] Element not found for select: ${selectorOrElement}`);
        return type.select(target as HTMLSelectElement, value);
      },
      scan: () => {
        const target = getElement(false);
        if (!target) return [];
        return scan.scan(target);
      },
      assertCurrency: async (expected: string | number, options?: AssertCurrencyOptions) => {
        const target = getElement(true);
        if (!target) throw new Error(`[Testudo] Element not found: ${selectorOrElement}`);

        const expVal = typeof expected === 'number' ? expected : format.parse(expected, options);
        const tol = options?.tolerance ?? 0.01;
        const timeout = options?.timeout ?? (options?.mode === 'stable' ? 1500 : 250);
        let lastFormatError: any = null;

        const pollRes = await pollDomAssertion<number>(
          () => {
            const raw = readElementText(target);
            try {
              const actualVal = format.parse(raw, options);
              lastFormatError = null;
              const delta = Math.round((actualVal - expVal) * 1e4) / 1e4;
              const pass = math.isCloseTo(actualVal, expVal, tol);
              return {
                pass,
                actual: actualVal,
                expected: expVal,
                rawText: raw,
                delta
              };
            } catch (err: any) {
              if (err instanceof TestudoFormatError) {
                lastFormatError = err;
              }
              return {
                pass: false,
                actual: Number.NaN,
                expected: expVal,
                rawText: raw,
                delta: Number.NaN
              };
            }
          },
          {
            timeout,
            interval: options?.interval ?? 50,
            mode: options?.mode ?? 'eventually',
            stableMs: options?.stableMs ?? 250,
            signal: options?.signal
          }
        );

        if (!pollRes.pass) {
          const raw = pollRes.rawText;
          const actualVal = pollRes.actual;
          const delta = pollRes.delta ?? Number.NaN;
          const msg =
            options?.message ||
            (lastFormatError
              ? lastFormatError.message
              : `Currency mismatch: expected ${expVal}, got ${actualVal}`);
          const { diff } = await visual.highlightError(target, {
            message: msg,
            expected: typeof expected === 'string' ? expected : String(expected),
            actual: raw
          });
          reporter.error(msg, {
            selector: typeof selectorOrElement === 'string' ? selectorOrElement : target.id || target.tagName,
            expected: expVal,
            actual: actualVal,
            delta,
            tolerance: tol,
            divergenceIndex: diff?.index
          });
          if (lastFormatError) {
            throw lastFormatError;
          }
          throw new Error(
            `[Testudo] ${msg} | Currency assertion failed on ${selectorOrElement}. Expected: ${expVal}, Actual: ${actualVal} (raw: "${raw}", delta: ${delta}, mode: ${pollRes.mode})`
          );
        }

        return {
          pass: true,
          expected: expVal,
          actual: pollRes.actual,
          delta: pollRes.delta ?? 0,
          mode: pollRes.mode,
          observedStableMs: pollRes.observedStableMs,
          samples: pollRes.samples
        };
      },
      assertBasisPoints: async (expected: string | number, options?: AssertBasisPointsOptions) => {
        const target = getElement(true);
        if (!target) throw new Error(`[Testudo] Element not found: ${selectorOrElement}`);

        const expBps = typeof expected === 'number' ? expected : format.parseBasisPoints(expected, options).bps;
        const tol = options?.tolerance ?? 0.01;
        const timeout = options?.timeout ?? (options?.mode === 'stable' ? 1500 : 250);
        let lastFormatError: any = null;

        const pollRes = await pollDomAssertion<number>(
          () => {
            const raw = readElementText(target);
            try {
              const parsed = format.parseBasisPoints(raw, options);
              lastFormatError = null;
              const delta = Math.round((parsed.bps - expBps) * 1e4) / 1e4;
              const pass = math.isCloseTo(parsed.bps, expBps, tol);
              return {
                pass,
                actual: parsed.bps,
                expected: expBps,
                rawText: raw,
                delta
              };
            } catch (err: any) {
              if (err instanceof TestudoFormatError) {
                lastFormatError = err;
              }
              return {
                pass: false,
                actual: Number.NaN,
                expected: expBps,
                rawText: raw,
                delta: Number.NaN
              };
            }
          },
          {
            timeout,
            interval: options?.interval ?? 50,
            mode: options?.mode ?? 'eventually',
            stableMs: options?.stableMs ?? 250,
            signal: options?.signal
          }
        );

        if (!pollRes.pass) {
          const raw = pollRes.rawText;
          const actualBps = pollRes.actual;
          const delta = pollRes.delta ?? Number.NaN;
          const msg =
            options?.message ||
            (lastFormatError
              ? lastFormatError.message
              : `Basis points mismatch: expected ${expBps} bps, got ${actualBps} bps`);
          const { diff } = await visual.highlightError(target, {
            message: msg,
            expected: `${expBps} bps`,
            actual: raw
          });
          reporter.error(msg, {
            selector: typeof selectorOrElement === 'string' ? selectorOrElement : target.id || target.tagName,
            expected: expBps,
            actual: actualBps,
            delta,
            tolerance: tol,
            divergenceIndex: diff?.index
          });
          if (lastFormatError) {
            throw lastFormatError;
          }
          throw new Error(
            `[Testudo] Basis points assertion failed on ${selectorOrElement}. Expected: ${expBps} bps, Actual: ${actualBps} bps (raw: "${raw}", delta: ${delta})`
          );
        }

        return {
          pass: true,
          expected: expBps,
          actual: pollRes.actual,
          delta: pollRes.delta ?? 0,
          unit: 'bps' as const,
          mode: pollRes.mode,
          observedStableMs: pollRes.observedStableMs,
          samples: pollRes.samples
        };
      },
      assertText: async (expected: string, options?: AssertTextOptions) => {
        const target = getElement(true);
        if (!target) throw new Error(`[Testudo] Element not found: ${selectorOrElement}`);

        const normExpected = format.normalizeWhitespace(expected.trim());
        const timeout = options?.timeout ?? (options?.mode === 'stable' ? 1500 : 250);

        const pollRes = await pollDomAssertion<string>(
          () => {
            const raw = readElementText(target);
            const normActual = format.normalizeWhitespace(raw);
            return {
              pass: normActual === normExpected,
              actual: normActual,
              expected: normExpected,
              rawText: raw
            };
          },
          {
            timeout,
            interval: options?.interval ?? 50,
            mode: options?.mode ?? 'eventually',
            stableMs: options?.stableMs ?? 250,
            signal: options?.signal
          }
        );

        if (!pollRes.pass) {
          const normActual = pollRes.actual;
          const { diff } = await visual.highlightError(target, {
            message: `Text mismatch: expected "${normExpected}", got "${normActual}"`,
            expected: normExpected,
            actual: normActual
          });
          reporter.error(`Text assertion failed on ${selectorOrElement}`, {
            selector: typeof selectorOrElement === 'string' ? selectorOrElement : target.id || target.tagName,
            expected: normExpected,
            actual: normActual,
            divergenceIndex: diff?.index
          });
          throw new Error(
            `[Testudo] Text assertion failed on ${selectorOrElement}. Expected: "${normExpected}", Actual: "${normActual}"`
          );
        }
        return {
          pass: true,
          expected: normExpected,
          actual: pollRes.actual,
          mode: pollRes.mode,
          observedStableMs: pollRes.observedStableMs,
          samples: pollRes.samples
        };
      },
      highlight: (label?: string, color: string = '#10B981') => {
        const target = getElement(false);
        if (!target) return null;
        return visual.highlightStep(target, { label, color });
      },
      highlightError: async (message?: string, options?: { expected?: string; actual?: string; color?: string }) => {
        const target = getElement(false);
        if (!target) return { diff: null };
        return visual.highlightError(target, { message, ...options });
      }
    };
  };

  instance.math = math;
  instance.format = format;

  const typeFn = Object.assign(
    async (
      elementOrSelector: string | HTMLInputElement | HTMLTextAreaElement,
      text: string,
      options?: any
    ) => type.type(elementOrSelector, text, options),
    {
      type: (el: any, text: string, options?: any) => type.type(el, text, options),
      click: (el: any) => type.click(el),
      select: (el: any, val: string) => type.select(el, val),
      applyMask: (raw: string, maskType: string) => type.applyMask(raw, maskType),
      mask: (raw: string, maskType: string) => type.applyMask(raw, maskType),
      setNativeValue: (el: any, val: string) => type.setNativeValue(el, val)
    }
  );
  instance.type = typeFn;
  instance.click = (el: string | HTMLElement) => type.click(el);
  instance.select = (el: string | HTMLSelectElement | HTMLElement, val: string) => type.select(el, val);

  const scanFn = Object.assign(
    (scope?: string | HTMLElement) => scan.scan(scope),
    {
      scan: (scope?: string | HTMLElement) => scan.scan(scope),
      resolveScope: (scope?: string | HTMLElement, options?: any) => scan.resolveScope(scope, options),
      resolveElement: (sel: string | HTMLElement) => resolveElement(sel),
      explore: (scope?: string) => scan.explore(scope),
      clearBadges: () => scan.clearBadges()
    }
  );
  instance.scan = scanFn;
  instance.explore = (scope?: string) => scan.explore(scope);
  instance.clearBadges = () => scan.clearBadges();
  instance.visual = visual;
  instance.diff = charDiff;
  instance.calc = calc;
  instance.reporter = reporter;
  instance.workflow = (name: string, steps: WorkflowStep[]) => createWorkflow(name, steps);
  instance.poll = pollDomAssertion;

  return instance;
}

// Global browser auto-registration
if (typeof window !== 'undefined') {
  const globalAny = window as any;
  if (!globalAny.testudo) {
    const $T = createTestudoInstance();
    globalAny.testudo = $T;
    if (!globalAny.$T) {
      globalAny.$T = $T;
    }
  }
}
