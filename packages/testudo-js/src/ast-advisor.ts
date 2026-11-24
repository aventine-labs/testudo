/**
 * @aventine/testudo - Zero-Lock-In AST Source Scanner & Edge-Case / Stress Test Advisor
 * (src/ast-advisor.ts)
 * Inspects TypeScript/JSX/Vue/HTML component source code with zero external parser dependencies
 * to detect missing edge-case coverage and emit standard TypeScript (@aventine/testudo) specs.
 * Zero external dependencies. Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

export interface AstRiskSuggestion {
  ruleId:
    | 'AST_UNDEBOUNCED_MUTATION_CLICK'
    | 'AST_UNVIRTUALIZED_COLLECTION_MAP'
    | 'AST_UNABORTED_ASYNC_FETCH'
    | 'AST_MONETARY_PRECISION_ASSERT';
  severity: 'medium' | 'high';
  rationale: string;
  generatedTypeScriptSpec: string;
}

export interface AstAdvisorReport {
  componentName: string;
  riskCount: number;
  suggestions: AstRiskSuggestion[];
  combinedTestFileSource: string;
}

export function analyzeComponentSourceForEdgeCases(
  sourceCode: string,
  componentName = 'TargetComponent'
): AstAdvisorReport {
  const src = String(sourceCode || '');
  const suggestions: AstRiskSuggestion[] = [];

  if (/onClick\s*=|addEventListener\(\s*['"]click['"]/.test(src) && !/disabled|isSubmitting|debounce/i.test(src)) {
    suggestions.push({
      ruleId: 'AST_UNDEBOUNCED_MUTATION_CLICK',
      severity: 'high',
      rationale: 'Click handler detected without disabled/submitting guard; vulnerable to rapid double-submit charges.',
      generatedTypeScriptSpec: `it('${componentName}: proves concurrent double-click idempotency', async () => {\n  const rep = await proveIdempotencyAndOutOfOrderSafety({\n    concurrentClicks: 5,\n    triggerSubmitClick: () => $T('[data-testid="submit-btn"]').click(),\n    getOutboundMutationCount: () => state.mutationCount\n  });\n  expectValue(rep.passed).toBe(true);\n});`
    });
  }

  if (/\.map\s*\(/.test(src) && !/virtual|windowSize|slice\s*\(\s*0/i.test(src)) {
    suggestions.push({
      ruleId: 'AST_UNVIRTUALIZED_COLLECTION_MAP',
      severity: 'medium',
      rationale: 'Unbounded .map() collection render detected without virtualization; vulnerable to 60fps cliff on large carousels/lists.',
      generatedTypeScriptSpec: `it('${componentName}: verifies 60fps resilience under opt-in cardinality stress', async () => {\n  const stressRep = await runDomCardinalityStress({ stress: true, baseItemCount: 5, multipliers: [1, 10, 50], measureAtItemCount });\n  expectValue(stressRep.status).toBe('PASSED_60FPS_RESILIENT');\n});`
    });
  }

  if (/\bfetch\s*\(/.test(src) && !/AbortController|signal/i.test(src)) {
    suggestions.push({
      ruleId: 'AST_UNABORTED_ASYNC_FETCH',
      severity: 'high',
      rationale: 'fetch() call lacks AbortController signal; vulnerable to out-of-order stale response overwrites.',
      generatedTypeScriptSpec: `it('${componentName}: prevents stale out-of-order fetch from overwriting newer UI state', async () => {\n  const rep = await proveIdempotencyAndOutOfOrderSafety({ triggerSubmitClick, getOutboundMutationCount, triggerVersionedSearch, readRenderedSearchValue });\n  expectValue(rep.staleStateOverwrittenUi).toBe(false);\n});`
    });
  }

  if (/\$|USD|currency|toFixed\(\s*2\s*\)|bps/i.test(src)) {
    suggestions.push({
      ruleId: 'AST_MONETARY_PRECISION_ASSERT',
      severity: 'medium',
      rationale: 'Monetary or basis-point formatting detected; verify exact IEEE-754-safe currency parity.',
      generatedTypeScriptSpec: `it('${componentName}: asserts exact currency precision without float drift', async () => {\n  await $T('[data-testid="total-amount"]').assertCurrency('$1,250.00', { mode: 'stable', stableMs: 200 });\n});`
    });
  }

  const combinedTestFileSource = [
    `import { $T, expectValue, proveIdempotencyAndOutOfOrderSafety, runDomCardinalityStress } from '@aventine/testudo/crucible';`,
    ``,
    `// Auto-synthesized standard TypeScript edge-case suite for ${componentName}`,
    ...suggestions.map((s) => s.generatedTypeScriptSpec)
  ].join('\n\n');

  return {
    componentName,
    riskCount: suggestions.length,
    suggestions,
    combinedTestFileSource
  };
}
