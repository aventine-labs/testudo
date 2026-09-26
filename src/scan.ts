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
  selector: string;
  snippet: string;
  element: HTMLElement;
}

export class TestudoScan {
  private activeBadges: HTMLElement[] = [];

  /**
   * Safely queries attributes with case-insensitive matching.
   * Uses native CSS4 [attr="value" i] with graceful fallback for Safari 16.
   */
  private safeQueryAttr(attr: string, value: string, partial: boolean = false): HTMLElement[] {
    const selector = partial ? `[${attr}*="${value}" i]` : `[${attr}="${value}" i]`;
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
   * Priority cascade: data-testid > data-test > id > name > aria-label > heading text > class > tag.
   */
  public resolveScope(scopeQuery?: string | HTMLElement): HTMLElement[] {
    if (typeof document === 'undefined') return [];
    if (!scopeQuery) return [document.body];
    if (typeof scopeQuery !== 'string') return [scopeQuery];

    const clean = scopeQuery.trim();

    // 1. Direct standard CSS selector check (e.g. #contact, .modal, form[name="checkout"])
    if (
      clean.startsWith('#') ||
      clean.startsWith('.') ||
      clean.includes('[') ||
      clean.includes('>')
    ) {
      const found = document.querySelectorAll(clean);
      if (found.length > 0) return Array.from(found) as HTMLElement[];
    }

    // 2. Handle dot-notation: e.g. "form.contact"
    if (clean.includes('.')) {
      const parts = clean.split('.');
      const tag = parts[0];
      const ident = parts[1];
      const selector = `${tag}#${ident}, ${tag}.${ident}, ${tag}[name="${ident}"]`;
      const found = document.querySelectorAll(selector);
      if (found.length > 0) return Array.from(found) as HTMLElement[];
    }

    // 3. Deterministic Priority Cascade for plain words (e.g. 'contact')
    const candidates: HTMLElement[] = [];

    // Priority 1: data-testid
    const byTestId = this.safeQueryAttr('data-testid', clean);
    if (byTestId.length > 0) candidates.push(...byTestId);

    // Priority 2: data-test
    const byDataTest = this.safeQueryAttr('data-test', clean);
    if (byDataTest.length > 0) candidates.push(...byDataTest);

    // Priority 3: id (strict exact match only)
    const byId = document.getElementById(clean) || this.safeQueryAttr('id', clean, false)[0];
    if (byId) candidates.push(byId as HTMLElement);

    // Priority 4: name attribute
    const byName = this.safeQueryAttr('name', clean);
    if (byName.length > 0) candidates.push(...byName);

    // Priority 5: aria-label
    const byAria = this.safeQueryAttr('aria-label', clean, true);
    if (byAria.length > 0) candidates.push(...byAria);

    // Priority 6: heading text (h1..h6)
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (const h of Array.from(headings)) {
      if (h.textContent?.toLowerCase().includes(clean.toLowerCase())) {
        const container = h.closest('section, form, div, main, article') || h.parentElement;
        if (container) candidates.push(container as HTMLElement);
      }
    }

    // Priority 7: class name (escapes numeric prefixes / special chars)
    try {
      const escapedClass = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(clean) : clean;
      const byClass = document.querySelectorAll(`.${escapedClass}`);
      if (byClass.length > 0) candidates.push(...(Array.from(byClass) as HTMLElement[]));
    } catch {
      // Gracefully ignore invalid CSS selector
    }

    // Priority 8: tag name (e.g. 'form', 'table', 'nav', 'header')
    try {
      const byTag = document.querySelectorAll(clean);
      if (byTag.length > 0) candidates.push(...(Array.from(byTag) as HTMLElement[]));
    } catch {
      // Gracefully ignore invalid tag selector
    }

    if (candidates.length > 0) {
      // Deduplicate elements
      return Array.from(new Set(candidates));
    }

    return [document.body];
  }

  /**
   * Scans a target scope and returns all actionable interactive elements with resilient snippets.
   */
  public scan(scopeQuery?: string | HTMLElement): ScannedElement[] {
    const scopes = this.resolveScope(scopeQuery);
    if (scopes.length === 0) return [];

    const results: ScannedElement[] = [];
    const interactiveQuery =
      'button, input, select, textarea, a[href], [role="button"], [role="link"], [role="tab"], [onclick]';

    let index = 1;
    for (const scope of scopes) {
      const elements = scope.querySelectorAll(interactiveQuery);
      for (const el of Array.from(elements) as HTMLElement[]) {
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
        const text = el.innerText?.trim().slice(0, 30);
        const testId = el.getAttribute('data-testid');

        // Build resilient selector & snippet
        let selector = '';
        let snippet = '';

        if (testId) {
          selector = `[data-testid="${testId}"]`;
          snippet = `await $T('${selector}').click();`;
        } else if (id) {
          selector = `#${id}`;
          snippet = `await $T('${selector}').click();`;
        } else if (name) {
          selector = `${tag}[name="${name}"]`;
          if (tag === 'input' && type !== 'submit' && type !== 'button') {
            snippet = `await $T('${selector}').type('example');`;
          } else {
            snippet = `await $T('${selector}').click();`;
          }
        } else if (text && (tag === 'button' || role === 'button')) {
          selector = `button:has-text("${text}")`;
          snippet = `await $T('${selector}').click();`;
        } else {
          selector = `${tag}${el.className ? '.' + el.className.split(' ')[0] : ''}`;
          snippet = `await $T('${selector}').click();`;
        }

        results.push({
          index: index++,
          tag,
          type,
          name,
          id,
          role,
          text,
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
