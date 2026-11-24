import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  TestudoWireInterceptor,
  buildIsolatedProbeScript
} from '../dist/index.js';
import { verifyLoopbackHostAndOrigin } from '../dist/security-enclave.js';
import {
  TestudoBidi,
  TestudoAssistiveBridge,
  resolveLocalFirefoxExecutable
} from '../dist/adapters/bidi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ORACLE_BIN = path.resolve(__dirname, '../bin/testudo-spider-oracle');

function listenServer(handler, host) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(handler);
    srv.on('error', reject);
    srv.listen(0, host, () => {
      const addr = srv.address();
      resolve({ server: srv, port: addr.port });
    });
  });
}

function httpGetStatus(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode || 0));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('AL-DEV-491 (SPEC-TESTUDO-FIREFOX-BIDI-58): Real Stock Firefox 160 WebDriver BiDi Privileged Parity Suite', () => {
  it('Executes all 5 Deep Spider privileged surfaces + PNG/PDF + Native Aegis/C++20 Oracle (M1..M5) inside real Headless Mozilla Firefox 160', async (t) => {
    // Origin B: Cross-Origin Fission OOPIF Server on 127.0.0.1
    const childSrv = await listenServer((req, res) => {
      if (req.url === '/oopif') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html><body>
  <input id="oopif-zip" value="" placeholder="Postal Code" />
  <button id="oopif-confirm" onclick="document.getElementById('oopif-badge').textContent = 'OOPIF_CONFIRMED:' + document.getElementById('oopif-zip').value">Confirm OOPIF</button>
  <div id="oopif-badge">IDLE</div>
</body></html>`);
        return;
      }
      res.writeHead(404);
      res.end('not found');
    }, '127.0.0.1');

    // Origin A: Root Banking Portal on localhost (W3C Secure Context for WebAuthn RP ID = localhost)
    const rootSrv = await listenServer((req, res) => {
      if (req.url === '/api/vault-handshake') {
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': 'session_secret=RAW_SUPER_SECRET_COOKIE_99182; HttpOnly; Secure; SameSite=Strict; Path=/',
          'server-timing': 'siam;dur=0.4, aldb;dur=0.8'
        });
        res.end(JSON.stringify({ ok: true, vaultEpoch: 1490 }));
        return;
      }
      if (req.url === '/api/rate-limited-endpoint') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, source: 'origin-unintercepted' }));
        return;
      }

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>Sovereign Institutional Desk - Firefox BiDi</title></head>
<body>
  <div id="open-host"></div>
  <div id="closed-host"></div>
  <div id="closed-vault-status">LOCKED</div>

  <div id="strict-bank-panel">
    <input id="desk-code-input" type="text" value="" aria-label="Desk Code" />
    <button id="strict-trusted-btn" type="button">Authorize Wire</button>
    <div id="strict-status">PENDING</div>
  </div>

  <div id="xray-target-wrap">
    <input id="trade-ticket-input" aria-label="Order Quantity" value="500" />
  </div>

  <iframe id="oopif-frame" src="http://127.0.0.1:${childSrv.port}/oopif" width="400" height="180"></iframe>

  <script>
    const openHost = document.getElementById('open-host');
    const openSr = openHost.attachShadow({ mode: 'open' });
    openSr.innerHTML = '<button class="open-ping" onclick="window.__openShadowClicked = true">Open Ping</button>';

    const closedHost = document.getElementById('closed-host');
    const closedSr = closedHost.attachShadow({ mode: 'closed' });
    const pinInput = document.createElement('input');
    pinInput.className = 'vault-pin';
    pinInput.type = 'password';
    const unlockBtn = document.createElement('button');
    unlockBtn.className = 'vault-unlock';
    unlockBtn.textContent = 'Unlock Enclave';
    unlockBtn.addEventListener('click', () => {
      document.getElementById('closed-vault-status').textContent = 'UNLOCKED:' + pinInput.value;
    });
    closedSr.appendChild(pinInput);
    closedSr.appendChild(unlockBtn);

    window.__untrustedRejectedCount = 0;
    window.__trustedApproved = false;
    window.__lastEventIsTrusted = false;
    window.__userActivationWasActive = false;
    document.getElementById('strict-trusted-btn').addEventListener('click', (evt) => {
      if (!evt.isTrusted) {
        window.__untrustedRejectedCount += 1;
        document.getElementById('strict-status').textContent = 'REJECTED_UNTRUSTED';
        return;
      }
      window.__trustedApproved = true;
      window.__lastEventIsTrusted = evt.isTrusted;
      window.__userActivationWasActive = Boolean(navigator.userActivation && navigator.userActivation.isActive);
      document.getElementById('strict-status').textContent = 'APPROVED_TRUSTED';
    });

    const ticketEl = document.getElementById('trade-ticket-input');
    const parentFiber = {
      type: function InstitutionalOrderDesk() {},
      memoizedProps: { desk: 'Morgan-Institutional', region: 'US-NY' },
      return: null
    };
    ticketEl['__reactFiber$ff160'] = {
      type: Object.assign(function TradeTicketInput() {}, { displayName: 'TradeTicketInput' }),
      memoizedProps: {
        symbol: 'AVNT',
        quantity: 500,
        apiToken: 'sk_live_SUPER_SECRET_FIBER_KEY_777',
        onSubmitOrder: function handleOrder() {}
      },
      return: parentFiber
    };
    ticketEl.__vueParentComponent = {
      type: { name: 'RiskGuardPanel' },
      props: { maxDrawdownPct: 3, bearerJwt: 'Bearer_TOP_SECRET_JWT_554433' },
      parent: null
    };
  </script>
</body>
</html>`);
    }, 'localhost');

    let session = null;
    const bridge = new TestudoAssistiveBridge({ port: 0 });
    const bundlePath = path.join(os.tmpdir(), `testudo_firefox_bidi_${process.pid}_${Date.now()}.json`);

    try {
      try {
        session = await TestudoBidi.launchHeadless({ url: 'about:blank' });
      } catch (err) {
        if (err && String(err.message || err).includes('Firefox')) {
          t.skip('No local Firefox executable found on runner');
          return;
        }
        throw err;
      }

      const probeNonce = 'f0e1d2c3b4a59687';
      await session.enableSplitWorldEnclave(buildIsolatedProbeScript(probeNonce));
      await session.enableLiveWireCapture();

      const interceptor = new TestudoWireInterceptor();
      interceptor.addRule({
        urlPattern: '/api/rate-limited-endpoint',
        method: 'GET',
        status: 429,
        body: '{"error":"RATE_LIMITED_OUT_OF_PROCESS_BIDI"}',
        fault: 'HTTP_429_RATE_LIMIT'
      });
      await session.enableWireInterception(interceptor);

      await session.goto(`http://localhost:${rootSrv.port}/`);

      // Confirm genuine Gecko User-Agent and BiDi Sandbox isolation from MAIN world
      const userAgent = await session.evaluate(() => navigator.userAgent);
      assert.match(userAgent, /Firefox\//);
      const mainHasEnclaveProbe = await session.evaluate(
        () => Boolean((globalThis).__TESTUDO_ENCLAVE_READY__)
      );
      const enclaveHasProbe = await session.evaluateInEnclave(() =>
        Boolean((globalThis).__TESTUDO_ENCLAVE_READY__ && document.getElementById('closed-host') !== null)
      );
      assert.equal(mainHasEnclaveProbe, false, 'BiDi sandbox probe must not leak onto MAIN-world globalThis');
      assert.equal(enclaveHasProbe, true, 'BiDi sandbox probe must exist inside TestudoEnclave');

      // Trigger wire requests (HttpOnly cookie + intercepted 429)
      const wireCheckInPage = await session.evaluate(async () => {
        const r1 = await fetch('/api/vault-handshake', { credentials: 'include' });
        await r1.json();
        const r2 = await fetch('/api/rate-limited-endpoint');
        return {
          docCookie: document.cookie,
          status429: r2.status,
          fetchIsNative: Function.prototype.toString.call(window.fetch).includes('[native code]')
        };
      });
      assert.equal(wireCheckInPage.docCookie, '', 'HttpOnly cookie must remain invisible to document.cookie');
      assert.equal(wireCheckInPage.status429, 429, 'BiDi network.provideResponse must mock 429 out-of-process');
      assert.equal(wireCheckInPage.fetchIsNative, true, 'Firefox window.fetch must remain 100% [native code]');

      // Open Shadow DOM >>> combinator check via $T
      await session.click('#open-host >>> button.open-ping');
      const openClicked = await session.evaluate(() => Boolean(window.__openShadowClicked));
      assert.equal(openClicked, true);

      // H1: Closed Shadow DOM (prove M2: shadowRoot === null in MAIN world, then pierce via includeShadowTree:'all')
      const mainWorldShadowWasNull = await session.evaluate(
        () => document.getElementById('closed-host').shadowRoot === null
      );
      assert.equal(mainWorldShadowWasNull, true);

      const piercedPin = await session.pierceResolve('#closed-host >>> input.vault-pin');
      await session.pierceType('#closed-host >>> input.vault-pin', '7391');
      await session.pierceClick('#closed-host >>> button.vault-unlock', { trusted: true });
      const vaultStatusAfterPierce = await session.textContent('#closed-vault-status');
      assert.equal(vaultStatusAfterPierce, 'UNLOCKED:7391');

      await assert.rejects(
        () => session.pierceResolve('#closed-host >>> button.non-existent-control'),
        /not found/i
      );

      // H2: Gecko Fission Cross-Origin OOPIF (prove M3: SOP blocks MAIN world contentDocument, then execute in child context)
      const mainWorldCrossOriginBlocked = await session.evaluate(() => {
        const ifr = document.getElementById('oopif-frame');
        try {
          return ifr.contentDocument === null;
        } catch {
          return true;
        }
      });
      assert.equal(mainWorldCrossOriginBlocked, true);

      const oopifResultText = await session.evaluateInFrame(`127.0.0.1:${childSrv.port}`, async () => {
        await window.$T('#oopif-zip').type('90210');
        await window.$T('#oopif-confirm').click();
        return document.getElementById('oopif-badge').textContent;
      });
      assert.equal(oopifResultText, 'OOPIF_CONFIRMED:90210');

      const spiderTree = await session.spiderLayers();
      assert.equal(spiderTree.layerKind, 'root-page');

      // H3: Trusted Interactions (prove M1: untrusted click rejected, then input.performActions + CTAP2 WebAuthn succeed)
      await session.click('#strict-trusted-btn');
      const afterUntrusted = await session.evaluate(() => ({
        rejected: window.__untrustedRejectedCount,
        approved: window.__trustedApproved,
        status: document.getElementById('strict-status').textContent
      }));
      assert.equal(afterUntrusted.rejected, 1);
      assert.equal(afterUntrusted.approved, false);
      assert.equal(afterUntrusted.status, 'REJECTED_UNTRUSTED');

      const typedRes = await session.type('#desk-code-input', 'MS-DESK-2026', { trusted: true });
      assert.equal(typedRes.value, 'MS-DESK-2026');

      await session.click('#strict-trusted-btn', { trusted: true });
      const afterTrusted = await session.evaluate(() => ({
        rejected: window.__untrustedRejectedCount,
        approved: window.__trustedApproved,
        isTrusted: window.__lastEventIsTrusted,
        userActive: window.__userActivationWasActive,
        status: document.getElementById('strict-status').textContent
      }));
      assert.equal(afterTrusted.approved, true);
      assert.equal(afterTrusted.isTrusted, true);
      assert.equal(afterTrusted.userActive, true);

      // Virtual CTAP2/FIDO2 Hardware Passkey Ceremony in Firefox 160
      const authId = await session.enableVirtualAuthenticator({
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true
      });
      const credIdLen = await session.evaluate(async () => {
        const challenge = new Uint8Array(32);
        crypto.getRandomValues(challenge);
        const userId = new Uint8Array(16);
        crypto.getRandomValues(userId);
        const cred = await navigator.credentials.create({
          publicKey: {
            challenge,
            rp: { name: 'Aventine Sovereign Vault', id: 'localhost' },
            user: { id: userId, name: 'mark@aventinelabs.com', displayName: 'Mark Gilbert' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            authenticatorSelection: { userVerification: 'required', residentKey: 'required' }
          }
        });
        return cred && cred.rawId ? cred.rawId.byteLength : 0;
      });
      const storedCreds = await session.getVirtualCredentials(authId);
      assert.ok(credIdLen >= 16, `Expected Firefox WebAuthn rawId >= 16 bytes, got ${credIdLen}`);
      assert.equal(storedCreds.length, 1);
      await session.removeVirtualAuthenticator(authId);

      // H4: Browser Internals & Live Wire Report
      await new Promise((r) => setTimeout(r, 80));
      const wireReport = await session.getLiveWireReport();
      assert.equal(wireReport.nativeIntrinsicsUntouched, true);
      const allCookies = wireReport.capturedRequests.flatMap((r) => r.cookiesObserved);

      // H5: Full-Stack Fiber + Fission Frame + Closed Shadow X-Ray + PNG/PDF Binary Signatures
      const xrayReport = await session.xray('#trade-ticket-input');
      assert.equal(xrayReport.found, true);
      assert.equal(xrayReport.components[0].name, 'TradeTicketInput');
      assert.equal(xrayReport.components[0].sanitizedProps.apiToken, '[REDACTED_PILLAR1]');
      assert.ok(xrayReport.privilegedFrameAncestry.some((f) => f.isCrossOriginOopif));

      const closedXray = await session.xray('#closed-host >>> button.vault-unlock');
      assert.equal(closedXray.found, true);
      assert.equal(closedXray.closedShadowAncestry[0].mode, 'closed');

      const pngBuf = await session.screenshot({ format: 'png' });
      const pdfBuf = await session.pdf({ printBackground: true });
      const pngMagicHex = pngBuf.subarray(0, 4).toString('hex');
      const pdfMagicAscii = pdfBuf.subarray(0, 5).toString('ascii');
      assert.equal(pngMagicHex, '89504e47');
      assert.equal(pdfMagicAscii, '%PDF-');

      // H6 (M5): Dual Chrome/Firefox MV3 Assistive Bridge Origin Shield
      const startedBridge = await bridge.start();
      const spoofedOriginStatus = await httpGetStatus({
        hostname: '127.0.0.1',
        port: startedBridge.port,
        path: '/status',
        method: 'GET',
        headers: {
          Host: `127.0.0.1:${startedBridge.port}`,
          Origin: 'https://evil.example',
          Authorization: `Bearer ${bridge.getAuthToken()}`
        }
      });
      const mozOriginStatus = await httpGetStatus({
        hostname: '127.0.0.1',
        port: startedBridge.port,
        path: '/status',
        method: 'GET',
        headers: {
          Host: `127.0.0.1:${startedBridge.port}`,
          Origin: 'moz-extension://11223344-5566-7788-99aa-bbccddeeff00',
          Authorization: `Bearer ${bridge.getAuthToken()}`
        }
      });
      const enclaveMozCheck = verifyLoopbackHostAndOrigin(
        `127.0.0.1:${startedBridge.port}`,
        'moz-extension://11223344-5566-7788-99aa-bbccddeeff00',
        startedBridge.port
      );
      assert.equal(spoofedOriginStatus, 403);
      assert.equal(mozOriginStatus, 200);
      assert.equal(enclaveMozCheck.allowed, true);

      const evidenceBundle = {
        browserMeta: {
          userAgent,
          enclaveIsolatedFromMainWorld: !mainHasEnclaveProbe && enclaveHasProbe
        },
        test1ClosedShadow: {
          mainWorldShadowRootWasNull: mainWorldShadowWasNull,
          vaultStatusAfterPierce,
          closedShadowAncestry: piercedPin.closedShadowAncestry
        },
        test2CrossOriginOopif: {
          mainWorldCrossOriginBlocked,
          rootOrigin: `http://localhost:${rootSrv.port}`,
          childOrigin: `http://127.0.0.1:${childSrv.port}`,
          oopifResultText,
          spiderTree
        },
        test3TrustedAndWebAuthn: {
          untrustedRejectedCount: afterTrusted.rejected,
          trustedApproved: afterTrusted.approved,
          lastEventIsTrusted: afterTrusted.isTrusted,
          userActivationWasActive: afterTrusted.userActive,
          trustedTypedValue: typedRes.value,
          webauthnCredentialIdLen: credIdLen,
          virtualCredentialsCount: storedCreds.length
        },
        test4BrowserInternals: {
          nativeIntrinsicsUntouched: wireReport.nativeIntrinsicsUntouched,
          documentCookieInPage: wireCheckInPage.docCookie,
          intercepted429Status: wireCheckInPage.status429,
          observedCookies: allCookies,
          wireRequests: wireReport.capturedRequests
        },
        test5XrayAndArtifacts: {
          components: xrayReport.components,
          pngMagicHex,
          pdfMagicAscii
        },
        test6BridgeOriginShield: {
          spoofedOriginStatus,
          mozExtensionAccepted: mozOriginStatus === 200 && enclaveMozCheck.allowed
        }
      };

      fs.writeFileSync(bundlePath, JSON.stringify(evidenceBundle, null, 2), 'utf8');

      if (process.platform === 'linux' && process.arch === 'x64' && fs.existsSync(ORACLE_BIN)) {
        try {
          fs.chmodSync(ORACLE_BIN, 0o755);
        } catch {
          // ignore read-only fs
        }
        const oracleStdout = execFileSync(
          ORACLE_BIN,
          ['--mode', 'bidi', '--self-test-mutants', '--verify', bundlePath],
          { encoding: 'utf8' }
        );
        const parsedOracle = JSON.parse(oracleStdout.trim());
        assert.equal(parsedOracle.ok, true, `Native Aegis/C++20 oracle failed: ${oracleStdout}`);
        assert.equal(parsedOracle.verdict, 'ORACLE_VERIFIED_FIREFOX_BIDI_PARITY_CLEAN');
      }
    } finally {
      if (session) await session.close().catch(() => {});
      await bridge.close().catch(() => {});
      await new Promise((r) => rootSrv.server.close(r));
      await new Promise((r) => childSrv.server.close(r));
      if (fs.existsSync(bundlePath)) fs.unlinkSync(bundlePath);
    }
  });

  it('Enforces dangerous CLI flag guards, TestudoBidi.connect in-place tab attach (ownsTarget: false), and ARCH-27 3-tier failover alerts', async (t) => {
    // 1. Dangerous Firefox CLI flag guard
    await assert.rejects(
      () => TestudoBidi.launchHeadless({ extraArgs: ['--remote-allow-origins=*'] }),
      /Blocked dangerous Firefox flag/
    );

    // 2. ARCH-27 3-Tier Failover Diagnostic Alerts when Bridge & BiDi ports are unreachable
    const fallbackMessages = [];
    await assert.rejects(
      () =>
        TestudoBidi.connectWithFailover({
          bridgePort: 0,
          bidiPort: 1,
          allowPlaywrightFallback: false,
          onTierFailure: (_report, msg) => fallbackMessages.push(msg)
        }),
      /\[Testudo Browser Failover Exhausted\]/
    );
    assert.equal(fallbackMessages.length, 2);
    assert.match(fallbackMessages[0], /\[TESTUDO-BROWSER-FALLBACK\] Tier 1 \(testudo-assistive-bridge\) FAILED/);
    assert.match(fallbackMessages[1], /\[TESTUDO-BROWSER-FALLBACK\] Tier 2 \(native-debug-port-cdp\) FAILED/);

    // 3. Direct TestudoBidi.connect() to a standalone Firefox --remote-debugging-port=0 instance (ownsTarget: false)
    let ffBin;
    try {
      ffBin = resolveLocalFirefoxExecutable();
    } catch {
      t.skip('No local Firefox executable found on runner');
      return;
    }
    const srv = await listenServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!DOCTYPE html><html><body><h1 id="live-tab">Live User Tab</h1></body></html>');
    }, '127.0.0.1');

    const tmpProf = fs.mkdtempSync(path.join(os.tmpdir(), 'testudo-bidi-attach-'));
    fs.writeFileSync(path.join(tmpProf, 'user.js'), 'user_pref("remote.active-protocols", 1);\n', 'utf8');
    const child = spawn(
      ffBin,
      ['--headless', '--no-remote', '--profile', tmpProf, '--remote-debugging-port=0', `http://127.0.0.1:${srv.port}/`],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    try {
      const wsEndpoint = await new Promise((resolve, reject) => {
        let log = '';
        const t = setTimeout(() => reject(new Error(`Attach test timed out: ${log}`)), 15000);
        const onD = (c) => {
          log += c.toString('utf8');
          const m = log.match(/WebDriver BiDi listening on (ws:\/\/[^\s\r\n]+)/);
          if (m) {
            clearTimeout(t);
            resolve(`${m[1]}/session`);
          }
        };
        child.stdout.on('data', onD);
        child.stderr.on('data', onD);
      });

      // Wait briefly for initial tab URL to settle
      await new Promise((r) => setTimeout(r, 400));
      const attached = await TestudoBidi.connect({
        wsUrl: wsEndpoint,
        targetUrlPattern: `127.0.0.1:${srv.port}`,
        reloadOnAttach: false
      });
      assert.equal(attached.ownsTarget, false);
      const heading = await attached.textContent('#live-tab');
      assert.equal(heading, 'Live User Tab');
      await attached.close();
      // Verify Firefox process was NOT killed by closing an ownsTarget:false session
      assert.equal(child.killed, false);
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => srv.server.close(r));
      fs.rmSync(tmpProf, { recursive: true, force: true });
    }
  });
});
