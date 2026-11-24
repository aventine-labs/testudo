import { computeAccessibleName, computeImplicitRole } from './probe.js';
import { resolveDeepElement } from './scan.js';

const SEC_RE = /pass|secret|token|apikey|api_key|private|auth|cookie|ssn|card|cvv|pin|jwt|bearer|seed/i;
const RED = '[REDACTED_PILLAR1]';

export interface FrameworkComponentFrame {
  framework: 'react' | 'vue' | 'angular';
  name: string;
  depth: number;
  sanitizedProps: Record<string, string | number | boolean | null>;
  handlerNames: string[];
}

export interface ShadowBoundaryHop {
  hostTag: string;
  hostId?: string;
  hostTestId?: string;
  mode: 'open' | 'closed';
}

export interface WindowFrameHop {
  href: string;
  frameElementId?: string;
  frameElementName?: string;
  isTopWindow: boolean;
  reachedCrossOriginBoundary: boolean;
}

export interface ElementXrayReport {
  found: boolean;
  selector: string;
  tag: string;
  id?: string;
  role: string;
  accessibleName: string;
  rect: { x: number; y: number; width: number; height: number };
  components: FrameworkComponentFrame[];
  shadowAncestry: ShadowBoundaryHop[];
  windowAncestry: WindowFrameHop[];
}

export interface XrayOptions {
  maxComponentDepth?: number;
  root?: Document | Element | ShadowRoot | null;
}

export function sanitizePropsPillar1(obj: any, max = 16) {
  const sp: Record<string, string | number | boolean | null> = {};
  const hn: string[] = [];
  if (!obj || typeof obj !== 'object') return { sanitizedProps: sp, handlerNames: hn };
  let n = 0;
  for (const k of Object.keys(obj)) {
    if (k === 'children' || k.startsWith('__')) continue;
    let v: any;
    try { v = obj[k]; } catch { continue; }
    if (typeof v === 'function') hn.push(k);
    else if (n < max) {
      if (SEC_RE.test(k)) { sp[k] = RED; n++; }
      else if (v === null || typeof v === 'boolean' || typeof v === 'number') { sp[k] = v; n++; }
      else if (typeof v === 'string') { sp[k] = SEC_RE.test(v) ? RED : v.slice(0, 120); n++; }
    }
  }
  return { sanitizedProps: sp, handlerNames: hn };
}

export function inspectElementXray(target: string | HTMLElement, opts: XrayOptions = {}): ElementXrayReport {
  const lim = opts.maxComponentDepth ?? 12;
  const sel = typeof target === 'string' ? target : target?.id ? `#${target.id}` : '<element>';
  const el = typeof target === 'string' ? resolveDeepElement(target, opts.root ?? null, { pierceOpenShadow: true, pierceSameOriginIframes: true }) : target;
  if (!el) return { found: false, selector: sel, tag: '', role: '', accessibleName: '', rect: { x: 0, y: 0, width: 0, height: 0 }, components: [], shadowAncestry: [], windowAncestry: [] };

  const cmps: FrameworkComponentFrame[] = [];
  const a = el as any;
  const fk = Object.keys(a).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  for (let c = fk ? a[fk] : null, g = 0; c && cmps.length < lim && g < 64; c = c.return, g++) {
    const t = c.type || c.elementType;
    const fn = typeof t === 'function' ? t : t?.render || t?.type;
    const nm = t?.displayName || (typeof fn === 'function' ? fn.displayName || fn.name || 'Component' : null);
    if (nm) cmps.push({ framework: 'react', name: String(nm), depth: cmps.length, ...sanitizePropsPillar1(c.memoizedProps || c.pendingProps) });
  }
  for (let c = a.__vueParentComponent || a.__vue__, g = 0; c && cmps.length < lim && g < 64; c = c.parent || c.$parent, g++) {
    const t = c.type || c.$options || {};
    cmps.push({ framework: 'vue', name: String(t.name || t.__name || 'VueComponent'), depth: cmps.length, ...sanitizePropsPillar1(c.props || c.$props) });
  }
  for (const x of a.__ngContext__ ? (Array.isArray(a.__ngContext__) ? a.__ngContext__ : [a.__ngContext__]) : []) {
    const cn = x?.constructor?.name;
    if (cmps.length < lim && cn && cn !== 'Object' && cn !== 'Array') cmps.push({ framework: 'angular', name: String(cn), depth: cmps.length, ...sanitizePropsPillar1(x) });
  }

  const sh: ShadowBoundaryHop[] = [];
  for (let c: any = el, g = 0; c && g < 32; g++) {
    const rn = c.getRootNode?.();
    if (!rn?.host) break;
    const h = rn.host as HTMLElement;
    sh.push({ hostTag: (h.tagName || 'div').toLowerCase(), hostId: h.id || undefined, hostTestId: h.getAttribute?.('data-testid') || undefined, mode: rn.mode === 'closed' ? 'closed' : 'open' });
    c = h;
  }

  const wa: WindowFrameHop[] = [];
  const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null);
  for (let w: any = doc ? doc.defaultView : typeof window !== 'undefined' ? window : null, g = 0; w && g < 16; g++) {
    let href = '', fe: any = null, blk = false, top = true;
    try { href = String(w.location?.href || ''); } catch { blk = true; }
    try { top = w === w.top; } catch { top = false; blk = true; }
    try { fe = w.frameElement; } catch { blk = true; }
    wa.push({ href, frameElementId: fe?.id || undefined, frameElementName: fe?.getAttribute?.('name') || undefined, isTopWindow: top, reachedCrossOriginBoundary: blk });
    if (top || blk || !w.parent || w.parent === w) break;
    w = w.parent;
  }

  const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
  return { found: true, selector: sel, tag: (el.tagName || 'div').toLowerCase(), id: el.id || undefined, role: computeImplicitRole(el), accessibleName: computeAccessibleName(el, doc), rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }, components: cmps, shadowAncestry: sh, windowAncestry: wa };
}

export const xray = Object.assign((t: string | HTMLElement, o?: XrayOptions) => inspectElementXray(t, o), { inspect: inspectElementXray, sanitizePropsPillar1 });
