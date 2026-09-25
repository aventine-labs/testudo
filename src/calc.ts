/**
 * @aventine/testudo - Multi-Cell Financial Calculus Engine (src/calc.ts)
 * Zero-dependency mathematical expression tokenizer, Shunting-Yard RPN evaluator, and multi-cell financial auditor.
 * Safe arithmetic parsing without eval() or new Function(). 100% CSP compliant.
 *
 * (c) 2026 Aventine Labs LLC. Apache-2.0 License.
 */

import { format } from './format.js';
import { math } from './math.js';

export const parseCurrency = (text: string): number => format.parse(text);

export interface CalcOperand {
  index: number;
  selector: string;
  rawText: string;
  value: number;
  color: string;
  label: string;
  shape?: string;
  borderPattern?: string;
  element?: Element | null;
}

export interface CalcEvaluation {
  expression: string;
  expectedValue: number;
  operands: CalcOperand[];
  tokens: string[];
}

export interface CalcAssertOptions {
  tolerance?: number;
  autoHighlight?: boolean;
  contextNode?: Element | Document | null;
}

export interface CalcAssertResult {
  pass: boolean;
  expected: number;
  actual: number;
  delta: number;
  tolerance: number;
  evaluation: CalcEvaluation;
  targetSelector: string;
  rawTargetText?: string;
}

const PALETTE: string[] = [
  '#38BDF8', // Cyan (Operand A)
  '#F59E0B', // Amber (Operand B)
  '#C084FC', // Purple (Operand C)
  '#34D399', // Emerald (Operand D)
  '#60A5FA', // Sky Blue (Operand E)
  '#F472B6', // Pink (Operand F)
  '#A78BFA'  // Violet (Operand G)
];

const PATTERNS: string[] = [
  'solid',
  'dashed',
  'dotted',
  'double',
  'groove',
  'ridge',
  'dashed'
];

const SHAPES: string[] = [
  '🔷',
  '🔶',
  '🟣',
  '🟩',
  '🔹',
  '🔸',
  '◽'
];

type TokenType = 'NUMBER' | 'SELECTOR' | 'OPERATOR' | 'LPAREN' | 'RPAREN' | 'FUNCTION' | 'COMMA';

interface Token {
  type: TokenType;
  value: string;
  funcName?: string;
}

/**
 * Tokenizes a financial calculus string expression into discrete tokens.
 * Handles numbers, quoted/unquoted selectors, standard operators, parentheses, and aggregation functions.
 */
export function tokenizeExpression(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = expr.length;

  while (i < len) {
    const ch = expr[i];

    // Skip whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Parentheses & commas
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')' });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'COMMA', value: ',' });
      i++;
      continue;
    }

    // Binary operators: + * /
    if (ch === '+' || ch === '*' || ch === '/') {
      tokens.push({ type: 'OPERATOR', value: ch });
      i++;
      continue;
    }

    // Minus operator (-) or negative number
    if (ch === '-') {
      // Determine if unary minus: occurs at start, or after an operator or '('
      const prev = tokens.length > 0 ? tokens[tokens.length - 1] : null;
      const isUnary = !prev || prev.type === 'OPERATOR' || prev.type === 'LPAREN';

      // Check if next characters form a direct number literal (e.g. -10, -0.05)
      const nextChar = i + 1 < len ? expr[i + 1] : '';
      if (isUnary && /[0-9.]/.test(nextChar)) {
        let numStr = '-';
        i++;
        while (i < len && /[0-9.,]/.test(expr[i])) {
          numStr += expr[i];
          i++;
        }
        tokens.push({ type: 'NUMBER', value: numStr });
        continue;
      }

      tokens.push({ type: 'OPERATOR', value: '-' });
      i++;
      continue;
    }

    // Quoted selectors: "selector" or 'selector'
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let strVal = '';
      while (i < len && expr[i] !== quote) {
        strVal += expr[i];
        i++;
      }
      if (i < len) i++; // consume closing quote
      tokens.push({ type: 'SELECTOR', value: strVal });
      continue;
    }

    // Aggregation functions: sum, avg, min, max
    const remaining = expr.slice(i);
    const funcMatch = remaining.match(/^(sum|avg|min|max)\s*\(/i);
    if (funcMatch) {
      tokens.push({ type: 'FUNCTION', value: funcMatch[1].toLowerCase(), funcName: funcMatch[1].toLowerCase() });
      i += funcMatch[1].length;
      continue;
    }

    // Currency or numeric literals starting with currency symbols ($1,200.00, €500)
    if (/^[$€£¥₹]/.test(remaining)) {
      let currStr = '';
      while (i < len) {
        const c = expr[i];
        if (/[\s+*/)]/.test(c)) break;
        if (c === '-' && /\s/.test(expr[i - 1] || '')) break;
        currStr += c;
        i++;
      }
      tokens.push({ type: 'NUMBER', value: currStr });
      continue;
    }

    // Direct numbers (digits, decimal, or comma thousands)
    if (/[0-9]/.test(ch)) {
      let numStr = '';
      while (i < len) {
        const c = expr[i];
        if (/[\s+*/)]/.test(c)) break;
        if (c === '-' && /\s/.test(expr[i - 1] || '')) break;
        if (c === ',' && (i + 1 >= len || !/[0-9]/.test(expr[i + 1]))) break;
        numStr += c;
        i++;
      }
      tokens.push({ type: 'NUMBER', value: numStr });
      continue;
    }

    // CSS Selectors: IDs (#cell-a), classes (.fee-amount), brackets ([data-id="x"]), or tags
    if (ch === '#' || ch === '.' || ch === '[') {
      let selStr = '';
      let inBrackets = false;
      while (i < len) {
        const c = expr[i];
        if (c === '[') inBrackets = true;
        if (c === ']') inBrackets = false;

        if (!inBrackets && /[\s+*,)]/.test(c)) {
          break;
        }
        if (!inBrackets && c === '-' && /\s/.test(expr[i - 1] || '') && /\s/.test(expr[i + 1] || '')) {
          break; // space-separated minus is an operator
        }
        selStr += c;
        i++;
      }
      tokens.push({ type: 'SELECTOR', value: selStr });
      continue;
    }

    // Fallback word token (could be tag selector or named identifier)
    let word = '';
    while (i < len && !/[\s+*/,()-]/.test(expr[i])) {
      word += expr[i];
      i++;
    }
    if (word) {
      tokens.push({ type: 'SELECTOR', value: word });
      continue;
    }

    i++;
  }

  return tokens;
}

/**
 * TestudoCalc class evaluates arithmetic expressions containing DOM selectors and numbers.
 */
export class TestudoCalc {
  private expression: string;
  private customValues?: Record<string, number | string>;

  constructor(expression: string, customValues?: Record<string, number | string>) {
    this.expression = expression.trim();
    this.customValues = customValues;
  }

  /**
   * Evaluates the calculus expression against the active DOM or custom mock values.
   */
  public evaluate(contextNode?: Element | Document | null): CalcEvaluation {
    const tokens = tokenizeExpression(this.expression);
    const operands: CalcOperand[] = [];
    const doc = contextNode || (typeof document !== 'undefined' ? document : null);

    let operandIndex = 0;

    // Helper to resolve numerical value of a token
    const resolveTokenValue = (tok: Token): number => {
      if (tok.type === 'NUMBER') {
        return parseCurrency(tok.value);
      }

      if (tok.type === 'SELECTOR') {
        const sel = tok.value;

        // 1. Check custom user-supplied mock values first
        if (this.customValues && this.customValues[sel] !== undefined) {
          const val = this.customValues[sel];
          const numVal = typeof val === 'number' ? val : parseCurrency(String(val));
          operands.push({
            index: operandIndex,
            selector: sel,
            rawText: String(val),
            value: numVal,
            color: PALETTE[operandIndex % PALETTE.length],
            borderPattern: PATTERNS[operandIndex % PATTERNS.length],
            shape: SHAPES[operandIndex % SHAPES.length],
            label: `Operand [${String.fromCharCode(65 + (operandIndex % 26))}]`
          });
          operandIndex++;
          return numVal;
        }

        // 2. Resolve in DOM
        if (doc && doc.querySelector) {
          const el = doc.querySelector(sel);
          if (el) {
            const rawText = ((el as any).value !== undefined ? (el as any).value : el.textContent) || '';
            const numVal = parseCurrency(rawText);
            operands.push({
              index: operandIndex,
              selector: sel,
              rawText: rawText.trim(),
              value: numVal,
              color: PALETTE[operandIndex % PALETTE.length],
              borderPattern: PATTERNS[operandIndex % PATTERNS.length],
              shape: SHAPES[operandIndex % SHAPES.length],
              label: `Operand [${String.fromCharCode(65 + (operandIndex % 26))}]`,
              element: el
            });
            operandIndex++;
            return numVal;
          }
        }

        // If selector cannot be found, record as 0
        operands.push({
          index: operandIndex,
          selector: sel,
          rawText: 'NOT_FOUND',
          value: 0,
          color: PALETTE[operandIndex % PALETTE.length],
          borderPattern: PATTERNS[operandIndex % PATTERNS.length],
          shape: SHAPES[operandIndex % SHAPES.length],
          label: `Operand [${String.fromCharCode(65 + (operandIndex % 26))}]`
        });
        operandIndex++;
        return 0;
      }

      return 0;
    };

    // Evaluate tokens using Shunting-Yard Algorithm to produce RPN and compute result
    const outputQueue: (number | string)[] = [];
    const opStack: string[] = [];
    const funcArgCountStack: number[] = [];

    const PRECEDENCE: Record<string, number> = {
      '+': 1,
      '-': 1,
      '*': 2,
      '/': 2,
      'u-': 3 // unary minus
    };

    for (let k = 0; k < tokens.length; k++) {
      const tok = tokens[k];

      if (tok.type === 'NUMBER' || tok.type === 'SELECTOR') {
        const val = resolveTokenValue(tok);
        outputQueue.push(val);
      } else if (tok.type === 'FUNCTION') {
        opStack.push(tok.value);
        funcArgCountStack.push(1);
      } else if (tok.type === 'COMMA') {
        while (opStack.length > 0 && opStack[opStack.length - 1] !== '(') {
          outputQueue.push(opStack.pop()!);
        }
        if (funcArgCountStack.length > 0) {
          funcArgCountStack[funcArgCountStack.length - 1]++;
        }
      } else if (tok.type === 'OPERATOR') {
        let op = tok.value;
        const prevTok = k > 0 ? tokens[k - 1] : null;
        if (op === '-' && (!prevTok || prevTok.type === 'OPERATOR' || prevTok.type === 'LPAREN' || prevTok.type === 'COMMA')) {
          op = 'u-';
        }

        while (
          opStack.length > 0 &&
          opStack[opStack.length - 1] !== '(' &&
          PRECEDENCE[opStack[opStack.length - 1]] >= PRECEDENCE[op]
        ) {
          outputQueue.push(opStack.pop()!);
        }
        opStack.push(op);
      } else if (tok.type === 'LPAREN') {
        opStack.push('(');
      } else if (tok.type === 'RPAREN') {
        while (opStack.length > 0 && opStack[opStack.length - 1] !== '(') {
          outputQueue.push(opStack.pop()!);
        }
        if (opStack.length > 0 && opStack[opStack.length - 1] === '(') {
          opStack.pop(); // discard '('
        }
        // If top of stack is function, pop it with its argument count
        if (opStack.length > 0 && /^(sum|avg|min|max)$/.test(opStack[opStack.length - 1])) {
          const fn = opStack.pop()!;
          const count = funcArgCountStack.length > 0 ? funcArgCountStack.pop()! : 0;
          outputQueue.push(`${fn}:${count}`);
        }
      }
    }

    while (opStack.length > 0) {
      outputQueue.push(opStack.pop()!);
    }

    // Evaluate RPN
    const evalStack: number[] = [];
    for (const item of outputQueue) {
      if (typeof item === 'number') {
        evalStack.push(item);
      } else if (typeof item === 'string') {
        if (item === 'u-') {
          const a = evalStack.pop() || 0;
          evalStack.push(-a);
        } else if (item === '+' || item === '-' || item === '*' || item === '/') {
          const b = evalStack.pop() || 0;
          const a = evalStack.pop() || 0;
          let res = 0;
          switch (item) {
            case '+': res = a + b; break;
            case '-': res = a - b; break;
            case '*': res = a * b; break;
            case '/':
              if (b === 0) {
                throw new Error('TestudoCalc: Division by zero in expression');
              }
              res = a / b;
              break;
          }
          evalStack.push(res);
        } else if (item.startsWith('sum:') || item.startsWith('avg:') || item.startsWith('min:') || item.startsWith('max:')) {
          const [fn, countStr] = item.split(':');
          const count = parseInt(countStr, 10);
          const args: number[] = [];
          for (let c = 0; c < count; c++) {
            if (evalStack.length > 0) {
              args.unshift(evalStack.pop()!);
            }
          }
          if (args.length === 0) {
            evalStack.push(0);
          } else if (fn === 'sum') {
            evalStack.push(args.reduce((acc, curr) => acc + curr, 0));
          } else if (fn === 'avg') {
            evalStack.push(args.reduce((acc, curr) => acc + curr, 0) / args.length);
          } else if (fn === 'min') {
            evalStack.push(Math.min(...args));
          } else if (fn === 'max') {
            evalStack.push(Math.max(...args));
          }
        }
      }
    }

    const rawResult = evalStack.length > 0 ? evalStack[0] : 0;
    // Round to 8 decimal places to eliminate floating point binary representation noise
    const expectedValue = Math.round(rawResult * 1e8) / 1e8;

    return {
      expression: this.expression,
      expectedValue,
      operands,
      tokens: tokens.map((t) => t.value)
    };
  }

  /**
   * Asserts that the calculated total matches a live target DOM element or expected number.
   * If autoHighlight is enabled (default true) and the assertion fails, triggers highlightCalculus().
   */
  public async toEqualCurrency(
    targetSelectorOrValue: string | number,
    options: CalcAssertOptions = {}
  ): Promise<CalcAssertResult> {
    const { tolerance = 0.005, autoHighlight = true, contextNode } = options;
    const evaluation = this.evaluate(contextNode);
    const doc = contextNode || (typeof document !== 'undefined' ? document : null);

    let actual = 0;
    let rawTargetText = '';
    let targetSelector = '';
    let targetElement: any = null;

    if (typeof targetSelectorOrValue === 'number') {
      actual = targetSelectorOrValue;
      rawTargetText = String(targetSelectorOrValue);
      targetSelector = 'literal';
    } else {
      targetSelector = targetSelectorOrValue;
      if (doc && doc.querySelector) {
        targetElement = doc.querySelector(targetSelector);
        if (targetElement) {
          rawTargetText = (targetElement.value !== undefined ? targetElement.value : targetElement.textContent) || '';
          actual = parseCurrency(rawTargetText);
        }
      }
    }

    const expected = evaluation.expectedValue;
    const delta = Math.round((actual - expected) * 1e4) / 1e4;
    const pass = math.isCloseTo(expected, actual, tolerance);

    if (!pass && autoHighlight && targetElement) {
      try {
        const { visual } = await import('./visual.js');
        if (visual && visual.highlightCalculus) {
          visual.highlightCalculus(evaluation, targetElement, { delta, tolerance });
        }
      } catch {
        // Visual highlights gracefully ignored in non-DOM test runners
      }
    }

    return {
      pass,
      expected,
      actual,
      delta,
      tolerance,
      evaluation,
      targetSelector,
      rawTargetText
    };
  }
}

/**
 * Creates a TestudoCalc instance for evaluating multi-cell financial arithmetic expressions.
 */
export function calc(expression: string, customValues?: Record<string, number | string>): TestudoCalc {
  return new TestudoCalc(expression, customValues);
}

calc.evaluate = (expression: string, customValues?: Record<string, number | string>): number => {
  return new TestudoCalc(expression, customValues).evaluate().expectedValue;
};

calc.eval = calc.evaluate;
