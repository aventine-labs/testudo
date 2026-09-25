/**
 * @aventine/testudo
 * The Zero-Dependency Master of Test Suites
 * High-Precision Financial Math, Framework-Safe Typing, and In-Browser QA Forensics
 *
 * (c) 2026 Aventine Labs LLC. Apache-2.0 License.
 */

export * from './math.js';
export * from './format.js';
export * from './type.js';
export * from './diff.js';
export * from './visual.js';
export * from './scan.js';
export * from './matchers.js';
export * from './report.js';
export * from './calc.js';
export * from './adapters/playwright.js';
export * from './adapters/standalone.js';

import { createTestudoInstance } from './adapters/standalone.js';

export const testudo = createTestudoInstance();
export const $T = testudo;
export default testudo;
