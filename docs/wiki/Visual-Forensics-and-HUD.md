# Visual Error Forensics & HUD (`$T.visual`)

When automated tests fail on headless CI, screenshots frequently capture a generic webpage without showing which specific element failed or why.

The Testudo Visual Forensics Engine highlights the failing element in glowing neon red, centers the viewport, and renders a floating character-diff HUD. Crucially, it does this **without mutating the component DOM** (preventing React hydration crashes) and builds all HUD and Calculus Zoom Card elements strictly via `document.createElement(...)` and `.textContent = ...` (**zero `innerHTML`**, preventing DOM-based XSS if untrusted text is asserted).

---

## 1. Two-Mode Non-Destructive Highlighting & XSS-Safe HUD

Injecting `<mark>` tags or modifying `innerHTML` inside reactive frameworks destroys component state and crashes hydration. Testudo uses two non-destructive modes and strict color sanitization (`sanitizeCssColor` allowing only validated 3/6/8-digit hex codes or safe named colors):

### Mode A: Input Mode (Inputs & Textareas)
For `<input>` and `<textarea>` elements:
1. Testudo creates an off-screen mirror `<div>` styled with the exact computed font family, font size, line height, letter spacing, padding, and borders of the target input.
2. The input's text is partitioned into text nodes up to the diff divergence index.
3. Native `Range.getBoundingClientRect()` measures the precise relative pixel offset of the diverging character inside the mirror div.
4. An absolute-positioned ghost overlay (`data-testudo-overlay`) is placed directly over the input at the exact character coordinates with yellow background and dashed red outline.
5. The mirror div is destroyed immediately. The input element itself is never touched.

### Mode B: Read Mode (Paragraphs, Headings, Tables)
For standard text nodes (`<p>`, `<td>`, `<span>`):
1. Testudo creates a native `Range` object spanning the exact diverging character index (`range.setStart` and `range.setEnd`).
2. `range.getBoundingClientRect()` extracts the sub-pixel coordinate box.
3. An overlay div is rendered over the character box, accompanied by a floating HUD (`[data-testudo-hud="true"]`) built with `textContent` nodes.

---

## 2. Dynamic Web Font Swap Race Mitigation

In modern web applications (e.g. Next.js with Google Fonts), web fonts often load asynchronously after initial page render. If a test measures text coordinates while a fallback font is rendered, the highlight will misalign by 1 to 3 pixels once the custom font swaps in.

Testudo mitigates this race condition through two layers:
1. `await document.fonts.ready` before initial measurement.
2. An event listener on `document.fonts.addEventListener('loadingdone', ..., { once: true })` that automatically re-calculates the ghost overlay if a late web font finishes loading.

---

## 3. SPA Navigation & Orphan Overlay Cleanup

In Single Page Applications (Next.js, Remix, Vite), navigating to another route via `router.push()` does not trigger a full page reload. Left unmanaged, visual overlays from a previous assertion would remain orphaned on screen.

Testudo prevents orphaned overlays:
1. `cleanup()` automatically strips all existing overlays before creating a new one.
2. A `MutationObserver` on `document.body` monitors the target element:
```javascript
const observer = new MutationObserver(() => {
  if (!document.body.contains(element)) {
    this.cleanup();
  }
});
observer.observe(document.body, { childList: true, subtree: true });
```
If the host element is removed from the DOM during a client-side route transition, all Testudo overlays are purged instantly.

---

## 4. Glowing Neon Red Outline, Step Highlights & Auto-Centering

```javascript
import { visual } from '@aventine/testudo';

// Highlight an assertion error with character-level diff HUD
await visual.highlightError('#submit-button', {
  message: 'Payment Button Not Interactive',
  expected: 'Pay Now ($1,250.00)',
  actual: 'Processing...',
  color: '#EF4444',
  autoScroll: true
});

// Highlight a numbered workflow step box for guided demos
await visual.highlightStep('#btn-recalc', {
  step: 1,
  label: 'Recalculate Blotter',
  color: '#38BDF8'
});
```

When called:
* The browser viewport smoothly centers on the offending element using `scrollIntoView({ block: 'center', inline: 'center' })`.
* A high-contrast glowing neon outline (`3px solid #EF4444` with box-shadow glow) highlights the element.
* A floating HUD badge appears above the element detailing the exact failure and character difference.

---

## 5. Multi-Cell Financial Calculus Forensics (`$T.calc`)

In institutional trading, accounting ledgers, and prime brokerage blotters, final balances depend on multiple contributing cells. When validating an equation across multiple table cells ($A + B - C - D \ne \text{Total}$), turning every cell red creates cognitive confusion and alert fatigue.

Testudo highlights each operand with distinct, non-colliding colors so the mathematical audit trail is clear at a glance:

![Testudo Multi-Cell Calculus Forensics](https://raw.githubusercontent.com/aventine-labs/testudo/main/assets/screenshots/testudo_fintech_full_settlement_screengrab.png)

### Operand Color Mapping
* **Operand [A] Principal**: Electric Cyan (`#38BDF8`).
* **Operand [B] Accrued Interest (+)**: Vibrant Amber (`#F59E0B`).
* **Operand [C] Clearing Fee (-)**: Neon Purple (`#C084FC`).
* **Operand [D] Withholding Tax (-)**: Emerald Green (`#34D399`).
* **Target Live Balance**: Pulsing Crimson (`#F43F5E`) with micro-magnified character-by-character diff callout:

![Testudo Zoomed Character Diff Callout](https://raw.githubusercontent.com/aventine-labs/testudo/main/assets/screenshots/testudo_zoomed_diff_callout.png)

---

## 6. Automated High-DPI Screengrab Cropping in Test Reports

When automated tests fail in CI, engineers do not want to download a giant 1920x1080 screenshot and squint to find where the failure occurred.

Testudo automatically computes the **bounding box union** of all participating operand cells plus the floating diff card, and clips the screenshot directly to the region of interest:

![Testudo Tight Calculus Crop](https://raw.githubusercontent.com/aventine-labs/testudo/main/assets/screenshots/testudo_calculus_tight_crop.png)

### How Native JavaScript Cropping Works

You do not need heavy native image processing libraries. Modern JavaScript and Playwright handle this natively:

```typescript
// Testudo computes the bounding box union of all equation operands:
const rects = await Promise.all([
  page.locator('#cell-principal').boundingBox(),
  page.locator('#cell-interest').boundingBox(),
  page.locator('#cell-fee').boundingBox(),
  page.locator('#cell-tax').boundingBox(),
  page.locator('#cell-live-balance').boundingBox(),
  page.locator('.testudo-diff-zoom').boundingBox()
]);

const unionClip = computeBoundingUnion(rects, { padding: 16 });

// Capture ONLY the participating cells and HUD:
await page.screenshot({
  path: 'test-results/calculus-divergence-crop.png',
  clip: unionClip
});
```

---

## 7. Live Interactive Demo

The repository contains standalone, zero-dependency interactive demonstrations:

* **Settlement Blotter**: [`packages/testudo-js/demo/fintech_settlement.html`](https://github.com/aventine-labs/testudo/blob/main/packages/testudo-js/demo/fintech_settlement.html)
* **DOM Explorer**: [`packages/testudo-js/demo/dom_explorer.html`](https://github.com/aventine-labs/testudo/blob/main/packages/testudo-js/demo/dom_explorer.html)
