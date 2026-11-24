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
export * from './launcher.js';
export * from './digest.js';
export * from './wasm-concierge.js';
export * from './telemetry.js';
export * from './kinetic.js';
export * from './probe.js';
export * from './quiescence.js';
export * from './waterfall.js';
export * from './intercept.js';
export * from './audit.js';
export * from './timetravel.js';
export * from './stress.js';
export * from './runner.js';
export * from './ast-advisor.js';
export * from './xray.js';
export * from './unit.js';
export * from './cassette-contract.js';
export * from './mutation-dag.js';
export * from './ui/shadow-widget.js';
export * from './adapters/standalone.js';
import { createTestudoInstance } from './adapters/standalone.js';
export const testudo = typeof window !== 'undefined' && (window).testudo ? (window).testudo : createTestudoInstance();
export const $T = testudo;
export default testudo;
`;

  fs.mkdirSync(distDir, { recursive: true });
  const pidSuffix = `${process.pid}.${Date.now()}`;
  const tempEntryPath = path.join(distDir, `__browser_entry.${pidSuffix}.js`);
  const tempEntryWriteTmp = `${tempEntryPath}.tmp`;
  const tmpIifeOut = path.join(distDir, `testudo.iife.js.tmp.${pidSuffix}`);
  const tmpEsmOut = path.join(distDir, `testudo.esm.js.tmp.${pidSuffix}`);
  fs.writeFileSync(tempEntryWriteTmp, browserEntryContent, 'utf8');
  fs.renameSync(tempEntryWriteTmp, tempEntryPath);

  const finalizeAtomicBundle = (tmpJsPath, finalJsName) => {
    const tmpMapPath = `${tmpJsPath}.map`;
    const finalJsPath = path.join(distDir, finalJsName);
    const finalMapName = `${finalJsName}.map`;
    const finalMapPath = path.join(distDir, finalMapName);
    const tmpJsName = path.basename(tmpJsPath);

    if (fs.existsSync(tmpMapPath)) {
      const mapContent = fs.readFileSync(tmpMapPath, 'utf8').split(tmpJsName).join(finalJsName);
      fs.writeFileSync(tmpMapPath, mapContent, 'utf8');
      fs.renameSync(tmpMapPath, finalMapPath);
    }
    if (fs.existsSync(tmpJsPath)) {
      const jsContent = fs
        .readFileSync(tmpJsPath, 'utf8')
        .replace(`//# sourceMappingURL=${tmpJsName}.map`, `//# sourceMappingURL=${finalMapName}`);
      fs.writeFileSync(tmpJsPath, jsContent, 'utf8');
      fs.renameSync(tmpJsPath, finalJsPath);
    }
  };

  try {
    // 1. Build dist/testudo.iife.js (Self-contained IIFE for <script src="..."> and page.addScriptTag)
    await buildFn({
      entryPoints: [tempEntryPath],
      outfile: tmpIifeOut,
      bundle: true,
      format: 'iife',
      globalName: '__TestudoBundle__',
      platform: 'browser',
      target: ['es2020'],
      minify: false,
      sourcemap: true,
      banner: {
        js: '/* @aventine/testudo v0.5.0 - Self-Contained Browser IIFE Bundle (Apache-2.0) */'
      },
      footer: {
        js: `if (typeof window !== 'undefined' && typeof __TestudoBundle__ !== 'undefined') { window.testudo = window.testudo || __TestudoBundle__.testudo; window.$T = window.$T || window.testudo; }`
      }
    });
    finalizeAtomicBundle(tmpIifeOut, 'testudo.iife.js');

    // 2. Build dist/testudo.esm.js (Self-contained ESM bundle for modern module consumers)
    await buildFn({
      entryPoints: [tempEntryPath],
      outfile: tmpEsmOut,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: ['es2020'],
      minify: false,
      sourcemap: true,
      banner: {
        js: '/* @aventine/testudo v0.5.0 - Self-Contained Browser ESM Bundle (Apache-2.0) */'
      }
    });
    finalizeAtomicBundle(tmpEsmOut, 'testudo.esm.js');

    // 3. Copy built testudo.iife.js atomically into extension/ directory if present
    const extDir = path.join(pkgRoot, 'extension');
    if (fs.existsSync(extDir)) {
      const extTmp = path.join(extDir, `testudo.iife.js.tmp.${pidSuffix}`);
      fs.copyFileSync(path.join(distDir, 'testudo.iife.js'), extTmp);
      fs.renameSync(extTmp, path.join(extDir, 'testudo.iife.js'));
    }
  } finally {
    for (const stale of [
      tempEntryWriteTmp,
      tempEntryPath,
      tmpIifeOut,
      `${tmpIifeOut}.map`,
      tmpEsmOut,
      `${tmpEsmOut}.map`
    ]) {
      if (fs.existsSync(stale)) {
        try {
          fs.unlinkSync(stale);
        } catch {
          // ignore cleanup error
        }
      }
    }
  }
}

buildBundles().catch((err) => {
  console.error('[Testudo Build Error]', err);
  process.exit(1);
});
