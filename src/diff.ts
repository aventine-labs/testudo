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

  let i = 0;
  const max = Math.max(expected.length, actual.length);

  while (i < max && expected[i] === actual[i]) {
    i++;
  }

  const expChar = expected[i] ?? '(end of string)';
  const actChar = actual[i] ?? '(end of string)';

  const start = Math.max(0, i - 10);
  const end = Math.min(max, i + 10);

  let message = `Unexpected '${actChar}' at index ${i} (expected '${expChar}')`;
  if (!expected[i] && actual[i]) {
    message = `Extra character '${actChar}' at index ${i}`;
  } else if (expected[i] && !actual[i]) {
    message = `Missing character '${expChar}' at index ${i}`;
  }

  return {
    index: i,
    expectedChar: expChar,
    actualChar: actChar,
    message,
    context: {
      expected: expected.slice(start, end),
      actual: actual.slice(start, end)
    }
  };
}
