#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

function getPlatformInfo() {
  const platform = process.platform;
  const arch = process.arch;

  let osName = '';
  let archName = '';

  if (platform === 'linux') {
    osName = 'linux';
  } else if (platform === 'darwin') {
    osName = 'darwin';
  } else if (platform === 'win32') {
    osName = 'windows';
  } else {
    throw new Error(`Unsupported operating system: ${platform}`);
  }

  if (arch === 'x64') {
    archName = 'amd64';
  } else if (arch === 'arm64') {
    archName = 'arm64';
  } else {
    throw new Error(`Unsupported CPU architecture: ${arch}`);
  }

  const ext = platform === 'win32' ? '.exe' : '';
  const binaryFileName = `testudo-jmx-${osName}-${archName}${ext}`;

  return { osName, archName, ext, binaryFileName };
}

function resolveBinary() {
  const { binaryFileName, ext } = getPlatformInfo();

  const candidates = [
    path.join(__dirname, 'platforms', binaryFileName),
    path.join(__dirname, binaryFileName),
    path.join(__dirname, 'testudo-jmx' + ext),
    path.join(__dirname, '..', 'bin', 'platforms', binaryFileName),
    path.join(__dirname, '..', 'bin', 'testudo-jmx' + ext)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      if (process.platform !== 'win32') {
        try {
          const stats = fs.statSync(candidate);
          if ((stats.mode & 0o111) === 0) {
            fs.chmodSync(candidate, stats.mode | 0o755);
          }
        } catch {
          // ignore chmod permission error
        }
      }
      return candidate;
    }
  }

  throw new Error(
    `Testudo-JMX native executable not found for ${process.platform}-${process.arch}.\nTried paths:\n  ` +
      candidates.join('\n  ')
  );
}

function run() {
  try {
    const binPath = resolveBinary();
    const result = spawnSync(binPath, process.argv.slice(2), {
      stdio: 'inherit'
    });

    if (result.error) {
      console.error(`[testudo-jmx] Spawn error: ${result.error.message}`);
      process.exit(1);
    }

    process.exit(result.status ?? 0);
  } catch (err) {
    console.error(`[testudo-jmx] ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  resolveBinary,
  getPlatformInfo,
  run
};
