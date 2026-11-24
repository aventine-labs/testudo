/**
 * @aventine/testudo v1.0.0 - Deterministic Production Bundle Size Verifier
 * Enforces 3 strict zero-bloat size budgets:
 *   1. Surgical IsolatedWorld Probe (dist/probe.js): Strictly < 4.0 KB minified gzip (< 4,096 bytes)
 *   2. Core Math/Format/Type/Diff Bundle: Strictly < 6.0 KB minified gzip
 *   3. Browser Full Suite (excluding Node-only out-of-process servers & adapters): < 76.0 KB minified gzip
 * Zero external dependencies. Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '../dist');

if (!fs.existsSync(distDir)) {
  console.error('Error: dist directory does not exist. Run npm run build first.');
  process.exit(1);
}

function stripCommentsAndWhitespace(code) {
  let out = '';
  let i = 0;
  const len = code.length;
  let quote = null;

  while (i < len) {
    const ch = code[i];
    const next = i + 1 < len ? code[i + 1] : '';

    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < len) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      i++;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) {
        i++;
      }
      i += 2;
      out += ' ';
      continue;
    }

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < len && code[i] !== '\n' && code[i] !== '\r') {
        i++;
      }
      out += ' ';
      continue;
    }

    if (/\s/.test(ch)) {
      if (out.length > 0 && out[out.length - 1] !== ' ') {
        out += ' ';
      }
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out.trim();
}

console.log('================================================================');
console.log('              TESTUDO v1.0 BUNDLE SIZE VERIFICATION             ');
console.log('================================================================');

// 1. Surgical IsolatedWorld Probe (< 4.0 KB / 4096 bytes strict gate)
const probePath = path.join(distDir, 'probe.js');
const probeRaw = fs.existsSync(probePath) ? fs.readFileSync(probePath, 'utf8') : '';
const probeMin = stripCommentsAndWhitespace(probeRaw);
const probeGzipBytes = zlib.gzipSync(Buffer.from(probeMin)).length;
const PROBE_LIMIT_BYTES = 4096;
console.log(
  `IsolatedWorld Probe: ${(probeGzipBytes / 1024).toFixed(2)} KB minified gzip (${probeGzipBytes} bytes)`
);
if (probeGzipBytes === 0 || probeGzipBytes >= PROBE_LIMIT_BYTES) {
  console.error(`FAILED: IsolatedWorld probe (${probeGzipBytes} B) must be < ${PROBE_LIMIT_BYTES} bytes!`);
  process.exit(1);
} else {
  console.log(`STATUS: PASSED (Strictly < 4.00 KB / 4096 B Split-World Gate).`);
}

// 2. Core Modules (math, format, type, diff < 6.0 KB strict gate)
const coreFiles = ['math.js', 'format.js', 'type.js', 'diff.js'];
let coreRaw = '';
for (const file of coreFiles) {
  const filePath = path.join(distDir, file);
  if (fs.existsSync(filePath)) {
    coreRaw += fs.readFileSync(filePath, 'utf8') + '\n';
  }
}
const coreGzipRaw = zlib.gzipSync(Buffer.from(coreRaw)).length;
const coreMin = stripCommentsAndWhitespace(coreRaw);
const coreGzipMin = zlib.gzipSync(Buffer.from(coreMin)).length;
const CORE_LIMIT_KB = 6.0;
console.log(
  `Core Bundle: ${(coreGzipMin / 1024).toFixed(2)} KB minified gzip (${coreGzipMin} bytes, raw: ${(coreGzipRaw / 1024).toFixed(2)} KB)`
);
if (coreGzipMin > CORE_LIMIT_KB * 1024) {
  console.error(`FAILED: Core bundle exceeds ${CORE_LIMIT_KB} KB limit!`);
  process.exit(1);
} else {
  console.log(`STATUS: PASSED (Strictly < ${CORE_LIMIT_KB} KB target).`);
}

// 3. Browser Full Module Suite (excluding Node-only out-of-process modules and pre-bundled iife/esm)
const NODE_ONLY_FILES = new Set([
  'playwright.js',
  'cdp.js',
  'bidi.js',
  'security-enclave.js',
  'hybrid-load-canary.js',
  'unit.js',
  'cassette-contract.js',
  'mutation-dag.js',
  'polyglot-orchestrator.js',
  'studio-server.js',
  'studio-ui.js',
  'cli.js',
  'testudo.iife.js',
  'testudo.esm.js'
]);

let fullRaw = '';
function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.js') &&
      !entry.name.endsWith('.map') &&
      !NODE_ONLY_FILES.has(entry.name)
    ) {
      fullRaw += fs.readFileSync(fullPath, 'utf8') + '\n';
    }
  }
}

scanDir(distDir);
const fullGzipRaw = zlib.gzipSync(Buffer.from(fullRaw)).length;
const fullMin = stripCommentsAndWhitespace(fullRaw);
const fullGzipMin = zlib.gzipSync(Buffer.from(fullMin)).length;
const FULL_LIMIT_KB = 76.0;

console.log(
  `Browser Suite: ${(fullGzipMin / 1024).toFixed(2)} KB minified gzip (${fullGzipMin} bytes, raw: ${(fullGzipRaw / 1024).toFixed(2)} KB)`
);
if (fullGzipMin > FULL_LIMIT_KB * 1024) {
  console.error(`FAILED: Browser suite exceeds ${FULL_LIMIT_KB} KB limit!`);
  process.exit(1);
} else {
  console.log(`STATUS: PASSED (Strictly < ${FULL_LIMIT_KB} KB target).`);
}

for (const bundleName of ['testudo.iife.js', 'testudo.esm.js']) {
  const bundlePath = path.join(distDir, bundleName);
  if (fs.existsSync(bundlePath)) {
    const raw = fs.readFileSync(bundlePath, 'utf8');
    const min = stripCommentsAndWhitespace(raw);
    const gz = zlib.gzipSync(Buffer.from(min)).length;
    console.log(`${bundleName}: ${(gz / 1024).toFixed(2)} KB minified gzip (${gz} bytes)`);
  }
}
console.log('================================================================');
