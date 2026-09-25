# DOM Explorer & Smart Scoping (`$T.scan` & `$T.explore`)

Junior QA testers and software engineers frequently spend hours trying to figure out which elements on a page are interactive, inspecting deep component trees, and building brittle CSS selectors that break on the next release.

Testudo provides an interactive in-browser DOM exploration and scoping system designed to generate resilient, copy-paste Playwright snippets in seconds.

---

## 1. Deterministic Smart Scope Resolver

Instead of requiring engineers to craft precise CSS selectors, Testudo resolves plain English words into target container elements:

```javascript
// Scan a contact form
$T.scan('contact');

// Scan using dot notation
$T.scan('form.checkout');

// Scan the whole page
$T.scan();
```

### Deterministic Priority Cascade
When resolving a plain word query like `'contact'`, Testudo follows a strict, deterministic priority cascade to eliminate selector ambiguity:

```text
Priority 1: [data-testid="contact"]
Priority 2: [data-test="contact"]
Priority 3: #contact (Element ID)
Priority 4: [name="contact"] (Input name attribute)
Priority 5: [aria-label*="contact"] (Accessibility label)
Priority 6: Heading text ("Contact Us" inside <h1>..<h6> containers)
Priority 7: .contact (Class name)
Priority 8: <contact> (Custom tag)
```

The resolver returns a deduplicated array of `HTMLElement[]`, with the highest-priority container taking precedence.

---

## 2. Interactive Scanned Elements & Snippets (`$T.scan`)

When `$T.scan()` executes, it traverses the resolved scope, filters out hidden elements (`offsetWidth === 0`), and indexes all interactive elements (buttons, inputs, links, selects, tabs).

```javascript
import { scan } from '@aventine/testudo';

const elements = scan.scan('contact');
console.table(elements);
```

### Sample Console Output
```text
[TESTUDO SCOPED SCAN] Target Scope: <form id="contact-form">
Found 3 Interactive Elements inside Scope:

├── [1] <input name="fullName"> (Text Field)
│       Snippet: await $T('#contact-form input[name="fullName"]').type('example');
│
├── [2] <input name="email"> (Email Field)
│       Snippet: await $T('#contact-form input[name="email"]').type('example');
│
└── [3] <button type="submit"> (Button)
        Snippet: await $T('#contact-form button[type="submit"]').click();
```

Each returned element object includes:
* `index`: Numbered sequence identifier `[1]`, `[2]`, `[3]`.
* `tag`: Tag name (`button`, `input`, `select`).
* `selector`: Most resilient CSS selector available (`data-testid` preferred over ID, ID preferred over class).
* `snippet`: Runnable Playwright code snippet.
* `element`: Direct reference to the live DOM node.

---

## 3. Visual Explorer Badges (`$T.explore`)

In addition to console output, `$T.explore()` renders visual numbered blue badges (`[1]`, `[2]`, `[3]`) directly over every interactive element in the live browser:

```javascript
// In DevTools console or synthetic script
$T.explore('contact');
```

* **Hovering**: Displays element details and the recommended selector snippet.
* **Clicking a Badge**: Automatically copies the runnable Playwright code snippet (`await $T(...).click();`) directly to your clipboard, turning green with a `"✓ Copied!"` indicator.
* **Calling Again**: Toggles badges off to clean up the page (`$T.explore()` or `$T.scan.clearBadges()`).

---

## 4. Production Guard Kill Switch

To guarantee that exploration badges never accidentally appear in production customer sessions:

1. Testudo checks `process.env.NODE_ENV === 'production'`.
2. If running in production mode, `$T.explore()` logs a safe warning and aborts immediately.
3. To override in staging or internal debugging builds, set `window.__ENABLE_TESTUDO__ = true`.
