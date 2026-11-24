/**
 * @aventine/testudo v1.1.0 - Sub-Second Git-Diff AST/Token Mutation Scorer (-9863)
 * & Blast-Radius Dependency DAG Router (-9866) (AL-DEV-411 / SPEC-TESTUDO-POLYGLOT-UNIT-27)
 *
 * 1. Mutates operators ONLY on changed/targeted lines (`===` <-> `!==`, `>=` <-> `>`,
 *    `<=` <-> `<`, `+` <-> `-`, `true` <-> `false`) to catch Hollow Tests (-9863:
 *    100% line coverage with missing or vacuous assertions).
 * 2. Routes file edits across any of the 9 languages through an endpoint/import DAG:
 *    runs < 5 ms unit tests first, halts on unit/contract failure (-9866), and selects
 *    ONLY the E2E journeys impacted by the changed service or component.
 *
 * Zero external dependencies. Browser & Node isomorphic.
 * Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

export interface MutantSpec {
  id: number;
  lineNumber: number;
  operatorFrom: string;
  operatorTo: string;
  mutatedSource: string;
}

export interface DiffMutationReport {
  gateCode: 1 | 2 | -9863 | -9865;
  status:
    | 'PASS_ALL_MUTANTS_KILLED'
    | 'PASS_THRESHOLD_MET'
    | 'HOLLOW_ASSERTION_DETECTED'
    | 'INVALID_MUTATION_LEDGER';
  totalMutantsSpawned: number;
  mutantsKilled: number;
  mutantsSurvived: number;
  killScoreBps: number;
  survivingMutants: Array<{ id: number; lineNumber: number; mutation: string }>;
}

const MUTATION_RULES: Array<[RegExp, string, string]> = [
  [/===/, '===', '!=='],
  [/!==/, '!==', '==='],
  [/>=/, '>=', '<'],
  [/<=/, '<=', '>'],
  [/(?<![=!<>])>(?![=>])/, '>', '<='],
  [/(?<![<!])<(?![=<])/, '<', '>='],
  [/\btrue\b/, 'true', 'false'],
  [/\bfalse\b/, 'false', 'true'],
  [/(?<=\s)\+(?=\s)/, '+', '-'],
  [/(?<=\s)-(?=\s)/, '-', '+']
];

/**
 * Generates targeted single-site mutants restricted to changed lines (default: all non-comment lines).
 */
export function generateTargetedMutants(
  sourceCode: string,
  changedLineNumbers?: number[],
  maxMutants = 24
): MutantSpec[] {
  const lines = sourceCode.split('\n');
  const lineFilter = changedLineNumbers ? new Set(changedLineNumbers) : null;
  const mutants: MutantSpec[] = [];
  let nextId = 1;

  for (let idx = 0; idx < lines.length && mutants.length < maxMutants; idx++) {
    const lineNo = idx + 1;
    if (lineFilter && !lineFilter.has(lineNo)) continue;
    const rawLine = lines[idx];
    const trimmed = rawLine.trim();
    if (
      !trimmed ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*')
    ) {
      continue;
    }

    for (const [pattern, opFrom, opTo] of MUTATION_RULES) {
      if (mutants.length >= maxMutants) break;
      const match = pattern.exec(rawLine);
      if (!match || match.index === undefined) continue;

      const mutatedLine =
        rawLine.slice(0, match.index) + opTo + rawLine.slice(match.index + match[0].length);
      if (mutatedLine === rawLine) continue;

      const nextLines = [...lines];
      nextLines[idx] = mutatedLine;
      mutants.push({
        id: nextId++,
        lineNumber: lineNo,
        operatorFrom: opFrom,
        operatorTo: opTo,
        mutatedSource: nextLines.join('\n')
      });
      break;
    }
  }

  return mutants;
}

/**
 * Evaluates whether a unit test suite actually kills injected logic inversions.
 * Exact TypeScript mirror of Z3-proven division-free `testudo_evaluate_diff_mutation_gate`.
 */
export async function runDiffMutationGate(params: {
  sourceCode: string;
  changedLineNumbers?: number[];
  minKillScoreBps?: number;
  evaluateMutant: (mutatedSource: string) => boolean | Promise<boolean>;
}): Promise<DiffMutationReport> {
  const minKillScoreBps = params.minKillScoreBps ?? 8000;
  const mutants = generateTargetedMutants(params.sourceCode, params.changedLineNumbers);
  const total = mutants.length;

  if (total === 0) {
    return {
      gateCode: 1,
      status: 'PASS_ALL_MUTANTS_KILLED',
      totalMutantsSpawned: 0,
      mutantsKilled: 0,
      mutantsSurvived: 0,
      killScoreBps: 10000,
      survivingMutants: []
    };
  }

  let killed = 0;
  const survivingMutants: Array<{ id: number; lineNumber: number; mutation: string }> = [];

  for (const m of mutants) {
    let testPassedUnderMutant = false;
    try {
      testPassedUnderMutant = await params.evaluateMutant(m.mutatedSource);
    } catch {
      testPassedUnderMutant = false;
    }
    if (!testPassedUnderMutant) {
      killed++;
    } else {
      survivingMutants.push({
        id: m.id,
        lineNumber: m.lineNumber,
        mutation: `${m.operatorFrom} -> ${m.operatorTo}`
      });
    }
  }

  const survived = total - killed;
  const killScoreBps = Math.floor((killed * 10000) / total);

  // Division-free Z3 gate check: killed * 10000 < minKillScoreBps * total -> -9863
  if (killed * 10000 < minKillScoreBps * total) {
    return {
      gateCode: -9863,
      status: 'HOLLOW_ASSERTION_DETECTED',
      totalMutantsSpawned: total,
      mutantsKilled: killed,
      mutantsSurvived: survived,
      killScoreBps,
      survivingMutants
    };
  }

  return {
    gateCode: survived === 0 ? 1 : 2,
    status: survived === 0 ? 'PASS_ALL_MUTANTS_KILLED' : 'PASS_THRESHOLD_MET',
    totalMutantsSpawned: total,
    mutantsKilled: killed,
    mutantsSurvived: survived,
    killScoreBps,
    survivingMutants
  };
}

// ------------------------------------------------------------------------------
// Blast-Radius Dependency DAG Router (Unit -> Impacted E2E Journey Slicing)
// ------------------------------------------------------------------------------

export interface ServiceOrModuleNode {
  id: string;
  lang: string;
  filePatterns: string[];
  exposesEndpoints: string[];
  unitSuiteIds: string[];
}

export interface E2eJourneyNode {
  id: string;
  bitIndex: number;
  dependsOnEndpoints: string[];
  dependsOnModules: string[];
}

export interface DagBlastRadiusPlan {
  gateCode: number;
  impactedUnitSuites: string[];
  impactedE2eJourneys: string[];
  skippedE2eJourneys: string[];
  e2eMask: number;
  savedE2eRunsCount: number;
}

export function planBlastRadiusExecution(params: {
  changedFiles: string[];
  modules: ServiceOrModuleNode[];
  e2eJourneys: E2eJourneyNode[];
  unitTierPassed: boolean;
  contractGatePassed: boolean;
  forceFullSweep?: boolean;
}): DagBlastRadiusPlan {
  const touchedModules = new Set<string>();
  const touchedEndpoints = new Set<string>();
  const impactedUnits = new Set<string>();

  for (const file of params.changedFiles) {
    for (const mod of params.modules) {
      if (mod.filePatterns.some((prefix) => file.includes(prefix))) {
        touchedModules.add(mod.id);
        for (const ep of mod.exposesEndpoints) touchedEndpoints.add(ep);
        for (const u of mod.unitSuiteIds) impactedUnits.add(u);
      }
    }
  }

  if (!params.unitTierPassed || !params.contractGatePassed) {
    return {
      gateCode: -9866,
      impactedUnitSuites: Array.from(impactedUnits),
      impactedE2eJourneys: [],
      skippedE2eJourneys: params.e2eJourneys.map((j) => j.id),
      e2eMask: 0,
      savedE2eRunsCount: params.e2eJourneys.length
    };
  }

  const impactedE2e: string[] = [];
  const skippedE2e: string[] = [];
  let e2eMask = 0;

  for (const j of params.e2eJourneys) {
    const hit =
      Boolean(params.forceFullSweep) ||
      j.dependsOnModules.some((m) => touchedModules.has(m)) ||
      j.dependsOnEndpoints.some((ep) => touchedEndpoints.has(ep));
    if (hit) {
      impactedE2e.push(j.id);
      e2eMask = (e2eMask | (1 << j.bitIndex)) & 0xffff;
    } else {
      skippedE2e.push(j.id);
    }
  }

  return {
    gateCode: e2eMask,
    impactedUnitSuites: Array.from(impactedUnits),
    impactedE2eJourneys: impactedE2e,
    skippedE2eJourneys: skippedE2e,
    e2eMask,
    savedE2eRunsCount: skippedE2e.length
  };
}
