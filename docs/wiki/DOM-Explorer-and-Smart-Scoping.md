# DOM Explorer & Smart Scoping (`$T.scan` & `$T.explore`)

Junior QA testers and software engineers frequently spend hours trying to figure out which elements on a page are interactive, inspecting deep component trees, and building brittle CSS selectors that break on the next release.

Testudo provides an interactive in-browser DOM exploration and scoping system designed to generate resilient, standards-compliant copy-paste Playwright snippets in seconds:

![Testudo DOM Explorer Full Blotter](https://raw.githubusercontent.com/aventine-labs/testudo/main/assets/screenshots/testudo_dom_explorer_blotter_screengrab.png)

---

## 1. In-Browser Visual Badges (`$T.explore`)

In addition to console output, `$T.explore()` renders visual numbered blue badges (`[1]`, `[2]`, `[3]`, ...) directly over every interactive element in the live browser:

![Testudo DOM Explorer Tight Crop](https://raw.githubusercontent.com/aventine-labs/testudo/main/assets/screenshots/testudo_dom_explorer_tight_crop.png)

```javascript
// In DevTools console or synthetic script
$T.explore('blotter-controls');
```

- **Hovering**: Displays element details, matched identifiers, and the recommended selector snippet.
- **Clicking a Badge**: Automatically copies the runnable Playwright code snippet (`await $T('#btn-recalc').click();`) directly to your clipboard, flashing green with a `"✓ Copied!"` indicator.
- **Calling Again**: Toggles badges off to clean up the page (`$T.explore()` or `$T.scan.clearBadges()`).

---

## 2. Deterministic Smart Scope Resolver

Instead of requiring engineers to craft precise CSS selectors, Testudo resolves plain English words into target container elements:

```javascript
// Scan blotter controls container
$T.scan('blotter-controls');

// Scan using dot notation
$T.scan('form.checkout');

// Scan the whole page
$T.scan();
```

### Deterministic Priority Cascade (Stop-at-Highest-Match Invariant)

When resolving a plain word query like `'blotter-controls'`, Testudo follows a strict, deterministic 8-tier priority cascade and stops immediately at the highest matching priority tier so lower-priority matches never pollute the target scope:

```text
Priority 1: [data-testid="blotter-controls"], [data-test="blotter-controls"], [data-qa="blotter-controls"], [data-cy="blotter-controls"]
Priority 2: [data-demo-id="blotter-controls"]
Priority 3: #blotter-controls (Element ID)
Priority 4: [name="blotter-controls"] (Input name attribute)
Priority 5: [aria-label*="blotter-controls"] (Accessibility label)
Priority 6: Heading text ("Blotter Controls" inside <h1>..<h6> containers)
Priority 7: .blotter-controls (Class name)
Priority 8: <blotter-controls> (Custom tag)
```

---

## 3. Interactive Scanned Elements & Standards-Compliant Snippets (`$T.scan`)

When `$T.scan()` executes, it traverses the resolved scope, filters out hidden elements (`offsetWidth === 0`), and indexes all interactive elements (`button`, `input`, `textarea`, `select`, `a[href]`, `[role="tab"]`, etc.). It maps each element type to its proper action (`.type('example')` for text inputs/textareas, `.select(...)` for `<select>` dropdowns, and `.click()` for buttons/links/tabs) using 100% standards-compliant unique CSS selectors:

```javascript
import { scan } from '@aventine/testudo';

const elements = scan.scan('blotter-controls');
console.table(elements);
```

### Sample Console Output

```text
[TESTUDO SCOPED SCAN] Target Scope: <div data-testid="blotter-controls"> (Priority 1: data-testid matched)
Found 8 Actionable Interactive Elements:

├── [1] <input data-testid="search-input"> (Text Field)
│       Snippet: await $T('[data-testid="search-input"]').type('example');
│
├── [2] <select id="asset-filter"> (Dropdown Selector)
│       Snippet: await $T('#asset-filter').select('structured-credit');
│
├── [3] <input name="settlement-date"> (Date Field)
│       Snippet: await $T('input[name="settlement-date"]').type('example');
│
├── [4] <button role="tab"> (Filter Tab: "All Positions")
│       Snippet: await $T('[data-testid="blotter-controls"] > button:nth-of-type(1)').click();
│
├── [5] <button role="tab"> (Filter Tab: "Discrepancies")
│       Snippet: await $T('[data-testid="blotter-controls"] > button:nth-of-type(2)').click();
│
├── [6] <button id="btn-recalc"> (Recalculate Button)
│       Snippet: await $T('#btn-recalc').click();
│
├── [7] <button data-testid="flag-dispute"> (Action Button)
│       Snippet: await $T('[data-testid="flag-dispute"]').click();
│
└── [8] <button id="btn-export-csv"> (Export Button)
        Snippet: await $T('#btn-export-csv').click();
```

Each returned element object includes:

- `index`: Numbered sequence identifier `[1]`, `[2]`, `[3]`.
- `tag`: Tag name (`button`, `input`, `select`).
- `selector`: Unique, standards-compliant CSS selector (`data-testid` preferred over ID, ID preferred over name, structural `:nth-of-type(k)` fallback when needed).
- `snippet`: Runnable code snippet (`await $T(selector).type(...)`, `.select(...)`, or `.click()`).
- `element`: Direct reference to the live DOM node.

---

## 4. Production Guard Kill Switch

To guarantee that exploration badges never accidentally appear in production customer sessions:

1. Testudo checks `process.env.NODE_ENV === 'production'`.
2. If running in production mode, `$T.explore()` logs a safe warning and aborts immediately.
3. To override in staging or internal debugging builds, set `window.__ENABLE_TESTUDO__ = true`.
