/**
 * @aventine/testudo - Character Walk Diff Engine
 * Sub-300-byte linear divergence scanner for floating error HUDs.
 * Zero external dependencies.
 */

export interface CharDiffResult {
  index: number;
  expectedChar: string;
  actualChar: string;
  message: string;
  context: {
    expected: string;
    actual: string;
  };
}

/**
 * Scans two strings character-by-character to locate the exact index of first divergence.
 * Essential for instantaneous, human-readable CI diffs (e.g. 1040ES vs 1040-ES).
 */
export function charDiff(expected: string, actual: string): CharDiffResult | null {
  if (expected === actual) return null;

  // Convert to Unicode code points so multi-byte surrogate pairs (e.g. emojis 👍, 🎉) are never split
  const expPoints = Array.from(expected);
  const actPoints = Array.from(actual);

  let i = 0;
  const max = Math.max(expPoints.length, actPoints.length);

  while (i < max && expPoints[i] === actPoints[i]) {
    i++;
  }

  const expChar = expPoints[i] ?? '(end of string)';
  const actChar = actPoints[i] ?? '(end of string)';

  const start = Math.max(0, i - 10);
  const end = Math.min(max, i + 10);

  let message = `Unexpected '${actChar}' at index ${i} (expected '${expChar}')`;
  if (!expPoints[i] && actPoints[i]) {
    message = `Extra character '${actChar}' at index ${i}`;
  } else if (expPoints[i] && !actPoints[i]) {
    message = `Missing character '${expChar}' at index ${i}`;
  }

  return {
    index: i,
    expectedChar: expChar,
    actualChar: actChar,
    message,
    context: {
      expected: expPoints.slice(start, end).join(''),
      actual: actPoints.slice(start, end).join('')
    }
  };
}

export const diff = {
  chars: charDiff,
  charDiff
};
