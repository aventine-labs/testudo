/**
 * @aventine/testudo - Format & Currency Engine
 * Excel-style pattern masks, universal currency parsing, and invisible space normalization.
 * Zero external dependencies.
 */

export interface CurrencyOptions {
  currency?: string;
  position?: 'prefix' | 'suffix';
  decimal?: string;
  thousand?: string;
  space?: boolean;
}

export class TestudoFormat {
  /**
   * Normalizes invisible non-breaking spaces (\u00A0, \u202F, \uFEFF) to standard ASCII space (\u0020).
   * Prevents assertion test failures where strings look visually identical but fail strict equality.
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
   * Examples:
   *   pattern(1249.50, '€#,##0.00') => "€1,249.50"
   *   pattern(1249.50, '€#.##0,00') => "€1.249,50"
   *   pattern(1249.50, '#.##0,00 €') => "1.249,50 €"
   *   pattern(1249.50, 'EUR #,##0.00') => "EUR 1,249.50"
   */
  public pattern(value: number, mask: string): string {
    const isNegative = value < 0;
    const absVal = Math.abs(value);

    // Detect decimal and thousands separators in the mask
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
      // e.g. #,##0
      decSep = '';
      thouSep = ',';
    } else if (hasDot && !hasComma) {
      decSep = '.';
      thouSep = '';
    }

    // Determine number of decimal places from mask
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

    // Format thousands
    let formattedInt = intStr;
    if (thouSep) {
      formattedInt = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, thouSep);
    }

    let formattedNum = formattedInt;
    if (decimals > 0 && decStr) {
      formattedNum = formattedInt + (decSep || '.') + decStr;
    }

    // Replace the numeric portion of the mask with the formatted number
    const numRegex = /[#0][#,0.]*[#0]/;
    let result = mask.replace(numRegex, formattedNum);

    if (isNegative) {
      result = '-' + result;
    }

    return this.normalizeWhitespace(result);
  }

  /**
   * Universal Currency & Number Parser.
   * Ingests any format:
   *   "€1.249,50" => 1249.50
   *   "1.249,50 €" => 1249.50
   *   "$1,249.50" => 1249.50
   *   "1 249,50 €" => 1249.50
   *   "(€1,249.50)" => -1249.50 (accounting negative)
   *   "1.249,50- EUR" => -1249.50 (SAP trailing minus)
   */
  public parseCurrency(raw: string, optionsOrLocale?: { locale?: string } | string): number {
    return this.parse(raw, optionsOrLocale);
  }

  public parse(raw: string, optionsOrLocale?: { locale?: string } | string): number {
    if (!raw) return 0;
    const locale = typeof optionsOrLocale === 'string' ? optionsOrLocale : optionsOrLocale?.locale;
    const clean = this.normalizeWhitespace(raw);

    // 1. Detect negative indicators
    let isNegative = false;
    if (clean.startsWith('(') && clean.endsWith(')')) {
      isNegative = true;
    } else if (clean.startsWith('-') || /^[^\d\w]*-/.test(clean)) {
      isNegative = true;
    } else if (/(?:-\s*$|-\s*[A-Za-z]{3}$)/i.test(clean)) {
      // SAP trailing minus (e.g. "1.249,50-" or "1.249,50- EUR" or "1.249,50 - usd")
      isNegative = true;
    }

    // 2. Extract only digits, commas, dots, and spaces
    const digitsOnly = clean.replace(/[^0-9,.\s]/g, '').trim();
    if (!digitsOnly) return 0;

    // Handle space as thousand separator (e.g. "1 249,50")
    const withoutSpaces = digitsOnly.replace(/\s/g, '');

    const lastComma = withoutSpaces.lastIndexOf(',');
    const lastDot = withoutSpaces.lastIndexOf('.');

    let sanitized = withoutSpaces;

    if (lastComma > -1 && lastDot > -1) {
      if (lastComma > lastDot) {
        // European: dots are thousands, comma is decimal (1.249,50)
        sanitized = withoutSpaces.replace(/\./g, '').replace(',', '.');
      } else {
        // Standard US/UK or Indian lakh/crore: commas are thousands (1,249.50 or 12,34,567.89)
        sanitized = withoutSpaces.replace(/,/g, '');
      }
    } else if (lastComma > -1 && lastDot === -1) {
      // Only commas: check locale and parts
      const isEuropeanLocale = locale && /^(de|fr|es|it|pt|nl|ru)/i.test(locale);
      const isUSLocale = locale && /^(en|ja|zh)/i.test(locale);
      const parts = withoutSpaces.split(',');
      if (parts.length === 2 && (parts[1].length <= 2 || isEuropeanLocale) && !isUSLocale) {
        sanitized = parts[0] + '.' + parts[1];
      } else {
        // Indian numbering integer (12,34,567) or standard thousands (1,250,000)
        sanitized = withoutSpaces.replace(/,/g, '');
      }
    } else if (lastDot > -1 && lastComma === -1) {
      // Only dots: check if thousands ("1.250.000") or decimal ("1249.50")
      const parts = withoutSpaces.split('.');
      if (parts.length > 2) {
        sanitized = withoutSpaces.replace(/\./g, '');
      } else if (parts.length === 2) {
        const isEuropeanLocale = locale && /^(de|fr|es|it|pt|nl|ru)/i.test(locale);
        if (parts[1].length === 3 && parseInt(parts[0], 10) < 1000) {
          // Ambiguous: "1.250"
          if (isEuropeanLocale) {
            sanitized = withoutSpaces.replace(/\./g, ''); // 1250 in European locale
          } else {
            sanitized = withoutSpaces; // decimal 1.25
          }
        } else {
          sanitized = withoutSpaces;
        }
      }
    }

    const num = parseFloat(sanitized);
    if (isNaN(num)) return 0;

    return isNegative ? -num : num;
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
