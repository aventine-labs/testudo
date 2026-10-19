/**
 * @aventine/testudo - Framework-Safe Typing & Input Masking
 * Bypasses React/Vue _valueTracker prototype hooks and dispatches full synthetic event sequences.
 * Zero external dependencies.
 */

import { resolveElement } from './scan.js';

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
      if (char === 'X' || char === 'Y' || char === 'M' || char === 'D' || char === '9' || char === '#') {
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
   * Sets value on an HTMLInputElement / HTMLTextAreaElement / HTMLSelectElement bypassing React/Vue internal state trackers (_valueTracker).
   */
  public setNativeValue(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    value: string
  ): void {
    const prototype =
      typeof HTMLTextAreaElement !== 'undefined' && element instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : typeof HTMLSelectElement !== 'undefined' && element instanceof HTMLSelectElement
        ? window.HTMLSelectElement.prototype
        : typeof window !== 'undefined' && window.HTMLInputElement
        ? window.HTMLInputElement.prototype
        : Object.getPrototypeOf(element);

    const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value') : undefined;
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      (element as any).value = value;
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
   * Executes a single native click operation on an unambiguous target element.
   * Never dispatches redundant pointer/mouse events alongside element.click() to prevent double-click bugs.
   */
  public async click(elementOrSelector: string | HTMLElement): Promise<void> {
    const element =
      typeof elementOrSelector === 'string'
        ? resolveElement(elementOrSelector, undefined, { requireUnique: true })
        : elementOrSelector;

    if (!element) {
      throw new Error(`[Testudo] Target element not found for click: ${elementOrSelector}`);
    }

    if ((element as HTMLButtonElement).disabled) {
      throw new Error(`[Testudo] Target element is disabled and cannot be clicked: ${elementOrSelector}`);
    }

    if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ behavior: 'instant' as any, block: 'center', inline: 'center' });
    }

    if (typeof element.click === 'function') {
      element.click();
    } else {
      this.dispatch(element, 'click');
    }
  }

  /**
   * Selects a value on an unambiguous HTMLSelectElement and dispatches React/Vue-compatible input + change events.
   */
  public async select(
    elementOrSelector: string | HTMLSelectElement | HTMLElement,
    value: string
  ): Promise<void> {
    const element = (
      typeof elementOrSelector === 'string'
        ? resolveElement(elementOrSelector, undefined, { requireUnique: true })
        : elementOrSelector
    ) as HTMLSelectElement | null;

    if (!element) {
      throw new Error(`[Testudo] Target select element not found: ${elementOrSelector}`);
    }

    if (typeof element.focus === 'function') {
      element.focus();
    }
    this.dispatch(element, 'focus');
    this.setNativeValue(element, value);
    this.dispatch(element, 'input');
    this.dispatch(element, 'change');
    if (typeof element.blur === 'function') {
      element.blur();
    }
    this.dispatch(element, 'blur');
  }

  /**
   * Types text into an unambiguous target input element safely, dispatching native event sequences.
   */
  public async type(
    elementOrSelector: string | HTMLInputElement | HTMLTextAreaElement,
    text: string,
    options: TypeOptions = {}
  ): Promise<void> {
    let element: HTMLInputElement | HTMLTextAreaElement | null = null;

    if (typeof elementOrSelector === 'string') {
      element = resolveElement(elementOrSelector, undefined, {
        requireUnique: true
      }) as HTMLInputElement | HTMLTextAreaElement | null;
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

const defaultInstance = new TestudoType();

export const type = Object.assign(
  (
    elementOrSelector: string | HTMLInputElement | HTMLTextAreaElement,
    text: string,
    options?: TypeOptions
  ) => defaultInstance.type(elementOrSelector, text, options),
  {
    type: (
      elementOrSelector: string | HTMLInputElement | HTMLTextAreaElement,
      text: string,
      options?: TypeOptions
    ) => defaultInstance.type(elementOrSelector, text, options),
    click: (elementOrSelector: string | HTMLElement) => defaultInstance.click(elementOrSelector),
    select: (elementOrSelector: string | HTMLSelectElement | HTMLElement, value: string) =>
      defaultInstance.select(elementOrSelector, value),
    applyMask: (raw: string, maskType: string) => defaultInstance.applyMask(raw, maskType),
    mask: (raw: string, maskType: string) => defaultInstance.applyMask(raw, maskType),
    setNativeValue: (
      element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
      value: string
    ) => defaultInstance.setNativeValue(element, value)
  }
);

