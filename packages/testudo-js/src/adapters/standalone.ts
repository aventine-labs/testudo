/**
 * @aventine/testudo - Standalone Browser & ESM Adapter
 * Attaches window.testudo and window.$T for synthetic monitors (Apica, Datadog) and DevTools console.
 * Zero external dependencies.
 */

import { math } from '../math.js';
import { format, FormatParseOptions, TestudoFormatError } from '../format.js';
import { type } from '../type.js';
import { scan, resolveElement, resolveDeepElement } from '../scan.js';
import { visual } from '../visual.js';
import { charDiff } from '../diff.js';
import { calc } from '../calc.js';
import { reporter } from '../report.js';
import { createWorkflow, pollDomAssertion, PollOptions, WorkflowStep } from '../workflow.js';
import { concierge, TestudoInitConfig, getLauncherIconSvg } from '../launcher.js';
import { digest, digestScript } from '../digest.js';
import { wasmConcierge } from '../wasm-concierge.js';
import { telemetry } from '../telemetry.js';
import { kinetic } from '../kinetic.js';
import { mountTestudoWidget, ShadowWidgetConfig } from '../ui/shadow-widget.js';
import { buildMultiAnchor, resolveWithSemanticSelfHeal, assertNativeIntrinsicsUntouched } from '../probe.js';
import { awaitCausalQuiescence, CausalQuiescenceOptions } from '../quiescence.js';
import { TestudoWaterfallRecorder } from '../waterfall.js';
import { runZeroCloudPageAudit } from '../audit.js';
import { TestudoWireInterceptor, proveIdempotencyAndOutOfOrderSafety } from '../intercept.js';
import { TestudoTimeTravelRing } from '../timetravel.js';
import { runDomCardinalityStress, runInputEnduranceAndThreeStepLeakProbe } from '../stress.js';
import { semanticQueries, expectValue, spyFn, TestudoSuiteRunner } from '../runner.js';
import { xray, inspectElementXray, XrayOptions } from '../xray.js';

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

    const runNumericPoll = async (
      expVal: number,
      opts: any,
      parseFn: (raw: string) => number,
      hlExpected: string,
      defaultMsgFn: (actual: number) => string,
      errFn: (actual: number, raw: string, delta: number, mode: string) => string
    ) => {
      const target = getElement(true);
      if (!target) throw new Error(`[Testudo] Element not found: ${selectorOrElement}`);
      const tol = opts?.tolerance ?? 0.01;
      let lastFmtErr: any = null;
      const pollRes = await pollDomAssertion<number>(
        () => {
          const raw = readElementText(target);
          try {
            const actual = parseFn(raw);
            lastFmtErr = null;
            const delta = Math.round((actual - expVal) * 1e4) / 1e4;
            return { pass: math.isCloseTo(actual, expVal, tol), actual, expected: expVal, rawText: raw, delta };
          } catch (err: any) {
            if (err instanceof TestudoFormatError) lastFmtErr = err;
            return { pass: false, actual: Number.NaN, expected: expVal, rawText: raw, delta: Number.NaN };
          }
        },
        {
          timeout: opts?.timeout ?? (opts?.mode === 'stable' ? 1500 : 250),
          interval: opts?.interval ?? 50,
          mode: opts?.mode ?? 'eventually',
          stableMs: opts?.stableMs ?? 250,
          signal: opts?.signal
        }
      );
      if (!pollRes.pass) {
        const delta = pollRes.delta ?? Number.NaN;
        const msg = opts?.message || (lastFmtErr ? lastFmtErr.message : defaultMsgFn(pollRes.actual));
        const { diff } = await visual.highlightError(target, { message: msg, expected: hlExpected, actual: pollRes.rawText });
        reporter.error(msg, {
          selector: typeof selectorOrElement === 'string' ? selectorOrElement : target.id || target.tagName,
          expected: expVal,
          actual: pollRes.actual,
          delta,
          tolerance: tol,
          divergenceIndex: diff?.index
        });
        if (lastFmtErr) throw lastFmtErr;
        throw new Error(errFn(pollRes.actual, pollRes.rawText, delta, pollRes.mode));
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
      xray: (options?: XrayOptions) => inspectElementXray(selectorOrElement, options),
      assertCurrency: async (expected: string | number, options?: AssertCurrencyOptions) => {
        const expVal = typeof expected === 'number' ? expected : format.parse(expected, options);
        return runNumericPoll(
          expVal,
          options,
          (raw) => format.parse(raw, options),
          typeof expected === 'string' ? expected : String(expected),
          (actual) => `Currency mismatch: expected ${expVal}, got ${actual}`,
          (actual, raw, delta, mode) =>
            `[Testudo] ${options?.message || `Currency mismatch: expected ${expVal}, got ${actual}`} | Currency assertion failed on ${selectorOrElement}. Expected: ${expVal}, Actual: ${actual} (raw: "${raw}", delta: ${delta}, mode: ${mode})`
        );
      },
      assertBasisPoints: async (expected: string | number, options?: AssertBasisPointsOptions) => {
        const expBps = typeof expected === 'number' ? expected : format.parseBasisPoints(expected, options).bps;
        const res = await runNumericPoll(
          expBps,
          options,
          (raw) => format.parseBasisPoints(raw, options).bps,
          `${expBps} bps`,
          (actual) => `Basis points mismatch: expected ${expBps} bps, got ${actual} bps`,
          (actual, raw, delta) =>
            `[Testudo] Basis points assertion failed on ${selectorOrElement}. Expected: ${expBps} bps, Actual: ${actual} bps (raw: "${raw}", delta: ${delta})`
        );
        return { ...res, unit: 'bps' as const };
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
      resolveDeepElement: (sel: string | HTMLElement, root?: any, opts?: any) => resolveDeepElement(sel, root, opts),
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
  instance.concierge = concierge;
  instance.init = (config?: TestudoInitConfig) => concierge.init(config);
  instance.getLauncherIconSvg = getLauncherIconSvg;
  instance.digest = Object.assign((raw: string, opts?: any) => digestScript(raw, opts), digest);
  instance.wasmConcierge = wasmConcierge;
  instance.wasm = wasmConcierge;
  instance.telemetry = telemetry;
  instance.kinetic = kinetic;
  instance.mountWidget = (config?: ShadowWidgetConfig) => mountTestudoWidget(config);
  instance.awaitCausalQuiescence = (opts?: CausalQuiescenceOptions) => awaitCausalQuiescence(opts);
  instance.waterfall = (opts?: any) => new TestudoWaterfallRecorder(opts);
  instance.audit = (root?: Document | null) => runZeroCloudPageAudit(root);
  instance.intercept = new TestudoWireInterceptor();
  instance.chaos = { proveIdempotency: proveIdempotencyAndOutOfOrderSafety };
  instance.timeTravel = new TestudoTimeTravelRing();
  instance.stress = {
    amplifyDomVolume: runDomCardinalityStress,
    inputEndurance: runInputEnduranceAndThreeStepLeakProbe
  };
  instance.probe = {
    buildMultiAnchor,
    resolveWithSemanticSelfHeal,
    assertNativeIntrinsicsUntouched
  };
  instance.xray = xray;
  instance.byRole = semanticQueries.byRole;
  instance.byLabel = semanticQueries.byLabel;
  instance.byText = semanticQueries.byText;
  instance.byTestId = semanticQueries.byTestId;
  instance.expect = expectValue;
  instance.spyFn = spyFn;
  instance.suite = () => new TestudoSuiteRunner();

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
