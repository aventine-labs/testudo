import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  kinetic,
  POWER_USER_PRIME_SECONDS,
  type as testudoType,
  concierge,
  TestudoShadowWidget,
  sanitizeCustomSvgMarkup
} from '../dist/index.js';
import {
  TestudoAssistiveBridge,
  TestudoCdp,
  resolveLocalChromeExecutable
} from '../dist/adapters/cdp.js';
import { createServer as createDemoServer } from '../scripts/serve-test-sites.js';

describe('AL-DEV-266: Testudo-JS v0.5.0 Assistive Browser Bridge, Kinetic Engine & Native CDP', () => {
  it('Rule 13 Kinetic Think-Time Generator uses prime/odd seconds + jitter and never produces round 1000ms multiples', async () => {
    assert.deepEqual(
      Array.from(POWER_USER_PRIME_SECONDS),
      [5, 6, 8, 9, 13, 17, 19, 21, 23, 27, 29]
    );

    for (let i = 0; i < 500; i++) {
      const ms = kinetic.computeThinkTimeMs({ tier: i % 3 === 0 ? 'micro' : i % 3 === 1 ? 'review' : 'reading' });
      assert.notEqual(ms % 1000, 0, `Expected non-round millisecond duration, got ${ms}`);
      const subSecond = ms % 1000;
      assert.ok(subSecond >= 101 && subSecond <= 899, `Sub-second jitter ${subSecond} out of [101, 899] range`);
    }

    const fastPause = await kinetic.thinkPause({ tier: 'reading', fastRehearsal: true });
    assert.ok(fastPause.plannedMs >= 5101);
    assert.ok(fastPause.waitedMs < 200);
  });

  it('Rule 13 Kinetic Scroll executes non-monotonic double-take scroll pulses with upward backtracks', async () => {
    let seqIdx = 0;
    const seq = [0.5, 0.1, 0.5, 0.5, 0.5, 0.9, 0.5, 0.5, 0.2, 0.5, 0.5];
    const deterministicRng = () => {
      const val = seq[seqIdx % seq.length];
      seqIdx++;
      return val;
    };

    const result = await kinetic.scrollFeed({
      pulses: 4,
      backtrackProbability: 0.4,
      fastRehearsal: true,
      rng: deterministicRng
    });

    assert.equal(result.totalPulses, 4);
    assert.ok(result.backtrackCount >= 1, 'Expected at least 1 upward backtrack pulse');
    assert.ok(
      result.pulses.some((p) => p.didBacktrack && p.backtrackDeltaY < 0),
      'Expected negative backtrackDeltaY on double-take pulse'
    );
  });

  it('TestudoType supports contenteditable="true" rich-text editors alongside standard inputs', () => {
    const fakeEditable = {
      tagName: 'DIV',
      isContentEditable: true,
      innerText: 'Old draft',
      textContent: 'Old draft',
      getAttribute(attr) {
        if (attr === 'contenteditable') return 'true';
        if (attr === 'role') return 'textbox';
        return null;
      },
      focus() {},
      dispatchEvent() {
        return true;
      }
    };

    assert.equal(testudoType.isContentEditableElement(fakeEditable), true);
    testudoType.setNativeValue(fakeEditable, 'Engineered via Testudo-JS');
    assert.equal(fakeEditable.textContent, 'Engineered via Testudo-JS');
    assert.equal(fakeEditable.innerText, 'Engineered via Testudo-JS');
  });

  it('TestudoShadowWidget interactive Click-to-Workflow Recorder captures steps, escapes CSS attributes, and sanitizes custom SVG', () => {
    const widget = new TestudoShadowWidget({ initialOpen: false });
    widget.clearRecordedSteps();
    assert.equal(widget.getRecordedSteps().length, 0);

    const fakeInput = {
      id: 'editor-comment-box',
      tagName: 'DIV',
      isContentEditable: true,
      innerText: 'Zero-Allocation SPSC Rings',
      getAttribute(attr) {
        if (attr === 'contenteditable') return 'true';
        if (attr === 'aria-label') return 'Add a comment';
        return null;
      }
    };
    const fakeButton = {
      id: 'submit-comment-btn',
      tagName: 'BUTTON',
      innerText: 'Post Comment',
      getAttribute(attr) {
        if (attr === 'data-testid') return 'post-"quoted"-submit';
        return null;
      }
    };

    const step1 = widget.recordStepFromElement(fakeInput);
    const step2 = widget.recordStepFromElement(fakeButton);

    assert.equal(step1.action, 'type');
    assert.equal(step1.selector, '#editor-comment-box');
    assert.equal(step1.value, 'Zero-Allocation SPSC Rings');
    assert.equal(step2.action, 'click');
    assert.equal(step2.selector, '[data-testid="post-\\"quoted\\"-submit"]');

    const manifest = JSON.parse(widget.exportRecordedManifest('linkedin-assist'));
    assert.equal(manifest.name, 'linkedin-assist');
    assert.equal(manifest.steps.length, 2);

    // SVG Sanitizer checks
    assert.equal(sanitizeCustomSvgMarkup('<svg onload="alert(1)"><path d="M0 0"/></svg>'), '');
    assert.equal(sanitizeCustomSvgMarkup('<svg><script>alert(1)</script></svg>'), '');
    assert.equal(sanitizeCustomSvgMarkup('<svg><foreignObject><div>xss</div></foreignObject></svg>'), '');
    assert.equal(sanitizeCustomSvgMarkup('<svg><use href="javascript:alert(1)"/></svg>'), '');
    assert.ok(
      sanitizeCustomSvgMarkup('<svg viewBox="0 0 24 24"><path d="M2 2 L22 22" stroke="#38bdf8"/></svg>').startsWith(
        '<svg'
      )
    );
  });

  it('TestudoAssistiveBridge enforces CSPRNG bearer auth, Host/Origin validation, and event allowlist while coordinating WebSocket RPC', async () => {
    const bridge = new TestudoAssistiveBridge({ port: 0 });
    const started = await bridge.start();
    assert.equal(started.mode, 'server');
    assert.ok(started.port > 0);
    assert.ok(bridge.getAuthToken().length >= 32);

    // 1. Unauthenticated /rpc request must fail closed with 401
    const unauthStatus = await new Promise((resolve, reject) => {
      const r = http.request(
        { hostname: '127.0.0.1', port: started.port, path: '/rpc', method: 'POST' },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        }
      );
      r.on('error', reject);
      r.end(JSON.stringify({ command: 'LIST_TABS' }));
    });
    assert.equal(unauthStatus, 401);

    // 2. Host: 0.0.0.0 DNS-rebinding probe must fail closed with 403
    const badHostStatus = await new Promise((resolve, reject) => {
      const r = http.request(
        {
          hostname: '127.0.0.1',
          port: started.port,
          path: '/status',
          method: 'GET',
          headers: {
            Host: `evil.rebind.invalid:${started.port}`,
            Authorization: `Bearer ${bridge.getAuthToken()}`
          }
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        }
      );
      r.on('error', reject);
      r.end();
    });
    assert.equal(badHostStatus, 403);

    // 3. Untrusted browser Origin header must fail closed with 403
    const badOriginStatus = await new Promise((resolve, reject) => {
      const r = http.request(
        {
          hostname: '127.0.0.1',
          port: started.port,
          path: '/status',
          method: 'GET',
          headers: {
            Origin: 'https://evil.example',
            Authorization: `Bearer ${bridge.getAuthToken()}`
          }
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        }
      );
      r.on('error', reject);
      r.end();
    });
    assert.equal(badOriginStatus, 403);

    // 4. Unauthenticated WebSocket upgrade must be rejected (401)
    const unauthWsStatus = await new Promise((resolve, reject) => {
      const r = http.request({
        hostname: '127.0.0.1',
        port: started.port,
        path: '/ws',
        method: 'GET',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
          'Sec-WebSocket-Version': '13'
        }
      });
      r.on('response', (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      r.on('error', reject);
      r.end();
    });
    assert.equal(unauthWsStatus, 401);

    // 5. Connect authenticated simulated Chrome Extension WebSocket client
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      hostname: '127.0.0.1',
      port: started.port,
      path: `/ws?token=${encodeURIComponent(bridge.getAuthToken())}`,
      method: 'GET',
      headers: {
        Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13'
      }
    });

    const receivedEvents = [];
    bridge.on('human-assist-required', (ev) => receivedEvents.push({ type: 'required', ev }));
    bridge.on('human-assist-resolved', (ev) => receivedEvents.push({ type: 'resolved', ev }));

    const clientSocket = await new Promise((resolve, reject) => {
      req.on('upgrade', (_res, socket) => resolve(socket));
      req.on('error', reject);
      req.end();
    });

    function sendMaskedClientText(socket, text) {
      const data = Buffer.from(text, 'utf8');
      const len = data.length;
      let headerLen = 2;
      if (len >= 126 && len < 65536) headerLen = 4;
      else if (len >= 65536) headerLen = 10;
      const frame = Buffer.allocUnsafe(headerLen + 4 + len);
      frame[0] = 0x81;
      if (len < 126) frame[1] = 0x80 | len;
      else if (len < 65536) {
        frame[1] = 0x80 | 126;
        frame.writeUInt16BE(len, 2);
      } else {
        frame[1] = 0x80 | 127;
        frame.writeBigUInt64BE(BigInt(len), 2);
      }
      const mask = crypto.randomBytes(4);
      mask.copy(frame, headerLen);
      for (let i = 0; i < len; i++) {
        frame[headerLen + 4 + i] = data[i] ^ mask[i & 3];
      }
      socket.write(frame);
    }

    let rxBuf = Buffer.alloc(0);
    clientSocket.on('data', (chunk) => {
      rxBuf = Buffer.concat([rxBuf, chunk]);
      while (rxBuf.length >= 2) {
        let len = rxBuf[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (rxBuf.length < 4) return;
          len = rxBuf.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (rxBuf.length < 10) return;
          len = Number(rxBuf.readBigUInt64BE(2));
          offset = 10;
        }
        if (rxBuf.length < offset + len) return;
        const payload = rxBuf.subarray(offset, offset + len).toString('utf8');
        rxBuf = rxBuf.subarray(offset + len);

        const msg = JSON.parse(payload);
        if (msg.command === 'LIST_TABS') {
          sendMaskedClientText(
            clientSocket,
            JSON.stringify({
              id: msg.id,
              result: [
                { id: 42, windowId: 1, title: 'LinkedIn Feed', url: 'https://www.linkedin.com/feed/', active: true }
              ]
            })
          );
        } else if (msg.command === 'INJECT_TAB_NO_RELOAD') {
          sendMaskedClientText(
            clientSocket,
            JSON.stringify({
              id: msg.id,
              result: {
                tabId: msg.params.tabId,
                url: 'https://www.linkedin.com/feed/',
                title: 'LinkedIn Feed',
                reloaded: false,
                injected: Boolean(msg.params.iifeSource && msg.params.iifeSource.length > 1000)
              }
            })
          );
        } else if (msg.command === 'OPEN_BACKGROUND_TAB_GROUP') {
          sendMaskedClientText(
            clientSocket,
            JSON.stringify({
              id: msg.id,
              result: {
                tabId: 99,
                groupId: 7,
                url: msg.params.url
              }
            })
          );
        }
      }
    });

    try {
      const connected = await bridge.waitForExtension(2000);
      assert.equal(connected, true);

      const tabs = await bridge.listTabs();
      assert.equal(tabs.length, 1);
      assert.equal(tabs[0].id, 42);

      // Attach to existing tab by URL substring WITHOUT reloading
      const attached = await bridge.attachExistingTab('linkedin.com/feed', { reload: false });
      assert.equal(attached.tabId, 42);
      assert.equal(attached.reloaded, false);
      assert.equal(attached.injected, true);

      // Open background tab inside collapsed [Testudo Agent] tab group
      const bgTab = await bridge.openBackgroundTab('https://aventinelabs.com', {
        groupTitle: '[Testudo Agent]',
        collapsed: true,
        active: false
      });
      assert.equal(bgTab.tabId, 99);
      assert.equal(bgTab.groupId, 7);

      // Simulate unallowlisted 'error' event (must be dropped safely without crashing Node EventEmitter!)
      sendMaskedClientText(
        clientSocket,
        JSON.stringify({
          type: 'event',
          event: 'error',
          payload: { boom: true }
        })
      );

      // Simulate CAPTCHA challenge event and resolution from extension
      sendMaskedClientText(
        clientSocket,
        JSON.stringify({
          type: 'event',
          event: 'human-assist-required',
          payload: { tabId: 42, challengeType: 'cloudflare-turnstile' }
        })
      );
      sendMaskedClientText(
        clientSocket,
        JSON.stringify({
          type: 'event',
          event: 'human-assist-resolved',
          payload: { tabId: 42, challengeType: 'cloudflare-turnstile' }
        })
      );

      await new Promise((r) => setTimeout(r, 50));
      assert.equal(receivedEvents.length, 2);
      assert.equal(receivedEvents[0].type, 'required');
      assert.equal(receivedEvents[1].type, 'resolved');
    } finally {
      clientSocket.destroy();
      await bridge.close();
    }
  });

  it('TestudoCdp.launchHeadless blocks dangerous Chrome flags and serve-test-sites confines paths & rejects malformed URIs', async () => {
    await assert.rejects(
      async () =>
        TestudoCdp.launchHeadless({
          executablePath: process.execPath,
          extraArgs: ['--renderer-cmd-prefix=/bin/sh']
        }),
      /Blocked dangerous Chrome flag/
    );
    await assert.rejects(
      async () =>
        TestudoCdp.launchHeadless({
          executablePath: process.execPath,
          extraArgs: ['--no-sandbox']
        }),
      /Pass unsafeNoSandbox: true explicitly/
    );

    const demoSrv = createDemoServer(0);
    await demoSrv.start();
    const port = demoSrv.getPort();
    try {
      const fetchStatus = (rawPath) =>
        new Promise((resolve, reject) => {
          const r = http.request({ hostname: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
            res.resume();
            resolve({ status: res.statusCode, cors: res.headers['access-control-allow-origin'] });
          });
          r.on('error', reject);
          r.end();
        });

      const badPct = await fetchStatus('/demo/%ZZ');
      assert.equal(badPct.status, 400);
      assert.equal(badPct.cors, undefined);

      const pkgForbidden = await fetchStatus('/package.json');
      assert.equal(pkgForbidden.status, 403);

      const travForbidden = await fetchStatus('/demo/../../package.json');
      assert.equal(travForbidden.status, 403);

      const validDemo = await fetchStatus('/demo/site1_financial_blotter.html');
      assert.equal(validDemo.status, 200);
      assert.equal(validDemo.cors, undefined);
    } finally {
      await demoSrv.stop();
    }
  });

  it('TestudoCdp Headless Chrome executes zero-reload injection, contenteditable typing, expandAll, explicit waitForHumanAssist, and CAPTCHA human-assist auto-resume', async () => {
    let chromeBin = null;
    try {
      chromeBin = resolveLocalChromeExecutable();
    } catch {
      chromeBin = null;
    }
    if (!chromeBin || !fs.existsSync(chromeBin)) {
      return;
    }

    const session = await TestudoCdp.launchHeadless({
      executablePath: chromeBin,
      width: 1280,
      height: 800
    });

    try {
      await session.setContent(`<!DOCTYPE html>
<html>
<head><title>Sir Testudo Assistive Rehearsal</title></head>
<body>
  <div id="feed-post">
    <p id="post-summary">Short preview</p>
    <button id="see-more-btn" onclick="document.getElementById('post-summary').textContent = 'Full expanded architectural analysis';">...see more</button>
  </div>
  <div id="comment-editor" contenteditable="true" role="textbox" aria-label="Add a comment"></div>
  <button id="submit-btn" onclick="document.getElementById('submit-status').textContent = 'Published: ' + document.getElementById('comment-editor').innerText;">Post</button>
  <div id="submit-status">Idle</div>
  <div id="challenge-slot"></div>
</body>
</html>`);

      // 1. Verify expandAll clicks "...see more" in a single DOM pass
      const expanded = await session.expandAll();
      assert.equal(expanded.clickedCount, 1);
      const summaryText = await session.textContent('#post-summary');
      assert.equal(summaryText, 'Full expanded architectural analysis');

      // 2. Verify contenteditable="true" typing via session.type()
      const typed = await session.type('#comment-editor', 'Zero-Telemetry Deterministic Verification', { clear: true });
      assert.equal(typed.value, 'Zero-Telemetry Deterministic Verification');
      const editorContent = await session.textContent('#comment-editor');
      assert.equal(editorContent, 'Zero-Telemetry Deterministic Verification');

      // 3. Simulate a Cloudflare Turnstile challenge appearing in #challenge-slot and resolving after 120ms,
      // while running a Testudo workflow that automatically pauses for human assist and resumes!
      await session.evaluate(() => {
        const slot = document.getElementById('challenge-slot');
        if (slot) {
          slot.innerHTML = '<div class="cf-turnstile" data-sitekey="0x4AAAAAA">Verify you are human</div>';
          setTimeout(() => {
            slot.innerHTML = '';
          }, 120);
        }
      });

      const wfReport = await session.runWorkflow(
        'assistive-captcha-rehearsal',
        [
          {
            id: 'step-submit',
            title: 'Click Post button after human solves Turnstile',
            selector: '#submit-btn',
            action: 'click'
          },
          {
            id: 'step-verify',
            title: 'Verify published status text',
            selector: '#submit-status',
            action: 'assertText',
            value: 'Published: Zero-Telemetry Deterministic Verification'
          }
        ],
        { autoPauseOnChallenge: true, challengeTimeoutMs: 5000 }
      );

      assert.equal(wfReport.status, 'completed');
      assert.equal(wfReport.completedSteps, 2);
      assert.ok((wfReport.humanAssistPauses ?? 0) >= 1, 'Expected workflow to record humanAssistPauses >= 1');

      // 3b. Verify explicit step.action === 'waitForHumanAssist' pauses even without standard CAPTCHA DOM and resumes on testudo:human-assist-resolved
      const explicitAssistRes = await session.evaluate(async () => {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('testudo:human-assist-resolved'));
        }, 80);
        const wf = window.$T.workflow('explicit-human-assist-test', [
          {
            title: 'Explicit Human Review Gate',
            selector: '#submit-status',
            action: 'waitForHumanAssist',
            options: { timeout: 2000 }
          }
        ]);
        return await wf.run();
      });
      assert.equal(explicitAssistRes.status, 'completed');
      assert.equal(explicitAssistRes.humanAssistPauses, 1);

      // 4. Verify Concierge screen snapshot and PNG screenshot
      const snapshot = await session.conciergeSnapshot();
      assert.equal(snapshot.title, 'Sir Testudo Assistive Rehearsal');
      assert.equal(snapshot.challenge.detected, false);

      const png = await session.screenshot();
      assert.ok(Buffer.isBuffer(png) && png.length > 500, 'Expected valid PNG screenshot buffer');
    } finally {
      await session.close();
    }
  });

  it('ARCH-27: TestudoCdp.connectWithFailover enforces 3-tier hierarchy and emits mandatory failure telemetry when falling back', async () => {
    const reportedFailures = [];
    await assert.rejects(
      async () => {
        await TestudoCdp.connectWithFailover({
          bridgePort: 39991,
          cdpPort: 39992,
          host: '127.0.0.1',
          allowPlaywrightFallback: false,
          onTierFailure(failure) {
            reportedFailures.push(failure);
          }
        });
      },
      /\[Testudo Browser Failover Exhausted\]/
    );

    assert.equal(reportedFailures.length, 2);
    assert.equal(reportedFailures[0].tier, 1);
    assert.equal(reportedFailures[0].tierName, 'testudo-assistive-bridge');
    assert.ok(reportedFailures[0].reason.includes('39991'), 'Tier 1 failure telemetry must include exact reason');
    assert.equal(reportedFailures[1].tier, 2);
    assert.equal(reportedFailures[1].tierName, 'native-debug-port-cdp');
    assert.ok(reportedFailures[1].reason.includes('39992'), 'Tier 2 failure telemetry must include exact reason');
  });
});
