# Architecture & Engineering Philosophy

Testudo is engineered around five strict architectural pillars designed to make it the most reliable utility in any test engineer's toolchain.

---

## 1. Zero Runtime Dependencies (`dependencies: {}`)

Modern npm packages frequently suffer from dependency bloat, transitive vulnerabilities, and supply chain drift. 

Testudo maintains an absolute requirement: **zero runtime dependencies**.
* The core package footprint is strictly under 5KB minified gzipped.
* Every mathematical calculation, string normalization, event dispatch, and DOM traversal is implemented using pure, native ECMAScript and browser DOM APIs.
* Automated CI verification enforces `package.json` dependency count on every pull request:
```bash
node -e "const p=require('./package.json'); if(Object.keys(p.dependencies||{}).length) process.exit(1);"
```

---

## 2. In-Page Utility Belt, Not Another Test Runner

Testudo does not attempt to replace Playwright, Puppeteer, Cypress, or Selenium. The world does not need another slow, opinionated test runner.

Instead, Testudo operates as an in-page utility shield (`$T`):
* It lives directly inside the evaluated browser page context or extends the test runner's native assertion engine (`expect.extend`).
* It bridges the gap between what test runners expect and how modern browsers actually behave.

---

## 3. Non-Destructive DOM Forensics

When an assertion fails, typical tools attempt to highlight errors by injecting `<mark>` tags or wrapping text inside DOM elements. In modern reactive frameworks (React, Vue, Svelte), mutating the DOM directly causes:
* React hydration mismatches and unhandled errors.
* Immediate component re-renders that blow away the injected markup.
* Form validation failures because `<input>` values cannot contain HTML children.

Testudo implements a **Two-Mode Non-Destructive Architecture**:
* **Input Mode**: Uses an off-screen mirror `<div>` to compute character coordinates and renders an absolute-positioned ghost overlay over `<input>` elements with zero DOM mutation inside the component.
* **Read Mode**: Uses native `Range.getBoundingClientRect()` on existing text nodes for sub-pixel character accuracy across variable web fonts.
* **SPA Navigation Cleanup**: A `MutationObserver` on `document.body` monitors the host element and automatically destroys orphaned overlays when the user navigates away via `next/router.push()`.

---

## 4. Zero Telemetry & Air-Gapped Safety

In enterprise banking, defense, and healthcare environments, test scripts frequently handle sensitive mock data, test credit cards, PII, and internal staging URLs.

Testudo enforces:
* **Zero outbound network telemetry**: No phone-home pings, analytics trackers, or remote telemetry.
* **Local-first execution**: All diff calculations, visual overlays, and assertions run 100% locally in browser memory.
* **Production Guard Kill Switch**: In-page explorer badges (`$T.explore()`) automatically disable when `process.env.NODE_ENV === 'production'` unless `window.__ENABLE_TESTUDO__` is explicitly set.

---

## 5. Subpath Exports & Modular Tree-Shaking

Testudo uses standard Node.js subpath exports in `package.json`, allowing developers to import only the specific capabilities they need without pulling in the entire library:

```typescript
// Import only financial math
import { math } from '@aventine/testudo/math';

// Import only Playwright matchers
import { testudoMatchers } from '@aventine/testudo/matchers';

// Import only currency formatters
import { format } from '@aventine/testudo/format';
```
