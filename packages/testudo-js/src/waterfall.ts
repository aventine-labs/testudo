/**
 * @aventine/testudo - 5-Lane Glass-to-Metal Causal Waterfall & Bottleneck Doctor (src/waterfall.ts)
 * Out-of-the-box full-stack waterfall capturing and correlating:
 *   Lane 1: Testudo Step-to-Request Causality Spans
 *   Lane 2: Protocol Network Waterfall (Queue/DNS/TCP/TLS/Send/TTFB/Download) + Server-Timing Backend Split
 *   Lane 3: Main-Thread LongTasks (>50ms), Frame Drops, LCP, INP, and CLS Culprit Attribution
 *   Lane 4: DOM Mutations, Console/CSP Errors, and Pillar-1 Client-Side PII / Secret Leak Sniffer
 *   Lane 5: Automated Bottleneck Doctor (N+1 Detector, DAG Parallel Promise.all() Savings, JSON Over-Fetch)
 * Zero external dependencies. Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

import { computeDeterministicHash256 } from './wasm-concierge.js';

export interface BackendServerTimingSplit {
  name: string;
  durationUs: number;
  description?: string;
}

export interface WaterfallStepSpan {
  stepId: string;
  stepNumber: number;
  title: string;
  selector: string;
  action: string;
  startUs: number;
  endUs: number;
  durationUs: number;
  status: 'passed' | 'failed' | 'healed';
  spawnedRequestIds: string[];
}

export interface WaterfallNetworkSpan {
  requestId: string;
  parentStepId?: string;
  url: string;
  normalizedRoute: string;
  method: string;
  status: number;
  mimeType: string;
  startUs: number;
  endUs: number;
  queueUs: number;
  dnsUs: number;
  tcpUs: number;
  tlsUs: number;
  sendUs: number;
  ttfbUs: number;
  downloadUs: number;
  totalUs: number;
  transferBytes: number;
  decodedBytes: number;
  fromCache: boolean;
  traceparent?: string;
  serverTimingSplits: BackendServerTimingSplit[];
  wireJsonFieldCount?: number;
  renderedDomFieldCount?: number;
  dependsOnRequestId?: string;
}

export interface WaterfallMainThreadSpan {
  id: string;
  kind: 'longtask' | 'frame-drop' | 'lcp' | 'inp' | 'cls';
  startUs: number;
  durationUs: number;
  value?: number;
  culpritSelector?: string;
}

export interface WaterfallSecurityAndDomEvent {
  id: string;
  timestampUs: number;
  category: 'dom-mutation' | 'console-error' | 'csp-violation' | 'pii-secret-leak';
  severity: 'info' | 'warn' | 'critical';
  summary: string;
  blindedEvidenceHash?: string;
}

export interface NPlusOneFinding {
  normalizedRoute: string;
  parentStepId: string;
  callCount: number;
  totalWastedUs: number;
  remediation: string;
}

export interface OverFetchFinding {
  requestId: string;
  url: string;
  wireJsonFieldCount: number;
  renderedDomFieldCount: number;
  utilizationRatio: number;
  remediation: string;
}

export interface WaterfallBottleneckDiagnosis {
  nPlusOneFindings: NPlusOneFinding[];
  sequentialSumUs: number;
  criticalPathUs: number;
  parallelizableSavingsUs: number;
  parallelSavingsPct: number;
  overFetchFindings: OverFetchFinding[];
  piiOrSecretLeakCount: number;
  verdict: 'HEALTHY' | 'OPTIMIZATION_AVAILABLE' | 'CRITICAL_BOTTLENECK_OR_LEAK';
  recommendations: string[];
}

export interface FiveLaneWaterfallReport {
  runId: string;
  scenarioName: string;
  tenantId: string;
  projectId: string;
  startedAtIso: string;
  totalDurationUs: number;
  lane1Steps: WaterfallStepSpan[];
  lane2Network: WaterfallNetworkSpan[];
  lane3MainThread: WaterfallMainThreadSpan[];
  lane4DomAndSecurity: WaterfallSecurityAndDomEvent[];
  lane5Doctor: WaterfallBottleneckDiagnosis;
}

export function normalizeEndpointRoute(rawUrl: string): string {
  try {
    const u = new URL(rawUrl, 'http://127.0.0.1');
    const normPath = u.pathname
      .split('/')
      .map((seg) => {
        if (!seg) return '';
        if (/^\d+$/.test(seg)) return '{id}';
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return '{uuid}';
        if (/^[0-9a-f]{16,}$/i.test(seg)) return '{hex}';
        return seg;
      })
      .join('/');
    return `${normPath || '/'}`;
  } catch {
    return rawUrl.split('?')[0] || '/';
  }
}

/**
 * Parses W3C Server-Timing header (durations in ms) and X-Aegis-Causal-Trace (durations in us)
 * into sub-millisecond backend TTFB waterfall sub-spans.
 */
export function parseServerTimingHeader(
  serverTimingHeader?: string,
  aegisCausalHeader?: string
): BackendServerTimingSplit[] {
  const splits: BackendServerTimingSplit[] = [];
  if (serverTimingHeader) {
    for (const rawEntry of serverTimingHeader.split(',')) {
      const parts = rawEntry.split(';').map((p) => p.trim());
      const name = parts[0];
      if (!name) continue;
      let durUs = 0;
      let desc: string | undefined;
      for (let i = 1; i < parts.length; i++) {
        const kv = parts[i];
        if (kv.toLowerCase().startsWith('dur=')) {
          const ms = Number(kv.slice(4));
          if (Number.isFinite(ms) && ms >= 0) durUs = Math.round(ms * 1000);
        } else if (kv.toLowerCase().startsWith('desc=')) {
          desc = kv.slice(5).replace(/^"|"$/g, '');
        }
      }
      splits.push({ name, durationUs: durUs, description: desc });
    }
  }
  if (aegisCausalHeader) {
    // Example: siam_us=8;aldb_us=41;siem_us=12
    for (const pair of aegisCausalHeader.split(';')) {
      const [k, v] = pair.split('=').map((s) => (s || '').trim());
      if (!k || !v) continue;
      const num = Number(v);
      if (Number.isFinite(num) && num >= 0) {
        splits.push({ name: k.replace(/_us$/i, ''), durationUs: Math.round(num), description: 'Aegis Kernel' });
      }
    }
  }
  return splits;
}

export function passesLuhnCheck(digitsOnly: string): boolean {
  if (digitsOnly.length < 13 || digitsOnly.length > 19 || !/^\d+$/.test(digitsOnly)) return false;
  if (/^(\d)\1+$/.test(digitsOnly)) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digitsOnly.length - 1; i >= 0; i--) {
    let d = digitsOnly.charCodeAt(i) - 48;
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/**
 * Pillar 1 Client-Side PII & Secret Sniffer:
 * Detects raw SSNs, Luhn-valid payment cards, JWT tokens, Stripe/AWS keys, or raw Bearer secrets.
 * Never returns the raw secret; emits an HMAC-blinded hash for cryptographic auditability.
 */
export function scanTextForPiiAndSecrets(rawText: string, sourceLabel: string): WaterfallSecurityAndDomEvent[] {
  const findings: WaterfallSecurityAndDomEvent[] = [];
  const text = String(rawText || '');
  if (!text) return findings;

  const pushFinding = (kind: string, matchedSecret: string) => {
    findings.push({
      id: `sec-${findings.length + 1}`,
      timestampUs: 0,
      category: 'pii-secret-leak',
      severity: 'critical',
      summary: `Client-side ${kind} exposure detected in ${sourceLabel} (value blinded per Pillar 1)`,
      blindedEvidenceHash: computeDeterministicHash256(matchedSecret, 'TESTUDO_PILLAR1_BLIND_V1').slice(0, 24)
    });
  };

  const ssnMatch = text.match(/\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/);
  if (ssnMatch) pushFinding('SSN', ssnMatch[0]);

  const jwtMatch = text.match(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/);
  if (jwtMatch) pushFinding('JWT_BEARER_TOKEN', jwtMatch[0]);

  const apiKeyMatch = text.match(/\b(?:sk_live_[0-9a-zA-Z]{16,}|AKIA[0-9A-Z]{16})\b/);
  if (apiKeyMatch) pushFinding('LIVE_API_SECRET_KEY', apiKeyMatch[0]);

  const cardCandidates = text.match(/\b(?:\d[ -]*?){13,19}\b/g) || [];
  for (const cand of cardCandidates) {
    const digits = cand.replace(/\D/g, '');
    if (passesLuhnCheck(digits)) {
      pushFinding('PAYMENT_CARD_PAN', digits);
      break;
    }
  }

  return findings;
}

export class TestudoWaterfallRecorder {
  private runId: string;
  private scenarioName: string;
  private tenantId: string;
  private projectId: string;
  private originUs: number;
  private activeStepId: string | undefined;
  private steps: WaterfallStepSpan[] = [];
  private network: WaterfallNetworkSpan[] = [];
  private mainThread: WaterfallMainThreadSpan[] = [];
  private domAndSecurity: WaterfallSecurityAndDomEvent[] = [];

  constructor(options: { runId?: string; scenarioName?: string; tenantId?: string; projectId?: string } = {}) {
    this.runId = options.runId || `wf-${Date.now()}`;
    this.scenarioName = options.scenarioName || 'default-waterfall-suite';
    this.tenantId = options.tenantId || 'solo_local';
    this.projectId = options.projectId || 'local_workspace';
    this.originUs = this.nowUs();
  }

  private nowUs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return Math.round(performance.now() * 1000);
    }
    return Date.now() * 1000;
  }

  public beginStep(stepNumber: number, title: string, selector: string, action: string): string {
    const stepId = `step-${stepNumber}`;
    this.activeStepId = stepId;
    const relStart = Math.max(0, this.nowUs() - this.originUs);
    this.steps.push({
      stepId,
      stepNumber,
      title,
      selector,
      action,
      startUs: relStart,
      endUs: relStart,
      durationUs: 0,
      status: 'passed',
      spawnedRequestIds: []
    });
    return stepId;
  }

  public endStep(stepId: string, status: 'passed' | 'failed' | 'healed' = 'passed', explicitDurationUs?: number): void {
    const st = this.steps.find((s) => s.stepId === stepId);
    if (!st) return;
    const relNow = Math.max(st.startUs, this.nowUs() - this.originUs);
    st.endUs = explicitDurationUs !== undefined ? st.startUs + explicitDurationUs : relNow;
    st.durationUs = Math.max(0, st.endUs - st.startUs);
    st.status = status;
    if (this.activeStepId === stepId) {
      this.activeStepId = undefined;
    }
  }

  public recordNetworkSpan(
    span: Omit<WaterfallNetworkSpan, 'normalizedRoute' | 'totalUs' | 'serverTimingSplits'> & {
      serverTimingHeader?: string;
      aegisCausalHeader?: string;
      serverTimingSplits?: BackendServerTimingSplit[];
      responsePreviewText?: string;
    }
  ): WaterfallNetworkSpan {
    const parentStepId = span.parentStepId ?? this.activeStepId;
    const splits =
      span.serverTimingSplits ??
      parseServerTimingHeader(span.serverTimingHeader, span.aegisCausalHeader);
    const totalUs = Math.max(
      1,
      span.endUs > span.startUs
        ? span.endUs - span.startUs
        : span.queueUs + span.dnsUs + span.tcpUs + span.tlsUs + span.sendUs + span.ttfbUs + span.downloadUs
    );
    const entry: WaterfallNetworkSpan = {
      requestId: span.requestId,
      parentStepId,
      url: span.url,
      normalizedRoute: normalizeEndpointRoute(span.url),
      method: (span.method || 'GET').toUpperCase(),
      status: span.status,
      mimeType: span.mimeType || 'application/json',
      startUs: span.startUs,
      endUs: span.startUs + totalUs,
      queueUs: span.queueUs,
      dnsUs: span.dnsUs,
      tcpUs: span.tcpUs,
      tlsUs: span.tlsUs,
      sendUs: span.sendUs,
      ttfbUs: span.ttfbUs,
      downloadUs: span.downloadUs,
      totalUs,
      transferBytes: span.transferBytes,
      decodedBytes: span.decodedBytes,
      fromCache: Boolean(span.fromCache),
      traceparent: span.traceparent,
      serverTimingSplits: splits,
      wireJsonFieldCount: span.wireJsonFieldCount,
      renderedDomFieldCount: span.renderedDomFieldCount,
      dependsOnRequestId: span.dependsOnRequestId
    };
    this.network.push(entry);

    if (parentStepId) {
      const parent = this.steps.find((s) => s.stepId === parentStepId);
      if (parent && !parent.spawnedRequestIds.includes(entry.requestId)) {
        parent.spawnedRequestIds.push(entry.requestId);
      }
    }

    if (span.responsePreviewText) {
      const leaks = scanTextForPiiAndSecrets(span.responsePreviewText, `${entry.method} ${entry.normalizedRoute}`);
      for (const lk of leaks) {
        this.domAndSecurity.push({ ...lk, timestampUs: entry.endUs });
      }
    }

    return entry;
  }

  public recordMainThreadSpan(span: WaterfallMainThreadSpan): void {
    this.mainThread.push({ ...span });
  }

  public recordSecurityOrDomEvent(ev: Omit<WaterfallSecurityAndDomEvent, 'id'> & { rawInspectText?: string }): void {
    this.domAndSecurity.push({
      id: `ev-${this.domAndSecurity.length + 1}`,
      timestampUs: ev.timestampUs,
      category: ev.category,
      severity: ev.severity,
      summary: ev.summary,
      blindedEvidenceHash: ev.blindedEvidenceHash
    });
    if (ev.rawInspectText) {
      const leaks = scanTextForPiiAndSecrets(ev.rawInspectText, ev.category);
      for (const lk of leaks) {
        this.domAndSecurity.push({ ...lk, id: `ev-${this.domAndSecurity.length + 1}`, timestampUs: ev.timestampUs });
      }
    }
  }

  public diagnoseBottlenecks(): WaterfallBottleneckDiagnosis {
    const nPlusOneFindings: NPlusOneFinding[] = [];
    const routeGroups = new Map<string, WaterfallNetworkSpan[]>();

    for (const req of this.network) {
      const key = `${req.parentStepId || 'root'}|${req.method}|${req.normalizedRoute}`;
      const list = routeGroups.get(key) || [];
      list.push(req);
      routeGroups.set(key, list);
    }

    for (const [key, list] of routeGroups.entries()) {
      if (list.length >= 3) {
        const [stepKey] = key.split('|');
        const sorted = [...list].sort((a, b) => a.startUs - b.startUs);
        const totalSpanUs = sorted.reduce((acc, r) => acc + r.totalUs, 0);
        const fastestSingleUs = Math.min(...sorted.map((r) => r.totalUs));
        const wastedUs = Math.max(0, totalSpanUs - fastestSingleUs);
        nPlusOneFindings.push({
          normalizedRoute: list[0].normalizedRoute,
          parentStepId: stepKey,
          callCount: list.length,
          totalWastedUs: wastedUs,
          remediation: `Batch ${list.length} chatty calls to ${list[0].normalizedRoute} into 1 bulk query (saves ${(wastedUs / 1000).toFixed(2)} ms).`
        });
      }
    }

    // Critical-path vs sequential sum across step-grouped independent requests
    let sequentialSumUs = 0;
    let criticalPathUs = 0;
    const byStep = new Map<string, WaterfallNetworkSpan[]>();
    for (const req of this.network) {
      const sk = req.parentStepId || '__global__';
      const arr = byStep.get(sk) || [];
      arr.push(req);
      byStep.set(sk, arr);
    }

    const reqById = new Map(this.network.map((r) => [r.requestId, r]));
    const computeChainDepthUs = (r: WaterfallNetworkSpan, visited = new Set<string>()): number => {
      if (visited.has(r.requestId)) return r.totalUs;
      visited.add(r.requestId);
      if (r.dependsOnRequestId && reqById.has(r.dependsOnRequestId)) {
        return r.totalUs + computeChainDepthUs(reqById.get(r.dependsOnRequestId)!, visited);
      }
      return r.totalUs;
    };

    for (const group of byStep.values()) {
      const groupSeq = group.reduce((acc, r) => acc + r.totalUs, 0);
      const groupCrit = group.reduce((maxD, r) => Math.max(maxD, computeChainDepthUs(r)), 0);
      sequentialSumUs += groupSeq;
      criticalPathUs += groupCrit;
    }

    const parallelizableSavingsUs = Math.max(0, sequentialSumUs - criticalPathUs);
    const parallelSavingsPct =
      sequentialSumUs > 0 ? Math.round((parallelizableSavingsUs / sequentialSumUs) * 1000) / 10 : 0;

    const overFetchFindings: OverFetchFinding[] = [];
    for (const req of this.network) {
      if (
        typeof req.wireJsonFieldCount === 'number' &&
        req.wireJsonFieldCount >= 10 &&
        typeof req.renderedDomFieldCount === 'number'
      ) {
        const ratio = req.renderedDomFieldCount / req.wireJsonFieldCount;
        if (ratio < 0.15) {
          overFetchFindings.push({
            requestId: req.requestId,
            url: req.url,
            wireJsonFieldCount: req.wireJsonFieldCount,
            renderedDomFieldCount: req.renderedDomFieldCount,
            utilizationRatio: Math.round(ratio * 1000) / 1000,
            remediation: `Endpoint returned ${req.wireJsonFieldCount} JSON fields but UI rendered only ${req.renderedDomFieldCount} (${(ratio * 100).toFixed(1)}%). Project only required columns.`
          });
        }
      }
    }

    const piiOrSecretLeakCount = this.domAndSecurity.filter((e) => e.category === 'pii-secret-leak').length;
    const recommendations: string[] = [];
    for (const n1 of nPlusOneFindings) recommendations.push(n1.remediation);
    if (parallelizableSavingsUs >= 5000) {
      recommendations.push(
        `Parallelize independent awaits with Promise.all() to reclaim ${(parallelizableSavingsUs / 1000).toFixed(2)} ms (${parallelSavingsPct}% of network wait).`
      );
    }
    for (const ofetch of overFetchFindings) recommendations.push(ofetch.remediation);
    if (piiOrSecretLeakCount > 0) {
      recommendations.push(
        `CRITICAL: Scrub ${piiOrSecretLeakCount} exposed PII/secret token(s) from client-visible payloads immediately.`
      );
    }

    const verdict: WaterfallBottleneckDiagnosis['verdict'] =
      piiOrSecretLeakCount > 0
        ? 'CRITICAL_BOTTLENECK_OR_LEAK'
        : nPlusOneFindings.length > 0 || parallelizableSavingsUs >= 5000 || overFetchFindings.length > 0
        ? 'OPTIMIZATION_AVAILABLE'
        : 'HEALTHY';

    return {
      nPlusOneFindings,
      sequentialSumUs,
      criticalPathUs,
      parallelizableSavingsUs,
      parallelSavingsPct,
      overFetchFindings,
      piiOrSecretLeakCount,
      verdict,
      recommendations
    };
  }

  public generateReport(): FiveLaneWaterfallReport {
    const maxStepEnd = this.steps.reduce((m, s) => Math.max(m, s.endUs), 0);
    const maxNetEnd = this.network.reduce((m, n) => Math.max(m, n.endUs), 0);
    const totalDurationUs = Math.max(1, maxStepEnd, maxNetEnd);
    return {
      runId: this.runId,
      scenarioName: this.scenarioName,
      tenantId: this.tenantId,
      projectId: this.projectId,
      startedAtIso: new Date().toISOString(),
      totalDurationUs,
      lane1Steps: this.steps.map((s) => ({ ...s, spawnedRequestIds: [...s.spawnedRequestIds] })),
      lane2Network: this.network.map((n) => ({ ...n, serverTimingSplits: [...n.serverTimingSplits] })),
      lane3MainThread: this.mainThread.map((m) => ({ ...m })),
      lane4DomAndSecurity: this.domAndSecurity.map((e) => ({ ...e })),
      lane5Doctor: this.diagnoseBottlenecks()
    };
  }
}
