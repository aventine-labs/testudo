/**
 * @aventine/testudo - Playwright Fixture & Unified In-Page Bridge Adapter
 * Bridges Node.js Playwright test runner with the compiled in-browser Testudo IIFE runtime
 * (dist/testudo.iife.js), ensuring 100% calculation, parsing, workflow, and visual forensics parity
 * between Node-driven Playwright and browser-native Standalone mode.
 * Zero external runtime dependencies.
 */

import { testudoMatchers } from '../matchers.js';
import { math } from '../math.js';
import { format, FormatParseOptions } from '../format.js';
import { type, TypeOptions } from '../type.js';
import { visual, VisualErrorOptions } from '../visual.js';
import { calc, CalcEvaluation, CalcAssertResult } from '../calc.js';
import { reporter } from '../report.js';
import { PollOptions, WorkflowStep, WorkflowRunOptions, WorkflowReport } from '../workflow.js';

export interface SerializedScannedElement {
  index: number;
  tag: string;
  type?: string;
  name?: string;
  id?: string;
  label?: string;
  role?: string;
  text?: string;
  action: 'click' | 'type' | 'select';
  selector: string;
  snippet: string;
}

export interface PlaywrightAssertOptions extends FormatParseOptions, PollOptions {
  tolerance?: number;
  message?: string;
  screenshotPath?: string;
}

export interface TestudoPlaywrightSelector {
  click: () => Promise<void>;
  type: (text: string, options?: TypeOptions) => Promise<void>;
  select: (value: string) => Promise<void>;
  highlight: (label?: string, color?: string) => Promise<void>;
  highlightError: (message?: string, options?: VisualErrorOptions) => Promise<any>;
  assertCurrency: (
    expected: string | number,
    options?: PlaywrightAssertOptions
  ) => Promise<{ pass: boolean; expected: number; actual: number; delta: number; elapsedMs?: number; samples?: number }>;
  assertBasisPoints: (
    expected: string | number,
    options?: PlaywrightAssertOptions
  ) => Promise<{
    pass: boolean;
    expected: number;
    actual: number;
    delta: number;
    unit: 'bps';
    elapsedMs?: number;
    samples?: number;
  }>;
  assertText: (
    expected: string,
    options?: PollOptions & { screenshotPath?: string; message?: string }
  ) => Promise<{ pass: boolean; expected: string; actual: string; elapsedMs?: number; samples?: number }>;
}

export interface TestudoPlaywrightWorkflowBridge {
  preview: () => Promise<{ name: string; count: number; steps: Array<{ stepNumber: number; selector: string; label: string }> }>;
  clearPreview: () => Promise<void>;
  run: (runOptions?: WorkflowRunOptions) => Promise<WorkflowReport>;
  cancel: (reason?: string) => Promise<void>;
  reset: (options?: { confirmReplay?: boolean }) => Promise<void>;
  getReport: () => Promise<WorkflowReport>;
}

export interface TestudoPlaywrightBridge {
  (selector: string): TestudoPlaywrightSelector;
  math: typeof math;
  format: typeof format;
  type: (selector: string, text: string, options?: TypeOptions) => Promise<void>;
  click: (selector: string) => Promise<void>;
  select: (selector: string, value: string) => Promise<void>;
  scan: (scope?: string) => Promise<SerializedScannedElement[]>;
  explore: (scope?: string) => Promise<number>;
  clearBadges: () => Promise<void>;
  cleanup: () => Promise<void>;
  highlightError: (selector: string, options?: VisualErrorOptions) => Promise<any>;
  calc: (
    expression: string,
    customValues?: Record<string, number | string>
  ) => {
    evaluate: () => Promise<CalcEvaluation>;
    toEqualCurrency: (
      targetSelectorOrValue: string | number,
      options?: {
        tolerance?: number;
        autoHighlight?: boolean;
        screenshotPath?: string;
        tokenIndex?: number;
        locale?: string;
        throwOnFail?: boolean;
      }
    ) => Promise<CalcAssertResult>;
  };
  workflow: (
    name: string,
    steps: WorkflowStep[],
    options?: WorkflowRunOptions
  ) => TestudoPlaywrightWorkflowBridge;
  visual: typeof visual;
  reporter: typeof reporter;
}

export interface TestudoFixture {
  $T: TestudoPlaywrightBridge;
}

let matchersRegistered = false;
let cachedIifeBundle: string | null = null;

function ensureMatchersRegistered(): void {
  if (matchersRegistered) return;
  try {
    const g = globalThis as any;
    if (g.expect && typeof g.expect.extend === 'function') {
      g.expect.extend(testudoMatchers);
      matchersRegistered = true;
    }
  } catch {
    // Fallback
  }
}

async function getIifeBundleSource(): Promise<string | null> {
  if (cachedIifeBundle) return cachedIifeBundle;
  try {
    const fsMod = await import('node:fs');
    const pathMod = await import('node:path');
    const urlMod = await import('node:url');
    const fs = fsMod.default || fsMod;
    const path = pathMod.default || pathMod;
    const currentFile = urlMod.fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFile);
    const candidates = [
      path.resolve(currentDir, '../testudo.iife.js'),
      path.resolve(currentDir, '../../dist/testudo.iife.js')
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        cachedIifeBundle = fs.readFileSync(candidate, 'utf8');
        return cachedIifeBundle;
      }
    }
  } catch {
    // Fallback if fs lookup is unavailable in browser environments
  }
  return null;
}

export async function ensureInPageBridge(page: any): Promise<void> {
  if (!page || typeof page.evaluate !== 'function') return;

  const alreadyReady = await page.evaluate(() => {
    const win = window as any;
    return Boolean(win.$T && win.$T.calc && win.$T.workflow && win.$T.format?.parseBasisPoints);
  });

  if (!alreadyReady) {
    const iifeSource = await getIifeBundleSource();
    if (iifeSource) {
      await page.evaluate((code: string) => {
        // Evaluate self-contained Testudo IIFE bundle in page context
        const fn = new Function(code);
        fn();
      }, iifeSource);
    }
  }

  await page.evaluate(() => {
    const win = window as any;
    if (!win.__TESTUDO_WORKFLOWS__) {
      win.__TESTUDO_WORKFLOWS__ = {};
    }
    if (win.__TESTUDO_INPAGE__) return;

    const cleanupOverlays = () => {
      if (win.$T?.visual?.cleanup) {
        win.$T.visual.cleanup();
        return;
      }
      document.querySelectorAll('[data-testudo-overlay]').forEach((el) => el.remove());
      document.querySelectorAll('[data-testudo-outlined]').forEach((el) => {
        const h = el as HTMLElement;
        h.style.removeProperty('outline');
        h.style.removeProperty('outline-offset');
        h.style.removeProperty('box-shadow');
        el.removeAttribute('data-testudo-outlined');
      });
    };

    const highlightStep = (sel: string, label?: string, color = '#10B981') => {
      if (win.$T?.visual?.highlightStep) {
        return Boolean(win.$T.visual.highlightStep(sel, { label, color }));
      }
      return false;
    };

    const highlightError = (sel: string, opts: any = {}) => {
      if (win.$T?.visual?.highlightError) {
        return win.$T.visual.highlightError(sel, opts);
      }
      return { diff: null };
    };

    win.__TESTUDO_INPAGE__ = { cleanupOverlays, highlightStep, highlightError };
  });
}

function stripNonSerializableOptions(options: any = {}) {
  const { signal, guard, screenshotPath, ...rest } = options || {};
  return rest;
}

export function createPlaywrightTestudo(page: any, testInfo?: any): TestudoPlaywrightBridge {
  ensureMatchersRegistered();

  const selectorApi = (selector: string): TestudoPlaywrightSelector => {
    if (!selector || typeof selector !== 'string') {
      throw new Error('[Testudo Playwright] Selector must be a non-empty string.');
    }

    const assertUniqueLocator = async () => {
      const locator = page.locator(selector);
      const count = await locator.count();
      if (count === 0) throw new Error(`[Testudo] Element not found: ${selector}`);
      if (count > 1) {
        throw new Error(`[Testudo] Ambiguous selector "${selector}" matched ${count} elements.`);
      }
      return locator;
    };

    return {
      click: async () => {
        const locator = await assertUniqueLocator();
        await locator.click();
      },
      type: async (text: string, options: TypeOptions = {}) => {
        const locator = await assertUniqueLocator();
        const formatted = options.mask ? type.applyMask(text, options.mask) : text;
        if (options.clearFirst !== false) {
          await locator.fill(formatted);
        } else {
          await locator.pressSequentially(formatted, { delay: options.delay || 0 });
        }
      },
      select: async (value: string) => {
        const locator = await assertUniqueLocator();
        await locator.selectOption(value);
      },
      highlight: async (label?: string, color: string = '#10B981') => {
        await ensureInPageBridge(page);
        await page.evaluate(
          ({ s, l, c }: any) => (window as any).$T(s).highlight(l, c),
          { s: selector, l: label, c: color }
        );
      },
      highlightError: async (message?: string, options: VisualErrorOptions = {}) => {
        await ensureInPageBridge(page);
        return page.evaluate(
          ({ s, m, o }: any) => (window as any).$T(s).highlightError(m, o),
          { s: selector, m: message, o: options }
        );
      },
      assertCurrency: async (expected: string | number, options: PlaywrightAssertOptions = {}) => {
        await assertUniqueLocator();
        await ensureInPageBridge(page);
        const serialOpts = stripNonSerializableOptions(options);

        const evalRes = await page.evaluate(
          async ({ s, exp, opts }: any) => {
            try {
              const res = await (window as any).$T(s).assertCurrency(exp, opts);
              return { ok: true, res };
            } catch (err: any) {
              const hud = document.querySelector('[data-testudo-hud="true"]');
              return {
                ok: false,
                message: err?.message || String(err),
                code: err?.code,
                hudText: hud?.textContent || ''
              };
            }
          },
          { s: selector, exp: expected, opts: serialOpts }
        );

        if (!evalRes.ok) {
          reporter.error(evalRes.message, { selector, expected });
          if (options.screenshotPath && page.screenshot) {
            await page.screenshot({ path: options.screenshotPath, fullPage: false });
          }
          if (testInfo?.attach && page.screenshot) {
            await testInfo.attach('testudo-assertion-failure', {
              body: await page.screenshot({ fullPage: false }),
              contentType: 'image/png'
            });
          }
          const errorObj: any = new Error(
            evalRes.hudText ? `${evalRes.message} | ${evalRes.hudText}` : evalRes.message
          );
          if (evalRes.code) errorObj.code = evalRes.code;
          throw errorObj;
        }

        return evalRes.res;
      },
      assertBasisPoints: async (expected: string | number, options: PlaywrightAssertOptions = {}) => {
        await assertUniqueLocator();
        await ensureInPageBridge(page);
        const serialOpts = stripNonSerializableOptions(options);

        const evalRes = await page.evaluate(
          async ({ s, exp, opts }: any) => {
            try {
              const res = await (window as any).$T(s).assertBasisPoints(exp, opts);
              return { ok: true, res };
            } catch (err: any) {
              const hud = document.querySelector('[data-testudo-hud="true"]');
              return {
                ok: false,
                message: err?.message || String(err),
                code: err?.code,
                hudText: hud?.textContent || ''
              };
            }
          },
          { s: selector, exp: expected, opts: serialOpts }
        );

        if (!evalRes.ok) {
          reporter.error(evalRes.message, { selector, expected });
          if (options.screenshotPath && page.screenshot) {
            await page.screenshot({ path: options.screenshotPath, fullPage: false });
          }
          const errorObj: any = new Error(
            evalRes.hudText ? `${evalRes.message} | ${evalRes.hudText}` : evalRes.message
          );
          if (evalRes.code) errorObj.code = evalRes.code;
          throw errorObj;
        }

        return evalRes.res;
      },
      assertText: async (expected: string, options: any = {}) => {
        await assertUniqueLocator();
        await ensureInPageBridge(page);
        const serialOpts = stripNonSerializableOptions(options);

        const evalRes = await page.evaluate(
          async ({ s, exp, opts }: any) => {
            try {
              const res = await (window as any).$T(s).assertText(exp, opts);
              return { ok: true, res };
            } catch (err: any) {
              const hud = document.querySelector('[data-testudo-hud="true"]');
              return {
                ok: false,
                message: err?.message || String(err),
                hudText: hud?.textContent || ''
              };
            }
          },
          { s: selector, exp: expected, opts: serialOpts }
        );

        if (!evalRes.ok) {
          reporter.error(evalRes.message, { selector, expected });
          if (options.screenshotPath && page.screenshot) {
            await page.screenshot({ path: options.screenshotPath, fullPage: false });
          }
          throw new Error(evalRes.hudText ? `${evalRes.message} | ${evalRes.hudText}` : evalRes.message);
        }

        return evalRes.res;
      }
    };
  };

  const bridge: TestudoPlaywrightBridge = Object.assign(selectorApi, {
    math,
    format,
    type: (s: string, t: string, o?: TypeOptions) => selectorApi(s).type(t, o),
    click: (s: string) => selectorApi(s).click(),
    select: (s: string, v: string) => selectorApi(s).select(v),
    scan: async (scope?: string): Promise<SerializedScannedElement[]> => {
      await ensureInPageBridge(page);
      return page.evaluate((sq?: string) => {
        const items = (window as any).$T.scan(sq);
        return items.map((it: any) => ({
          index: it.index,
          tag: it.tag,
          type: it.type,
          name: it.name,
          id: it.id,
          label: it.label,
          role: it.role,
          text: it.text,
          action: it.action,
          selector: it.selector,
          snippet: it.snippet
        }));
      }, scope);
    },
    explore: async (scope?: string): Promise<number> => {
      await ensureInPageBridge(page);
      return page.evaluate((sq?: string) => {
        (window as any).$T.explore(sq);
        return document.querySelectorAll('.testudo-badge').length;
      }, scope);
    },
    clearBadges: async () => {
      await ensureInPageBridge(page);
      await page.evaluate(() => (window as any).$T.clearBadges());
    },
    cleanup: async () => {
      await ensureInPageBridge(page);
      await page.evaluate(() => {
        (window as any).$T.visual.cleanup();
        (window as any).$T.clearBadges();
      });
    },
    highlightError: (s: string, o?: VisualErrorOptions) => selectorApi(s).highlightError(o?.message, o),
    calc: (expression: string, customValues?: Record<string, number | string>) => ({
      evaluate: async (): Promise<CalcEvaluation> => {
        if (!page || typeof page.evaluate !== 'function') {
          return calc(expression, customValues).evaluate();
        }
        await ensureInPageBridge(page);
        const evalRes = await page.evaluate(
          ({ expr, cv }: any) => {
            try {
              const res = (window as any).$T.calc(expr, cv).evaluate();
              return {
                ok: true,
                res: {
                  expression: res.expression,
                  expectedValue: res.expectedValue,
                  tokens: res.tokens,
                  operands: res.operands.map((op: any) => ({
                    index: op.index,
                    selector: op.selector,
                    rawText: op.rawText,
                    value: op.value,
                    color: op.color,
                    label: op.label,
                    shape: op.shape,
                    borderPattern: op.borderPattern
                  }))
                }
              };
            } catch (err: any) {
              return { ok: false, message: err?.message || String(err), code: err?.code };
            }
          },
          { expr: expression, cv: customValues }
        );
        if (!evalRes.ok) {
          const e: any = new Error(evalRes.message);
          if (evalRes.code) e.code = evalRes.code;
          throw e;
        }
        return evalRes.res;
      },
      toEqualCurrency: async (
        targetSelectorOrValue: string | number,
        options: {
          tolerance?: number;
          autoHighlight?: boolean;
          screenshotPath?: string;
          tokenIndex?: number;
          locale?: string;
          throwOnFail?: boolean;
        } = {}
      ): Promise<CalcAssertResult> => {
        if (!page || typeof page.evaluate !== 'function') {
          return calc(expression, customValues).toEqualCurrency(targetSelectorOrValue, options);
        }
        await ensureInPageBridge(page);
        const serialOpts = stripNonSerializableOptions(options);
        const evalRes = await page.evaluate(
          async ({ expr, cv, target, opts }: any) => {
            try {
              const res = await (window as any).$T.calc(expr, cv).toEqualCurrency(target, opts);
              return {
                ok: true,
                res: {
                  pass: res.pass,
                  expected: res.expected,
                  actual: res.actual,
                  delta: res.delta,
                  tolerance: res.tolerance,
                  targetSelector: res.targetSelector,
                  rawTargetText: res.rawTargetText,
                  evaluation: {
                    expression: res.evaluation.expression,
                    expectedValue: res.evaluation.expectedValue,
                    tokens: res.evaluation.tokens,
                    operands: res.evaluation.operands.map((op: any) => ({
                      index: op.index,
                      selector: op.selector,
                      rawText: op.rawText,
                      value: op.value,
                      color: op.color,
                      label: op.label,
                      shape: op.shape,
                      borderPattern: op.borderPattern
                    }))
                  }
                }
              };
            } catch (err: any) {
              return { ok: false, message: err?.message || String(err), code: err?.code };
            }
          },
          { expr: expression, cv: customValues, target: targetSelectorOrValue, opts: serialOpts }
        );
        if (!evalRes.ok) {
          const e: any = new Error(evalRes.message);
          if (evalRes.code) e.code = evalRes.code;
          throw e;
        }
        if (!evalRes.res.pass && options.screenshotPath && page.screenshot) {
          await page.screenshot({ path: options.screenshotPath, fullPage: false });
        }
        if (!evalRes.res.pass && options.throwOnFail) {
          throw new Error(
            `[Testudo Calc Assertion Failed] ${expression} vs ${targetSelectorOrValue}: expected ${evalRes.res.expected}, got ${evalRes.res.actual} (delta: ${evalRes.res.delta})`
          );
        }
        return evalRes.res;
      }
    }),
    workflow: (name: string, steps: WorkflowStep[], options: WorkflowRunOptions = {}): TestudoPlaywrightWorkflowBridge => {
      const serialSteps = steps.map((s) => {
        const { guard, ...rest } = s;
        return rest;
      });
      const serialOpts = stripNonSerializableOptions(options);

      const ensureWf = async () => {
        await ensureInPageBridge(page);
        await page.evaluate(
          ({ wfName, wfSteps, wfOpts }: any) => {
            const win = window as any;
            if (!win.__TESTUDO_WORKFLOWS__[wfName]) {
              win.__TESTUDO_WORKFLOWS__[wfName] = win.$T.workflow(wfName, wfSteps, wfOpts);
            }
          },
          { wfName: name, wfSteps: serialSteps, wfOpts: serialOpts }
        );
      };

      return {
        preview: async () => {
          await ensureWf();
          return page.evaluate(({ wfName }: any) => (window as any).__TESTUDO_WORKFLOWS__[wfName].preview(), {
            wfName: name
          });
        },
        clearPreview: async () => {
          await ensureWf();
          await page.evaluate(({ wfName }: any) => (window as any).__TESTUDO_WORKFLOWS__[wfName].clearPreview(), {
            wfName: name
          });
        },
        run: async (runOptions: WorkflowRunOptions = {}) => {
          await ensureWf();
          const serialRunOpts = stripNonSerializableOptions(runOptions);
          const evalRes = await page.evaluate(
            async ({ wfName, rOpts }: any) => {
              try {
                const report = await (window as any).__TESTUDO_WORKFLOWS__[wfName].run(rOpts);
                return { ok: true, report };
              } catch (err: any) {
                return { ok: false, message: err?.message || String(err), code: err?.code };
              }
            },
            { wfName: name, rOpts: serialRunOpts }
          );
          if (!evalRes.ok) {
            const e: any = new Error(evalRes.message);
            if (evalRes.code) e.code = evalRes.code;
            throw e;
          }
          return evalRes.report;
        },
        cancel: async (reason?: string) => {
          await ensureWf();
          await page.evaluate(
            ({ wfName, r }: any) => (window as any).__TESTUDO_WORKFLOWS__[wfName].cancel(r),
            { wfName: name, r: reason }
          );
        },
        reset: async (resetOpts: { confirmReplay?: boolean } = {}) => {
          await ensureWf();
          const evalRes = await page.evaluate(
            ({ wfName, rOpts }: any) => {
              try {
                (window as any).__TESTUDO_WORKFLOWS__[wfName].reset(rOpts);
                return { ok: true };
              } catch (err: any) {
                return { ok: false, message: err?.message || String(err), code: err?.code };
              }
            },
            { wfName: name, rOpts: resetOpts }
          );
          if (!evalRes.ok) {
            const e: any = new Error(evalRes.message);
            if (evalRes.code) e.code = evalRes.code;
            throw e;
          }
        },
        getReport: async () => {
          await ensureWf();
          return page.evaluate(({ wfName }: any) => (window as any).__TESTUDO_WORKFLOWS__[wfName].getReport(), {
            wfName: name
          });
        }
      };
    },
    visual,
    reporter
  });

  return bridge;
}

export const testudoFixture = {
  $T: async ({ page }: { page: any }, use: (r: TestudoPlaywrightBridge) => Promise<void>, testInfo: any) => {
    const inst = createPlaywrightTestudo(page, testInfo);
    await use(inst);
    if (testInfo && testInfo.status !== testInfo.expectedStatus && page?.screenshot && testInfo.attach) {
      try {
        await testInfo.attach('testudo-failure-forensics', {
          body: await page.screenshot({ fullPage: false }),
          contentType: 'image/png'
        });
      } catch {
        // Ignore teardown screenshot errors
      }
    }
  }
};
