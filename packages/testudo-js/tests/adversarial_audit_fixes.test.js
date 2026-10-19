import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createPlaywrightTestudo } from '../dist/adapters/playwright.js';
import { sanitizeCssColor } from '../dist/visual.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const candidatePaths = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/home/mark/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium'
].filter(Boolean);

const resolvedChromePath = candidatePaths.find((p) => fs.existsSync(p));

const CONTROLLED_TEST_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Testudo Controlled Adversarial Verification Page</title>
</head>
<body>
  <!-- Priority Cascade Scope Fixtures -->
  <div data-testid="cascade-target" id="tier1-container">
    <button id="btn-inside-tier1" type="button">Tier 1 Button</button>
  </div>
  <div data-test="cascade-target" id="tier2-container">
    <button id="btn-inside-tier2" type="button">Tier 2 Button</button>
  </div>
  <div id="cascade-target">
    <button id="btn-inside-tier3" type="button">Tier 3 Button</button>
  </div>

  <!-- Actionable Form Controls for scan() & Executable Snippets -->
  <section id="action-form">
    <input data-testid="input-with-testid" id="price-input" type="text" value="" />
    <textarea id="notes-textarea"></textarea>
    <select id="venue-select" data-testid="select-venue">
      <option value="none">-- Select --</option>
      <option value="CME_GLOBEX">CME Globex</option>
      <option value="COINBASE_L3">Coinbase L3</option>
    </select>
    <button id="single-click-btn" type="button">Submit Order</button>
    <div id="click-counter">0</div>

    <!-- Unidentified buttons to verify structural CSS selector generation (no :has-text) -->
    <div id="plain-btn-group">
      <button type="button">First Plain Action</button>
      <button type="button">Second Plain Action</button>
    </div>

    <!-- Ambiguous duplicate selector targets -->
    <button class="ambiguous-submit" type="button">Duplicate 1</button>
    <button class="ambiguous-submit" type="button">Duplicate 2</button>
    <div id="ambiguous-counter">0</div>

    <!-- Financial Assertion & XSS Target -->
    <div id="balance-cell">$1,250.00</div>
    <div id="xss-cell">&lt;img src=x onerror="window.__XSS_EXECUTED__=true"&gt;$999.00</div>
  </section>

  <script type="module">
    import { $T } from '/dist/index.js';
    window.$T = $T;
    window.testudo = $T;

    let clicks = 0;
    document.getElementById('single-click-btn').addEventListener('click', () => {
      clicks += 1;
      document.getElementById('click-counter').textContent = String(clicks);
    });

    let ambigClicks = 0;
    document.querySelectorAll('.ambiguous-submit').forEach((btn) => {
      btn.addEventListener('click', () => {
        ambigClicks += 1;
        document.getElementById('ambiguous-counter').textContent = String(ambigClicks);
      });
    });
  </script>
</body>
</html>`;

function startControlledServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      if (urlPath === '/' || urlPath === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(CONTROLLED_TEST_HTML);
        return;
      }
      const filePath = path.join(repoRoot, urlPath);
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
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

test('TESTUDO-03 Adversarial Audit Regression Suite (Core Product - Standalone & Playwright Bridge)', async (t) => {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    const rootPw = path.resolve(repoRoot, '../../node_modules/playwright/index.js');
    playwright = await import(rootPw);
  }
  const pw = playwright.default || playwright;

  if (!pw || !resolvedChromePath) {
    assert.fail('Playwright and Chrome binary are required for TESTUDO-03 verification; failing closed.');
  }

  const { server, baseUrl } = await startControlledServer();
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath: resolvedChromePath
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.$T !== undefined, { timeout: 5000 });

    // =========================================================================
    // 1. Finding 1 & Amendment 1: $T(selector).click(), .type(), .select() exist and fire EXACTLY ONCE (No Double-Click)
    // =========================================================================
    await t.test('Finding 1 & Amendment 1: Standalone $T(selector) executes click, type, and select with zero double-clicks', async () => {
      const result = await page.evaluate(async () => {
        await window.$T('#single-click-btn').click();
        await window.$T('[data-testid="input-with-testid"]').type('5980.25');
        await window.$T('#notes-textarea').type('FIFO order note');
        await window.$T('[data-testid="select-venue"]').select('COINBASE_L3');

        return {
          clickCount: Number(document.getElementById('click-counter').textContent),
          inputValue: document.getElementById('price-input').value,
          notesValue: document.getElementById('notes-textarea').value,
          selectValue: document.getElementById('venue-select').value
        };
      });

      assert.strictEqual(result.clickCount, 1, 'Single click must increment click counter by exactly 1 (never 2)');
      assert.strictEqual(result.inputValue, '5980.25');
      assert.strictEqual(result.notesValue, 'FIFO order note');
      assert.strictEqual(result.selectValue, 'COINBASE_L3');
    });

    // =========================================================================
    // 2. Finding 4: resolveScope() stops at the highest matching priority level
    // =========================================================================
    await t.test('Finding 4: resolveScope() stops at Priority 1 (data-testid) instead of accumulating lower tiers', async () => {
      const cascadeCheck = await page.evaluate(() => {
        const defaultScopes = window.$T.scan.resolveScope('cascade-target');
        const allScopes = window.$T.scan.resolveScope('cascade-target', { cascadeAll: true });
        const scannedItems = window.$T.scan('cascade-target');
        return {
          defaultScopeIds: defaultScopes.map((el) => el.id),
          allScopeIds: allScopes.map((el) => el.id),
          scannedIds: scannedItems.map((item) => item.id)
        };
      });

      assert.deepStrictEqual(
        cascadeCheck.defaultScopeIds,
        ['tier1-container'],
        'Default resolveScope must stop at highest priority match (Tier 1 data-testid)'
      );
      assert.strictEqual(
        cascadeCheck.allScopeIds.length,
        3,
        'cascadeAll: true option still returns all 3 matching tiers when explicitly requested'
      );
      assert.deepStrictEqual(
        cascadeCheck.scannedIds,
        ['btn-inside-tier1'],
        'scan("cascade-target") must only return elements inside the highest-priority scope'
      );
    });

    // =========================================================================
    // 3. Finding 5 & Amendment 2: Element-appropriate snippets + standards-compliant CSS selectors + ambiguity guard
    // =========================================================================
    await t.test('Finding 5 & Amendment 2: scan() emits .type() for inputs/textareas, .select() for selects, standards-compliant CSS selectors, and rejects ambiguous selectors', async () => {
      const scanAudit = await page.evaluate(async () => {
        const items = window.$T.scan('#action-form');
        const byId = Object.fromEntries(items.filter((i) => i.id).map((i) => [i.id, i]));
        const hasColonHasText = items.some((i) => i.selector.includes(':has-text'));

        // Verify that every generated selector in #plain-btn-group is valid standard CSS and resolves uniquely
        const plainButtons = items.filter((i) => i.text && i.text.includes('Plain Action'));
        const plainUniqueCounts = plainButtons.map((i) => document.querySelectorAll(i.selector).length);

        // Verify ambiguity error on '.ambiguous-submit'
        let ambiguityError = '';
        try {
          await window.$T('.ambiguous-submit').click();
        } catch (err) {
          ambiguityError = err.message;
        }
        const ambigCounter = Number(document.getElementById('ambiguous-counter').textContent);

        return {
          priceInputSnippet: byId['price-input']?.snippet,
          priceInputAction: byId['price-input']?.action,
          notesSnippet: byId['notes-textarea']?.snippet,
          venueSelectSnippet: byId['venue-select']?.snippet,
          venueSelectAction: byId['venue-select']?.action,
          buttonSnippet: byId['single-click-btn']?.snippet,
          hasColonHasText,
          plainUniqueCounts,
          ambiguityError,
          ambigCounter
        };
      });

      assert.strictEqual(scanAudit.priceInputAction, 'type');
      assert.match(scanAudit.priceInputSnippet, /\.type\('example'\);$/);
      assert.match(scanAudit.notesSnippet, /\.type\('example'\);$/);
      assert.strictEqual(scanAudit.venueSelectAction, 'select');
      assert.match(scanAudit.venueSelectSnippet, /\.select\('CME_GLOBEX'\);$/);
      assert.match(scanAudit.buttonSnippet, /\.click\(\);$/);
      assert.strictEqual(scanAudit.hasColonHasText, false, 'Must not emit non-standard :has-text() selectors');
      assert.deepStrictEqual(scanAudit.plainUniqueCounts, [1, 1], 'Structural CSS selectors must match exactly 1 element each');
      assert.match(scanAudit.ambiguityError, /Ambiguous selector "\.ambiguous-submit" matched 2 elements/);
      assert.strictEqual(scanAudit.ambigCounter, 0, 'Ambiguous selector must not click any element');
    });

    // =========================================================================
    // 4. Finding 3 & Amendment 3: Zero innerHTML XSS via DOM text nodes + strict CSS color allowlist
    // =========================================================================
    await t.test('Finding 3 & Amendment 3: Visual HUD and Calculus Zoom Card use textContent (zero HTML injection) and strict color sanitization', async () => {
      assert.strictEqual(sanitizeCssColor('#10B981'), '#10B981');
      assert.strictEqual(sanitizeCssColor('crimson'), 'crimson');
      assert.strictEqual(
        sanitizeCssColor('red; background: url(javascript:alert(1))', '#EF4444'),
        '#EF4444',
        'Malicious CSS injection string must fall back to default hex color'
      );

      const xssAudit = await page.evaluate(async () => {
        window.__XSS_EXECUTED__ = false;
        const maliciousMsg = '<img src=x onerror="window.__XSS_EXECUTED__=true"><script>window.__XSS_EXECUTED__=true</script>';

        await window.$T.visual.highlightError('#xss-cell', {
          message: maliciousMsg,
          expected: '$1,000.00',
          actual: '<img src=x onerror="window.__XSS_EXECUTED__=true">$999.00',
          color: 'red; border: 99px solid yellow'
        });

        const hud = document.querySelector('[data-testudo-hud="true"]');
        const injectedImgCount = hud ? hud.querySelectorAll('img, script').length : -1;
        const hudText = hud ? hud.textContent : '';

        // Also test highlightCalculus with untrusted DOM text
        const calcEval = window.$T.calc('#balance-cell + 10').evaluate();
        window.$T.visual.highlightCalculus(calcEval, '#xss-cell', { delta: -261, tolerance: 0.01 });
        const zoomCard = document.querySelector('.testudo-diff-zoom');
        const zoomInjectedCount = zoomCard ? zoomCard.querySelectorAll('img, script').length : -1;

        return {
          xssExecuted: window.__XSS_EXECUTED__,
          injectedImgCount,
          zoomInjectedCount,
          hudContainsLiteralTags: hudText.includes('<img src=x')
        };
      });

      assert.strictEqual(xssAudit.xssExecuted, false, 'Untrusted HTML must never execute');
      assert.strictEqual(xssAudit.injectedImgCount, 0, 'Zero <img> or <script> elements created inside HUD');
      assert.strictEqual(xssAudit.zoomInjectedCount, 0, 'Zero <img> or <script> elements created inside Calculus Zoom Card');
      assert.strictEqual(xssAudit.hudContainsLiteralTags, true, 'Markup characters must be rendered literally via textContent');
    });

    // =========================================================================
    // 5. Finding 2: Playwright Bridge (createPlaywrightTestudo) In-Page Execution & Intentional Failure Forensics
    // =========================================================================
    await t.test('Finding 2: Playwright bridge executes scan, explore, single-click, and intentional failure HUD via page.evaluate', async () => {
      const $T = createPlaywrightTestudo(page);
      await $T.cleanup();

      const scanned = await $T.scan('#action-form');
      assert.ok(scanned.length >= 5, 'Playwright bridge $T.scan() must return serialized DOM elements from page');

      const badgeCount = await $T.explore('#action-form');
      assert.strictEqual(badgeCount, scanned.length, 'Playwright bridge $T.explore() must inject badges into live page');
      await $T.clearBadges();

      // Click button via Playwright bridge and verify click count increments by 1 (from 1 to 2)
      await $T('#single-click-btn').click();
      const clickCountAfter = await page.textContent('#click-counter');
      assert.strictEqual(clickCountAfter?.trim(), '2', 'Playwright bridge click must fire exactly once');

      // Passing currency assertion
      const passRes = await $T('#balance-cell').assertCurrency('$1,250.00', { tolerance: 0.01 });
      assert.strictEqual(passRes.pass, true);

      // Intentionally failing currency assertion: must throw, outline #balance-cell in red, and attach HUD with character diff
      let failedAsExpected = false;
      let failureMessage = '';
      try {
        await $T('#balance-cell').assertCurrency('$1,999.00', {
          tolerance: 0.01,
          message: 'Intentional Balance Audit Failure'
        });
      } catch (err) {
        failedAsExpected = true;
        failureMessage = err.message;
      }

      assert.strictEqual(failedAsExpected, true, 'Intentionally mismatched currency assertion must fail');
      assert.match(failureMessage, /Intentional Balance Audit Failure/);
      assert.match(failureMessage, /Unexpected '2' at index 3 \(expected '9'\)/);

      const forensicsDomState = await page.evaluate(() => {
        const el = document.getElementById('balance-cell');
        const hud = document.querySelector('[data-testudo-hud="true"]');
        return {
          isOutlined: el?.getAttribute('data-testudo-outlined') === 'true',
          hudText: hud?.textContent || ''
        };
      });

      assert.strictEqual(forensicsDomState.isOutlined, true, 'Failing element must be outlined in live DOM');
      assert.ok(
        forensicsDomState.hudText.includes('Intentional Balance Audit Failure'),
        'Floating HUD must explain the mismatch in live DOM'
      );
      assert.ok(
        forensicsDomState.hudText.includes("Unexpected '2' at index 3 (expected '9')"),
        'Floating HUD must display character-level diff'
      );
    });
  } finally {
    await browser.close();
    server.close();
  }
});
