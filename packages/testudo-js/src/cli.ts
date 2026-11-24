#!/usr/bin/env node
/**
 * @aventine/testudo v1.1.0 - Unified Polyglot Unit, Contract, Mutation & Studio CLI (src/cli.ts)
 * Commands:
 *   testudo studio [--port 3850] [--org-hub https://127.0.0.1:18443]
 *   testudo polyglot                                 Detect host runtimes & verify polyglot readiness
 *   testudo distill <lang>                           Generate idiomatic unit regression template
 *   testudo mutate <file.ts>                         Generate targeted AST/token diff mutants
 *   testudo advise <component-file>                  Scan component AST for missing edge/stress specs
 * Zero external dependencies. Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

import fs from 'node:fs';
import { TestudoSoloStudioServer } from './studio-server.js';
import { analyzeComponentSourceForEdgeCases } from './ast-advisor.js';
import { detectHostRuntimes } from './polyglot-orchestrator.js';
import { distillFailureToUnit, type SupportedPolyglotLang } from './cassette-contract.js';
import { generateTargetedMutants } from './mutation-dag.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'studio';

  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log('Testudo Polyglot Crucible & Studio CLI v1.1.0');
    console.log('  testudo studio [--port 3850] [--org-hub <url>]   Launch Solo Developer Local Cockpit');
    console.log('  testudo polyglot                                 Inspect 9-language runtime availability');
    console.log('  testudo distill <lang>                           Emit native unit regression from E2E failure');
    console.log('  testudo mutate <file>                            Inspect targeted git-diff mutants');
    console.log('  testudo advise <file.tsx>                        Scan component AST for missing edge/stress specs');
    return;
  }

  if (cmd === 'polyglot') {
    console.log(JSON.stringify(detectHostRuntimes(), null, 2));
    return;
  }

  if (cmd === 'distill') {
    const lang = (args[1] || 'typescript') as SupportedPolyglotLang;
    const distilled = distillFailureToUnit(
      {
        journeyName: 'checkout_flow',
        failedStepIndex: 4,
        failedStepAction: 'click submit',
        endpointMethod: 'POST',
        endpointPath: '/api/v1/checkout',
        observedStatus: 500,
        expectedStatus: 200,
        requestPayload: { sku: 'TESTUDO-ENT', quantity: 1 },
        errorSummary: 'Distilled CLI failure'
      },
      lang
    );
    console.log(distilled.code);
    return;
  }

  if (cmd === 'mutate') {
    const file = args[1];
    if (!file || !fs.existsSync(file)) {
      console.error('[Testudo CLI] Provide an existing source file path.');
      process.exit(1);
    }
    const mutants = generateTargetedMutants(fs.readFileSync(file, 'utf8'));
    console.log(JSON.stringify({ file, mutantsGenerated: mutants.length, mutants }, null, 2));
    return;
  }

  if (cmd === 'advise') {
    const file = args[1];
    if (!file || !fs.existsSync(file)) {
      console.error('[Testudo CLI] Provide an existing source file path.');
      process.exit(1);
    }
    const code = fs.readFileSync(file, 'utf8');
    const rep = analyzeComponentSourceForEdgeCases(code, file);
    console.log(JSON.stringify(rep, null, 2));
    return;
  }

  let port = 3850;
  let orgHubUrl: string | undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = Number(args[++i]);
    } else if (args[i] === '--org-hub' && args[i + 1]) {
      orgHubUrl = args[++i];
    }
  }

  const studio = new TestudoSoloStudioServer({ orgHubUrl });
  const info = await studio.start(port);
  console.log(`[Testudo Studio] MODE_SOLO_LOCAL listening on ${info.baseUrl}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[Testudo CLI Error]', err);
    process.exit(1);
  });
}
