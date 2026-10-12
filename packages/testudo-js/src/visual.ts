/**
 * @aventine/testudo - Visual Error Forensics & Character-Level Diff HUD
 * Two-mode non-destructive highlighting (Ghost overlay on input, Range on text).
 * Zero DOM mutation inside inputs, zero React hydration bugs.
 * Zero external dependencies.
 */

import { charDiff, CharDiffResult } from './diff.js';

export interface VisualErrorOptions {
  message?: string;
  expected?: string;
  actual?: string;
  color?: string;
  autoScroll?: boolean;
}

export class TestudoVisual {
  private activeObserver: MutationObserver | null = null;

  /**
   * Removes all active Testudo visual overlays from the page.
   */
  public cleanup(): void {
    if (typeof document === 'undefined') return;

    const overlays = document.querySelectorAll('[data-testudo-overlay]');
    overlays.forEach((el) => el.remove());

    const outlines = document.querySelectorAll('[data-testudo-outlined]');
    outlines.forEach((el) => {
      (el as HTMLElement).style.removeProperty('outline');
      (el as HTMLElement).style.removeProperty('outline-offset');
      (el as HTMLElement).style.removeProperty('box-shadow');
      el.removeAttribute('data-testudo-outlined');
    });

    if (this.activeObserver) {
      this.activeObserver.disconnect();
      this.activeObserver = null;
    }
  }

  /**
   * Highlights an error in the DOM with glowing red outline, character diff HUD, and viewport centering.
   */
  public async highlightError(
    elementOrSelector: string | HTMLElement,
    options: VisualErrorOptions = {}
  ): Promise<{ diff: CharDiffResult | null }> {
    if (typeof document === 'undefined') return { diff: null };

    // Clean up any stale overlays first
    this.cleanup();

    let element: HTMLElement | null = null;
    if (typeof elementOrSelector === 'string') {
      element = document.querySelector(elementOrSelector);
    } else {
      element = elementOrSelector;
    }

    if (!element) {
      return { diff: null };
    }

    const {
      message = 'Assertion Failed',
      expected = '',
      actual = '',
      color = '#EF4444',
      autoScroll = true
    } = options;

    // 1. Viewport auto-centering
    if (autoScroll && element.scrollIntoView) {
      element.scrollIntoView({ behavior: 'instant' as any, block: 'center', inline: 'center' });
    }

    // 2. Glowing Neon Red Outline
    element.setAttribute('data-testudo-outlined', 'true');
    element.style.setProperty('outline', `3px solid ${color}`, 'important');
    element.style.setProperty('outline-offset', '3px', 'important');
    element.style.setProperty('box-shadow', `0 0 15px ${color}BF`, 'important');

    // 3. Compute character diff
    const diff = expected && actual ? charDiff(expected, actual) : null;

    // 4. Input Mode vs Read Mode Highlighting
    const isInput = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;

    if (isInput) {
      await this.highlightInputGhost(element as HTMLInputElement, diff, color);
    } else {
      this.highlightTextRange(element, diff, color);
    }

    // 5. Floating HUD Tooltip
    this.renderFloatingHUD(element, message, diff, color);

    // 6. Watch for element removal during SPA transitions
    this.watchForElementRemoval(element);

    return { diff };
  }

  /**
   * Input Mode: Renders an absolute-positioned ghost overlay over the input.
   * Uses hidden mirror div + Range fallback to accurately position character highlight without touching input DOM.
   */
  private async highlightInputGhost(
    input: HTMLInputElement | HTMLTextAreaElement,
    diff: CharDiffResult | null,
    color: string
  ): Promise<void> {
    if (!diff) return;

    // Ensure web fonts are completely loaded before computing text coordinates
    if (typeof document !== 'undefined' && (document as any).fonts) {
      await (document as any).fonts.ready;
    }

    const renderGhost = () => {
      // Remove any previous ghost overlays for this input
      const existing = document.querySelectorAll(`[data-testudo-input-ghost]`);
      existing.forEach((el) => el.remove());

      const rect = input.getBoundingClientRect();
      const computed = window.getComputedStyle(input);

      // Create off-screen mirror div copying typography and padding styles
      const isTextarea = input instanceof HTMLTextAreaElement;
      const mirror = document.createElement('div');
      mirror.style.cssText = `
        position: absolute;
        top: -9999px;
        left: -9999px;
        visibility: hidden;
        white-space: ${isTextarea ? 'pre-wrap' : 'pre'};
        ${isTextarea ? `width: ${computed.width};` : ''}
        font-family: ${computed.fontFamily};
        font-size: ${computed.fontSize};
        font-weight: ${computed.fontWeight};
        letter-spacing: ${computed.letterSpacing};
        line-height: ${computed.lineHeight};
        padding: ${computed.padding};
        border: ${computed.border};
        box-sizing: ${computed.boxSizing};
      `;

      const val = input.value || '';
      const beforeText = val.slice(0, diff.index);
      const targetChar = val.slice(diff.index, diff.index + 1) || ' ';
      const afterText = val.slice(diff.index + 1);

      const beforeNode = document.createTextNode(beforeText);
      const targetNode = document.createTextNode(targetChar);
      const afterNode = document.createTextNode(afterText);

      mirror.appendChild(beforeNode);
      mirror.appendChild(targetNode);
      mirror.appendChild(afterNode);
      document.body.appendChild(mirror);

      try {
        const range = document.createRange();
        range.selectNode(targetNode);
        const rangeRect = range.getBoundingClientRect();
        const mirrorRect = mirror.getBoundingClientRect();

        const relLeft = rangeRect.left - mirrorRect.left;
        const relTop = rangeRect.top - mirrorRect.top;

        // Create character highlight box over the input
        const highlight = document.createElement('div');
        highlight.setAttribute('data-testudo-overlay', 'true');
        highlight.setAttribute('data-testudo-input-ghost', 'true');
        highlight.style.cssText = `
          position: absolute;
          top: ${rect.top + window.scrollY + relTop}px;
          left: ${rect.left + window.scrollX + relLeft}px;
          width: ${Math.max(rangeRect.width, 8)}px;
          height: ${rangeRect.height || parseInt(computed.fontSize, 10) || 16}px;
          background: #FEF08A;
          outline: 2px dashed ${color};
          pointer-events: none;
          z-index: 99999;
          box-sizing: border-box;
        `;
        document.body.appendChild(highlight);
      } catch {
        // Fallback: silently proceed if Range measurement is unsupported
      } finally {
        mirror.remove();
      }
    };

    renderGhost();

    // Listen for dynamic web font swaps (e.g. Next.js Google Fonts)
    if (
      typeof document !== 'undefined' &&
      (document as any).fonts &&
      (document as any).fonts.addEventListener
    ) {
      (document as any).fonts.addEventListener('loadingdone', () => renderGhost());
    }
  }

  /**
   * Read Mode: Sub-pixel character highlight on text nodes using native Range.
   */
  private highlightTextRange(
    element: HTMLElement,
    diff: CharDiffResult | null,
    color: string
  ): void {
    if (!diff) return;

    try {
      const textNode = element.firstChild;
      if (
        textNode &&
        textNode.nodeType === Node.TEXT_NODE &&
        diff.index < (textNode.textContent?.length || 0)
      ) {
        const range = document.createRange();
        range.setStart(textNode, diff.index);
        range.setEnd(textNode, Math.min(textNode.textContent?.length || 0, diff.index + 1));

        const rangeRect = range.getBoundingClientRect();
        if (rangeRect.width > 0 && rangeRect.height > 0) {
          const highlight = document.createElement('div');
          highlight.setAttribute('data-testudo-overlay', 'true');
          highlight.style.cssText = `
            position: absolute;
            top: ${rangeRect.top + window.scrollY}px;
            left: ${rangeRect.left + window.scrollX}px;
            width: ${rangeRect.width}px;
            height: ${rangeRect.height}px;
            background: #FEF08A;
            outline: 2px dashed ${color};
            pointer-events: none;
            z-index: 99998;
          `;
          document.body.appendChild(highlight);
        }
      }
    } catch {
      // Fallback cleanly if Range fails
    }
  }

  /**
   * Injects the floating error HUD badge above the target element.
   */
  private renderFloatingHUD(
    element: HTMLElement,
    message: string,
    diff: CharDiffResult | null,
    color: string
  ): void {
    const rect = element.getBoundingClientRect();
    const hud = document.createElement('div');
    hud.setAttribute('data-testudo-overlay', 'true');

    let diffHtml = '';
    if (diff) {
      diffHtml = `
        <div style="margin-top: 4px; font-size: 11px; font-family: monospace; color: #F87171;">
          ${diff.message}
        </div>
      `;
    }

    hud.style.cssText = `
      position: absolute;
      top: ${Math.max(10, rect.top + window.scrollY - 48)}px;
      left: ${rect.left + window.scrollX}px;
      background: #0F172A;
      color: #F8FAFC;
      border: 1px solid ${color};
      border-radius: 6px;
      padding: 6px 10px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      pointer-events: none;
      z-index: 100000;
      white-space: nowrap;
    `;

    hud.innerHTML = `
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${color};"></span>
        <span>[TESTUDO FAIL] ${message}</span>
      </div>
      ${diffHtml}
    `;

    document.body.appendChild(hud);
  }

  /**
   * Watches for host element removal during SPA navigation and cleans up orphaned overlays.
   */
  private watchForElementRemoval(element: HTMLElement): void {
    if (typeof MutationObserver === 'undefined') return;

    this.activeObserver = new MutationObserver(() => {
      if (!document.body.contains(element)) {
        this.cleanup();
      }
    });

    this.activeObserver.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * Highlights a multi-cell financial calculus failure with distinct non-colliding operand colors,
   * a target failure outline, floating character-level diff zoom card, and connecting formula HUD.
   */
  public highlightCalculus(
    evaluation: any,
    targetElementOrSelector: string | HTMLElement,
    options: { delta?: number; tolerance?: number; autoScroll?: boolean } = {}
  ): void {
    if (typeof document === 'undefined') return;

    this.cleanup();

    const { delta = 0, tolerance = 0.005, autoScroll = true } = options;

    let targetEl: HTMLElement | null = null;
    if (typeof targetElementOrSelector === 'string') {
      targetEl = document.querySelector(targetElementOrSelector);
    } else {
      targetEl = targetElementOrSelector;
    }

    if (!targetEl) return;

    if (autoScroll && targetEl.scrollIntoView) {
      targetEl.scrollIntoView({ behavior: 'instant' as any, block: 'center', inline: 'center' });
    }

    // 1. Highlight each operand with its distinct palette color
    if (evaluation && evaluation.operands) {
      for (const op of evaluation.operands) {
        let el = op.element;
        if (!el && op.selector) {
          el = document.querySelector(op.selector);
        }
        if (el) {
          el.setAttribute('data-testudo-outlined', 'true');
          el.style.setProperty('outline', `2px ${op.borderPattern || 'solid'} ${op.color}`, 'important');
          el.style.setProperty('outline-offset', '2px', 'important');
          el.style.setProperty('box-shadow', `0 0 12px ${op.color}80`, 'important');

          const pill = document.createElement('div');
          pill.setAttribute('data-testudo-overlay', 'true');
          const rect = el.getBoundingClientRect();
          pill.style.cssText = `
            position: absolute;
            top: ${window.scrollY + rect.top - 14}px;
            left: ${window.scrollX + rect.left}px;
            background: ${op.color};
            color: #000;
            font-size: 9px;
            font-weight: 800;
            padding: 1px 5px;
            border-radius: 3px;
            letter-spacing: 0.05em;
            z-index: 100000;
            font-family: monospace;
            pointer-events: none;
          `;
          pill.textContent = `${op.shape ? op.shape + ' ' : ''}${op.label} ${op.selector}`;
          document.body.appendChild(pill);
        }
      }
    }

    // 2. Highlight target element in pulsing crimson
    const crimson = '#F43F5E';
    targetEl.setAttribute('data-testudo-outlined', 'true');
    targetEl.style.setProperty('outline', `2px solid ${crimson}`, 'important');
    targetEl.style.setProperty('outline-offset', '2px', 'important');
    targetEl.style.setProperty('box-shadow', `0 0 15px ${crimson}B3`, 'important');

    const targetRect = targetEl.getBoundingClientRect();

    const targetPill = document.createElement('div');
    targetPill.setAttribute('data-testudo-overlay', 'true');
    targetPill.style.cssText = `
      position: absolute;
      top: ${window.scrollY + targetRect.top - 14}px;
      left: ${window.scrollX + targetRect.left}px;
      background: ${crimson};
      color: #fff;
      font-size: 9px;
      font-weight: 800;
      padding: 1px 5px;
      border-radius: 3px;
      letter-spacing: 0.05em;
      z-index: 100000;
      font-family: monospace;
      pointer-events: none;
    `;
    targetPill.textContent = `🚨 TARGET [ERROR] (Δ ${delta >= 0 ? '+' : ''}${delta})`;
    document.body.appendChild(targetPill);

    // 3. Floating Character-Level Diff Zoom Card (4K-Crisp)
    const targetText = ((targetEl as any).value !== undefined ? (targetEl as any).value : targetEl.textContent) || '';
    const expectedText = `$${Number(evaluation.expectedValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    const diff = charDiff(expectedText, targetText.trim());

    const zoomCard = document.createElement('div');
    zoomCard.setAttribute('data-testudo-overlay', 'true');
    zoomCard.className = 'testudo-diff-zoom';
    zoomCard.style.cssText = `
      position: absolute;
      top: ${window.scrollY + targetRect.top - 80}px;
      left: ${window.scrollX + targetRect.left + 30}px;
      background: #0F172A;
      border: 2px solid ${crimson};
      border-radius: 8px;
      padding: 10px 14px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.85), 0 0 12px rgba(244, 63, 94, 0.4);
      z-index: 100001;
      font-family: monospace;
      color: #F8FAFC;
      font-size: 11px;
      pointer-events: none;
      min-width: 260px;
    `;

    zoomCard.innerHTML = `
      <div style="font-weight: 800; color: ${crimson}; margin-bottom: 6px; font-size: 10px; display: flex; justify-content: space-between;">
        <span>🔍 CHARACTER-LEVEL DIFF ZOOM</span>
        <span style="color: #94A3B8;">Index ${diff ? diff.index : 0}</span>
      </div>
      <div style="display: grid; grid-template-columns: 70px 1fr; gap: 4px; font-size: 11px;">
        <span style="color: #94A3B8;">Expected:</span>
        <span style="color: #34D399; font-weight: 700;">${expectedText}</span>
        <span style="color: #94A3B8;">Actual DOM:</span>
        <span style="color: #F87171; font-weight: 700;">${targetText.trim()}</span>
        <span style="color: #94A3B8;">Divergence:</span>
        <span style="color: #FDE047;">Δ ${delta >= 0 ? '+' : ''}${delta} (Tol: ${tolerance})</span>
      </div>
    `;
    document.body.appendChild(zoomCard);

    this.watchForElementRemoval(targetEl);
  }

  /**
   * Computes the bounding box union of all equation operands plus target element and zoom card.
   */
  public getCalculusClipBox(
    evaluation: any,
    targetElementOrSelector: string | HTMLElement,
    padding = 16
  ): { x: number; y: number; width: number; height: number } {
    if (typeof document === 'undefined') return { x: 0, y: 0, width: 0, height: 0 };

    const rects: Array<{ x: number; y: number; width: number; height: number }> = [];

    if (evaluation && evaluation.operands) {
      for (const op of evaluation.operands) {
        let el = op.element;
        if (!el && op.selector) {
          el = document.querySelector(op.selector);
        }
        if (el && el.getBoundingClientRect) {
          const r = el.getBoundingClientRect();
          rects.push({ x: r.left, y: r.top, width: r.width, height: r.height });
        }
      }
    }

    let targetEl: HTMLElement | null = null;
    if (typeof targetElementOrSelector === 'string') {
      targetEl = document.querySelector(targetElementOrSelector);
    } else {
      targetEl = targetElementOrSelector;
    }

    if (targetEl && targetEl.getBoundingClientRect) {
      const r = targetEl.getBoundingClientRect();
      rects.push({ x: r.left, y: r.top, width: r.width, height: r.height });
    }

    const zoomEl = document.querySelector('.testudo-diff-zoom');
    if (zoomEl && zoomEl.getBoundingClientRect) {
      const r = zoomEl.getBoundingClientRect();
      rects.push({ x: r.left, y: r.top, width: r.width, height: r.height });
    }

    return computeBoundingUnion(rects, padding);
  }
}

/**
 * Computes the minimum bounding box enclosing multiple rectangles with optional margin/padding.
 */
export function computeBoundingUnion(
  rects: Array<{ x: number; y: number; width: number; height: number }>,
  padding = 16
): { x: number; y: number; width: number; height: number } {
  if (!rects || rects.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const r of rects) {
    if (!r || (r.width <= 0 && r.height <= 0)) continue;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }

  if (minX === Infinity) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const x = Math.max(0, Math.floor(minX - padding));
  const y = Math.max(0, Math.floor(minY - padding));
  const width = Math.ceil((maxX - minX) + padding * 2);
  const height = Math.ceil((maxY - minY) + padding * 2);

  return { x, y, width, height };
}

export const visual = new TestudoVisual();

