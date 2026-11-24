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

export interface ResolveDeepElementOptions extends ResolveElementOptions {
  pierceOpenShadow?: boolean;
  pierceSameOriginIframes?: boolean;
}

function escapeCssIdent(raw: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(raw);
  }
  const str = String(raw);
  const length = str.length;
  if (length === 0) return '';
  let result = '';
  const firstCodeUnit = str.charCodeAt(0);
  for (let index = 0; index < length; index++) {
    const codeUnit = str.charCodeAt(index);
    if (codeUnit === 0x0000) {
      result += '\uFFFD';
      continue;
    }
    if (
      (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
      codeUnit === 0x007f ||
      (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002d)
    ) {
      result += `\\${codeUnit.toString(16)} `;
      continue;
    }
    if (index === 0 && length === 1 && codeUnit === 0x002d) {
      result += `\\${str.charAt(index)}`;
      continue;
    }
    if (
      codeUnit >= 0x0080 ||
      codeUnit === 0x002d ||
      codeUnit === 0x005f ||
      (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
      (codeUnit >= 0x0061 && codeUnit <= 0x007a)
    ) {
      result += str.charAt(index);
      continue;
    }
    result += `\\${str.charAt(index)}`;
  }
  return result;
}

/**
 * Normalizes a CSS selector to escape numeric-prefixed #id or .class tokens so standard querySelectorAll works cleanly.
 */
export function normalizeCssSelector(selector: string): string {
  const clean = selector.trim();
  if (!clean) return clean;

  if (clean.startsWith('#') && !/[\s>.+\[~:]/.test(clean.slice(1))) {
    return `#${escapeCssIdent(clean.slice(1))}`;
  }

  if (clean.startsWith('.') && !/[\s>.+\[~:#]/.test(clean.slice(1))) {
    return `.${escapeCssIdent(clean.slice(1))}`;
  }

  return clean;
}

function queryDeep(sc: any, s: string, sh: boolean, fr: boolean, seen = new Set<any>()): HTMLElement[] {
  if (!sc || seen.has(sc) || typeof sc.querySelectorAll !== 'function') return [];
  seen.add(sc);
  const out: HTMLElement[] = [];
  try {
    for (const el of Array.from(sc.querySelectorAll(s)) as HTMLElement[]) if (!out.includes(el)) out.push(el);
  } catch { /* ignore */ }
  if (sh || fr) {
    for (const n of Array.from(sc.querySelectorAll('*')) as any[]) {
      if (sh && n.shadowRoot) for (const x of queryDeep(n.shadowRoot, s, sh, fr, seen)) if (!out.includes(x)) out.push(x);
      if (fr && n.tagName === 'IFRAME') {
        try { if (n.contentDocument) for (const x of queryDeep(n.contentDocument, s, sh, fr, seen)) if (!out.includes(x)) out.push(x); } catch { /* oopif */ }
      }
    }
  }
  return out;
}

export function resolveDeepElement(
  sel: string | HTMLElement,
  root?: Document | Element | ShadowRoot | null,
  opts: ResolveDeepElementOptions = {}
): HTMLElement | null {
  if (!sel) return null;
  if (typeof sel !== 'string') return sel;
  const base = root || (typeof document !== 'undefined' ? document : null);
  const clean = sel.trim();
  if (!base || !clean) return null;

  let m: HTMLElement[] = [];
  if (clean.includes('>>>')) {
    const parts = clean.split('>>>').map((p) => p.trim()).filter(Boolean);
    let scopes: any[] = [base];
    for (let i = 0; i < parts.length; i++) {
      const seg = normalizeCssSelector(parts[i]);
      const hits: HTMLElement[] = [];
      for (const sc of scopes) for (const h of queryDeep(sc, seg, true, true)) if (!hits.includes(h)) hits.push(h);
      if (!hits.length) return null;
      if (i === parts.length - 1) m = hits;
      else {
        scopes = [];
        for (const h of hits as any[]) {
          if (h.shadowRoot) scopes.push(h.shadowRoot);
          if (h.tagName === 'IFRAME') { try { if (h.contentDocument) scopes.push(h.contentDocument); } catch { /* oopif */ } }
          scopes.push(h);
        }
      }
    }
  } else {
    m = queryDeep(base, normalizeCssSelector(clean), Boolean(opts.pierceOpenShadow), Boolean(opts.pierceSameOriginIframes));
  }
  if (!m.length) return null;
  if (opts.requireUnique && m.length > 1) {
    throw new Error(`[Testudo] Ambiguous selector "${clean}" matched ${m.length} elements. Refusing to execute action on ambiguous target.`);
  }
  return m[0];
}

export function resolveElement(
  sel: string | HTMLElement,
  root?: Document | Element | null,
  opts: ResolveElementOptions = {}
): HTMLElement | null {
  if (!sel) return null;
  if (typeof sel !== 'string') return sel;
  const doc = root || (typeof document !== 'undefined' ? document : null);
  const clean = sel.trim();
  if (!doc || !clean) return null;
  if (clean.includes('>>>')) return resolveDeepElement(clean, doc, { requireUnique: opts.requireUnique, pierceOpenShadow: true, pierceSameOriginIframes: true });
  let m: HTMLElement[] = [];
  try {
    m = Array.from(doc.querySelectorAll(normalizeCssSelector(clean))) as HTMLElement[];
  } catch {
    const byId = clean.startsWith('#') && typeof (doc as Document).getElementById === 'function' ? (doc as Document).getElementById(clean.slice(1)) : null;
    if (byId) m = [byId as HTMLElement];
    else throw new Error(`[Testudo] Invalid CSS selector: "${clean}"`);
  }
  if (!m.length) return null;
  if (opts.requireUnique && m.length > 1) {
    throw new Error(`[Testudo] Ambiguous selector "${clean}" matched ${m.length} elements. Refusing to execute action on ambiguous target.`);
  }
  return m[0];
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

    const candidates: HTMLElement[] = [];
    for (const attr of ['data-testid', 'data-test', 'data-demo-id']) {
      const hits = this.safeQueryAttr(attr, clean);
      if (hits.length > 0) {
        if (!cascadeAll) return Array.from(new Set(hits));
        candidates.push(...hits);
      }
    }

    const byId = document.getElementById(clean) || this.safeQueryAttr('id', clean, false)[0];
    if (byId) {
      if (!cascadeAll) return [byId as HTMLElement];
      candidates.push(byId as HTMLElement);
    }

    for (const [attr, partial] of [['name', false], ['aria-label', true]] as Array<[string, boolean]>) {
      const hits = this.safeQueryAttr(attr, clean, partial);
      if (hits.length > 0) {
        if (!cascadeAll) return Array.from(new Set(hits));
        candidates.push(...hits);
      }
    }

    const headingContainers: HTMLElement[] = [];
    for (const h of Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
      if (h.textContent?.toLowerCase().includes(clean.toLowerCase())) {
        const container = h.closest('section, form, div, main, article') || h.parentElement;
        if (container) headingContainers.push(container as HTMLElement);
      }
    }
    if (headingContainers.length > 0) {
      if (!cascadeAll) return Array.from(new Set(headingContainers));
      candidates.push(...headingContainers);
    }

    for (const q of [`.${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(clean) : clean}`, clean]) {
      try {
        const found = document.querySelectorAll(q);
        if (found.length > 0) {
          const arr = Array.from(found) as HTMLElement[];
          if (!cascadeAll) return Array.from(new Set(arr));
          candidates.push(...arr);
        }
      } catch {
        // ignore invalid selector
      }
    }

    return candidates.length > 0 ? Array.from(new Set(candidates)) : [document.body];
  }

  private buildUniqueCssSelector(el: HTMLElement): string {
    const tag = el.tagName.toLowerCase();
    const isUnique = (sel: string): boolean => {
      try {
        return document.querySelectorAll(normalizeCssSelector(sel)).length === 1;
      } catch {
        return false;
      }
    };

    for (const attr of ['data-testid', 'data-test', 'data-demo-id']) {
      const v = el.getAttribute(attr);
      if (v) {
        const sel = `[${attr}="${v.replace(/"/g, '\\"')}"]`;
        if (isUnique(sel)) return sel;
      }
    }
    if (el.id && isUnique(`#${el.id}`)) return `#${el.id}`;
    for (const [attr, v] of [['name', (el as HTMLInputElement).name], ['aria-label', el.getAttribute('aria-label')]] as Array<[string, string | null]>) {
      if (v) {
        const sel = `${tag}[${attr}="${v.replace(/"/g, '\\"')}"]`;
        if (isUnique(sel)) return sel;
      }
    }

    const firstClass = typeof el.className === 'string' && el.className.trim() ? el.className.trim().split(/\s+/)[0] : '';
    if (firstClass && isUnique(`${tag}.${firstClass}`)) return `${tag}.${firstClass}`;

    const segments: string[] = [];
    let current: HTMLElement | null = el;
    while (current && current !== document.body && current !== document.documentElement) {
      const cTag = current.tagName.toLowerCase();
      if (current.id) {
        segments.unshift(`#${current.id}`);
        break;
      }
      const parent: HTMLElement | null = current.parentElement;
      if (!parent) {
        segments.unshift(cTag);
        break;
      }
      const sibs = Array.from(parent.children).filter((ch: Element) => ch.tagName.toLowerCase() === cTag);
      segments.unshift(sibs.length > 1 ? `${cTag}:nth-of-type(${sibs.indexOf(current) + 1})` : cTag);
      current = parent;
    }
    return segments.join(' > ') || tag;
  }

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
      return { action: 'select', snippet: `await $T('${safeSel}').select('${optVal.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}');` };
    }

    const nonTyping = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file', 'color', 'range']);
    if (tag === 'textarea' || (tag === 'input' && !nonTyping.has(inputType))) {
      return { action: 'type', snippet: `await $T('${safeSel}').type('example');` };
    }
    return { action: 'click', snippet: `await $T('${safeSel}').click();` };
  }

  public scan(scopeQuery?: string | HTMLElement): ScannedElement[] {
    const scopes = this.resolveScope(scopeQuery);
    if (!scopes.length) return [];

    const results: ScannedElement[] = [];
    const seen = new Set<HTMLElement>();
    const iq = 'button, input, select, textarea, a[href], [role="button"], [role="link"], [role="tab"], [onclick]';

    let index = 1;
    for (const scope of scopes) {
      const nodeList = scope.matches && scope.matches(iq)
        ? [scope, ...Array.from(scope.querySelectorAll(iq))]
        : Array.from(scope.querySelectorAll(iq));

      for (const rawEl of nodeList) {
        const el = rawEl as HTMLElement;
        if (seen.has(el) || (el.offsetWidth === 0 && el.offsetHeight === 0)) continue;
        seen.add(el);
        if (typeof window !== 'undefined' && window.getComputedStyle) {
          const st = window.getComputedStyle(el);
          if (st.visibility === 'hidden' || st.display === 'none') continue;
        }
        const selector = this.buildUniqueCssSelector(el);
        const { action, snippet } = this.buildActionSnippet(el, selector);
        results.push({
          index: index++,
          tag: el.tagName.toLowerCase(),
          type: (el as HTMLInputElement).type,
          name: (el as HTMLInputElement).name,
          id: el.id,
          label: el.getAttribute('aria-label') || undefined,
          role: el.getAttribute('role') || undefined,
          text: (el.innerText || el.textContent || '')?.trim().replace(/\s+/g, ' ').slice(0, 30),
          action,
          selector,
          snippet,
          element: el
        });
      }
    }
    return results;
  }

  public explore(scopeQuery?: string | HTMLElement): void {
    if (typeof document === 'undefined') return;
    const g = typeof globalThis !== 'undefined' ? (globalThis as any) : (window as any);
    if ((g.process?.env?.NODE_ENV === 'production' || g.TESTUDO_ENV === 'production' || g.TESTUDO_DISABLE_EXPLORER === true) && !g.__ENABLE_TESTUDO__) {
      console.warn('[Testudo] $T.explore() disabled in production mode.');
      return;
    }
    if (this.activeBadges.length > 0) {
      this.clearBadges();
      return;
    }

    for (const item of this.scan(scopeQuery)) {
      const r = item.element.getBoundingClientRect();
      const badge = document.createElement('div');
      badge.className = 'testudo-badge';
      badge.setAttribute('data-testudo-badge', 'true');
      badge.style.cssText = `position:absolute;top:${r.top + window.scrollY}px;left:${r.left + window.scrollX}px;background:#2563EB;color:#FFF;font:bold 11px monospace;padding:2px 6px;border-radius:4px;box-shadow:0 2px 6px rgba(0,0,0,0.3);z-index:100000;cursor:pointer;`;
      badge.innerText = `[${item.index}]`;
      badge.title = `${item.selector} - Click to copy: ${item.snippet}`;
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        if (navigator.clipboard?.writeText) {
          Promise.resolve(navigator.clipboard.writeText(item.snippet))
            .then(() => {
              badge.style.background = '#10B981';
              badge.innerText = 'Copied!';
              setTimeout(() => {
                badge.style.background = '#2563EB';
                badge.innerText = `[${item.index}]`;
              }, 1500);
            })
            .catch(() => {});
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

