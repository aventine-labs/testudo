/**
 * @aventine/testudo - Rule 13 Kinetic Scrolling, Asymmetrical Prime Think-Time & Batch Feed Expander
 * Enforces Aventine Labs Rule 13 Browser Automation Directives:
 *   1. Non-Monotonic Kinetic Scrolling ("Double-Take" Heuristic: 350-800px down, 35-40% backtrack -60 to -250px)
 *   2. Asymmetrical Power-User Think Times (Irregular base primes/odds [5,6,8,9,13,17,19,21,23,27,29] + 100-900ms jitter)
 *   3. Fast programmatic batch DOM expansion ("...see more", "Load more comments", nested reply trees)
 * Zero external dependencies.
 */

export const POWER_USER_PRIME_SECONDS = [5, 6, 8, 9, 13, 17, 19, 21, 23, 27, 29] as const;

export interface KineticScrollOptions {
  pulses?: number;
  minDownPx?: number;
  maxDownPx?: number;
  backtrackProbability?: number;
  minBacktrackPx?: number;
  maxBacktrackPx?: number;
  minFixationMs?: number;
  maxFixationMs?: number;
  fastRehearsal?: boolean;
  rng?: () => number;
}

export interface KineticScrollPulseRecord {
  pulseIndex: number;
  downDeltaY: number;
  didBacktrack: boolean;
  backtrackDeltaY: number;
  fixationPauseMs: number;
}

export interface KineticScrollResult {
  totalPulses: number;
  backtrackCount: number;
  netDeltaY: number;
  totalFixationMs: number;
  pulses: KineticScrollPulseRecord[];
}

export interface ThinkPauseOptions {
  tier?: 'micro' | 'review' | 'reading';
  fastRehearsal?: boolean;
  rng?: () => number;
}

export interface ExpandAllOptions {
  scope?: string | HTMLElement | Document;
  patterns?: string[];
  selector?: string;
  maxClicks?: number;
}

function randomBetween(min: number, max: number, rng: () => number = Math.random): number {
  return Math.floor(min + rng() * (max - min + 1));
}

export class TestudoKinetic {
  /**
   * Computes an asymmetrical power-user think time in milliseconds using Rule 13's
   * irregular base primes/odds array + 100ms-900ms jitter. Never produces round 1000ms multiples.
   */
  public computeThinkTimeMs(options: ThinkPauseOptions = {}): number {
    const rng = options.rng ?? Math.random;
    const jitterMs = randomBetween(101, 899, rng);

    if (options.tier === 'micro') {
      return randomBetween(1, 2, rng) * 1000 + jitterMs;
    }
    if (options.tier === 'review') {
      const reviewBases = [3, 5, 6, 7, 8, 9];
      const baseSec = reviewBases[Math.floor(rng() * reviewBases.length)];
      return baseSec * 1000 + jitterMs;
    }

    const baseSec =
      POWER_USER_PRIME_SECONDS[Math.floor(rng() * POWER_USER_PRIME_SECONDS.length)];
    return baseSec * 1000 + jitterMs;
  }

  /**
   * Waits for an asymmetrical power-user think pause (or scaled rehearsal delay in fastRehearsal mode)
   * and returns the computed duration in milliseconds.
   */
  public async thinkPause(options: ThinkPauseOptions = {}): Promise<{ plannedMs: number; waitedMs: number }> {
    const plannedMs = this.computeThinkTimeMs(options);
    const actualWaitMs = options.fastRehearsal ? Math.min(25, Math.max(1, Math.floor(plannedMs / 500))) : plannedMs;
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, actualWaitMs));
    return {
      plannedMs,
      waitedMs: Date.now() - t0
    };
  }

  /**
   * Executes Rule 13 Non-Monotonic Kinetic Scrolling ("Double-Take" Heuristic):
   * Variable downward pulses (350px-800px) with a 35%-40% probability of an immediate
   * upward backtrack (-60px to -250px) and an eye-fixation pause (400ms-900ms).
   */
  public async scrollFeed(options: KineticScrollOptions = {}): Promise<KineticScrollResult> {
    const rng = options.rng ?? Math.random;
    const pulsesCount = Math.max(1, options.pulses ?? 3);
    const minDownPx = options.minDownPx ?? 350;
    const maxDownPx = options.maxDownPx ?? 800;
    const backtrackProb = options.backtrackProbability ?? 0.38;
    const minBackPx = options.minBacktrackPx ?? 60;
    const maxBackPx = options.maxBacktrackPx ?? 250;
    const minFixMs = options.minFixationMs ?? 400;
    const maxFixMs = options.maxFixationMs ?? 900;

    const records: KineticScrollPulseRecord[] = [];
    let netDeltaY = 0;
    let backtrackCount = 0;
    let totalFixationMs = 0;

    const doScrollBy = (dy: number) => {
      if (typeof window !== 'undefined' && typeof window.scrollBy === 'function') {
        try {
          window.scrollBy({ top: dy, left: 0, behavior: 'instant' as any });
        } catch {
          window.scrollBy(0, dy);
        }
      }
    };

    for (let i = 0; i < pulsesCount; i++) {
      const downDeltaY = randomBetween(minDownPx, maxDownPx, rng);
      doScrollBy(downDeltaY);
      netDeltaY += downDeltaY;

      const didBacktrack = rng() < backtrackProb;
      let backtrackDeltaY = 0;
      let fixationPauseMs = randomBetween(120, 320, rng);

      if (didBacktrack) {
        backtrackCount++;
        backtrackDeltaY = -randomBetween(minBackPx, maxBackPx, rng);
        doScrollBy(backtrackDeltaY);
        netDeltaY += backtrackDeltaY;
        fixationPauseMs = randomBetween(minFixMs, maxFixMs, rng);
      }

      totalFixationMs += fixationPauseMs;
      records.push({
        pulseIndex: i + 1,
        downDeltaY,
        didBacktrack,
        backtrackDeltaY,
        fixationPauseMs
      });

      const waitMs = options.fastRehearsal ? Math.min(10, Math.max(1, Math.floor(fixationPauseMs / 100))) : fixationPauseMs;
      await new Promise((r) => setTimeout(r, waitMs));
    }

    return {
      totalPulses: pulsesCount,
      backtrackCount,
      netDeltaY,
      totalFixationMs,
      pulses: records
    };
  }

  /**
   * Batch-expands "...see more", "Load more comments", or custom pattern buttons in <15ms.
   */
  public expandAll(options: ExpandAllOptions = {}): { clickedCount: number; matchedTexts: string[] } {
    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return { clickedCount: 0, matchedTexts: [] };

    let root: Document | HTMLElement = doc;
    if (typeof options.scope === 'string' && options.scope.trim()) {
      const found = doc.querySelector(options.scope.trim()) as HTMLElement | null;
      if (found) root = found;
    } else if (options.scope && typeof options.scope === 'object') {
      root = options.scope as Document | HTMLElement;
    }

    const patterns = (
      options.patterns && options.patterns.length > 0
        ? options.patterns
        : ['see more', '...more', '…more', 'load more', 'show more replies']
    ).map((p) => p.toLowerCase().trim());

    const querySel = options.selector || 'button, [role="button"]';
    const maxClicks = options.maxClicks ?? 50;
    const candidates = Array.from(root.querySelectorAll(querySel)) as HTMLElement[];

    let clickedCount = 0;
    const matchedTexts: string[] = [];

    for (const el of candidates) {
      if (clickedCount >= maxClicks) break;
      if ((el as HTMLButtonElement).disabled) continue;
      const text = ((el.innerText || el.textContent || '') + ' ' + (el.getAttribute('aria-label') || ''))
        .toLowerCase()
        .trim();
      if (!text) continue;

      if (patterns.some((pat) => text.includes(pat))) {
        try {
          if (typeof el.click === 'function') {
            el.click();
          } else {
            el.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
          }
          clickedCount++;
          matchedTexts.push((el.innerText || el.textContent || '').trim().slice(0, 40));
        } catch {
          // Ignore detached or intercepted button error
        }
      }
    }

    return { clickedCount, matchedTexts };
  }
}

export const kinetic = new TestudoKinetic();
