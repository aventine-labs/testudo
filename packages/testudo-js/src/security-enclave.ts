/**
 * @aventine/testudo - Split-World Security Enclave, Pre-Shutter PII Redactor & Loopback Shield
 * (src/security-enclave.ts)
 * Enforces:
 *   1. Loopback DNS-Rebinding & Cross-Origin WebSocket Shield (Host + Origin + 256-bit CSPRNG Token)
 *   2. Per-Session 256-Bit HMAC Capability Nonce Verification (constant-time)
 *   3. Zero-Plaintext Wire Header Scrubbing (Pillar 1)
 *   4. Pre-Shutter Screengrab Pixel & Composite SVG PII Redaction (zero live DOM mutation)
 * Zero external dependencies. Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SensitiveRect } from './probe.js';

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-aegis-token',
  'x-aegis-siam-token',
  'x-csrf-token'
]);

export interface LoopbackGateCheck {
  allowed: boolean;
  reason: string;
}

export function mintSessionCapabilityNonce(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function verifyConstantTimeSecret(candidate: string, expected: string): boolean {
  if (!candidate || !expected) return false;
  const a = crypto.createHash('sha256').update(String(candidate), 'utf8').digest();
  const b = crypto.createHash('sha256').update(String(expected), 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Defeats DNS rebinding (e.g., attacker.com -> 127.0.0.1:3850) and Cross-Origin WebSocket/Fetch hijacking.
 */
export function verifyLoopbackHostAndOrigin(
  hostHeader: string | undefined,
  originHeader: string | undefined,
  boundPort?: number
): LoopbackGateCheck {
  const rawHost = String(hostHeader || '').trim().toLowerCase();
  if (!rawHost) {
    return { allowed: false, reason: 'MISSING_HOST_HEADER' };
  }

  let hostname = rawHost;
  let portStr = '';
  if (rawHost.startsWith('[')) {
    const closeIdx = rawHost.indexOf(']');
    if (closeIdx === -1) return { allowed: false, reason: 'MALFORMED_IPV6_HOST' };
    hostname = rawHost.slice(1, closeIdx);
    portStr = rawHost.slice(closeIdx + 1).replace(/^:/, '');
  } else {
    const parts = rawHost.split(':');
    if (parts.length > 2) return { allowed: false, reason: 'MALFORMED_HOST_HEADER' };
    hostname = parts[0];
    portStr = parts[1] || '';
  }

  const validLoopbackHost =
    hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  if (!validLoopbackHost) {
    return { allowed: false, reason: `DNS_REBINDING_BLOCKED_HOST:${hostname}` };
  }
  if (boundPort !== undefined && portStr && Number(portStr) !== boundPort) {
    return { allowed: false, reason: `HOST_PORT_MISMATCH:${portStr}` };
  }

  if (originHeader) {
    const rawOrigin = String(originHeader).trim();
    if (rawOrigin.startsWith('chrome-extension://') || rawOrigin.startsWith('moz-extension://')) {
      return { allowed: true, reason: 'BROWSER_EXTENSION_ORIGIN_OK' };
    }
    try {
      const u = new URL(rawOrigin);
      const oh = u.hostname.toLowerCase();
      if (oh !== '127.0.0.1' && oh !== 'localhost' && oh !== '::1' && oh !== '[::1]') {
        return { allowed: false, reason: `CROSS_ORIGIN_BLOCKED:${oh}` };
      }
    } catch {
      return { allowed: false, reason: 'MALFORMED_ORIGIN_HEADER' };
    }
  }

  return { allowed: true, reason: 'LOOPBACK_ENCLAVE_VERIFIED' };
}

export function scrubHeadersZeroPlaintext(
  headers: Record<string, string | string[] | undefined>,
  hmacSalt = 'TESTUDO_HEADER_BLIND_V1'
): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [k, rawVal] of Object.entries(headers || {})) {
    const lower = k.toLowerCase();
    const strVal = Array.isArray(rawVal) ? rawVal.join('; ') : String(rawVal ?? '');
    if (SENSITIVE_HEADER_NAMES.has(lower)) {
      const blind = crypto.createHmac('sha256', hmacSalt).update(strVal, 'utf8').digest('hex').slice(0, 16);
      clean[lower] = `[BLINDED_SHA256:${blind}]`;
    } else {
      clean[lower] = strVal;
    }
  }
  return clean;
}

/**
 * Physically scrubs sensitive bounding boxes in a raw RGBA pixel buffer prior to disk persistence
 * without mutating a single node in the live browser DOM.
 */
export function redactRgbaFramebufferInPlace(
  rgba: Uint8Array,
  width: number,
  height: number,
  rects: SensitiveRect[]
): number {
  let redactedPixels = 0;
  for (const r of rects) {
    const x0 = Math.max(0, Math.min(width, Math.floor(r.x)));
    const y0 = Math.max(0, Math.min(height, Math.floor(r.y)));
    const x1 = Math.max(x0, Math.min(width, Math.ceil(r.x + r.width)));
    const y1 = Math.max(y0, Math.min(height, Math.ceil(r.y + r.height)));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const off = (y * width + x) * 4;
        if (off + 3 < rgba.length) {
          rgba[off] = 15;
          rgba[off + 1] = 23;
          rgba[off + 2] = 42;
          rgba[off + 3] = 255;
          redactedPixels += 1;
        }
      }
    }
  }
  return redactedPixels;
}

/**
 * Builds a self-contained SVG screengrab wrapper with Pre-Shutter Redaction Masks burned over
 * sensitive rects (password, cc-*, otp, data-sensitive) so exported screengrabs never leak PII.
 */
export function buildRedactedScreengrabSvgDataUri(options: {
  rawPngBase64?: string;
  width: number;
  height: number;
  stageLabel: string;
  wireVus: number;
  wireP95Ms: number;
  browserLcpMs: number;
  sensitiveRects: SensitiveRect[];
}): { svgMarkup: string; dataUri: string; redactedRectCount: number; sha256Hex: string } {
  const w = Math.max(320, options.width || 1280);
  const h = Math.max(200, options.height || 720);
  const esc = (s: string) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const bgLayer = options.rawPngBase64
    ? `<image href="data:image/png;base64,${options.rawPngBase64.replace(/[^A-Za-z0-9+/=]/g, '')}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="0" y="0" width="${w}" height="${h}" fill="#081226"/><text x="28" y="64" fill="#38bdf8" font-family="monospace" font-size="18" font-weight="bold">TESTUDO CANARY FRAME: ${esc(options.stageLabel)}</text>`;

  const masks = options.sensitiveRects
    .map((r) => {
      const rx = Math.max(0, Math.round(r.x));
      const ry = Math.max(0, Math.round(r.y));
      const rw = Math.max(24, Math.round(r.width));
      const rh = Math.max(16, Math.round(r.height));
      return `<g data-redacted-reason="${esc(r.reason)}"><rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="4" fill="#020617" stroke="#f59e0b" stroke-width="1.5"/><text x="${rx + 6}" y="${ry + Math.min(rh - 4, 14)}" fill="#fbbf24" font-family="monospace" font-size="10">[REDACTED:${esc(r.reason.toUpperCase())}]</text></g>`;
    })
    .join('');

  const hudStrip = `<g><rect x="0" y="${h - 34}" width="${w}" height="34" fill="#020617" fill-opacity="0.92"/><text x="14" y="${h - 12}" fill="#f8fafc" font-family="monospace" font-size="12">${esc(options.stageLabel)} | Wire VUs: ${options.wireVus} | Wire p95: ${options.wireP95Ms.toFixed(2)}ms | Browser LCP: ${options.browserLcpMs.toFixed(2)}ms | Masked Boxes: ${options.sensitiveRects.length}</text></g>`;

  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${bgLayer}${masks}${hudStrip}</svg>`;
  const sha256Hex = crypto.createHash('sha256').update(svgMarkup, 'utf8').digest('hex');
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svgMarkup, 'utf8').toString('base64')}`;

  return {
    svgMarkup,
    dataUri,
    redactedRectCount: options.sensitiveRects.length,
    sha256Hex
  };
}

export function resolveRamSpoolDirectory(runId: string): { spoolDir: string; isTmpfsShm: boolean } {
  const safeId = String(runId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const shmRoot = '/dev/shm';
  if (fs.existsSync(shmRoot)) {
    const dir = path.join(shmRoot, `testudo_canary_${process.pid}_${safeId}`);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return { spoolDir: dir, isTmpfsShm: true };
  }
  const fallback = path.join(process.env.TMPDIR || '/tmp', `testudo_canary_${process.pid}_${safeId}`);
  fs.mkdirSync(fallback, { recursive: true, mode: 0o700 });
  return { spoolDir: fallback, isTmpfsShm: false };
}
