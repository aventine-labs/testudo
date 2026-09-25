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
      const mirror = document.createElement('div');
      mirror.style.cssText = `
        position: absolute;
        top: -9999px;
        left: -9999px;
        visibility: hidden;
        white-space: pre;
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

    // Listen for late dynamic web font swaps (e.g. Next.js Google Fonts)
    if (
      typeof document !== 'undefined' &&
      (document as any).fonts &&
      (document as any).fonts.addEventListener
    ) {
      (document as any).fonts.addEventListener('loadingdone', () => renderGhost(), { once: true });
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
}

export const visual = new TestudoVisual();
