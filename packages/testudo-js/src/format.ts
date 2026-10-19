/**
 * @aventine/testudo - Format, Monetary & Basis-Point Engine
 * Excel-style pattern masks, fail-closed monetary/basis-point parsing, and invisible space normalization.
 * Zero external dependencies.
 */

export interface CurrencyOptions {
  currency?: string;
  position?: 'prefix' | 'suffix';
  decimal?: string;
  thousand?: string;
  space?: boolean;
}

export type TestudoFormatErrorCode =
  | 'AMBIGUOUS_NUMERIC_VALUE'
  | 'INVALID_NUMERIC_FORMAT'
  | 'UNIT_MISMATCH_BPS'
  | 'INVALID_BPS_FORMAT';

export class TestudoFormatError extends Error {
  public readonly code: TestudoFormatErrorCode;
  public readonly rawInput: string;
  public readonly tokens?: string[];

  constructor(code: TestudoFormatErrorCode, message: string, rawInput: string, tokens?: string[]) {
    super(`[Testudo ${code}] ${message}`);
    this.name = 'TestudoFormatError';
    this.code = code;
    this.rawInput = rawInput;
    if (tokens) this.tokens = tokens;
  }
}

export interface MonetaryParseOptions {
  locale?: string;
  tokenIndex?: number;
  strict?: boolean;
  applyMagnitude?: boolean;
}

export type FormatParseOptions = MonetaryParseOptions;

export interface MonetaryTokenResult {
  value: number;
  unscaledValue: number;
  multiplier: number;
  suffix: string | null;
  unit: 'currency' | 'percent' | 'bps' | 'number';
  hasCurrencySymbol: boolean;
  rawToken: string;
}

export interface BasisPointsResult {
  bps: number;
  percent: number;
  decimal: number;
  unit: 'bps';
}

const MAGNITUDE_MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  thousands: 1e3,
  m: 1e6,
  mm: 1e6,
  million: 1e6,
  millions: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
  billions: 1e9,
  t: 1e12,
  trillion: 1e12,
  trillions: 1e12
};

export class TestudoFormat {
  /**
   * Normalizes invisible non-breaking spaces (\u00A0, \u202F, \uFEFF) to standard ASCII space (\u0020).
   */
  public normalizeWhitespace(text: string): string {
    if (!text) return '';
    return text
      .replace(/[\u00A0\u2000-\u200B\u202F\uFEFF]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Formats a number using an Excel/SQL pattern mask.
   */
  public pattern(value: number, mask: string): string {
    const isNegative = value < 0;
    const absVal = Math.abs(value);

    const hasComma = mask.includes(',');
    const hasDot = mask.includes('.');

    let decSep = '.';
    let thouSep = ',';

    if (hasComma && hasDot) {
      if (mask.lastIndexOf(',') > mask.lastIndexOf('.')) {
        decSep = ',';
        thouSep = '.';
      } else {
        decSep = '.';
        thouSep = ',';
      }
    } else if (hasComma && !hasDot) {
      decSep = '';
      thouSep = ',';
    } else if (hasDot && !hasComma) {
      decSep = '.';
      thouSep = '';
    }

    let decimals = 2;
    if (decSep) {
      const parts = mask.split(decSep);
      if (parts.length > 1) {
        const decPart = parts[1].replace(/[^0#]/g, '');
        decimals = decPart.length;
      }
    }

    const fixedStr = absVal.toFixed(decimals);
    const [intStr, decStr] = fixedStr.split('.');

    let formattedInt = intStr;
    if (thouSep) {
      formattedInt = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, thouSep);
    }

    let formattedNum = formattedInt;
    if (decimals > 0 && decStr) {
      formattedNum = formattedInt + (decSep || '.') + decStr;
    }

    const numRegex = /[#0][#,0.]*[#0]/;
    let result = mask.replace(numRegex, formattedNum);

    if (isNegative) {
      result = '-' + result;
    }

    return this.normalizeWhitespace(result);
  }

  /**
   * Extracts all structured numeric/monetary tokens from a string without conflating prose punctuation.
   */
  public extractTokens(raw: string, locale?: string, strict: boolean = true): MonetaryTokenResult[] {
    const clean = this.normalizeWhitespace(raw);
    if (!clean) return [];

    // Match candidate numeric tokens with optional prefix/suffix
    const tokenRegex =
      /(?:(\()?\s*([+-])?\s*(?:([$€£¥₹]|USD|EUR|GBP|JPY|CHF|CAD|AUD|INR)\s*)?([+-])?\s*)?(\d(?:[\d,.]*\d|\s\d{3}(?![\d]))*(?:[eE][+-]?\d+)?)(?:\s*([+-])?(?:\s*(basis\s+points|bps|bp|%|trillions?|billions?|millions?|thousands?|bn|mm|[kmbtKMBT]|[$€£¥₹]|USD|EUR|GBP|JPY|CHF|CAD|AUD|INR))?\s*(\))?)/gi;

    const results: MonetaryTokenResult[] = [];
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(clean)) !== null) {
      const fullMatch = match[0].trim();
      const openParen = match[1];
      const sign1 = match[2];
      const prefixCurr = match[3];
      const sign2 = match[4];
      const numCore = match[5];
      const trailingSign = match[6];
      const suffixToken = match[7];
      const closeParen = match[8];

      // Check if trailing minus appears after suffix (e.g. "1.249,50- EUR")
      const afterIndex = match.index + match[0].length;
      const tailSlice = clean.slice(afterIndex, afterIndex + 8);
      const hasTrailingCurrAfterMinus = trailingSign === '-' && /^\s*(?:USD|EUR|GBP|JPY|CHF|CAD|AUD|INR)\b/i.test(tailSlice);

      const isParenNegative = Boolean(openParen && closeParen);
      if ((openParen && !closeParen) || (!openParen && closeParen)) {
        if (strict && clean.includes('(') && clean.includes(')')) {
          throw new TestudoFormatError(
            'INVALID_NUMERIC_FORMAT',
            `Unbalanced accounting parentheses in "${raw}"`,
            raw
          );
        }
      }

      const isNegative =
        isParenNegative ||
        sign1 === '-' ||
        sign2 === '-' ||
        trailingSign === '-';

      const unscaledAbs = this.parseNumberCore(numCore, raw, locale, strict);
      const unscaledValue = isNegative && unscaledAbs !== 0 ? -unscaledAbs : unscaledAbs;

      let multiplier = 1;
      let unit: 'currency' | 'percent' | 'bps' | 'number' = 'number';
      const hasCurrencySymbol = Boolean(
        prefixCurr ||
          (suffixToken && /^([$€£¥₹]|USD|EUR|GBP|JPY|CHF|CAD|AUD|INR)$/i.test(suffixToken)) ||
          hasTrailingCurrAfterMinus
      );

      if (hasCurrencySymbol) {
        unit = 'currency';
      }

      let normalizedSuffix: string | null = null;
      if (suffixToken) {
        const lowerSuffix = suffixToken.toLowerCase().replace(/\s+/g, ' ');
        if (lowerSuffix === 'bps' || lowerSuffix === 'bp' || lowerSuffix === 'basis points') {
          unit = 'bps';
          normalizedSuffix = 'bps';
        } else if (lowerSuffix === '%') {
          unit = 'percent';
          normalizedSuffix = '%';
        } else if (MAGNITUDE_MULTIPLIERS[lowerSuffix] !== undefined) {
          multiplier = MAGNITUDE_MULTIPLIERS[lowerSuffix];
          normalizedSuffix = suffixToken;
        }
      }

      const scaledValue = unscaledValue * multiplier;
      results.push({
        value: scaledValue,
        unscaledValue,
        multiplier,
        suffix: normalizedSuffix,
        unit,
        hasCurrencySymbol,
        rawToken: fullMatch
      });
    }

    return results;
  }

  private parseNumberCore(numCore: string, fullRaw: string, locale?: string, strict: boolean = true): number {
    // Strip space thousand separators (e.g. "1 249,50")
    const withoutSpaces = numCore.replace(/\s+/g, '');

    if (strict) {
      if (/,,|\.\.|,\.|\.,/.test(withoutSpaces)) {
        throw new TestudoFormatError(
          'INVALID_NUMERIC_FORMAT',
          `Invalid adjacent separators in "${fullRaw}"`,
          fullRaw
        );
      }
    }

    // Handle scientific notation (e.g. "1.25e6" or "-3.4E-2")
    if (/[eE][+-]?\d+$/.test(withoutSpaces)) {
      const normalizedSci = withoutSpaces.replace(',', '.');
      const parsedSci = Number(normalizedSci);
      if (!Number.isFinite(parsedSci)) {
        if (strict) {
          throw new TestudoFormatError('INVALID_NUMERIC_FORMAT', `Invalid scientific notation in "${fullRaw}"`, fullRaw);
        }
        return 0;
      }
      return Math.abs(parsedSci);
    }

    const lastComma = withoutSpaces.lastIndexOf(',');
    const lastDot = withoutSpaces.lastIndexOf('.');
    let sanitized = withoutSpaces;

    if (lastComma > -1 && lastDot > -1) {
      if (lastComma > lastDot) {
        // European format: dots are thousands, single comma is decimal (e.g. "1.249,50" or "1.250.000,50")
        const commaParts = withoutSpaces.split(',');
        if (strict && commaParts.length > 2) {
          throw new TestudoFormatError(
            'INVALID_NUMERIC_FORMAT',
            `Multiple decimal commas in "${fullRaw}"`,
            fullRaw
          );
        }
        const intPart = commaParts[0];
        if (strict && !/^\d{1,3}(?:\.\d{3})+$/.test(intPart)) {
          throw new TestudoFormatError(
            'INVALID_NUMERIC_FORMAT',
            `Malformed European thousand grouping in "${fullRaw}"`,
            fullRaw
          );
        }
        sanitized = intPart.replace(/\./g, '') + '.' + commaParts[1];
      } else {
        // US/UK or Indian format: commas are thousands, single dot is decimal (e.g. "1,249.50" or "12,34,567.89")
        const dotParts = withoutSpaces.split('.');
        if (strict && dotParts.length > 2) {
          throw new TestudoFormatError(
            'INVALID_NUMERIC_FORMAT',
            `Multiple decimal dots in "${fullRaw}"`,
            fullRaw
          );
        }
        const intPart = dotParts[0];
        const isStandardThousands = /^\d{1,3}(?:,\d{3})+$/.test(intPart);
        const isIndianThousands = /^\d{1,2}(?:,\d{2})*,\d{3}$/.test(intPart);
        if (strict && !isStandardThousands && !isIndianThousands) {
          throw new TestudoFormatError(
            'INVALID_NUMERIC_FORMAT',
            `Malformed comma thousand grouping in "${fullRaw}"`,
            fullRaw
          );
        }
        sanitized = intPart.replace(/,/g, '') + '.' + dotParts[1];
      }
    } else if (lastComma > -1 && lastDot === -1) {
      const isEuropeanLocale = locale && /^(de|fr|es|it|pt|nl|ru)/i.test(locale);
      const isUSLocale = locale && /^(en|ja|zh)/i.test(locale);
      const parts = withoutSpaces.split(',');
      if (parts.length === 2 && (parts[1].length <= 2 || isEuropeanLocale) && !isUSLocale) {
        sanitized = parts[0] + '.' + parts[1];
      } else {
        const isStandardThousands = /^\d{1,3}(?:,\d{3})+$/.test(withoutSpaces);
        const isIndianThousands = /^\d{1,2}(?:,\d{2})*,\d{3}$/.test(withoutSpaces);
        if (strict && !isStandardThousands && !isIndianThousands) {
          throw new TestudoFormatError(
            'INVALID_NUMERIC_FORMAT',
            `Malformed comma grouping in "${fullRaw}"`,
            fullRaw
          );
        }
        sanitized = withoutSpaces.replace(/,/g, '');
      }
    } else if (lastDot > -1 && lastComma === -1) {
      const parts = withoutSpaces.split('.');
      if (parts.length > 2) {
        // Multiple dots: only valid if every group after the first has exactly 3 digits (European integer thousands "1.250.000")
        if (strict && !/^\d{1,3}(?:\.\d{3})+$/.test(withoutSpaces)) {
          throw new TestudoFormatError(
            'INVALID_NUMERIC_FORMAT',
            `Malformed multi-dot number "${fullRaw}"`,
            fullRaw
          );
        }
        sanitized = withoutSpaces.replace(/\./g, '');
      } else if (parts.length === 2) {
        const isEuropeanLocale = locale && /^(de|fr|es|it|pt|nl|ru)/i.test(locale);
        if (parts[1].length === 3 && parseInt(parts[0], 10) < 1000 && isEuropeanLocale) {
          sanitized = withoutSpaces.replace(/\./g, '');
        } else {
          sanitized = withoutSpaces;
        }
      }
    }

    const num = parseFloat(sanitized);
    if (Number.isNaN(num)) {
      if (strict) {
        throw new TestudoFormatError('INVALID_NUMERIC_FORMAT', `Unable to parse numeric value from "${fullRaw}"`, fullRaw);
      }
      return 0;
    }
    return num;
  }

  /**
   * Fail-closed Monetary & Financial Number Parser.
   * - 1 unambiguous monetary/numeric value: parses and applies exact magnitude suffix (K, M, B, T).
   * - > 1 numeric values: fails closed with AMBIGUOUS_NUMERIC_VALUE unless { tokenIndex } is provided.
   * - 0 numeric values or malformed number: fails closed with INVALID_NUMERIC_FORMAT.
   * - Basis points ("45 bps"): fails closed with UNIT_MISMATCH_BPS.
   */
  public parseMonetary(raw: string | number, options: MonetaryParseOptions = {}): number {
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) {
        throw new TestudoFormatError('INVALID_NUMERIC_FORMAT', `Expected finite number, got ${raw}`, String(raw));
      }
      return raw;
    }

    if (typeof raw !== 'string' || !raw.trim()) {
      throw new TestudoFormatError('INVALID_NUMERIC_FORMAT', 'Cannot parse empty or non-string monetary value.', String(raw ?? ''));
    }

    const clean = this.normalizeWhitespace(raw);
    if ((clean.includes('(') && !clean.includes(')')) || (!clean.includes('(') && clean.includes(')'))) {
      throw new TestudoFormatError('INVALID_NUMERIC_FORMAT', `Unbalanced parentheses in "${raw}"`, raw);
    }

    const tokens = this.extractTokens(clean, options.locale, true);
    if (tokens.length === 0) {
      throw new TestudoFormatError(
        'INVALID_NUMERIC_FORMAT',
        `No valid numeric value found in "${raw}"`,
        raw
      );
    }

    let selected: MonetaryTokenResult;
    if (options.tokenIndex !== undefined) {
      if (options.tokenIndex < 0 || options.tokenIndex >= tokens.length) {
        throw new TestudoFormatError(
          'INVALID_NUMERIC_FORMAT',
          `tokenIndex ${options.tokenIndex} is out of range (found ${tokens.length} tokens in "${raw}")`,
          raw,
          tokens.map((t) => t.rawToken)
        );
      }
      selected = tokens[options.tokenIndex];
    } else if (tokens.length > 1) {
      const tokenList = tokens.map((t) => `"${t.rawToken}"`).join(', ');
      throw new TestudoFormatError(
        'AMBIGUOUS_NUMERIC_VALUE',
        `Found ${tokens.length} numeric values in target text (${tokenList}).Testudo refuses to guess which value is intended. Target a more specific child selector or pass { tokenIndex }.`,
        raw,
        tokens.map((t) => t.rawToken)
      );
    } else {
      selected = tokens[0];
    }

    if (selected.unit === 'bps') {
      throw new TestudoFormatError(
        'UNIT_MISMATCH_BPS',
        `Target value "${selected.rawToken}" is formatted in basis points (bps), not currency. Use format.parseBasisPoints() instead.`,
        raw
      );
    }

    return options.applyMagnitude === false ? selected.unscaledValue : selected.value;
  }

  /**
   * Typed Basis-Points Parser.
   * Treats basis points ("45 bps", "-12.5 bp", "0.45%") as a separate typed unit rather than currency.
   */
  public parseBasisPoints(raw: string | number, options: { tokenIndex?: number; locale?: string } = {}): BasisPointsResult {
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) {
        throw new TestudoFormatError('INVALID_BPS_FORMAT', `Expected finite basis points number, got ${raw}`, String(raw));
      }
      return {
        bps: raw,
        percent: raw / 100,
        decimal: raw / 10000,
        unit: 'bps'
      };
    }

    if (typeof raw !== 'string' || !raw.trim()) {
      throw new TestudoFormatError('INVALID_BPS_FORMAT', 'Cannot parse empty basis-points string.', String(raw ?? ''));
    }

    const tokens = this.extractTokens(raw, options.locale, true);
    if (tokens.length === 0) {
      throw new TestudoFormatError('INVALID_BPS_FORMAT', `No numeric basis-points value found in "${raw}"`, raw);
    }

    let selected: MonetaryTokenResult;
    if (options.tokenIndex !== undefined) {
      if (options.tokenIndex < 0 || options.tokenIndex >= tokens.length) {
        throw new TestudoFormatError('INVALID_BPS_FORMAT', `tokenIndex ${options.tokenIndex} out of bounds`, raw);
      }
      selected = tokens[options.tokenIndex];
    } else if (tokens.length > 1) {
      throw new TestudoFormatError(
        'AMBIGUOUS_NUMERIC_VALUE',
        `Found ${tokens.length} numeric values in "${raw}" when parsing basis points.`,
        raw,
        tokens.map((t) => t.rawToken)
      );
    } else {
      selected = tokens[0];
    }

    if (selected.hasCurrencySymbol || selected.multiplier !== 1) {
      throw new TestudoFormatError(
        'INVALID_BPS_FORMAT',
        `Cannot parse currency or magnitude-scaled value "${selected.rawToken}" as basis points.`,
        raw
      );
    }

    if (selected.unit === 'percent') {
      const bps = Math.round(selected.unscaledValue * 100 * 1e6) / 1e6;
      return {
        bps,
        percent: selected.unscaledValue,
        decimal: Math.round((selected.unscaledValue / 100) * 1e12) / 1e12,
        unit: 'bps'
      };
    }

    if (selected.unit === 'bps') {
      const bps = selected.unscaledValue;
      return {
        bps,
        percent: Math.round((bps / 100) * 1e10) / 1e10,
        decimal: Math.round((bps / 10000) * 1e12) / 1e12,
        unit: 'bps'
      };
    }

    throw new TestudoFormatError(
      'INVALID_BPS_FORMAT',
      `String "${raw}" is missing an explicit basis-point ("bps"/"bp") or percentage ("%") unit suffix.`,
      raw
    );
  }

  /**
   * Universal Currency & Number Parser.
   * Fail-closed by default (identical to parseMonetary). Pass { strict: false } only if legacy 0 fallback is desired.
   */
  public parseCurrency(raw: string, optionsOrLocale?: MonetaryParseOptions | string): number {
    return this.parse(raw, optionsOrLocale);
  }

  public parse(raw: string, optionsOrLocale?: MonetaryParseOptions | string): number {
    const opts: MonetaryParseOptions =
      typeof optionsOrLocale === 'string' ? { locale: optionsOrLocale } : optionsOrLocale || {};

    if (opts.strict === false) {
      if (!raw || typeof raw !== 'string' || !raw.trim()) return 0;
      try {
        return this.parseMonetary(raw, opts);
      } catch {
        return 0;
      }
    }

    return this.parseMonetary(raw, opts);
  }

  /**
   * Formats a currency value with granular options or standard ISO codes.
   */
  public currency(
    value: number,
    optionsOrCurrency: string | CurrencyOptions = 'USD',
    locale: string = 'en-US'
  ): string {
    if (typeof optionsOrCurrency === 'string') {
      const curr = optionsOrCurrency;
      const symbols: Record<string, string> = {
        USD: '$',
        EUR: '€',
        GBP: '£',
        JPY: '¥'
      };
      const symbol = symbols[curr] || curr;

      if (locale === 'de-DE' || locale === 'fr-FR') {
        return this.pattern(value, `#.##0,00 ${symbol}`);
      } else if (locale === 'nl-NL' || locale === 'en-IE') {
        return this.pattern(value, `${symbol} #.##0,00`);
      }
      return this.pattern(value, `${symbol}#,##0.00`);
    }

    const opts = optionsOrCurrency;
    const sym = opts.currency || '$';
    const pos = opts.position || 'prefix';
    const dec = opts.decimal || '.';
    const thou = opts.thousand || ',';
    const sp = opts.space ? ' ' : '';

    const mask =
      pos === 'prefix' ? `${sym}${sp}#${thou}##0${dec}00` : `#${thou}##0${dec}00${sp}${sym}`;

    return this.pattern(value, mask);
  }
}

export const format = new TestudoFormat();
