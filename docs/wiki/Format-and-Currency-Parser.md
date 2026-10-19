# Format & Currency Parser (`$T.format`)

The Testudo Format Engine normalizes invisible whitespace characters, parses global currency strings into clean numbers, and formats numbers using Excel-style pattern masks.

---

## 1. Invisible Whitespace Normalization (`format.normalizeWhitespace`)

In modern web applications, localized formatting libraries (e.g. `Intl.NumberFormat`) frequently inject non-breaking spaces:

- Narrow Non-Breaking Space: `\u202F` (standard in French and German numbers: `1 250,00 €`)
- Standard Non-Breaking Space: `\u00A0` (common in web tables and HTML entity `&nbsp;`)
- Zero-Width No-Break Space / Byte Order Mark: `\uFEFF`

These characters look completely identical to a standard space (`\u0020`) in a browser or screenshot, but cause strict equality assertions (`actual === expected`) to fail silently.

```javascript
import { format } from '@aventine/testudo';

// Converts narrow NBSP (\u202F) and standard NBSP (\u00A0) into ASCII space (\u0020)
const clean = format.normalizeWhitespace('1\u202F249,50\u00A0€');
console.log(clean); // => "1 249,50 €"
```

### Signature

```typescript
function normalizeWhitespace(text: string): string;
```

---

## 2. Universal Currency Parser (`format.parse`)

Enterprise applications render numbers and currencies across dozens of global accounting, banking, and ERP formats. `format.parse` ingests any string format and returns a clean, floating-point number:

```javascript
import { format } from '@aventine/testudo';

// Standard US/UK currency
format.parse('$1,249.50'); // => 1249.50

// European comma decimal format
format.parse('1.249,50 €'); // => 1249.50
format.parse('€1.249,50'); // => 1249.50

// Space as thousands separator
format.parse('1 249,50 €'); // => 1249.50

// Accounting negative (parentheses)
format.parse('(€1,249.50)'); // => -1249.50
format.parse('($1,250.00)'); // => -1250.00

// SAP / ERP trailing minus
format.parse('1.249,50- EUR'); // => -1249.50
format.parse('1250.00-'); // => -1250.00

// Standard negative
format.parse('-€1,249.50'); // => -1249.50
```

### Parsing Rules & Locale Edge Cases

1. **Parentheses Detection**: Any number enclosed in `(...)` is parsed as negative.
2. **Trailing Minus**: Minus signs at the end of the numeric block (`1250.00-`) are parsed as negative.
3. **Separator Inference**:
   - If both commas and periods are present: the last one is treated as the decimal separator and the earlier one as the thousands separator.
   - If only commas are present: single commas followed by 2 digits (`1249,50`) are treated as decimal; otherwise treated as thousands (`1,250,000`).

### Signature

```typescript
function parse(raw: string): number;
```

---

## 3. Excel-Style Pattern Masks (`format.pattern`)

Test engineers can format numbers using familiar Excel and SQL pattern masks:

```javascript
import { format } from '@aventine/testudo';

// US format
format.pattern(1249.5, '$#,##0.00'); // => "$1,249.50"

// European format (period thousands, comma decimal)
format.pattern(1249.5, '€#.##0,00'); // => "€1.249,50"
format.pattern(1249.5, '#.##0,00 €'); // => "1.249,50 €"

// Custom currency prefix
format.pattern(1249.5, 'EUR #,##0.00'); // => "EUR 1,249.50"

// Negative values
format.pattern(-1249.5, '$#,##0.00'); // => "-$1,249.50"
```

### Signature

```typescript
function pattern(value: number, mask: string): string;
```

---

## 4. Granular Currency Formatter (`format.currency`)

Provides high-level currency formatting with explicit options or standard ISO codes:

```javascript
import { format } from '@aventine/testudo';

// Using ISO code and locale
format.currency(1249.5, 'USD', 'en-US'); // => "$1,249.50"
format.currency(1249.5, 'EUR', 'de-DE'); // => "1.249,50 €"

// Using custom options object
format.currency(1249.5, {
  currency: '€',
  position: 'suffix',
  decimal: ',',
  thousand: '.',
  space: true
}); // => "1.249,50 €"
```
