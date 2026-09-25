# Visual Error Forensics & HUD (`$T.visual`)

When automated tests fail on headless CI, screenshots frequently capture a generic webpage without showing which specific element failed or why.

The Testudo Visual Forensics Engine highlights the failing element in glowing neon red, centers the viewport, and renders a floating character-diff HUD. Crucially, it does this **without mutating the component DOM**, preventing React hydration crashes.

---

## 1. Two-Mode Non-Destructive Highlighting

Injecting `<mark>` tags or modifying `innerHTML` inside reactive frameworks destroys component state and crashes hydration. Testudo uses two non-destructive modes:

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
3. An overlay div is rendered over the character box.

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

## 4. Glowing Neon Red Outline & Auto-Centering

```javascript
import { visual } from '@aventine/testudo';

await visual.highlightError('#submit-button', {
  message: 'Payment Button Not Interactive',
  expected: 'Pay Now ($1,250.00)',
  actual: 'Processing...',
  color: '#EF4444',
  autoScroll: true
});
```

When called:

- The browser viewport smoothly centers on the offending element using `scrollIntoView({ block: 'center', inline: 'center' })`.
- A high-contrast glowing neon outline (`3px solid #EF4444` with box-shadow glow) highlights the element.
- A floating HUD badge appears above the element detailing the exact failure and character difference.

---

## 5. API Reference

### Signature

```typescript
interface VisualErrorOptions {
  message?: string;
  expected?: string;
  actual?: string;
  color?: string;
  autoScroll?: boolean;
}

class TestudoVisual {
  highlightError(
    elementOrSelector: string | HTMLElement,
    options?: VisualErrorOptions
  ): Promise<{ diff: CharDiffResult | null }>;

  cleanup(): void;
}
```
