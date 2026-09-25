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
  instance.type = type;
  instance.scan = (scope?: string) => scan.scan(scope);
  instance.explore = (scope?: string) => scan.explore(scope);
  instance.visual = visual;
  instance.diff = charDiff;

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
