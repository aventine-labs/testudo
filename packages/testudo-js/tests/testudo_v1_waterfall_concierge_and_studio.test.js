/**
 * @aventine/testudo v1.0.0 (AL-DEV-407 / SPEC-TESTUDO-WATERFALL-26)
 * Full-Spectrum Verification Suite:
 *   TW-G1: Split-World <4KB Probe, Native Intrinsics Untouched, DNS-Rebinding Shield & Pre-Shutter Redaction
 *   TW-G2: 5-Lane Causal Waterfall, Server-Timing Backend Split, N+1 / Parallel / Over-Fetch Doctor & PII Sniffer
 *   TW-G3: Opt-In Browser Stress Crucible & Rule-19 3-Step (10, 25, 50) Monotonic Slope Leak Prover
 *   TW-G4: 1:N Hybrid Wire Load + Core-Pinned Browser Canary (/dev/shm Spool, Alpha_UX, Redacted Screengrabs)
 *   TW-G5: 3/3 Consecutive Zero-Flake Live Chromium Click-Through Sweeps on Solo Local Studio (:3850)
 * Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  $T,
  assertNativeIntrinsicsUntouched,
  buildIsolatedProbeScript,
  buildMultiAnchor,
  resolveWithSemanticSelfHeal,
  TestudoWaterfallRecorder,
  parseServerTimingHeader,
  scanTextForPiiAndSecrets,
  proveIdempotencyAndOutOfOrderSafety,
  computeWcagContrastRatio,
  TestudoTimeTravelRing,
  runDomCardinalityStress,
  runInputEnduranceAndThreeStepLeakProbe,
  analyzeComponentSourceForEdgeCases,
  TestudoSuiteRunner,
  expectValue,
  spyFn
} from '../dist/index.js';

import {
  verifyLoopbackHostAndOrigin,
  scrubHeadersZeroPlaintext,
  redactRgbaFramebufferInPlace,
  buildRedactedScreengrabSvgDataUri
} from '../dist/security-enclave.js';

import {
  computeCanaryCoreAllocation,
  runHybridWireAndBrowserCanary
} from '../dist/hybrid-load-canary.js';

import { TestudoSoloStudioServer } from '../dist/studio-server.js';
import { TestudoCdp, resolveLocalChromeExecutable } from '../dist/adapters/cdp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let chromeAvailable = false;
try {
  resolveLocalChromeExecutable();
  chromeAvailable = true;
} catch {
  chromeAvailable = false;
}

describe('AL-DEV-407 (SPEC-TESTUDO-WATERFALL-26): Split-World Enclave, 5-Lane Waterfall, Stress & Hybrid Canary', () => {
  it('TW-G1: enforces <4KB IsolatedWorld probe, native intrinsics untouched, DNS-rebinding shield, and pre-shutter PII redaction', () => {
    const probeDist = fs.readFileSync(path.resolve(__dirname, '../dist/probe.js'), 'utf8');
    const gzBytes = zlib.gzipSync(Buffer.from(probeDist)).length;
    assert.ok(gzBytes > 0 && gzBytes < 4096, `Expected probe.js gzip < 4096B, got ${gzBytes}B`);

    const inlineProbe = buildIsolatedProbeScript('a1b2c3d4e5f6');
    assert.ok(Buffer.byteLength(inlineProbe, 'utf8') < 1024);

    const intr = assertNativeIntrinsicsUntouched({});
    assert.equal(intr.untouched, true);
    assert.equal(intr.pollutedGlobals.length, 0);

    // DNS rebinding & Cross-Origin blocks
    assert.equal(verifyLoopbackHostAndOrigin('evil-rebind.com:3850', undefined, 3850).allowed, false);
    assert.equal(verifyLoopbackHostAndOrigin('127.0.0.1:3850', 'https://evil.com', 3850).allowed, false);
    assert.equal(verifyLoopbackHostAndOrigin('127.0.0.1:3850', 'http://127.0.0.1:3850', 3850).allowed, true);
    assert.equal(verifyLoopbackHostAndOrigin('127.0.0.1:3851', 'chrome-extension://abcdef', 3851).allowed, true);

    // Zero-plaintext header scrubbing
    const scrubbed = scrubHeadersZeroPlaintext({
      Authorization: 'Bearer super_secret_prod_token_123',
      Cookie: 'sid=raw_cookie_val',
      Accept: 'application/json'
    });
    assert.ok(scrubbed.authorization.startsWith('[BLINDED_SHA256:'));
    assert.ok(!scrubbed.authorization.includes('super_secret'));
    assert.ok(scrubbed.cookie.startsWith('[BLINDED_SHA256:'));
    assert.equal(scrubbed.accept, 'application/json');

    // Pre-Shutter RGBA & SVG Screengrab PII Redaction
    const rgba = new Uint8Array(20 * 20 * 4).fill(255);
    const maskedPx = redactRgbaFramebufferInPlace(rgba, 20, 20, [
      { x: 2, y: 2, width: 5, height: 4, reason: 'password' }
    ]);
    assert.equal(maskedPx, 20);
    assert.equal(rgba[(2 * 20 + 2) * 4], 15);

    const svgSnap = buildRedactedScreengrabSvgDataUri({
      width: 640,
      height: 360,
      stageLabel: 'USL_KNEE_N_STAR',
      wireVus: 64,
      wireP95Ms: 1.85,
      browserLcpMs: 4.2,
      sensitiveRects: [{ x: 10, y: 20, width: 120, height: 28, reason: 'payment-card' }]
    });
    assert.equal(svgSnap.redactedRectCount, 1);
    assert.ok(svgSnap.svgMarkup.includes('[REDACTED:PAYMENT-CARD]'));
    assert.equal(svgSnap.sha256Hex.length, 64);
  });

  it('TW-G2: captures 5-Lane Causal Waterfall, splits backend Server-Timing, diagnoses N+1 & parallel savings, and blinds PII leaks', () => {
    const splits = parseServerTimingHeader('siam;dur=0.09;desc="Authz", aldb;dur=0.44', 'siem_us=14');
    assert.equal(splits.length, 3);
    assert.equal(splits[0].name, 'siam');
    assert.equal(splits[0].durationUs, 90);
    assert.equal(splits[2].name, 'siem');
    assert.equal(splits[2].durationUs, 14);

    const wf = new TestudoWaterfallRecorder({
      runId: 'wf-unit-1',
      scenarioName: 'checkout-waterfall',
      tenantId: 'tenant_commerce',
      projectId: 'storefront'
    });

    const step1 = wf.beginStep(1, 'Load Checkout', '#checkout', 'click');
    // Two independent calls executed sequentially (10ms + 12ms = 22ms sequential, 12ms critical path -> 10ms savings!)
    wf.recordNetworkSpan({
      requestId: 'r1',
      parentStepId: step1,
      url: '/api/profile',
      method: 'GET',
      status: 200,
      mimeType: 'application/json',
      startUs: 100,
      endUs: 10100,
      queueUs: 50,
      dnsUs: 0,
      tcpUs: 0,
      tlsUs: 0,
      sendUs: 50,
      ttfbUs: 9000,
      downloadUs: 900,
      transferBytes: 4000,
      decodedBytes: 9000,
      fromCache: false,
      serverTimingHeader: 'siam;dur=0.08, aldb;dur=0.40',
      wireJsonFieldCount: 50,
      renderedDomFieldCount: 2,
      responsePreviewText: '{"ssn":"123-45-6789"}'
    });
    wf.recordNetworkSpan({
      requestId: 'r2',
      parentStepId: step1,
      url: '/api/coupons',
      method: 'GET',
      status: 200,
      mimeType: 'application/json',
      startUs: 10200,
      endUs: 22200,
      queueUs: 50,
      dnsUs: 0,
      tcpUs: 0,
      tlsUs: 0,
      sendUs: 50,
      ttfbUs: 11000,
      downloadUs: 900,
      transferBytes: 800,
      decodedBytes: 1200,
      fromCache: false
    });
    wf.endStep(step1, 'passed', 23000);

    // Step 2: Planted N+1 loop (4 sequential calls to /api/products/{id})
    const step2 = wf.beginStep(2, 'Expand Recommendations', '#recs', 'click');
    for (let i = 1; i <= 4; i++) {
      wf.recordNetworkSpan({
        requestId: `n1-${i}`,
        parentStepId: step2,
        url: `/api/products/${500 + i}`,
        method: 'GET',
        status: 200,
        mimeType: 'application/json',
        startUs: 24000 + i * 3000,
        endUs: 24000 + i * 3000 + 2500,
        queueUs: 20,
        dnsUs: 0,
        tcpUs: 0,
        tlsUs: 0,
        sendUs: 30,
        ttfbUs: 2200,
        downloadUs: 250,
        transferBytes: 300,
        decodedBytes: 500,
        fromCache: false
      });
    }
    wf.endStep(step2, 'passed', 16000);

    const rep = wf.generateReport();
    assert.equal(rep.lane5Doctor.nPlusOneFindings.length, 1);
    assert.equal(rep.lane5Doctor.nPlusOneFindings[0].normalizedRoute, '/api/products/{id}');
    assert.equal(rep.lane5Doctor.nPlusOneFindings[0].callCount, 4);
    assert.equal(rep.lane5Doctor.overFetchFindings.length, 1);
    assert.equal(rep.lane5Doctor.piiOrSecretLeakCount, 1);
    assert.equal(rep.lane5Doctor.verdict, 'CRITICAL_BOTTLENECK_OR_LEAK');
    assert.ok(rep.lane5Doctor.parallelizableSavingsUs === 17500);
    // Ensure raw SSN never appears in summary or report JSON!
    assert.ok(!JSON.stringify(rep).includes('123-45-6789'));

    const cardLeak = scanTextForPiiAndSecrets('card=4532015112830366', 'checkout-log');
    assert.equal(cardLeak.length, 1);
  });

  it('TW-G3: keeps Browser Stress disabled by default and proves 0% lazy-init false positives vs 100% leak recall across (10, 25, 50) bursts', async () => {
    const offCard = await runDomCardinalityStress({
      measureAtItemCount: () => ({ fps: 60, layoutAndStyleUs: 100, inpLatencyUs: 1000, heapUsedBytes: 1024 })
    });
    assert.equal(offCard.enabled, false);
    assert.equal(offCard.status, 'SKIPPED_OPT_IN_DISABLED');

    const cliffCard = await runDomCardinalityStress({
      stress: true,
      baseItemCount: 5,
      multipliers: [1, 10, 30, 60],
      fpsFloor: 45,
      measureAtItemCount: (n) => ({
        fps: n >= 150 ? 28 : 60,
        layoutAndStyleUs: n * 25,
        inpLatencyUs: n * 40,
        heapUsedBytes: n * 4096
      })
    });
    assert.equal(cliffCard.status, 'CARDINALITY_FPS_CLIFF_DETECTED');
    assert.equal(cliffCard.fpsCliffItemCount, 150);

    // Case A: One-time lazy React init (+4 listeners on first click, then flat -> MUST NOT false-positive!)
    let lazyInit = false;
    let listenersA = 10;
    const cleanRep = await runInputEnduranceAndThreeStepLeakProbe({
      stress: true,
      holdDurationMs: 200,
      dispatchHoldTick: () => {},
      dispatchBurstClicks: () => {
        if (!lazyInit) {
          listenersA += 4;
          lazyInit = true;
        }
      },
      readRuntimeCounters: () => ({ listeners: listenersA, domNodes: 80, networkCalls: 1 })
    });
    assert.equal(cleanRep.status, 'CLEAN_NO_MONOTONIC_LEAK');
    assert.equal(cleanRep.listenerSlopePositive, false);

    // Case B: Genuine unremoved window.addEventListener leak (+1 listener per click -> MUST catch!)
    let listenersB = 10;
    const leakRep = await runInputEnduranceAndThreeStepLeakProbe({
      stress: true,
      holdDurationMs: 200,
      dispatchHoldTick: () => {},
      dispatchBurstClicks: (count) => {
        listenersB += count;
      },
      readRuntimeCounters: () => ({ listeners: listenersB, domNodes: 80, networkCalls: 1 })
    });
    assert.equal(leakRep.status, 'MONOTONIC_LISTENER_OR_NODE_LEAK');
    assert.equal(leakRep.listenerSlopePositive, true);
  });

  it('verifies Concurrent Double-Submit & Out-of-Order Race Prover, Self-Healing Git Patch Diff, WCAG Contrast, Runner & AST Advisor', async () => {
    // 1. Safe component (debounced submit + versioned latest-wins search)
    let safeSubmits = 0;
    let submitLocked = false;
    let activeSearchSeq = 0;
    let renderedSearch = '';
    const safeChaos = await proveIdempotencyAndOutOfOrderSafety({
      concurrentClicks: 6,
      triggerSubmitClick: async () => {
        if (submitLocked) return;
        submitLocked = true;
        safeSubmits += 1;
      },
      getOutboundMutationCount: () => safeSubmits,
      triggerVersionedSearch: async (_ver, p) => {
        const mySeq = ++activeSearchSeq;
        const val = await p;
        if (mySeq === activeSearchSeq) renderedSearch = val;
      },
      readRenderedSearchValue: () => renderedSearch
    });
    assert.equal(safeChaos.passed, true);
    assert.equal(safeChaos.verdict, 'IDEMPOTENT_AND_RACE_SAFE');

    // 2. Buggy stale-closure component (overwrites LATEST_V2 with slow STALE_V1!)
    let buggyRendered = '';
    const buggyChaos = await proveIdempotencyAndOutOfOrderSafety({
      concurrentClicks: 3,
      triggerSubmitClick: () => {},
      getOutboundMutationCount: () => 1,
      triggerVersionedSearch: async (_ver, p) => {
        buggyRendered = await p;
      },
      readRenderedSearchValue: () => buggyRendered
    });
    assert.equal(buggyChaos.passed, false);
    assert.equal(buggyChaos.verdict, 'STALE_CLOSURE_RACE_BUG');

    // 3. Self-Healing Semantic Fallback with explicit 1-line Git Patch Diff
    const fakeBtn = {
      id: 'place-order-v2',
      tagName: 'BUTTON',
      innerText: 'Place Order',
      getAttribute(k) {
        if (k === 'data-testid') return 'place-order-cta';
        return null;
      },
      getBoundingClientRect: () => ({ left: 600, top: 400, width: 120, height: 40 })
    };
    const fakeDoc = {
      querySelector(sel) {
        if (sel === '.legacy-broken-class') return null;
        if (sel === '[data-testid="place-order-cta"]') return fakeBtn;
        return null;
      },
      getElementById(id) {
        return id === 'place-order-v2' ? fakeBtn : null;
      }
    };
    const anchor = buildMultiAnchor(fakeBtn, '.legacy-broken-class', fakeDoc);
    const healed = resolveWithSemanticSelfHeal(anchor, fakeDoc);
    assert.equal(healed.healed, true);
    assert.equal(healed.usedSelector, '[data-testid="place-order-cta"]');
    assert.ok(healed.advisory.gitPatchDiff.includes('- await $T(\'.legacy-broken-class\')'));
    assert.ok(healed.advisory.gitPatchDiff.includes('+ await $T(\'[data-testid="place-order-cta"]\')'));

    // 4. WCAG Contrast, Time-Travel & Runner + AST Advisor
    assert.equal(computeWcagContrastRatio('#ffffff', '#000000'), 21);
    assert.ok(computeWcagContrastRatio('#94a3b8', '#ffffff') < 4.5);

    const tt = new TestudoTimeTravelRing();
    const f1 = tt.captureFrame({
      stepId: 's1',
      phase: 'before',
      waterfallTimestampUs: 100,
      targetSelector: '#btn',
      explicitHtml: '<input type="password" value="hunter2" />'
    });
    assert.ok(!f1.redactedHtmlExcerpt.includes('hunter2'));

    const runner = new TestudoSuiteRunner();
    const spy = spyFn((x) => x * 2);
    runner.describe('Unified TS Runner', ({ it: specIt }) => {
      specIt('evaluates currency & spies cleanly', () => {
        spy(21);
        expectValue(spy).toHaveBeenCalledTimes(1);
        expectValue('$1,250.00').toEqualCurrency(1250);
      });
    });
    const runRes = await runner.runAll();
    assert.equal(runRes.passed, true);
    assert.equal(runRes.passedCount, 1);
    assert.equal(typeof $T.waterfall, 'function');

    const adv = analyzeComponentSourceForEdgeCases(
      `export const C = ({ items }) => <div>{items.map(i => <span key={i}>{i}</span>)}<button onClick={() => fetch('/x')}>$99.00</button></div>;`,
      'CartWidget'
    );
    assert.equal(adv.riskCount, 4);
  });

  it('TW-G4 & TW-G5: executes 1:N Hybrid Wire + Browser Canary (/dev/shm) and 3/3 Zero-Flake Live Chromium Sweeps on Solo Studio', async () => {
    // Verify Z3 <= 10% Canary core allocation rule
    const alloc32 = computeCanaryCoreAllocation(8, 32);
    assert.equal(alloc32.maxAllowedCanaryCores, 3);
    assert.equal(alloc32.canaryAllocatedCores, 3);

    const studio = new TestudoSoloStudioServer();
    const { baseUrl, port, sessionToken } = await studio.start(0);

    try {
      // Negative security test: DNS rebinding Host header rejected with 403 -9848
      const rebindStatus = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/',
            method: 'GET',
            headers: { Host: 'evil-dns-rebind.example.com' }
          },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          }
        );
        req.on('error', reject);
        req.end();
      });
      assert.equal(rebindStatus, 403);

      // Direct Hybrid Load + Canary API verification
      const hybResp = await fetch(`${baseUrl}/api/studio/run-hybrid-canary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: '{}'
      });
      assert.equal(hybResp.status, 200);
      const hybJson = await hybResp.json();
      assert.equal(hybJson.ok, true);
      assert.equal(hybJson.hybridReport.artificialCpuThrottleEnabled, false);
      assert.equal(hybJson.hybridReport.shmRamSpoolActive, true);
      assert.ok(hybJson.hybridReport.canaryAllocatedCores * 10 <= Math.max(10, hybJson.hybridReport.hostLogicalCores));
      assert.equal(hybJson.hybridReport.stages.length, 4);
      assert.ok(hybJson.hybridReport.stages[0].redactedScreengrabDataUri.startsWith('data:image/svg+xml;base64,'));

      // 3 / 3 Consecutive Zero-Flake Live Headless Chromium Sweeps (ARCH-27 Tier 1)
      if (chromeAvailable) {
        for (let pass = 1; pass <= 3; pass++) {
          const session = await TestudoCdp.launchHeadless({
            url: baseUrl,
            width: 1440,
            height: 900,
            unsafeNoSandbox: true
          });
          try {
            const enclaveReg = await session.enableSplitWorldEnclave(buildIsolatedProbeScript('deadbeef0102'));
            assert.ok(enclaveReg.scriptIdentifier);

            await session.goto(baseUrl);

            const sweepResult = await session.evaluate(async () => {
              const sel = document.getElementById('solo-stress-toggle');
              sel.value = 'true';

              document.getElementById('btn-run-waterfall').click();
              await new Promise((r) => setTimeout(r, 120));

              document.getElementById('btn-run-hybrid').click();
              for (let w = 0; w < 40; w++) {
                if (document.querySelectorAll('#solo-filmstrip .snap-card').length >= 4) break;
                await new Promise((r) => setTimeout(r, 50));
              }

              const overflowPx = Math.max(
                0,
                document.documentElement.scrollWidth - document.documentElement.clientWidth
              );
              const doctorSummary = document.getElementById('solo-doctor-summary').textContent || '';
              const stressText = document.getElementById('solo-stress-json').textContent || '';
              const snapCount = document.querySelectorAll('#solo-filmstrip .snap-card').length;

              return { overflowPx, doctorSummary, stressText, snapCount };
            });

            assert.equal(sweepResult.overflowPx, 0, `Pass ${pass} horizontal overflow`);
            assert.ok(sweepResult.doctorSummary.includes('Verdict:'), `Pass ${pass} waterfall doctor rendered`);
            assert.ok(sweepResult.stressText.includes('CARDINALITY_FPS_CLIFF_DETECTED'), `Pass ${pass} opt-in stress executed`);
            assert.equal(sweepResult.snapCount, 4, `Pass ${pass} hybrid screengrab filmstrip cards`);
          } finally {
            await session.close();
          }
        }
      }
    } finally {
      await studio.close();
    }
  });
});
