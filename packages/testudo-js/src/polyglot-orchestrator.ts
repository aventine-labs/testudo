/**
 * @aventine/testudo v1.1.0 - 9-Language Polyglot Unit & Contract Orchestrator
 * File: packages/testudo-js/src/polyglot-orchestrator.ts
 *
 * Speaks TWEP v1 NDJSON + zero-rewrite native output adapters across:
 *   0: typescript (Node 22+)
 *   1: rust       (rustc / cargo)
 *   2: go         (go test / go run)
 *   3: cpp        (g++ / clang++)
 *   4: java       (javac + java / JUnit)
 *   5: php        (php / PHPUnit)
 *   6: aegis      (aegisc prove --json)
 *   7: csharp     (dotnet test TRX XML adapter + TestudoUnit.cs)
 *   8: ruby       (ruby / RSpec JSON adapter + testudo_unit.rb)
 *
 * Stages compiled artifacts in /dev/shm RAM tmpfs when available.
 * Zero external npm dependencies. Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SupportedPolyglotLang } from './cassette-contract.js';
import type { TwepTestEvent } from './unit.js';

export const POLYGLOT_LANG_BITS: Record<SupportedPolyglotLang, number> = {
  typescript: 1 << 0,
  rust: 1 << 1,
  go: 1 << 2,
  cpp: 1 << 3,
  java: 1 << 4,
  php: 1 << 5,
  aegis: 1 << 6,
  csharp: 1 << 7,
  ruby: 1 << 8
};

export interface HostRuntimeAvailability {
  availableMask: number;
  binaries: Partial<Record<SupportedPolyglotLang, string>>;
}

export function detectHostRuntimes(customAegiscPath?: string): HostRuntimeAvailability {
  const probes: Array<[SupportedPolyglotLang, string, string[]]> = [
    ['typescript', process.execPath, ['--version']],
    ['rust', 'rustc', ['--version']],
    ['go', 'go', ['version']],
    ['cpp', 'g++', ['--version']],
    ['java', 'java', ['-version']],
    ['php', 'php', ['--version']],
    ['csharp', 'dotnet', ['--version']],
    ['ruby', 'ruby', ['--version']]
  ];

  let availableMask = 0;
  const binaries: Partial<Record<SupportedPolyglotLang, string>> = {};

  for (const [lang, cmd, args] of probes) {
    const res = spawnSync(cmd, args, { encoding: 'utf8', timeout: 3000 });
    if (!res.error && res.status === 0) {
      availableMask |= POLYGLOT_LANG_BITS[lang];
      binaries[lang] = cmd;
    }
  }

  const aegiscCandidates = [
    customAegiscPath,
    path.resolve(process.cwd(), 'packages/aegis-core/bin/aegisc'),
    path.resolve(process.cwd(), '../../packages/aegis-core/bin/aegisc')
  ].filter((x): x is string => Boolean(x));

  for (const cand of aegiscCandidates) {
    if (fs.existsSync(cand)) {
      availableMask |= POLYGLOT_LANG_BITS.aegis;
      binaries.aegis = cand;
      break;
    }
  }

  return { availableMask, binaries };
}

/**
 * Exact TypeScript mirror of Z3-proven `testudo_resolve_polyglot_language_mask`.
 */
export function resolvePolyglotLanguageMask(
  detectedRepoMask: number,
  requestedFilterMask: number,
  hostAvailableMask: number,
  allowAdapterDigestFallback: boolean
): number {
  const repoBits = detectedRepoMask & 0x3ff;
  const target = requestedFilterMask !== 0 ? repoBits & (requestedFilterMask & 0x3ff) : repoBits;
  if (target === 0) return -9870;
  const missingHost = target & (0x3ff ^ (hostAvailableMask & 0x3ff));
  if (!allowAdapterDigestFallback && missingHost !== 0) return -9870;
  return target;
}

export function parseTwepLines(rawOutput: string, fallbackLang: SupportedPolyglotLang): TwepTestEvent[] {
  const events: TwepTestEvent[] = [];
  for (const rawLine of rawOutput.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.twep === 1 && typeof parsed.name === 'string') {
        events.push({
          twep: 1,
          lang: String(parsed.lang || fallbackLang),
          tier: (parsed.tier as TwepTestEvent['tier']) || 'unit',
          suite: String(parsed.suite || 'default'),
          name: parsed.name,
          ok: Boolean(parsed.ok),
          durationUs: Math.max(1, Number(parsed.durationUs || 1)),
          assertions: Number(parsed.assertions ?? 1),
          cassetteVerified: Boolean(parsed.cassetteVerified),
          error: typeof parsed.error === 'string' ? parsed.error : undefined
        });
      } else if (typeof parsed.Action === 'string' && typeof parsed.Test === 'string') {
        // Zero-rewrite `go test -json` native event adapter
        if (parsed.Action === 'pass' || parsed.Action === 'fail') {
          events.push({
            twep: 1,
            lang: 'go',
            tier: 'unit',
            suite: String(parsed.Package || 'go_pkg'),
            name: parsed.Test,
            ok: parsed.Action === 'pass',
            durationUs: Math.max(1, Math.round(Number(parsed.Elapsed || 0.001) * 1_000_000)),
            assertions: 1
          });
        }
      }
    } catch {
      // Ignore non-JSON diagnostic lines
    }
  }
  return events;
}

/**
 * Zero-rewrite .NET `dotnet test --logger trx` XML adapter -> TWEP v1 events.
 */
export function parseDotnetTrxAdapter(trxXml: string, suiteName = 'dotnet_trx'): TwepTestEvent[] {
  const events: TwepTestEvent[] = [];
  const tagRegex = /<UnitTestResult\b([^>]+)\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(trxXml)) !== null) {
    const attrs = match[1];
    const getAttr = (k: string) => {
      const m = new RegExp(`${k}="([^"]*)"`).exec(attrs);
      return m ? m[1] : '';
    };
    const name = getAttr('testName') || 'dotnet_case';
    const outcome = getAttr('outcome').toLowerCase();
    const durStr = getAttr('duration'); // HH:MM:SS.fffffff
    let durationUs = 50;
    const parts = durStr.split(':');
    if (parts.length === 3) {
      const secs = Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
      if (Number.isFinite(secs)) durationUs = Math.max(1, Math.round(secs * 1_000_000));
    }
    events.push({
      twep: 1,
      lang: 'csharp',
      tier: 'unit',
      suite: suiteName,
      name,
      ok: outcome === 'passed',
      durationUs,
      assertions: 1,
      error: outcome === 'passed' ? undefined : `TRX outcome: ${outcome}`
    });
  }
  return events;
}

/**
 * Zero-rewrite Ruby `rspec --format json` adapter -> TWEP v1 events.
 */
export function parseRubyRspecJsonAdapter(rspecJson: string, suiteName = 'ruby_rspec'): TwepTestEvent[] {
  const parsed = JSON.parse(rspecJson) as {
    examples?: Array<{
      description?: string;
      full_description?: string;
      status?: string;
      run_time?: number;
      exception?: { message?: string };
    }>;
  };
  const events: TwepTestEvent[] = [];
  for (const ex of parsed.examples ?? []) {
    const ok = ex.status === 'passed';
    events.push({
      twep: 1,
      lang: 'ruby',
      tier: 'unit',
      suite: suiteName,
      name: ex.full_description || ex.description || 'rspec_example',
      ok,
      durationUs: Math.max(1, Math.round(Number(ex.run_time ?? 0.0001) * 1_000_000)),
      assertions: 1,
      error: ok ? undefined : ex.exception?.message || 'RSpec example failed'
    });
  }
  return events;
}

export interface PolyglotCommandTask {
  lang: SupportedPolyglotLang;
  suite: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export function runCommandAsync(
  cmd: string,
  args: string[],
  cwd?: string,
  env?: Record<string, string>
): Promise<{ exitCode: number; stdout: string; stderr: string; wallTimeUs: number }> {
  return new Promise((resolve, reject) => {
    const t0 = process.hrtime.bigint();
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const wallTimeUs = Math.max(1, Number((process.hrtime.bigint() - t0) / 1000n));
      resolve({ exitCode: code ?? 1, stdout, stderr, wallTimeUs });
    });
  });
}

export function createRamStagingDir(prefix = 'testudo-polyglot-'): string {
  const base = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
  return fs.mkdtempSync(path.join(base, prefix));
}

export interface PolyglotCrucibleSummary {
  ok: boolean;
  languageMask: number;
  languagesExecuted: string[];
  totalCases: number;
  passedCases: number;
  failedCases: number;
  cassettesVerifiedCount: number;
  p50DurationUs: number;
  p99DurationUs: number;
  events: TwepTestEvent[];
}

export async function executePolyglotTasks(
  tasks: PolyglotCommandTask[]
): Promise<PolyglotCrucibleSummary> {
  const rawResults = await Promise.all(
    tasks.map(async (t) => {
      const res = await runCommandAsync(t.command, t.args, t.cwd, t.env);
      if (t.lang === 'aegis') {
        try {
          const j = JSON.parse(res.stdout) as {
            ok?: boolean;
            verdict?: string;
            functionsChecked?: number;
            totalObligationsChecked?: number;
            elapsedUs?: number;
          };
          const ev: TwepTestEvent = {
            twep: 1,
            lang: 'aegis',
            tier: 'unit',
            suite: t.suite,
            name: `z3_prove_${j.verdict || 'kernel'}`,
            ok: Boolean(j.ok) && res.exitCode === 0,
            durationUs: Number(j.elapsedUs || res.wallTimeUs),
            assertions: Number(j.totalObligationsChecked || j.functionsChecked || 1),
            cassetteVerified: true
          };
          return [ev];
        } catch {
          return [
            {
              twep: 1 as const,
              lang: 'aegis',
              tier: 'unit' as const,
              suite: t.suite,
              name: 'aegisc_prove',
              ok: res.exitCode === 0,
              durationUs: res.wallTimeUs,
              assertions: 1,
              error: res.exitCode === 0 ? undefined : res.stderr || res.stdout
            }
          ];
        }
      }
      const parsed = parseTwepLines(res.stdout, t.lang);
      if (parsed.length > 0) return parsed;
      return [
        {
          twep: 1 as const,
          lang: t.lang,
          tier: 'unit' as const,
          suite: t.suite,
          name: `${t.lang}_native_suite`,
          ok: res.exitCode === 0,
          durationUs: res.wallTimeUs,
          assertions: 1,
          error: res.exitCode === 0 ? undefined : (res.stderr || res.stdout).slice(0, 240)
        }
      ];
    })
  );

  const events = rawResults.flat();
  const langs = Array.from(new Set(events.map((e) => e.lang)));
  let languageMask = 0;
  for (const l of langs) {
    if (l in POLYGLOT_LANG_BITS) {
      languageMask |= POLYGLOT_LANG_BITS[l as SupportedPolyglotLang];
    }
  }

  const passedCases = events.filter((e) => e.ok).length;
  const failedCases = events.length - passedCases;
  const cassettesVerifiedCount = events.filter((e) => e.cassetteVerified).length;
  const sortedDur = events.map((e) => e.durationUs).sort((a, b) => a - b);
  const p50DurationUs = sortedDur.length > 0 ? sortedDur[Math.floor(sortedDur.length * 0.5)] : 0;
  const p99DurationUs =
    sortedDur.length > 0 ? sortedDur[Math.min(sortedDur.length - 1, Math.floor(sortedDur.length * 0.99))] : 0;

  return {
    ok: failedCases === 0 && events.length > 0,
    languageMask,
    languagesExecuted: langs,
    totalCases: events.length,
    passedCases,
    failedCases,
    cassettesVerifiedCount,
    p50DurationUs,
    p99DurationUs,
    events
  };
}
