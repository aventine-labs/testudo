import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  $T,
  TestudoWireInterceptor,
  buildIsolatedProbeScript,
  resolveDeepElement,
  inspectElementXray
} from '../dist/index.js';
import {
  TestudoCdp,
  TestudoAssistiveBridge
} from '../dist/adapters/cdp.js';

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

describe('AL-DEV-482 (SPEC-TESTUDO-DEEP-SPIDER-55): Real Chrome 149 4-Test Suite, Fiber X-Ray & MV3 Debugger Bridge', () => {
  it('Executes all 4 ChatGPT privilege tests + Fiber X-Ray in real Headless Chromium 149 and passes Native Aegis/C++20 Independent Oracle + M1..M4 Mutants', async (t) => {
    // Origin B: Cross-Origin OOPIF Server on 127.0.0.1
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
        res.end(JSON.stringify({ ok: true, vaultEpoch: 1289 }));
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
<head><title>Sovereign Institutional Desk</title></head>
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
    // 1. Open Shadow DOM widget
    const openHost = document.getElementById('open-host');
    const openSr = openHost.attachShadow({ mode: 'open' });
    openSr.innerHTML = '<button class="open-ping" onclick="window.__openShadowClicked = true">Open Ping</button>';

    // 2. Genuinely Closed Shadow DOM Vault (shadowRoot === null to page scripts!)
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

    // 3. Strict Banking Listener: REJECTS untrusted JS events!
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

    // 4. Attach realistic React 18 Fiber + Vue 3 component state onto #trade-ticket-input for X-Ray test
    const ticketEl = document.getElementById('trade-ticket-input');
    const parentFiber = {
      type: function InstitutionalOrderDesk() {},
      memoizedProps: { desk: 'Morgan-Institutional', region: 'US-NY' },
      return: null
    };
    ticketEl['__reactFiber$xyz987'] = {
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
    const bundlePath = path.join(os.tmpdir(), `testudo_deep_spider_${process.pid}_${Date.now()}.json`);
    try {
      try {
        session = await TestudoCdp.launchHeadless({
          url: 'about:blank',
          unsafeNoSandbox: true
        });
      } catch (err) {
        if (err && String(err.message || err).includes('Chromium')) {
          t.skip('No local Chromium executable found on runner');
          return;
        }
        throw err;
      }

      await session.enableSplitWorldEnclave(buildIsolatedProbeScript('a1b2c3d4e5f60718'));
      await session.enableLiveWireCapture();

      const interceptor = new TestudoWireInterceptor();
      interceptor.addRule({
        urlPattern: '/api/rate-limited-endpoint',
        method: 'GET',
        status: 429,
        body: '{"error":"RATE_LIMITED_OUT_OF_PROCESS"}',
        fault: 'HTTP_429_RATE_LIMIT'
      });
      await session.enableWireInterception(interceptor);

      await session.goto(`http://localhost:${rootSrv.port}/`);

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
      assert.equal(wireCheckInPage.status429, 429, 'CDP Fetch.requestPaused must mock 429 out-of-process');
      assert.equal(wireCheckInPage.fetchIsNative, true, 'window.fetch must remain 100% [native code]');

      // Open Shadow DOM >>> combinator check via $T
      await session.click('#open-host >>> button.open-ping');
      const openClicked = await session.evaluate(() => Boolean(window.__openShadowClicked));
      assert.equal(openClicked, true);

      // TEST 1: Closed Shadow DOM (prove M2: shadowRoot === null in MAIN world, then pierce!)
      const mainWorldShadowWasNull = await session.evaluate(
        () => document.getElementById('closed-host').shadowRoot === null
      );
      assert.equal(mainWorldShadowWasNull, true);

      const piercedPin = await session.pierceResolve('#closed-host >>> input.vault-pin');
      await session.pierceType('#closed-host >>> input.vault-pin', '7391');
      await session.pierceClick('#closed-host >>> button.vault-unlock', { trusted: true });
      const vaultStatusAfterPierce = await session.textContent('#closed-vault-status');
      assert.equal(vaultStatusAfterPierce, 'UNLOCKED:7391');

      // Ensure failed closed-shadow lookup fails closed cleanly
      await assert.rejects(
        () => session.pierceResolve('#closed-host >>> button.non-existent-control'),
        /not found/i
      );

      // TEST 2: Cross-Origin OOPIF (prove M3: SOP blocks MAIN world contentDocument, then execute in OOPIF!)
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

      // TEST 3: Trusted Interactions (prove M1: untrusted click rejected, then trusted:true + WebAuthn succeed!)
      await session.click('#strict-trusted-btn'); // default untrusted DOM click -> rejected!
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

      // Virtual CTAP2/FIDO2 Hardware Passkey Ceremony
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
      assert.ok(credIdLen >= 16, `Expected WebAuthn rawId >= 16 bytes, got ${credIdLen}`);
      assert.equal(storedCreds.length, 1);
      await session.removeVirtualAuthenticator(authId);

      // TEST 4: Browser Internals & Live Wire Report
      await new Promise((r) => setTimeout(r, 60));
      const wireReport = await session.getLiveWireReport();
      assert.equal(wireReport.nativeIntrinsicsUntouched, true);
      const allCookies = wireReport.capturedRequests.flatMap((r) => r.cookiesObserved);

      // GAP 5: Full-Stack Fiber + Frame X-Ray
      const xrayReport = await session.xray('#trade-ticket-input');
      assert.equal(xrayReport.found, true);
      assert.equal(xrayReport.components[0].name, 'TradeTicketInput');
      assert.equal(xrayReport.components[0].sanitizedProps.apiToken, '[REDACTED_PILLAR1]');
      assert.ok(xrayReport.privilegedFrameAncestry.some((f) => f.isCrossOriginOopif));

      // Also verify closed-shadow X-Ray stitches closedShadowAncestry
      const closedXray = await session.xray('#closed-host >>> button.vault-unlock');
      assert.equal(closedXray.found, true);
      assert.equal(closedXray.closedShadowAncestry[0].mode, 'closed');

      const evidenceBundle = {
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
        test5XrayReport: xrayReport
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
          ['--mode', 'cdp', '--self-test-mutants', '--verify', bundlePath],
          { encoding: 'utf8' }
        );
        const parsedOracle = JSON.parse(oracleStdout.trim());
        assert.equal(parsedOracle.ok, true, `Native Aegis/C++20 oracle failed: ${oracleStdout}`);
        assert.equal(parsedOracle.verdict, 'ORACLE_VERIFIED_ALL_INVARIANTS_CLEAN');
      }
    } finally {
      if (session) await session.close().catch(() => {});
      await new Promise((r) => rootSrv.server.close(r));
      await new Promise((r) => childSrv.server.close(r));
      if (fs.existsSync(bundlePath)) fs.unlinkSync(bundlePath);
    }
  });

  it('MV3 Extension background.js + TestudoAssistiveBridge supports ATTACH_DEBUGGER, SEND_CDP_COMMAND (autoDetach), and disconnect cleanup', async () => {
    const bridge = new TestudoAssistiveBridge({ port: 0 });
    const started = await bridge.start();
    const token = bridge.getAuthToken();

    const debuggerCalls = [];
    const bgSource = fs.readFileSync(path.resolve(__dirname, '../extension/background.js'), 'utf8');

    // Minimal RFC6455 WebSocket shim setting Origin: chrome-extension://... so bridge origin shield passes
    const cryptoMod = await import('node:crypto');
    class MockExtWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      constructor(wsUrl) {
        this.readyState = 0;
        this.CONNECTING = 0;
        this.OPEN = 1;
        this._sock = null;
        const u = new URL(wsUrl);
        const key = cryptoMod.randomBytes(16).toString('base64');
        const req = http.request({
          hostname: u.hostname,
          port: Number(u.port),
          path: u.pathname + u.search,
          method: 'GET',
          headers: {
            Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
            Connection: 'Upgrade',
            Upgrade: 'websocket',
            'Sec-WebSocket-Key': key,
            'Sec-WebSocket-Version': '13'
          }
        });
        req.on('upgrade', (_res, socket) => {
          this._sock = socket;
          this.readyState = 1;
          if (this.onopen) this.onopen();
          let rxBuf = Buffer.alloc(0);
          socket.on('data', (chunk) => {
            rxBuf = Buffer.concat([rxBuf, chunk]);
            while (rxBuf.length >= 2) {
              const opcode = rxBuf[0] & 0x0f;
              let len = rxBuf[1] & 0x7f;
              let off = 2;
              if (len === 126) {
                if (rxBuf.length < 4) return;
                len = rxBuf.readUInt16BE(2);
                off = 4;
              }
              if (rxBuf.length < off + len) return;
              if (opcode === 0x08) {
                socket.destroy();
                return;
              }
              const data = rxBuf.subarray(off, off + len).toString('utf8');
              rxBuf = rxBuf.subarray(off + len);
              if (this.onmessage) this.onmessage({ data });
            }
          });
          socket.on('end', () => {
            socket.destroy();
          });
          socket.on('close', () => {
            this.readyState = 3;
            if (this.onclose) this.onclose();
          });
        });
        req.on('error', () => {
          this.readyState = 3;
          if (this.onerror) this.onerror();
        });
        req.end();
      }
      send(text) {
        if (!this._sock) return;
        const data = Buffer.from(String(text), 'utf8');
        const len = data.length;
        const hdr = len < 126 ? 2 : 4;
        const frame = Buffer.allocUnsafe(hdr + 4 + len);
        frame[0] = 0x81;
        if (len < 126) frame[1] = 0x80 | len;
        else { frame[1] = 0x80 | 126; frame.writeUInt16BE(len, 2); }
        const mask = cryptoMod.randomBytes(4);
        mask.copy(frame, hdr);
        for (let i = 0; i < len; i++) frame[hdr + 4 + i] = data[i] ^ mask[i & 3];
        this._sock.write(frame);
      }
      close() {
        this.readyState = 3;
        if (this._sock) this._sock.destroy();
      }
    }

    const activeSockets = [];
    class TrackedExtWs extends MockExtWebSocket {
      constructor(url) {
        super(url);
        activeSockets.push(this);
      }
    }

    const unrefTimeout = (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t && typeof t.unref === 'function') t.unref();
      return t;
    };

    try {
      const sandbox = {
        WebSocket: TrackedExtWs,
        setTimeout: unrefTimeout,
        clearTimeout,
        Date,
        JSON,
        Number,
        String,
        Boolean,
        Array,
        Set,
        encodeURIComponent,
        window: {},
        chrome: {
          storage: {
            local: {
              get: async () => ({ bridgePort: started.port, bridgeToken: token })
            }
          },
          tabs: {
            query: async () => [{ id: 77, windowId: 1, title: 'Live Tab', url: 'https://example.com', active: true, status: 'complete' }],
            get: async (id) => ({ id, windowId: 1, title: 'Live Tab', url: 'https://example.com', status: 'complete' }),
            remove: async (id) => { debuggerCalls.push(['tab.remove', id]); },
            onRemoved: { addListener: () => {} },
            onUpdated: { addListener: () => {}, removeListener: () => {} }
          },
          scripting: {
            executeScript: async () => [{ result: true }]
          },
          debugger: {
            attach: async (target, ver) => { debuggerCalls.push(['attach', target.tabId, ver]); },
            sendCommand: async (target, method, params) => {
              debuggerCalls.push(['sendCommand', target.tabId, method, params]);
              return { node: { backendNodeId: 42, shadowRoots: [{ shadowRootType: 'closed' }] } };
            },
            detach: async (target) => { debuggerCalls.push(['detach', target.tabId]); },
            onDetach: { addListener: () => {} }
          },
          runtime: { onMessage: { addListener: () => {} } },
          alarms: { create: () => {}, onAlarm: { addListener: () => {} } }
        }
      };

      vm.runInNewContext(bgSource, sandbox);
      await bridge.waitForExtension(3000);

      // 1. One-shot autoDetach CDP command
      const cdpRes = await bridge.sendCdp(77, 'DOM.describeNode', { depth: 2, pierce: true }, { autoDetach: true });
      assert.equal(cdpRes.node.backendNodeId, 42);
      assert.deepEqual(debuggerCalls.slice(0, 3), [
        ['attach', 77, '1.3'],
        ['sendCommand', 77, 'DOM.describeNode', { depth: 2, pierce: true }],
        ['detach', 77]
      ]);

      // 2. Persistent attach -> command -> explicit detach
      debuggerCalls.length = 0;
      const att = await bridge.attachDebugger(77);
      assert.equal(att.attached, true);
      await bridge.sendCdp(77, 'Performance.enable', {});
      const det = await bridge.detachDebugger(77);
      assert.equal(det.detached, true);
      assert.deepEqual(debuggerCalls, [
        ['attach', 77, '1.3'],
        ['sendCommand', 77, 'Performance.enable', {}],
        ['detach', 77]
      ]);

      // 3. Attach again, then close bridge -> verify ws.onclose automatically detaches debugger!
      debuggerCalls.length = 0;
      await bridge.attachDebugger(77);
      await bridge.close();
      for (let i = 0; i < 50 && debuggerCalls.length < 2; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.deepEqual(debuggerCalls, [
        ['attach', 77, '1.3'],
        ['detach', 77]
      ]);

      assert.equal(typeof $T.xray, 'function');
      assert.equal(typeof resolveDeepElement, 'function');
      assert.equal(typeof inspectElementXray, 'function');
    } finally {
      for (const s of activeSockets) s.close();
      await bridge.close().catch(() => {});
    }
  });
});
