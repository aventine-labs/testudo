/**
 * @aventine/testudo - Standalone Browser IIFE Adapter
 * Attaches window.testudo and window.$T for synthetic monitors (Apica, Datadog) and DevTools console.
 * Zero external dependencies.
 */

import { math } from '../math.js';
import { format } from '../format.js';
import { type } from '../type.js';
import { scan } from '../scan.js';
import { visual } from '../visual.js';
import { charDiff } from '../diff.js';
import { calc } from '../calc.js';

export function createTestudoInstance() {
  const instance: any = function (selectorOrElement: string | HTMLElement) {
    let el: HTMLElement | null = null;
    if (typeof selectorOrElement === 'string') {
      el = document.querySelector(selectorOrElement);
    } else {
      el = selectorOrElement;
    }

    return {
      element: el,
      type: async (text: string, options?: any) => {
        if (!el) throw new Error(`[Testudo] Element not found: ${selectorOrElement}`);
        return type.type(el as HTMLInputElement, text, options);
      },
      scan: () => {
        if (!el) return [];
        return scan.scan(el);
      },
      assertCurrency: async (expected: string | number, options?: { tolerance?: number }) => {
        if (!el) throw new Error(`[Testudo] Element not found: ${selectorOrElement}`);
        const raw = el.innerText || (el as HTMLInputElement).value || '';
        const actualVal = format.parse(raw);
        const expVal = typeof expected === 'number' ? expected : format.parse(expected);
        const tol = options?.tolerance ?? 0.01;

        if (!math.isCloseTo(actualVal, expVal, tol)) {
          await visual.highlightError(el, {
            message: `Currency mismatch: expected ${expVal}, got ${actualVal}`,
            expected: typeof expected === 'string' ? expected : String(expected),
            actual: raw
          });
          throw new Error(
            `[Testudo] Currency assertion failed. Expected: ${expVal}, Actual: ${actualVal}`
          );
        }
      },
      highlightError: async (message?: string) => {
        if (!el) return;
        return visual.highlightError(el, { message });
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
      applyMask: (raw: string, maskType: string) => type.applyMask(raw, maskType),
      mask: (raw: string, maskType: string) => type.applyMask(raw, maskType),
      setNativeValue: (el: any, val: string) => type.setNativeValue(el, val)
    }
  );
  instance.type = typeFn;

  const scanFn = Object.assign(
    (scope?: string | HTMLElement) => scan.scan(scope),
    {
      scan: (scope?: string | HTMLElement) => scan.scan(scope),
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
