/**
 * @aventine/testudo - Interactive DOM Explorer & Smart Scoping
 * Scans DOM for actionable elements, generates resilient code snippets, and provides visual badges.
 * Built for junior testers and rapid test automation.
 * Zero external dependencies.
 */

export interface ScannedElement {
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
  element: HTMLElement;
}

export interface ResolveScopeOptions {
  cascadeAll?: boolean;
}

export interface ResolveElementOptions {
  requireUnique?: boolean;
}

/**
 * Normalizes a CSS selector to escape numeric-prefixed #id or .class tokens so standard querySelectorAll works cleanly.
 */
export function normalizeCssSelector(selector: string): string {
  const clean = selector.trim();
  if (!clean) return clean;

  if (clean.startsWith('#') && !/[\s>.+\[~:]/.test(clean.slice(1))) {
    const rawId = clean.slice(1);
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return `#${CSS.escape(rawId)}`;
    }
    return `[id="${rawId.replace(/"/g, '\\"')}"]`;
  }

  if (clean.startsWith('.') && !/[\s>.+\[~:#]/.test(clean.slice(1))) {
    const rawClass = clean.slice(1);
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return `.${CSS.escape(rawClass)}`;
    }
  }

  return clean;
}

/**
 * Resolves a single DOM element from a standards-compliant CSS selector or HTMLElement.
 * When options.requireUnique is true, throws an explicit ambiguity error if the selector matches > 1 visible element.
 */
export function resolveElement(
  selectorOrElement: string | HTMLElement,
  root?: Document | Element | null,
  options: ResolveElementOptions = {}
): HTMLElement | null {
  if (!selectorOrElement) return null;
  if (typeof selectorOrElement !== 'string') return selectorOrElement;
  const doc = root || (typeof document !== 'undefined' ? document : null);
  if (!doc) return null;

  const clean = selectorOrElement.trim();
  if (!clean) return null;

  const normalized = normalizeCssSelector(clean);
  let matches: HTMLElement[] = [];

  try {
    matches = Array.from(doc.querySelectorAll(normalized)) as HTMLElement[];
  } catch {
    if (clean.startsWith('#') && 'getElementById' in doc && typeof doc.getElementById === 'function') {
      const byId = doc.getElementById(clean.slice(1));
      if (byId) matches = [byId as HTMLElement];
    } else {
      throw new Error(`[Testudo] Invalid CSS selector: "${clean}"`);
    }
  }

  if (matches.length === 0) {
    return null;
  }

  if (options.requireUnique && matches.length > 1) {
    throw new Error(
      `[Testudo] Ambiguous selector "${clean}" matched ${matches.length} elements. Refusing to execute action on ambiguous target.`
    );
  }

  return matches[0];
}

export class TestudoScan {
  private activeBadges: HTMLElement[] = [];

  /**
   * Safely queries attributes with case-insensitive matching.
   * Uses native CSS4 [attr="value" i] with graceful fallback for Safari 16.
   */
  private safeQueryAttr(attr: string, value: string, partial: boolean = false): HTMLElement[] {
    const escapedVal = value.replace(/"/g, '\\"');
    const selector = partial ? `[${attr}*="${escapedVal}" i]` : `[${attr}="${escapedVal}" i]`;
    try {
      const found = document.querySelectorAll(selector);
      if (found.length > 0) return Array.from(found) as HTMLElement[];
    } catch {
      // Fallback for Safari 16 / older WebKit engines lacking CSS4 'i' flag
      const all = document.querySelectorAll(`[${attr}]`);
      const lower = value.toLowerCase();
      const matched: HTMLElement[] = [];
      all.forEach((el) => {
        const val = el.getAttribute(attr)?.toLowerCase() || '';
        if (partial ? val.includes(lower) : val === lower) {
          matched.push(el as HTMLElement);
        }
      });
      return matched;
    }
    return [];
  }

  /**
   * Deterministic Smart Scope Resolver.
   * Resolves plain words (e.g. 'contact' or 'modal' or 'form.contact') into target container elements.
   * Priority cascade: data-testid > data-test > data-demo-id > id > name > aria-label > heading text > class > tag.
   * Stops at the highest matching priority level by default (set options.cascadeAll = true to union all levels).
   */
  public resolveScope(
    scopeQuery?: string | HTMLElement,
    options: ResolveScopeOptions = {}
  ): HTMLElement[] {
    if (typeof document === 'undefined') return [];
    if (!scopeQuery) return [document.body];
    if (typeof scopeQuery !== 'string') return [scopeQuery];

    const clean = scopeQuery.trim();
    if (!clean) return [document.body];
    const { cascadeAll = false } = options;

    // 1. Direct standard CSS selector check (e.g. #contact, .modal, form[name="checkout"])
    if (
      clean.startsWith('#') ||
      clean.startsWith('.') ||
      clean.includes('[') ||
      clean.includes('>')
    ) {
      const normalized = normalizeCssSelector(clean);
      try {
        const found = document.querySelectorAll(normalized);
        if (found.length > 0) return Array.from(found) as HTMLElement[];
      } catch {
        const single = resolveElement(clean);
        if (single) return [single];
      }
    }

    // 2. Handle dot-notation: e.g. "form.contact"
    if (clean.includes('.')) {
      const parts = clean.split('.');
      const tag = parts[0];
      const ident = parts[1];
      const selector = `${tag}#${ident}, ${tag}.${ident}, ${tag}[name="${ident}"]`;
      try {
        const found = document.querySelectorAll(selector);
        if (found.length > 0) return Array.from(found) as HTMLElement[];
      } catch {
        // Continue to cascade
      }
    }

    // 3. Deterministic Priority Cascade for plain words (stops at highest matching tier unless cascadeAll=true)
    const candidates: HTMLElement[] = [];

    // Priority 1: data-testid
    const byTestId = this.safeQueryAttr('data-testid', clean);
    if (byTestId.length > 0) {
      if (!cascadeAll) return Array.from(new Set(byTestId));
      candidates.push(...byTestId);
    }

    // Priority 2: data-test
    const byDataTest = this.safeQueryAttr('data-test', clean);
    if (byDataTest.length > 0) {
      if (!cascadeAll) return Array.from(new Set(byDataTest));
      candidates.push(...byDataTest);
    }

    // Priority 2b: data-demo-id
    const byDemoId = this.safeQueryAttr('data-demo-id', clean);
    if (byDemoId.length > 0) {
      if (!cascadeAll) return Array.from(new Set(byDemoId));
      candidates.push(...byDemoId);
    }

    // Priority 3: id (strict exact match only)
    const byId = document.getElementById(clean) || this.safeQueryAttr('id', clean, false)[0];
    if (byId) {
      if (!cascadeAll) return [byId as HTMLElement];
      candidates.push(byId as HTMLElement);
    }

    // Priority 4: name attribute
    const byName = this.safeQueryAttr('name', clean);
    if (byName.length > 0) {
      if (!cascadeAll) return Array.from(new Set(byName));
      candidates.push(...byName);
    }

    // Priority 5: aria-label
    const byAria = this.safeQueryAttr('aria-label', clean, true);
    if (byAria.length > 0) {
      if (!cascadeAll) return Array.from(new Set(byAria));
      candidates.push(...byAria);
    }

    // Priority 6: heading text (h1..h6)
    const headingContainers: HTMLElement[] = [];
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (const h of Array.from(headings)) {
      if (h.textContent?.toLowerCase().includes(clean.toLowerCase())) {
        const container = h.closest('section, form, div, main, article') || h.parentElement;
        if (container) headingContainers.push(container as HTMLElement);
      }
    }
    if (headingContainers.length > 0) {
      if (!cascadeAll) return Array.from(new Set(headingContainers));
      candidates.push(...headingContainers);
    }

    // Priority 7: class name (escapes numeric prefixes / special chars)
    try {
      const escapedClass = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(clean) : clean;
      const byClass = document.querySelectorAll(`.${escapedClass}`);
      if (byClass.length > 0) {
        const arr = Array.from(byClass) as HTMLElement[];
        if (!cascadeAll) return Array.from(new Set(arr));
        candidates.push(...arr);
      }
    } catch {
      // Gracefully ignore invalid CSS selector
    }

    // Priority 8: tag name (e.g. 'form', 'table', 'nav', 'header')
    try {
      const byTag = document.querySelectorAll(clean);
      if (byTag.length > 0) {
        const arr = Array.from(byTag) as HTMLElement[];
        if (!cascadeAll) return Array.from(new Set(arr));
        candidates.push(...arr);
      }
    } catch {
      // Gracefully ignore invalid tag selector
    }

    if (candidates.length > 0) {
      return Array.from(new Set(candidates));
    }

    return [document.body];
  }

  /**
   * Builds a standards-compliant, unique CSS selector for an element.
   */
  private buildUniqueCssSelector(el: HTMLElement): string {
    const tag = el.tagName.toLowerCase();
    const testId = el.getAttribute('data-testid');
    const dataTest = el.getAttribute('data-test');
    const demoId = el.getAttribute('data-demo-id');
    const id = el.id;
    const name = (el as HTMLInputElement).name;
    const ariaLabel = el.getAttribute('aria-label');

    const isUnique = (sel: string): boolean => {
      try {
        return document.querySelectorAll(normalizeCssSelector(sel)).length === 1;
      } catch {
        return false;
      }
    };

    if (testId) {
      const sel = `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
      if (isUnique(sel)) return sel;
    }
    if (dataTest) {
      const sel = `[data-test="${dataTest.replace(/"/g, '\\"')}"]`;
      if (isUnique(sel)) return sel;
    }
    if (demoId) {
      const sel = `[data-demo-id="${demoId.replace(/"/g, '\\"')}"]`;
      if (isUnique(sel)) return sel;
    }
    if (id) {
      const sel = `#${id}`;
      if (isUnique(sel)) return sel;
    }
    if (name) {
      const sel = `${tag}[name="${name.replace(/"/g, '\\"')}"]`;
      if (isUnique(sel)) return sel;
    }
    if (ariaLabel) {
      const sel = `${tag}[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;
      if (isUnique(sel)) return sel;
    }

    const firstClass =
      typeof el.className === 'string' && el.className.trim()
        ? el.className.trim().split(/\s+/)[0]
        : '';
    if (firstClass) {
      const candidate = `${tag}.${firstClass}`;
      if (isUnique(candidate)) return candidate;
    }

    // Build structural CSS path (standards-compliant nth-of-type) to guarantee uniqueness
    const segments: string[] = [];
    let current: HTMLElement | null = el;
    while (current && current !== document.body && current !== document.documentElement) {
      const cTag = current.tagName.toLowerCase();
      if (current.id) {
        const idSel = `#${current.id}`;
        segments.unshift(idSel);
        break;
      }
      const parent: HTMLElement | null = current.parentElement;
      if (!parent) {
        segments.unshift(cTag);
        break;
      }
      const sameTagSiblings = Array.from(parent.children).filter(
        (child: Element) => child.tagName.toLowerCase() === cTag
      );
      if (sameTagSiblings.length > 1) {
        const nth = sameTagSiblings.indexOf(current) + 1;
        segments.unshift(`${cTag}:nth-of-type(${nth})`);
      } else {
        segments.unshift(cTag);
      }
      current = parent;
    }
    return segments.join(' > ') || tag;
  }

  /**
   * Determines the appropriate action ('click' | 'type' | 'select') and executable snippet for an element.
   */
  private buildActionSnippet(el: HTMLElement, selector: string): { action: 'click' | 'type' | 'select'; snippet: string } {
    const tag = el.tagName.toLowerCase();
    const inputType = ((el as HTMLInputElement).type || 'text').toLowerCase();
    const safeSel = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    if (tag === 'select') {
      const selectEl = el as HTMLSelectElement;
      let optVal = 'option';
      if (selectEl.options && selectEl.options.length > 0) {
        const nonEmpty = Array.from(selectEl.options).find((o) => o.value && o.value !== 'none');
        optVal = (nonEmpty ? nonEmpty.value : selectEl.options[0].value) || 'option';
      }
      const safeOpt = optVal.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return {
        action: 'select',
        snippet: `await $T('${safeSel}').select('${safeOpt}');`
      };
    }

    const nonTypingInputs = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file', 'color', 'range']);
    if (tag === 'textarea' || (tag === 'input' && !nonTypingInputs.has(inputType))) {
      return {
        action: 'type',
        snippet: `await $T('${safeSel}').type('example');`
      };
    }

    return {
      action: 'click',
      snippet: `await $T('${safeSel}').click();`
    };
  }

  /**
   * Scans a target scope and returns all actionable interactive elements with resilient snippets.
   */
  public scan(scopeQuery?: string | HTMLElement): ScannedElement[] {
    const scopes = this.resolveScope(scopeQuery);
    if (scopes.length === 0) return [];

    const results: ScannedElement[] = [];
    const seen = new Set<HTMLElement>();
    const interactiveQuery =
      'button, input, select, textarea, a[href], [role="button"], [role="link"], [role="tab"], [onclick]';

    let index = 1;
    for (const scope of scopes) {
      const nodeList = scope.matches && scope.matches(interactiveQuery)
        ? [scope, ...Array.from(scope.querySelectorAll(interactiveQuery))]
        : Array.from(scope.querySelectorAll(interactiveQuery));

      for (const rawEl of nodeList) {
        const el = rawEl as HTMLElement;
        if (seen.has(el)) continue;
        seen.add(el);

        // Skip hidden elements (zero dimensions, display: none, or visibility: hidden)
        if (el.offsetWidth === 0 && el.offsetHeight === 0) continue;
        if (typeof window !== 'undefined' && window.getComputedStyle) {
          const style = window.getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none') continue;
        }

        const tag = el.tagName.toLowerCase();
        const type = (el as HTMLInputElement).type;
        const name = (el as HTMLInputElement).name;
        const id = el.id;
        const role = el.getAttribute('role') || undefined;
        const ariaLabel = el.getAttribute('aria-label') || undefined;
        const text = (el.innerText || el.textContent || '')?.trim().replace(/\s+/g, ' ').slice(0, 30);

        // 1. Build standards-compliant, unique CSS selector
        const selector = this.buildUniqueCssSelector(el);

        // 2. Build element-appropriate executable action snippet (.click, .type, .select)
        const { action, snippet } = this.buildActionSnippet(el, selector);

        results.push({
          index: index++,
          tag,
          type,
          name,
          id,
          label: ariaLabel,
          role,
          text,
          action,
          selector,
          snippet,
          element: el
        });
      }
    }

    return results;
  }

  /**
   * Renders visual numbered badges [1], [2], [3] over all interactive elements.
   * Includes production kill switch.
   */
  public explore(scopeQuery?: string | HTMLElement): void {
    if (typeof document === 'undefined') return;

    // Production Guard Kill Switch (supports both Bundler static replacement and Browser CDN environments)
    const globalObj = typeof globalThis !== 'undefined' ? (globalThis as any) : (window as any);
    const isNodeProd = globalObj.process?.env?.NODE_ENV === 'production';
    const isBrowserProd = globalObj.TESTUDO_ENV === 'production' || globalObj.TESTUDO_DISABLE_EXPLORER === true;

    if (isNodeProd || isBrowserProd) {
      if (!globalObj.__ENABLE_TESTUDO__) {
        console.warn('[Testudo] $T.explore() disabled in production mode.');
        return;
      }
    }

    // Dismiss existing badges if already open
    if (this.activeBadges.length > 0) {
      this.clearBadges();
      return;
    }

    const items = this.scan(scopeQuery);
    for (const item of items) {
      const rect = item.element.getBoundingClientRect();
      const badge = document.createElement('div');
      badge.className = 'testudo-badge';
      badge.setAttribute('data-testudo-badge', 'true');
      badge.style.cssText = `
        position: absolute;
        top: ${rect.top + window.scrollY}px;
        left: ${rect.left + window.scrollX}px;
        background: #2563EB;
        color: #FFFFFF;
        font-family: monospace;
        font-size: 11px;
        font-weight: bold;
        padding: 2px 6px;
        border-radius: 4px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        z-index: 100000;
        cursor: pointer;
      `;
      badge.innerText = `[${item.index}]`;
      badge.title = `${item.selector} - Click to copy: ${item.snippet}`;

      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        if (navigator.clipboard) {
          navigator.clipboard.writeText(item.snippet);
          badge.style.background = '#10B981'; // Green on copy
          badge.innerText = `✓ Copied!`;
          setTimeout(() => {
            badge.style.background = '#2563EB';
            badge.innerText = `[${item.index}]`;
          }, 1500);
        }
      });

      document.body.appendChild(badge);
      this.activeBadges.push(badge);
    }
  }

  /**
   * Clears all visual explorer badges from the page.
   */
  public clearBadges(): void {
    for (const b of this.activeBadges) {
      b.remove();
    }
    this.activeBadges = [];
  }
}

export const scan = new TestudoScan();

