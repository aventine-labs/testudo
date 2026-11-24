/**
 * @aventine/testudo - Synchronized Microsecond DOM Time-Travel Ring (src/timetravel.ts)
 * Captures compact Before / Action / After DOM & Bounding-Box snapshots linked 1:1 to every
 * 5-Lane Waterfall step so developers can scrub Before vs After state without Cypress iframes.
 * Automatically masks sensitive password/card/token inputs per Pillar 1.
 * Zero external dependencies. Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

import { computeDeterministicHash256 } from './wasm-concierge.js';

export interface TimeTravelSnapshotFrame {
  frameId: string;
  stepId: string;
  phase: 'before' | 'after';
  waterfallTimestampUs: number;
  url: string;
  title: string;
  targetSelector: string;
  targetRect?: { x: number; y: number; width: number; height: number };
  redactedHtmlExcerpt: string;
  formStateSummary: Record<string, string>;
  stateSha256: string;
}

export class TestudoTimeTravelRing {
  private maxFrames: number;
  private frames: TimeTravelSnapshotFrame[] = [];

  constructor(maxFrames = 256) {
    this.maxFrames = Math.max(8, maxFrames);
  }

  public clear(): void {
    this.frames = [];
  }

  public captureFrame(options: {
    stepId: string;
    phase: 'before' | 'after';
    waterfallTimestampUs: number;
    targetSelector: string;
    root?: Document | null;
    explicitUrl?: string;
    explicitHtml?: string;
  }): TimeTravelSnapshotFrame {
    const doc = options.root ?? (typeof document !== 'undefined' ? document : null);
    const url = options.explicitUrl || (typeof location !== 'undefined' ? location.href : 'about:blank');
    const title = doc?.title || 'Testudo Snapshot';
    let targetRect: TimeTravelSnapshotFrame['targetRect'];
    const formState: Record<string, string> = {};

    if (doc && typeof doc.querySelector === 'function') {
      try {
        const el = doc.querySelector(options.targetSelector) as HTMLElement | null;
        if (el && typeof el.getBoundingClientRect === 'function') {
          const r = el.getBoundingClientRect();
          targetRect = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
        }
      } catch {
        // ignore invalid selector
      }

      if (typeof doc.querySelectorAll === 'function') {
        const inputs = Array.from(doc.querySelectorAll('input, select, textarea')) as HTMLInputElement[];
        for (const inp of inputs.slice(0, 32)) {
          const key = inp.getAttribute('data-testid') || inp.id || inp.name || inp.tagName.toLowerCase();
          const t = (inp.type || '').toLowerCase();
          const ac = (inp.getAttribute('autocomplete') || '').toLowerCase();
          const sensitive =
            t === 'password' ||
            ac.startsWith('cc-') ||
            ac === 'one-time-code' ||
            inp.getAttribute('data-sensitive') === 'true';
          formState[key] = sensitive ? '[REDACTED_PILLAR_1]' : String(inp.value ?? '').slice(0, 120);
        }
      }
    }

    const rawHtml =
      options.explicitHtml ??
      (doc?.body ? String(doc.body.innerHTML || '').slice(0, 4096) : '<body/>');
    const redactedHtml = rawHtml
      .replace(/(type=["']password["'][^>]*value=["'])[^"']*(['"])/gi, '$1[REDACTED]$2')
      .replace(/\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g, '[REDACTED_SSN]');

    const sigInput = `${url}|${options.stepId}|${options.phase}|${JSON.stringify(formState)}|${redactedHtml}`;
    const frame: TimeTravelSnapshotFrame = {
      frameId: `tt-${this.frames.length + 1}`,
      stepId: options.stepId,
      phase: options.phase,
      waterfallTimestampUs: options.waterfallTimestampUs,
      url,
      title,
      targetSelector: options.targetSelector,
      targetRect,
      redactedHtmlExcerpt: redactedHtml,
      formStateSummary: formState,
      stateSha256: computeDeterministicHash256(sigInput, 'TESTUDO_TIMETRAVEL_V1')
    };

    if (this.frames.length >= this.maxFrames) {
      this.frames.shift();
    }
    this.frames.push(frame);
    return frame;
  }

  public getFrames(): TimeTravelSnapshotFrame[] {
    return this.frames.map((f) => ({ ...f, formStateSummary: { ...f.formStateSummary } }));
  }

  public getStepPair(stepId: string): { before?: TimeTravelSnapshotFrame; after?: TimeTravelSnapshotFrame } {
    return {
      before: this.frames.find((f) => f.stepId === stepId && f.phase === 'before'),
      after: this.frames.find((f) => f.stepId === stepId && f.phase === 'after')
    };
  }
}
