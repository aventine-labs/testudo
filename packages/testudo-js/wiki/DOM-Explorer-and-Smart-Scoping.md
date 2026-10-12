# DOM Explorer & Smart Scoping (`$T.scan` & `$T.explore`)

Junior QA testers and software engineers frequently spend hours trying to figure out which elements on a page are interactive, inspecting deep component trees, and building brittle CSS selectors that break on the next release.

Testudo provides an interactive in-browser DOM exploration and scoping system designed to generate resilient, copy-paste Playwright snippets in seconds:

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

### Deterministic Priority Cascade

When resolving a plain word query like `'blotter-controls'`, Testudo follows a strict, deterministic priority cascade to eliminate selector ambiguity:

```text
Priority 1: [data-testid="blotter-controls"]
Priority 2: [data-test="blotter-controls"]
Priority 3: #blotter-controls (Element ID)
Priority 4: [name="blotter-controls"] (Input name attribute)
Priority 5: [aria-label*="blotter-controls"] (Accessibility label)
Priority 6: Heading text ("Blotter Controls" inside <h1>..<h6> containers)
Priority 7: .blotter-controls (Class name)
Priority 8: <blotter-controls> (Custom tag)
```

The resolver returns a deduplicated array of `HTMLElement[]`, with the highest-priority container taking precedence.

---

## 3. Interactive Scanned Elements & Snippets (`$T.scan`)

When `$T.scan()` executes, it traverses the resolved scope, filters out hidden elements (`offsetWidth === 0`), and indexes all interactive elements (buttons, inputs, links, selects, tabs).

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
│       Snippet: await $T('[data-testid="search-input"]').type('TRD-90414');
│
├── [2] <select id="asset-filter"> (Dropdown Selector)
│       Snippet: await $T('#asset-filter').selectOption('structured-credit');
│
├── [3] <input name="settlement-date"> (Date Field)
│       Snippet: await $T('input[name="settlement-date"]').type('2026-09-25');
│
├── [4] <button role="tab"> (Filter Tab: "All Positions")
│       Snippet: await $T('button:has-text("All Positions")').click();
│
├── [5] <button role="tab"> (Filter Tab: "Discrepancies")
│       Snippet: await $T('button:has-text("Discrepancies")').click();
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
- `selector`: Most resilient CSS selector available (`data-testid` preferred over ID, ID preferred over class).
- `snippet`: Runnable Playwright code snippet.
- `element`: Direct reference to the live DOM node.

---

## 4. Production Guard Kill Switch

To guarantee that exploration badges never accidentally appear in production customer sessions:

1. Testudo checks `process.env.NODE_ENV === 'production'` and `window.TESTUDO_ENV === 'production'`.
2. Explicit global kill switch `window.TESTUDO_DISABLE_EXPLORER = true` immediately disables badge injection.
3. If running in production mode, `$T.explore()` logs a safe warning and aborts immediately.
4. To override in staging or internal debugging builds, set `window.__ENABLE_TESTUDO__ = true` or `window.TESTUDO_ENV = 'staging'`.

