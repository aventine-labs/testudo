/**
 * @aventine/testudo - Surgical <4KB Isolated-World W3C Micro-Probe (src/probe.ts)
 * Executes inside Chrome IsolatedWorld ('TestudoEnclave') or read-only DOM scope:
 * - Zero MAIN-world globals polluted, zero prototypes mutated, zero window.fetch monkey-patching
 * - Cloned Multi-Anchor Semantic Selector Synthesizer with 1-line Git Patch Diff (zero silent retries)
 * - Cloned Passive CAPTCHA / Turnstile / 2FA Detector (zero DOM mutation)
 * - Pre-Shutter Sensitive Bounding-Box Locator for SOC2/PCI screengrab redaction
 * Zero external dependencies. Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

export type ViewportQuadrant = 'TL' | 'TR' | 'BL' | 'BR' | 'CENTER';

export interface MultiAnchorDescriptor {
  primarySelector: string;
  tag: string;
  role?: string;
  accessibleName?: string;
  testId?: string;
  elementId?: string;
  quadrant: ViewportQuadrant;
}

export interface SelectorResolutionResult {
  element: HTMLElement | null;
  healed: boolean;
  usedSelector: string;
  advisory?: {
    code: 'SELECTOR_DRIFT_ADVISORY';
    originalSelector: string;
    healedSelector: string;
    matchedBy: string;
    gitPatchDiff: string;
  };
}

export interface SensitiveRect {
  x: number;
  y: number;
  width: number;
  height: number;
  reason: 'password' | 'payment-card' | 'otp' | 'data-sensitive' | 'pii-text';
}

export interface PassiveChallengeStatus {
  detected: boolean;
  challengeType?: string;
  selector?: string;
}

function escAttr(v: string): string {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function computeQuadrant(rect: { left: number; top: number; width: number; height: number }, vw = 1280, vh = 800): ViewportQuadrant {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  if (Math.abs(cx - vw / 2) < vw * 0.15 && Math.abs(cy - vh / 2) < vh * 0.15) return 'CENTER';
  if (cy < vh / 2) return cx < vw / 2 ? 'TL' : 'TR';
  return cx < vw / 2 ? 'BL' : 'BR';
}

export function computeAccessibleName(el: HTMLElement, doc?: Document | null): string {
  const getA = (k: string) => (typeof el.getAttribute === 'function' ? el.getAttribute(k) || '' : '').trim();
  const aria = getA('aria-label');
  if (aria) return aria;
  const labelledBy = getA('aria-labelledby');
  if (labelledBy && doc && typeof doc.getElementById === 'function') {
    const lblNode = doc.getElementById(labelledBy);
    if (lblNode) return (lblNode.textContent || '').trim();
  }
  const id = el.id || getA('id');
  if (id && doc && typeof doc.querySelector === 'function') {
    const lbl = doc.querySelector(`label[for="${escAttr(id)}"]`);
    if (lbl) return (lbl.textContent || '').trim();
  }
  const ph = getA('placeholder') || getA('title');
  if (ph) return ph;
  return (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

export function computeImplicitRole(el: HTMLElement): string {
  const explicit = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null;
  if (explicit) return explicit.trim().toLowerCase();
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    const t = ((el as HTMLInputElement).type || 'text').toLowerCase();
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    if (t === 'submit' || t === 'button') return 'button';
    return 'textbox';
  }
  return tag;
}

export function buildMultiAnchor(el: HTMLElement, primarySelector: string, doc?: Document | null): MultiAnchorDescriptor {
  const d = doc ?? (typeof document !== 'undefined' ? document : null);
  const getA = (k: string) => (typeof el.getAttribute === 'function' ? el.getAttribute(k) || '' : '').trim();
  const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
  const vw = typeof window !== 'undefined' ? window.innerWidth || 1280 : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight || 800 : 800;
  return {
    primarySelector,
    tag: (el.tagName || 'div').toLowerCase(),
    role: computeImplicitRole(el),
    accessibleName: computeAccessibleName(el, d) || undefined,
    testId: getA('data-testid') || getA('data-test') || undefined,
    elementId: el.id || getA('id') || undefined,
    quadrant: computeQuadrant(rect, vw, vh)
  };
}

export function resolveWithSemanticSelfHeal(
  anchor: MultiAnchorDescriptor,
  root?: Document | Element | null
): SelectorResolutionResult {
  const doc = (root ?? (typeof document !== 'undefined' ? document : null)) as Document | null;
  if (!doc || typeof doc.querySelector !== 'function') {
    return { element: null, healed: false, usedSelector: anchor.primarySelector };
  }

  try {
    const direct = doc.querySelector(anchor.primarySelector) as HTMLElement | null;
    if (direct) {
      return { element: direct, healed: false, usedSelector: anchor.primarySelector };
    }
  } catch {
    // proceed to semantic fallback
  }

  const candidates: Array<{ el: HTMLElement; sel: string; reason: string }> = [];
  if (anchor.testId) {
    const sel = `[data-testid="${escAttr(anchor.testId)}"]`;
    const byTid = doc.querySelector(sel) as HTMLElement | null;
    if (byTid) candidates.push({ el: byTid, sel, reason: 'data-testid' });
  }
  if (anchor.elementId) {
    const sel = `#${escAttr(anchor.elementId)}`;
    const byId = doc.getElementById ? (doc.getElementById(anchor.elementId) as HTMLElement | null) : null;
    if (byId) candidates.push({ el: byId, sel, reason: 'id' });
  }
  if (candidates.length === 0 && anchor.accessibleName && typeof doc.querySelectorAll === 'function') {
    const all = Array.from(doc.querySelectorAll('button, a, input, select, textarea, [role]')) as HTMLElement[];
    for (const node of all) {
      const r = computeImplicitRole(node);
      const n = computeAccessibleName(node, doc);
      if ((!anchor.role || r === anchor.role) && n.toLowerCase() === anchor.accessibleName.toLowerCase()) {
        const tid = node.getAttribute('data-testid');
        const healedSel = tid
          ? `[data-testid="${escAttr(tid)}"]`
          : node.id
          ? `#${escAttr(node.id)}`
          : `${r}[aria-label="${escAttr(anchor.accessibleName)}"]`;
        candidates.push({ el: node, sel: healedSel, reason: `role(${r})+accessibleName` });
      }
    }
  }

  if (candidates.length === 0) {
    return { element: null, healed: false, usedSelector: anchor.primarySelector };
  }

  const winner = candidates[0];
  const patch = `- await $T('${anchor.primarySelector}').click();\n+ await $T('${winner.sel}').click();`;
  return {
    element: winner.el,
    healed: true,
    usedSelector: winner.sel,
    advisory: {
      code: 'SELECTOR_DRIFT_ADVISORY',
      originalSelector: anchor.primarySelector,
      healedSelector: winner.sel,
      matchedBy: winner.reason,
      gitPatchDiff: patch
    }
  };
}

export function detectSecurityChallengePassive(root?: Document | Element | null): PassiveChallengeStatus {
  const doc = root ?? (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.querySelector !== 'function') return { detected: false };
  const probes: Array<[string, string]> = [
    ['#cf-challenge-running, .cf-turnstile, iframe[src*="turnstile"]', 'cloudflare-turnstile'],
    ['.g-recaptcha, iframe[src*="recaptcha"]', 'recaptcha'],
    ['.h-captcha, iframe[src*="hcaptcha"]', 'hcaptcha'],
    ['iframe[src*="arkoselabs"], iframe[src*="funcaptcha"]', 'arkose'],
    ['input[autocomplete="one-time-code"]', 'mfa-otp']
  ];
  for (const [sel, kind] of probes) {
    const el = doc.querySelector(sel) as HTMLElement | null;
    if (el && el.getAttribute('hidden') === null) {
      return { detected: true, challengeType: kind, selector: sel };
    }
  }
  return { detected: false };
}

export function collectSensitiveRedactionRects(root?: Document | Element | null): SensitiveRect[] {
  const doc = root ?? (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.querySelectorAll !== 'function') return [];
  const out: SensitiveRect[] = [];
  const nodes = Array.from(
    doc.querySelectorAll('input[type="password"], [autocomplete^="cc-"], [autocomplete="one-time-code"], [data-sensitive="true"]')
  ) as HTMLElement[];
  for (const n of nodes) {
    if (typeof n.getBoundingClientRect !== 'function') continue;
    const r = n.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const t = ((n as HTMLInputElement).type || '').toLowerCase();
    const ac = (n.getAttribute('autocomplete') || '').toLowerCase();
    const reason: SensitiveRect['reason'] =
      t === 'password'
        ? 'password'
        : ac.startsWith('cc-')
        ? 'payment-card'
        : ac === 'one-time-code'
        ? 'otp'
        : 'data-sensitive';
    out.push({ x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(r.width), height: Math.ceil(r.height), reason });
  }
  return out;
}

export function assertNativeIntrinsicsUntouched(targetGlobal?: any): {
  untouched: boolean;
  fetchNative: boolean;
  xhrNative: boolean;
  pollutedGlobals: string[];
} {
  const g = targetGlobal ?? (typeof window !== 'undefined' ? window : globalThis);
  const fnStr = (fn: any) => (typeof fn === 'function' ? Function.prototype.toString.call(fn) : '');
  const fetchNative = !g.fetch || fnStr(g.fetch).includes('[native code]');
  const xhrOpen = g.XMLHttpRequest?.prototype?.open;
  const xhrNative = !xhrOpen || fnStr(xhrOpen).includes('[native code]');
  const forbidden = ['__cypress', '__pwInitScripts', '__webdriver_evaluate', '__selenium_unwrapped'];
  const pollutedGlobals = forbidden.filter((k) => k in g);
  return {
    untouched: fetchNative && xhrNative && pollutedGlobals.length === 0,
    fetchNative,
    xhrNative,
    pollutedGlobals
  };
}

/**
 * Generates the self-contained IsolatedWorld script (< 2 KB) for CDP Page.addScriptToEvaluateOnNewDocument
 * with worldName: 'TestudoEnclave' (and MV3 ISOLATED world). Zero MAIN-world globals touched.
 */
export function buildIsolatedProbeScript(sessionNonceHex: string): string {
  const safeNonce = String(sessionNonceHex || '').replace(/[^0-9a-fA-F]/g, '').slice(0, 64);
  return `(function(){const N="${safeNonce}";let muts=0,lastMut=performance.now(),cls=0;if(typeof MutationObserver==="function"&&document.documentElement){new MutationObserver((l)=>{muts+=l.length;lastMut=performance.now();}).observe(document.documentElement,{subtree:true,childList:true,attributes:true});}if(typeof PerformanceObserver==="function"){try{new PerformanceObserver((l)=>{for(const e of l.getEntries()){if(!e.hadRecentInput)cls+=(e.value||0);}}).observe({type:"layout-shift",buffered:true});}catch{}}Object.freeze({nonce:N,snapshot:()=>({nonce:N,muts,quietMs:performance.now()-lastMut,cls,url:location.href})});})();`;
}
