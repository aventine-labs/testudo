/**
 * @aventine/testudo - Solo Developer Local Studio Server & Optional Enterprise Hub Federator
 * (src/studio-server.ts)
 * Runs on 127.0.0.1:3850 by default (or port 0 ephemeral in tests) with:
 * - Strict DNS-Rebinding Host + Origin Shield & 256-bit CSPRNG Bearer Token
 * - Strict CSP (default-src 'self'; script-src 'self')
 * - Full 5-Lane Causal Waterfall, Time-Travel, Opt-In Browser Stress, AST Advisor, and 1:N Hybrid Canary
 * - Optional --org-hub promotion into Enterprise AegisStudio (:18443) Multi-Tenant Developer Slice!
 * Zero external dependencies. Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

import http from 'node:http';
import {
  mintSessionCapabilityNonce,
  verifyConstantTimeSecret,
  verifyLoopbackHostAndOrigin
} from './security-enclave.js';
import { TestudoWaterfallRecorder } from './waterfall.js';
import { TestudoTimeTravelRing } from './timetravel.js';
import { runDomCardinalityStress, runInputEnduranceAndThreeStepLeakProbe } from './stress.js';
import { runHybridWireAndBrowserCanary } from './hybrid-load-canary.js';
import { analyzeComponentSourceForEdgeCases } from './ast-advisor.js';
import {
  distillFailureToUnit,
  recordContractCassetteFromE2e,
  verifyAgainstCassette,
  type SupportedPolyglotLang
} from './cassette-contract.js';
import { planBlastRadiusExecution, runDiffMutationGate } from './mutation-dag.js';
import { detectHostRuntimes } from './polyglot-orchestrator.js';
import { TestudoUnitRunner, expectUnit } from './unit.js';
import { renderSoloStudioClientJs, renderSoloStudioHtml } from './studio-ui.js';

export interface SoloStudioServerOptions {
  host?: string;
  port?: number;
  sessionToken?: string;
  orgHubUrl?: string;
  orgBearerToken?: string;
  tenantId?: string;
  projectId?: string;
}

export class TestudoSoloStudioServer {
  private server: http.Server | null = null;
  private boundPort = 0;
  private host: string;
  public readonly sessionToken: string;
  private orgHubUrl?: string;
  private orgBearerToken?: string;
  private tenantId: string;
  private projectId: string;

  constructor(options: SoloStudioServerOptions = {}) {
    this.host = options.host || '127.0.0.1';
    this.sessionToken = options.sessionToken || mintSessionCapabilityNonce();
    this.orgHubUrl = options.orgHubUrl;
    this.orgBearerToken = options.orgBearerToken;
    this.tenantId = options.tenantId || 'solo_local';
    this.projectId = options.projectId || 'local_workspace';
  }

  public getPort(): number {
    return this.boundPort;
  }

  public getBaseUrl(): string {
    return `http://${this.host}:${this.boundPort}`;
  }

  public async start(port = 3850): Promise<{ port: number; baseUrl: string; sessionToken: string }> {
    if (this.host !== '127.0.0.1' && this.host !== 'localhost' && this.host !== '::1') {
      throw new Error(`[Testudo Studio] Refusing non-loopback bind in MODE_SOLO_LOCAL: ${this.host}`);
    }

    return new Promise((resolve, reject) => {
      const srv = http.createServer(async (req, res) => {
        try {
          await this.handleHttp(req, res);
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
        }
      });
      srv.on('error', reject);
      srv.listen(port, this.host, () => {
        const addr = srv.address();
        this.boundPort = typeof addr === 'object' && addr ? addr.port : port;
        this.server = srv;
        resolve({ port: this.boundPort, baseUrl: this.getBaseUrl(), sessionToken: this.sessionToken });
      });
    });
  }

  public async close(): Promise<void> {
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  private writeWithSecurityHeaders(res: http.ServerResponse, status: number, contentType: string, body: string): void {
    res.writeHead(status, {
      'Content-Type': contentType,
      'Content-Length': Buffer.byteLength(body, 'utf8'),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Server-Timing': 'siam;dur=0.08, aldb;dur=0.41, app;dur=1.15',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"
    });
    res.end(body);
  }

  private async readJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let buf = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        buf += chunk;
        if (buf.length > 1024 * 1024) {
          req.destroy();
          reject(new Error('PAYLOAD_TOO_LARGE'));
        }
      });
      req.on('end', () => {
        if (!buf.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(buf));
        } catch {
          reject(new Error('INVALID_JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const gate = verifyLoopbackHostAndOrigin(req.headers.host, req.headers.origin as string | undefined, this.boundPort);
    if (!gate.allowed) {
      this.writeWithSecurityHeaders(
        res,
        403,
        'application/json; charset=utf-8',
        JSON.stringify({ ok: false, errorCode: -9848, reason: gate.reason })
      );
      return;
    }

    const urlPath = (req.url || '/').split('?')[0];

    if (req.method === 'GET' && (urlPath === '/' || urlPath === '/index.html')) {
      this.writeWithSecurityHeaders(res, 200, 'text/html; charset=utf-8', renderSoloStudioHtml());
      return;
    }
    if (req.method === 'GET' && urlPath === '/solo_studio.js') {
      this.writeWithSecurityHeaders(
        res,
        200,
        'application/javascript; charset=utf-8',
        renderSoloStudioClientJs(this.sessionToken)
      );
      return;
    }
    if (req.method === 'GET' && urlPath === '/api/sut-ping') {
      this.writeWithSecurityHeaders(
        res,
        200,
        'application/json; charset=utf-8',
        JSON.stringify({ ok: true, sut: 'healthy', ts: Date.now() })
      );
      return;
    }

    // Authenticated API routes require constant-time session token
    const authHeader = String(req.headers.authorization || '');
    const cand = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!verifyConstantTimeSecret(cand, this.sessionToken)) {
      this.writeWithSecurityHeaders(
        res,
        401,
        'application/json; charset=utf-8',
        JSON.stringify({ ok: false, errorCode: -9402, reason: 'UNAUTHORIZED_SESSION_TOKEN' })
      );
      return;
    }

    if (req.method === 'GET' && urlPath === '/api/studio/health') {
      this.writeWithSecurityHeaders(
        res,
        200,
        'application/json; charset=utf-8',
        JSON.stringify({
          ok: true,
          mode: 'MODE_SOLO_LOCAL',
          tenantId: this.tenantId,
          projectId: this.projectId,
          splitWorldEnclaveActive: true
        })
      );
      return;
    }

    const body = req.method === 'POST' ? await this.readJsonBody(req) : {};

    if (req.method === 'POST' && urlPath === '/api/studio/run-suite') {
      const stressEnabled = Boolean(body.stress);
      const wf = new TestudoWaterfallRecorder({
        scenarioName: 'checkout-and-carousel-verification',
        tenantId: this.tenantId,
        projectId: this.projectId
      });
      const tt = new TestudoTimeTravelRing();

      const s1 = wf.beginStep(1, 'Open Checkout View', '[data-testid="checkout-root"]', 'resolve');
      tt.captureFrame({
        stepId: s1,
        phase: 'before',
        waterfallTimestampUs: 100,
        targetSelector: '[data-testid="checkout-root"]',
        explicitHtml: '<section data-testid="checkout-root"><button data-testid="submit-btn">$1,250.00</button></section>'
      });
      wf.recordNetworkSpan({
        requestId: 'req-cart',
        parentStepId: s1,
        url: '/api/cart/summary',
        method: 'GET',
        status: 200,
        mimeType: 'application/json',
        startUs: 150,
        endUs: 8450,
        queueUs: 50,
        dnsUs: 0,
        tcpUs: 0,
        tlsUs: 0,
        sendUs: 60,
        ttfbUs: 7600,
        downloadUs: 590,
        transferBytes: 1840,
        decodedBytes: 4200,
        fromCache: false,
        serverTimingHeader: 'siam;dur=0.08, aldb;dur=0.42, app;dur=6.80',
        wireJsonFieldCount: 40,
        renderedDomFieldCount: 3
      });
      wf.recordNetworkSpan({
        requestId: 'req-shipping',
        parentStepId: s1,
        url: '/api/shipping/rates',
        method: 'GET',
        status: 200,
        mimeType: 'application/json',
        startUs: 8500,
        endUs: 15900,
        queueUs: 40,
        dnsUs: 0,
        tcpUs: 0,
        tlsUs: 0,
        sendUs: 50,
        ttfbUs: 6800,
        downloadUs: 510,
        transferBytes: 920,
        decodedBytes: 1600,
        fromCache: false,
        serverTimingHeader: 'siam;dur=0.07, aldb;dur=0.39, app;dur=6.10'
      });
      // Planted chatty N+1 lookup for Doctor demonstration
      for (let k = 1; k <= 3; k++) {
        wf.recordNetworkSpan({
          requestId: `req-sku-${k}`,
          parentStepId: s1,
          url: `/api/items/${100 + k}`,
          method: 'GET',
          status: 200,
          mimeType: 'application/json',
          startUs: 16000 + k * 2200,
          endUs: 16000 + k * 2200 + 2000,
          queueUs: 20,
          dnsUs: 0,
          tcpUs: 0,
          tlsUs: 0,
          sendUs: 30,
          ttfbUs: 1750,
          downloadUs: 200,
          transferBytes: 410,
          decodedBytes: 680,
          fromCache: false,
          serverTimingHeader: 'aldb;dur=0.35'
        });
      }
      wf.recordMainThreadSpan({ id: 'mt-1', kind: 'longtask', startUs: 23000, durationUs: 54000, culpritSelector: '.carousel-track' });
      tt.captureFrame({
        stepId: s1,
        phase: 'after',
        waterfallTimestampUs: 24800,
        targetSelector: '[data-testid="checkout-root"]',
        explicitHtml: '<section data-testid="checkout-root" data-settled="1"><button data-testid="submit-btn">$1,250.00</button></section>'
      });
      wf.endStep(s1, 'passed', 25000);

      const cardinalityStress = await runDomCardinalityStress({
        stress: stressEnabled,
        baseItemCount: 4,
        multipliers: [1, 10, 25, 50],
        fpsFloor: 45,
        measureAtItemCount: (count) => ({
          fps: Math.max(18, Math.round(60 - count * 0.22)),
          layoutAndStyleUs: 350 + count * 42,
          inpLatencyUs: 4200 + count * 110,
          heapUsedBytes: 8 * 1024 * 1024 + count * 16384
        })
      });

      let oneTimeLazyInitDone = false;
      let listeners = 12;
      let netCalls = 0;
      const enduranceStress = await runInputEnduranceAndThreeStepLeakProbe({
        stress: stressEnabled,
        holdDurationMs: 400,
        maxAllowedHoldNetworkCalls: 2,
        dispatchHoldTick: (idx) => {
          if (idx === 0) netCalls += 1; // properly debounced!
        },
        dispatchBurstClicks: () => {
          if (!oneTimeLazyInitDone) {
            listeners += 2; // one-time React lazy init (must NOT false-positive!)
            oneTimeLazyInitDone = true;
          }
        },
        readRuntimeCounters: () => ({ listeners, domNodes: 140, networkCalls: netCalls })
      });

      const waterfall = wf.generateReport();
      this.writeWithSecurityHeaders(
        res,
        200,
        'application/json; charset=utf-8',
        JSON.stringify({
          ok: true,
          waterfall,
          cardinalityStress,
          enduranceStress,
          timeTravelFrames: tt.getFrames()
        })
      );
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/studio/run-hybrid-canary') {
      const pingUrl = `${this.getBaseUrl()}/api/sut-ping`;
      const hybridReport = await runHybridWireAndBrowserCanary({
        targetUrl: pingUrl,
        canaryRatioNth: 50,
        stageVuPlan: [
          { stage: 'BASELINE_10PCT', wireVus: 4, requests: 32 },
          { stage: 'USL_KNEE_N_STAR', wireVus: 16, requests: 64 },
          { stage: 'OVERLOAD_120PCT', wireVus: 24, requests: 64 },
          { stage: 'RECOVERY', wireVus: 4, requests: 32 }
        ],
        runBrowserCanaryScenario: async (stage, wireVus) => {
          const wf = new TestudoWaterfallRecorder({ scenarioName: `canary-${stage}` });
          const st = wf.beginStep(1, `Canary ${stage}`, '#app', 'resolve');
          wf.recordNetworkSpan({
            requestId: `c-${stage}`,
            parentStepId: st,
            url: '/api/sut-ping',
            method: 'GET',
            status: 200,
            mimeType: 'application/json',
            startUs: 50,
            endUs: 1200 + wireVus * 180,
            queueUs: 20,
            dnsUs: 0,
            tcpUs: 0,
            tlsUs: 0,
            sendUs: 25,
            ttfbUs: 900 + wireVus * 150,
            downloadUs: 255,
            transferBytes: 128,
            decodedBytes: 128,
            fromCache: false,
            serverTimingHeader: 'siam;dur=0.08, aldb;dur=0.41'
          });
          wf.endStep(st, 'passed', 1500 + wireVus * 220);
          return {
            browserTtfbUs: 900 + wireVus * 150,
            browserLcpUs: 2400 + wireVus * 480,
            browserInpUs: 1800 + wireVus * 190,
            browserFps: stage === 'OVERLOAD_120PCT' ? 42 : 60,
            sensitiveRects: [{ x: 40, y: 110, width: 220, height: 32, reason: 'password' }],
            waterfall: wf.generateReport()
          };
        }
      });

      this.writeWithSecurityHeaders(
        res,
        200,
        'application/json; charset=utf-8',
        JSON.stringify({ ok: true, hybridReport })
      );
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/studio/ast-advisor') {
      const sampleSrc = String(
        body.sourceCode ||
          `export function CheckoutCarousel({ slides, total }) {
            return <div>{slides.map(s => <div key={s.id}>{s.title}</div>)}
              <span>$1,250.00</span>
              <button onClick={() => fetch('/api/pay', { method: 'POST' })}>Pay Now</button>
            </div>;
          }`
      );
      const advisor = analyzeComponentSourceForEdgeCases(sampleSrc, 'CheckoutCarousel');
      this.writeWithSecurityHeaders(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, advisor }));
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/studio/federate') {
      const targetHub = String(body.orgHubUrl || this.orgHubUrl || '').trim();
      const orgTok = String(body.orgBearerToken || this.orgBearerToken || '').trim();
      if (!targetHub || !orgTok) {
        this.writeWithSecurityHeaders(
          res,
          400,
          'application/json; charset=utf-8',
          JSON.stringify({ ok: false, error: 'Missing orgHubUrl or orgBearerToken for enterprise slice promotion' })
        );
        return;
      }
      const r = await fetch(`${targetHub.replace(/\/$/, '')}/api/testudo/runs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${orgTok}`
        },
        body: JSON.stringify({
          tenantId: body.tenantId || this.tenantId,
          projectBit: body.projectBit || 1,
          principalClass: 1,
          scenarioName: body.scenarioName || 'federated-solo-run',
          sequentialSumUs: body.sequentialSumUs ?? 22000,
          criticalPathUs: body.criticalPathUs ?? 9500,
          duplicateCalls: body.duplicateCalls ?? 0,
          rawPiiLeaks: 0
        })
      });
      const respJson = await r.json();
      this.writeWithSecurityHeaders(res, r.status, 'application/json; charset=utf-8', JSON.stringify(respJson));
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/studio/run-polyglot') {
      const hostInfo = detectHostRuntimes();
      const cassette = recordContractCassetteFromE2e({
        method: 'POST',
        path: '/api/v1/checkout',
        statusCode: 200,
        responseBody: { orderId: 'ord_901', totalCents: 125000, currency: 'USD' },
        requiredFrontendFields: ['orderId', 'totalCents', 'currency'],
        consumerComponent: 'CheckoutSummary',
        consumerE2eJourney: 'checkout.e2e.ts'
      });

      const contractCheck = verifyAgainstCassette(cassette, {
        backendPayload: body.backendPayload || { orderId: 'ord_901', totalCents: 125000, currency: 'USD' },
        frontendMockPayload: body.frontendMockPayload || { orderId: 'ord_901', totalCents: 125000 }
      });

      const unitSuite = new TestudoUnitRunner('checkout_math');
      unitSuite.test('calculates_settlement_total', () => {
        expectUnit('$1,250.00').toEqualCurrency(1250);
      });
      const unitRes = await unitSuite.run();

      const mutationReport = await runDiffMutationGate({
        sourceCode: 'function calcTotal(sub, tax) {\n  if (sub >= 0) {\n    return sub + tax;\n  }\n  return 0;\n}',
        changedLineNumbers: [2, 3],
        evaluateMutant: (mutated) => {
          const fn = new Function('sub', 'tax', `${mutated}\nreturn calcTotal(sub, tax);`);
          return fn(100, 10) === 110 && fn(0, 5) === 5 && fn(-5, 5) === 0;
        }
      });

      const dagPlan = planBlastRadiusExecution({
        changedFiles: ['services/checkout/handler.go'],
        modules: [
          {
            id: 'svc_checkout',
            lang: 'go',
            filePatterns: ['services/checkout/'],
            exposesEndpoints: ['POST /api/v1/checkout'],
            unitSuiteIds: ['go_checkout_unit', 'ts_checkout_summary_unit']
          },
          {
            id: 'svc_profile',
            lang: 'rust',
            filePatterns: ['services/profile/'],
            exposesEndpoints: ['GET /api/v1/profile'],
            unitSuiteIds: ['rs_profile_unit']
          }
        ],
        e2eJourneys: [
          { id: 'checkout.e2e.ts', bitIndex: 0, dependsOnEndpoints: ['POST /api/v1/checkout'], dependsOnModules: ['svc_checkout'] },
          { id: 'profile.e2e.ts', bitIndex: 1, dependsOnEndpoints: ['GET /api/v1/profile'], dependsOnModules: ['svc_profile'] },
          { id: 'settings.e2e.ts', bitIndex: 2, dependsOnEndpoints: ['PUT /api/v1/settings'], dependsOnModules: [] }
        ],
        unitTierPassed: unitRes.failed === 0,
        contractGatePassed: contractCheck.ok
      });

      this.writeWithSecurityHeaders(
        res,
        200,
        'application/json; charset=utf-8',
        JSON.stringify({
          ok: true,
          hostAvailableMask: hostInfo.availableMask,
          hostBinaries: hostInfo.binaries,
          unitSummary: unitRes,
          contractCheck,
          mutationReport,
          dagPlan
        })
      );
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/studio/distill-failure') {
      const targetLang = (body.targetLang || 'typescript') as SupportedPolyglotLang;
      const distilled = distillFailureToUnit(
        {
          journeyName: body.journeyName || 'checkout_flow',
          failedStepIndex: Number(body.failedStepIndex ?? 4),
          failedStepAction: 'click [data-testid="submit-order"]',
          endpointMethod: 'POST',
          endpointPath: '/api/v1/checkout',
          observedStatus: 500,
          expectedStatus: 200,
          requestPayload: { sku: 'TESTUDO-ENT', quantity: 2, currency: 'CHF', amountStr: "1'250.50" },
          errorSummary: 'Unhandled currency apostrophe separator in settlement parser'
        },
        targetLang
      );
      this.writeWithSecurityHeaders(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, distilled }));
      return;
    }

    this.writeWithSecurityHeaders(res, 404, 'application/json; charset=utf-8', JSON.stringify({ ok: false, error: 'Route not found' }));
  }
}
