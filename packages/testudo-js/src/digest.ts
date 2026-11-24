/**
 * @aventine/testudo - Legacy Test Script Auto-Digester & Transpiler (v0.4.0)
 * Ingests Selenium WebDriver (Java/Python/JS), Playwright, Puppeteer, and Cypress scripts
 * and transpiles them into deterministic Testudo WorkflowStep[] manifests and fluent $T code.
 * Zero external dependencies.
 */

import { WorkflowStepDefinition, WorkflowActionType } from './workflow.js';

export type LegacyFramework = 'selenium' | 'playwright' | 'puppeteer' | 'cypress' | 'unknown';

export interface DigestOptions {
  workflowName?: string;
  defaultStableMs?: number;
  defaultTolerance?: number;
}

export interface DigestedScriptResult {
  detectedFramework: LegacyFramework;
  workflowName: string;
  steps: WorkflowStepDefinition[];
  fluentCode: string;
  generatedCode: string;
  manifestJson: string;
  upgradesApplied: string[];
}

function isMonetaryExpectation(val: string): boolean {
  const s = val.trim();
  if (/[$€£¥₹]/.test(s)) return true;
  if (/\b(?:USD|EUR|GBP|JPY|INR|CAD|AUD|CHF)\b/i.test(s)) return true;
  if (/^[+-]?\d[\d,.]*\s*(?:Billion|Million|Thousand|Trillion|[BMKT])\b/i.test(s)) return true;
  return false;
}

function isBasisPointsExpectation(val: string): boolean {
  return /^[+-]?\d+(?:\.\d+)?\s*(?:bps|bp)\b/i.test(val.trim());
}

function normalizeByLocator(byType: string, rawLocator: string): string {
  const t = byType.toLowerCase().trim();
  const loc = rawLocator.trim();
  if (t === 'id' || t === 'by.id') return loc.startsWith('#') ? loc : `#${loc}`;
  if (t === 'name' || t === 'by.name') return `[name="${loc}"]`;
  if (t === 'classname' || t === 'class_name' || t === 'by.classname' || t === 'by.class_name') {
    return loc.startsWith('.') ? loc : `.${loc}`;
  }
  if (t === 'testid' || t === 'getbytestid') return `[data-testid="${loc}"]`;
  if (t === 'xpath' || t === 'by.xpath') {
    const idMatch = loc.match(/@id=['"]([^'"]+)['"]/);
    if (idMatch) return `#${idMatch[1]}`;
    const testIdMatch = loc.match(/@data-testid=['"]([^'"]+)['"]/);
    if (testIdMatch) return `[data-testid="${testIdMatch[1]}"]`;
    const nameMatch = loc.match(/@name=['"]([^'"]+)['"]/);
    if (nameMatch) return `[name="${nameMatch[1]}"]`;
  }
  return loc;
}

function buildAssertionStep(
  stepIdx: number,
  selector: string,
  expectedRaw: string,
  stableMs: number,
  tolerance: number,
  upgrades: string[]
): WorkflowStepDefinition {
  const expected = expectedRaw.trim();
  if (isBasisPointsExpectation(expected)) {
    upgrades.push(
      `Upgraded text assertion on "${selector}" ("${expected}") to fail-closed assertBasisPoints with ${tolerance} bps tolerance.`
    );
    return {
      id: `step-${stepIdx}`,
      title: `Verify ${selector} equals ${expected}`,
      selector,
      action: 'assertBasisPoints',
      value: expected,
      options: { tolerance, mode: 'stable', stableMs }
    };
  }
  if (isMonetaryExpectation(expected)) {
    upgrades.push(
      `Upgraded brittle string check on "${selector}" ("${expected}") to fail-closed assertCurrency with ${stableMs}ms stability window.`
    );
    return {
      id: `step-${stepIdx}`,
      title: `Verify ${selector} currency is ${expected}`,
      selector,
      action: 'assertCurrency',
      value: expected,
      options: { tolerance, mode: 'stable', stableMs }
    };
  }
  return {
    id: `step-${stepIdx}`,
    title: `Verify ${selector} text is "${expected}"`,
    selector,
    action: 'assertText',
    value: expected,
    options: { mode: 'eventually' }
  };
}

export function detectLegacyFramework(script: string): LegacyFramework {
  const src = String(script || '');
  if (/\b(?:driver\.findElement|driver\.find_element|By\.id|By\.cssSelector|By\.ID|By\.CSS_SELECTOR|WebDriverWait)\b/.test(src)) {
    return 'selenium';
  }
  if (/\bcy\.(?:get|contains|visit)\s*\(/.test(src)) {
    return 'cypress';
  }
  if (/\bpage\.(?:locator|getByTestId|getByRole)\s*\(/.test(src) || /\btoHaveText\s*\(/.test(src)) {
    return 'playwright';
  }
  if (/\bpage\.(?:type|click|select|\$eval|waitForSelector)\s*\(/.test(src)) {
    return 'puppeteer';
  }
  return 'unknown';
}

export function digestScript(script: string, options: DigestOptions = {}): DigestedScriptResult {
  const detectedFramework = detectLegacyFramework(script);
  const workflowName = options.workflowName || `Digested ${detectedFramework.toUpperCase()} Workflow`;
  const stableMs = options.defaultStableMs ?? 250;
  const tolerance = options.defaultTolerance ?? 0.01;
  const steps: WorkflowStepDefinition[] = [];
  const upgradesApplied: string[] = [];
  const varSelectorMap = new Map<string, string>();

  const lines = String(script || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('#') && !l.startsWith('/*'));

  for (const line of lines) {
    const nextIdx = steps.length + 1;

    // Track variable assignments holding locators/elements (e.g. WebElement el = driver.findElement(By.id("foo")) or const btn = page.locator('#foo'))
    const seleniumVarMatch = line.match(
      /(?:WebElement|var|let|const)?\s*([a-zA-Z0-9_]+)\s*=\s*driver\.find(?:Element|_element)\(\s*By\.([a-zA-Z_]+)\s*(?:\(|,\s*)['"]([^'"]+)['"]\s*(?:\)\s*)+/
    );
    if (seleniumVarMatch && !/\.(?:click|sendKeys|send_keys|getText)\b/.test(line)) {
      varSelectorMap.set(seleniumVarMatch[1], normalizeByLocator(seleniumVarMatch[2], seleniumVarMatch[3]));
      continue;
    }

    const pwVarMatch = line.match(
      /(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*page\.(?:locator|getByTestId)\(\s*['"]([^'"]+)['"]\s*\)/
    );
    if (pwVarMatch && !/\.(?:click|fill|type|selectOption|toHaveText)\b/.test(line)) {
      const isTestId = line.includes('getByTestId');
      varSelectorMap.set(pwVarMatch[1], isTestId ? `[data-testid="${pwVarMatch[2]}"]` : pwVarMatch[2]);
      continue;
    }

    // 1. Selenium Select dropdown: new Select(driver.findElement(By.id("x"))).selectByVisibleText("v") / selectByValue("v")
    const selSelectMatch = line.match(
      /Select\(\s*driver\.find(?:Element|_element)\(\s*By\.([a-zA-Z_]+)\s*(?:\(|,\s*)['"]([^'"]+)['"]\s*(?:\)\s*)+\.(?:selectByVisibleText|selectByValue|select_by_visible_text|select_by_value)\(\s*['"]([^'"]+)['"]\s*\)/
    );
    if (selSelectMatch) {
      const selector = normalizeByLocator(selSelectMatch[1], selSelectMatch[2]);
      steps.push({
        id: `step-${nextIdx}`,
        title: `Select "${selSelectMatch[3]}" in ${selector}`,
        selector,
        action: 'select',
        value: selSelectMatch[3]
      });
      continue;
    }

    // 2. Selenium inline action: driver.findElement(By.id("x")).sendKeys("v") / click()
    const selActionMatch = line.match(
      /driver\.find(?:Element|_element)\(\s*By\.([a-zA-Z_]+)\s*(?:\(|,\s*)['"]([^'"]+)['"]\s*(?:\)\s*)+\.(sendKeys|send_keys|click)\(\s*(?:['"]([^'"]*)['"])?\s*\)/
    );
    if (selActionMatch) {
      const selector = normalizeByLocator(selActionMatch[1], selActionMatch[2]);
      const rawAct = selActionMatch[3];
      if (rawAct === 'click') {
        steps.push({
          id: `step-${nextIdx}`,
          title: `Click ${selector}`,
          selector,
          action: 'click'
        });
      } else {
        const val = selActionMatch[4] ?? '';
        upgradesApplied.push(
          `Upgraded Selenium ${rawAct} on "${selector}" to React/Vue _valueTracker-safe $T('${selector}').type('${val}').`
        );
        steps.push({
          id: `step-${nextIdx}`,
          title: `Type "${val}" into ${selector}`,
          selector,
          action: 'type',
          value: val
        });
      }
      continue;
    }

    // 3. Selenium assertion: assertEquals("expected", driver.findElement(By.id("x")).getText()) or vice versa
    const selAssertMatch1 = line.match(
      /assert(?:Equals|Equal|_equal)\(\s*['"]([^'"]+)['"]\s*,\s*driver\.find(?:Element|_element)\(\s*By\.([a-zA-Z_]+)\s*(?:\(|,\s*)['"]([^'"]+)['"]\s*(?:\)\s*)+\.(?:getText\(\)|text)/
    );
    if (selAssertMatch1) {
      const selector = normalizeByLocator(selAssertMatch1[2], selAssertMatch1[3]);
      steps.push(buildAssertionStep(nextIdx, selector, selAssertMatch1[1], stableMs, tolerance, upgradesApplied));
      continue;
    }

    const selAssertMatch2 = line.match(
      /assert(?:Equals|Equal|_equal)\(\s*driver\.find(?:Element|_element)\(\s*By\.([a-zA-Z_]+)\s*(?:\(|,\s*)['"]([^'"]+)['"]\s*(?:\)\s*)+\.(?:getText\(\)|text)\s*,\s*['"]([^'"]+)['"]/
    );
    if (selAssertMatch2) {
      const selector = normalizeByLocator(selAssertMatch2[1], selAssertMatch2[2]);
      steps.push(buildAssertionStep(nextIdx, selector, selAssertMatch2[3], stableMs, tolerance, upgradesApplied));
      continue;
    }

    // 4. Playwright expect(page.locator('#x')).toHaveText('val') / toContainText / toHaveValue
    const pwExpectMatch = line.match(
      /expect\(\s*page\.(locator|getByTestId)\(\s*['"]([^'"]+)['"]\s*\)\s*\)\.(?:toHaveText|toContainText|toHaveValue)\(\s*['"]([^'"]+)['"]\s*\)/
    );
    if (pwExpectMatch) {
      const selector =
        pwExpectMatch[1] === 'getByTestId' ? `[data-testid="${pwExpectMatch[2]}"]` : pwExpectMatch[2];
      steps.push(buildAssertionStep(nextIdx, selector, pwExpectMatch[3], stableMs, tolerance, upgradesApplied));
      continue;
    }

    // 5. Playwright locator actions: page.locator('#x').fill('val') / type / click / selectOption
    const pwLocatorMatch = line.match(
      /page\.(locator|getByTestId)\(\s*['"]([^'"]+)['"]\s*\)\.(fill|type|click|selectOption)\(\s*(?:['"]([^'"]*)['"])?\s*\)/
    );
    if (pwLocatorMatch) {
      const selector =
        pwLocatorMatch[1] === 'getByTestId' ? `[data-testid="${pwLocatorMatch[2]}"]` : pwLocatorMatch[2];
      const act = pwLocatorMatch[3];
      const val = pwLocatorMatch[4] ?? '';
      if (act === 'click') {
        steps.push({ id: `step-${nextIdx}`, title: `Click ${selector}`, selector, action: 'click' });
      } else if (act === 'selectOption') {
        steps.push({ id: `step-${nextIdx}`, title: `Select "${val}" in ${selector}`, selector, action: 'select', value: val });
      } else {
        upgradesApplied.push(
          `Upgraded Playwright .${act}() on "${selector}" to zero-driver in-browser $T('${selector}').type('${val}').`
        );
        steps.push({ id: `step-${nextIdx}`, title: `Type "${val}" into ${selector}`, selector, action: 'type', value: val });
      }
      continue;
    }

    // 6. Puppeteer / Playwright direct page methods: page.type('#x', 'val'), page.fill('#x', 'val'), page.click('#x'), page.select('#x', 'val')
    const pageDirectMatch = line.match(
      /page\.(type|fill|click|select|selectOption)\(\s*['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]*)['"])?\s*\)/
    );
    if (pageDirectMatch) {
      const act = pageDirectMatch[1];
      const selector = pageDirectMatch[2];
      const val = pageDirectMatch[3] ?? '';
      if (act === 'click') {
        steps.push({ id: `step-${nextIdx}`, title: `Click ${selector}`, selector, action: 'click' });
      } else if (act === 'select' || act === 'selectOption') {
        steps.push({ id: `step-${nextIdx}`, title: `Select "${val}" in ${selector}`, selector, action: 'select', value: val });
      } else {
        upgradesApplied.push(
          `Upgraded ${detectedFramework} page.${act}('${selector}') to framework-safe $T('${selector}').type('${val}').`
        );
        steps.push({ id: `step-${nextIdx}`, title: `Type "${val}" into ${selector}`, selector, action: 'type', value: val });
      }
      continue;
    }

    // 7. Puppeteer $eval assertion (inline or 2-line variable assignment + expect(varName).toBe('val'))
    const pupEvalVarMatch = line.match(
      /(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:await\s+)?page\.\$eval\(\s*['"]([^'"]+)['"]/
    );
    if (pupEvalVarMatch && !/(?:toBe|toEqual|equal)\s*\(/.test(line)) {
      varSelectorMap.set(pupEvalVarMatch[1], pupEvalVarMatch[2]);
      continue;
    }

    const pupEvalInlineMatch = line.match(
      /page\.\$eval\(\s*['"]([^'"]+)['"][^)]+\).*?(?:toBe|toEqual|equal)\(\s*['"]([^'"]+)['"]\s*\)/
    );
    if (pupEvalInlineMatch) {
      steps.push(buildAssertionStep(nextIdx, pupEvalInlineMatch[1], pupEvalInlineMatch[2], stableMs, tolerance, upgradesApplied));
      continue;
    }

    const varExpectMatch = line.match(
      /expect\(\s*([a-zA-Z0-9_]+)\s*\)\.(?:toBe|toEqual)\(\s*['"]([^'"]+)['"]\s*\)/
    );
    if (varExpectMatch && varSelectorMap.has(varExpectMatch[1])) {
      const selector = varSelectorMap.get(varExpectMatch[1])!;
      steps.push(buildAssertionStep(nextIdx, selector, varExpectMatch[2], stableMs, tolerance, upgradesApplied));
      continue;
    }

    // 8. Cypress: cy.get('#x').type('val') / .click() / .select('val') / .should('have.text', 'val')
    const cyShouldMatch = line.match(
      /cy\.get\(\s*['"]([^'"]+)['"]\s*\)\.should\(\s*['"](?:have\.text|contain|contain\.text|have\.value)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/
    );
    if (cyShouldMatch) {
      steps.push(buildAssertionStep(nextIdx, cyShouldMatch[1], cyShouldMatch[2], stableMs, tolerance, upgradesApplied));
      continue;
    }

    const cyActionMatch = line.match(
      /cy\.get\(\s*['"]([^'"]+)['"]\s*\)\.(type|click|select)\(\s*(?:['"]([^'"]*)['"])?\s*\)/
    );
    if (cyActionMatch) {
      const selector = cyActionMatch[1];
      const act = cyActionMatch[2] as WorkflowActionType;
      const val = cyActionMatch[3] ?? '';
      if (act === 'click') {
        steps.push({ id: `step-${nextIdx}`, title: `Click ${selector}`, selector, action: 'click' });
      } else if (act === 'select') {
        steps.push({ id: `step-${nextIdx}`, title: `Select "${val}" in ${selector}`, selector, action: 'select', value: val });
      } else {
        upgradesApplied.push(
          `Upgraded Cypress cy.get('${selector}').type() to zero-driver $T('${selector}').type('${val}').`
        );
        steps.push({ id: `step-${nextIdx}`, title: `Type "${val}" into ${selector}`, selector, action: 'type', value: val });
      }
      continue;
    }

    // 9. Variable-based actions (e.g., promoInput.sendKeys("VIP") or submitBtn.click())
    const varActMatch = line.match(/^([a-zA-Z0-9_]+)\.(sendKeys|send_keys|fill|type|click)\(\s*(?:['"]([^'"]*)['"])?\s*\)/);
    if (varActMatch && varSelectorMap.has(varActMatch[1])) {
      const selector = varSelectorMap.get(varActMatch[1])!;
      const act = varActMatch[2];
      const val = varActMatch[3] ?? '';
      if (act === 'click') {
        steps.push({ id: `step-${nextIdx}`, title: `Click ${selector}`, selector, action: 'click' });
      } else {
        steps.push({ id: `step-${nextIdx}`, title: `Type "${val}" into ${selector}`, selector, action: 'type', value: val });
      }
    }
  }

  const toJsLiteral = (raw: unknown): string =>
    JSON.stringify(String(raw ?? ''))
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

  const safeTol = Number.isFinite(tolerance) ? tolerance : 0.01;
  const safeStableMs = Number.isFinite(stableMs) ? stableMs : 250;

  const fluentLines = steps.map((s) => {
    const selLit = toJsLiteral(s.selector);
    const valLit = toJsLiteral(s.value ?? '');
    if (s.action === 'click') return `await $T(${selLit}).click();`;
    if (s.action === 'type') return `await $T(${selLit}).type(${valLit});`;
    if (s.action === 'select') return `await $T(${selLit}).select(${valLit});`;
    if (s.action === 'assertCurrency') {
      return `await $T(${selLit}).assertCurrency(${valLit}, { tolerance: ${safeTol}, mode: 'stable', stableMs: ${safeStableMs} });`;
    }
    if (s.action === 'assertBasisPoints') {
      return `await $T(${selLit}).assertBasisPoints(${valLit}, { tolerance: ${safeTol}, mode: 'stable', stableMs: ${safeStableMs} });`;
    }
    return `await $T(${selLit}).assertText(${valLit});`;
  });

  const code = fluentLines.join('\n');
  return {
    detectedFramework,
    workflowName,
    steps,
    fluentCode: code,
    generatedCode: code,
    manifestJson: JSON.stringify({ name: workflowName, framework: detectedFramework, steps }, null, 2),
    upgradesApplied
  };
}

export const digest = {
  detectLegacyFramework,
  digestScript
};
