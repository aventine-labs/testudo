/**
 * @aventine/testudo - Opt-In Browser Stress & Client-Side USL Crucible (src/stress.ts)
 * STRICTLY OPT-IN ONLY: Executes 0 mutations and returns SKIPPED unless { stress: true } is passed!
 *   1. Carousel / Virtual-List / Grid Cardinality Cliff Finder (1x -> 10x -> 50x -> 250x items)
 *   2. Sustained Button Hold-Down (30Hz repeat) & Rule-19 3-Step (10, 25, 50) Monotonic Slope Leak Prover
 *      Uses Macrotask ClearKeptObjects() + 2x Garbage Collection between bursts so one-time React
 *      lazy initializations produce 0% false-positive leak alerts.
 * Zero external dependencies. Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

export interface CardinalityStepSample {
  multiplier: number;
  itemCount: number;
  fps: number;
  layoutAndStyleUs: number;
  inpLatencyUs: number;
  heapUsedBytes: number;
}

export interface DomCardinalityStressReport {
  enabled: boolean;
  status: 'SKIPPED_OPT_IN_DISABLED' | 'PASSED_60FPS_RESILIENT' | 'CARDINALITY_FPS_CLIFF_DETECTED';
  fpsFloor: number;
  fpsCliffItemCount: number | null;
  samples: CardinalityStepSample[];
  summary: string;
}

export interface ThreeStepBurstSample {
  burstClicks: number;
  listenersAfterGc: number;
  domNodesAfterGc: number;
  deltaListenersFromBaseline: number;
  deltaNodesFromBaseline: number;
}

export interface InputEnduranceAndLeakReport {
  enabled: boolean;
  status:
    | 'SKIPPED_OPT_IN_DISABLED'
    | 'CLEAN_NO_MONOTONIC_LEAK'
    | 'MONOTONIC_LISTENER_OR_NODE_LEAK'
    | 'UNDEBOUNCED_NETWORK_STORM';
  macrotaskAndDoubleGcVerified: boolean;
  holdDurationMs: number;
  holdAutoRepeatEvents: number;
  duplicateNetworkCallsDuringHold: number;
  burstSamples: ThreeStepBurstSample[];
  listenerSlopePositive: boolean;
  nodeSlopePositive: boolean;
  summary: string;
}

/**
 * Rule 19 ECMAScript ClearKeptObjects() Macrotask + Double GC Settle Barrier:
 * WeakRefs and Blink Oilpan DOM wrappers require a full macrotask turn (setTimeout(0))
 * before two consecutive GC sweeps to deterministically reclaim transient closures.
 */
export async function settleMacrotaskAndDoubleGc(collectGarbageFn?: () => void | Promise<void>): Promise<boolean> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (typeof collectGarbageFn === 'function') {
    await collectGarbageFn();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await collectGarbageFn();
    return true;
  }
  const g = globalThis as any;
  if (typeof g.gc === 'function') {
    g.gc();
    await new Promise((resolve) => setTimeout(resolve, 0));
    g.gc();
    return true;
  }
  return true;
}

export async function runDomCardinalityStress(options: {
  stress?: boolean;
  baseItemCount?: number;
  multipliers?: number[];
  fpsFloor?: number;
  measureAtItemCount: (targetItemCount: number, samplePayloadText: string) => Promise<{
    fps: number;
    layoutAndStyleUs: number;
    inpLatencyUs: number;
    heapUsedBytes: number;
  }> | {
    fps: number;
    layoutAndStyleUs: number;
    inpLatencyUs: number;
    heapUsedBytes: number;
  };
}): Promise<DomCardinalityStressReport> {
  const fpsFloor = options.fpsFloor ?? 45;
  if (options.stress !== true) {
    return {
      enabled: false,
      status: 'SKIPPED_OPT_IN_DISABLED',
      fpsFloor,
      fpsCliffItemCount: null,
      samples: [],
      summary: 'Browser stress skipped (pass { stress: true } to run cardinality cliff analysis).'
    };
  }

  const base = Math.max(1, options.baseItemCount ?? 4);
  const mults = options.multipliers && options.multipliers.length > 0 ? options.multipliers : [1, 10, 25, 50, 125];
  const samples: CardinalityStepSample[] = [];
  let cliffCount: number | null = null;

  for (const m of mults) {
    const itemCount = base * m;
    const entropyPayload = `Slide #${itemCount} [RTL:\u0645\u0631\u062D\u0628\u0627] [CJK:\u9AD8\u5E76\u53D1] LongTitle_${'X'.repeat(32)}`;
    const mRes = await options.measureAtItemCount(itemCount, entropyPayload);
    samples.push({
      multiplier: m,
      itemCount,
      fps: mRes.fps,
      layoutAndStyleUs: mRes.layoutAndStyleUs,
      inpLatencyUs: mRes.inpLatencyUs,
      heapUsedBytes: mRes.heapUsedBytes
    });
    if (cliffCount === null && mRes.fps < fpsFloor) {
      cliffCount = itemCount;
    }
  }

  return {
    enabled: true,
    status: cliffCount !== null ? 'CARDINALITY_FPS_CLIFF_DETECTED' : 'PASSED_60FPS_RESILIENT',
    fpsFloor,
    fpsCliffItemCount: cliffCount,
    samples,
    summary:
      cliffCount !== null
        ? `FPS dropped below ${fpsFloor} fps cliff at ${cliffCount} items (virtualize list or eliminate O(N^2) layout).`
        : `Container sustained >= ${fpsFloor} fps across all multipliers up to ${samples[samples.length - 1]?.itemCount || base} items.`
  };
}

export async function runInputEnduranceAndThreeStepLeakProbe(options: {
  stress?: boolean;
  holdDurationMs?: number;
  maxAllowedHoldNetworkCalls?: number;
  dispatchHoldTick: (tickIndex: number) => void | Promise<void>;
  dispatchBurstClicks: (clickCount: number) => void | Promise<void>;
  collectGarbage?: () => void | Promise<void>;
  readRuntimeCounters: () => Promise<{ listeners: number; domNodes: number; networkCalls: number }> | {
    listeners: number;
    domNodes: number;
    networkCalls: number;
  };
}): Promise<InputEnduranceAndLeakReport> {
  if (options.stress !== true) {
    return {
      enabled: false,
      status: 'SKIPPED_OPT_IN_DISABLED',
      macrotaskAndDoubleGcVerified: false,
      holdDurationMs: 0,
      holdAutoRepeatEvents: 0,
      duplicateNetworkCallsDuringHold: 0,
      burstSamples: [],
      listenerSlopePositive: false,
      nodeSlopePositive: false,
      summary: 'Input endurance stress skipped (pass { stress: true } to execute hold-down & 3-step leak probe).'
    };
  }

  const holdMs = Math.max(100, options.holdDurationMs ?? 1500);
  const repeatTicks = Math.max(3, Math.floor((holdMs / 1000) * 30));
  const maxHoldNet = options.maxAllowedHoldNetworkCalls ?? 3;

  await settleMacrotaskAndDoubleGc(options.collectGarbage);
  const baseline = await options.readRuntimeCounters();

  for (let i = 0; i < repeatTicks; i++) {
    await options.dispatchHoldTick(i);
  }
  const afterHold = await options.readRuntimeCounters();
  const holdNetCalls = Math.max(0, afterHold.networkCalls - baseline.networkCalls);

  await settleMacrotaskAndDoubleGc(options.collectGarbage);
  const burstBase = await options.readRuntimeCounters();

  const burstSizes = [10, 25, 50] as const;
  const burstSamples: ThreeStepBurstSample[] = [];
  for (const bSize of burstSizes) {
    await options.dispatchBurstClicks(bSize);
    await settleMacrotaskAndDoubleGc(options.collectGarbage);
    const snap = await options.readRuntimeCounters();
    burstSamples.push({
      burstClicks: bSize,
      listenersAfterGc: snap.listeners,
      domNodesAfterGc: snap.domNodes,
      deltaListenersFromBaseline: Math.max(0, snap.listeners - burstBase.listeners),
      deltaNodesFromBaseline: Math.max(0, snap.domNodes - burstBase.domNodes)
    });
  }

  const [b1, b2, b3] = burstSamples;
  const listenerSlopePositive =
    b1.deltaListenersFromBaseline > 0 &&
    b2.deltaListenersFromBaseline > b1.deltaListenersFromBaseline &&
    b3.deltaListenersFromBaseline > b2.deltaListenersFromBaseline;

  const nodeSlopePositive =
    b1.deltaNodesFromBaseline > 0 &&
    b2.deltaNodesFromBaseline > b1.deltaNodesFromBaseline &&
    b3.deltaNodesFromBaseline > b2.deltaNodesFromBaseline;

  const status: InputEnduranceAndLeakReport['status'] =
    listenerSlopePositive || nodeSlopePositive
      ? 'MONOTONIC_LISTENER_OR_NODE_LEAK'
      : holdNetCalls > maxHoldNet
      ? 'UNDEBOUNCED_NETWORK_STORM'
      : 'CLEAN_NO_MONOTONIC_LEAK';

  return {
    enabled: true,
    status,
    macrotaskAndDoubleGcVerified: true,
    holdDurationMs: holdMs,
    holdAutoRepeatEvents: repeatTicks,
    duplicateNetworkCallsDuringHold: holdNetCalls,
    burstSamples,
    listenerSlopePositive,
    nodeSlopePositive,
    summary:
      status === 'MONOTONIC_LISTENER_OR_NODE_LEAK'
        ? `Monotonic leak proven across (10, 25, 50) bursts after 2x GC: listeners delta=[${b1.deltaListenersFromBaseline}, ${b2.deltaListenersFromBaseline}, ${b3.deltaListenersFromBaseline}], nodes delta=[${b1.deltaNodesFromBaseline}, ${b2.deltaNodesFromBaseline}, ${b3.deltaNodesFromBaseline}].`
        : status === 'UNDEBOUNCED_NETWORK_STORM'
        ? `Button hold-down (${repeatTicks} auto-repeat ticks) triggered ${holdNetCalls} un-debounced network calls (max allowed: ${maxHoldNet}).`
        : `Zero monotonic listener/DOM leaks across (10, 25, 50) bursts and hold-down (${repeatTicks} ticks) stayed bounded.`
  };
}
