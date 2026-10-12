import { spawn, spawnSync, ChildProcess, SpawnOptions, SpawnSyncOptions } from 'child_process';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const runner = require('../bin/testudo-jmx.js');

export interface PlatformInfo {
  osName: string;
  archName: string;
  ext: string;
  binaryFileName: string;
}

export interface ExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface RunPlanOptions {
  users?: number;
  duration?: string;
  jtlPath?: string;
  reportDir?: string;
  keepAlive?: 'DEFAULT' | 'FORCE_ON' | 'FORCE_OFF';
  recycle?: boolean;
  meshTelemetry?: string;
  additionalArgs?: string[];
  env?: NodeJS.ProcessEnv;
}

export function getBinaryPath(): string {
  return runner.resolveBinary();
}

export function getPlatformInfo(): PlatformInfo {
  return runner.getPlatformInfo();
}

export function runSync(args: string[], options: SpawnSyncOptions = {}): ExecResult {
  const binary = getBinaryPath();
  const res = spawnSync(binary, args, {
    encoding: 'utf-8',
    stdio: 'pipe',
    ...options
  });

  return {
    status: res.status,
    stdout: res.stdout ? res.stdout.toString() : '',
    stderr: res.stderr ? res.stderr.toString() : '',
    error: res.error
  };
}

export function runAsync(args: string[], options: SpawnOptions = {}): ChildProcess {
  const binary = getBinaryPath();
  return spawn(binary, args, {
    stdio: 'inherit',
    ...options
  });
}

export function runPlan(jmxPath: string, options: RunPlanOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const args: string[] = ['-n', '-t', path.resolve(jmxPath)];

    if (options.users && options.users > 0) {
      args.push('-u', options.users.toString());
    }
    if (options.duration) {
      args.push('-d', options.duration);
    }
    if (options.jtlPath) {
      args.push('-l', path.resolve(options.jtlPath));
    }
    if (options.reportDir) {
      args.push('-e', '-o', path.resolve(options.reportDir));
    }
    if (options.keepAlive) {
      args.push('-k', options.keepAlive);
    }
    if (options.recycle) {
      args.push('-recycle');
    }
    if (options.meshTelemetry) {
      args.push('-mesh-telemetry', options.meshTelemetry);
    }
    if (options.additionalArgs && options.additionalArgs.length > 0) {
      args.push(...options.additionalArgs);
    }

    const binary = getBinaryPath();
    const child = spawn(binary, args, {
      env: { ...process.env, ...options.env }
    });

    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (d: Buffer | string) => {
        stdout += d.toString();
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (d: Buffer | string) => {
        stderr += d.toString();
      });
    }

    child.on('error', (err: Error) => {
      reject(err);
    });

    child.on('close', (status: number | null) => {
      resolve({
        status,
        stdout,
        stderr
      });
    });
  });
}

export default {
  getBinaryPath,
  getPlatformInfo,
  runSync,
  runAsync,
  runPlan
};
