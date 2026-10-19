# Standalone Browser & Synthetic Monitoring

In addition to headless E2E test runners, Testudo is compiled as a self-executing standalone browser bundle (`standalone.js`). This enables Site Reliability Engineers (SREs) and DevOps teams to inject Testudo directly into synthetic transaction monitors (Apica, Datadog Synthetics, Dynatrace, New Relic) and DevTools consoles.

---

## 1. CDN Drop-in for Synthetic Monitors

Synthetic monitoring tools execute scheduled browser scripts against production endpoints to detect downtime and transaction latency.

Inject Testudo directly via CDN:

```html
<!-- Drop into synthetic monitor script or test runner page -->
<script src="https://cdn.jsdelivr.net/npm/@aventine/testudo/dist/adapters/standalone.js"></script>
```

Once loaded, Testudo automatically binds to both `window.testudo` and the global `$T` shorthand.

---

## 2. DevTools Console Exploration

When troubleshooting flaky automated tests or investigating DOM elements in Google Chrome, Microsoft Edge, or Firefox DevTools, engineers can type directly in the console:

```javascript
// Scan all interactive elements on the active page
$T.scan();

// Scan only within the navigation header
$T.scan('header');

// Render numbered interactive badges over buttons and inputs
$T.explore();

// Parse complex localized currency strings on the fly
$T.format.parse('1.249,50- EUR'); // => -1249.50

// Verify floating point calculation
$T.math.eq(0.1 + 0.2, 0.3); // => true
```

---

## 3. Callable `$T('#selector')` Wrapper & Uniqueness Guard

In standalone browser mode, `$T` acts as a callable wrapper with strict uniqueness verification (`requireUnique: true`). If a selector matches more than one element, Testudo throws `[Testudo] Ambiguous selector ...` instead of silently acting on the first match:

```javascript
// Framework-safe input typing
await $T('#credit-card').type('4111222233334444', { mask: 'creditCard' });

// Framework-safe select dropdown
await $T('#asset-filter').select('structured-credit');

// Single native click dispatch (never synthesizes duplicate pointer/mouse clicks)
await $T('#btn-recalc').click();

// In-browser currency tolerance assertion (highlights element and diff HUD on failure)
await $T('#invoice-total').assertCurrency('$1,250.00', { tolerance: 0.01 });

// Highlighting an error element during manual QA
await $T('#promo-code').highlightError({
  message: 'Expired Promo Code',
  expected: 'FALL2026',
  actual: 'SUMMER2026'
});
```

### Supported Wrapper Methods

- `$T(selector).type(text, options)`: Dispatches full synthetic event lifecycle with framework `_valueTracker` bypass.
- `$T(selector).select(value)`: Updates `<select>` value via native prototype setter and dispatches `input` + `change` events.
- `$T(selector).click(options)`: Validates element interactivity and executes **one single native `element.click()`** operation so click handlers never fire twice.
- `$T(selector).assertCurrency(expected, options)`: Parses DOM currency text and compares within tolerance; automatically renders the visual diff HUD on failure.
- `$T(selector).assertText(expected, options)`: Normalizes whitespace and compares text; renders the character-level diff HUD on failure.
- `$T(selector).highlight(options)`: Draws a numbered step highlight box around the element for guided walkthroughs.
- `$T(selector).highlightError(options)`: Renders glowing red outline and floating HUD using XSS-safe `textContent` DOM nodes.
- `$T(selector).scan()`: Scans elements scoped strictly within the selected container.
- `$T(selector).element`: Returns the raw `HTMLElement`.
