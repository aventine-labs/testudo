/**
 * @aventine/testudo - Sir Testudo Launcher, Magic Cursor & Spotlight Lightbox Engine
 * "Clippy guessed. Testudo knows. Helpful when invited. Invisible when not."
 * Zero external dependencies. Zero telemetry.
 */

import { wasmConcierge, WhiteLabelGateInput, WhiteLabelGateResult } from './wasm-concierge.js';
import type { WorkflowStepDefinition } from './workflow.js';

export type TestudoLauncherType = 'mascot' | 'magic-cursor' | 'help';

export interface TestudoInitConfig {
  launcher?: TestudoLauncherType;
  attribution?: boolean;
  mascotName?: string;
  tagline?: string;
  version?: string;
  licenseToken?: string;
  customIconSvg?: string;
  enforceWasmLicense?: boolean;
}

export interface TestudoLiveMetric {
  label: string;
  value: string;
}

export interface TestudoManifestEntry {
  selector: string;
  title: string;
  help: string;
  quip?: string;
  prereqSelector?: string;
  liveSelectors?: Record<string, string>;
}

export interface TestudoManifest {
  name?: string;
  entries?: TestudoManifestEntry[];
  workflows?: Record<string, WorkflowStepDefinition[]>;
}

export interface TestudoElementExplanation {
  title: string;
  description: string;
  quip: string;
  isDocumented: boolean;
  isRiskLimitEasterEgg: boolean;
  selector: string;
  prereqSelector?: string;
  liveReadings: TestudoLiveMetric[];
  stateSignature?: string;
}

/**
 * 32x32 Optimized Sir Testudo Portrait SVG:
 * Bespectacled gentleman tortoise with balanced spectacles (both eyes clearly inside head silhouette),
 * mischievous grin, and tuxedo bow tie.
 */
export const SIR_TESTUDO_PORTRAIT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="28" height="28" fill="none">' +
  '<circle cx="16" cy="14" r="10" fill="#8A99AD" stroke="#0B192C" stroke-width="2"/>' +
  '<rect x="6.5" y="9.5" width="8" height="6.5" rx="3" fill="#FFFFFF" stroke="#0B192C" stroke-width="2"/>' +
  '<rect x="17.5" y="9.5" width="8" height="6.5" rx="3" fill="#FFFFFF" stroke="#0B192C" stroke-width="2"/>' +
  '<line x1="14.5" y1="12.5" x2="17.5" y2="12.5" stroke="#0B192C" stroke-width="2"/>' +
  '<circle cx="11" cy="12.8" r="1.7" fill="#0B192C"/>' +
  '<circle cx="21" cy="12.8" r="1.7" fill="#0B192C"/>' +
  '<path d="M11 19.2Q16 22 21 18.5" stroke="#0B192C" stroke-width="2" stroke-linecap="round"/>' +
  '<path d="M7 29L11 23H21L25 29Z" fill="#0B192C"/>' +
  '<polygon points="16,24 12,29 20,29" fill="#FFFFFF"/>' +
  '<polygon points="12,24.5 16,26.2 12,28" fill="#0B192C"/>' +
  '<polygon points="20,24.5 16,26.2 20,28" fill="#0B192C"/>' +
  '</svg>';

export const MAGIC_CURSOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/><path d="M19 4v4"/><path d="M17 6h4"/>' +
  '</svg>';

export const HELP_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>' +
  '</svg>';

export function getLauncherIconSvg(type: TestudoLauncherType = 'mascot'): string {
  if (type === 'magic-cursor') return MAGIC_CURSOR_SVG;
  if (type === 'help') return HELP_ICON_SVG;
  return SIR_TESTUDO_PORTRAIT_SVG;
}

export class TestudoConcierge {
  private config: Required<Pick<TestudoInitConfig, 'launcher' | 'attribution' | 'mascotName' | 'tagline' | 'version'>> = {
    launcher: 'mascot',
    attribution: true,
    mascotName: 'Sir Testudo',
    tagline: 'Clippy guessed. Testudo knows. Helpful when invited. Invisible when not.',
    version: '0.4.0'
  };

  private manifest: TestudoManifest = { entries: [], workflows: {} };
  private lastGateResult: WhiteLabelGateResult | null = null;

  public init(userConfig: TestudoInitConfig = {}): Required<Pick<TestudoInitConfig, 'launcher' | 'attribution' | 'mascotName' | 'tagline' | 'version'>> {
    let attribution = userConfig.attribution !== undefined ? Boolean(userConfig.attribution) : true;
    let mascotName = userConfig.mascotName ?? 'Sir Testudo';

    if (userConfig.enforceWasmLicense || userConfig.licenseToken) {
      const gate = this.verifyWhiteLabelLicense({
        licenseToken: userConfig.licenseToken,
        customIconSvg: userConfig.customIconSvg
      });
      if (!gate.whiteLabelUnlocked) {
        attribution = true;
        mascotName = 'Sir Testudo';
      }
    }

    this.config = {
      launcher: userConfig.launcher ?? 'mascot',
      attribution,
      mascotName,
      tagline:
        userConfig.tagline ??
        'Clippy guessed. Testudo knows. Helpful when invited. Invisible when not.',
      version: userConfig.version ?? '0.4.0'
    };
    return { ...this.config };
  }

  public getConfig(): Required<Pick<TestudoInitConfig, 'launcher' | 'attribution' | 'mascotName' | 'tagline' | 'version'>> {
    return { ...this.config };
  }

  public verifyWhiteLabelLicense(input: WhiteLabelGateInput = {}): WhiteLabelGateResult {
    this.lastGateResult = wasmConcierge.evaluateWhiteLabelGate(input);
    return this.lastGateResult;
  }

  public getLastLicenseGateResult(): WhiteLabelGateResult | null {
    return this.lastGateResult;
  }

  public loadManifest(manifest: TestudoManifest): TestudoManifest {
    this.manifest = {
      name: manifest.name || 'Testudo Manifest',
      entries: Array.isArray(manifest.entries) ? [...manifest.entries] : [],
      workflows: manifest.workflows ? { ...manifest.workflows } : {}
    };
    return this.manifest;
  }

  public clearManifest(): void {
    this.manifest = { entries: [], workflows: {} };
  }

  public getManifest(): TestudoManifest {
    return this.manifest;
  }

  public computeStateSignature(metrics: TestudoLiveMetric[]): string {
    return metrics.map((m) => `${m.label}=${m.value}`).join('|');
  }

  public getAttributionText(): string {
    if (!this.config.attribution) return '';
    return 'Powered by Testudo-JS · Aventine Labs';
  }

  public getAttributionHtml(): string {
    if (!this.config.attribution) return '';
    return (
      '<div data-testudo-attribution="true" style="display:flex;align-items:center;justify-content:space-between;font:600 10px monospace;color:#94a3b8;padding-top:8px;border-top:1px solid #1e293b;">' +
      '<span>Powered by <a href="https://github.com/aventine-labs/testudo" target="_blank" rel="noopener noreferrer" style="color:#fbbf24;text-decoration:none;">Testudo-JS</a> · Aventine Labs</span>' +
      '<span>Zero-Telemetry · Apache-2.0</span>' +
      '</div>'
    );
  }

  public isSensitiveDomNode(node: HTMLElement | null): boolean {
    if (!node) return true;
    const getAttr = (k: string) =>
      (typeof node.getAttribute === 'function' ? node.getAttribute(k) || '' : '').toLowerCase();
    const type = getAttr('type');
    const auto = getAttr('autocomplete');
    if (
      type === 'password' ||
      type === 'hidden' ||
      getAttr('data-sensitive') === 'true' ||
      getAttr('data-testudo-ignore') === 'true' ||
      auto.includes('password') ||
      auto.startsWith('cc-') ||
      auto === 'one-time-code'
    ) {
      return true;
    }
    return false;
  }

  public resolveDeclarativeLiveReadings(el: HTMLElement | null, manifestEntry?: TestudoManifestEntry): TestudoLiveMetric[] {
    if (!el) return [];
    const liveSpec = typeof el.getAttribute === 'function' ? el.getAttribute('data-testudo-live') || '' : '';
    const metrics: TestudoLiveMetric[] = [];
    if (liveSpec && typeof document !== 'undefined') {
      for (const rawPart of liveSpec.split(',')) {
        const part = rawPart.trim();
        if (!part) continue;
        const colonIdx = part.indexOf(':');
        const label = colonIdx > 0 ? part.slice(0, colonIdx).trim() : part;
        const sel = colonIdx > 0 ? part.slice(colonIdx + 1).trim() : part;
        const node = document.querySelector(sel) as HTMLElement | null;
        if (node && !this.isSensitiveDomNode(node)) {
          const val = (node.innerText || node.textContent || '').trim();
          if (val) metrics.push({ label, value: val });
        }
      }
    }
    if (manifestEntry?.liveSelectors && typeof document !== 'undefined') {
      for (const [label, sel] of Object.entries(manifestEntry.liveSelectors)) {
        const node = document.querySelector(sel) as HTMLElement | null;
        if (node && !this.isSensitiveDomNode(node)) {
          const val = (node.innerText || node.textContent || '').trim();
          if (val) metrics.push({ label, value: val });
        }
      }
    }
    return metrics;
  }

  private findManifestEntryForElement(el: HTMLElement): TestudoManifestEntry | undefined {
    const entries = this.manifest.entries || [];
    if (entries.length === 0) return undefined;
    const getAttr = (k: string) => (typeof el.getAttribute === 'function' ? el.getAttribute(k) || '' : '');
    const id = el.id || getAttr('id');
    const demoId = getAttr('data-demo-id');
    const testId = getAttr('data-testid');

    for (const entry of entries) {
      if (id && (entry.selector === `#${id}` || entry.selector === id)) return entry;
      if (demoId && (entry.selector === `[data-demo-id="${demoId}"]` || entry.selector === demoId)) return entry;
      if (testId && entry.selector === `[data-testid="${testId}"]`) return entry;
      if (typeof el.matches === 'function') {
        try {
          if (el.matches(entry.selector)) return entry;
        } catch {
          // Ignore invalid selector in mock
        }
      }
    }
    return undefined;
  }

  public async prepareAndMeasureTarget(
    selector: string,
    prereqSelector?: string,
    maxAttempts: number = 10,
    intervalMs: number = 25
  ): Promise<{ mounted: boolean; width: number; height: number }> {
    if (typeof document === 'undefined') return { mounted: false, width: 0, height: 0 };
    if (prereqSelector) {
      const prereqEl = document.querySelector(prereqSelector) as HTMLElement | null;
      if (prereqEl && typeof prereqEl.click === 'function') prereqEl.click();
    }
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const target = document.querySelector(selector) as HTMLElement | null;
      if (target && typeof target.getBoundingClientRect === 'function') {
        const rect = target.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return { mounted: true, width: rect.width, height: rect.height };
        }
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return { mounted: false, width: 0, height: 0 };
  }

  public explainElement(
    el: HTMLElement | null,
    getLiveReading?: (el: HTMLElement) => TestudoLiveMetric[]
  ): TestudoElementExplanation {
    if (!el) {
      return {
        title: 'Unknown Element',
        description: 'No interactive DOM element was resolved at that point.',
        quip: 'Ah. Apparently the developer has not explained that one. How terribly embarrassing for them.',
        isDocumented: false,
        isRiskLimitEasterEgg: false,
        selector: 'unknown',
        liveReadings: [],
        stateSignature: ''
      };
    }

    const manifestEntry = this.findManifestEntryForElement(el);
    const getAttr = (k: string) => (typeof el.getAttribute === 'function' ? el.getAttribute(k) || '' : '');

    const helpAttr = getAttr('data-testudo-help') || manifestEntry?.help || '';
    const titleAttr =
      getAttr('data-testudo-title') ||
      manifestEntry?.title ||
      getAttr('aria-label') ||
      getAttr('title') ||
      '';
    const demoId = getAttr('data-demo-id') || el.id || getAttr('id') || manifestEntry?.selector || '';
    const prereqSelector = getAttr('data-testudo-prereq') || manifestEntry?.prereqSelector || undefined;
    const text = (el.innerText || el.textContent || '').trim().slice(0, 80);
    const liveReadings = getLiveReading
      ? getLiveReading(el)
      : this.resolveDeclarativeLiveReadings(el, manifestEntry);
    const stateSignature = this.computeStateSignature(liveReadings);

    const isFiftyRisk =
      text.includes('50') &&
      (demoId.includes('qty') || demoId.includes('buy') || helpAttr.toLowerCase().includes('combine'));

    if (isFiftyRisk) {
      return {
        title: titleAttr || 'Combine Risk Guard Limit',
        description:
          helpAttr ||
          'Enforces the Prop Combine maximum contract ceiling (15 contracts) before any order reaches the matching engine.',
        quip: "It looks like you're trying to exceed your trading account's risk limit. Would you like me to explain why that's a terrible idea? CLUNK.",
        isDocumented: true,
        isRiskLimitEasterEgg: true,
        selector: demoId || el.tagName.toLowerCase(),
        prereqSelector,
        liveReadings,
        stateSignature
      };
    }

    if (helpAttr || titleAttr || demoId) {
      return {
        title: titleAttr || demoId || text || el.tagName,
        description:
          helpAttr ||
          titleAttr ||
          `Interactive control (${demoId || el.tagName.toLowerCase()}) ready for guided walkthrough execution.`,
        quip:
          manifestEntry?.quip ||
          'Excellent question. Unlike the developer, I actually documented this control.',
        isDocumented: true,
        isRiskLimitEasterEgg: false,
        selector: demoId || el.tagName.toLowerCase(),
        prereqSelector,
        liveReadings,
        stateSignature
      };
    }

    return {
      title: text || el.tagName,
      description: 'This element does not yet have a data-testudo-help annotation attached.',
      quip: 'Ah. Apparently the developer has not explained that one. How terribly embarrassing for them.',
      isDocumented: false,
      isRiskLimitEasterEgg: false,
      selector: el.tagName.toLowerCase(),
      prereqSelector,
      liveReadings,
      stateSignature
    };
  }

  /**
   * Detects active CAPTCHA, Cloudflare Turnstile, reCAPTCHA, hCaptcha, Arkose, or 2FA challenges
   * in the live DOM so workflows can pause in-place for human assist instead of failing.
   */
  public detectChallenge(root?: Document | Element | null): {
    detected: boolean;
    challengeType?: string;
    selector?: string;
    reason?: string;
  } {
    const doc = root ?? (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof doc.querySelector !== 'function') {
      return { detected: false };
    }

    const challengeProbes: Array<{ selector: string; type: string; label: string }> = [
      { selector: '[data-testudo-challenge="true"], [data-testudo-challenge="active"]', type: 'custom-challenge', label: 'Interactive Challenge Prompt' },
      { selector: '#challenge-running, #cf-challenge-running, .cf-turnstile, iframe[src*="turnstile"]', type: 'cloudflare-turnstile', label: 'Cloudflare Turnstile Verification' },
      { selector: '.g-recaptcha, iframe[src*="recaptcha"]', type: 'recaptcha', label: 'Google reCAPTCHA Challenge' },
      { selector: '.h-captcha, iframe[src*="hcaptcha"]', type: 'hcaptcha', label: 'hCaptcha Verification' },
      { selector: 'iframe[src*="arkoselabs"], iframe[src*="funcaptcha"]', type: 'arkose', label: 'Arkose Security Challenge' },
      { selector: 'input[autocomplete="one-time-code"][data-testudo-challenge-otp="true"]', type: 'mfa-otp', label: 'Two-Factor Authentication Code' }
    ];

    for (const probe of challengeProbes) {
      let node: HTMLElement | null = null;
      try {
        node = doc.querySelector(probe.selector) as HTMLElement | null;
      } catch {
        node = null;
      }
      if (!node) continue;

      if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        try {
          const st = window.getComputedStyle(node);
          if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) {
            continue;
          }
        } catch {
          // Ignore mock style lookup errors
        }
      }
      const attrHidden = typeof node.getAttribute === 'function' ? node.getAttribute('hidden') : null;
      if (attrHidden !== null) continue;

      return {
        detected: true,
        challengeType: probe.type,
        selector: probe.selector,
        reason: probe.label
      };
    }

    return { detected: false };
  }

  public renderHumanAssistBanner(reason: string = 'Complete CAPTCHA / 2FA to auto-resume'): HTMLElement | null {
    if (typeof document === 'undefined' || !document.body) return null;
    this.clearHumanAssistBanner();

    const banner = document.createElement('div');
    banner.setAttribute('data-testudo-overlay', 'true');
    banner.setAttribute('data-testudo-human-assist-banner', 'true');
    banner.style.cssText =
      'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100001;' +
      'background:#020617;color:#f8fafc;border:2px solid #f59e0b;border-radius:999px;' +
      'padding:8px 18px;font:700 12px system-ui,-apple-system,sans-serif;' +
      'box-shadow:0 12px 32px rgba(245,158,11,0.35);display:flex;align-items:center;gap:10px;';
    banner.textContent = `Sir Testudo Paused for Human Assist: ${reason} (Will auto-resume on completion)`;
    document.body.appendChild(banner);
    return banner;
  }

  public clearHumanAssistBanner(): void {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
    document.querySelectorAll('[data-testudo-human-assist-banner="true"]').forEach((el) => el.remove());
  }

  /**
   * Pauses workflow execution in-place when a CAPTCHA or 2FA challenge is present (or when
   * forcePause: true is requested by an explicit waitForHumanAssist step), notifies the
   * assistive extension/host, and automatically resumes once resolved.
   */
  public async waitForHumanAssist(options: {
    timeoutMs?: number;
    intervalMs?: number;
    root?: Document | Element | null;
    signal?: AbortSignal;
    forcePause?: boolean;
    customSelector?: string;
    customReason?: string;
    onAssistRequired?: (challenge: { challengeType?: string; selector?: string; reason?: string }) => void;
  } = {}): Promise<{
    paused: boolean;
    resolved: boolean;
    waitedMs: number;
    challengeType?: string;
    reason?: string;
  }> {
    const detectedInitial = this.detectChallenge(options.root);
    if (!detectedInitial.detected && !options.forcePause) {
      return { paused: false, resolved: true, waitedMs: 0 };
    }

    const initial = detectedInitial.detected
      ? detectedInitial
      : {
          detected: true,
          challengeType: 'explicit-human-assist',
          selector: options.customSelector,
          reason: options.customReason || 'Explicit Human Assist Gate'
        };

    const isCustomSelectorStillVisible = (): boolean => {
      if (!options.customSelector) return true;
      const doc = options.root ?? (typeof document !== 'undefined' ? document : null);
      if (!doc || typeof doc.querySelector !== 'function') return false;
      let node: HTMLElement | null = null;
      try {
        node = doc.querySelector(options.customSelector) as HTMLElement | null;
      } catch {
        return false;
      }
      if (!node) return false;
      if (typeof node.getAttribute === 'function' && node.getAttribute('hidden') !== null) {
        return false;
      }
      if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        try {
          const st = window.getComputedStyle(node);
          if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) {
            return false;
          }
        } catch {
          // ignore
        }
      }
      return true;
    };

    const startMs = Date.now();
    const timeoutMs = options.timeoutMs ?? 120000;
    const intervalMs = Math.max(10, options.intervalMs ?? 50);

    this.renderHumanAssistBanner(initial.reason || 'Security challenge detected');
    if (typeof options.onAssistRequired === 'function') {
      options.onAssistRequired(initial);
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('testudo:human-assist-required', { detail: initial }));
      } catch {
        // Ignore in non-DOM test mocks
      }
    }

    return new Promise((resolve) => {
      let settled = false;
      let observer: MutationObserver | null = null;

      const onExplicitResolveEvent = () => {
        finish(true, true);
      };

      const finish = (resolved: boolean, fromEvent: boolean = false) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        if (observer) observer.disconnect();
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
          window.removeEventListener('testudo:human-assist-resolved', onExplicitResolveEvent);
        }
        this.clearHumanAssistBanner();
        if (
          resolved &&
          !fromEvent &&
          typeof window !== 'undefined' &&
          typeof window.dispatchEvent === 'function' &&
          typeof CustomEvent === 'function'
        ) {
          try {
            window.dispatchEvent(new CustomEvent('testudo:human-assist-resolved', { detail: initial }));
          } catch {
            // Ignore
          }
        }
        resolve({
          paused: true,
          resolved,
          waitedMs: Date.now() - startMs,
          challengeType: initial.challengeType,
          reason: initial.reason
        });
      };

      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('testudo:human-assist-resolved', onExplicitResolveEvent);
      }

      const check = () => {
        if (options.signal?.aborted) {
          finish(false);
          return;
        }
        if (detectedInitial.detected) {
          const status = this.detectChallenge(options.root);
          if (!status.detected) {
            finish(true);
            return;
          }
        } else if (options.customSelector) {
          if (!isCustomSelectorStillVisible()) {
            finish(true);
            return;
          }
        }
        if (Date.now() - startMs >= timeoutMs) {
          finish(false);
        }
      };

      const targetRoot = options.root ?? (typeof document !== 'undefined' ? document.body || document : null);
      if (typeof MutationObserver === 'function' && targetRoot && typeof (targetRoot as any).nodeType === 'number') {
        try {
          observer = new MutationObserver(() => check());
          observer.observe(targetRoot as Node, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class', 'hidden', 'data-testudo-challenge']
          });
        } catch {
          observer = null;
        }
      }

      const timer = setInterval(check, intervalMs);
    });
  }

  /**
   * Captures a single-pass structured JSON snapshot of the current page via the loaded manifest.
   */
  public snapshotScreen(root?: Document | null): {
    url: string;
    title: string;
    manifestName: string;
    challenge: { detected: boolean; challengeType?: string; reason?: string };
    liveMetrics: TestudoLiveMetric[];
    documentedControls: Array<{ selector: string; title: string; present: boolean; text?: string }>;
  } {
    const doc = root ?? (typeof document !== 'undefined' ? document : null);
    const url = typeof window !== 'undefined' && window.location ? window.location.href : '';
    const title = doc && typeof (doc as any).title === 'string' ? (doc as any).title : '';
    const challenge = this.detectChallenge(doc);
    const liveMetrics: TestudoLiveMetric[] = [];
    const documentedControls: Array<{ selector: string; title: string; present: boolean; text?: string }> = [];

    for (const entry of this.manifest.entries || []) {
      const el = doc && typeof doc.querySelector === 'function' ? (doc.querySelector(entry.selector) as HTMLElement | null) : null;
      const text = el && !this.isSensitiveDomNode(el) ? (el.innerText || el.textContent || '').trim().slice(0, 120) : undefined;
      documentedControls.push({
        selector: entry.selector,
        title: entry.title,
        present: Boolean(el),
        ...(text ? { text } : {})
      });
      if (el) {
        const readings = this.resolveDeclarativeLiveReadings(el, entry);
        for (const r of readings) {
          if (!liveMetrics.some((m) => m.label === r.label && m.value === r.value)) {
            liveMetrics.push(r);
          }
        }
      }
    }

    return {
      url,
      title,
      manifestName: this.manifest.name || 'Testudo Manifest',
      challenge,
      liveMetrics,
      documentedControls
    };
  }
}

export const concierge = new TestudoConcierge();


