/**
 * @aventine/testudo - Framework-Safe Typing & Input Masking
 * Bypasses React/Vue _valueTracker prototype hooks and dispatches full synthetic event sequences.
 * Zero external dependencies.
 */

export interface TypeOptions {
  delay?: number; // Base delay in milliseconds between keystrokes
  jitter?: number; // Random variance in milliseconds (+/- jitter)
  mask?: 'creditCard' | 'phone' | 'ssn' | 'date' | string;
  clearFirst?: boolean; // Clear existing input before typing
}

export class TestudoType {
  /**
   * Applies an input mask template to a raw string.
   * e.g. "4111222233334444" with "XXXX XXXX XXXX XXXX" => "4111 2222 3333 4444"
   */
  public applyMask(raw: string, maskType: string): string {
    const digitsOnly = raw.replace(/\D/g, '');
    let template = maskType;

    if (maskType === 'creditCard') {
      template = 'XXXX XXXX XXXX XXXX';
    } else if (maskType === 'phone') {
      template = '(XXX) XXX-XXXX';
    } else if (maskType === 'ssn') {
      template = 'XXX-XX-XXXX';
    } else if (maskType === 'date') {
      template = 'YYYY-MM-DD';
    }

    let result = '';
    let digitIdx = 0;

    for (let i = 0; i < template.length && digitIdx < digitsOnly.length; i++) {
      const char = template[i];
      if (char === 'X' || char === 'Y' || char === 'M' || char === 'D' || char === '9') {
        result += digitsOnly[digitIdx++];
      } else {
        result += char;
        if (digitIdx < digitsOnly.length && digitsOnly[digitIdx] === char) {
          digitIdx++;
        }
      }
    }

    return result;
  }

  /**
   * Sets value on an HTMLInputElement bypassing React/Vue internal state trackers (_valueTracker).
   */
  public setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;

    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  /**
   * Dispatches a synthetic event on an element.
   */
  private dispatch(element: HTMLElement, eventType: string, eventInit?: EventInit): void {
    const event = new Event(eventType, { bubbles: true, cancelable: true, ...eventInit });
    element.dispatchEvent(event);
  }

  /**
   * Types text into a target input element safely, dispatching native event sequences.
   */
  public async type(
    elementOrSelector: string | HTMLInputElement | HTMLTextAreaElement,
    text: string,
    options: TypeOptions = {}
  ): Promise<void> {
    let element: HTMLInputElement | HTMLTextAreaElement | null = null;

    if (typeof elementOrSelector === 'string') {
      if (typeof document !== 'undefined') {
        element = document.querySelector(elementOrSelector) as HTMLInputElement;
      }
    } else {
      element = elementOrSelector;
    }

    if (!element) {
      throw new Error(`[Testudo] Target element not found for typing: ${elementOrSelector}`);
    }

    const { delay = 0, jitter = 0, mask, clearFirst = true } = options;

    element.focus();
    this.dispatch(element, 'focus');

    if (clearFirst) {
      this.setNativeValue(element, '');
      this.dispatch(element, 'input');
    }

    const targetText = mask ? this.applyMask(text, mask) : text;

    if (delay === 0 && jitter === 0) {
      // Instant typing mode
      this.setNativeValue(element, targetText);
      this.dispatch(element, 'input');
      this.dispatch(element, 'change');
      element.blur();
      this.dispatch(element, 'blur');
      return;
    }

    // Incremental typing with human cadence simulation
    let currentVal = '';
    for (let i = 0; i < targetText.length; i++) {
      const char = targetText[i];
      currentVal += char;

      this.dispatch(element, 'keydown', { key: char } as any);
      this.dispatch(element, 'keypress', { key: char } as any);

      this.setNativeValue(element, currentVal);
      this.dispatch(element, 'input');

      this.dispatch(element, 'keyup', { key: char } as any);

      if (delay > 0 || jitter > 0) {
        const sleepMs = Math.max(1, delay + (Math.random() * jitter * 2 - jitter));
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
      }
    }

    this.dispatch(element, 'change');
    element.blur();
    this.dispatch(element, 'blur');
  }
}

export const type = new TestudoType();
