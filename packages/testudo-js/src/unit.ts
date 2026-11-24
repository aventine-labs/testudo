/**
 * @aventine/testudo v1.1.0 - Unified Unit, Property Fuzzing, Cooperative Virtual Clock
 * & Warm Real-DOM Component Micro-Slot Engine (SPEC-TESTUDO-POLYGLOT-UNIT-27 / AL-DEV-411)
 *
 * Scraps jsdom/happy-dom lies, jest.mock() hoisting hazards, .snap dumpsters, and
 * useFakeTimers() + Promise deadlocks. Zero external dependencies.
 * Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

import { format } from './format.js';

function nowMicros(): number {
  if (typeof process !== 'undefined' && typeof process.hrtime?.bigint === 'function') {
    return Number(process.hrtime.bigint() / 1000n);
  }
  return Math.round(performance.now() * 1000);
}

export interface TwepTestEvent {
  twep: 1;
  lang: string;
  tier: 'unit' | 'component' | 'property' | 'e2e';
  suite: string;
  name: string;
  ok: boolean;
  durationUs: number;
  assertions: number;
  cassetteVerified?: boolean;
  shrunkCounterexample?: unknown;
  error?: string;
}

export interface SpyFn<TArgs extends unknown[] = unknown[], TRet = unknown> {
  (...args: TArgs): TRet;
  calls: TArgs[];
  results: Array<{ ok: boolean; value: unknown }>;
  mockReturnValue(val: TRet): SpyFn<TArgs, TRet>;
  mockResolvedValue(val: Awaited<TRet>): SpyFn<TArgs, TRet>;
  mockImplementation(fn: (...args: TArgs) => TRet): SpyFn<TArgs, TRet>;
  mockClear(): void;
  restore(): void;
}

interface ActivePatch {
  restore: () => void;
}

const activePatches: ActivePatch[] = [];
let assertionCounter = 0;

export function createSpy<TArgs extends unknown[] = unknown[], TRet = unknown>(
  initialImpl?: (...args: TArgs) => TRet
): SpyFn<TArgs, TRet> {
  let impl = initialImpl;
  const calls: TArgs[] = [];
  const results: Array<{ ok: boolean; value: unknown }> = [];

  const fn = ((...args: TArgs): TRet => {
    calls.push(args);
    try {
      const val = impl ? impl(...args) : (undefined as TRet);
      results.push({ ok: true, value: val });
      return val;
    } catch (err) {
      results.push({ ok: false, value: err });
      throw err;
    }
  }) as SpyFn<TArgs, TRet>;

  fn.calls = calls;
  fn.results = results;
  fn.mockReturnValue = (val: TRet) => {
    impl = () => val;
    return fn;
  };
  fn.mockResolvedValue = (val: Awaited<TRet>) => {
    impl = () => Promise.resolve(val) as unknown as TRet;
    return fn;
  };
  fn.mockImplementation = (next: (...args: TArgs) => TRet) => {
    impl = next;
    return fn;
  };
  fn.mockClear = () => {
    calls.length = 0;
    results.length = 0;
  };
  fn.restore = () => {
    fn.mockClear();
  };
  return fn;
}

/**
 * Explicit, non-hoisted, auto-restoring method mock (replaces fragile jest.mock hoisting).
 */
export function mockMethod<TObj extends object, TKey extends keyof TObj>(
  target: TObj,
  key: TKey,
  replacement?: TObj[TKey]
): SpyFn {
  const original = target[key];
  const spy = createSpy(
    typeof replacement === 'function'
      ? (replacement as (...args: unknown[]) => unknown)
      : typeof original === 'function'
        ? (original as (...args: unknown[]) => unknown).bind(target)
        : undefined
  );
  let restored = false;
  const restore = () => {
    if (!restored) {
      restored = true;
      target[key] = original;
    }
  };
  spy.restore = restore;
  (target as Record<PropertyKey, unknown>)[key] = spy;
  activePatches.push({ restore });
  return spy;
}

export function restoreAllMocks(): void {
  while (activePatches.length > 0) {
    const p = activePatches.pop();
    if (p) p.restore();
  }
}

/**
 * Drop-in compatibility shim for Jest (`jest.fn`, `jest.spyOn`) and Vitest (`vi.fn`, `vi.spyOn`).
 */
export const compatVi = {
  fn: createSpy,
  spyOn: mockMethod,
  restoreAllMocks
};

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, k)) return false;
    if (!deepEqual(objA[k], objB[k])) return false;
  }
  return true;
}

export interface TestudoExpectation<T = unknown> {
  toBe(expected: T): void;
  toEqual(expected: unknown): void;
  toStrictEqual(expected: unknown): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toContain(item: unknown): void;
  toBeGreaterThan(n: number): void;
  toBeLessThan(n: number): void;
  toBeCloseTo(n: number, precisionDigits?: number): void;
  toThrow(expectedSubstr?: string | RegExp): void;
  toEqualCurrency(expectedAmount: number | string, toleranceMajorUnits?: number): void;
  toHaveBeenCalledTimes(count: number): void;
  not: TestudoExpectation<T>;
  resolves: {
    toBe(expected: Awaited<T>): Promise<void>;
    toEqual(expected: unknown): Promise<void>;
  };
  rejects: {
    toThrow(expectedSubstr?: string | RegExp): Promise<void>;
  };
}

export function expectUnit<T>(actual: T): TestudoExpectation<T> {
  const build = (negated: boolean): TestudoExpectation<T> => {
    const check = (cond: boolean, msg: string) => {
      assertionCounter++;
      const ok = negated ? !cond : cond;
      if (!ok) {
        throw new Error(negated ? `Assertion failed (negated): ${msg}` : `Assertion failed: ${msg}`);
      }
    };

    return {
      toBe(expected: T) {
        check(Object.is(actual, expected), `Expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`);
      },
      toEqual(expected: unknown) {
        check(deepEqual(actual, expected), `Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
      },
      toStrictEqual(expected: unknown) {
        check(deepEqual(actual, expected), `Expected ${JSON.stringify(actual)} to strictly equal ${JSON.stringify(expected)}`);
      },
      toBeTruthy() {
        check(Boolean(actual), `Expected ${JSON.stringify(actual)} to be truthy`);
      },
      toBeFalsy() {
        check(!actual, `Expected ${JSON.stringify(actual)} to be falsy`);
      },
      toContain(item: unknown) {
        const has =
          typeof actual === 'string'
            ? actual.includes(String(item))
            : Array.isArray(actual)
              ? actual.some((x) => deepEqual(x, item))
              : false;
        check(has, `Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(item)}`);
      },
      toBeGreaterThan(n: number) {
        check(Number(actual) > n, `Expected ${String(actual)} > ${n}`);
      },
      toBeLessThan(n: number) {
        check(Number(actual) < n, `Expected ${String(actual)} < ${n}`);
      },
      toBeCloseTo(n: number, precisionDigits = 2) {
        const tol = Math.pow(10, -precisionDigits) / 2;
        check(Math.abs(Number(actual) - n) < tol, `Expected ${String(actual)} to be close to ${n}`);
      },
      toThrow(expectedSubstr?: string | RegExp) {
        if (typeof actual !== 'function') {
          throw new Error('toThrow requires a function receiver');
        }
        let threw = false;
        let errText = '';
        try {
          (actual as () => unknown)();
        } catch (err) {
          threw = true;
          errText = err instanceof Error ? err.message : String(err);
        }
        let matches = threw;
        if (threw && expectedSubstr !== undefined) {
          matches =
            typeof expectedSubstr === 'string'
              ? errText.includes(expectedSubstr)
              : expectedSubstr.test(errText);
        }
        check(matches, `Expected function to throw ${expectedSubstr ?? 'an error'}, got: ${threw ? errText : 'no throw'}`);
      },
      toEqualCurrency(expectedAmount: number | string, toleranceMajorUnits = 0.005) {
        const parsedActual =
          typeof actual === 'number' ? actual : format.parseMonetary(String(actual));
        const parsedExpected =
          typeof expectedAmount === 'number' ? expectedAmount : format.parseMonetary(expectedAmount);
        const diff = Math.abs(parsedActual - parsedExpected);
        check(
          diff <= toleranceMajorUnits,
          `Currency mismatch: actual ${parsedActual} vs expected ${parsedExpected} (diff=${diff})`
        );
      },
      toHaveBeenCalledTimes(count: number) {
        const spy = actual as unknown as SpyFn;
        const c = Array.isArray(spy?.calls) ? spy.calls.length : -1;
        check(c === count, `Expected spy call count ${count}, got ${c}`);
      },
      get not() {
        return build(!negated);
      },
      resolves: {
        async toBe(expected: Awaited<T>) {
          const val = await (actual as unknown as Promise<Awaited<T>>);
          assertionCounter++;
          const ok = negated ? !Object.is(val, expected) : Object.is(val, expected);
          if (!ok) {
            throw new Error(`Async resolves.toBe failed: got ${JSON.stringify(val)}, expected ${JSON.stringify(expected)}`);
          }
        },
        async toEqual(expected: unknown) {
          const val = await (actual as unknown as Promise<unknown>);
          assertionCounter++;
          const ok = negated ? !deepEqual(val, expected) : deepEqual(val, expected);
          if (!ok) {
            throw new Error(`Async resolves.toEqual failed: got ${JSON.stringify(val)}, expected ${JSON.stringify(expected)}`);
          }
        }
      },
      rejects: {
        async toThrow(expectedSubstr?: string | RegExp) {
          let threw = false;
          let errText = '';
          try {
            await (actual as unknown as Promise<unknown>);
          } catch (err) {
            threw = true;
            errText = err instanceof Error ? err.message : String(err);
          }
          assertionCounter++;
          let matches = threw;
          if (threw && expectedSubstr !== undefined) {
            matches =
              typeof expectedSubstr === 'string'
                ? errText.includes(expectedSubstr)
                : expectedSubstr.test(errText);
          }
          if (negated ? matches : !matches) {
            throw new Error(`Async rejects.toThrow failed: got ${threw ? errText : 'resolved without error'}`);
          }
        }
      }
    };
  };
  return build(false);
}

// ------------------------------------------------------------------------------
// Cooperative Virtual Clock (Zero Promise + FakeTimer Deadlocks, Z3 -9864 Guard)
// ------------------------------------------------------------------------------

interface ScheduledVirtualTimer {
  id: number;
  dueUs: number;
  intervalUs: number | null;
  cb: () => void;
  cancelled: boolean;
}

export class TestudoClock {
  private nowUs: number;
  private nextId = 1;
  private readonly maxStepHorizonUs: number;
  private readonly queue: ScheduledVirtualTimer[] = [];

  constructor(initialEpochMs = 1_700_000_000_000, maxStepHorizonMs = 86_400_000) {
    this.nowUs = Math.trunc(initialEpochMs * 1000);
    this.maxStepHorizonUs = Math.trunc(maxStepHorizonMs * 1000);
  }

  public currentMs(): number {
    return Math.floor(this.nowUs / 1000);
  }

  public currentUs(): number {
    return this.nowUs;
  }

  public scheduleTimeout(cb: () => void, delayMs: number): number {
    const dUs = Math.max(0, Math.trunc(delayMs * 1000));
    const id = this.nextId++;
    this.queue.push({ id, dueUs: this.nowUs + dUs, intervalUs: null, cb, cancelled: false });
    return id;
  }

  public scheduleInterval(cb: () => void, intervalMs: number): number {
    const iUs = Math.max(1000, Math.trunc(intervalMs * 1000));
    const id = this.nextId++;
    this.queue.push({ id, dueUs: this.nowUs + iUs, intervalUs: iUs, cb, cancelled: false });
    return id;
  }

  public cancel(id: number): void {
    for (const item of this.queue) {
      if (item.id === id) item.cancelled = true;
    }
  }

  private async drainMicrotasks(turns = 8): Promise<void> {
    for (let i = 0; i < turns; i++) {
      await Promise.resolve();
    }
  }

  public async advanceByMs(deltaMs: number): Promise<number> {
    if (deltaMs < 0) {
      throw new Error('CLOCK_NEGATIVE_ADVANCE_BLOCKED (-9864)');
    }
    const deltaUs = Math.trunc(deltaMs * 1000);
    if (deltaUs > this.maxStepHorizonUs) {
      throw new Error('CLOCK_HORIZON_EXCEEDED (-9864)');
    }
    const targetUs = this.nowUs + deltaUs;
    await this.drainMicrotasks();

    let safetySteps = 0;
    while (safetySteps++ < 100_000) {
      let earliest: ScheduledVirtualTimer | null = null;
      for (const item of this.queue) {
        if (item.cancelled || item.dueUs > targetUs) continue;
        if (!earliest || item.dueUs < earliest.dueUs || (item.dueUs === earliest.dueUs && item.id < earliest.id)) {
          earliest = item;
        }
      }
      if (!earliest) break;

      this.nowUs = earliest.dueUs;
      if (earliest.intervalUs !== null) {
        earliest.dueUs = this.nowUs + earliest.intervalUs;
      } else {
        earliest.cancelled = true;
      }
      earliest.cb();
      await this.drainMicrotasks();
    }

    this.nowUs = targetUs;
    await this.drainMicrotasks();
    return this.currentMs();
  }
}

export async function withVirtualClock<T>(
  fn: (clock: TestudoClock) => Promise<T> | T,
  initialEpochMs = 1_700_000_000_000
): Promise<T> {
  const clock = new TestudoClock(initialEpochMs);
  const origSetTimeout = globalThis.setTimeout;
  const origClearTimeout = globalThis.clearTimeout;
  const origSetInterval = globalThis.setInterval;
  const origClearInterval = globalThis.clearInterval;
  const origDateNow = Date.now;

  globalThis.setTimeout = ((cb: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    clock.scheduleTimeout(() => cb(...args), ms ?? 0)) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id?: unknown) => clock.cancel(Number(id))) as typeof clearTimeout;
  globalThis.setInterval = ((cb: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    clock.scheduleInterval(() => cb(...args), ms ?? 1)) as unknown as typeof setInterval;
  globalThis.clearInterval = ((id?: unknown) => clock.cancel(Number(id))) as typeof clearInterval;
  Date.now = () => clock.currentMs();

  try {
    return await fn(clock);
  } finally {
    globalThis.setTimeout = origSetTimeout;
    globalThis.clearTimeout = origClearTimeout;
    globalThis.setInterval = origSetInterval;
    globalThis.clearInterval = origClearInterval;
    Date.now = origDateNow;
  }
}

// ------------------------------------------------------------------------------
// Built-In Zero-Dependency Property & Financial Boundary Fuzzer + Shrinking
// ------------------------------------------------------------------------------

export class XorShift64 {
  private state: bigint;

  constructor(seed = 0x9e3779b97f4a7c15n) {
    this.state = seed === 0n ? 0x9e3779b97f4a7c15n : BigInt.asUintN(64, seed);
  }

  public nextU64(): bigint {
    let x = this.state;
    x ^= BigInt.asUintN(64, x << 13n);
    x ^= x >> 7n;
    x ^= BigInt.asUintN(64, x << 17n);
    this.state = BigInt.asUintN(64, x);
    return this.state;
  }

  public nextInt(min: number, max: number): number {
    const span = BigInt(Math.max(1, max - min + 1));
    return min + Number(this.nextU64() % span);
  }
}

export interface PropertyGenerator<T> {
  edgeCases: T[];
  sample(rng: XorShift64): T;
  shrink(val: T): T[];
}

export const Gen = {
  int(min = -1_000_000, max = 1_000_000): PropertyGenerator<number> {
    const rawEdges = [0, 1, -1, 2, -2, min, max, 100, -100].filter((x) => x >= min && x <= max);
    return {
      edgeCases: Array.from(new Set(rawEdges)),
      sample: (rng) => rng.nextInt(min, max),
      shrink(v: number) {
        if (v === 0) return [];
        const candidates: number[] = [];
        const pushIfValid = (x: number) => {
          if (x !== v && x >= min && x <= max && (Math.abs(x) < Math.abs(v) || (x === 0 && v !== 0))) {
            candidates.push(x);
          }
        };
        pushIfValid(0);
        pushIfValid(Math.trunc(v / 2));
        pushIfValid(Math.trunc((v * 3) / 4));
        pushIfValid(Math.trunc((v * 7) / 8));
        pushIfValid(v > 0 ? v - 1 : v + 1);
        return Array.from(new Set(candidates));
      }
    };
  },

  currencyCents(maxAbsCents = 10_000_000): PropertyGenerator<number> {
    return Gen.int(-maxAbsCents, maxAbsCents);
  },

  asciiString(maxLen = 24): PropertyGenerator<string> {
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-./:$ ';
    return {
      edgeCases: ['', '0', ' ', '$0.00', '($12.34)', 'null', 'undefined'],
      sample(rng) {
        const len = rng.nextInt(0, maxLen);
        let out = '';
        for (let i = 0; i < len; i++) {
          out += alphabet[rng.nextInt(0, alphabet.length - 1)];
        }
        return out;
      },
      shrink(s: string) {
        if (s.length === 0) return [];
        const out = [''];
        if (s.length > 1) {
          out.push(s.slice(0, Math.floor(s.length / 2)));
          out.push(s.slice(0, s.length - 1));
        }
        return out;
      }
    };
  }
};

export interface PropertyRunResult<T> {
  ok: boolean;
  runsExecuted: number;
  seedHex: string;
  failingInput?: T;
  shrunkMinimalInput?: T;
  shrinkSteps: number;
  error?: string;
}

export async function verifyProperty<T>(
  gen: PropertyGenerator<T>,
  predicate: (val: T) => boolean | void | Promise<boolean | void>,
  options: { runs?: number; seed?: bigint } = {}
): Promise<PropertyRunResult<T>> {
  const runs = options.runs ?? 64;
  const seed = options.seed ?? 0x517cc1b727220a95n;
  const rng = new XorShift64(seed);
  const seedHex = '0x' + seed.toString(16);

  const testSingle = async (val: T): Promise<{ ok: boolean; err?: string }> => {
    try {
      const res = await predicate(val);
      if (res === false) return { ok: false, err: 'Predicate returned false' };
      return { ok: true };
    } catch (e) {
      return { ok: false, err: e instanceof Error ? e.message : String(e) };
    }
  };

  const inputs: T[] = [...gen.edgeCases];
  while (inputs.length < runs) {
    inputs.push(gen.sample(rng));
  }

  for (let i = 0; i < inputs.length; i++) {
    const candidate = inputs[i];
    const check = await testSingle(candidate);
    if (!check.ok) {
      let minimal = candidate;
      let shrinkSteps = 0;
      let lastErr = check.err;
      let improved = true;
      while (improved && shrinkSteps < 128) {
        improved = false;
        for (const smaller of gen.shrink(minimal)) {
          const sub = await testSingle(smaller);
          if (!sub.ok) {
            minimal = smaller;
            lastErr = sub.err;
            shrinkSteps++;
            improved = true;
            break;
          }
        }
      }
      return {
        ok: false,
        runsExecuted: i + 1,
        seedHex,
        failingInput: candidate,
        shrunkMinimalInput: minimal,
        shrinkSteps,
        error: lastErr
      };
    }
  }

  assertionCounter += inputs.length;
  return {
    ok: true,
    runsExecuted: inputs.length,
    seedHex,
    shrinkSteps: 0
  };
}

// ------------------------------------------------------------------------------
// Warm Real-DOM Component Micro-Slot (Replaces Fake JSDOM / Happy-DOM)
// ------------------------------------------------------------------------------

export interface RealDomComponentInspection {
  gateCode: number;
  slotResetLatencyUs: number;
  isolatedWorldActive: boolean;
  interactiveCount: number;
  clippedInteractiveElements: string[];
  contrastFailures: string[];
  boundingBoxes: Record<string, { x: number; y: number; width: number; height: number }>;
}

export interface CdpComponentSlotSession {
  evaluate<T = unknown>(expression: string): Promise<T>;
  evaluateInTestudoEnclave?<T = unknown>(expression: string): Promise<T>;
  send?<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
}

export async function mountComponentInWarmSlot(
  session: CdpComponentSlotSession,
  htmlMarkup: string,
  cssStyles = ''
): Promise<RealDomComponentInspection> {
  const t0 = nowMicros();
  const payloadJson = JSON.stringify({ html: htmlMarkup, css: cssStyles });

  // Inject markup into clean #testudo-component-slot without restarting Chromium
  await session.evaluate(`(() => {
    const spec = ${payloadJson};
    let styleEl = document.getElementById('testudo-slot-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'testudo-slot-style';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = spec.css || '';
    let root = document.getElementById('testudo-component-slot');
    if (!root) {
      root = document.createElement('div');
      root.id = 'testudo-component-slot';
      document.body.innerHTML = '';
      document.body.appendChild(root);
    }
    root.innerHTML = spec.html;
    return true;
  })()`);

  const inspectorExpr = `(() => {
    const root = document.getElementById('testudo-component-slot') || document.body;
    const nodes = root.querySelectorAll('button, a, input, select, textarea, [role="button"], [data-testid]');
    const clipped = [];
    const contrastFailures = [];
    const boxes = {};

    function parseRgb(str) {
      const m = String(str || '').match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
      if (!m) return null;
      return [Number(m[1]), Number(m[2]), Number(m[3])];
    }
    function lum(rgb) {
      const ch = rgb.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    }

    nodes.forEach((el, idx) => {
      const id = el.getAttribute('data-testid') || el.id || (el.tagName.toLowerCase() + '_' + idx);
      const r = el.getBoundingClientRect();
      boxes[id] = { x: r.x, y: r.y, width: r.width, height: r.height };

      let p = el.parentElement;
      while (p && p !== document.body) {
        const cs = window.getComputedStyle(p);
        if (cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.overflowY === 'hidden') {
          const pr = p.getBoundingClientRect();
          if (r.right > pr.right + 1 || r.bottom > pr.bottom + 1 || r.left < pr.left - 1 || r.top < pr.top - 1) {
            clipped.push(id);
            break;
          }
        }
        p = p.parentElement;
      }

      const st = window.getComputedStyle(el);
      const fg = parseRgb(st.color);
      const bg = parseRgb(st.backgroundColor);
      if (fg && bg && (st.backgroundColor !== 'rgba(0, 0, 0, 0)')) {
        const l1 = lum(fg);
        const l2 = lum(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        if (ratio < 4.5 && (el.textContent || '').trim().length > 0) {
          contrastFailures.push(id + ':' + ratio.toFixed(2));
        }
      }
    });

    return {
      interactiveCount: nodes.length,
      clippedInteractiveElements: clipped,
      contrastFailures,
      boundingBoxes: boxes
    };
  })()`;

  type RawInspection = {
    interactiveCount: number;
    clippedInteractiveElements: string[];
    contrastFailures: string[];
    boundingBoxes: Record<string, { x: number; y: number; width: number; height: number }>;
  };

  let isolatedWorldActive = false;
  let raw: RawInspection | null = null;

  const enclaveEval = session.evaluateInTestudoEnclave;
  if (typeof enclaveEval === 'function') {
    isolatedWorldActive = true;
    raw = (await enclaveEval.call(session, inspectorExpr)) as RawInspection;
  } else if (typeof session.send === 'function') {
    await session.send('Page.enable', {});
    const tree = await session.send<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree', {});
    const world = await session.send<{ executionContextId: number }>('Page.createIsolatedWorld', {
      frameId: tree.frameTree.frame.id,
      worldName: 'TestudoEnclave',
      grantUniveralAccess: true
    });
    const evalRes = await session.send<{ result: { value: RawInspection } }>('Runtime.evaluate', {
      expression: inspectorExpr,
      contextId: world.executionContextId,
      returnByValue: true
    });
    isolatedWorldActive = true;
    raw = evalRes.result.value;
  } else {
    raw = await session.evaluate<RawInspection>(inspectorExpr);
  }

  const elapsedUs = Math.max(1, nowMicros() - t0);
  let gateCode = 1;
  if (!isolatedWorldActive) gateCode = -9867;
  else if (raw.clippedInteractiveElements.length > 0) gateCode = -9868;
  else if (raw.contrastFailures.length > 0) gateCode = -9869;

  return {
    gateCode,
    slotResetLatencyUs: elapsedUs,
    isolatedWorldActive,
    interactiveCount: raw.interactiveCount,
    clippedInteractiveElements: raw.clippedInteractiveElements,
    contrastFailures: raw.contrastFailures,
    boundingBoxes: raw.boundingBoxes
  };
}

// ------------------------------------------------------------------------------
// Lightweight Zero-Config Unit Runner Emitting TWEP v1 Records
// ------------------------------------------------------------------------------

export class TestudoUnitRunner {
  private readonly suiteName: string;
  private readonly beforeHooks: Array<() => void | Promise<void>> = [];
  private readonly afterHooks: Array<() => void | Promise<void>> = [];
  private readonly cases: Array<{
    name: string;
    tier: 'unit' | 'component' | 'property';
    fn: () => void | Promise<void>;
  }> = [];

  constructor(suiteName: string) {
    this.suiteName = suiteName;
  }

  public beforeEach(fn: () => void | Promise<void>): void {
    this.beforeHooks.push(fn);
  }

  public afterEach(fn: () => void | Promise<void>): void {
    this.afterHooks.push(fn);
  }

  public test(name: string, fn: () => void | Promise<void>, tier: 'unit' | 'component' | 'property' = 'unit'): void {
    this.cases.push({ name, tier, fn });
  }

  public async run(): Promise<{ passed: number; failed: number; events: TwepTestEvent[] }> {
    const events: TwepTestEvent[] = [];
    let passed = 0;
    let failed = 0;

    for (const c of this.cases) {
      const beforeAssertions = assertionCounter;
      const t0 = nowMicros();
      let ok = true;
      let errText: string | undefined;

      try {
        for (const h of this.beforeHooks) await h();
        await c.fn();
      } catch (err) {
        ok = false;
        errText = err instanceof Error ? err.message : String(err);
      } finally {
        restoreAllMocks();
        for (const h of this.afterHooks) {
          try {
            await h();
          } catch (afterErr) {
            if (ok) {
              ok = false;
              errText = afterErr instanceof Error ? afterErr.message : String(afterErr);
            }
          }
        }
      }

      const durationUs = Math.max(1, nowMicros() - t0);
      const assertions = Math.max(0, assertionCounter - beforeAssertions);
      if (ok) passed++;
      else failed++;

      events.push({
        twep: 1,
        lang: 'typescript',
        tier: c.tier,
        suite: this.suiteName,
        name: c.name,
        ok,
        durationUs,
        assertions,
        error: errText
      });
    }

    return { passed, failed, events };
  }
}
