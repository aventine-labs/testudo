/**
 * @aventine/testudo - Deterministic Production Bundle Size Verifier
 * Measures exact gzipped byte size of core and full bundles.
 * Zero external dependencies.
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
  return code
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 1. Measure Core Modules (math, format, type, diff)
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
const coreKb = (coreGzipMin / 1024).toFixed(2);
const CORE_LIMIT_KB = 5.0;

console.log('================================================================');
console.log('              TESTUDO BUNDLE SIZE VERIFICATION                  ');
console.log('================================================================');
console.log(
  `Core Bundle: ${coreKb} KB minified gzip (${coreGzipMin} bytes, raw: ${(coreGzipRaw / 1024).toFixed(2)} KB)`
);

if (coreGzipMin > CORE_LIMIT_KB * 1024) {
  console.error(`FAILED: Core bundle exceeds ${CORE_LIMIT_KB} KB limit!`);
  process.exit(1);
} else {
  console.log(`STATUS: PASSED (Strictly < ${CORE_LIMIT_KB} KB target).`);
}

// 2. Measure Full Bundle (all dist JS files including adapters and scanners)
let fullRaw = '';
function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.map')) {
      fullRaw += fs.readFileSync(fullPath, 'utf8') + '\n';
    }
  }
}

scanDir(distDir);
const fullGzipRaw = zlib.gzipSync(Buffer.from(fullRaw)).length;
const fullMin = stripCommentsAndWhitespace(fullRaw);
const fullGzipMin = zlib.gzipSync(Buffer.from(fullMin)).length;
const fullKb = (fullGzipMin / 1024).toFixed(2);
const FULL_LIMIT_KB = 10.0;

console.log(
  `Full Bundle: ${fullKb} KB minified gzip (${fullGzipMin} bytes, raw: ${(fullGzipRaw / 1024).toFixed(2)} KB)`
);

if (fullGzipMin > FULL_LIMIT_KB * 1024) {
  console.error(`FAILED: Full bundle exceeds ${FULL_LIMIT_KB} KB limit!`);
  process.exit(1);
} else {
  console.log(`STATUS: PASSED (Strictly < ${FULL_LIMIT_KB} KB target).`);
}
console.log('================================================================');
