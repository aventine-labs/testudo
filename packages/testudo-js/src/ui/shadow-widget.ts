/**
 * @aventine/testudo - Standalone Shadow DOM Concierge, Magic Cursor & Trainer Widget
 * Zero React/Tailwind dependency. Mounts inside an isolated Shadow DOM root on any webpage.
 */

import {
  concierge,
  SIR_TESTUDO_PORTRAIT_SVG,
  MAGIC_CURSOR_SVG,
  TestudoElementExplanation,
  TestudoManifest
} from '../launcher.js';
import { visual, escapeHtml } from '../visual.js';
import { WhiteLabelGateResult } from '../wasm-concierge.js';
import { WorkflowStepDefinition, createWorkflow } from '../workflow.js';

export interface ShadowWidgetConfig {
  licenseToken?: string;
  customIconSvg?: string;
  organizationName?: string;
  manifest?: TestudoManifest;
  steps?: WorkflowStepDefinition[];
  container?: HTMLElement;
}

const ALLOWED_SVG_TAGS = new Set([
  'svg',
  'path',
  'circle',
  'rect',
  'g',
  'line',
  'polyline',
  'polygon',
  'ellipse'
]);

const ALLOWED_SVG_ATTRS = new Set([
  'viewbox',
  'width',
  'height',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'points',
  'opacity',
  'transform',
  'fill-rule',
  'clip-rule'
]);

function escapeCssAttrValue(raw: string): string {
  return String(raw).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function formatSafeIdSelector(rawId: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return `#${CSS.escape(rawId)}`;
  }
  if (/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(rawId)) {
    return `#${rawId}`;
  }
  return `[id="${escapeCssAttrValue(rawId)}"]`;
}

function isSafeSvgAttrValue(val: string): boolean {
  const lower = String(val || '').trim().toLowerCase();
  if (
    lower.includes('javascript:') ||
    lower.includes('vbscript:') ||
    lower.includes('data:') ||
    lower.includes('<script') ||
    lower.includes('url(')
  ) {
    return false;
  }
  return true;
}

/**
 * Validates and sanitizes custom SVG markup against a strict geometric tag & attribute allowlist.
 * Rejects <script>, <foreignObject>, event handlers (on*), href/xlink:href, and unsafe URLs.
 */
export function sanitizeCustomSvgMarkup(rawSvg: string): string {
  const trimmed = String(rawSvg || '').trim();
  if (!trimmed.toLowerCase().startsWith('<svg') || !trimmed.toLowerCase().endsWith('</svg>')) {
    return '';
  }
  if (
    /<\s*\/?\s*(?:script|foreignobject|iframe|object|embed|style|image|use|a|animate|set)\b/i.test(trimmed) ||
    /\bon[a-z]+\s*=/i.test(trimmed) ||
    /\b(?:xlink:)?href\s*=/i.test(trimmed) ||
    /javascript\s*:/i.test(trimmed) ||
    /data\s*:/i.test(trimmed)
  ) {
    return '';
  }
  const tagMatches = trimmed.matchAll(/<\s*\/?\s*([a-zA-Z0-9:-]+)/g);
  for (const m of tagMatches) {
    const tagName = (m[1] || '').toLowerCase();
    if (!ALLOWED_SVG_TAGS.has(tagName)) {
      return '';
    }
  }
  return trimmed;
}

function buildSafeSvgDomNode(rawSvg: string): Element | null {
  const prechecked = sanitizeCustomSvgMarkup(rawSvg);
  if (!prechecked) return null;
  if (
    typeof DOMParser === 'undefined' ||
    typeof document === 'undefined' ||
    typeof document.createElementNS !== 'function'
  ) {
    return null;
  }

  let parsed: Document;
  try {
    parsed = new DOMParser().parseFromString(prechecked, 'image/svg+xml');
  } catch {
    return null;
  }
  if (!parsed || !parsed.documentElement || parsed.querySelector('parsererror')) {
    return null;
  }
  const rootEl = parsed.documentElement;
  if (rootEl.tagName.toLowerCase() !== 'svg') {
    return null;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const cloneNodeSafe = (src: Element, depth: number): Element | null => {
    if (depth > 16) return null;
    const tag = src.tagName.toLowerCase();
    if (!ALLOWED_SVG_TAGS.has(tag)) return null;
    const out = document.createElementNS(SVG_NS, tag);
    for (const attr of Array.from(src.attributes)) {
      const nameLower = attr.name.toLowerCase();
      if (nameLower.startsWith('on') || !ALLOWED_SVG_ATTRS.has(nameLower)) {
        continue;
      }
      if (!isSafeSvgAttrValue(attr.value)) {
        continue;
      }
      out.setAttribute(attr.name === 'viewbox' ? 'viewBox' : attr.name, attr.value);
    }
    for (const child of Array.from(src.children)) {
      const safeChild = cloneNodeSafe(child, depth + 1);
      if (safeChild) {
        out.appendChild(safeChild);
      }
    }
    return out;
  };

  const safeSvg = cloneNodeSafe(rootEl, 0);
  if (safeSvg && !safeSvg.getAttribute('width')) {
    safeSvg.setAttribute('width', '20');
  }
  if (safeSvg && !safeSvg.getAttribute('height')) {
    safeSvg.setAttribute('height', '20');
  }
  return safeSvg;
}

export class TestudoShadowWidget {
  private hostEl: HTMLElement | null = null;
  private rootNode: ShadowRoot | HTMLElement | null = null;
  private magicCursorActive = false;
  private recorderActive = false;
  private popoverOpen = false;
  private steps: WorkflowStepDefinition[] = [];
  private recordedSteps: WorkflowStepDefinition[] = [];
  private currentStepIdx = -1;
  private gateResult: WhiteLabelGateResult;
  private customIconSvg?: string;
  private lastExplanation: TestudoElementExplanation | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private recordHandler: ((e: Event) => void) | null = null;

  constructor(config: ShadowWidgetConfig = {}) {
    if (config.manifest) {
      concierge.loadManifest(config.manifest);
    }
    this.steps = config.steps || [];
    this.customIconSvg = config.customIconSvg;
    this.gateResult = concierge.verifyWhiteLabelLicense({
      licenseToken: config.licenseToken,
      customIconSvg: config.customIconSvg
    });
  }

  public getLicenseStatus(): WhiteLabelGateResult {
    return this.gateResult;
  }

  public isPopoverOpen(): boolean {
    return this.popoverOpen;
  }

  public isMagicCursorActive(): boolean {
    return this.magicCursorActive;
  }

  public isRecorderActive(): boolean {
    return this.recorderActive;
  }

  public updateLicense(
    licenseToken?: string,
    customIconSvg?: string,
    claimedOrigin?: string,
    edgeAttestedOrigin?: string
  ): WhiteLabelGateResult {
    this.customIconSvg = customIconSvg;
    this.gateResult = concierge.verifyWhiteLabelLicense({
      licenseToken,
      customIconSvg,
      claimedOrigin,
      edgeAttestedOrigin
    });
    this.render();
    return this.gateResult;
  }

  public setSteps(steps: WorkflowStepDefinition[]): void {
    this.steps = [...steps];
    this.currentStepIdx = -1;
    this.render();
  }

  public mount(container?: HTMLElement): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    this.unmount();

    const host = document.createElement('div');
    host.setAttribute('data-testudo-launcher-root', 'true');
    host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;font-family:system-ui,-apple-system,sans-serif;';

    const parent = container || document.body;
    parent.appendChild(host);
    this.hostEl = host;

    if (typeof host.attachShadow === 'function') {
      this.rootNode = host.attachShadow({ mode: 'open' });
    } else {
      this.rootNode = host;
    }

    this.render();
    return host;
  }

  public unmount(): void {
    this.disableMagicCursor();
    this.disableWorkflowRecorder();
    if (this.hostEl && typeof this.hostEl.remove === 'function') {
      this.hostEl.remove();
    }
    this.hostEl = null;
    this.rootNode = null;
  }

  public enableMagicCursor(): void {
    if (typeof document === 'undefined' || this.magicCursorActive) return;
    this.magicCursorActive = true;
    this.clickHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (this.hostEl && (target === this.hostEl || (typeof this.hostEl.contains === 'function' && this.hostEl.contains(target)))) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.inspectElement(target);
    };
    if (typeof document.addEventListener === 'function') {
      document.addEventListener('click', this.clickHandler, true);
    }
    this.render();
  }

  public disableMagicCursor(): void {
    if (!this.magicCursorActive) return;
    this.magicCursorActive = false;
    if (this.clickHandler && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('click', this.clickHandler, true);
    }
    this.clickHandler = null;
    this.render();
  }

  public recordStepFromElement(
    el: HTMLElement,
    explicitAction?: 'click' | 'type' | 'select',
    explicitValue?: string
  ): WorkflowStepDefinition | null {
    if (!el || concierge.isSensitiveDomNode(el)) return null;
    const expl = concierge.explainElement(el);
    const tag = (el.tagName || 'div').toLowerCase();
    const id = el.id || (typeof el.getAttribute === 'function' ? el.getAttribute('id') : '');
    const testId = typeof el.getAttribute === 'function' ? el.getAttribute('data-testid') : '';
    const demoId = typeof el.getAttribute === 'function' ? el.getAttribute('data-demo-id') : '';
    const selector = testId
      ? `[data-testid="${escapeCssAttrValue(testId)}"]`
      : demoId
      ? `[data-demo-id="${escapeCssAttrValue(demoId)}"]`
      : id
      ? formatSafeIdSelector(id)
      : expl.selector || tag;

    const isEditable =
      Boolean((el as any).isContentEditable) ||
      (typeof el.getAttribute === 'function' &&
        (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === ''));

    const action: 'click' | 'type' | 'select' =
      explicitAction ||
      (tag === 'select'
        ? 'select'
        : tag === 'input' || tag === 'textarea' || isEditable
        ? 'type'
        : 'click');

    const rawVal =
      explicitValue !== undefined
        ? explicitValue
        : (el as HTMLInputElement).value !== undefined
        ? String((el as HTMLInputElement).value)
        : isEditable
        ? String(el.innerText ?? el.textContent ?? '').trim()
        : undefined;

    const step: WorkflowStepDefinition = {
      id: `recorded-${this.recordedSteps.length + 1}`,
      title: `${action.toUpperCase()} ${expl.title}`,
      selector,
      action,
      ...(action !== 'click' && rawVal !== undefined ? { value: rawVal } : {})
    };
    this.recordedSteps.push(step);
    this.render();
    return step;
  }

  public enableWorkflowRecorder(): void {
    if (typeof document === 'undefined' || this.recorderActive) return;
    this.recorderActive = true;
    this.recordHandler = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (this.hostEl && (target === this.hostEl || (typeof this.hostEl.contains === 'function' && this.hostEl.contains(target)))) {
        return;
      }
      if (e.type === 'change') {
        const tag = (target.tagName || '').toLowerCase();
        if (tag === 'select') {
          this.recordStepFromElement(target, 'select');
        } else if (tag === 'input' || tag === 'textarea') {
          this.recordStepFromElement(target, 'type');
        }
      } else if (e.type === 'click') {
        const tag = (target.tagName || '').toLowerCase();
        if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
          this.recordStepFromElement(target, 'click');
        }
      }
    };
    if (typeof document.addEventListener === 'function') {
      document.addEventListener('click', this.recordHandler, true);
      document.addEventListener('change', this.recordHandler, true);
    }
    this.render();
  }

  public disableWorkflowRecorder(): void {
    if (!this.recorderActive) return;
    this.recorderActive = false;
    if (this.recordHandler && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('click', this.recordHandler, true);
      document.removeEventListener('change', this.recordHandler, true);
    }
    this.recordHandler = null;
    this.render();
  }

  public getRecordedSteps(): WorkflowStepDefinition[] {
    return this.recordedSteps.map((s) => ({ ...s }));
  }

  public clearRecordedSteps(): void {
    this.recordedSteps = [];
    this.render();
  }

  public exportRecordedManifest(name: string = 'Recorded Concierge Workflow'): string {
    return JSON.stringify(
      {
        name,
        recordedAt: new Date().toISOString(),
        steps: this.recordedSteps
      },
      null,
      2
    );
  }

  public inspectElement(el: HTMLElement): TestudoElementExplanation {
    const expl = concierge.explainElement(el);
    this.lastExplanation = expl;
    this.popoverOpen = true;
    visual.highlightStep(el, {
      label: expl.title,
      color: expl.isRiskLimitEasterEgg ? '#EF4444' : '#38BDF8',
      clearPrevious: true
    });
    this.render();
    return expl;
  }

  public nextStep(): WorkflowStepDefinition | null {
    if (this.steps.length === 0) return null;
    this.currentStepIdx = (this.currentStepIdx + 1) % this.steps.length;
    return this.highlightCurrentTrainerStep();
  }

  public prevStep(): WorkflowStepDefinition | null {
    if (this.steps.length === 0) return null;
    this.currentStepIdx = (this.currentStepIdx - 1 + this.steps.length) % this.steps.length;
    return this.highlightCurrentTrainerStep();
  }

  private highlightCurrentTrainerStep(): WorkflowStepDefinition | null {
    if (this.currentStepIdx < 0 || this.currentStepIdx >= this.steps.length) return null;
    const step = this.steps[this.currentStepIdx];
    if (typeof document !== 'undefined') {
      const el = document.querySelector(step.selector) as HTMLElement | null;
      if (el) {
        visual.cleanup();
        visual.highlightStep(el, {
          label: `[${this.currentStepIdx + 1}] ${step.title}`,
          color: '#38BDF8',
          clearPrevious: true
        });
        this.lastExplanation = concierge.explainElement(el);
      }
    }
    this.render();
    return step;
  }

  public async runGuidedWorkflow(): Promise<void> {
    const activeSteps = this.steps.length > 0 ? this.steps : this.recordedSteps;
    if (activeSteps.length === 0) return;
    const wf = createWorkflow('Shadow Concierge Walkthrough', activeSteps);
    await wf.run({ stepDelayMs: 120 });
    this.render();
  }

  public render(): void {
    if (!this.rootNode) return;

    const candidateSvg =
      this.gateResult.whiteLabelUnlocked && this.customIconSvg
        ? sanitizeCustomSvgMarkup(this.customIconSvg)
        : null;

    const orgLabel = this.gateResult.orgName || 'Enterprise';
    const badgeLabel = this.gateResult.whiteLabelUnlocked
      ? `White-Label Verified (${escapeHtml(orgLabel)})`
      : 'Sir Testudo Concierge';

    const expl = this.lastExplanation;
    const explHtml = expl
      ? `<div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:10px;margin-top:8px;">
          <div style="font-weight:700;font-size:12px;color:#38bdf8;">${escapeHtml(expl.title)}</div>
          <div style="font-size:11px;color:#cbd5e1;margin-top:4px;line-height:1.4;">${escapeHtml(expl.description)}</div>
          <div style="font-size:11px;color:#fbbf24;margin-top:6px;font-style:italic;">"${escapeHtml(expl.quip)}"</div>
          ${
            expl.liveReadings.length > 0
              ? `<div style="margin-top:8px;padding-top:6px;border-top:1px dashed #334155;font-size:10px;color:#94a3b8;">
                  ${expl.liveReadings
                    .map(
                      (m) =>
                        `<div style="display:flex;justify-content:space-between;"><span>${escapeHtml(m.label)}:</span><strong style="color:#10b981;">${escapeHtml(m.value)}</strong></div>`
                    )
                    .join('')}
                </div>`
              : ''
          }
        </div>`
      : `<div style="font-size:11px;color:#94a3b8;margin-top:8px;">Activate Magic Cursor and click any control on the page to inspect its live state and documentation.</div>`;

    const attributionFooter = this.gateResult.attributionRequired
      ? `<div data-testudo-attribution="true" style="margin-top:10px;padding-top:8px;border-top:1px solid #1e293b;display:flex;justify-content:space-between;font:600 10px monospace;color:#94a3b8;">
          <span>Powered by <a href="https://github.com/aventine-labs/testudo" target="_blank" rel="noopener noreferrer" style="color:#fbbf24;text-decoration:none;">Testudo-JS</a> - Aventine Labs</span>
          <span>WASM Gate: ${escapeHtml(this.gateResult.disposition)}</span>
        </div>`
      : `<div data-testudo-whitelabel="true" style="margin-top:10px;padding-top:8px;border-top:1px solid #1e293b;display:flex;justify-content:space-between;font:600 10px monospace;color:#10b981;">
          <span>Enterprise White-Label Active (${escapeHtml(orgLabel)})</span>
          <span>Origin + Icon SHA-256 Verified</span>
        </div>`;

    const popoverHtml = this.popoverOpen
      ? `<div data-testudo-popover="true" style="width:330px;background:#020617;color:#f8fafc;border:1px solid #334155;border-radius:12px;padding:12px;margin-bottom:10px;box-shadow:0 16px 40px rgba(0,0,0,0.65);">
          <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1e293b;padding-bottom:8px;">
            <span style="font-weight:800;font-size:12px;color:#f8fafc;">${badgeLabel}</span>
            <span style="font-size:10px;padding:2px 6px;border-radius:4px;background:#1e293b;color:#38bdf8;">v0.5.0 WASM</span>
          </div>
          ${explHtml}
          ${attributionFooter}
        </div>`
      : '';

    const runnableCount = this.steps.length > 0 ? this.steps.length : this.recordedSteps.length;

    this.rootNode.innerHTML = `
      ${popoverHtml}
      <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end;">
        <button id="testudo-record-btn" data-testudo-recorder-btn="true" type="button" title="Record Workflow Steps" style="display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:999px;border:1px solid ${
          this.recorderActive ? '#ef4444' : '#334155'
        };background:${this.recorderActive ? '#450a0a' : '#0f172a'};color:#f8fafc;font:700 11px system-ui;cursor:pointer;">
          <span>${this.recorderActive ? `Recording (${this.recordedSteps.length})` : 'Record Steps'}</span>
        </button>
        <button id="testudo-magic-btn" data-testudo-magic-cursor-btn="true" type="button" title="Toggle Magic Cursor" style="display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:999px;border:1px solid ${
          this.magicCursorActive ? '#f59e0b' : '#334155'
        };background:${this.magicCursorActive ? '#451a03' : '#0f172a'};color:#f8fafc;font:700 11px system-ui;cursor:pointer;">
          ${MAGIC_CURSOR_SVG}
          <span>${this.magicCursorActive ? 'Magic Cursor ON' : 'Magic Cursor'}</span>
        </button>
        <button id="testudo-run-btn" data-testudo-run-btn="true" type="button" title="Run Guided Workflow" style="display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:999px;border:1px solid #10b981;background:#022c22;color:#f8fafc;font:700 11px system-ui;cursor:pointer;">
          <span>${runnableCount > 0 ? `Run (${runnableCount})` : 'Run Steps'}</span>
        </button>
        <button id="testudo-launcher-btn" data-testudo-launcher-btn="true" type="button" title="${badgeLabel}" style="display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;border:1px solid #38bdf8;background:#020617;color:#f8fafc;font:700 12px system-ui;cursor:pointer;box-shadow:0 8px 24px rgba(2,132,199,0.35);">
          <span data-testudo-icon-slot="true" style="display:inline-flex;align-items:center;"></span>
          <span>${badgeLabel}</span>
        </button>
      </div>
    `;

    if (typeof (this.rootNode as ParentNode).querySelector === 'function') {
      const q = (sel: string) => (this.rootNode as ParentNode).querySelector(sel) as HTMLElement | null;
      const iconSlot = q('[data-testudo-icon-slot="true"]');
      if (iconSlot) {
        const safeNode = candidateSvg ? buildSafeSvgDomNode(candidateSvg) : null;
        if (safeNode && typeof iconSlot.replaceChildren === 'function') {
          iconSlot.replaceChildren(safeNode);
        } else if (safeNode) {
          iconSlot.innerHTML = '';
          iconSlot.appendChild(safeNode);
        } else {
          iconSlot.innerHTML = SIR_TESTUDO_PORTRAIT_SVG;
        }
      }

      const recBtn = q('#testudo-record-btn');
      if (recBtn && typeof recBtn.addEventListener === 'function') {
        recBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (this.recorderActive) {
            this.disableWorkflowRecorder();
          } else {
            this.enableWorkflowRecorder();
          }
        });
      }

      const magicBtn = q('#testudo-magic-btn');
      if (magicBtn && typeof magicBtn.addEventListener === 'function') {
        magicBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (this.magicCursorActive) {
            this.disableMagicCursor();
          } else {
            this.enableMagicCursor();
          }
        });
      }

      const runBtn = q('#testudo-run-btn');
      if (runBtn && typeof runBtn.addEventListener === 'function') {
        runBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          void this.runGuidedWorkflow();
        });
      }

      const launcherBtn = q('#testudo-launcher-btn');
      if (launcherBtn && typeof launcherBtn.addEventListener === 'function') {
        launcherBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.popoverOpen = !this.popoverOpen;
          this.render();
        });
      }
    }
  }
}

export function mountTestudoWidget(config: ShadowWidgetConfig = {}): TestudoShadowWidget {
  const widget = new TestudoShadowWidget(config);
  widget.mount(config.container);
  return widget;
}
