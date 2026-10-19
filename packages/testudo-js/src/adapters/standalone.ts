/**
 * @aventine/testudo - Standalone Browser IIFE Adapter
 * Attaches window.testudo and window.$T for synthetic monitors (Apica, Datadog) and DevTools console.
 * Zero external dependencies.
 */

import { math } from '../math.js';
import { format } from '../format.js';
import { type } from '../type.js';
import { scan, resolveElement } from '../scan.js';
import { visual } from '../visual.js';
import { charDiff } from '../diff.js';
import { calc } from '../calc.js';
import { reporter } from '../report.js';

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
      assertCurrency: async (expected: string | number, options?: { tolerance?: number; message?: string }) => {
        const target = getElement(true);
        if (!target) throw new Error(`[Testudo] Element not found: ${selectorOrElement}`);
        const raw = (target.innerText || target.textContent || (target as HTMLInputElement).value || '').trim();
        const actualVal = format.parse(raw);
        const expVal = typeof expected === 'number' ? expected : format.parse(expected);
        const tol = options?.tolerance ?? 0.01;
        const delta = Math.round((actualVal - expVal) * 1e4) / 1e4;

        if (!math.isCloseTo(actualVal, expVal, tol)) {
          const msg = options?.message || `Currency mismatch: expected ${expVal}, got ${actualVal}`;
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
          throw new Error(
            `[Testudo] Currency assertion failed on ${selectorOrElement}. Expected: ${expVal}, Actual: ${actualVal} (raw: "${raw}", delta: ${delta})`
          );
        }
        return { pass: true, expected: expVal, actual: actualVal, delta };
      },
      assertText: async (expected: string) => {
        const target = getElement(true);
        if (!target) throw new Error(`[Testudo] Element not found: ${selectorOrElement}`);
        const raw = (target.innerText || target.textContent || (target as HTMLInputElement).value || '').trim();
        const normActual = format.normalizeWhitespace(raw);
        const normExpected = format.normalizeWhitespace(expected.trim());

        if (normActual !== normExpected) {
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
        return { pass: true, expected: normExpected, actual: normActual };
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

