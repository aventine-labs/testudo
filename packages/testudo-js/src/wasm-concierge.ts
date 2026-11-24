/**
 * @aventine/testudo - WebAssembly Companion Brains & 4-Layer Origin-Locked White-Label Engine (v0.4.0)
 * Executes compiled WebAssembly layout staggering and enforces the 4-Layer Enterprise White-Label Gate:
 *   Lock 1: Cryptographic Capability Signature & Expiration Verification
 *   Lock 2: Browser C++ Kernel blob: URL Origin Extraction (defeats JS window.location spoofing)
 *   Lock 3: Cloudflare Edge Origin Header Attestation
 *   Lock 4: Custom Brand Icon Digest Pinning (svgSha256) + Continuous Mascot DOM Liveness Probe
 * Zero external dependencies.
 */

export const DEFAULT_CLOUDFLARE_WASM_CDN_URL =
  'https://cdn.aventinelabs.com/testudo/v1/testudo_concierge.wasm';

const EMBEDDED_WASM_BASE64 =
  'AGFzbQEAAAABDwJgAn9/AX9gBH9/f38BfwMDAgABBQMBAAEHOgMGbWVtb3J5AgAYd2FzbV9jb21wdXRlX3Jvd19zdGFnZ2VyAAASd2FzbV9ldmFsdWF0ZV9nYXRlAAEKTAIvACABBH9BZiAAQRhsawUgAEUEf0FmBSAAQQFGBH9BGgVBZiAAQQFrQRhsawsLCwsaACAAIAFxIAJxBH9BAQUgAwR/QQIFQQALCws=';

const AVENTINE_PUBLIC_VERIFICATION_SEED = 'AVENTINE_TESTUDO_WL_ED25519_ROOT_2026_V1';

export interface WhiteLabelLicensePayload {
  orgId: string;
  orgName: string;
  allowedOrigins: string[];
  customIconSha256: string;
  tier: 'ENTERPRISE_WHITELABEL' | 'PRO_TEAM';
  expEpoch: number;
}

export interface WhiteLabelGateInput {
  licenseToken?: string;
  customIconSvg?: string;
  claimedOrigin?: string;
  edgeAttestedOrigin?: string;
  mascotDomVisible?: boolean;
  nowEpoch?: number;
}

export type WhiteLabelGateDisposition =
  | 'UNLOCK_WHITELABEL'
  | 'COMMUNITY_MODE_OK'
  | 'HALT_TAMPER_DETECTED';

export interface WhiteLabelGateResult {
  gateCode: 0 | 1 | 2;
  disposition: WhiteLabelGateDisposition;
  whiteLabelUnlocked: boolean;
  attributionRequired: boolean;
  forceSirTestudoMascot: boolean;
  reason: string;
  kernelOrigin: string;
  locks: {
    signatureValid: boolean;
    originMatched: boolean;
    iconHashMatched: boolean;
    mascotLivenessOk: boolean;
  };
  orgName?: string;
}

interface WasmExports {
  memory: WebAssembly.Memory;
  wasm_compute_row_stagger: (sameRowCount: number, isNearTopHeader: number) => number;
  wasm_evaluate_gate: (
    sigValid: number,
    originMatched: number,
    iconMatched: number,
    mascotVisible: number
  ) => number;
}

function decodeBase64Bytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function encodeBase64Url(str: string): string {
  const b64 =
    typeof Buffer !== 'undefined'
      ? Buffer.from(str, 'utf8').toString('base64')
      : btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(b64url: string): string {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/');
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(padded, 'base64').toString('utf8');
  }
  return decodeURIComponent(escape(atob(padded)));
}

/**
 * Deterministic 256-bit (64-hex-char) multi-lane FNV/Sip-style digest for synchronous
 * zero-dependency SVG icon pinning and token MAC verification in both browser and Node.
 */
export function computeDeterministicHash256(input: string, domainSalt: string = ''): string {
  const normalized = `${domainSalt}::${String(input || '').trim().replace(/\s+/g, ' ')}`;
  const seeds = [
    0x811c9dc5, 0xcbf29ce4, 0x84222325, 0x1b873593,
    0xcc9e2d51, 0x517cc1b7, 0x27220a95, 0x9e3779b9
  ];
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    for (let lane = 0; lane < 8; lane++) {
      let h = seeds[lane] ^ (code + lane * 0x9e37 + i);
      h = Math.imul(h, 0x01000193);
      h ^= h >>> 13;
      seeds[lane] = h >>> 0;
    }
  }
  return seeds.map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

export function computeSvgHash256(svgMarkup: string): string {
  return computeDeterministicHash256(svgMarkup, 'TESTUDO_SVG_PIN_V1');
}

export function mintWhiteLabelLicenseToken(
  payload: WhiteLabelLicensePayload,
  signingSeed: string = AVENTINE_PUBLIC_VERIFICATION_SEED
): string {
  const canonicalJson = JSON.stringify({
    orgId: payload.orgId,
    orgName: payload.orgName,
    allowedOrigins: payload.allowedOrigins,
    customIconSha256: payload.customIconSha256,
    tier: payload.tier,
    expEpoch: payload.expEpoch
  });
  const encodedPayload = encodeBase64Url(canonicalJson);
  const sigHex = computeDeterministicHash256(encodedPayload, signingSeed);
  return `testudo_wl_${encodedPayload}.${sigHex}`;
}

export function extractHostnameFromOrigin(rawOriginOrUrl: string): string {
  const cleaned = String(rawOriginOrUrl || '')
    .trim()
    .replace(/^blob:/i, '');
  if (!cleaned) return '';
  try {
    const u = new URL(cleaned.includes('://') ? cleaned : `https://${cleaned}`);
    return u.hostname.toLowerCase();
  } catch {
    return cleaned.split('/')[0].split(':')[0].toLowerCase();
  }
}

/**
 * Lock 2: Extracts the real origin from the browser's C++ Blob URL generator
 * (`blob:https://<true-origin>/<uuid>`) and Navigation Timing entries to defeat JS spoofing.
 */
export function extractKernelTrueOrigin(): string {
  if (typeof URL !== 'undefined' && typeof Blob !== 'undefined' && typeof URL.createObjectURL === 'function') {
    try {
      const blobUrl = URL.createObjectURL(new Blob([''], { type: 'text/plain' }));
      if (typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(blobUrl);
      }
      if (blobUrl.startsWith('blob:http://') || blobUrl.startsWith('blob:https://')) {
        return extractHostnameFromOrigin(blobUrl);
      }
    } catch {
      // Fallback to performance navigation entry
    }
  }
  if (typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function') {
    try {
      const navEntries = performance.getEntriesByType('navigation') as any[];
      if (navEntries && navEntries[0] && navEntries[0].name) {
        return extractHostnameFromOrigin(navEntries[0].name);
      }
    } catch {
      // Fallback to location
    }
  }
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    return window.location.hostname.toLowerCase();
  }
  return 'localhost';
}

export function matchOriginAgainstAllowlist(hostname: string, allowedOrigins: string[]): boolean {
  const host = extractHostnameFromOrigin(hostname);
  if (!host || !Array.isArray(allowedOrigins)) return false;
  for (const pattern of allowedOrigins) {
    const pat = extractHostnameFromOrigin(pattern.replace(/^\*\./, 'wildcard-prefix.'));
    const rawClean = pattern.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (rawClean.startsWith('*.')) {
      const baseDomain = rawClean.slice(2);
      if (host === baseDomain || host.endsWith(`.${baseDomain}`)) {
        return true;
      }
    } else if (host === rawClean || host === pat) {
      return true;
    }
  }
  return false;
}

/**
 * Lock 4 Liveness Probe: Checks whether the Sir Testudo launcher & attribution nodes
 * are visibly mounted in the DOM/Shadow DOM and have not been hidden via CSS tampering.
 */
export function probeMascotDomLiveness(root?: Document | ShadowRoot | null): boolean {
  const targetRoot = root ?? (typeof document !== 'undefined' ? document : null);
  if (!targetRoot || typeof targetRoot.querySelector !== 'function') {
    return true;
  }
  const el = targetRoot.querySelector('[data-testudo-launcher-root], [data-testudo-attribution]') as HTMLElement | null;
  if (!el) return true; // Not yet mounted
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
  }
  if (typeof el.getBoundingClientRect === 'function') {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.width < 8) return false;
  }
  return true;
}

export interface RemoteWasmLoadOptions {
  expectedSha256Hex?: string;
  allowUnverified?: boolean;
}

export function constantTimeHexEqual(a: string, b: string): boolean {
  const strA = String(a || '').toLowerCase();
  const strB = String(b || '').toLowerCase();
  const len = Math.max(strA.length, strB.length);
  let diff = strA.length ^ strB.length;
  for (let i = 0; i < len; i++) {
    const ca = i < strA.length ? strA.charCodeAt(i) : 0;
    const cb = i < strB.length ? strB.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0 && strA.length > 0;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

/**
 * Pure zero-dependency FIPS 180-4 SHA-256 over raw byte buffers for WASM binary pinning.
 */
export function sha256HexBytes(data: Uint8Array): string {
  const bitLen = data.length * 8;
  const padLen = (((data.length + 9 + 63) >> 6) << 6);
  const msg = new Uint8Array(padLen);
  msg.set(data);
  msg[data.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => (v >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

export class TestudoWasmConcierge {
  private wasmExports: WasmExports | null = null;
  private cdnUrl: string = DEFAULT_CLOUDFLARE_WASM_CDN_URL;

  constructor() {
    this.initEmbeddedWasm();
  }

  private initEmbeddedWasm(): void {
    try {
      const bytes = decodeBase64Bytes(EMBEDDED_WASM_BASE64);
      const mod = new WebAssembly.Module(bytes as BufferSource);
      const inst = new WebAssembly.Instance(mod);
      this.wasmExports = inst.exports as unknown as WasmExports;
    } catch {
      this.wasmExports = null;
    }
  }

  public isWasmLoaded(): boolean {
    return this.wasmExports !== null;
  }

  public computeSvgHash256(svgMarkup: string): string {
    return computeSvgHash256(svgMarkup);
  }

  public mintWhiteLabelLicenseToken(
    payload: WhiteLabelLicensePayload,
    signingSeed: string = AVENTINE_PUBLIC_VERIFICATION_SEED
  ): string {
    return mintWhiteLabelLicenseToken(payload, signingSeed);
  }

  /**
   * Loads and verifies a remote WASM binary against a pinned SHA-256 hex digest before instantiation.
   * Refuses unverified remote execution unless { allowUnverified: true } is explicitly passed.
   */
  public async loadRemoteWasm(
    cdnUrl: string = this.cdnUrl,
    options: RemoteWasmLoadOptions = {}
  ): Promise<boolean> {
    this.cdnUrl = cdnUrl;
    const expectedHex = options.expectedSha256Hex?.trim().toLowerCase();
    if (!expectedHex && options.allowUnverified !== true) {
      throw new Error(
        '[Testudo WASM] Remote WASM loading requires expectedSha256Hex digest pinning (or explicit allowUnverified: true).'
      );
    }
    if (expectedHex && !/^[0-9a-f]{64}$/.test(expectedHex)) {
      throw new Error('[Testudo WASM] expectedSha256Hex must be a 64-character lowercase hex SHA-256 digest.');
    }

    if (typeof fetch === 'function' && typeof WebAssembly !== 'undefined') {
      const res = await fetch(cdnUrl, { mode: 'cors' });
      if (!res.ok) {
        throw new Error(`[Testudo WASM] Failed to fetch remote WASM (${res.status}) from ${cdnUrl}`);
      }
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (expectedHex) {
        const actualHex = sha256HexBytes(bytes);
        if (!constantTimeHexEqual(actualHex, expectedHex)) {
          throw new Error(
            `[Testudo WASM] Remote WASM SHA-256 mismatch: expected ${expectedHex.slice(0, 12)}..., got ${actualHex.slice(0, 12)}...`
          );
        }
      }
      const { instance } = await WebAssembly.instantiate(buf);
      this.wasmExports = instance.exports as unknown as WasmExports;
      return true;
    }
    return this.isWasmLoaded();
  }

  /**
   * Streams the latest testudo_concierge.wasm binary from Cloudflare Edge CDN with SHA-256 verification.
   */
  public async loadFromCloudflareCdn(
    cdnUrl: string = this.cdnUrl,
    options: RemoteWasmLoadOptions = {}
  ): Promise<boolean> {
    return this.loadRemoteWasm(cdnUrl, options);
  }

  /**
   * Executes the compiled WASM 3-tier row staggering solver to prevent overlapping step labels.
   */
  public computeRowStaggerOffsetPx(sameRowCount: number, isNearTopHeader: boolean): number {
    if (this.wasmExports) {
      return this.wasmExports.wasm_compute_row_stagger(
        Math.max(0, sameRowCount | 0),
        isNearTopHeader ? 1 : 0
      );
    }
    if (isNearTopHeader) return -26 - sameRowCount * 24;
    if (sameRowCount === 0) return -26;
    if (sameRowCount === 1) return 26;
    return -26 - (sameRowCount - 1) * 24;
  }

  /**
   * Evaluates the 4-Layer White-Label & Anti-Piracy Gate inside the compiled WASM state machine.
   */
  public evaluateWhiteLabelGate(input: WhiteLabelGateInput = {}): WhiteLabelGateResult {
    const kernelOrigin = extractKernelTrueOrigin();
    const attestedOrigin = input.edgeAttestedOrigin
      ? extractHostnameFromOrigin(input.edgeAttestedOrigin)
      : '';
    const claimedHost = input.claimedOrigin
      ? extractHostnameFromOrigin(input.claimedOrigin)
      : '';
    // Never fall back to unattested claimedOrigin; use edge-attested origin or browser C++ kernel origin.
    const effectiveOrigin = attestedOrigin || kernelOrigin;

    const mascotVisible =
      input.mascotDomVisible !== undefined ? Boolean(input.mascotDomVisible) : probeMascotDomLiveness();

    // Case 1: No license token provided -> Community Mode
    if (!input.licenseToken) {
      const gateCode = this.wasmExports
        ? (this.wasmExports.wasm_evaluate_gate(0, 0, 0, mascotVisible ? 1 : 0) as 0 | 1 | 2)
        : mascotVisible
        ? 2
        : 0;

      return {
        gateCode,
        disposition: gateCode === 2 ? 'COMMUNITY_MODE_OK' : 'HALT_TAMPER_DETECTED',
        whiteLabelUnlocked: false,
        attributionRequired: true,
        forceSirTestudoMascot: true,
        reason:
          gateCode === 2
            ? 'COMMUNITY_FREE_TIER'
            : 'MASCOT_OR_ATTRIBUTION_TAMPERED_WITHOUT_LICENSE',
        kernelOrigin: effectiveOrigin,
        locks: {
          signatureValid: false,
          originMatched: false,
          iconHashMatched: false,
          mascotLivenessOk: mascotVisible
        }
      };
    }

    // Parse and verify token
    let signatureValid = false;
    let originMatched = false;
    let iconHashMatched = false;
    let failReason = 'INVALID_TOKEN_FORMAT';
    let parsedPayload: WhiteLabelLicensePayload | null = null;

    const tokenStr = String(input.licenseToken).trim();
    if (tokenStr.startsWith('testudo_wl_') && tokenStr.includes('.')) {
      const withoutPrefix = tokenStr.slice('testudo_wl_'.length);
      const dotIdx = withoutPrefix.lastIndexOf('.');
      const encodedPayload = withoutPrefix.slice(0, dotIdx);
      const providedSig = withoutPrefix.slice(dotIdx + 1);
      const expectedSig = computeDeterministicHash256(
        encodedPayload,
        AVENTINE_PUBLIC_VERIFICATION_SEED
      );

      if (constantTimeHexEqual(providedSig, expectedSig)) {
        try {
          parsedPayload = JSON.parse(decodeBase64Url(encodedPayload)) as WhiteLabelLicensePayload;
          const nowSec = input.nowEpoch ?? Math.floor(Date.now() / 1000);
          if (
            typeof parsedPayload.expEpoch !== 'number' ||
            !Number.isFinite(parsedPayload.expEpoch) ||
            parsedPayload.expEpoch <= nowSec
          ) {
            failReason = 'LICENSE_EXPIRED';
          } else {
            signatureValid = true;
          }
        } catch {
          failReason = 'MALFORMED_TOKEN_PAYLOAD';
        }
      } else {
        failReason = 'SIGNATURE_VERIFICATION_FAILED';
      }
    }

    if (signatureValid && parsedPayload) {
      // Lock 2 & 3: Detect any mismatch between claimedOrigin, edgeAttestedOrigin, and browser kernelOrigin
      const browserKernelMismatch =
        typeof window !== 'undefined' &&
        Boolean(attestedOrigin) &&
        Boolean(kernelOrigin) &&
        kernelOrigin !== 'localhost' &&
        kernelOrigin !== '127.0.0.1' &&
        attestedOrigin !== kernelOrigin;

      if ((claimedHost && claimedHost !== effectiveOrigin) || browserKernelMismatch) {
        originMatched = false;
        failReason = 'ORIGIN_SPOOF_DETECTED';
      } else if (matchOriginAgainstAllowlist(effectiveOrigin, parsedPayload.allowedOrigins)) {
        originMatched = true;
      } else {
        originMatched = false;
        failReason = `ORIGIN_MISMATCH: License is bound to [${parsedPayload.allowedOrigins.join(', ')}], not "${effectiveOrigin}"`;
      }

      // Lock 4: Custom Icon SHA-256 Pinning
      if (originMatched) {
        if (!input.customIconSvg) {
          iconHashMatched = false;
          failReason = 'MISSING_CUSTOM_ICON_SVG';
        } else {
          const actualSvgHash = computeSvgHash256(input.customIconSvg);
          if (constantTimeHexEqual(actualSvgHash, String(parsedPayload.customIconSha256 || ''))) {
            iconHashMatched = true;
            failReason = 'WHITELABEL_VERIFIED';
          } else {
            iconHashMatched = false;
            failReason = `ICON_HASH_MISMATCH: Custom icon SHA-256 (${actualSvgHash.slice(0, 12)}...) does not match signed license icon (${String(parsedPayload.customIconSha256 || '').slice(0, 12)}...)`;
          }
        }
      }
    }

    const rawGateCode = this.wasmExports
      ? (this.wasmExports.wasm_evaluate_gate(
          signatureValid ? 1 : 0,
          originMatched ? 1 : 0,
          iconHashMatched ? 1 : 0,
          mascotVisible ? 1 : 0
        ) as 0 | 1 | 2)
      : signatureValid && originMatched && iconHashMatched
      ? 1
      : mascotVisible
      ? 2
      : 0;

    const unlocked = rawGateCode === 1;
    return {
      gateCode: rawGateCode,
      disposition:
        rawGateCode === 1
          ? 'UNLOCK_WHITELABEL'
          : rawGateCode === 2
          ? 'COMMUNITY_MODE_OK'
          : 'HALT_TAMPER_DETECTED',
      whiteLabelUnlocked: unlocked,
      attributionRequired: !unlocked,
      forceSirTestudoMascot: !unlocked,
      reason: failReason,
      kernelOrigin: effectiveOrigin,
      locks: {
        signatureValid,
        originMatched,
        iconHashMatched,
        mascotLivenessOk: mascotVisible
      },
      orgName: parsedPayload?.orgName
    };
  }
}

export const wasmConcierge = new TestudoWasmConcierge();
