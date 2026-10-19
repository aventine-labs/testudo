/**
 * @aventine/testudo - Interactive Visual Workflow & Verification Engine
 * Previews, executes, validates, and reports multi-step browser workflows with:
 * 1. 100% non-mutating preview() with non-intercepting (pointer-events: none) numbered badges
 * 2. Cancellation & AbortSignal support
 * 3. Live DOM element re-resolution & readiness verification before every step
 * 4. Replay protection (prevents accidental double order submission) & unexpected state guards
 * Zero external dependencies.
 */

import { math } from './math.js';
import { format, MonetaryParseOptions, TestudoFormatError } from './format.js';
import { type, TypeOptions } from './type.js';
import { resolveElement } from './scan.js';
import { visual, sanitizeCssColor } from './visual.js';
import { reporter } from './report.js';

export type PollMode = 'eventually' | 'stable';

export interface AssertionPollOptions extends MonetaryParseOptions {
  tolerance?: number;
  message?: string;
  timeout?: number;
  interval?: number;
  mode?: PollMode;
  stableMs?: number;
  signal?: AbortSignal;
}

export type PollOptions = AssertionPollOptions;

export type WorkflowActionType =
  | 'resolve'
  | 'click'
  | 'type'
  | 'select'
  | 'assertCurrency'
  | 'assertBasisPoints'
  | 'assertText';

export interface WorkflowStepDefinition {
  id?: string;
  title: string;
  selector: string;
  action: WorkflowActionType;
  value?: string | number;
  options?: AssertionPollOptions & TypeOptions;
  expectedUrlContains?: string;
  preconditionSelector?: string;
  preconditionText?: { selector: string; expected: string };
  guard?: () => boolean | Promise<boolean>;
}

export type WorkflowStep = WorkflowStepDefinition;

export interface WorkflowStepResult {
  stepNumber: number;
  id?: string;
  title: string;
  selector: string;
  action: WorkflowActionType;
  status: 'pending' | 'previewed' | 'passed' | 'failed' | 'cancelled' | 'skipped';
  elapsedMs: number;
  observedValue?: string | number;
  expectedValue?: string | number;
  error?: string;
  errorCode?: string;
}

export type WorkflowStatus = 'idle' | 'previewed' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowReport {
  name: string;
  status: WorkflowStatus;
  startedAt: string | null;
  completedAt: string | null;
  elapsedMs: number;
  completedSteps: number;
  totalSteps: number;
  steps: WorkflowStepResult[];
  error?: {
    stepNumber: number;
    stepTitle: string;
    code: string;
    message: string;
  };
}

export interface WorkflowRunOptions {
  stepDelayMs?: number;
  signal?: AbortSignal;
  lockUrlPath?: boolean;
  keepBadgesOnSuccess?: boolean;
}

function sleepWithAbort(ms: number, isCancelled: () => boolean, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const pollCancel = setInterval(() => {
      if (isCancelled() || signal?.aborted) {
        onAbort();
      }
    }, Math.min(25, ms));
    const cleanup = () => {
      clearInterval(pollCancel);
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function readElementText(el: HTMLElement): string {
  if (
    (el as HTMLInputElement).value !== undefined &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
  ) {
    return String((el as HTMLInputElement).value);
  }
  return (el.innerText || el.textContent || '').trim();
}

/**
 * Executes a temporal assertion with either 'eventually' (matches at least once within timeout)
 * or 'stable' (remains continuously valid across stableMs observation window) semantics.
 */
export async function pollDomAssertion<T>(
  evaluateSample: () => {
    pass: boolean;
    actual: T;
    expected: T;
    rawText: string;
    delta?: number;
  },
  options: {
    timeout?: number;
    interval?: number;
    mode?: PollMode;
    stableMs?: number;
    signal?: AbortSignal;
    isCancelled?: () => boolean;
  } = {}
): Promise<{
  pass: boolean;
  actual: T;
  expected: T;
  rawText: string;
  delta?: number;
  mode: PollMode;
  observedStableMs: number;
  samples: number;
  instabilityCount: number;
}> {
  const mode: PollMode = options.mode ?? (options.stableMs && options.stableMs > 0 ? 'stable' : 'eventually');
  const stableWindowMs = mode === 'stable' ? (options.stableMs ?? 250) : 0;
  const intervalMs = Math.max(10, options.interval ?? 50);
  const timeoutMs = options.timeout ?? (mode === 'stable' ? Math.max(2000, stableWindowMs * 2) : 2000);

  const startMs = Date.now();
  let stableSinceMs: number | null = null;
  let consecutivePassCount = 0;
  let instabilityCount = 0;
  let samples = 0;
  let lastResult = evaluateSample();
  samples++;

  if (mode === 'eventually' && lastResult.pass) {
    return {
      ...lastResult,
      mode,
      observedStableMs: 0,
      samples,
      instabilityCount: 0
    };
  }

  if (mode === 'stable' && lastResult.pass) {
    stableSinceMs = startMs;
    consecutivePassCount = 1;
  }

  while (Date.now() - startMs < timeoutMs) {
    if (options.signal?.aborted || options.isCancelled?.()) {
      break;
    }

    await sleepWithAbort(intervalMs, () => Boolean(options.isCancelled?.()), options.signal);

    if (options.signal?.aborted || options.isCancelled?.()) {
      break;
    }

    const now = Date.now();
    lastResult = evaluateSample();
    samples++;

    if (mode === 'eventually') {
      if (lastResult.pass) {
        return {
          ...lastResult,
          mode,
          observedStableMs: 0,
          samples,
          instabilityCount
        };
      }
    } else {
      // mode === 'stable'
      if (lastResult.pass) {
        if (stableSinceMs === null) {
          stableSinceMs = now;
          consecutivePassCount = 1;
        } else {
          consecutivePassCount++;
          const elapsedStable = now - stableSinceMs;
          if (elapsedStable >= stableWindowMs && consecutivePassCount >= 2) {
            return {
              ...lastResult,
              mode,
              observedStableMs: elapsedStable,
              samples,
              instabilityCount
            };
          }
        }
      } else {
        if (stableSinceMs !== null) {
          instabilityCount++;
        }
        stableSinceMs = null;
        consecutivePassCount = 0;
      }
    }
  }

  const finalObservedStableMs =
    mode === 'stable' && stableSinceMs !== null ? Date.now() - stableSinceMs : 0;

  return {
    ...lastResult,
    pass: false,
    mode,
    observedStableMs: finalObservedStableMs,
    samples,
    instabilityCount
  };
}

export class TestudoWorkflow {
  public readonly name: string;
  private readonly steps: WorkflowStepDefinition[];
  private status: WorkflowStatus = 'idle';
  private cancelReason: string | null = null;
  private startedAt: string | null = null;
  private completedAt: string | null = null;
  private elapsedMs = 0;
  private stepResults: WorkflowStepResult[] = [];
  private failureInfo?: {
    stepNumber: number;
    stepTitle: string;
    code: string;
    message: string;
  };

  constructor(name: string, steps: WorkflowStepDefinition[]) {
    if (!name || typeof name !== 'string') {
      throw new Error('[Testudo Workflow] Workflow name must be a non-empty string.');
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error(`[Testudo Workflow] Workflow "${name}" must define at least one step.`);
    }
    this.name = name;
    this.steps = steps.map((s) => ({ ...s }));
    this.initStepResults();
  }

  private initStepResults(): void {
    this.stepResults = this.steps.map((s, idx) => ({
      stepNumber: idx + 1,
      id: s.id,
      title: s.title,
      selector: s.selector,
      action: s.action,
      status: 'pending',
      elapsedMs: 0
    }));
  }

  public getStatus(): WorkflowStatus {
    return this.status;
  }

  public getReport(): WorkflowReport {
    return {
      name: this.name,
      status: this.status,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      elapsedMs: this.elapsedMs,
      completedSteps: this.stepResults.filter((s) => s.status === 'passed').length,
      totalSteps: this.steps.length,
      steps: this.stepResults.map((s) => ({ ...s })),
      ...(this.failureInfo ? { error: { ...this.failureInfo } } : {})
    };
  }

  /**
   * Cancels an active or pending workflow immediately before the next action or poll interval.
   */
  public cancel(reason: string = 'Cancelled by caller'): void {
    this.cancelReason = reason;
    if (this.status === 'running' || this.status === 'idle' || this.status === 'previewed') {
      this.status = 'cancelled';
    }
  }

  /**
   * Resets a completed, failed, or cancelled workflow so it can be re-executed.
   * Requires explicit { confirmReplay: true } to prevent accidental duplicate form/order submissions.
   */
  public reset(options?: { confirmReplay?: boolean }): this {
    if (this.status === 'running') {
      throw new Error(`[Testudo WORKFLOW_RUNNING] Cannot reset workflow "${this.name}" while it is running. Call cancel() first.`);
    }
    if (
      (this.status === 'completed' || this.status === 'failed' || this.status === 'cancelled') &&
      !options?.confirmReplay
    ) {
      const err: any = new Error(
        `[Testudo WORKFLOW_REPLAY_BLOCKED] Resetting workflow "${this.name}" requires explicit { confirmReplay: true } to prevent duplicate order or form submissions.`
      );
      err.code = 'WORKFLOW_REPLAY_BLOCKED';
      throw err;
    }
    this.status = 'idle';
    this.cancelReason = null;
    this.startedAt = null;
    this.completedAt = null;
    this.elapsedMs = 0;
    this.failureInfo = undefined;
    this.initStepResults();
    this.clearWorkflowOverlays();
    return this;
  }

  public clearWorkflowOverlays(): void {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('[data-testudo-workflow-overlay]').forEach((el) => el.remove());
  }

  private renderStepOverlay(
    el: HTMLElement,
    stepNumber: number,
    title: string,
    state: 'preview' | 'active' | 'passed' | 'failed' | 'cancelled'
  ): void {
    if (typeof document === 'undefined') return;

    const existing = document.querySelector(`[data-testudo-workflow-step="${stepNumber}"]`);
    if (existing) existing.remove();

    const palette: Record<typeof state, { border: string; bg: string; text: string; prefix: string }> = {
      preview: { border: '#38BDF8', bg: '#0284C7', text: '#F8FAFC', prefix: `[${stepNumber}]` },
      active: { border: '#F59E0B', bg: '#F59E0B', text: '#030712', prefix: `[▶ ${stepNumber}]` },
      passed: { border: '#10B981', bg: '#10B981', text: '#030712', prefix: `[✓ ${stepNumber}]` },
      failed: { border: '#EF4444', bg: '#EF4444', text: '#F8FAFC', prefix: `[✖ ${stepNumber}]` },
      cancelled: { border: '#F59E0B', bg: '#78350F', text: '#FEF3C7', prefix: `[⊘ ${stepNumber}]` }
    };

    const styleSpec = palette[state];
    const safeBorder = sanitizeCssColor(styleSpec.border, '#38BDF8');
    const rect = el.getBoundingClientRect();

    const box = document.createElement('div');
    box.setAttribute('data-testudo-overlay', 'true');
    box.setAttribute('data-testudo-workflow-overlay', 'true');
    box.setAttribute('data-testudo-workflow-step', String(stepNumber));
    box.setAttribute('data-testudo-workflow-state', state);
    // Strictly non-intercepting (pointer-events: none) and absolute-positioned (zero layout shift)
    box.style.cssText = `position:absolute;top:${rect.top + window.scrollY - 3}px;left:${rect.left + window.scrollX - 3}px;width:${rect.width + 6}px;height:${rect.height + 6}px;border:2px solid ${safeBorder};border-radius:6px;box-shadow:0 0 12px ${safeBorder}66;pointer-events:none;z-index:99997;box-sizing:border-box;`;

    const badge = document.createElement('div');
    badge.setAttribute('data-testudo-workflow-badge', String(stepNumber));
    badge.style.cssText = `position:absolute;top:-20px;left:-2px;background:${styleSpec.bg};color:${styleSpec.text};font:800 10px monospace;padding:1px 6px;border-radius:4px;white-space:nowrap;pointer-events:none;`;
    badge.textContent = `${styleSpec.prefix} ${title}`;

    box.appendChild(badge);
    document.body.appendChild(box);
  }

  private resolveAndValidateLiveElement(step: WorkflowStepDefinition): HTMLElement {
    const el = resolveElement(step.selector, document, { requireUnique: true });
    if (!el) {
      const err: any = new Error(
        `[Testudo ELEMENT_NOT_FOUND] Step "${step.title}" could not find element for selector "${step.selector}".`
      );
      err.code = 'ELEMENT_NOT_FOUND';
      throw err;
    }
    if (!document.body.contains(el)) {
      const err: any = new Error(
        `[Testudo ELEMENT_DETACHED] Step "${step.title}" target "${step.selector}" is detached from document.body.`
      );
      err.code = 'ELEMENT_DETACHED';
      throw err;
    }
    const computed = window.getComputedStyle(el);
    if (computed.display === 'none' || computed.visibility === 'hidden') {
      const err: any = new Error(
        `[Testudo ELEMENT_HIDDEN] Step "${step.title}" target "${step.selector}" is hidden (display: ${computed.display}, visibility: ${computed.visibility}).`
      );
      err.code = 'ELEMENT_HIDDEN';
      throw err;
    }
    if (
      (step.action === 'click' || step.action === 'type' || step.action === 'select') &&
      (el as HTMLButtonElement).disabled
    ) {
      const err: any = new Error(
        `[Testudo ELEMENT_DISABLED] Step "${step.title}" target "${step.selector}" is disabled.`
      );
      err.code = 'ELEMENT_DISABLED';
      throw err;
    }
    return el;
  }

  private async verifyStepPreconditions(step: WorkflowStepDefinition, initialPathname: string, lockUrlPath?: boolean): Promise<void> {
    if (typeof window !== 'undefined' && lockUrlPath) {
      if (window.location.pathname !== initialPathname) {
        const err: any = new Error(
          `[Testudo UNEXPECTED_STATE_CHANGE] URL pathname changed unexpectedly from "${initialPathname}" to "${window.location.pathname}" before step "${step.title}".`
        );
        err.code = 'UNEXPECTED_STATE_CHANGE';
        throw err;
      }
    }

    if (step.expectedUrlContains && typeof window !== 'undefined') {
      if (!window.location.href.includes(step.expectedUrlContains)) {
        const err: any = new Error(
          `[Testudo UNEXPECTED_STATE_CHANGE] Step "${step.title}" expected URL to contain "${step.expectedUrlContains}", but got "${window.location.href}".`
        );
        err.code = 'UNEXPECTED_STATE_CHANGE';
        throw err;
      }
    }

    if (step.preconditionSelector) {
      const preEl = resolveElement(step.preconditionSelector, document, { requireUnique: false });
      if (!preEl || !document.body.contains(preEl)) {
        const err: any = new Error(
          `[Testudo UNEXPECTED_STATE_CHANGE] Precondition selector "${step.preconditionSelector}" missing before step "${step.title}".`
        );
        err.code = 'UNEXPECTED_STATE_CHANGE';
        throw err;
      }
    }

    if (step.preconditionText) {
      const preEl = resolveElement(step.preconditionText.selector, document, { requireUnique: true });
      const actualText = preEl ? format.normalizeWhitespace(readElementText(preEl)) : '';
      const expectedText = format.normalizeWhitespace(step.preconditionText.expected);
      if (!preEl || actualText !== expectedText) {
        const err: any = new Error(
          `[Testudo UNEXPECTED_STATE_CHANGE] Precondition text mismatch on "${step.preconditionText.selector}" before step "${step.title}": expected "${expectedText}", got "${actualText}".`
        );
        err.code = 'UNEXPECTED_STATE_CHANGE';
        throw err;
      }
    }

    if (typeof step.guard === 'function') {
      const ok = await step.guard();
      if (!ok) {
        const err: any = new Error(
          `[Testudo UNEXPECTED_STATE_CHANGE] Custom state guard returned false before step "${step.title}".`
        );
        err.code = 'UNEXPECTED_STATE_CHANGE';
        throw err;
      }
    }
  }

  /**
   * 100% Non-Mutating Preview:
   * Resolves and validates all step selectors, renders numbered non-intercepting badges ([1], [2], ...),
   * and performs ZERO clicks, inputs, or state mutations.
   */
  public preview(): WorkflowReport {
    if (this.status === 'running') {
      throw new Error(`[Testudo WORKFLOW_RUNNING] Cannot preview workflow "${this.name}" while it is running.`);
    }
    this.clearWorkflowOverlays();

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      const t0 = Date.now();
      const el = this.resolveAndValidateLiveElement(step);
      this.renderStepOverlay(el, i + 1, step.title, 'preview');
      this.stepResults[i].status = 'previewed';
      this.stepResults[i].elapsedMs = Date.now() - t0;
    }

    if (this.status === 'idle') {
      this.status = 'previewed';
    }
    return this.getReport();
  }

  /**
   * Executes the workflow with live element re-resolution, precondition guards, cancellation checks,
   * and replay protection.
   */
  public async run(options: WorkflowRunOptions = {}): Promise<WorkflowReport> {
    if (this.status === 'running') {
      const err: any = new Error(`[Testudo WORKFLOW_REPLAY_BLOCKED] Workflow "${this.name}" is already running.`);
      err.code = 'WORKFLOW_REPLAY_BLOCKED';
      throw err;
    }
    if (this.status === 'completed' || this.status === 'failed') {
      const err: any = new Error(
        `[Testudo WORKFLOW_REPLAY_BLOCKED] Workflow "${this.name}" has already executed (status: ${this.status}). Call reset({ confirmReplay: true }) before re-running.`
      );
      err.code = 'WORKFLOW_REPLAY_BLOCKED';
      throw err;
    }
    if (this.status === 'cancelled' || options.signal?.aborted) {
      this.status = 'cancelled';
      return this.getReport();
    }

    this.status = 'running';
    this.startedAt = new Date().toISOString();
    const runStartMs = Date.now();
    const initialPathname = typeof window !== 'undefined' ? window.location.pathname : '';
    const stepDelayMs = options.stepDelayMs ?? 0;

    // Render initial preview badges so the full numbered sequence is visible
    this.clearWorkflowOverlays();
    for (let i = 0; i < this.steps.length; i++) {
      try {
        const el = resolveElement(this.steps[i].selector, document, { requireUnique: true });
        if (el) this.renderStepOverlay(el, i + 1, this.steps[i].title, 'preview');
      } catch {
        // Defer error to the step's live execution
      }
    }

    const isCancelled = () => this.status === 'cancelled' || Boolean(this.cancelReason) || Boolean(options.signal?.aborted);

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      const stepRes = this.stepResults[i];
      const stepStartMs = Date.now();

      if (isCancelled()) {
        this.status = 'cancelled';
        stepRes.status = 'cancelled';
        this.completedAt = new Date().toISOString();
        this.elapsedMs = Date.now() - runStartMs;
        return this.getReport();
      }

      let liveEl: HTMLElement | null = null;
      try {
        // 1. Check unexpected state changes & preconditions before touching the DOM
        await this.verifyStepPreconditions(step, initialPathname, options.lockUrlPath);

        // 2. Re-resolve element fresh from live DOM right before use
        liveEl = this.resolveAndValidateLiveElement(step);
        this.renderStepOverlay(liveEl, i + 1, step.title, 'active');

        if (stepDelayMs > 0) {
          await sleepWithAbort(stepDelayMs, isCancelled, options.signal);
          if (isCancelled()) {
            this.status = 'cancelled';
            stepRes.status = 'cancelled';
            this.renderStepOverlay(liveEl, i + 1, step.title, 'cancelled');
            this.completedAt = new Date().toISOString();
            this.elapsedMs = Date.now() - runStartMs;
            return this.getReport();
          }
          // Re-verify element connectedness after delay
          liveEl = this.resolveAndValidateLiveElement(step);
        }

        // 3. Execute step action
        if (step.action === 'resolve') {
          stepRes.observedValue = readElementText(liveEl);
        } else if (step.action === 'click') {
          await type.click(liveEl);
        } else if (step.action === 'type') {
          await type.type(liveEl as HTMLInputElement, String(step.value ?? ''), step.options);
          stepRes.observedValue = readElementText(liveEl);
        } else if (step.action === 'select') {
          await type.select(liveEl as HTMLSelectElement, String(step.value ?? ''));
          stepRes.observedValue = readElementText(liveEl);
        } else if (step.action === 'assertCurrency') {
          const expected = step.value ?? 0;
          const opts = step.options || {};
          const tol = opts.tolerance ?? 0.01;
          const expVal =
            typeof expected === 'number'
              ? expected
              : format.parseMonetary(expected, { locale: opts.locale, applyMagnitude: opts.applyMagnitude });

          const pollRes = await pollDomAssertion(
            () => {
              const currentEl = this.resolveAndValidateLiveElement(step);
              const rawText = readElementText(currentEl);
              if (!rawText) {
                return { pass: false, actual: NaN, expected: expVal, rawText: '' };
              }
              const actualVal = format.parseMonetary(rawText, {
                tokenIndex: opts.tokenIndex,
                locale: opts.locale,
                applyMagnitude: opts.applyMagnitude
              });
              const delta = Math.round((actualVal - expVal) * 1e4) / 1e4;
              return {
                pass: math.isCloseTo(actualVal, expVal, tol),
                actual: actualVal,
                expected: expVal,
                rawText,
                delta
              };
            },
            {
              timeout: opts.timeout ?? 2000,
              interval: opts.interval ?? 50,
              mode: opts.mode,
              stableMs: opts.stableMs,
              signal: options.signal,
              isCancelled
            }
          );

          if (isCancelled()) {
            this.status = 'cancelled';
            stepRes.status = 'cancelled';
            this.renderStepOverlay(liveEl, i + 1, step.title, 'cancelled');
            this.completedAt = new Date().toISOString();
            this.elapsedMs = Date.now() - runStartMs;
            return this.getReport();
          }

          stepRes.observedValue = pollRes.actual;
          stepRes.expectedValue = expVal;

          if (!pollRes.pass) {
            const msg =
              opts.message ||
              (pollRes.mode === 'stable'
                ? `Currency value on ${step.selector} failed stability check (${opts.stableMs ?? 250}ms window, instability count: ${pollRes.instabilityCount}). Expected ${expVal}, last actual ${pollRes.actual}`
                : `Currency mismatch on ${step.selector}: expected ${expVal}, got ${pollRes.actual}`);
            await visual.highlightError(liveEl, {
              message: msg,
              expected: String(expected),
              actual: pollRes.rawText
            });
            const err: any = new Error(`[Testudo WORKFLOW_ASSERTION_FAILED] ${msg}`);
            err.code = 'WORKFLOW_ASSERTION_FAILED';
            throw err;
          }
        } else if (step.action === 'assertBasisPoints') {
          const expected = step.value ?? 0;
          const opts = step.options || {};
          const tol = opts.tolerance ?? 0.01;
          const expBps = format.parseBasisPoints(expected).bps;

          const pollRes = await pollDomAssertion(
            () => {
              const currentEl = this.resolveAndValidateLiveElement(step);
              const rawText = readElementText(currentEl);
              if (!rawText) {
                return { pass: false, actual: NaN, expected: expBps, rawText: '' };
              }
              const actualBps = format.parseBasisPoints(rawText, { tokenIndex: opts.tokenIndex }).bps;
              return {
                pass: math.isCloseTo(actualBps, expBps, tol),
                actual: actualBps,
                expected: expBps,
                rawText
              };
            },
            {
              timeout: opts.timeout ?? 2000,
              interval: opts.interval ?? 50,
              mode: opts.mode,
              stableMs: opts.stableMs,
              signal: options.signal,
              isCancelled
            }
          );

          stepRes.observedValue = pollRes.actual;
          stepRes.expectedValue = expBps;

          if (!pollRes.pass) {
            const msg = `Basis points mismatch on ${step.selector}: expected ${expBps} bps, got ${pollRes.actual} bps`;
            await visual.highlightError(liveEl, {
              message: msg,
              expected: `${expBps} bps`,
              actual: pollRes.rawText
            });
            const err: any = new Error(`[Testudo WORKFLOW_ASSERTION_FAILED] ${msg}`);
            err.code = 'WORKFLOW_ASSERTION_FAILED';
            throw err;
          }
        } else if (step.action === 'assertText') {
          const expected = format.normalizeWhitespace(String(step.value ?? ''));
          const opts = step.options || {};

          const pollRes = await pollDomAssertion(
            () => {
              const currentEl = this.resolveAndValidateLiveElement(step);
              const rawText = format.normalizeWhitespace(readElementText(currentEl));
              return {
                pass: rawText === expected,
                actual: rawText,
                expected,
                rawText
              };
            },
            {
              timeout: opts.timeout ?? 2000,
              interval: opts.interval ?? 50,
              mode: opts.mode,
              stableMs: opts.stableMs,
              signal: options.signal,
              isCancelled
            }
          );

          stepRes.observedValue = pollRes.actual;
          stepRes.expectedValue = expected;

          if (!pollRes.pass) {
            const msg = `Text mismatch on ${step.selector}: expected "${expected}", got "${pollRes.actual}"`;
            await visual.highlightError(liveEl, {
              message: msg,
              expected,
              actual: pollRes.rawText
            });
            const err: any = new Error(`[Testudo WORKFLOW_ASSERTION_FAILED] ${msg}`);
            err.code = 'WORKFLOW_ASSERTION_FAILED';
            throw err;
          }
        }

        stepRes.status = 'passed';
        stepRes.elapsedMs = Date.now() - stepStartMs;
        this.renderStepOverlay(liveEl, i + 1, step.title, 'passed');
      } catch (err: any) {
        stepRes.status = 'failed';
        stepRes.elapsedMs = Date.now() - stepStartMs;
        const code = err?.code || (err instanceof TestudoFormatError ? err.code : 'WORKFLOW_STEP_FAILED');
        const message = err?.message || String(err);
        stepRes.error = message;
        stepRes.errorCode = code;

        if (liveEl && code !== 'WORKFLOW_ASSERTION_FAILED') {
          this.renderStepOverlay(liveEl, i + 1, step.title, 'failed');
        }

        for (let rem = i + 1; rem < this.stepResults.length; rem++) {
          this.stepResults[rem].status = 'skipped';
        }

        this.status = 'failed';
        this.failureInfo = {
          stepNumber: i + 1,
          stepTitle: step.title,
          code,
          message
        };
        this.completedAt = new Date().toISOString();
        this.elapsedMs = Date.now() - runStartMs;

        reporter.error(`Workflow "${this.name}" halted at step ${i + 1} (${step.title}): ${message}`, {
          selector: step.selector
        });

        throw err;
      }
    }

    this.status = 'completed';
    this.completedAt = new Date().toISOString();
    this.elapsedMs = Date.now() - runStartMs;
    if (options.keepBadgesOnSuccess === false) {
      this.clearWorkflowOverlays();
    }
    return this.getReport();
  }
}

export function createWorkflow(name: string, steps: WorkflowStepDefinition[]): TestudoWorkflow {
  return new TestudoWorkflow(name, steps);
}
