import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from '../scripts/serve-test-sites.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const monorepoRoot = path.resolve(__dirname, '../../..');
const repoRoot = path.resolve(__dirname, '..');
const BASE_ARTIFACTS_DIR = fs.existsSync(path.join(monorepoRoot, 'packages'))
  ? path.join(monorepoRoot, 'artifacts')
  : path.join(repoRoot, 'artifacts');
const SCREENSHOTS_DIR = path.join(BASE_ARTIFACTS_DIR, 'e2e_screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

let puppeteer;
try {
  const mod = await import('puppeteer');
  puppeteer = mod.default || mod;
} catch (err) {
  puppeteer = null;
}

const candidatePaths = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/home/mark/.cache/puppeteer/chrome/linux-149.0.7827.22/chrome-linux64/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium'
].filter(Boolean);

const resolvedChromePath = candidatePaths.find((p) => fs.existsSync(p));
const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

test('TestudoE2E: Full-Spectrum Multi-Site Browser Simulation', async (t) => {
  if (!puppeteer) {
    t.skip('Puppeteer is not installed in current environment; skipping browser simulation.');
    return;
  }

  const serverInstance = createServer(PORT);
  await serverInstance.start();

  let browser;
  try {
    const launchOptions = {
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: true
    };
    if (resolvedChromePath) {
      launchOptions.executablePath = resolvedChromePath;
    }

    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Catch in-page errors
    page.on('pageerror', (err) => {
      console.error('[Browser PageError]:', err.message);
    });

    // =========================================================================
    // SITE 1: Multi-Currency Sovereign Blotter
    // =========================================================================
    await t.test('Site 1: Multi-Currency Sovereign Blotter Real-World Parsing', async () => {
      await page.goto(`${BASE_URL}/demo/site1_financial_blotter.html`, { waitUntil: 'networkidle0' });

      // Verify Testudo initialized
      await page.waitForFunction(() => window.$T !== undefined, { timeout: 5000 });

      // Run in-page validation suite
      const summary = await page.evaluate(async () => {
        return window.runSite1Tests();
      });

      assert.strictEqual(summary.success, true, `Site 1 tests failed: ${summary.passes}/${summary.total} passed`);
      assert.strictEqual(summary.passes, summary.total, 'All Site 1 assertions must pass');

      // Take forensic screenshot
      const shotPath = path.join(SCREENSHOTS_DIR, 'site1_financial_blotter.png');
      await page.screenshot({ path: shotPath, fullPage: true });
      assert.ok(fs.existsSync(shotPath), 'Site 1 screenshot must be written');
    });

    // =========================================================================
    // SITE 2: React Controlled State & Synthetic Event Bypass
    // =========================================================================
    await t.test('Site 2: React 18 Controlled State & Synthetic Event Bypass', async () => {
      await page.goto(`${BASE_URL}/demo/site2_react_synthetic_form.html`, { waitUntil: 'networkidle0' });

      await page.waitForFunction(() => window.$T !== undefined, { timeout: 5000 });
      await page.waitForSelector('#react-phone', { timeout: 5000 });

      // 1. Prove that Naive DOM Assignment fails to update React controlled state
      await page.click('#btn-naive-assign');
      const stateAfterNaive = await page.evaluate(() => {
        const text = document.getElementById('state-phone')?.innerText || '';
        return text;
      });
      assert.strictEqual(stateAfterNaive.includes('(555) 019-2834'), false, 'Naive DOM assignment must fail to update React state');

      // 2. Prove that $T.type() bypasses React _valueTracker and successfully updates state
      await page.click('#btn-testudo-type');
      const stateAfterTestudo = await page.evaluate(() => {
        const text = document.getElementById('state-phone')?.innerText || '';
        return text;
      });
      assert.strictEqual(stateAfterTestudo.includes('(555) 019-2834'), true, '$T.type must update React state via prototype setter');

      // 3. Run full automated suite on Site 2
      const summary = await page.evaluate(async () => {
        return window.runSite2Tests();
      });
      const logsS2 = await page.$eval('#test-results', el => el.innerText);
      if (!summary.success) console.log('\n--- SITE 2 LOGS ---\n', logsS2);
      assert.strictEqual(summary.success, true, `Site 2 tests failed: ${summary.passes}/${summary.total} passed`);

      const shotPath = path.join(SCREENSHOTS_DIR, 'site2_react_synthetic_form.png');
      await page.screenshot({ path: shotPath, fullPage: true });
      assert.ok(fs.existsSync(shotPath), 'Site 2 screenshot must be written');
    });

    // =========================================================================
    // SITE 3: Deep DOM & Priority Cascade Stress Test
    // =========================================================================
    await t.test('Site 3: Deep DOM & Priority Cascade Stress Test', async () => {
      await page.goto(`${BASE_URL}/demo/site3_dom_scoping_stress.html`, { waitUntil: 'networkidle0' });

      await page.waitForFunction(() => window.$T !== undefined, { timeout: 5000 });

      // Run full automated suite on Site 3
      const summary = await page.evaluate(async () => {
        return window.runSite3Tests();
      });
      const logsS3 = await page.$eval('#test-results', el => el.innerText);
      if (!summary.success) console.log('\n--- SITE 3 LOGS ---\n', logsS3);
      assert.strictEqual(summary.success, true, `Site 3 tests failed: ${summary.passes}/${summary.total} passed`);

      // Trigger badges to visually render on page
      await page.click('#btn-test-badges');
      const badgeCount = await page.evaluate(() => {
        return document.querySelectorAll('.testudo-badge').length;
      });
      assert.ok(badgeCount > 0, 'Visual badges must be injected into live page');

      const shotPath = path.join(SCREENSHOTS_DIR, 'site3_dom_scoping_stress.png');
      await page.screenshot({ path: shotPath, fullPage: true });
      assert.ok(fs.existsSync(shotPath), 'Site 3 screenshot must be written');
    });

    // =========================================================================
    // SITE 4: Multi-Cell Financial Calculus & Visual Forensics
    // =========================================================================
    await t.test('Site 4: Multi-Cell Financial Calculus & Visual Forensics', async () => {
      await page.goto(`${BASE_URL}/demo/site4_calculus_hud_blotter.html`, { waitUntil: 'networkidle0' });

      await page.waitForFunction(() => window.$T !== undefined, { timeout: 5000 });

      // Trigger the HUD directly
      await page.click('#btn-trigger-hud');
      // Give 500ms for overlay DOM nodes to attach
      await new Promise(r => setTimeout(r, 600));

      const hudExists = await page.evaluate(() => {
        return document.querySelector('[data-testudo-overlay="true"]') !== null ||
               document.querySelector('.testudo-diff-zoom') !== null ||
               document.querySelector('[data-testudo-outlined="true"]') !== null;
      });
      assert.strictEqual(hudExists, true, 'Visual HUD overlay must attach to live DOM');

      // Run full automated suite on Site 4
      const summary = await page.evaluate(async () => {
        return window.runSite4Tests();
      });
      const logsS4 = await page.$eval('#test-results', el => el.innerText);
      if (!summary.success) console.log('\n--- SITE 4 LOGS ---\n', logsS4);
      assert.strictEqual(summary.success, true, `Site 4 tests failed: ${summary.passes}/${summary.total} passed`);

      const shotPath = path.join(SCREENSHOTS_DIR, 'site4_calculus_hud_blotter.png');
      await page.screenshot({ path: shotPath, fullPage: true });
      assert.ok(fs.existsSync(shotPath), 'Site 4 screenshot must be written');
    });

  } finally {
    if (browser) {
      await browser.close();
    }
    await serverInstance.stop();
  }
});
