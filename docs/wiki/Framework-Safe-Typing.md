# Framework-Safe Typing Engine (`$T.type`)

Modern front-end frameworks (React, Vue, Angular, Svelte) hook native input property setters to maintain reactive state. Setting `input.value = "foo"` directly in synthetic test scripts fails because the framework's internal tracker is bypassed, causing forms to submit empty or stale values.

The Testudo Typing Engine bypasses framework property trackers, formats input with dynamic masks, and dispatches the complete synthetic event lifecycle.

---

## 1. Why Standard `input.value = ...` Fails in React

When React renders an `<input>`, it attaches an internal value tracker:

```javascript
// React internal mechanism (simplified)
input._valueTracker = {
  getValue() {
    return lastValue;
  },
  setValue(val) {
    lastValue = val;
  }
};
```

If a test runner or synthetic script sets `element.value = "new value"`, React's synthetic event system compares the current DOM value with `_valueTracker.getValue()`. If they appear identical or the native setter was skipped, React treats the change as a no-op and does not trigger `onChange` or update component state.

### How Testudo Solves This

Testudo retrieves the native descriptor setter directly from the HTML prototype chain:

```javascript
const nativeSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  'value'
)?.set;

nativeSetter?.call(element, formattedValue);
```

By calling the native prototype setter directly on the DOM element and updating `_valueTracker` if present, Testudo forces React and Vue to acknowledge the mutation.

---

## 2. Complete Synthetic Event Lifecycle

Modern input masks and form validators listen to different events across the typing lifecycle. Testudo dispatches the authentic sequence for every typed character:

```text
[1] focus    -> Target element gains focus
[2] keydown  -> Key code and char code emitted
[3] keypress -> Character key event
[4] input    -> Native input event (bubbles: true, composed: true)
[5] keyup    -> Key released
[6] change   -> Change committed
[7] blur     -> Target element loses focus
```

---

## 3. Human Typing Cadence & Jitter

Synthetic bots that input 50 characters in 0 milliseconds often trigger anti-bot heuristics or miss asynchronous debounce handlers. Testudo provides humanized typing simulation:

```javascript
import { type } from '@aventine/testudo';

await type.type('#search-input', 'Aventine Labs', {
  delay: 35, // Base delay of 35ms per keystroke
  jitter: 10 // Random Gaussian jitter ±10ms per keystroke
});
```

---

## 4. Built-In Input Masks

Testudo formats raw input strings into structured masks on the fly:

```javascript
import { type } from '@aventine/testudo';

// 1. Phone mask: "(XXX) XXX-XXXX"
await type.type('#phone', '5551234567', { mask: 'phone' });
// Result in field: "(555) 123-4567"

// 2. Credit Card mask: "XXXX XXXX XXXX XXXX"
await type.type('#card-number', '4111222233334444', { mask: 'creditCard' });
// Result in field: "4111 2222 3333 4444"

// 3. Social Security Number mask: "XXX-XX-XXXX"
await type.type('#ssn', '123456789', { mask: 'ssn' });
// Result in field: "123-45-6789"

// 4. Date mask: "MM/DD/YYYY"
await type.type('#dob', '09252026', { mask: 'date' });
// Result in field: "09/25/2026"

// 5. Custom user mask
await type.type('#sku', 'AB1234XY', { mask: 'AA-####-AA' });
```

### Signature

```typescript
interface TypeOptions {
  mask?: 'creditCard' | 'phone' | 'ssn' | 'date' | string;
  delay?: number;
  jitter?: number;
  clear?: boolean;
}

function type(
  elementOrSelector: string | HTMLElement,
  text: string,
  options?: TypeOptions
): Promise<void>;
```
