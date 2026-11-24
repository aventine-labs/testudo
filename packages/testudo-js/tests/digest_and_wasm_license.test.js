/**
 * @aventine/testudo v0.4.0 - Legacy Script Digester, WASM 4-Layer White-Label Gate,
 * Opt-In Prometheus Telemetry, and External Manifest Verification Suite
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  testudo,
  $T,
  digestScript,
  wasmConcierge,
  computeSvgHash256,
  constantTimeHexEqual,
  sha256HexBytes,
  mintWhiteLabelLicenseToken,
  telemetry,
  concierge
} from '../dist/index.js';

describe('Testudo v0.4.0 - Legacy Script Auto-Digester (Selenium, Playwright, Puppeteer, Cypress)', () => {
  it('digests Selenium WebDriver (Java) scripts and upgrades monetary assertions to fail-closed assertCurrency', () => {
    const seleniumJava = `
      driver.findElement(By.id("spc-gcpromoinput")).sendKeys("VIP10");
      driver.findElement(By.cssSelector("#apply-promo-btn")).click();
      assertEquals("$427.11", driver.findElement(By.cssSelector("#sc-grand-total")).getText());
    `;
    const result = digestScript(seleniumJava, { workflowName: 'Selenium Checkout Migration' });

    assert.equal(result.detectedFramework, 'selenium');
    assert.equal(result.steps.length, 3);
    assert.equal(result.steps[0].selector, '#spc-gcpromoinput');
    assert.equal(result.steps[0].action, 'type');
    assert.equal(result.steps[0].value, 'VIP10');
    assert.equal(result.steps[1].selector, '#apply-promo-btn');
    assert.equal(result.steps[1].action, 'click');
    assert.equal(result.steps[2].selector, '#sc-grand-total');
    assert.equal(result.steps[2].action, 'assertCurrency');
    assert.equal(result.steps[2].value, '$427.11');
    assert.equal(result.steps[2].options.mode, 'stable');
    assert.equal(result.steps[2].options.stableMs, 250);
    assert.match(result.fluentCode, /assertCurrency\(["']\$427\.11["']/);
    assert.match(result.generatedCode, /assertCurrency\(["']\$427\.11["']/);
    assert.ok(result.upgradesApplied.length >= 2);
  });

  it('escapes single/double quotes, newlines, and JS injection payloads safely in digestScript fluentCode', () => {
    const hostileCypress = `cy.get('#note').type("hello'); globalThis.__DIGEST_INJECTED__ = true; //");`;
    const result = digestScript(hostileCypress, { workflowName: 'Quote"); globalThis.__WF__=1;//' });
    assert.equal(result.steps.length, 1);
    // Verify generated fluent lines are valid JavaScript expressions without breakout
    const body = result.fluentCode
      .split('\n')
      .filter((l) => !l.trim().startsWith('import '))
      .join('\n');
    // Parse syntax without executing side effects via AsyncFunction constructor
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const compiled = new AsyncFunction('$T', body);
    assert.equal(typeof compiled, 'function');
    assert.equal(globalThis.__DIGEST_INJECTED__, undefined);
  });

  it('digests Playwright scripts including getByTestId, selectOption, and basis-points assertions', () => {
    const playwrightScript = `
      await page.getByTestId('wf-venue').selectOption('CME');
      await page.locator('#wf-qty').fill('5');
      await page.locator('#wf-submit').click();
      await expect(page.locator('#spread-bps-cell')).toHaveText('45 bps');
    `;
    const result = $T.digest(playwrightScript, { workflowName: 'Playwright CME Flow' });

    assert.equal(result.detectedFramework, 'playwright');
    assert.equal(result.steps.length, 4);
    assert.equal(result.steps[0].selector, '[data-testid="wf-venue"]');
    assert.equal(result.steps[0].action, 'select');
    assert.equal(result.steps[0].value, 'CME');
    assert.equal(result.steps[1].selector, '#wf-qty');
    assert.equal(result.steps[1].action, 'type');
    assert.equal(result.steps[1].value, '5');
    assert.equal(result.steps[2].action, 'click');
    assert.equal(result.steps[3].action, 'assertBasisPoints');
    assert.equal(result.steps[3].value, '45 bps');
  });

  it('digests Puppeteer and Cypress scripts into unified Testudo WorkflowStep manifests', () => {
    const puppeteerScript = `
      await page.type('#search-box', 'Aventine Key');
      await page.click('#search-btn');
      const total = await page.$eval('#cart-total', el => el.textContent);
      expect(total).toBe('$219.00');
    `;
    const pupRes = digestScript(puppeteerScript);
    assert.equal(pupRes.detectedFramework, 'puppeteer');
    assert.equal(pupRes.steps.length, 3);
    assert.equal(pupRes.steps[0].action, 'type');
    assert.equal(pupRes.steps[1].action, 'click');
    assert.equal(pupRes.steps[2].action, 'assertCurrency');
    assert.equal(pupRes.steps[2].value, '$219.00');

    const cypressScript = `
      cy.get('#quantity').select('2');
      cy.get('#spc-gcpromoinput').type('VIP10');
      cy.get('#apply-promo-btn').click();
      cy.get('#sc-grand-total').should('have.text', '$427.11');
    `;
    const cyRes = digestScript(cypressScript);
    assert.equal(cyRes.detectedFramework, 'cypress');
    assert.equal(cyRes.steps.length, 4);
    assert.equal(cyRes.steps[0].action, 'select');
    assert.equal(cyRes.steps[3].action, 'assertCurrency');
  });
});

describe('Testudo v0.4.0 - WASM Companion Brains & 4-Layer Origin-Locked White-Label Gate', () => {
  it('initializes embedded WASM module and computes 3-tier vertical row staggering offsets', () => {
    assert.equal(wasmConcierge.isWasmLoaded(), true);

    const tier0 = wasmConcierge.computeRowStaggerOffsetPx(0, false);
    const tier1 = wasmConcierge.computeRowStaggerOffsetPx(1, false);
    const tier2 = wasmConcierge.computeRowStaggerOffsetPx(2, false);
    const nearTop = wasmConcierge.computeRowStaggerOffsetPx(1, true);

    assert.equal(tier0, -26);
    assert.equal(tier1, 26);
    assert.equal(tier2, -50);
    assert.equal(nearTop, -50);
  });

  it('enforces 4-layer White-Label gate: Community Free vs Valid Amazon Token vs Pirated Domain vs Swapped Icon vs Tampered DOM', () => {
    const amazonSvg = '<svg viewBox="0 0 28 28"><path id="amazon-smile" d="M4 18 Q14 24 24 18"/></svg>';
    const competitorSvg = '<svg viewBox="0 0 28 28"><rect width="28" height="28"/></svg>';

    // 1. Community Free Mode (no token)
    const freeRes = wasmConcierge.evaluateWhiteLabelGate({});
    assert.equal(freeRes.disposition, 'COMMUNITY_MODE_OK');
    assert.equal(freeRes.whiteLabelUnlocked, false);
    assert.equal(freeRes.attributionRequired, true);
    assert.equal(freeRes.forceSirTestudoMascot, true);

    // 2. Mint valid Amazon Enterprise White-Label token bound to *.amazon.com + amazonSvg hash
    const amazonToken = mintWhiteLabelLicenseToken({
      orgId: 'AMZN-ENT-001',
      orgName: 'Amazon.com Services LLC',
      allowedOrigins: ['amazon.com', '*.amazon.com'],
      customIconSha256: computeSvgHash256(amazonSvg),
      tier: 'ENTERPRISE_WHITELABEL',
      expEpoch: Math.floor(Date.now() / 1000) + 86400 * 365
    });

    const validAmazon = wasmConcierge.evaluateWhiteLabelGate({
      licenseToken: amazonToken,
      claimedOrigin: 'https://www.amazon.com',
      edgeAttestedOrigin: 'https://www.amazon.com',
      customIconSvg: amazonSvg
    });
    assert.equal(validAmazon.disposition, 'UNLOCK_WHITELABEL');
    assert.equal(validAmazon.whiteLabelUnlocked, true);
    assert.equal(validAmazon.attributionRequired, false);
    assert.equal(validAmazon.forceSirTestudoMascot, false);
    assert.equal(validAmazon.gateCode, 1);

    // 3. Pirated token copied onto unauthorized domain (evil-competitor.io)
    const piratedDomain = wasmConcierge.evaluateWhiteLabelGate({
      licenseToken: amazonToken,
      claimedOrigin: 'https://checkout.evil-competitor.io',
      edgeAttestedOrigin: 'https://checkout.evil-competitor.io',
      customIconSvg: amazonSvg
    });
    assert.match(piratedDomain.reason, /ORIGIN_MISMATCH/);
    assert.equal(piratedDomain.whiteLabelUnlocked, false);
    assert.equal(piratedDomain.attributionRequired, true);
    assert.equal(piratedDomain.forceSirTestudoMascot, true);

    // 4. Spoofed JS claimedOrigin vs Cloudflare Edge Origin
    const spoofedOrigin = wasmConcierge.evaluateWhiteLabelGate({
      licenseToken: amazonToken,
      claimedOrigin: 'https://www.amazon.com',
      edgeAttestedOrigin: 'https://spoofed-proxy.evil.io',
      customIconSvg: amazonSvg
    });
    assert.equal(spoofedOrigin.reason, 'ORIGIN_SPOOF_DETECTED');
    assert.equal(spoofedOrigin.whiteLabelUnlocked, false);

    // 4b. Unattested claimedOrigin alone (without edgeAttestedOrigin or window.location) must NOT unlock white-label
    const unattestedClaimOnly = wasmConcierge.evaluateWhiteLabelGate({
      licenseToken: amazonToken,
      claimedOrigin: 'https://www.amazon.com',
      customIconSvg: amazonSvg
    });
    assert.equal(unattestedClaimOnly.whiteLabelUnlocked, false);

    // 4c. expEpoch: 0 or expired token fails closed
    const zeroExpToken = mintWhiteLabelLicenseToken({
      orgId: 'AMZN-ENT-001',
      orgName: 'Amazon.com Services LLC',
      allowedOrigins: ['amazon.com', '*.amazon.com'],
      customIconSha256: computeSvgHash256(amazonSvg),
      tier: 'ENTERPRISE_WHITELABEL',
      expEpoch: 0
    });
    const zeroExpRes = wasmConcierge.evaluateWhiteLabelGate({
      licenseToken: zeroExpToken,
      edgeAttestedOrigin: 'https://www.amazon.com',
      customIconSvg: amazonSvg
    });
    assert.equal(zeroExpRes.reason, 'LICENSE_EXPIRED');
    assert.equal(zeroExpRes.whiteLabelUnlocked, false);

    // 5. Copied Amazon token with swapped custom SVG icon
    const piratedIcon = wasmConcierge.evaluateWhiteLabelGate({
      licenseToken: amazonToken,
      claimedOrigin: 'https://www.amazon.com',
      edgeAttestedOrigin: 'https://www.amazon.com',
      customIconSvg: competitorSvg
    });
    assert.match(piratedIcon.reason, /ICON_HASH_MISMATCH/);
    assert.equal(piratedIcon.whiteLabelUnlocked, false);
    assert.equal(piratedIcon.attributionRequired, true);

    // 6. DOM Tamper: hiding Sir Testudo mascot in Community mode halts WASM gate with code 0 (HALT_TAMPER_DETECTED)
    const tamperedDom = wasmConcierge.evaluateWhiteLabelGate({
      mascotDomVisible: false
    });
    assert.equal(tamperedDom.disposition, 'HALT_TAMPER_DETECTED');
    assert.equal(tamperedDom.gateCode, 0);
    assert.equal(tamperedDom.whiteLabelUnlocked, false);

    // 7. Constant-time hex equality & FIPS 180-4 SHA-256 vector check
    assert.equal(constantTimeHexEqual('aabbcc', 'AABBCC'), true);
    assert.equal(constantTimeHexEqual('aabbcc', 'aabbcd'), false);
    assert.equal(constantTimeHexEqual('aabbcc', 'aabb'), false);
    const abcSha = sha256HexBytes(new TextEncoder().encode('abc'));
    assert.equal(abcSha, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('requires SHA-256 integrity pinning by default in loadRemoteWasm()', async () => {
    await assert.rejects(
      async () => wasmConcierge.loadRemoteWasm('https://cdn.example.invalid/testudo.wasm'),
      /requires expectedSha256Hex digest pinning/
    );
    await assert.rejects(
      async () =>
        wasmConcierge.loadRemoteWasm('https://cdn.example.invalid/testudo.wasm', {
          expectedSha256Hex: 'invalid-short-digest'
        }),
      /64-character lowercase hex SHA-256 digest/
    );
  });
});

describe('Testudo v0.4.0 - Opt-In Prometheus Telemetry & External Manifest Loader', () => {
  it('keeps telemetry strictly disabled by default, caps ring buffer, escapes CR/LF labels, and deduplicates Prometheus series', () => {
    telemetry.reset();
    telemetry.configure({ enabled: false });
    assert.equal(telemetry.isEnabled(), false);

    // Recording while disabled must be a no-op
    telemetry.recordStepSample({
      workflowName: 'Ignored Run',
      stepNumber: 1,
      stepTitle: 'NoOp',
      selector: '#noop',
      action: 'click',
      status: 'passed',
      durationUs: 250,
      instabilityCount: 0,
      observedStableMs: 0,
      pollSamples: 1
    });
    assert.equal(telemetry.getSamples().length, 0);

    // Enable with bounded ring buffer maxSamples: 3
    telemetry.configure({ enabled: true, maxSamples: 3 });
    for (let i = 0; i < 5; i++) {
      telemetry.recordStepSample({
        workflowName: 'Amazon Checkout\r\nAudit',
        stepNumber: 4,
        stepTitle: 'Verify Grand Total',
        selector: '#sc-grand-total',
        action: 'assertCurrency',
        status: 'failed',
        durationUs: 1000 + i * 100,
        instabilityCount: 2,
        observedStableMs: 150,
        pollSamples: 4,
        financialDelta: 0.03
      });
    }
    assert.equal(telemetry.getSamples().length, 3, 'Ring buffer must evict oldest samples beyond maxSamples');

    telemetry.recordWorkflowRun('Amazon Checkout Audit', 'failed');

    const promText = telemetry.toPrometheusText();
    // Ensure CR/LF inside label value cannot inject raw metric lines
    assert.equal(promText.includes('Amazon Checkout\r\nAudit'), false);
    assert.ok(promText.includes('Amazon Checkout\\r\\nAudit'));
    // Ensure duplicate series for step 4 were aggregated into a single metric line per metric family
    const durationLines = promText
      .split('\n')
      .filter((l) => l.startsWith('testudo_step_duration_microseconds{'));
    assert.equal(durationLines.length, 1, 'Duplicate step label sets must be deduplicated in Prometheus exposition');
    assert.match(promText, /testudo_dom_instability_flickers_total\{workflow="Amazon Checkout\\r\\nAudit",step="4",selector="#sc-grand-total",action="assertCurrency",status="failed"\} 6/);
    assert.match(promText, /testudo_workflow_runs_total\{scenario="testudo-browser-suite",workflow="Amazon Checkout Audit",status="failed"\} 1/);

    telemetry.configure({ enabled: false, maxSamples: 4096 });
  });

  it('resolves zero-touch element explanations from external JSON manifest via concierge.loadManifest()', () => {
    concierge.loadManifest({
      name: 'Amazon Storefront Overlay',
      entries: [
        {
          selector: '#add-to-cart-button',
          title: 'Primary Add to Cart Control',
          help: 'Dispatches cart mutation and verifies order summary ledger.',
          quip: 'Ready to lock in that order?'
        }
      ]
    });

    const mockUnmodifiedButton = {
      id: 'add-to-cart-button',
      tagName: 'BUTTON',
      innerText: 'Add to Cart',
      getAttribute: (k) => (k === 'id' ? 'add-to-cart-button' : null)
    };

    const expl = testudo.concierge.explainElement(mockUnmodifiedButton);
    assert.equal(expl.isDocumented, true);
    assert.equal(expl.title, 'Primary Add to Cart Control');
    assert.equal(expl.description, 'Dispatches cart mutation and verifies order summary ledger.');
    assert.equal(expl.quip, 'Ready to lock in that order?');

    concierge.clearManifest();
  });
});
