/**
 * @aventine/testudo v0.3.0 - 11-Gate Adversarial Release Verification Suite
 * Verifies all 5 Workbench Upgrades and 5 Adversarial Amendments against live Chromium DOM,
 * ESM & IIFE bundles, mutating 10Hz streams, and an independent financial oracle.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { format, TestudoFormatError } from '../dist/format.js';
import { testudoMatchers } from '../dist/matchers.js';
import { createPlaywrightTestudo } from '../dist/adapters/playwright.js';
import { createTestudoInstance as createStandaloneFromSubpath } from '../dist/adapters/standalone.js';
import * as esmBundle from '../dist/testudo.esm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = path.resolve(__dirname, '..');

const candidatePaths = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/home/mark/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium'
].filter(Boolean);

const resolvedChromePath = candidatePaths.find((p) => fs.existsSync(p));

const WORKBENCH_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Testudo v0.3.0 Workbench Release Gate Fixture</title>
</head>
<body>
  <!-- Multi-Number Berkshire Card (Ambiguity Gate 4) -->
  <section id="berkshire-card" data-testid="berkshire-card">
    <div id="ambiguous-owner-card">
      OWNER EARNINGS
      $42.1 Billion
      Previous year: $38.7 Billion
      Growth: 8.8%
    </div>
    <div id="clean-owner-earnings">$42.1 Billion</div>
    <div id="clean-intrinsic-value">$912.45 Billion</div>
    <div id="spread-bps-cell">45 bps</div>
  </section>

  <!-- Interactive Workflow Target Form (Gates 7, 8, 9) -->
  <section id="workflow-form" data-testid="workflow-form">
    <select id="wf-venue" data-testid="wf-venue">
      <option value="CME">CME Globex</option>
      <option value="COINBASE">Coinbase L3</option>
    </select>
    <input id="wf-qty" data-testid="wf-qty" type="text" value="1" />
    <button id="wf-submit" data-testid="wf-submit" type="button">Execute Order</button>
    <div id="wf-submit-count">0</div>
    <div id="wf-status">IDLE</div>
    <div id="wf-notional">$0.00</div>
  </section>

  <!-- 10Hz Mutating Stream Target (Gate 10: eventually vs stable) -->
  <section id="stream-section">
    <div id="flicker-price">$99.00</div>
    <div id="settled-price">$240.00</div>
  </section>

  <!-- Independent Financial Oracle Ledger (Gate 11: Playwright & Standalone Parity) -->
  <section id="oracle-ledger">
    <div id="ora-rev">$1.25 Billion</div>
    <div id="ora-cogs">$450 Million</div>
    <div id="ora-opex">$320.5 Million</div>
    <div id="ora-tax">$99.5 Million</div>
    <div id="ora-net-exact">$380.00 Million</div>
    <div id="ora-net-drifted">$375.00 Million</div>
  </section>

  <script>
    let submitCount = 0;
    document.getElementById('wf-submit').addEventListener('click', () => {
      submitCount += 1;
      document.getElementById('wf-submit-count').textContent = String(submitCount);
      const qty = Number(document.getElementById('wf-qty').value || 0);
      const venue = document.getElementById('wf-venue').value;
      document.getElementById('wf-status').textContent = 'FILLED_' + venue;
      document.getElementById('wf-notional').textContent = '$' + (qty * 1250).toFixed(2);
    });
  </script>
</body>
</html>`;

function startGateServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      if (urlPath === '/' || urlPath === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(WORKBENCH_HTML);
        return;
      }
      const filePath = path.join(pkgRoot, urlPath);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        const mime = ext === '.js' ? 'application/javascript' : 'text/plain';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(fs.readFileSync(filePath));
        return;
      }
      res.writeHead(404);
      res.end('Not found');
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`
      });
    });
  });
}

test('TESTUDO-05 v0.3.0 Release Gates 1-6: Bundles, Backward Compatibility, and Fail-Closed Financial & Basis-Point Parsing', async (t) => {
  // =========================================================================
  // Gate 1: testudo.esm.js works in ESM environments
  // =========================================================================
  await t.test('Gate 1: dist/testudo.esm.js exports $T, testudo, createTestudoInstance, format, calc, and createWorkflow', () => {
    assert.strictEqual(typeof esmBundle.$T, 'function');
    assert.strictEqual(typeof esmBundle.testudo, 'function');
    assert.strictEqual(typeof esmBundle.createTestudoInstance, 'function');
    assert.strictEqual(typeof esmBundle.format.parseMonetary, 'function');
    assert.strictEqual(typeof esmBundle.format.parseBasisPoints, 'function');
    assert.strictEqual(typeof esmBundle.calc, 'function');
    assert.strictEqual(typeof esmBundle.createWorkflow, 'function');
    assert.strictEqual(esmBundle.format.parse('$42.1 Billion'), 42.1e9);
  });

  // =========================================================================
  // Gate 3: Existing module consumers of dist/adapters/standalone.js continue working
  // =========================================================================
  await t.test('Gate 3: Backward compatibility - dist/adapters/standalone.js remains a valid ES module with createTestudoInstance', () => {
    assert.strictEqual(typeof createStandaloneFromSubpath, 'function');
    const inst = createStandaloneFromSubpath();
    assert.strictEqual(typeof inst, 'function');
    assert.strictEqual(typeof inst.format.parse, 'function');
    assert.strictEqual(typeof inst.workflow, 'function');
    assert.strictEqual(typeof inst.poll, 'function');
  });

  // =========================================================================
  // Gate 4: Ambiguous financial strings are rejected (never guessed)
  // =========================================================================
  await t.test('Gate 4: Ambiguous multi-number financial strings fail closed with AMBIGUOUS_NUMERIC_VALUE unless tokenIndex is explicit', () => {
    const multiNumberCard = `
      OWNER EARNINGS
      $42.1 Billion
      Previous year: $38.7 Billion
      Growth: 8.8%
    `;

    assert.throws(
      () => format.parse(multiNumberCard),
      (err) => {
        assert.ok(err instanceof TestudoFormatError);
        assert.strictEqual(err.code, 'AMBIGUOUS_NUMERIC_VALUE');
        assert.strictEqual(err.tokens.length, 3);
        return true;
      },
      'Multi-token string must throw AMBIGUOUS_NUMERIC_VALUE by default'
    );

    assert.throws(
      () => format.parse('$42.1B vs $38.7B (+8.8%)'),
      (err) => err instanceof TestudoFormatError && err.code === 'AMBIGUOUS_NUMERIC_VALUE'
    );

    // Explicit tokenIndex disambiguates deterministically
    assert.strictEqual(format.parse(multiNumberCard, { tokenIndex: 0 }), 42.1e9);
    assert.strictEqual(format.parse(multiNumberCard, { tokenIndex: 1 }), 38.7e9);
    assert.strictEqual(format.parse(multiNumberCard, { tokenIndex: 2 }), 8.8);

    // Unambiguous single-token magnitude suffixes scale accurately
    assert.strictEqual(format.parse('$42.1 Billion'), 42.1e9);
    assert.strictEqual(format.parse('$42.1B'), 42.1e9);
    assert.strictEqual(format.parse('($1.25 Million)'), -1.25e6);
    assert.strictEqual(format.parse('250K USD'), 250e3);
    assert.strictEqual(format.parse('$1.5 Trillion'), 1.5e12);
    assert.strictEqual(format.parse('1.25e6'), 1.25e6);
  });

  // =========================================================================
  // Gate 5: Invalid financial strings are rejected (never silently return 0)
  // =========================================================================
  await t.test('Gate 5: Invalid or empty financial strings fail closed with INVALID_NUMERIC_FORMAT', () => {
    const invalidInputs = ['', '   ', 'N/A', '---', 'Pending', '$12.34.56.78', '12,,345', '($100.00', '$100.00)'];
    for (const invalid of invalidInputs) {
      assert.throws(
        () => format.parse(invalid),
        (err) => {
          assert.ok(err instanceof TestudoFormatError, `Expected TestudoFormatError for "${invalid}"`);
          assert.strictEqual(err.code, 'INVALID_NUMERIC_FORMAT');
          return true;
        }
      );
    }
  });

  // =========================================================================
  // Gate 6: Basis points are handled as a separate typed unit
  // =========================================================================
  await t.test('Gate 6: Basis points are rejected by parseMonetary with UNIT_MISMATCH_BPS and parsed accurately by parseBasisPoints', async () => {
    assert.throws(
      () => format.parse('45 bps'),
      (err) => err instanceof TestudoFormatError && err.code === 'UNIT_MISMATCH_BPS'
    );
    assert.throws(
      () => format.parse('-12.5 bp'),
      (err) => err instanceof TestudoFormatError && err.code === 'UNIT_MISMATCH_BPS'
    );

    const bps1 = format.parseBasisPoints('45 bps');
    assert.strictEqual(bps1.bps, 45);
    assert.strictEqual(bps1.percent, 0.45);
    assert.strictEqual(bps1.decimal, 0.0045);
    assert.strictEqual(bps1.unit, 'bps');

    const bps2 = format.parseBasisPoints('-12.5 bp');
    assert.strictEqual(bps2.bps, -12.5);
    assert.strictEqual(bps2.percent, -0.125);
    assert.strictEqual(bps2.decimal, -0.00125);

    const bpsFromPct = format.parseBasisPoints('0.45%');
    assert.strictEqual(bpsFromPct.bps, 45);
    assert.strictEqual(bpsFromPct.percent, 0.45);
    assert.strictEqual(bpsFromPct.decimal, 0.0045);

    const matcherPass = await testudoMatchers.toEqualBasisPoints('45 bps', 45, { tolerance: 0.01 });
    assert.strictEqual(matcherPass.pass, true);

    const matcherPctPass = await testudoMatchers.toEqualBasisPoints('0.45%', '45 bps', { tolerance: 0.01 });
    assert.strictEqual(matcherPctPass.pass, true);
  });
});

test('TESTUDO-05 v0.3.0 Release Gates 2, 7, 8, 9, 10, 11: Live Chromium IIFE, Workflow Engine, Temporal Polling, and Oracle Parity', async (t) => {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    const rootPw = path.resolve(pkgRoot, '../../node_modules/playwright/index.js');
    playwright = await import(rootPw);
  }
  const pw = playwright.default || playwright;

  if (!pw || !resolvedChromePath) {
    assert.fail('Playwright and Chrome binary are required for TESTUDO-05 live browser release gates.');
  }

  const { server, baseUrl } = await startGateServer();
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath: resolvedChromePath
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'networkidle' });

    // =========================================================================
    // Gate 2: testudo.iife.js works in a plain browser page via <script src> / addScriptTag
    // =========================================================================
    await t.test('Gate 2: dist/testudo.iife.js loads cleanly via page.addScriptTag without a module loader and attaches window.$T', async () => {
      const iifePath = path.join(pkgRoot, 'dist/testudo.iife.js');
      const iifeContent = fs.readFileSync(iifePath, 'utf8');
      assert.strictEqual(/^\s*import\s+/m.test(iifeContent), false, 'IIFE bundle must not contain top-level import');
      assert.strictEqual(/^\s*export\s+/m.test(iifeContent), false, 'IIFE bundle must not contain top-level export');

      await page.addScriptTag({ url: `${baseUrl}/dist/testudo.iife.js` });

      const globals = await page.evaluate(async () => {
        const win = window;
        const ownerRes = await win.$T('#clean-owner-earnings').assertCurrency('$42.1 Billion');
        const bpsRes = await win.$T('#spread-bps-cell').assertBasisPoints(45);
        return {
          hasDollarT: typeof win.$T === 'function',
          hasTestudo: typeof win.testudo === 'function',
          hasWorkflow: typeof win.$T.workflow === 'function',
          hasPoll: typeof win.$T.poll === 'function',
          ownerActual: ownerRes.actual,
          bpsActual: bpsRes.actual
        };
      });

      assert.strictEqual(globals.hasDollarT, true);
      assert.strictEqual(globals.hasTestudo, true);
      assert.strictEqual(globals.hasWorkflow, true);
      assert.strictEqual(globals.hasPoll, true);
      assert.strictEqual(globals.ownerActual, 42.1e9);
      assert.strictEqual(globals.bpsActual, 45);
    });

    // =========================================================================
    // Gate 7: workflow.preview() does not mutate application state
    // =========================================================================
    await t.test('Gate 7: workflow.preview() renders non-intercepting numbered badges and does NOT mutate application state', async () => {
      const previewCheck = await page.evaluate(() => {
        const wf = window.$T.workflow('OrderExecutionDemo', [
          { title: 'Select Coinbase Venue', selector: '#wf-venue', action: 'select', value: 'COINBASE' },
          { title: 'Enter Order Quantity', selector: '#wf-qty', action: 'type', value: '4' },
          { title: 'Click Execute Order', selector: '#wf-submit', action: 'click' },
          { title: 'Verify Filled Status', selector: '#wf-status', action: 'assertText', value: 'FILLED_COINBASE' },
          { title: 'Verify Order Notional', selector: '#wf-notional', action: 'assertCurrency', value: '$5,000.00' }
        ]);

        const previewReport = wf.preview();
        const overlays = Array.from(document.querySelectorAll('[data-testudo-workflow-step]'));
        const pointerEventsStyles = overlays.map((el) => window.getComputedStyle(el).pointerEvents);

        return {
          previewStatus: previewReport.status,
          overlayCount: overlays.length,
          pointerEventsStyles,
          submitCountAfterPreview: Number(document.getElementById('wf-submit-count').textContent),
          venueAfterPreview: document.getElementById('wf-venue').value,
          qtyAfterPreview: document.getElementById('wf-qty').value,
          statusAfterPreview: document.getElementById('wf-status').textContent
        };
      });

      assert.strictEqual(previewCheck.previewStatus, 'previewed');
      assert.strictEqual(previewCheck.overlayCount, 5, 'Preview must render 5 numbered step overlays');
      assert.deepStrictEqual(
        previewCheck.pointerEventsStyles,
        ['none', 'none', 'none', 'none', 'none'],
        'All workflow preview overlays must have pointer-events: none'
      );
      assert.strictEqual(previewCheck.submitCountAfterPreview, 0, 'Preview must never click buttons');
      assert.strictEqual(previewCheck.venueAfterPreview, 'CME', 'Preview must never mutate select elements');
      assert.strictEqual(previewCheck.qtyAfterPreview, '1', 'Preview must never mutate input elements');
      assert.strictEqual(previewCheck.statusAfterPreview, 'IDLE', 'Application state must remain untouched during preview');
    });

    // =========================================================================
    // Gate 8: workflow.cancel() stops a running workflow cleanly
    // =========================================================================
    await t.test('Gate 8: workflow.cancel() halts a running workflow mid-flight before subsequent steps execute', async () => {
      const cancelResult = await page.evaluate(async () => {
        const wf = window.$T.workflow('CancellableWorkflow', [
          { title: 'Step 1 Select Venue', selector: '#wf-venue', action: 'select', value: 'COINBASE' },
          { title: 'Step 2 Type Quantity', selector: '#wf-qty', action: 'type', value: '10' },
          { title: 'Step 3 Submit Order', selector: '#wf-submit', action: 'click' }
        ]);

        // Schedule cancellation after 80ms while stepDelayMs is 200ms (between Step 1 and Step 2)
        setTimeout(() => wf.cancel('User pressed Emergency Stop'), 80);

        const report = await wf.run({ stepDelayMs: 200 });
        return {
          status: report.status,
          completedSteps: report.completedSteps,
          submitCount: Number(document.getElementById('wf-submit-count').textContent),
          stepStatuses: report.steps.map((s) => s.status)
        };
      });

      assert.strictEqual(cancelResult.status, 'cancelled', 'Workflow status must be cancelled');
      assert.strictEqual(cancelResult.submitCount, 0, 'Step 3 (Submit Order) must never execute after cancellation');
      assert.ok(cancelResult.completedSteps < 3, 'Workflow must stop before completing all steps');

      // Reset form state for Gate 9
      await page.evaluate(() => {
        document.getElementById('wf-venue').value = 'CME';
        document.getElementById('wf-qty').value = '1';
      });
    });

    // =========================================================================
    // Gate 9: Completed workflows cannot accidentally replay without reset({ confirmReplay: true })
    // =========================================================================
    await t.test('Gate 9: Completed workflow executes cleanly once, blocks accidental replay with WORKFLOW_REPLAY_BLOCKED, and allows replay only after reset({ confirmReplay: true })', async () => {
      const replayAudit = await page.evaluate(async () => {
        const wf = window.$T.workflow('GuardedOrderWorkflow', [
          { title: 'Select Coinbase Venue', selector: '#wf-venue', action: 'select', value: 'COINBASE' },
          { title: 'Enter Quantity 4', selector: '#wf-qty', action: 'type', value: '4' },
          { title: 'Click Execute Order', selector: '#wf-submit', action: 'click' },
          { title: 'Verify Filled Status', selector: '#wf-status', action: 'assertText', value: 'FILLED_COINBASE' },
          { title: 'Verify Notional $5,000.00', selector: '#wf-notional', action: 'assertCurrency', value: '$5,000.00' }
        ]);

        const firstRun = await wf.run({ stepDelayMs: 10 });
        const countAfterFirst = Number(document.getElementById('wf-submit-count').textContent);

        // Attempt accidental second run without reset
        let secondRunErrorCode = '';
        try {
          await wf.run({ stepDelayMs: 10 });
        } catch (err) {
          secondRunErrorCode = err.code || err.message;
        }
        const countAfterBlockedReplay = Number(document.getElementById('wf-submit-count').textContent);

        // Attempt reset without confirmReplay: true
        let unconfirmedResetError = '';
        try {
          wf.reset();
        } catch (err) {
          unconfirmedResetError = err.code || err.message;
        }

        // Explicit confirmed reset allows intentional replay
        wf.reset({ confirmReplay: true });
        const thirdRun = await wf.run({ stepDelayMs: 10 });
        const countAfterConfirmedReplay = Number(document.getElementById('wf-submit-count').textContent);

        return {
          firstStatus: firstRun.status,
          countAfterFirst,
          secondRunErrorCode,
          countAfterBlockedReplay,
          unconfirmedResetError,
          thirdStatus: thirdRun.status,
          countAfterConfirmedReplay
        };
      });

      assert.strictEqual(replayAudit.firstStatus, 'completed');
      assert.strictEqual(replayAudit.countAfterFirst, 1, 'First workflow run must submit exactly 1 order');
      assert.strictEqual(replayAudit.secondRunErrorCode, 'WORKFLOW_REPLAY_BLOCKED');
      assert.strictEqual(
        replayAudit.countAfterBlockedReplay,
        1,
        'Blocked replay must not submit a duplicate second order'
      );
      assert.strictEqual(replayAudit.unconfirmedResetError, 'WORKFLOW_REPLAY_BLOCKED');
      assert.strictEqual(replayAudit.thirdStatus, 'completed');
      assert.strictEqual(
        replayAudit.countAfterConfirmedReplay,
        2,
        'Confirmed reset({ confirmReplay: true }) allows intentional second execution'
      );
    });

    // =========================================================================
    // Gate 10: 'eventually' and 'stable' polling modes behave differently on 10Hz mutating streams
    // =========================================================================
    await t.test('Gate 10: Two-mode assertion polling distinguishes transient flicker (passes eventually, fails stable) from settled state (passes stable)', async () => {
      const pollingAudit = await page.evaluate(async () => {
        const flickerEl = document.getElementById('flicker-price');
        // Start a 10Hz (every 60ms) oscillating stream on #flicker-price: $99 -> $100 -> $105 -> $100 -> $108...
        const sequence = ['$99.00', '$100.00', '$105.00', '$102.00', '$100.00', '$107.00', '$109.00'];
        let idx = 0;
        const flickerTimer = setInterval(() => {
          idx = (idx + 1) % sequence.length;
          flickerEl.textContent = sequence[idx];
        }, 60);

        // 1. 'eventually' mode should PASS as soon as #flicker-price hits $100.00 once
        const eventuallyRes = await window.$T('#flicker-price').assertCurrency('$100.00', {
          mode: 'eventually',
          timeout: 600,
          interval: 25
        });

        // 2. 'stable' mode (stableMs: 250) should FAIL on #flicker-price because it never stays at $100.00 for 250ms
        let stableFailedOnFlicker = false;
        try {
          await window.$T('#flicker-price').assertCurrency('$100.00', {
            mode: 'stable',
            stableMs: 250,
            timeout: 500,
            interval: 30
          });
        } catch {
          stableFailedOnFlicker = true;
        }
        clearInterval(flickerTimer);

        // 3. Now test a stream on #settled-price that ticks for 120ms and then settles permanently at $250.00
        const settledEl = document.getElementById('settled-price');
        settledEl.textContent = '$240.00';
        setTimeout(() => {
          settledEl.textContent = '$245.00';
        }, 50);
        setTimeout(() => {
          settledEl.textContent = '$250.00';
        }, 100);

        const settledStableRes = await window.$T('#settled-price').assertCurrency('$250.00', {
          mode: 'stable',
          stableMs: 250,
          timeout: 1000,
          interval: 40
        });

        return {
          eventuallyPassed: eventuallyRes.pass,
          stableFailedOnFlicker,
          settledStablePassed: settledStableRes.pass,
          observedStableMs: settledStableRes.observedStableMs
        };
      });

      assert.strictEqual(pollingAudit.eventuallyPassed, true, 'eventually mode must pass when transient target value appears');
      assert.strictEqual(
        pollingAudit.stableFailedOnFlicker,
        true,
        'stable mode must fail when value flickers away before stableMs window completes'
      );
      assert.strictEqual(
        pollingAudit.settledStablePassed,
        true,
        'stable mode must pass once value settles and remains valid across stableMs window'
      );
      assert.ok(pollingAudit.observedStableMs >= 250, `Expected observedStableMs >= 250, got ${pollingAudit.observedStableMs}`);
    });

    // =========================================================================
    // Gate 11: Playwright & Standalone Calculation Parity Against Independent Oracle
    // =========================================================================
    await t.test('Gate 11: Playwright and Standalone $T.calc() produce identical results against independent financial oracle', async () => {
      // Independent Oracle Calculation (computed outside Testudo):
      // Revenue: $1.25 Billion (1,250,000,000)
      // COGS:    $450 Million  (  450,000,000)
      // OpEx:    $320.5 Million(  320,500,000)
      // Tax:     $99.5 Million (   99,500,000)
      // Exact Net Income = 1,250,000,000 - 450,000,000 - 320,500,000 - 99,500,000 = 380,000,000 ($380.00 Million)
      // Drifted Net Income cell (#ora-net-drifted) = 375,000,000 -> Delta = -5,000,000
      const ORACLE_EXPECTED_NET = 1250000000 - 450000000 - 320500000 - 99500000;
      assert.strictEqual(ORACLE_EXPECTED_NET, 380000000);

      const formula = '#ora-rev - #ora-cogs - #ora-opex - #ora-tax';
      const $T_pw = createPlaywrightTestudo(page);

      // 1. Evaluate passing formula against #ora-net-exact in both Standalone and Playwright
      const standalonePass = await page.evaluate(
        async (expr) => window.$T.calc(expr).toEqualCurrency('#ora-net-exact', { tolerance: 0.01 }),
        formula
      );
      const playwrightPass = await $T_pw.calc(formula).toEqualCurrency('#ora-net-exact', { tolerance: 0.01 });

      assert.strictEqual(standalonePass.pass, true);
      assert.strictEqual(playwrightPass.pass, true);
      assert.strictEqual(standalonePass.expected, ORACLE_EXPECTED_NET);
      assert.strictEqual(playwrightPass.expected, ORACLE_EXPECTED_NET);
      assert.strictEqual(standalonePass.actual, ORACLE_EXPECTED_NET);
      assert.strictEqual(playwrightPass.actual, ORACLE_EXPECTED_NET);
      assert.strictEqual(standalonePass.delta, 0);
      assert.strictEqual(playwrightPass.delta, 0);
      assert.deepStrictEqual(
        playwrightPass.evaluation.operands.map((o) => ({ selector: o.selector, value: o.value, label: o.label })),
        standalonePass.evaluation.operands.map((o) => ({ selector: o.selector, value: o.value, label: o.label }))
      );

      // 2. Evaluate failing formula against #ora-net-drifted ($375M vs $380M) in both Standalone and Playwright
      await $T_pw.cleanup();
      const standaloneFail = await page.evaluate(
        async (expr) => window.$T.calc(expr).toEqualCurrency('#ora-net-drifted', { tolerance: 0.01, autoHighlight: false }),
        formula
      );
      const playwrightFail = await $T_pw.calc(formula).toEqualCurrency('#ora-net-drifted', {
        tolerance: 0.01,
        autoHighlight: true
      });

      assert.strictEqual(standaloneFail.pass, false);
      assert.strictEqual(playwrightFail.pass, false);
      assert.strictEqual(standaloneFail.expected, ORACLE_EXPECTED_NET);
      assert.strictEqual(playwrightFail.expected, ORACLE_EXPECTED_NET);
      assert.strictEqual(standaloneFail.actual, 375000000);
      assert.strictEqual(playwrightFail.actual, 375000000);
      assert.strictEqual(standaloneFail.delta, -5000000);
      assert.strictEqual(playwrightFail.delta, -5000000);

      // Verify Playwright calc failure highlighted all 4 operands + attached Calculus Zoom Card in live DOM
      const zoomCardRendered = await page.evaluate(() => Boolean(document.querySelector('.testudo-diff-zoom')));
      assert.strictEqual(zoomCardRendered, true, 'Playwright calc failure must render Calculus Zoom Card in live DOM');
    });
  } finally {
    await browser.close();
    server.close();
  }
});
