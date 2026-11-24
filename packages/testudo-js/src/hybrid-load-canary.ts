/**
 * @aventine/testudo - 1:N Hybrid Wire Load + Real-Browser Canary Screengrab Overlay
 * (src/hybrid-load-canary.ts)
 * Runs alongside AventineLoadEngine.py / testudo-jmx / LoadForge:
 * - 99.9% lightweight protocol wire VUs generate authentic server load & Gunther USL curves
 * - 1/N Core-Pinned (taskset/cpuset, <=10% host cores, ZERO artificial Emulation.setCPUThrottlingRate)
 *   Real-Browser Canaries execute full UI scenarios and buffer screengrabs + 5-lane waterfalls in /dev/shm
 * - Computes UX Amplification Ratio (alpha_UX = Browser_LCP / Wire_p95) and pins PII-redacted screengrabs
 *   directly onto Baseline, Pre-Knee, USL Knee N*, Overload, and Recovery stages!
 * Zero external dependencies. Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { buildRedactedScreengrabSvgDataUri, resolveRamSpoolDirectory } from './security-enclave.js';
import type { SensitiveRect } from './probe.js';
import type { FiveLaneWaterfallReport } from './waterfall.js';

export type LoadStagePhase = 'BASELINE_10PCT' | 'PRE_KNEE_60PCT' | 'USL_KNEE_N_STAR' | 'OVERLOAD_120PCT' | 'RECOVERY';

export interface HybridCanaryStagePoint {
  stage: LoadStagePhase;
  wireConcurrencyVus: number;
  activeBrowserCanaries: number;
  wireRps: number;
  wireP50Us: number;
  wireP95Us: number;
  wireP99Us: number;
  wireErrorCount: number;
  browserTtfbUs: number;
  browserLcpUs: number;
  browserInpUs: number;
  browserFps: number;
  uxAmplificationRatio: number;
  redactedScreengrabDataUri: string;
  screengrabSha256: string;
  redactedSensitiveBoxes: number;
  waterfall: FiveLaneWaterfallReport;
}

export interface HybridLoadOverlayReport {
  runId: string;
  targetUrl: string;
  canaryRatioNth: number;
  hostLogicalCores: number;
  canaryAllocatedCores: number;
  pinnedCanaryCoreIds: number[];
  artificialCpuThrottleEnabled: false;
  shmRamSpoolActive: boolean;
  spoolDirectory: string;
  flushedArtifactPath?: string;
  peakWireRps: number;
  uslKneeVus: number;
  peakUxAmplificationRatio: number;
  stages: HybridCanaryStagePoint[];
}

export interface CanaryBrowserMeasurement {
  browserTtfbUs: number;
  browserLcpUs: number;
  browserInpUs: number;
  browserFps: number;
  rawPngBase64?: string;
  sensitiveRects: SensitiveRect[];
  waterfall: FiveLaneWaterfallReport;
}

export function computeCanaryCoreAllocation(requestedCanaries: number, explicitHostCores?: number): {
  hostLogicalCores: number;
  maxAllowedCanaryCores: number;
  canaryAllocatedCores: number;
  pinnedCanaryCoreIds: number[];
} {
  const hostLogicalCores = Math.max(1, explicitHostCores ?? os.cpus().length);
  const maxAllowedCanaryCores = Math.max(1, Math.floor(hostLogicalCores / 10));
  const canaryAllocatedCores = Math.max(1, Math.min(requestedCanaries, maxAllowedCanaryCores));
  const pinnedCanaryCoreIds: number[] = [];
  for (let i = 0; i < canaryAllocatedCores; i++) {
    pinnedCanaryCoreIds.push(hostLogicalCores - 1 - i);
  }
  return {
    hostLogicalCores,
    maxAllowedCanaryCores,
    canaryAllocatedCores,
    pinnedCanaryCoreIds
  };
}

function percentileUs(sortedUs: number[], q: number): number {
  if (sortedUs.length === 0) return 1;
  const idx = Math.min(sortedUs.length - 1, Math.max(0, Math.floor(q * (sortedUs.length - 1))));
  return Math.max(1, sortedUs[idx]);
}

export async function runWireBurstWindow(options: {
  url: string;
  concurrency: number;
  totalRequests: number;
  timeoutMs?: number;
}): Promise<{
  rps: number;
  p50Us: number;
  p95Us: number;
  p99Us: number;
  errors: number;
}> {
  const target = new URL(options.url);
  const isHttps = target.protocol === 'https:';
  const agent = isHttps
    ? new https.Agent({ keepAlive: true, maxSockets: options.concurrency })
    : new http.Agent({ keepAlive: true, maxSockets: options.concurrency });
  const mod = isHttps ? https : http;

  const latenciesUs: number[] = [];
  let errors = 0;
  let dispatched = 0;
  const total = Math.max(1, options.totalRequests);
  const workers = Math.max(1, Math.min(options.concurrency, total));
  const startNs = process.hrtime.bigint();

  const fireOne = (): Promise<void> =>
    new Promise((resolve) => {
      const t0 = process.hrtime.bigint();
      const req = mod.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          method: 'GET',
          agent,
          timeout: options.timeoutMs ?? 5000
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => {
            const durUs = Number(process.hrtime.bigint() - t0) / 1000;
            latenciesUs.push(Math.max(1, Math.round(durUs)));
            if ((res.statusCode || 500) >= 500) errors += 1;
            resolve();
          });
        }
      );
      req.on('error', () => {
        errors += 1;
        resolve();
      });
      req.on('timeout', () => {
        errors += 1;
        req.destroy();
        resolve();
      });
      req.end();
    });

  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (dispatched < total) {
        dispatched += 1;
        await fireOne();
      }
    })
  );

  agent.destroy();
  const elapsedSec = Math.max(0.0001, Number(process.hrtime.bigint() - startNs) / 1e9);
  latenciesUs.sort((a, b) => a - b);

  return {
    rps: Math.round((total / elapsedSec) * 100) / 100,
    p50Us: percentileUs(latenciesUs, 0.5),
    p95Us: percentileUs(latenciesUs, 0.95),
    p99Us: percentileUs(latenciesUs, 0.99),
    errors
  };
}

export async function runHybridWireAndBrowserCanary(options: {
  runId?: string;
  targetUrl: string;
  canaryRatioNth?: number;
  stageVuPlan?: Array<{ stage: LoadStagePhase; wireVus: number; requests: number }>;
  runBrowserCanaryScenario: (stage: LoadStagePhase, wireVus: number, pinnedCores: number[]) => Promise<CanaryBrowserMeasurement>;
  persistOutputDir?: string;
}): Promise<HybridLoadOverlayReport> {
  const runId = options.runId || `hybrid-${Date.now()}`;
  const canaryRatioNth = Math.max(10, options.canaryRatioNth ?? 100);
  const { spoolDir, isTmpfsShm } = resolveRamSpoolDirectory(runId);

  const plan = options.stageVuPlan || [
    { stage: 'BASELINE_10PCT', wireVus: 8, requests: 64 },
    { stage: 'PRE_KNEE_60PCT', wireVus: 24, requests: 160 },
    { stage: 'USL_KNEE_N_STAR', wireVus: 48, requests: 256 },
    { stage: 'OVERLOAD_120PCT', wireVus: 64, requests: 256 },
    { stage: 'RECOVERY', wireVus: 8, requests: 64 }
  ];

  const maxPlanVus = Math.max(...plan.map((p) => p.wireVus));
  const requestedPeakCanaries = Math.max(1, Math.ceil(maxPlanVus / canaryRatioNth));
  const corePlan = computeCanaryCoreAllocation(requestedPeakCanaries);

  const stages: HybridCanaryStagePoint[] = [];
  let peakWireRps = 0;
  let uslKneeVus = plan[0].wireVus;
  let peakUxAmp = 1.0;

  for (const step of plan) {
    const stageCanaries = Math.max(
      1,
      Math.min(corePlan.canaryAllocatedCores, Math.ceil(step.wireVus / canaryRatioNth))
    );

    const [wireStats, canaryMeas] = await Promise.all([
      runWireBurstWindow({
        url: options.targetUrl,
        concurrency: step.wireVus,
        totalRequests: step.requests
      }),
      options.runBrowserCanaryScenario(step.stage, step.wireVus, corePlan.pinnedCanaryCoreIds)
    ]);

    const redacted = buildRedactedScreengrabSvgDataUri({
      rawPngBase64: canaryMeas.rawPngBase64,
      width: 1280,
      height: 720,
      stageLabel: step.stage,
      wireVus: step.wireVus,
      wireP95Ms: wireStats.p95Us / 1000,
      browserLcpMs: canaryMeas.browserLcpUs / 1000,
      sensitiveRects: canaryMeas.sensitiveRects
    });

    // Stage frame in /dev/shm RAM spool during active load window (0 NVMe I/O contention!)
    const ramStageFile = path.join(spoolDir, `${step.stage}.frame.json`);
    const uxAmp = Math.round((canaryMeas.browserLcpUs / Math.max(1, wireStats.p95Us)) * 100) / 100;
    if (wireStats.rps > peakWireRps) {
      peakWireRps = wireStats.rps;
      uslKneeVus = step.wireVus;
    }
    if (uxAmp > peakUxAmp) {
      peakUxAmp = uxAmp;
    }

    const point: HybridCanaryStagePoint = {
      stage: step.stage,
      wireConcurrencyVus: step.wireVus,
      activeBrowserCanaries: stageCanaries,
      wireRps: wireStats.rps,
      wireP50Us: wireStats.p50Us,
      wireP95Us: wireStats.p95Us,
      wireP99Us: wireStats.p99Us,
      wireErrorCount: wireStats.errors,
      browserTtfbUs: canaryMeas.browserTtfbUs,
      browserLcpUs: canaryMeas.browserLcpUs,
      browserInpUs: canaryMeas.browserInpUs,
      browserFps: canaryMeas.browserFps,
      uxAmplificationRatio: uxAmp,
      redactedScreengrabDataUri: redacted.dataUri,
      screengrabSha256: redacted.sha256Hex,
      redactedSensitiveBoxes: redacted.redactedRectCount,
      waterfall: canaryMeas.waterfall
    };
    fs.writeFileSync(ramStageFile, JSON.stringify(point), { mode: 0o600 });
    stages.push(point);
  }

  const report: HybridLoadOverlayReport = {
    runId,
    targetUrl: options.targetUrl,
    canaryRatioNth,
    hostLogicalCores: corePlan.hostLogicalCores,
    canaryAllocatedCores: corePlan.canaryAllocatedCores,
    pinnedCanaryCoreIds: corePlan.pinnedCanaryCoreIds,
    artificialCpuThrottleEnabled: false,
    shmRamSpoolActive: isTmpfsShm,
    spoolDirectory: spoolDir,
    peakWireRps,
    uslKneeVus,
    peakUxAmplificationRatio: peakUxAmp,
    stages
  };

  // Flush to persistent NVMe ONLY AFTER active load run completes!
  if (options.persistOutputDir) {
    fs.mkdirSync(options.persistOutputDir, { recursive: true });
    const outPath = path.join(options.persistOutputDir, `${runId}_hybrid_overlay.json`);
    const tmpOut = `${outPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpOut, JSON.stringify(report, null, 2), 'utf8');
    fs.renameSync(tmpOut, outPath);
    report.flushedArtifactPath = outPath;
  }

  try {
    fs.rmSync(spoolDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup error
  }

  return report;
}
