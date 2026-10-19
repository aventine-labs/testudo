/**
 * @aventine/testudo - Playwright Fixture & In-Page Bridge Adapter
 * Bridges Node.js Playwright test runner with in-browser Testudo DOM scanner, visual forensics HUD,
 * and Playwright-native locator interactions.
 * Zero external dependencies.
 */

import { testudoMatchers } from '../matchers.js';
import { math } from '../math.js';
import { format } from '../format.js';
import { type, TypeOptions } from '../type.js';
import { visual, VisualErrorOptions } from '../visual.js';
import { calc } from '../calc.js';
import { reporter } from '../report.js';

export interface SerializedScannedElement {
  index: number;
  tag: string;
  type?: string;
  name?: string;
  id?: string;
  label?: string;
  role?: string;
  text?: string;
  action: 'click' | 'type' | 'select';
  selector: string;
  snippet: string;
}

export interface TestudoPlaywrightSelector {
  click: () => Promise<void>;
  type: (text: string, options?: TypeOptions) => Promise<void>;
  select: (value: string) => Promise<void>;
  highlight: (label?: string, color?: string) => Promise<void>;
  highlightError: (message?: string, options?: VisualErrorOptions) => Promise<any>;
  assertCurrency: (
    expected: string | number,
    options?: { tolerance?: number; message?: string; screenshotPath?: string }
  ) => Promise<{ pass: boolean; expected: number; actual: number; delta: number }>;
  assertText: (
    expected: string,
    options?: { screenshotPath?: string }
  ) => Promise<{ pass: boolean; expected: string; actual: string }>;
}

export interface TestudoPlaywrightBridge {
  (selector: string): TestudoPlaywrightSelector;
  math: typeof math;
  format: typeof format;
  type: (selector: string, text: string, options?: TypeOptions) => Promise<void>;
  click: (selector: string) => Promise<void>;
  select: (selector: string, value: string) => Promise<void>;
  scan: (scope?: string) => Promise<SerializedScannedElement[]>;
  explore: (scope?: string) => Promise<number>;
  clearBadges: () => Promise<void>;
  cleanup: () => Promise<void>;
  highlightError: (selector: string, options?: VisualErrorOptions) => Promise<any>;
  calc: (expression: string) => {
    evaluate: () => Promise<any>;
    toEqualCurrency: (
      targetSelectorOrValue: string | number,
      options?: { tolerance?: number; autoHighlight?: boolean; screenshotPath?: string }
    ) => Promise<any>;
  };
  visual: typeof visual;
  reporter: typeof reporter;
}

export interface TestudoFixture {
  $T: TestudoPlaywrightBridge;
}

let matchersRegistered = false;

function ensureMatchersRegistered(): void {
  if (matchersRegistered) return;
  try {
    const g = globalThis as any;
    if (g.expect && typeof g.expect.extend === 'function') {
      g.expect.extend(testudoMatchers);
      matchersRegistered = true;
    }
  } catch {
    // Fallback
  }
}

export async function ensureInPageBridge(page: any): Promise<void> {
  if (!page || typeof page.evaluate !== 'function') return;
  await page.evaluate(() => {
    const win = window as any;
    if (win.__TESTUDO_INPAGE__) return;

    const COLORS = new Set(['red', 'crimson', 'orange', 'amber', 'yellow', 'green', 'emerald', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'violet', 'pink', 'white', 'black']);
    const safeColor = (c?: string, fb = '#EF4444') => {
      const t = (c || '').trim();
      if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(t)) return t;
      return COLORS.has(t.toLowerCase()) ? t.toLowerCase() : fb;
    };

    const resolveEl = (sel: string) => document.querySelector(sel.trim()) as HTMLElement | null;

    const cleanupOverlays = () => {
      document.querySelectorAll('[data-testudo-overlay]').forEach((el) => el.remove());
      document.querySelectorAll('[data-testudo-outlined]').forEach((el) => {
        const h = el as HTMLElement;
        h.style.removeProperty('outline');
        h.style.removeProperty('outline-offset');
        h.style.removeProperty('box-shadow');
        el.removeAttribute('data-testudo-outlined');
      });
    };

    const highlightStep = (sel: string, label?: string, color = '#10B981') => {
      const el = resolveEl(sel);
      if (!el) return false;
      const clr = safeColor(color, '#10B981');
      el.scrollIntoView?.({ behavior: 'instant' as any, block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      const box = document.createElement('div');
      box.setAttribute('data-testudo-overlay', 'true');
      box.setAttribute('data-testudo-step-box', 'true');
      box.style.cssText = `position:absolute;top:${r.top + window.scrollY - 4}px;left:${r.left + window.scrollX - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;border:2px solid ${clr};border-radius:6px;box-shadow:0 0 14px ${clr}66;pointer-events:none;z-index:99997;box-sizing:border-box;`;
      if (label) {
        const pill = document.createElement('div');
        pill.style.cssText = `position:absolute;top:-20px;left:-2px;background:${clr};color:#030712;font:800 10px monospace;padding:1px 6px;border-radius:4px;white-space:nowrap;`;
        pill.textContent = label;
        box.appendChild(pill);
      }
      document.body.appendChild(box);
      return true;
    };

    const highlightError = (sel: string, opts: any = {}) => {
      cleanupOverlays();
      const el = resolveEl(sel);
      if (!el) return { diff: null };
      const clr = safeColor(opts.color, '#EF4444');
      const msg = String(opts.message || 'Assertion Failed');
      const exp = String(opts.expected || '');
      const act = String(opts.actual || '');
      if (opts.autoScroll !== false) el.scrollIntoView?.({ behavior: 'instant' as any, block: 'center', inline: 'center' });

      el.setAttribute('data-testudo-outlined', 'true');
      el.style.setProperty('outline', `3px solid ${clr}`, 'important');
      el.style.setProperty('outline-offset', '3px', 'important');
      el.style.setProperty('box-shadow', `0 0 15px ${clr}BF`, 'important');

      let diff: any = null;
      if (exp && act && exp !== act) {
        let i = 0;
        while (i < exp.length && i < act.length && exp[i] === act[i]) i++;
        const ec = i < exp.length ? exp[i] : 'EOF';
        const ac = i < act.length ? act[i] : 'EOF';
        diff = { index: i, expectedChar: ec, actualChar: ac, message: `Unexpected '${ac}' at index ${i} (expected '${ec}')` };
      }

      const r = el.getBoundingClientRect();
      const hud = document.createElement('div');
      hud.setAttribute('data-testudo-overlay', 'true');
      hud.setAttribute('data-testudo-hud', 'true');
      hud.style.cssText = `position:absolute;top:${Math.max(10, r.top + window.scrollY - 52)}px;left:${r.left + window.scrollX}px;background:#0F172A;color:#F8FAFC;border:2px solid ${clr};border-radius:6px;padding:6px 10px;font:700 12px monospace;box-shadow:0 8px 20px rgba(0,0,0,0.65);pointer-events:none;z-index:100000;white-space:nowrap;`;
      const txt = document.createElement('div');
      txt.textContent = `[TESTUDO FAIL] ${msg}`;
      hud.appendChild(txt);
      if (diff) {
        const dEl = document.createElement('div');
        dEl.style.cssText = 'margin-top:4px;font-size:11px;color:#F87171;';
        dEl.textContent = diff.message;
        hud.appendChild(dEl);
      }
      document.body.appendChild(hud);
      return { diff };
    };

    win.__TESTUDO_INPAGE__ = { resolveEl, cleanupOverlays, highlightStep, highlightError };
  });
}

export function createPlaywrightTestudo(page: any, testInfo?: any): TestudoPlaywrightBridge {
  ensureMatchersRegistered();

  const readNodeText = (sel: string) =>
    page.evaluate((s: string) => {
      const el = document.querySelector(s) as HTMLElement | null;
      if (!el) return '';
      return (el as HTMLInputElement).value !== undefined && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
        ? (el as HTMLInputElement).value
        : el.innerText || el.textContent || '';
    }, sel);

  const selectorApi = (selector: string): TestudoPlaywrightSelector => {
    if (!selector || typeof selector !== 'string') {
      throw new Error('[Testudo Playwright] Selector must be a non-empty string.');
    }

    const assertUniqueLocator = async () => {
      const locator = page.locator(selector);
      const count = await locator.count();
      if (count === 0) throw new Error(`[Testudo] Element not found: ${selector}`);
      if (count > 1) {
        throw new Error(`[Testudo] Ambiguous selector "${selector}" matched ${count} elements.`);
      }
      return locator;
    };

    return {
      click: async () => {
        const locator = await assertUniqueLocator();
        await locator.click();
      },
      type: async (text: string, options: TypeOptions = {}) => {
        const locator = await assertUniqueLocator();
        const formatted = options.mask ? type.applyMask(text, options.mask) : text;
        if (options.clearFirst !== false) {
          await locator.fill(formatted);
        } else {
          await locator.pressSequentially(formatted, { delay: options.delay || 0 });
        }
      },
      select: async (value: string) => {
        const locator = await assertUniqueLocator();
        await locator.selectOption(value);
      },
      highlight: async (label?: string, color: string = '#10B981') => {
        await ensureInPageBridge(page);
        await page.evaluate(
          ({ s, l, c }: any) => (window as any).__TESTUDO_INPAGE__?.highlightStep(s, l, c),
          { s: selector, l: label, c: color }
        );
      },
      highlightError: async (message?: string, options: VisualErrorOptions = {}) => {
        await ensureInPageBridge(page);
        return page.evaluate(
          ({ s, m, o }: any) =>
            ((window as any).$T?.visual || (window as any).__TESTUDO_INPAGE__).highlightError(s, { message: m, ...o }),
          { s: selector, m: message, o: options }
        );
      },
      assertCurrency: async (expected: string | number, options: any = {}) => {
        await assertUniqueLocator();
        const raw = await readNodeText(selector);
        const actualVal = format.parse(raw);
        const expVal = typeof expected === 'number' ? expected : format.parse(expected);
        const tol = options.tolerance ?? 0.01;
        const delta = Math.round((actualVal - expVal) * 1e4) / 1e4;

        if (!math.isCloseTo(actualVal, expVal, tol)) {
          const expFormatted =
            typeof expected === 'string'
              ? expected
              : `$${expVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
          const msg =
            options.message ||
            `Currency mismatch on ${selector}: expected ${expVal}, got ${actualVal} (delta ${delta >= 0 ? '+' : ''}${delta})`;

          const { diff } = await selectorApi(selector).highlightError(msg, {
            expected: expFormatted,
            actual: raw.trim()
          });
          reporter.error(msg, { selector, expected: expVal, actual: actualVal, delta, tolerance: tol, divergenceIndex: diff?.index });
          if (options.screenshotPath && page.screenshot) await page.screenshot({ path: options.screenshotPath, fullPage: false });
          if (testInfo?.attach && page.screenshot) {
            await testInfo.attach('testudo-assertion-failure', { body: await page.screenshot({ fullPage: false }), contentType: 'image/png' });
          }
          throw new Error(`[Testudo Assertion Failed] ${msg} | Expected: "${expFormatted}", Actual: "${raw.trim()}"${diff ? ` | ${diff.message}` : ''}`);
        }
        return { pass: true, expected: expVal, actual: actualVal, delta };
      },
      assertText: async (expected: string, options: any = {}) => {
        await assertUniqueLocator();
        const raw = await readNodeText(selector);
        const normActual = format.normalizeWhitespace(raw.trim());
        const normExpected = format.normalizeWhitespace(expected.trim());

        if (normActual !== normExpected) {
          const msg = `Text mismatch on ${selector}: expected "${normExpected}", got "${normActual}"`;
          const { diff } = await selectorApi(selector).highlightError(msg, { expected: normExpected, actual: normActual });
          reporter.error(msg, { selector, expected: normExpected, actual: normActual, divergenceIndex: diff?.index });
          if (options.screenshotPath && page.screenshot) await page.screenshot({ path: options.screenshotPath, fullPage: false });
          throw new Error(`[Testudo Assertion Failed] ${msg}${diff ? ` | ${diff.message}` : ''}`);
        }
        return { pass: true, expected: normExpected, actual: normActual };
      }
    };
  };

  const bridge: TestudoPlaywrightBridge = Object.assign(selectorApi, {
    math,
    format,
    type: (s: string, t: string, o?: TypeOptions) => selectorApi(s).type(t, o),
    click: (s: string) => selectorApi(s).click(),
    select: (s: string, v: string) => selectorApi(s).select(v),
    scan: async (scope?: string): Promise<SerializedScannedElement[]> => {
      await ensureInPageBridge(page);
      return page.evaluate((sq?: string) => {
        const root = sq
          ? (/^[#.\[]/.test(sq)
              ? document.querySelector(sq)
              : document.querySelector(`[data-testid="${sq}"], [data-test="${sq}"], [data-demo-id="${sq}"], #${sq}`)) || document.body
          : document.body;
        const nodes = root.querySelectorAll('button, input, select, textarea, a[href], [role="button"], [role="link"], [role="tab"], [onclick]');
        const out: any[] = [];
        let idx = 1;
        for (const n of Array.from(nodes)) {
          const el = n as HTMLElement;
          if (el.offsetWidth === 0 && el.offsetHeight === 0) continue;
          const st = window.getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden') continue;
          const tag = el.tagName.toLowerCase();
          const tp = ((el as HTMLInputElement).type || 'text').toLowerCase();
          const tid = el.getAttribute('data-testid');
          const dt = el.getAttribute('data-test');
          const did = el.getAttribute('data-demo-id');
          const id = el.id;
          const nm = (el as HTMLInputElement).name;
          const sel = tid ? `[data-testid="${tid}"]` : dt ? `[data-test="${dt}"]` : did ? `[data-demo-id="${did}"]` : id ? `#${id}` : nm ? `${tag}[name="${nm}"]` : tag;
          const isSel = tag === 'select';
          const isTxt = tag === 'textarea' || (tag === 'input' && !['button', 'submit', 'reset', 'checkbox', 'radio'].includes(tp));
          const action = isSel ? 'select' : isTxt ? 'type' : 'click';
          const opt = isSel ? (el as HTMLSelectElement).options?.[0]?.value || 'option' : 'example';
          const snippet = `await $T('${sel}').${action}(${action === 'click' ? '' : `'${opt}'`});`;
          out.push({ index: idx++, tag, type: tp, name: nm, id, text: (el.innerText || el.textContent || '').trim().slice(0, 30), action, selector: sel, snippet });
        }
        return out;
      }, scope);
    },
    explore: async (scope?: string): Promise<number> => {
      const items = await bridge.scan(scope);
      return page.evaluate((list: SerializedScannedElement[]) => {
        document.querySelectorAll('.testudo-badge').forEach((b) => b.remove());
        for (const it of list) {
          const el = document.querySelector(it.selector) as HTMLElement | null;
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const b = document.createElement('div');
          b.className = 'testudo-badge';
          b.setAttribute('data-testudo-badge', 'true');
          b.style.cssText = `position:absolute;top:${r.top + window.scrollY}px;left:${r.left + window.scrollX}px;background:#2563EB;color:#FFF;font:bold 11px monospace;padding:2px 6px;border-radius:4px;z-index:100000;`;
          b.textContent = `[${it.index}]`;
          document.body.appendChild(b);
        }
        return document.querySelectorAll('.testudo-badge').length;
      }, items);
    },
    clearBadges: () => page.evaluate(() => document.querySelectorAll('.testudo-badge').forEach((b) => b.remove())),
    cleanup: async () => {
      await ensureInPageBridge(page);
      await page.evaluate(() => {
        (window as any).__TESTUDO_INPAGE__?.cleanupOverlays();
        document.querySelectorAll('.testudo-badge').forEach((b) => b.remove());
      });
    },
    highlightError: (s: string, o?: VisualErrorOptions) => selectorApi(s).highlightError(o?.message, o),
    calc: (expression: string) => ({
      evaluate: async () => calc(expression).evaluate(),
      toEqualCurrency: async (target: string | number, options: any = {}) =>
        typeof target === 'string'
          ? selectorApi(target).assertCurrency(calc.evaluate(expression), options)
          : calc(expression).toEqualCurrency(target, options)
    }),
    visual,
    reporter
  });

  return bridge;
}

export const testudoFixture = {
  $T: async ({ page }: { page: any }, use: (r: TestudoPlaywrightBridge) => Promise<void>, testInfo: any) => {
    const inst = createPlaywrightTestudo(page, testInfo);
    await use(inst);
    if (testInfo && testInfo.status !== testInfo.expectedStatus && page?.screenshot && testInfo.attach) {
      try {
        await testInfo.attach('testudo-failure-forensics', { body: await page.screenshot({ fullPage: false }), contentType: 'image/png' });
      } catch {
        // Ignore teardown screenshot errors
      }
    }
  }
};
