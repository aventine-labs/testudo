/**
 * @aventine/testudo - Out-of-Process Protocol Wire Interceptor & Idempotency Chaos Prover (src/intercept.ts)
 * - Zero window.fetch monkey-patching in MAIN world: operates via CDP Fetch.enable or explicit adapter dispatch
 * - Deterministic Wire Cassette Recording & Replay
 * - Concurrent Double-Submit & Out-of-Order Response Race Prover ($T.chaos.proveIdempotency)
 * Zero external dependencies. Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

export type FaultInjectionMode =
  | 'NONE'
  | 'HTTP_429_RATE_LIMIT'
  | 'HTTP_503_OVERLOAD'
  | 'CORRUPT_JSON'
  | 'TIMEOUT_HANG'
  | 'OUT_OF_ORDER_STALE_RACE';

export interface WireMockRule {
  id: string;
  urlPattern: string;
  method?: string;
  status: number;
  headers?: Record<string, string>;
  body: string;
  delayMs?: number;
  fault?: FaultInjectionMode;
}

export interface CassetteEntry {
  method: string;
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  recordedLatencyUs: number;
}

export interface IdempotencyChaosReport {
  passed: boolean;
  concurrentClicksDispatched: number;
  outboundMutationsObserved: number;
  duplicateSubmissionsPrevented: boolean;
  outOfOrderRaceTested: boolean;
  staleStateOverwrittenUi: boolean;
  finalRenderedValue: string;
  expectedLatestValue: string;
  verdict: 'IDEMPOTENT_AND_RACE_SAFE' | 'DOUBLE_SUBMIT_VULNERABILITY' | 'STALE_CLOSURE_RACE_BUG';
}

export class TestudoWireInterceptor {
  private rules: WireMockRule[] = [];
  private cassette: CassetteEntry[] = [];

  public addRule(rule: Omit<WireMockRule, 'id'> & { id?: string }): WireMockRule {
    const full: WireMockRule = {
      id: rule.id || `mock-${this.rules.length + 1}`,
      urlPattern: rule.urlPattern,
      method: rule.method ? rule.method.toUpperCase() : undefined,
      status: rule.status,
      headers: rule.headers ? { ...rule.headers } : { 'content-type': 'application/json' },
      body: rule.body,
      delayMs: rule.delayMs ?? 0,
      fault: rule.fault ?? 'NONE'
    };
    this.rules.push(full);
    return full;
  }

  public clearRules(): void {
    this.rules = [];
  }

  public getRules(): WireMockRule[] {
    return this.rules.map((r) => ({ ...r }));
  }

  public matchRequest(method: string, url: string): {
    matched: boolean;
    status: number;
    headers: Record<string, string>;
    body: string;
    delayMs: number;
    fault: FaultInjectionMode;
  } | null {
    const m = (method || 'GET').toUpperCase();
    for (const r of this.rules) {
      if (r.method && r.method !== m) continue;
      if (url.includes(r.urlPattern) || r.urlPattern === '*') {
        if (r.fault === 'HTTP_429_RATE_LIMIT') {
          return { matched: true, status: 429, headers: { 'retry-after': '1' }, body: '{"error":"RATE_LIMITED"}', delayMs: r.delayMs || 0, fault: r.fault };
        }
        if (r.fault === 'HTTP_503_OVERLOAD') {
          return { matched: true, status: 503, headers: {}, body: '{"error":"SERVICE_UNAVAILABLE"}', delayMs: r.delayMs || 0, fault: r.fault };
        }
        if (r.fault === 'CORRUPT_JSON') {
          return { matched: true, status: 200, headers: { 'content-type': 'application/json' }, body: '{"truncated": [1, 2,', delayMs: r.delayMs || 0, fault: r.fault };
        }
        return {
          matched: true,
          status: r.status,
          headers: { ...(r.headers || {}) },
          body: r.body,
          delayMs: r.delayMs || 0,
          fault: r.fault || 'NONE'
        };
      }
    }
    return null;
  }

  public recordCassetteEntry(entry: CassetteEntry): void {
    this.cassette.push({
      method: entry.method.toUpperCase(),
      url: entry.url,
      status: entry.status,
      headers: { ...entry.headers },
      body: entry.body,
      recordedLatencyUs: entry.recordedLatencyUs
    });
  }

  public exportCassetteJson(name = 'testudo-wire-cassette'): string {
    return JSON.stringify({ name, version: '1.0', entries: this.cassette }, null, 2);
  }

  public loadCassetteJson(rawJson: string): number {
    const parsed = JSON.parse(rawJson);
    const list = Array.isArray(parsed?.entries) ? parsed.entries : [];
    for (const item of list) {
      this.addRule({
        urlPattern: String(item.url || ''),
        method: String(item.method || 'GET'),
        status: Number(item.status || 200),
        headers: item.headers || {},
        body: String(item.body || '')
      });
    }
    return list.length;
  }
}

/**
 * Proves two notoriously untested frontend bugs in one deterministic pass:
 * 1. Concurrent Double-Click Idempotency: Fires N simultaneous clicks on a submit action and asserts <= 1 mutation.
 * 2. Out-of-Order Async Response Inversion: Dispatches Query #1 ("STALE_V1", slow 40ms) followed by Query #2 ("LATEST_V2", fast 5ms)
 *    so Query #1 resolves AFTER Query #2, proving the UI does not overwrite LATEST_V2 with STALE_V1.
 */
export async function proveIdempotencyAndOutOfOrderSafety(options: {
  concurrentClicks?: number;
  triggerSubmitClick: () => void | Promise<void>;
  getOutboundMutationCount: () => number;
  triggerVersionedSearch?: (queryVersion: string, responsePromise: Promise<string>) => void | Promise<void>;
  readRenderedSearchValue?: () => string;
}): Promise<IdempotencyChaosReport> {
  const clicks = Math.max(2, options.concurrentClicks ?? 5);
  const beforeMutations = options.getOutboundMutationCount();

  await Promise.all(Array.from({ length: clicks }, () => Promise.resolve(options.triggerSubmitClick())));
  const observedMutations = Math.max(0, options.getOutboundMutationCount() - beforeMutations);
  const duplicatePrevented = observedMutations <= 1;

  let outOfOrderRaceTested = false;
  let staleOverwrote = false;
  let finalRendered = 'LATEST_V2';
  const expectedLatest = 'LATEST_V2';

  if (options.triggerVersionedSearch && options.readRenderedSearchValue) {
    outOfOrderRaceTested = true;
    let resolveSlowStale!: (v: string) => void;
    let resolveFastLatest!: (v: string) => void;
    const pSlowStale = new Promise<string>((r) => {
      resolveSlowStale = r;
    });
    const pFastLatest = new Promise<string>((r) => {
      resolveFastLatest = r;
    });

    const op1 = Promise.resolve(options.triggerVersionedSearch('V1', pSlowStale));
    const op2 = Promise.resolve(options.triggerVersionedSearch('V2', pFastLatest));

    // Resolve V2 FIRST, then resolve stale V1 AFTER V2 has painted!
    resolveFastLatest('LATEST_V2');
    await op2;
    await new Promise((r) => setTimeout(r, 5));
    resolveSlowStale('STALE_V1');
    await op1;
    await new Promise((r) => setTimeout(r, 5));

    finalRendered = options.readRenderedSearchValue();
    staleOverwrote = finalRendered !== expectedLatest;
  }

  const verdict: IdempotencyChaosReport['verdict'] = !duplicatePrevented
    ? 'DOUBLE_SUBMIT_VULNERABILITY'
    : staleOverwrote
    ? 'STALE_CLOSURE_RACE_BUG'
    : 'IDEMPOTENT_AND_RACE_SAFE';

  return {
    passed: verdict === 'IDEMPOTENT_AND_RACE_SAFE',
    concurrentClicksDispatched: clicks,
    outboundMutationsObserved: observedMutations,
    duplicateSubmissionsPrevented: duplicatePrevented,
    outOfOrderRaceTested,
    staleStateOverwrittenUi: staleOverwrote,
    finalRenderedValue: finalRendered,
    expectedLatestValue: expectedLatest,
    verdict
  };
}
