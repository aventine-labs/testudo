# Linear Character-Level Diff Engine (`$T.diff`)

Traditional diff algorithms (such as Myers or Levenshtein distance) require dynamic programming allocation matrices, weigh 2KB to 5KB minified, and output complex edit graphs. In test assertions and floating error HUDs, engineers do not need a multi-line source code patch; they need to instantly pinpoint the exact character of divergence.

The Testudo Diff Engine provides a sub-300-byte linear divergence walk scanner requiring zero memory allocations.

---

## 1. Why Linear Character Walk?

In 95% of test assertion failures (e.g. SKU codes, tax form IDs, currency values, error messages):
* String lengths are under 100 characters.
* The failure is caused by an unexpected hyphen (`"1040ES"` vs `"1040-ES"`), a transposed digit, or a missing space.
* A linear loop walking index-by-index instantly pinpoints the point of divergence in under 1 microsecond.

---

## 2. API & Usage (`charDiff`)

```javascript
import { diff } from '@aventine/testudo';

const result = diff.charDiff('1040ES', '1040-ES');
console.log(result);
```

### Output:
```json
{
  "index": 4,
  "expectedChar": "E",
  "actualChar": "-",
  "message": "Unexpected '-' at index 4 (expected 'E')",
  "context": {
    "expected": "1040ES",
    "actual": "1040-ES"
  }
}
```

If the strings are strictly identical, `charDiff` returns `null`:
```javascript
diff.charDiff('$1,250.00', '$1,250.00'); // => null
```

---

## 3. Handled Divergence Modes

`charDiff` automatically differentiates between substitution, extra characters, and missing characters:

### Unexpected Character (Substitution)
```javascript
diff.charDiff('TOTAL: $100', 'TOTAL: €100');
// => Unexpected '€' at index 7 (expected '$')
```

### Extra Characters
```javascript
diff.charDiff('test', 'testing');
// => Extra character 'i' at index 4
```

### Missing Characters
```javascript
diff.charDiff('testing', 'test');
// => Missing character 'i' at index 4
```

---

## 4. Telemetry Format for CI Logs & HUDs

The `context` object captures 10 characters before and after the failure index, providing instant visual telemetry in Playwright failure reports and floating in-browser HUDs:

```text
+--------------------------------------------------------------+
| [TESTUDO FAIL] Assertion Failed                              |
| Unexpected '-' at index 4 (expected 'E')                     |
| Context: ...1040[-]ES... vs ...1040[E]S...                   |
+--------------------------------------------------------------+
```

### Signature
```typescript
interface CharDiffResult {
  index: number;
  expectedChar: string;
  actualChar: string;
  message: string;
  context: {
    expected: string;
    actual: string;
  };
}

function charDiff(expected: string, actual: string): CharDiffResult | null;
```
