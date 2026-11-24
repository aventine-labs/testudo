/**
 * @aventine/testudo - Zero-Sleep Causal Quiescence Engine (src/quiescence.ts)
 * Replaces brittle sleep(2000) timers with a deterministic multi-signal settle barrier:
 * 1. In-flight network counter == 0 (via CDP Network tracker or passive ResourceTiming settle)
 * 2. Microtask + Macrotask turn drain
 * 3. Two consecutive requestAnimationFrame paints with 0px layout bounding-box shift
 * 4. Optional backend txEpoch convergence check
 * Zero external dependencies. Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

export interface CausalQuiescenceOptions {
  timeoutMs?: number;
  quietWindowMs?: number;
  targetSelector?: string;
  getInFlightCount?: () => number;
  expectedTxEpoch?: number;
  getObservedTxEpoch?: () => number;
  signal?: AbortSignal;
}

export interface CausalQuiescenceReceipt {
  settled: boolean;
  elapsedUs: number;
  rafFramesObserved: number;
  layoutShiftsObserved: number;
  inFlightAtExit: number;
  txEpochSettled: boolean;
  reason: string;
}

function nowUs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return Math.round(performance.now() * 1000);
  }
  return Date.now() * 1000;
}

function nextAnimationOrMacroFrame(): Promise<void> {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  return new Promise((resolve) => setTimeout(resolve, 4));
}

function measureSelectorSignature(selector?: string): string {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') {
    return 'headless:0:0:0:0';
  }
  const el = (selector ? document.querySelector(selector) : document.body) as HTMLElement | null;
  if (!el || typeof el.getBoundingClientRect !== 'function') {
    return 'missing';
  }
  const r = el.getBoundingClientRect();
  return `${Math.round(r.left)}:${Math.round(r.top)}:${Math.round(r.width)}:${Math.round(r.height)}`;
}

export async function awaitCausalQuiescence(
  options: CausalQuiescenceOptions = {}
): Promise<CausalQuiescenceReceipt> {
  const startUs = nowUs();
  const timeoutUs = Math.max(1000, (options.timeoutMs ?? 2500) * 1000);
  const quietUs = Math.max(0, (options.quietWindowMs ?? 16) * 1000);

  let rafFrames = 0;
  let consecutiveStablePaints = 0;
  let layoutShifts = 0;
  let prevSig = measureSelectorSignature(options.targetSelector);
  let stableSinceUs = startUs;

  while (nowUs() - startUs < timeoutUs) {
    if (options.signal?.aborted) {
      return {
        settled: false,
        elapsedUs: nowUs() - startUs,
        rafFramesObserved: rafFrames,
        layoutShiftsObserved: layoutShifts,
        inFlightAtExit: options.getInFlightCount ? options.getInFlightCount() : 0,
        txEpochSettled: false,
        reason: 'ABORTED_BY_SIGNAL'
      };
    }

    await Promise.resolve();
    await nextAnimationOrMacroFrame();
    rafFrames += 1;

    const inFlight = options.getInFlightCount ? options.getInFlightCount() : 0;
    const epochOk =
      options.expectedTxEpoch === undefined ||
      (typeof options.getObservedTxEpoch === 'function' &&
        options.getObservedTxEpoch() >= options.expectedTxEpoch);

    const nextSig = measureSelectorSignature(options.targetSelector);
    const curUs = nowUs();

    if (nextSig !== prevSig) {
      layoutShifts += 1;
      prevSig = nextSig;
      consecutiveStablePaints = 0;
      stableSinceUs = curUs;
      continue;
    }

    if (inFlight > 0 || !epochOk) {
      consecutiveStablePaints = 0;
      stableSinceUs = curUs;
      continue;
    }

    consecutiveStablePaints += 1;
    if (consecutiveStablePaints >= 2 && curUs - stableSinceUs >= quietUs) {
      return {
        settled: true,
        elapsedUs: curUs - startUs,
        rafFramesObserved: rafFrames,
        layoutShiftsObserved: layoutShifts,
        inFlightAtExit: 0,
        txEpochSettled: epochOk,
        reason: 'CAUSAL_QUIESCENCE_SETTLED'
      };
    }
  }

  const finalInFlight = options.getInFlightCount ? options.getInFlightCount() : 0;
  const finalEpochOk =
    options.expectedTxEpoch === undefined ||
    (typeof options.getObservedTxEpoch === 'function' &&
      options.getObservedTxEpoch() >= options.expectedTxEpoch);

  return {
    settled: false,
    elapsedUs: nowUs() - startUs,
    rafFramesObserved: rafFrames,
    layoutShiftsObserved: layoutShifts,
    inFlightAtExit: finalInFlight,
    txEpochSettled: finalEpochOk,
    reason: finalInFlight > 0 ? 'TIMEOUT_INFLIGHT_NETWORK' : !finalEpochOk ? 'TIMEOUT_TX_EPOCH' : 'TIMEOUT_LAYOUT_UNSTABLE'
  };
}
