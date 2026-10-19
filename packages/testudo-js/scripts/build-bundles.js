/**
 * @aventine/testudo - Dual Explicit Browser & ESM Bundle Builder (v0.3.0)
 * Produces:
 *   1. dist/testudo.iife.js - Self-contained browser script exposing window.$T and window.testudo
 *   2. dist/testudo.esm.js  - Self-contained browser-safe ES module bundle
 * Keeps dist/adapters/standalone.js and all subpath exports 100% backward-compatible.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = path.resolve(__dirname, '..');
const distDir = path.resolve(pkgRoot, 'dist');

async function loadEsbuild() {
  const candidates = [
    'esbuild',
    path.resolve(pkgRoot, 'node_modules/esbuild/lib/main.js'),
    path.resolve(pkgRoot, '../../node_modules/esbuild/lib/main.js')
  ];
  for (const candidate of candidates) {
    try {
      return await import(candidate);
    } catch {
      // try next candidate
    }
  }
  throw new Error('Could not resolve esbuild for Testudo bundle generation.');
}

async function buildBundles() {
  const esbuild = await loadEsbuild();
  const buildFn = esbuild.build || esbuild.default?.build;

  const browserEntryContent = `
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
export * from './adapters/standalone.js';
import { createTestudoInstance } from './adapters/standalone.js';
export const testudo = typeof window !== 'undefined' && (window).testudo ? (window).testudo : createTestudoInstance();
export const $T = testudo;
export default testudo;
`;

  const tempEntryPath = path.join(distDir, '__browser_entry.js');
  fs.writeFileSync(tempEntryPath, browserEntryContent, 'utf8');

  try {
    // 1. Build dist/testudo.iife.js (Self-contained IIFE for <script src="..."> and page.addScriptTag)
    await buildFn({
      entryPoints: [tempEntryPath],
      outfile: path.join(distDir, 'testudo.iife.js'),
      bundle: true,
      format: 'iife',
      globalName: '__TestudoBundle__',
      platform: 'browser',
      target: ['es2020'],
      minify: false,
      sourcemap: true,
      banner: {
        js: '/* @aventine/testudo v0.3.0 - Self-Contained Browser IIFE Bundle (Apache-2.0) */'
      },
      footer: {
        js: `if (typeof window !== 'undefined' && typeof __TestudoBundle__ !== 'undefined') { window.testudo = window.testudo || __TestudoBundle__.testudo; window.$T = window.$T || window.testudo; }`
      }
    });

    // 2. Build dist/testudo.esm.js (Self-contained ESM bundle for modern module consumers)
    await buildFn({
      entryPoints: [tempEntryPath],
      outfile: path.join(distDir, 'testudo.esm.js'),
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: ['es2020'],
      minify: false,
      sourcemap: true,
      banner: {
        js: '/* @aventine/testudo v0.3.0 - Self-Contained Browser ESM Bundle (Apache-2.0) */'
      }
    });
  } finally {
    if (fs.existsSync(tempEntryPath)) {
      fs.unlinkSync(tempEntryPath);
    }
  }
}

buildBundles().catch((err) => {
  console.error('[Testudo Build Error]', err);
  process.exit(1);
});
