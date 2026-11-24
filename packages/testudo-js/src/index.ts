/**
 * @aventine/testudo v1.1.0
 * The Zero-Dependency Master of Polyglot Unit, Real-DOM Component & E2E Test Suites:
 * High-Precision Financial Math, Split-World Security Enclave, 5-Lane Causal Waterfall,
 * Bi-Directional Contract Cassettes, Diff Mutation, and 9-Language Polyglot Orchestration.
 *
 * (c) 2026 Aventine Labs LLC. Apache-2.0 License. Strict Rule 6: Zero em-dashes and zero en-dashes.
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
export * from './workflow.js';
export * from './launcher.js';
export * from './digest.js';
export * from './wasm-concierge.js';
export * from './telemetry.js';
export * from './kinetic.js';
export * from './probe.js';
export * from './quiescence.js';
export * from './waterfall.js';
export * from './intercept.js';
export * from './audit.js';
export * from './timetravel.js';
export * from './stress.js';
export * from './runner.js';
export * from './ast-advisor.js';
export * from './xray.js';
export * from './unit.js';
export * from './cassette-contract.js';
export * from './mutation-dag.js';
export * from './ui/shadow-widget.js';
export * from './adapters/playwright.js';
export * from './adapters/standalone.js';

import { createTestudoInstance } from './adapters/standalone.js';

export const testudo = createTestudoInstance();
export const $T = testudo;
export default testudo;
