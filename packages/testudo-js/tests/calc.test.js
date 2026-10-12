import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calc, tokenizeExpression } from '../dist/calc.js';
import { computeBoundingUnion } from '../dist/visual.js';

describe('TestudoCalc: Multi-Cell Financial Calculus Engine', () => {
  it('tokenizes arithmetic expressions with selectors, numbers, and operators', () => {
    const tokens = tokenizeExpression('#cell-principal + #cell-interest - #cell-fee - #cell-tax');
    assert.strictEqual(tokens.length, 7);
    assert.strictEqual(tokens[0].type, 'SELECTOR');
    assert.strictEqual(tokens[0].value, '#cell-principal');
    assert.strictEqual(tokens[1].type, 'OPERATOR');
    assert.strictEqual(tokens[1].value, '+');
    assert.strictEqual(tokens[2].type, 'SELECTOR');
    assert.strictEqual(tokens[2].value, '#cell-interest');
  });

  it('correctly evaluates standard arithmetic operator precedence (* and / before + and -)', () => {
    const res1 = calc('10 + 20 * 3').evaluate();
    assert.strictEqual(res1.expectedValue, 70);

    const res2 = calc('100 - 50 / 2').evaluate();
    assert.strictEqual(res2.expectedValue, 75);
  });

  it('correctly evaluates parentheses grouping (A + B) * C', () => {
    const res = calc('(10 + 20) * 3').evaluate();
    assert.strictEqual(res.expectedValue, 90);
  });

  it('evaluates direct currency string expressions', () => {
    const res = calc('$1,200,000.00 + $52,450.00 - $1,200.00 - $1,750.00').evaluate();
    assert.strictEqual(res.expectedValue, 1249500.00);
  });

  it('evaluates expressions using mock selector values', () => {
    const evaluator = calc('#cell-principal + #cell-interest - #cell-fee - #cell-tax', {
      '#cell-principal': '$1,200,000.00',
      '#cell-interest': '+$52,450.00',
      '#cell-fee': '$1,200.00',
      '#cell-tax': '$1,750.00'
    });

    const res = evaluator.evaluate();
    assert.strictEqual(res.expectedValue, 1249500.00);
    assert.strictEqual(res.operands.length, 4);

    // Verify operand colors and labels
    assert.strictEqual(res.operands[0].label, 'Operand [A]');
    assert.strictEqual(res.operands[0].color, '#38BDF8'); // Cyan
    assert.strictEqual(res.operands[0].value, 1200000);

    assert.strictEqual(res.operands[1].label, 'Operand [B]');
    assert.strictEqual(res.operands[1].color, '#F59E0B'); // Amber
    assert.strictEqual(res.operands[1].value, 52450);

    assert.strictEqual(res.operands[2].label, 'Operand [C]');
    assert.strictEqual(res.operands[2].color, '#C084FC'); // Purple

    assert.strictEqual(res.operands[3].label, 'Operand [D]');
    assert.strictEqual(res.operands[3].color, '#34D399'); // Emerald
  });

  it('asserts toEqualCurrency passes within allowable tolerance', async () => {
    const evaluator = calc('#cell-principal + #cell-interest - #cell-fee - #cell-tax', {
      '#cell-principal': 1200000,
      '#cell-interest': 52450,
      '#cell-fee': 1200,
      '#cell-tax': 1750
    });

    // 1,249,500.00 vs 1,249,500.002 with 0.005 tolerance
    const res = await evaluator.toEqualCurrency(1249500.002, { tolerance: 0.005 });
    assert.strictEqual(res.pass, true);
    assert.strictEqual(res.expected, 1249500.00);
  });

  it('asserts toEqualCurrency fails when floating point drift exceeds tolerance', async () => {
    const evaluator = calc('#cell-principal + #cell-interest - #cell-fee - #cell-tax', {
      '#cell-principal': 1200000,
      '#cell-interest': 52450,
      '#cell-fee': 1200,
      '#cell-tax': 1750
    });

    // Expected 1,249,500.00 vs actual 1,249,499.99 (drift of -0.01)
    const res = await evaluator.toEqualCurrency(1249499.99, { tolerance: 0.005, autoHighlight: false });
    assert.strictEqual(res.pass, false);
    assert.strictEqual(res.expected, 1249500.00);
    assert.strictEqual(res.actual, 1249499.99);
    assert.strictEqual(res.delta, -0.01);
  });

  it('computes bounding box union enclosing all participating operand cells and HUD', () => {
    const rects = [
      { x: 520, y: 440, width: 140, height: 40 }, // Operand A
      { x: 670, y: 440, width: 140, height: 40 }, // Operand B
      { x: 820, y: 440, width: 120, height: 40 }, // Operand C
      { x: 950, y: 440, width: 120, height: 40 }, // Operand D
      { x: 1200, y: 440, width: 150, height: 40 }, // Target Cell
      { x: 1465, y: 415, width: 420, height: 160 } // Zoom Card
    ];

    const clip = computeBoundingUnion(rects, 16);
    // minX: 520 - 16 = 504
    // minY: 415 - 16 = 399
    // maxX: 1465 + 420 = 1885 -> width: (1885 - 520) + 32 = 1397
    // maxY: 415 + 160 = 575 -> height: (575 - 415) + 32 = 192
    assert.strictEqual(clip.x, 504);
    assert.strictEqual(clip.y, 399);
    assert.strictEqual(clip.width, 1397);
    assert.strictEqual(clip.height, 192);
  });
});
