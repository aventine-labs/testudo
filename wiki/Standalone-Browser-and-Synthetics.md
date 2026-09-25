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

## 3. Callable `$T('#selector')` Wrapper

In standalone browser mode, `$T` acts as a jQuery-like callable wrapper with modern async automation capabilities:

```javascript
// Framework-safe input typing
await $T('#credit-card').type('4111222233334444', { mask: 'creditCard' });

// Safe click dispatch
await $T('button[type="submit"]').click();

// Highlighting an error element during manual QA
await $T('#promo-code').highlightError({
  message: 'Expired Promo Code',
  expected: 'FALL2026',
  actual: 'SUMMER2026'
});
```

### Supported Wrapper Methods
* `$T(selector).type(text, options)`: Dispatches full synthetic event lifecycle with framework `_valueTracker` bypass.
* `$T(selector).click()`: Dispatches focus, mousedown, mouseup, and click events.
* `$T(selector).highlightError(options)`: Renders glowing red outline and floating HUD.
* `$T(selector).scan()`: Scans elements scoped strictly within the selected container.
* `$T(selector).element`: Returns the raw `HTMLElement`.
