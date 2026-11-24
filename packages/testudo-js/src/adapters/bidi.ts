/**
 * @aventine/testudo - Native Zero-Dependency W3C WebDriver BiDi Control Plane (@aventine/testudo/bidi)
 *
 * Extends SPEC-TESTUDO-DEEP-SPIDER-55 privileged browser instrumentation to stock Mozilla Firefox
 * (Gecko + Fission Site Isolation) via W3C WebDriver BiDi (SPEC-TESTUDO-FIREFOX-BIDI-58 / AL-DEV-490):
 *   1. Zero-Geckodriver Direct BiDi WebSocket (ws://127.0.0.1:<port>/session) + Unified Loopback
 *      Marionette CTAP2/FIDO2 Virtual Authenticator Channel.
 *   2. Split-World Security Enclave via BiDi Sandbox Realms (sandbox: 'TestudoEnclave').
 *   3. Surgical Closed & Open Shadow DOM Piercing (>>>) via serializationOptions.includeShadowTree = 'all'.
 *   4. Cross-Process Gecko Fission OOPIF Context Tree Multiplexer (browsingContext.getTree).
 *   5. Hardware-Equivalent Trusted Input (input.performActions -> event.isTrusted === true & userActivation).
 *   6. Pillar-1 Zero-Plaintext Live Wire Capture (network.*) & Out-of-Process Fault Interception
 *      (network.addIntercept + network.provideResponse) keeping window.fetch 100% [native code].
 *   7. Full-Stack React/Vue/Angular Fiber + Closed Shadow + Fission Frame X-Ray ($T.xray).
 *
 * Zero external dependencies. Uses strictly Node.js built-in modules.
 * Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { spawn, ChildProcess } from 'node:child_process';
import type { Duplex } from 'node:stream';
import type { WorkflowStep, WorkflowReport, WorkflowRunOptions } from '../workflow.js';
import type {
  KineticScrollOptions,
  KineticScrollResult,
  ThinkPauseOptions,
  ExpandAllOptions
} from '../kinetic.js';
import { scrubHeadersZeroPlaintext } from '../security-enclave.js';
import type { TestudoWireInterceptor } from '../intercept.js';
import type { ElementXrayReport, ShadowBoundaryHop } from '../xray.js';
import {
  TestudoAssistiveBridge,
  getTestudoIifeSource,
  DEFAULT_ASSISTIVE_BRIDGE_PORT,
  MAX_WS_PAYLOAD_BYTES,
  type ChallengeDetectionResult,
  type ConciergeScreenSnapshot,
  type ChildOopifSessionInfo,
  type ObservedCookieSummary,
  type LiveWireRequestRecord,
  type LiveWireCaptureReport,
  type SpiderLayerNode,
  type FullBrowserXrayReport,
  type VirtualAuthenticatorOptions,
  type BrowserTierFailureReport
} from './cdp.js';

export {
  TestudoAssistiveBridge,
  type ChallengeDetectionResult,
  type ConciergeScreenSnapshot,
  type ChildOopifSessionInfo,
  type ObservedCookieSummary,
  type LiveWireRequestRecord,
  type LiveWireCaptureReport,
  type SpiderLayerNode,
  type FullBrowserXrayReport,
  type VirtualAuthenticatorOptions,
  type BrowserTierFailureReport
};

export const DEFAULT_BIDI_PORT = 9222;

const DANGEROUS_FIREFOX_FLAG_PREFIXES = [
  '--remote-allow-origins',
  '--remote-allow-hosts',
  '--remote-debugging-address=0.0.0.0',
  '-remote-allow-origins',
  '-remote-allow-hosts'
];

function writeFileAtomicSync(targetPath: string, data: Buffer): void {
  const resolved = path.resolve(targetPath);
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${resolved}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, resolved);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

// ============================================================================
// Minimal RFC 6455 WebSocket Client for W3C WebDriver BiDi
// ============================================================================

function encodeWsClientFrame(payload: string | Buffer, opcode: number = 0x01): Buffer {
  const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const len = data.length;
  let headerLen = 2;
  if (len >= 126 && len < 65536) {
    headerLen = 4;
  } else if (len >= 65536) {
    headerLen = 10;
  }
  const totalHeaderLen = headerLen + 4;
  const frame = Buffer.allocUnsafe(totalHeaderLen + len);
  frame[0] = 0x80 | (opcode & 0x0f);
  if (len < 126) {
    frame[1] = 0x80 | len;
  } else if (len < 65536) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(len, 2);
  } else {
    frame[1] = 0x80 | 127;
    frame.writeBigUInt64BE(BigInt(len), 2);
  }
  const maskKey = crypto.randomBytes(4);
  maskKey.copy(frame, headerLen);
  for (let i = 0; i < len; i++) {
    frame[totalHeaderLen + i] = data[i] ^ maskKey[i & 3];
  }
  return frame;
}

class BidiWsConnection extends EventEmitter {
  private socket: Duplex;
  private rxBuffer: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentBytes: number = 0;
  public closed: boolean = false;

  constructor(socket: Duplex) {
    super();
    this.socket = socket;
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('close', () => {
      if (!this.closed) {
        this.closed = true;
        this.emit('close');
      }
    });
    socket.on('error', (err) => this.emit('error', err));
  }

  public send(text: string): void {
    if (this.closed) {
      throw new Error('[Testudo BiDi WS] Cannot send on a closed WebSocket connection.');
    }
    this.socket.write(encodeWsClientFrame(text, 0x01));
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.write(encodeWsClientFrame(Buffer.alloc(0), 0x08));
    } catch {
      // ignore
    }
    try {
      this.socket.destroy();
    } catch {
      // ignore
    }
    this.emit('close');
  }

  private onData(chunk: Buffer): void {
    if (this.rxBuffer.length + chunk.length > MAX_WS_PAYLOAD_BYTES + 64) {
      this.close();
      return;
    }
    this.rxBuffer = this.rxBuffer.length === 0 ? chunk : Buffer.concat([this.rxBuffer, chunk]);

    while (this.rxBuffer.length >= 2) {
      const byte0 = this.rxBuffer[0];
      const byte1 = this.rxBuffer[1];
      const fin = (byte0 & 0x80) !== 0;
      const opcode = byte0 & 0x0f;
      const masked = (byte1 & 0x80) !== 0;
      let payloadLen = byte1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.rxBuffer.length < 4) return;
        payloadLen = this.rxBuffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.rxBuffer.length < 10) return;
        const bigLen = this.rxBuffer.readBigUInt64BE(2);
        if (bigLen > BigInt(MAX_WS_PAYLOAD_BYTES)) {
          this.close();
          return;
        }
        payloadLen = Number(bigLen);
        offset = 10;
      }

      if (payloadLen > MAX_WS_PAYLOAD_BYTES) {
        this.close();
        return;
      }

      const maskLen = masked ? 4 : 0;
      const totalFrameLen = offset + maskLen + payloadLen;
      if (this.rxBuffer.length < totalFrameLen) {
        return;
      }

      let payload = this.rxBuffer.subarray(offset + maskLen, totalFrameLen);
      if (masked) {
        const maskKey = this.rxBuffer.subarray(offset, offset + 4);
        const unmasked = Buffer.allocUnsafe(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          unmasked[i] = payload[i] ^ maskKey[i & 3];
        }
        payload = unmasked;
      } else {
        payload = Buffer.from(payload);
      }

      this.rxBuffer = this.rxBuffer.subarray(totalFrameLen);

      if (opcode === 0x08) {
        this.close();
        return;
      } else if (opcode === 0x09) {
        if (!this.closed) {
          this.socket.write(encodeWsClientFrame(payload, 0x0a));
        }
      } else if (opcode === 0x01 || opcode === 0x02 || opcode === 0x00) {
        if (this.fragmentBytes + payload.length > MAX_WS_PAYLOAD_BYTES) {
          this.fragments = [];
          this.fragmentBytes = 0;
          this.close();
          return;
        }
        this.fragments.push(payload);
        this.fragmentBytes += payload.length;
        if (fin) {
          const full = this.fragments.length === 1 ? this.fragments[0] : Buffer.concat(this.fragments);
          this.fragments = [];
          this.fragmentBytes = 0;
          this.emit('message', full.toString('utf8'));
        }
      }
    }
  }
}

async function connectBidiWebSocket(wsUrl: string, timeoutMs: number = 10000): Promise<BidiWsConnection> {
  const parsed = new URL(wsUrl);
  const key = crypto.randomBytes(16).toString('base64');

  return new Promise<BidiWsConnection>((resolve, reject) => {
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`[Testudo BiDi] WebSocket upgrade timed out after ${timeoutMs}ms: ${wsUrl}`));
    }, timeoutMs);

    const req = http.request({
      hostname: parsed.hostname || '127.0.0.1',
      port: Number(parsed.port || 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13'
      }
    });

    req.on('upgrade', (_res, socket, head) => {
      clearTimeout(timer);
      const conn = new BidiWsConnection(socket);
      if (head && head.length > 0) {
        socket.emit('data', head);
      }
      resolve(conn);
    });

    req.on('response', (res) => {
      clearTimeout(timer);
      reject(new Error(`[Testudo BiDi] Unexpected HTTP ${res.statusCode} upgrading ${wsUrl}`));
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    req.end();
  });
}

// ============================================================================
// Unified Loopback Marionette Channel (Zero-Geckodriver W3C CTAP2 WebAuthn)
// ============================================================================

class MarionetteLoopbackClient {
  private socket: net.Socket;
  private rxBuf: Buffer = Buffer.alloc(0);
  private waiters: Array<{ resolve: (msg: any) => void; reject: (err: Error) => void }> = [];
  private nextMsgId: number = 1;
  private closed: boolean = false;

  private constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('close', () => {
      this.closed = true;
      while (this.waiters.length > 0) {
        const w = this.waiters.shift();
        w?.reject(new Error('[Testudo Marionette] Socket closed'));
      }
    });
    socket.on('error', () => {
      // handled on close or pending waiter
    });
  }

  public static async connectAndCreateUnifiedSession(
    port: number,
    timeoutMs: number = 10000
  ): Promise<{ client: MarionetteLoopbackClient; webSocketUrl: string; sessionId: string }> {
    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.createConnection({ host: '127.0.0.1', port });
      const timer = setTimeout(() => {
        s.destroy();
        reject(new Error(`[Testudo Marionette] Connection timed out on 127.0.0.1:${port}`));
      }, timeoutMs);
      s.once('connect', () => {
        clearTimeout(timer);
        resolve(s);
      });
      s.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const client = new MarionetteLoopbackClient(socket);
    // Initial server greeting: {"applicationType":"gecko","marionetteProtocol":3}
    await client.shiftMessage(timeoutMs);
    const sessionRes = await client.sendCommand('WebDriver:NewSession', { webSocketUrl: true }, timeoutMs);
    const sessionId = String(sessionRes?.sessionId || '');
    const webSocketUrl = String(sessionRes?.capabilities?.webSocketUrl || '');
    if (!webSocketUrl) {
      client.close();
      throw new Error('[Testudo Marionette] Unified WebDriver:NewSession did not return capabilities.webSocketUrl');
    }
    return { client, webSocketUrl, sessionId };
  }

  private onData(chunk: Buffer): void {
    this.rxBuf = this.rxBuf.length === 0 ? chunk : Buffer.concat([this.rxBuf, chunk]);
    this.drainFrames();
  }

  private drainFrames(): void {
    while (this.rxBuf.length > 0 && this.waiters.length > 0) {
      const colonIdx = this.rxBuf.indexOf(0x3a);
      if (colonIdx === -1) return;
      const lenStr = this.rxBuf.subarray(0, colonIdx).toString('ascii');
      const byteLen = Number(lenStr);
      if (!Number.isFinite(byteLen) || byteLen < 0) {
        this.close();
        return;
      }
      const totalNeeded = colonIdx + 1 + byteLen;
      if (this.rxBuf.length < totalNeeded) return;
      const jsonStr = this.rxBuf.subarray(colonIdx + 1, totalNeeded).toString('utf8');
      this.rxBuf = this.rxBuf.subarray(totalNeeded);
      const waiter = this.waiters.shift();
      if (waiter) {
        try {
          waiter.resolve(JSON.parse(jsonStr));
        } catch (err: any) {
          waiter.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    }
  }

  private shiftMessage(timeoutMs: number): Promise<any> {
    if (this.closed) {
      return Promise.reject(new Error('[Testudo Marionette] Client is closed'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`[Testudo Marionette] Timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.push({
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });
      this.drainFrames();
    });
  }

  public async sendCommand(method: string, params: Record<string, any> = {}, timeoutMs: number = 10000): Promise<any> {
    const id = this.nextMsgId++;
    const payload = JSON.stringify([0, id, method, params]);
    const framed = `${Buffer.byteLength(payload, 'utf8')}:${payload}`;
    this.socket.write(framed);
    const reply = await this.shiftMessage(timeoutMs);
    if (Array.isArray(reply)) {
      const [, , errObj, resObj] = reply;
      if (errObj) {
        throw new Error(`[Testudo Marionette ${errObj.error || 'Error'}] ${errObj.message || JSON.stringify(errObj)}`);
      }
      return resObj;
    }
    return reply;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.destroy();
    } catch {
      // ignore
    }
  }
}

// ============================================================================
// W3C WebDriver BiDi Value Serialization & Deserialization Helpers
// ============================================================================

export function serializeBidiArgument(val: any): any {
  if (val === undefined) return { type: 'undefined' };
  if (val === null) return { type: 'null' };
  if (typeof val === 'boolean') return { type: 'boolean', value: val };
  if (typeof val === 'number') {
    if (Number.isNaN(val)) return { type: 'number', value: 'NaN' };
    if (Object.is(val, -0)) return { type: 'number', value: '-0' };
    if (val === Infinity) return { type: 'number', value: 'Infinity' };
    if (val === -Infinity) return { type: 'number', value: '-Infinity' };
    return { type: 'number', value: val };
  }
  if (typeof val === 'bigint') return { type: 'bigint', value: val.toString() };
  if (typeof val === 'string') return { type: 'string', value: val };
  if (Array.isArray(val)) {
    return { type: 'array', value: val.map((item) => serializeBidiArgument(item)) };
  }
  if (typeof val === 'object') {
    if (typeof val.sharedId === 'string' && Object.keys(val).length === 1) {
      return { sharedId: val.sharedId };
    }
    const entries = Object.entries(val).map(([k, v]) => [k, serializeBidiArgument(v)]);
    return { type: 'object', value: entries };
  }
  return { type: 'string', value: String(val) };
}

export function deserializeBidiValue(remote: any): any {
  if (!remote || typeof remote !== 'object') return remote;
  const t = remote.type;
  switch (t) {
    case 'undefined':
      return undefined;
    case 'null':
      return null;
    case 'boolean':
      return Boolean(remote.value);
    case 'string':
      return String(remote.value ?? '');
    case 'number': {
      const v = remote.value;
      if (v === 'NaN') return NaN;
      if (v === '-0') return -0;
      if (v === 'Infinity') return Infinity;
      if (v === '-Infinity') return -Infinity;
      return Number(v);
    }
    case 'bigint':
      return BigInt(remote.value);
    case 'array':
    case 'set':
      return Array.isArray(remote.value) ? remote.value.map((item: any) => deserializeBidiValue(item)) : [];
    case 'object':
    case 'map': {
      const out: Record<string, any> = {};
      if (Array.isArray(remote.value)) {
        for (const pair of remote.value) {
          if (Array.isArray(pair) && pair.length === 2) {
            const rawKey = pair[0];
            const key = typeof rawKey === 'string' ? rawKey : String(deserializeBidiValue(rawKey));
            out[key] = deserializeBidiValue(pair[1]);
          }
        }
      }
      return out;
    }
    case 'date':
      return String(remote.value ?? '');
    case 'regexp':
      return new RegExp(remote.value?.pattern || '', remote.value?.flags || '');
    default:
      return remote;
  }
}

// ============================================================================
// Firefox Executable Discovery & Options
// ============================================================================

export interface BidiConnectOptions {
  host?: string;
  port?: number;
  wsUrl?: string;
  targetUrlPattern?: string;
  contextId?: string;
  url?: string;
  newWindow?: boolean;
  reloadOnAttach?: boolean;
  autoInjectTestudo?: boolean;
}

export interface FirefoxHeadlessLaunchOptions {
  executablePath?: string;
  url?: string;
  width?: number;
  height?: number;
  extraArgs?: string[];
  autoInjectTestudo?: boolean;
  extraPrefs?: Record<string, string | number | boolean>;
}

export interface BidiFailoverConnectOptions extends BidiConnectOptions {
  bridgePort?: number;
  bridgeAuthToken?: string;
  bidiPort?: number;
  allowPlaywrightFallback?: boolean;
  executablePath?: string;
  onTierFailure?: (failure: BrowserTierFailureReport, message: string) => void;
}

export interface BidiFailoverConnectResult {
  activeTier: 1 | 2 | 3;
  driver: 'testudo-assistive-bridge' | 'native-webdriver-bidi' | 'playwright-emergency-fallback';
  bridge?: TestudoAssistiveBridge;
  attachedTabId?: number;
  session?: TestudoBidiSession;
  playwrightBrowser?: any;
  playwrightPage?: any;
  failures: BrowserTierFailureReport[];
  close: () => Promise<void>;
}

export interface BidiContextInfo {
  context: string;
  url: string;
  parent?: string | null;
  children?: BidiContextInfo[];
}

export interface FullBidiXrayReport extends FullBrowserXrayReport {
  bidiContextId?: string;
}

/**
 * Resolves a local stock Mozilla Firefox executable on Linux/macOS for zero-dependency headless BiDi execution.
 */
export function resolveLocalFirefoxExecutable(explicitPath?: string): string {
  if (explicitPath && fs.existsSync(explicitPath)) {
    return explicitPath;
  }
  if (process.env.FIREFOX_BIN && fs.existsSync(process.env.FIREFOX_BIN)) {
    return process.env.FIREFOX_BIN;
  }
  if (process.env.FIREFOX_PATH && fs.existsSync(process.env.FIREFOX_PATH)) {
    return process.env.FIREFOX_PATH;
  }

  const cachedCandidates = [
    path.join(os.homedir(), '.cache/testudo-browsers/firefox/firefox'),
    path.join(os.homedir(), '.cache/puppeteer/firefox/firefox')
  ];
  for (const c of cachedCandidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  // Check Playwright Firefox cache if present
  const pwRoot = path.join(os.homedir(), '.cache/ms-playwright');
  if (fs.existsSync(pwRoot)) {
    try {
      const dirs = fs
        .readdirSync(pwRoot)
        .filter((d) => d.startsWith('firefox-'))
        .sort()
        .reverse();
      for (const d of dirs) {
        const bin = path.join(pwRoot, d, 'firefox/firefox');
        if (fs.existsSync(bin)) return bin;
      }
    } catch {
      // ignore
    }
  }

  const systemCandidates = [
    '/usr/bin/firefox',
    '/usr/local/bin/firefox',
    '/opt/firefox/firefox',
    '/snap/bin/firefox',
    '/Applications/Firefox.app/Contents/MacOS/firefox'
  ];
  for (const candidate of systemCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    '[Testudo BiDi] Could not locate a local Firefox binary. Set FIREFOX_BIN or install Firefox in ~/.cache/testudo-browsers/firefox.'
  );
}

// ============================================================================
// TestudoBidiSession (Native W3C WebDriver BiDi Driver)
// ============================================================================

export class TestudoBidiSession extends EventEmitter {
  private ws: BidiWsConnection;
  public readonly contextId: string;
  public readonly ownsTarget: boolean;
  public readonly wsUrl: string;
  private childProcess?: ChildProcess;
  private userDataDir?: string;
  private marionetteClient?: MarionetteLoopbackClient;
  private autoInjectTestudo: boolean;
  private nextCommandId: number = 1;
  private pendingCommands: Map<
    number,
    { resolve: (val: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  > = new Map();
  private preloadScriptIds: string[] = [];
  private enclaveProbeSource: string = '';
  private liveWireRequests: Map<string, LiveWireRequestRecord> = new Map();
  private liveWireEnabled: boolean = false;
  private activeInterceptIds: string[] = [];
  private activeAuthenticatorId?: string;
  private activeAuthenticatorBackend?: 'bidi-webauthn' | 'marionette-ctap2';
  private childContexts: Map<string, ChildOopifSessionInfo> = new Map();
  private closed: boolean = false;

  constructor(params: {
    ws: BidiWsConnection;
    contextId: string;
    ownsTarget: boolean;
    wsUrl: string;
    childProcess?: ChildProcess;
    userDataDir?: string;
    marionetteClient?: MarionetteLoopbackClient;
    autoInjectTestudo?: boolean;
  }) {
    super();
    this.ws = params.ws;
    this.contextId = params.contextId;
    this.ownsTarget = params.ownsTarget;
    this.wsUrl = params.wsUrl;
    this.childProcess = params.childProcess;
    this.userDataDir = params.userDataDir;
    this.marionetteClient = params.marionetteClient;
    this.autoInjectTestudo = params.autoInjectTestudo ?? true;

    this.ws.on('message', (raw: string) => this.handleMessage(raw));
    this.ws.on('close', () => {
      this.closed = true;
      for (const [, pending] of this.pendingCommands) {
        clearTimeout(pending.timer);
        pending.reject(new Error('[Testudo BiDi] WebSocket connection closed'));
      }
      this.pendingCommands.clear();
      this.childContexts.clear();
    });
  }

  private handleMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (typeof msg.id === 'number') {
      const pending = this.pendingCommands.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingCommands.delete(msg.id);
        if (msg.type === 'error' || msg.error) {
          const errName = msg.error || 'bidi_error';
          const errMsg = msg.message || JSON.stringify(msg);
          pending.reject(new Error(`[BiDi Error ${errName}] ${errMsg}`));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    if (msg.type === 'event' && typeof msg.method === 'string') {
      const params = msg.params || {};
      if (msg.method === 'browsingContext.contextCreated' && params.context) {
        const ctxId = String(params.context);
        if (params.parent && ctxId !== this.contextId) {
          this.childContexts.set(ctxId, {
            sessionId: ctxId,
            targetId: ctxId,
            type: 'iframe',
            title: '',
            url: String(params.url || '')
          });
        }
      } else if (msg.method === 'browsingContext.contextDestroyed' && params.context) {
        this.childContexts.delete(String(params.context));
      } else if (
        (msg.method === 'browsingContext.domContentLoaded' || msg.method === 'browsingContext.load') &&
        params.context
      ) {
        const ctxId = String(params.context);
        if (ctxId !== this.contextId && this.childContexts.has(ctxId)) {
          const cur = this.childContexts.get(ctxId)!;
          cur.url = String(params.url || cur.url);
        }
      }

      this.emit(msg.method, params);
    }
  }

  public async send<T = any>(
    method: string,
    params: Record<string, any> = {},
    timeoutMs: number = 30000
  ): Promise<T> {
    if (this.closed) {
      throw new Error(`[Testudo BiDi] Cannot send ${method}: session is closed.`);
    }
    const id = this.nextCommandId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error(`[Testudo BiDi] Command ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingCommands.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Subscribes to core browsingContext events and registers dist/testudo.iife.js as a BiDi preload script
   * across all root and Fission child iframe contexts.
   */
  public async initializeTestudo(options: { reload?: boolean } = {}): Promise<void> {
    await this.send('session.subscribe', {
      events: [
        'browsingContext.contextCreated',
        'browsingContext.contextDestroyed',
        'browsingContext.domContentLoaded',
        'browsingContext.load'
      ]
    }).catch(() => {});

    await this.refreshChildContextsFromTree();

    if (!this.autoInjectTestudo) {
      return;
    }

    const iifeSource = getTestudoIifeSource();
    const preload = await this.send<{ script: string }>('script.addPreloadScript', {
      functionDeclaration: `function() { if (!window.$T) { ${iifeSource} } }`
    }).catch(() => null);
    if (preload?.script) {
      this.preloadScriptIds.push(preload.script);
    }

    if (options.reload) {
      await this.reloadAndInject();
    } else {
      await this.injectTestudo();
    }
  }

  private static flattenBidiContexts(
    list: BidiContextInfo[] | undefined,
    parentId?: string,
    acc: Array<{ context: string; parentId?: string; url: string }> = []
  ): Array<{ context: string; parentId?: string; url: string }> {
    if (!Array.isArray(list)) return acc;
    for (const item of list) {
      if (!item || !item.context) continue;
      const pId = item.parent ?? parentId;
      acc.push({
        context: String(item.context),
        parentId: pId ? String(pId) : undefined,
        url: String(item.url || '')
      });
      if (Array.isArray(item.children) && item.children.length > 0) {
        TestudoBidiSession.flattenBidiContexts(item.children, String(item.context), acc);
      }
    }
    return acc;
  }

  private async refreshChildContextsFromTree(): Promise<Array<{ context: string; parentId?: string; url: string }>> {
    const tree = await this.send<{ contexts: BidiContextInfo[] }>('browsingContext.getTree', {
      root: this.contextId
    }).catch(() => ({ contexts: [] }));
    const flat = TestudoBidiSession.flattenBidiContexts(tree?.contexts);
    for (const node of flat) {
      if (node.context !== this.contextId) {
        this.childContexts.set(node.context, {
          sessionId: node.context,
          targetId: node.context,
          type: 'iframe',
          title: '',
          url: node.url
        });
      }
    }
    return flat;
  }

  /**
   * Injects dist/testudo.iife.js into the specified BiDi browsingContext without reloading.
   */
  public async injectTestudo(targetContextId?: string): Promise<boolean> {
    const ctx = targetContextId || this.contextId;
    const iifeSource = getTestudoIifeSource();
    await this.send(
      'script.evaluate',
      {
        target: { context: ctx },
        expression: `if (!window.$T) { ${iifeSource} }`,
        awaitPromise: false,
        resultOwnership: 'none'
      },
      15000
    );
    const hasT = await this.evaluateInContext<boolean>(ctx, () => Boolean((window as any).$T));
    return Boolean(hasT);
  }

  /**
   * Reloads the current page and ensures window.$T is initialized.
   */
  public async reloadAndInject(timeoutMs: number = 20000): Promise<boolean> {
    await this.send(
      'browsingContext.reload',
      { context: this.contextId, wait: 'complete' },
      timeoutMs
    );
    await this.refreshChildContextsFromTree();
    return this.injectTestudo();
  }

  /**
   * Navigates the browsingContext to url and injects Testudo-JS once loaded.
   */
  public async goto(url: string, options: { timeoutMs?: number } = {}): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 20000;
    await this.send(
      'browsingContext.navigate',
      { context: this.contextId, url, wait: 'complete' },
      timeoutMs
    );
    await this.refreshChildContextsFromTree();
    if (this.autoInjectTestudo) {
      await this.injectTestudo();
    }
  }

  /**
   * Sets the full HTML content of the page and injects Testudo-JS.
   */
  public async setContent(html: string): Promise<void> {
    await this.evaluate((markup: string) => {
      document.open();
      document.write(markup);
      document.close();
    }, html);
    await new Promise((r) => setTimeout(r, 15));
    if (this.autoInjectTestudo) {
      await this.injectTestudo();
    }
  }

  private async evaluateInContext<T = any>(
    contextId: string,
    fnOrExpression: string | ((...args: any[]) => T | Promise<T>),
    sandbox?: string,
    ...args: any[]
  ): Promise<T> {
    const target: Record<string, any> = { context: contextId };
    if (sandbox) target.sandbox = sandbox;

    let res: any;
    if (typeof fnOrExpression === 'function') {
      res = await this.send(
        'script.callFunction',
        {
          target,
          functionDeclaration: fnOrExpression.toString(),
          arguments: args.map((a) => serializeBidiArgument(a)),
          awaitPromise: true,
          resultOwnership: 'none',
          serializationOptions: { maxObjectDepth: 20 }
        },
        30000
      );
    } else {
      res = await this.send(
        'script.evaluate',
        {
          target,
          expression: String(fnOrExpression),
          awaitPromise: true,
          resultOwnership: 'none',
          serializationOptions: { maxObjectDepth: 20 }
        },
        30000
      );
    }

    if (res?.type === 'exception' || res?.exceptionDetails) {
      const desc = res?.exceptionDetails?.text || JSON.stringify(res?.exceptionDetails || res);
      throw new Error(`[Testudo BiDi Evaluate Error] ${desc}`);
    }

    return deserializeBidiValue(res?.result) as T;
  }

  /**
   * Evaluates a function or JS expression inside the root Firefox browsingContext.
   */
  public async evaluate<T = any>(
    fnOrExpression: string | ((...args: any[]) => T | Promise<T>),
    ...args: any[]
  ): Promise<T> {
    return this.evaluateInContext<T>(this.contextId, fnOrExpression, undefined, ...args);
  }

  /**
   * Evaluates a function or JS expression inside the isolated BiDi Sandbox Enclave ('TestudoEnclave').
   */
  public async evaluateInEnclave<T = any>(
    fnOrExpression: string | ((...args: any[]) => T | Promise<T>),
    ...args: any[]
  ): Promise<T> {
    return this.evaluateInContext<T>(this.contextId, fnOrExpression, 'TestudoEnclave', ...args);
  }

  /**
   * Polls a predicate inside the page until truthy or timeout.
   */
  public async waitForFunction(
    fnOrExpression: string | ((...args: any[]) => any),
    options: { timeout?: number; polling?: number } = {},
    ...args: any[]
  ): Promise<void> {
    const timeoutMs = options.timeout ?? 5000;
    const intervalMs = options.polling ?? 40;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await this.evaluate(fnOrExpression, ...args);
        if (res) return;
      } catch {
        // retry while loading
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`[Testudo BiDi] waitForFunction timed out after ${timeoutMs}ms`);
  }

  public async waitForSelector(selector: string, options: { timeout?: number } = {}): Promise<void> {
    await this.waitForFunction(
      (sel: string) => Boolean(document.querySelector(sel)),
      { timeout: options.timeout ?? 5000 },
      selector
    );
  }

  public async $eval<T = any>(
    selector: string,
    pageFunction: (el: Element, ...args: any[]) => T | Promise<T>,
    ...args: any[]
  ): Promise<T> {
    const fnStr = pageFunction.toString();
    return this.evaluate(
      async (sel: string, serializedFn: string, extraArgs: any[]) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`[Testudo BiDi] $eval failed: selector "${sel}" not found`);
        const fn = new Function('return (' + serializedFn + ')')();
        return await fn(el, ...extraArgs);
      },
      selector,
      fnStr,
      args
    );
  }

  public async addScriptTag(options: { url?: string; path?: string; content?: string }): Promise<void> {
    if (options.path) {
      const code = fs.readFileSync(options.path, 'utf8');
      await this.evaluate(code);
      return;
    }
    if (options.content) {
      await this.evaluate(options.content);
      return;
    }
    if (options.url) {
      await this.evaluate(async (srcUrl: string) => {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script');
          s.src = srcUrl;
          s.onload = () => resolve();
          s.onerror = () => reject(new Error(`Failed to load script: ${srcUrl}`));
          (document.head || document.documentElement).appendChild(s);
        });
      }, options.url);
    }
  }

  /**
   * Sets exact viewport dimensions via BiDi browsingContext.setViewport.
   */
  public async setViewport(options: { width: number; height: number; deviceScaleFactor?: number }): Promise<void> {
    await this.send('browsingContext.setViewport', {
      context: this.contextId,
      viewport: {
        width: Math.round(options.width),
        height: Math.round(options.height)
      },
      devicePixelRatio: options.deviceScaleFactor ?? 1
    }).catch(() => {});
  }

  /**
   * Dispatches a hardware-equivalent Gecko mouse click via W3C WebDriver BiDi input.performActions
   * so event.isTrusted === true and navigator.userActivation.isActive === true.
   */
  public async dispatchTrustedClickAt(x: number, y: number, targetContextId?: string): Promise<void> {
    const ctx = targetContextId || this.contextId;
    const rx = Math.max(0, Math.round(x));
    const ry = Math.max(0, Math.round(y));
    await this.send('input.performActions', {
      context: ctx,
      actions: [
        {
          type: 'pointer',
          id: 'testudo-mouse',
          parameters: { pointerType: 'mouse' },
          actions: [
            { type: 'pointerMove', x: rx, y: ry, duration: 0 },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerUp', button: 0 }
          ]
        }
      ]
    });
    await this.send('input.releaseActions', { context: ctx }).catch(() => {});
  }

  /**
   * Dispatches hardware-equivalent Gecko keystrokes via W3C WebDriver BiDi input.performActions.
   */
  public async dispatchTrustedKeyText(text: string, targetContextId?: string): Promise<void> {
    const ctx = targetContextId || this.contextId;
    const chars = Array.from(String(text));
    if (chars.length === 0) return;
    const keyActions: Array<{ type: 'keyDown' | 'keyUp'; value: string }> = [];
    for (const ch of chars) {
      keyActions.push({ type: 'keyDown', value: ch });
      keyActions.push({ type: 'keyUp', value: ch });
    }
    await this.send('input.performActions', {
      context: ctx,
      actions: [
        {
          type: 'key',
          id: 'testudo-keyboard',
          actions: keyActions
        }
      ]
    });
    await this.send('input.releaseActions', { context: ctx }).catch(() => {});
  }

  public async click(selector: string, options?: { trusted?: boolean }): Promise<void> {
    if (options?.trusted) {
      if (selector.includes('>>>')) {
        await this.pierceClick(selector, { trusted: true });
        return;
      }
      const coords = await this.evaluate((sel: string) => {
        const w = window as any;
        const el = (w.$T ? w.$T.scan.resolveElement(sel) : document.querySelector(sel)) as HTMLElement | null;
        if (!el) throw new Error(`[Testudo BiDi] Element not found for trusted click: ${sel}`);
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, selector);
      await this.dispatchTrustedClickAt(coords.x, coords.y);
      return;
    }

    await this.evaluate(async (sel: string) => {
      const w = window as any;
      if (!w.$T) throw new Error('[Testudo] window.$T not initialized');
      await w.$T(sel).click();
    }, selector);
  }

  public async type(
    selector: string,
    text: string,
    options?: { clear?: boolean; delay?: number; mask?: string; blur?: boolean; trusted?: boolean }
  ): Promise<{ value: string; masked: boolean }> {
    if (options?.trusted) {
      if (selector.includes('>>>')) {
        return this.pierceType(selector, text, { trusted: true, clear: options.clear });
      }
      const coords = await this.evaluate(
        (sel: string, shouldClear: boolean) => {
          const w = window as any;
          const el = (w.$T ? w.$T.scan.resolveElement(sel) : document.querySelector(sel)) as HTMLInputElement | null;
          if (!el) throw new Error(`[Testudo BiDi] Element not found for trusted type: ${sel}`);
          el.scrollIntoView({ block: 'center', inline: 'center' });
          if (shouldClear && 'value' in el) {
            w.$T?.type?.setNativeValue ? w.$T.type.setNativeValue(el, '') : (el.value = '');
          }
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        },
        selector,
        options.clear !== false
      );
      await this.dispatchTrustedClickAt(coords.x, coords.y);
      await this.dispatchTrustedKeyText(text);
      const finalVal = await this.evaluate((sel: string) => {
        const w = window as any;
        const el = (w.$T ? w.$T.scan.resolveElement(sel) : document.querySelector(sel)) as HTMLInputElement | null;
        return el ? String(el.value ?? el.textContent ?? '') : '';
      }, selector);
      return { value: finalVal, masked: false };
    }

    return this.evaluate(
      async (sel: string, val: string, opts: any) => {
        const w = window as any;
        if (!w.$T) throw new Error('[Testudo] window.$T not initialized');
        return w.$T.type(sel, val, opts);
      },
      selector,
      text,
      options || {}
    );
  }

  public async select(selector: string, value: string): Promise<{ value: string }> {
    return this.evaluate(
      async (sel: string, val: string) => {
        const w = window as any;
        if (!w.$T) throw new Error('[Testudo] window.$T not initialized');
        return w.$T.select(sel, val);
      },
      selector,
      value
    );
  }

  public async textContent(selector: string): Promise<string | null> {
    return this.evaluate((sel: string) => {
      const w = window as any;
      const el = w.$T ? w.$T.scan.resolveElement(sel) : document.querySelector(sel);
      if (!el) return null;
      if (el.value !== undefined && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
        return String(el.value);
      }
      return (el.innerText ?? el.textContent ?? '').trim();
    }, selector);
  }

  public locator(selector: string) {
    return {
      count: async (): Promise<number> => this.evaluate((sel: string) => document.querySelectorAll(sel).length, selector),
      click: async (): Promise<void> => this.click(selector),
      fill: async (text: string): Promise<void> => {
        await this.type(selector, text, { clear: true, delay: 0 });
      },
      pressSequentially: async (text: string, options?: { delay?: number }): Promise<void> => {
        await this.type(selector, text, { clear: false, delay: options?.delay ?? 0 });
      },
      selectOption: async (value: string): Promise<void> => {
        await this.select(selector, value);
      },
      innerText: async (): Promise<string> => (await this.textContent(selector)) ?? '',
      textContent: async (): Promise<string | null> => this.textContent(selector)
    };
  }

  public async kineticScroll(options?: KineticScrollOptions): Promise<KineticScrollResult> {
    return this.evaluate(async (opts: any) => {
      const w = window as any;
      if (!w.$T?.kinetic) throw new Error('[Testudo] window.$T.kinetic not initialized');
      return w.$T.kinetic.scrollFeed(opts);
    }, options || {});
  }

  public async expandAll(options?: ExpandAllOptions): Promise<{ clickedCount: number; matchedTexts: string[] }> {
    return this.evaluate((opts: any) => {
      const w = window as any;
      if (!w.$T?.kinetic) throw new Error('[Testudo] window.$T.kinetic not initialized');
      return w.$T.kinetic.expandAll(opts || {});
    }, options || {});
  }

  public async thinkPause(options?: ThinkPauseOptions): Promise<{ plannedMs: number; waitedMs: number }> {
    return this.evaluate(async (opts: any) => {
      const w = window as any;
      if (!w.$T?.kinetic) throw new Error('[Testudo] window.$T.kinetic not initialized');
      return w.$T.kinetic.thinkPause(opts || {});
    }, options || {});
  }

  public async runWorkflow(
    name: string,
    steps: WorkflowStep[],
    options: WorkflowRunOptions = {}
  ): Promise<WorkflowReport> {
    return this.evaluate(
      async (wfName: string, wfSteps: WorkflowStep[], wfOpts: any) => {
        const w = window as any;
        if (!w.$T?.workflow) throw new Error('[Testudo] window.$T.workflow not initialized');
        return w.$T.workflow(wfName, wfSteps).run(wfOpts);
      },
      name,
      steps,
      options
    );
  }

  public async conciergeSnapshot(): Promise<ConciergeScreenSnapshot> {
    return this.evaluate(() => {
      const w = window as any;
      if (!w.$T?.concierge) throw new Error('[Testudo] window.$T.concierge not initialized');
      return w.$T.concierge.snapshotScreen();
    });
  }

  public async detectChallenge(): Promise<ChallengeDetectionResult> {
    return this.evaluate(() => {
      const w = window as any;
      if (!w.$T?.concierge) throw new Error('[Testudo] window.$T.concierge not initialized');
      return w.$T.concierge.detectChallenge();
    });
  }

  /**
   * Captures a PNG or JPEG screenshot via BiDi browsingContext.captureScreenshot.
   */
  public async screenshot(
    options: { path?: string; format?: 'png' | 'jpeg'; type?: 'png' | 'jpeg'; fullPage?: boolean } = {}
  ): Promise<Buffer> {
    const fmt = options.format ?? options.type ?? 'png';
    const res = await this.send<{ data: string }>('browsingContext.captureScreenshot', {
      context: this.contextId,
      origin: options.fullPage ? 'document' : 'viewport',
      format: { type: fmt === 'jpeg' ? 'image/jpeg' : 'image/png' }
    });
    const buf = Buffer.from(res.data, 'base64');
    if (options.path) {
      writeFileAtomicSync(options.path, buf);
    }
    return buf;
  }

  /**
   * Renders the current page to a PDF buffer via BiDi browsingContext.print.
   */
  public async pdf(options: { path?: string; printBackground?: boolean } = {}): Promise<Buffer> {
    const res = await this.send<{ data: string }>('browsingContext.print', {
      context: this.contextId,
      background: options.printBackground ?? true
    });
    const buf = Buffer.from(res.data, 'base64');
    if (options.path) {
      writeFileAtomicSync(options.path, buf);
    }
    return buf;
  }

  /**
   * Split-World Zero-Trust Enclave via W3C WebDriver BiDi Sandbox Realm ('TestudoEnclave'):
   * Pre-registers the < 4 KB surgical probe inside an isolated BiDi sandbox across root and child frames,
   * keeping enclave globals invisible to untrusted MAIN-world page scripts.
   */
  public async enableSplitWorldEnclave(probeScriptSource: string): Promise<{ scriptIdentifier: string }> {
    const wrappedSource = `globalThis.__TESTUDO_ENCLAVE_PROBE__ = ${probeScriptSource.replace(/;\s*$/, '')}; globalThis.__TESTUDO_ENCLAVE_READY__ = true;`;
    this.enclaveProbeSource = wrappedSource;
    const reg = await this.send<{ script: string }>('script.addPreloadScript', {
      functionDeclaration: `function() { ${wrappedSource} }`,
      sandbox: 'TestudoEnclave'
    });
    if (reg?.script) {
      this.preloadScriptIds.push(reg.script);
    }
    await this.send(
      'script.evaluate',
      {
        target: { context: this.contextId, sandbox: 'TestudoEnclave' },
        expression: wrappedSource,
        awaitPromise: false,
        resultOwnership: 'none'
      },
      10000
    ).catch(() => {});
    return { scriptIdentifier: reg?.script || 'testudo-bidi-enclave-1' };
  }

  // ==========================================================================
  // Surgical Closed & Open Shadow DOM Piercing via BiDi includeShadowTree:'all'
  // ==========================================================================

  private static parseBidiAttrMap(rawAttrs?: Record<string, string>): Map<string, string> {
    const map = new Map<string, string>();
    if (!rawAttrs || typeof rawAttrs !== 'object') return map;
    for (const [k, v] of Object.entries(rawAttrs)) {
      map.set(String(k).toLowerCase(), String(v));
    }
    return map;
  }

  private static matchesBidiNodeSegment(remoteNode: any, rawSegment: string): boolean {
    const val = remoteNode?.value;
    if (!val || val.nodeType !== 1) return false;
    let seg = rawSegment.trim();
    if (!seg) return false;
    if (seg === '*') return true;

    const attrs = TestudoBidiSession.parseBidiAttrMap(val.attributes);
    const attrRegex = /\[([a-zA-Z0-9_:-]+)(?:([*^$]?=)["']?([^"'\]]*)["']?)?\]/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(seg)) !== null) {
      const aName = attrMatch[1].toLowerCase();
      const op = attrMatch[2] || '';
      const expected = attrMatch[3] ?? '';
      const actual = attrs.get(aName);
      if (actual === undefined) return false;
      if (op === '=' && actual !== expected) return false;
      if (op === '*=' && !actual.includes(expected)) return false;
      if (op === '^=' && !actual.startsWith(expected)) return false;
      if (op === '$=' && !actual.endsWith(expected)) return false;
    }
    seg = seg.replace(attrRegex, '').trim();

    const idMatch = seg.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      if ((attrs.get('id') || '') !== idMatch[1]) return false;
      seg = seg.replace(/#[a-zA-Z0-9_-]+/, '');
    }

    const classMatches = Array.from(seg.matchAll(/\.([a-zA-Z0-9_-]+)/g)).map((m) => m[1]);
    if (classMatches.length > 0) {
      const nodeClasses = new Set((attrs.get('class') || '').split(/\s+/).filter(Boolean));
      for (const cls of classMatches) {
        if (!nodeClasses.has(cls)) return false;
      }
      seg = seg.replace(/\.[a-zA-Z0-9_-]+/g, '');
    }

    const remainingTag = seg.trim().toLowerCase();
    if (remainingTag && remainingTag !== '*') {
      const nodeTag = String(val.localName || '').toLowerCase();
      if (nodeTag !== remainingTag) return false;
    }
    return true;
  }

  private static searchBidiSerializedSubtree(
    remoteNode: any,
    segment: string,
    ancestry: ShadowBoundaryHop[],
    insideShadow: boolean
  ): { sharedId: string; shadowAncestry: ShadowBoundaryHop[] } | null {
    if (!remoteNode || typeof remoteNode !== 'object') return null;
    const val = remoteNode.value;
    if (insideShadow && TestudoBidiSession.matchesBidiNodeSegment(remoteNode, segment) && typeof remoteNode.sharedId === 'string') {
      return { sharedId: remoteNode.sharedId, shadowAncestry: [...ancestry] };
    }

    if (!val) return null;
    const hostAttrs = TestudoBidiSession.parseBidiAttrMap(val.attributes);
    const hostTag = String(val.localName || 'div').toLowerCase();
    const hostId = hostAttrs.get('id') || undefined;
    const hostTestId = hostAttrs.get('data-testid') || undefined;

    const sr = val.shadowRoot;
    if (sr && sr.value) {
      const hop: ShadowBoundaryHop = {
        hostTag,
        hostId,
        hostTestId,
        mode: sr.value.mode === 'closed' ? 'closed' : 'open'
      };
      const nextAncestry = [...ancestry, hop];
      if (Array.isArray(sr.value.children)) {
        for (const child of sr.value.children) {
          const hit = TestudoBidiSession.searchBidiSerializedSubtree(child, segment, nextAncestry, true);
          if (hit) return hit;
        }
      }
    }

    if (Array.isArray(val.children)) {
      for (const child of val.children) {
        const hit = TestudoBidiSession.searchBidiSerializedSubtree(child, segment, ancestry, insideShadow);
        if (hit) return hit;
      }
    }
    return null;
  }

  private async describeBidiShadowHost(sharedIdOrSelector: { sharedId?: string; selector?: string }, contextId: string): Promise<any> {
    if (sharedIdOrSelector.sharedId) {
      const res = await this.send<{ result?: any }>(
        'script.callFunction',
        {
          target: { context: contextId },
          functionDeclaration: 'function(node) { return node; }',
          arguments: [{ sharedId: sharedIdOrSelector.sharedId }],
          awaitPromise: false,
          serializationOptions: { includeShadowTree: 'all', maxDomDepth: 8 }
        },
        15000
      );
      return res?.result;
    }

    const res = await this.send<{ result?: any }>(
      'script.callFunction',
      {
        target: { context: contextId },
        functionDeclaration:
          'function(sel) { const w = window; return w.$T ? w.$T.scan.resolveElement(sel) : document.querySelector(sel); }',
        arguments: [{ type: 'string', value: String(sharedIdOrSelector.selector || '') }],
        awaitPromise: false,
        serializationOptions: { includeShadowTree: 'all', maxDomDepth: 8 }
      },
      15000
    );
    return res?.result;
  }

  /**
   * Surgically pierces open and genuinely closed Shadow DOMs along a `host >>> inner` selector chain
   * via W3C WebDriver BiDi `serializationOptions: { includeShadowTree: 'all' }` without serializing the full document.
   */
  public async pierceResolve(
    deepSelector: string,
    targetContextId?: string
  ): Promise<{ sharedId: string; closedShadowAncestry: ShadowBoundaryHop[]; contextId: string }> {
    const ctx = targetContextId || this.contextId;
    const segments = String(deepSelector || '')
      .split('>>>')
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) {
      throw new Error('[Testudo BiDi] pierceResolve requires a non-empty selector');
    }

    let currentNode = await this.describeBidiShadowHost({ selector: segments[0] }, ctx);
    if (!currentNode || currentNode.type !== 'node' || typeof currentNode.sharedId !== 'string') {
      throw new Error(`[Testudo BiDi] Shadow/Frame host not found for segment "${segments[0]}" in "${deepSelector}"`);
    }

    let currentSharedId = currentNode.sharedId;
    const accumulatedAncestry: ShadowBoundaryHop[] = [];

    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      if (i > 1) {
        currentNode = await this.describeBidiShadowHost({ sharedId: currentSharedId }, ctx);
      }
      const found = TestudoBidiSession.searchBidiSerializedSubtree(currentNode, seg, [], false);
      if (!found) {
        throw new Error(`[Testudo BiDi] Pierced target "${seg}" not found inside host "${segments[i - 1]}"`);
      }
      for (const hop of found.shadowAncestry) {
        accumulatedAncestry.push(hop);
      }
      currentSharedId = found.sharedId;
    }

    return {
      sharedId: currentSharedId,
      closedShadowAncestry: accumulatedAncestry,
      contextId: ctx
    };
  }

  /**
   * Clicks an element inside an open or genuinely closed Shadow DOM (supports { trusted: true }).
   */
  public async pierceClick(
    deepSelector: string,
    options?: { trusted?: boolean; contextId?: string }
  ): Promise<void> {
    const target = await this.pierceResolve(deepSelector, options?.contextId);
    if (options?.trusted) {
      const boxRes = await this.send<{ result?: any }>(
        'script.callFunction',
        {
          target: { context: target.contextId },
          functionDeclaration: `function(el) {
            if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', inline: 'center' });
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }`,
          arguments: [{ sharedId: target.sharedId }],
          awaitPromise: false,
          serializationOptions: { maxObjectDepth: 4 }
        },
        15000
      );
      const pt = deserializeBidiValue(boxRes?.result);
      if (!pt || typeof pt.x !== 'number') {
        throw new Error(`[Testudo BiDi] Could not compute bounding rect for ${deepSelector}`);
      }
      await this.dispatchTrustedClickAt(pt.x, pt.y, target.contextId);
      return;
    }

    await this.send(
      'script.callFunction',
      {
        target: { context: target.contextId },
        functionDeclaration: `function(el) {
          if (typeof el.focus === 'function') el.focus();
          if (typeof el.click === 'function') {
            el.click();
          } else {
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
          }
        }`,
        arguments: [{ sharedId: target.sharedId }],
        awaitPromise: false
      },
      15000
    );
  }

  /**
   * Types into an <input>, <textarea>, or contenteditable element inside an open or closed Shadow DOM.
   */
  public async pierceType(
    deepSelector: string,
    text: string,
    options?: { trusted?: boolean; clear?: boolean; contextId?: string }
  ): Promise<{ value: string; masked: boolean }> {
    const target = await this.pierceResolve(deepSelector, options?.contextId);
    const shouldClear = options?.clear !== false;

    if (options?.trusted) {
      const boxRes = await this.send<{ result?: any }>(
        'script.callFunction',
        {
          target: { context: target.contextId },
          functionDeclaration: `function(el, clearFirst) {
            if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', inline: 'center' });
            if (clearFirst && 'value' in el) {
              const proto = Object.getPrototypeOf(el);
              const desc = Object.getOwnPropertyDescriptor(proto, 'value');
              if (desc && desc.set) desc.set.call(el, ''); else el.value = '';
              el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            }
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }`,
          arguments: [{ sharedId: target.sharedId }, { type: 'boolean', value: shouldClear }],
          awaitPromise: false,
          serializationOptions: { maxObjectDepth: 4 }
        },
        15000
      );
      const pt = deserializeBidiValue(boxRes?.result);
      if (!pt || typeof pt.x !== 'number') {
        throw new Error(`[Testudo BiDi] Could not compute bounding rect for ${deepSelector}`);
      }
      await this.dispatchTrustedClickAt(pt.x, pt.y, target.contextId);
      await this.dispatchTrustedKeyText(text, target.contextId);
    } else {
      await this.send(
        'script.callFunction',
        {
          target: { context: target.contextId },
          functionDeclaration: `function(el, val, clearFirst) {
            if (typeof el.focus === 'function') el.focus();
            const nextVal = clearFirst ? val : String(el.value || '') + val;
            if ('value' in el) {
              const proto = Object.getPrototypeOf(el);
              const desc = Object.getOwnPropertyDescriptor(proto, 'value');
              if (desc && desc.set) desc.set.call(el, nextVal); else el.value = nextVal;
            } else {
              el.textContent = nextVal;
            }
            el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          }`,
          arguments: [
            { sharedId: target.sharedId },
            { type: 'string', value: text },
            { type: 'boolean', value: shouldClear }
          ],
          awaitPromise: false
        },
        15000
      );
    }

    const readBack = await this.pierceTextContent(deepSelector, options?.contextId);
    return { value: readBack ?? '', masked: false };
  }

  /**
   * Reads textContent or input value from an element inside an open or closed Shadow DOM.
   */
  public async pierceTextContent(deepSelector: string, targetContextId?: string): Promise<string | null> {
    const target = await this.pierceResolve(deepSelector, targetContextId);
    const res = await this.send<{ result?: any }>(
      'script.callFunction',
      {
        target: { context: target.contextId },
        functionDeclaration: `function(el) {
          if ('value' in el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
            return String(el.value);
          }
          return String(el.innerText ?? el.textContent ?? '').trim();
        }`,
        arguments: [{ sharedId: target.sharedId }],
        awaitPromise: false
      },
      15000
    );
    const val = deserializeBidiValue(res?.result);
    return val === undefined || val === null ? null : String(val);
  }

  // ==========================================================================
  // Cross-Origin Gecko Fission OOPIF Context Tree Multiplexer
  // ==========================================================================

  public listChildOopifSessions(): ChildOopifSessionInfo[] {
    return Array.from(this.childContexts.values()).map((c) => ({ ...c }));
  }

  /**
   * Executes a function or $T workflow inside a cross-origin Fission OOPIF or same-origin iframe
   * matching urlOrFramePattern via W3C WebDriver BiDi child browsingContext routing.
   */
  public async evaluateInFrame<T = any>(
    urlOrFramePattern: string,
    fnOrExpression: string | ((...args: any[]) => T | Promise<T>),
    ...args: any[]
  ): Promise<T> {
    const pat = String(urlOrFramePattern || '');
    if (!pat) {
      throw new Error('[Testudo BiDi] evaluateInFrame requires a non-empty urlOrFramePattern');
    }

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const flat = await this.refreshChildContextsFromTree();
      const matched = flat.find(
        (node) => node.context !== this.contextId && (node.url.includes(pat) || node.context === pat)
      );
      if (matched) {
        if (this.enclaveProbeSource) {
          await this.send(
            'script.evaluate',
            {
              target: { context: matched.context, sandbox: 'TestudoEnclave' },
              expression: this.enclaveProbeSource,
              awaitPromise: false,
              resultOwnership: 'none'
            },
            5000
          ).catch(() => {});
        }
        if (this.autoInjectTestudo) {
          const hasT = await this.evaluateInContext<boolean>(
            matched.context,
            () => Boolean((window as any).$T)
          ).catch(() => false);
          if (!hasT) {
            await this.injectTestudo(matched.context).catch(() => {});
          }
        }
        return this.evaluateInContext<T>(matched.context, fnOrExpression, undefined, ...args);
      }
      await new Promise((r) => setTimeout(r, 80));
    }

    throw new Error(`[Testudo BiDi] No child frame or Fission OOPIF matched pattern "${pat}"`);
  }

  /**
   * Spiders the complete multi-layer Firefox hierarchy:
   * Root Page -> Same-Origin Frames -> Cross-Origin Fission OOPIFs -> Open & Closed Shadow Roots.
   */
  public async spiderLayers(): Promise<SpiderLayerNode> {
    const flat = await this.refreshChildContextsFromTree();
    const rootNode = flat.find((f) => f.context === this.contextId) || {
      context: this.contextId,
      url: ''
    };
    let rootOrigin = '';
    try {
      if (rootNode.url) rootOrigin = new URL(rootNode.url).origin;
    } catch {
      // ignore
    }

    const inspectContextDomAndShadows = async (
      ctxId: string
    ): Promise<{ interactiveCount: number; shadows: SpiderLayerNode[] }> => {
      const summary = await this.evaluateInContext<{
        interactiveCount: number;
        candidates: Array<{ selector: string; tag: string; id: string }>;
      }>(ctxId, () => {
        const interactiveCount = document.querySelectorAll('button, a, input, select, textarea, [role]').length;
        const candidates: Array<{ selector: string; tag: string; id: string }> = [];
        const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
        for (let i = 0; i < all.length && candidates.length < 32; i++) {
          const el = all[i];
          const tag = (el.tagName || '').toLowerCase();
          if (
            el.shadowRoot ||
            tag.includes('-') ||
            el.hasAttribute('data-shadow-host') ||
            el.id.includes('closed') ||
            el.id.includes('shadow') ||
            el.id.includes('open')
          ) {
            const sel = el.id ? `#${el.id}` : tag;
            candidates.push({ selector: sel, tag, id: el.id || '' });
          }
        }
        return { interactiveCount, candidates };
      }).catch(() => ({ interactiveCount: 0, candidates: [] }));

      const shadowNodes: SpiderLayerNode[] = [];
      for (const cand of summary.candidates) {
        const remote = await this.describeBidiShadowHost({ selector: cand.selector }, ctxId).catch(() => null);
        const sr = remote?.value?.shadowRoot;
        if (sr && sr.value) {
          let count = 0;
          const countInteractive = (n: any) => {
            if (!n || !n.value) return;
            if (n.value.nodeType === 1) {
              const t = String(n.value.localName || '').toLowerCase();
              if (t === 'button' || t === 'a' || t === 'input' || t === 'select' || t === 'textarea') count++;
            }
            if (Array.isArray(n.value.children)) n.value.children.forEach(countInteractive);
          };
          countInteractive(sr);
          shadowNodes.push({
            layerKind: 'shadow-root',
            shadowMode: sr.value.mode === 'closed' ? 'closed' : 'open',
            hostTag: cand.tag,
            hostId: cand.id || undefined,
            interactiveCount: count,
            children: []
          });
        }
      }
      return { interactiveCount: summary.interactiveCount, shadows: shadowNodes };
    };

    const rootInspected = await inspectContextDomAndShadows(this.contextId);
    const children: SpiderLayerNode[] = [...rootInspected.shadows];

    for (const f of flat) {
      if (f.context === this.contextId) continue;
      let childOrigin = '';
      try {
        if (f.url) childOrigin = new URL(f.url).origin;
      } catch {
        // ignore
      }
      const isCross = Boolean(rootOrigin && childOrigin && childOrigin !== rootOrigin);
      const sub = await inspectContextDomAndShadows(f.context);
      children.push({
        layerKind: isCross ? 'cross-origin-oopif' : 'same-origin-frame',
        frameId: f.context,
        sessionId: f.context,
        url: f.url,
        interactiveCount: sub.interactiveCount,
        children: sub.shadows
      });
    }

    return {
      layerKind: 'root-page',
      frameId: rootNode.context,
      url: rootNode.url,
      interactiveCount: rootInspected.interactiveCount,
      children
    };
  }

  // ==========================================================================
  // Virtual CTAP2/FIDO2 Hardware Passkey Authenticator (BiDi Probe -> Marionette)
  // ==========================================================================

  public async enableVirtualAuthenticator(options: VirtualAuthenticatorOptions = {}): Promise<string> {
    const protocol = options.protocol ?? 'ctap2';
    const transport = options.transport ?? 'internal';
    const hasResidentKey = options.hasResidentKey ?? true;
    const hasUserVerification = options.hasUserVerification ?? true;
    const isUserVerified = options.isUserVerified ?? true;
    const isUserConsenting = options.automaticPresenceSimulation ?? true;

    // 1. Probe forward-compatible W3C BiDi webauthn.addVirtualAuthenticator first
    try {
      const bidiRes = await this.send<{ authenticator: string }>('webauthn.addVirtualAuthenticator', {
        context: this.contextId,
        options: {
          protocol,
          transport,
          hasResidentKey,
          hasUserVerification,
          isUserVerified,
          isUserConsenting
        }
      });
      if (bidiRes?.authenticator) {
        this.activeAuthenticatorId = bidiRes.authenticator;
        this.activeAuthenticatorBackend = 'bidi-webauthn';
        return bidiRes.authenticator;
      }
    } catch {
      // Fall back to Firefox's unified loopback Marionette CTAP2 authenticator channel
    }

    if (!this.marionetteClient) {
      throw new Error(
        '[Testudo BiDi] Virtual WebAuthn requires a Marionette-unified Firefox BiDi session (TestudoBidi.launchHeadless) until Mozilla enables BiDi webauthn.*'
      );
    }

    const mRes = await this.marionetteClient.sendCommand('WebAuthn:AddVirtualAuthenticator', {
      protocol: protocol === 'u2f' ? 'ctap1/u2f' : 'ctap2',
      transport,
      hasResidentKey,
      hasUserVerification,
      isUserConsenting,
      isUserVerified
    });
    const authId = String(mRes?.value ?? mRes ?? '');
    if (!authId) {
      throw new Error('[Testudo BiDi] WebAuthn:AddVirtualAuthenticator returned an empty authenticatorId');
    }
    this.activeAuthenticatorId = authId;
    this.activeAuthenticatorBackend = 'marionette-ctap2';
    return authId;
  }

  public async getVirtualCredentials(authenticatorId?: string): Promise<any[]> {
    const authId = authenticatorId || this.activeAuthenticatorId;
    if (!authId) {
      throw new Error('[Testudo BiDi] No active virtual authenticator');
    }
    if (this.activeAuthenticatorBackend === 'bidi-webauthn') {
      const res = await this.send<{ credentials?: any[] }>('webauthn.getCredentials', {
        context: this.contextId,
        authenticator: authId
      });
      return res?.credentials || [];
    }
    if (!this.marionetteClient) {
      throw new Error('[Testudo BiDi] Marionette channel unavailable for WebAuthn:GetCredentials');
    }
    const mRes = await this.marionetteClient.sendCommand('WebAuthn:GetCredentials', {
      authenticatorId: authId
    });
    if (Array.isArray(mRes)) return mRes;
    if (Array.isArray(mRes?.credentials)) return mRes.credentials;
    if (Array.isArray(mRes?.value)) return mRes.value;
    return [];
  }

  public async removeVirtualAuthenticator(authenticatorId?: string): Promise<void> {
    const authId = authenticatorId || this.activeAuthenticatorId;
    if (!authId) return;
    if (this.activeAuthenticatorBackend === 'bidi-webauthn') {
      await this.send('webauthn.removeVirtualAuthenticator', {
        context: this.contextId,
        authenticator: authId
      }).catch(() => {});
    } else if (this.marionetteClient) {
      await this.marionetteClient
        .sendCommand('WebAuthn:RemoveVirtualAuthenticator', { authenticatorId: authId })
        .catch(() => {});
    }
    if (this.activeAuthenticatorId === authId) {
      this.activeAuthenticatorId = undefined;
      this.activeAuthenticatorBackend = undefined;
    }
  }

  // ==========================================================================
  // Pillar-1 Zero-Plaintext Live Wire Capture & Zero-Patch Fault Interception
  // ==========================================================================

  private static decodeBidiBytesValue(bv: any): string {
    if (!bv) return '';
    if (typeof bv === 'string') return bv;
    if (bv.type === 'base64' && typeof bv.value === 'string') {
      return Buffer.from(bv.value, 'base64').toString('utf8');
    }
    return String(bv.value ?? '');
  }

  private static normalizeBidiHeaders(
    rawHeaders: Array<{ name: string; value: any }> | undefined
  ): Record<string, string | string[]> {
    const map: Record<string, string | string[]> = {};
    if (!Array.isArray(rawHeaders)) return map;
    for (const h of rawHeaders) {
      if (!h || !h.name) continue;
      const lower = String(h.name).toLowerCase();
      const val = TestudoBidiSession.decodeBidiBytesValue(h.value);
      const existing = map[lower];
      if (existing === undefined) {
        map[lower] = val;
      } else if (Array.isArray(existing)) {
        existing.push(val);
      } else {
        map[lower] = [existing, val];
      }
    }
    return map;
  }

  private static parseSetCookieHeadersPillar1(
    rawSetCookieHeader: string | string[] | undefined,
    hmacSalt: string
  ): ObservedCookieSummary[] {
    if (!rawSetCookieHeader) return [];
    const lines = Array.isArray(rawSetCookieHeader)
      ? rawSetCookieHeader
      : String(rawSetCookieHeader)
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);

    const summaries: ObservedCookieSummary[] = [];
    for (const line of lines) {
      const parts = line.split(';').map((p) => p.trim());
      const nameVal = parts[0] || '';
      const eqIdx = nameVal.indexOf('=');
      if (eqIdx <= 0) continue;
      const name = nameVal.slice(0, eqIdx).trim();
      const rawSecretValue = nameVal.slice(eqIdx + 1);
      const blindedValueHash = crypto
        .createHmac('sha256', hmacSalt)
        .update(rawSecretValue, 'utf8')
        .digest('hex')
        .slice(0, 16);

      let httpOnly = false;
      let secure = false;
      let sameSite: string | undefined;
      for (let i = 1; i < parts.length; i++) {
        const attr = parts[i];
        const lower = attr.toLowerCase();
        if (lower === 'httponly') httpOnly = true;
        else if (lower === 'secure') secure = true;
        else if (lower.startsWith('samesite=')) sameSite = attr.slice(9).trim();
      }
      summaries.push({ name, httpOnly, secure, sameSite, blindedValueHash });
    }
    return summaries;
  }

  /**
   * Enables live out-of-process W3C WebDriver BiDi network.* wire telemetry with Pillar-1 HMAC secret blinding
   * (captures HttpOnly cookies, protocol, Server-Timing, and sub-ms FetchTimingInfo splits with 0 raw secret bytes).
   */
  public async enableLiveWireCapture(options: { hmacSalt?: string } = {}): Promise<void> {
    const salt = options.hmacSalt || 'TESTUDO_HEADER_BLIND_V1';
    if (this.liveWireEnabled) return;
    this.liveWireEnabled = true;

    const ensureRecord = (requestId: string, contextId?: string): LiveWireRequestRecord => {
      const key = `${contextId || 'root'}:${requestId}`;
      let rec = this.liveWireRequests.get(key);
      if (!rec) {
        rec = {
          requestId,
          sessionId: contextId,
          url: '',
          method: 'GET',
          status: 0,
          mimeType: '',
          tlsProtocol: 'http/1.1',
          tlsCipher: 'PLAINTEXT_LOOPBACK',
          scrubbedRequestHeaders: {},
          scrubbedResponseHeaders: {},
          cookiesObserved: [],
          timingUs: { dnsUs: 0, tcpUs: 0, tlsUs: 0, sendUs: 0, ttfbUs: 0 }
        };
        this.liveWireRequests.set(key, rec);
      }
      return rec;
    };

    const ingestResponse = (params: any) => {
      const reqId = params?.request?.request;
      if (!reqId) return;
      const ctxId = params.context ? String(params.context) : undefined;
      const rec = ensureRecord(String(reqId), ctxId);
      const resp = params.response || {};
      rec.url = String(resp.url || params.request?.url || rec.url);
      rec.method = String(params.request?.method || rec.method);
      rec.status = Number(resp.status || rec.status);
      rec.mimeType = String(resp.mimeType || rec.mimeType);
      if (resp.protocol) {
        rec.tlsProtocol = String(resp.protocol);
        if (String(resp.url || '').startsWith('https://')) {
          rec.tlsCipher = 'GECKO_NSS_TLS';
        }
      }

      const rawReqHeaders = TestudoBidiSession.normalizeBidiHeaders(params.request?.headers);
      rec.scrubbedRequestHeaders = {
        ...rec.scrubbedRequestHeaders,
        ...scrubHeadersZeroPlaintext(rawReqHeaders, salt)
      };

      const rawRespHeaders = TestudoBidiSession.normalizeBidiHeaders(resp.headers);
      const scrubbedResp = scrubHeadersZeroPlaintext(rawRespHeaders, salt);
      rec.scrubbedResponseHeaders = { ...rec.scrubbedResponseHeaders, ...scrubbedResp };
      if (scrubbedResp['server-timing']) {
        rec.serverTimingHeader = scrubbedResp['server-timing'];
      }

      const cookies = TestudoBidiSession.parseSetCookieHeadersPillar1(rawRespHeaders['set-cookie'], salt);
      for (const c of cookies) {
        if (!rec.cookiesObserved.some((e) => e.name === c.name && e.blindedValueHash === c.blindedValueHash)) {
          rec.cookiesObserved.push(c);
        }
      }

      const t = params.request?.timings;
      if (t) {
        const spanUs = (a: number, b: number) =>
          typeof a === 'number' && typeof b === 'number' && a > 0 && b >= a ? Math.round((b - a) * 1000) : 0;
        rec.timingUs = {
          dnsUs: spanUs(t.dnsStart, t.dnsEnd),
          tcpUs: spanUs(t.connectStart, t.connectEnd),
          tlsUs: spanUs(t.tlsStart, t.connectEnd),
          sendUs: spanUs(t.requestStart, t.responseStart),
          ttfbUs: spanUs(t.requestStart, t.responseStart)
        };
      }
    };

    this.on('network.beforeRequestSent', (params: any) => {
      const reqId = params?.request?.request;
      if (!reqId) return;
      const ctxId = params.context ? String(params.context) : undefined;
      const rec = ensureRecord(String(reqId), ctxId);
      rec.url = String(params.request?.url || rec.url);
      rec.method = String(params.request?.method || rec.method);
      const rawReqHeaders = TestudoBidiSession.normalizeBidiHeaders(params.request?.headers);
      rec.scrubbedRequestHeaders = {
        ...rec.scrubbedRequestHeaders,
        ...scrubHeadersZeroPlaintext(rawReqHeaders, salt)
      };
    });

    this.on('network.responseStarted', ingestResponse);
    this.on('network.responseCompleted', ingestResponse);

    await this.send('session.subscribe', {
      events: ['network.beforeRequestSent', 'network.responseStarted', 'network.responseCompleted']
    });
  }

  public async getLiveWireReport(): Promise<LiveWireCaptureReport> {
    const intrinsics = await this.evaluate(() => {
      const w = window as any;
      if (w.$T?.probe?.assertNativeIntrinsicsUntouched) {
        return w.$T.probe.assertNativeIntrinsicsUntouched(window).untouched;
      }
      return Function.prototype.toString.call(window.fetch).includes('[native code]');
    }).catch(() => true);

    return {
      capturedRequests: Array.from(this.liveWireRequests.values()),
      nativeIntrinsicsUntouched: Boolean(intrinsics)
    };
  }

  /**
   * Binds a TestudoWireInterceptor out-of-process via W3C WebDriver BiDi
   * network.addIntercept + network.provideResponse so HTTP 429/503/corrupt-JSON mocks execute
   * with zero window.fetch monkey-patching in Firefox MAIN world.
   */
  public async enableWireInterception(interceptor: TestudoWireInterceptor): Promise<void> {
    this.on('network.beforeRequestSent', (params: any) => {
      if (!params?.isBlocked) return;
      const reqId = params?.request?.request;
      if (!reqId) return;
      const method = String(params.request?.method || 'GET');
      const url = String(params.request?.url || '');
      const matched = interceptor.matchRequest(method, url);
      if (!matched) {
        this.send('network.continueRequest', { request: reqId }, 10000).catch(() => {});
        return;
      }

      const fulfill = () => {
        const headers = Object.entries(matched.headers || {}).map(([name, value]) => ({
          name,
          value: { type: 'string', value: String(value) }
        }));
        this.send(
          'network.provideResponse',
          {
            request: reqId,
            statusCode: matched.status,
            reasonPhrase: matched.status === 429 ? 'Too Many Requests' : matched.status === 503 ? 'Service Unavailable' : 'OK',
            headers,
            body: { type: 'string', value: matched.body }
          },
          10000
        ).catch(() => {});
      };

      if (matched.delayMs > 0) {
        setTimeout(fulfill, matched.delayMs);
      } else {
        fulfill();
      }
    });

    await this.send('session.subscribe', { events: ['network.beforeRequestSent'] });
    const added = await this.send<{ intercept: string }>('network.addIntercept', {
      phases: ['beforeRequestSent'],
      urlPatterns: [{ type: 'pattern' }]
    });
    if (added?.intercept) {
      this.activeInterceptIds.push(added.intercept);
    }
  }

  // ==========================================================================
  // Full-Stack Fiber + Closed Shadow + Fission Frame X-Ray ($T.xray)
  // ==========================================================================

  public async xray(
    selector: string,
    options: { frameUrlPattern?: string } = {}
  ): Promise<FullBidiXrayReport> {
    let targetContextId = this.contextId;
    const flat = await this.refreshChildContextsFromTree();
    if (options.frameUrlPattern) {
      const hit = flat.find(
        (f) => f.context !== this.contextId && (f.url.includes(options.frameUrlPattern!) || f.context === options.frameUrlPattern)
      );
      if (hit) targetContextId = hit.context;
    }

    let baseReport: ElementXrayReport;
    let closedShadowAncestry: ShadowBoundaryHop[] = [];

    if (selector.includes('>>>')) {
      const resolved = await this.pierceResolve(selector, targetContextId);
      closedShadowAncestry = resolved.closedShadowAncestry;
      if (this.autoInjectTestudo) {
        const hasT = await this.evaluateInContext<boolean>(
          targetContextId,
          () => Boolean((window as any).$T)
        ).catch(() => false);
        if (!hasT) await this.injectTestudo(targetContextId).catch(() => {});
      }
      const callRes = await this.send<{ result?: any }>(
        'script.callFunction',
        {
          target: { context: targetContextId },
          functionDeclaration: `function(el, selStr) {
            const w = window;
            if (w.$T && typeof w.$T.xray === 'function') {
              const r = w.$T.xray(el);
              r.selector = selStr;
              return r;
            }
            return { found: true, selector: selStr, tag: (el.tagName || 'div').toLowerCase(), role: '', accessibleName: '', rect: { x: 0, y: 0, width: 0, height: 0 }, components: [], shadowAncestry: [], windowAncestry: [] };
          }`,
          arguments: [{ sharedId: resolved.sharedId }, { type: 'string', value: selector }],
          awaitPromise: false,
          serializationOptions: { maxObjectDepth: 20 }
        },
        15000
      );
      baseReport =
        (deserializeBidiValue(callRes?.result) as ElementXrayReport) || {
          found: false,
          selector,
          tag: '',
          role: '',
          accessibleName: '',
          rect: { x: 0, y: 0, width: 0, height: 0 },
          components: [],
          shadowAncestry: [],
          windowAncestry: []
        };
    } else if (options.frameUrlPattern) {
      baseReport = await this.evaluateInFrame<ElementXrayReport>(
        options.frameUrlPattern,
        (sel: string) => {
          const w = window as any;
          if (!w.$T?.xray) throw new Error('[Testudo] window.$T.xray not initialized');
          return w.$T.xray(sel);
        },
        selector
      );
    } else {
      baseReport = await this.evaluate<ElementXrayReport>((sel: string) => {
        const w = window as any;
        if (!w.$T?.xray) throw new Error('[Testudo] window.$T.xray not initialized');
        return w.$T.xray(sel);
      }, selector);
    }

    const rootNode = flat.find((f) => f.context === this.contextId) || flat[0];
    let rootOrigin = '';
    try {
      if (rootNode?.url) rootOrigin = new URL(rootNode.url).origin;
    } catch {
      // ignore
    }

    const privilegedFrameAncestry = flat.map((f) => {
      let origin = '';
      try {
        if (f.url) origin = new URL(f.url).origin;
      } catch {
        // ignore
      }
      return {
        frameId: f.context,
        parentId: f.parentId,
        url: f.url,
        securityOrigin: origin,
        isCrossOriginOopif: Boolean(f.parentId && origin && rootOrigin && origin !== rootOrigin)
      };
    });

    return {
      ...baseReport,
      bidiContextId: targetContextId,
      closedShadowAncestry,
      privilegedFrameAncestry
    };
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    try {
      for (const intId of this.activeInterceptIds) {
        await this.send('network.removeIntercept', { intercept: intId }, 2000).catch(() => {});
      }
      for (const scriptId of this.preloadScriptIds) {
        await this.send('script.removePreloadScript', { script: scriptId }, 2000).catch(() => {});
      }
      if (this.ownsTarget && !this.childProcess) {
        await this.send('browsingContext.close', { context: this.contextId }, 3000).catch(() => {});
      }
      if (!this.childProcess) {
        await this.send('session.end', {}, 2000).catch(() => {});
      }
    } finally {
      this.ws.close();
      if (this.marionetteClient) {
        this.marionetteClient.close();
        this.marionetteClient = undefined;
      }
      if (this.childProcess) {
        try {
          this.childProcess.kill('SIGTERM');
        } catch {
          // ignore
        }
        this.childProcess = undefined;
      }
      if (this.userDataDir && fs.existsSync(this.userDataDir)) {
        try {
          fs.rmSync(this.userDataDir, { recursive: true, force: true });
        } catch {
          // ignore cleanup failure
        }
      }
    }
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

// ============================================================================
// TestudoBidi Factory & ARCH-27 3-Tier Browser Failover Router
// ============================================================================

export const TestudoBidi = {
  /**
   * Connects directly to an existing Firefox W3C WebDriver BiDi endpoint (e.g., ws://127.0.0.1:9222/session).
   * Enforces Rule 13 Window Isolation: attaches in-place with ownsTarget:false when targetUrlPattern/contextId
   * is given, or opens a dedicated window via browsingContext.create({ type: 'window' }) otherwise.
   */
  async connect(options: BidiConnectOptions = {}): Promise<TestudoBidiSession> {
    const host = options.host || '127.0.0.1';
    const port = options.port ?? DEFAULT_BIDI_PORT;
    const rawWsUrl = options.wsUrl || `ws://${host}:${port}/session`;
    const ws = await connectBidiWebSocket(rawWsUrl);

    let tempId = 1;
    const rawCall = <T = any>(method: string, params: Record<string, any> = {}): Promise<T> =>
      new Promise((resolve, reject) => {
        const cid = tempId++;
        const timer = setTimeout(() => {
          ws.off('message', onMsg);
          reject(new Error(`[Testudo BiDi] Handshake ${method} timed out`));
        }, 10000);
        const onMsg = (raw: string) => {
          try {
            const msg = JSON.parse(raw);
            if (msg.id === cid) {
              clearTimeout(timer);
              ws.off('message', onMsg);
              if (msg.type === 'error' || msg.error) {
                reject(new Error(`[BiDi Error ${msg.error}] ${msg.message || ''}`));
              } else {
                resolve(msg.result as T);
              }
            }
          } catch {
            // ignore
          }
        };
        ws.on('message', onMsg);
        ws.send(JSON.stringify({ id: cid, method, params }));
      });

    try {
      // Establish BiDi session unless wsUrl already points to an active /session/<id>
      if (!/\/session\/[^/]+$/.test(new URL(rawWsUrl).pathname)) {
        await rawCall('session.new', { capabilities: {} });
      }

      const tree = await rawCall<{ contexts: BidiContextInfo[] }>('browsingContext.getTree', {});
      const topContexts = tree?.contexts || [];

      let contextId = options.contextId;
      let ownsTarget = false;

      if (contextId || options.targetUrlPattern) {
        const matched = topContexts.find((c) => {
          if (contextId && c.context === contextId) return true;
          if (options.targetUrlPattern && c.url && c.url.includes(options.targetUrlPattern)) return true;
          return false;
        });
        if (!matched) {
          throw new Error(
            `[Testudo BiDi] Could not find existing Firefox tab matching "${options.targetUrlPattern || contextId}" on ${rawWsUrl}`
          );
        }
        contextId = matched.context;
        ownsTarget = false;
      } else {
        const created = await rawCall<{ context: string }>('browsingContext.create', {
          type: options.newWindow === false ? 'tab' : 'window'
        });
        contextId = created.context;
        ownsTarget = true;
        if (options.url) {
          await rawCall('browsingContext.navigate', {
            context: contextId,
            url: options.url,
            wait: 'complete'
          });
        }
      }

      const session = new TestudoBidiSession({
        ws,
        contextId: contextId!,
        ownsTarget,
        wsUrl: rawWsUrl,
        autoInjectTestudo: options.autoInjectTestudo ?? true
      });
      await session.initializeTestudo({ reload: options.reloadOnAttach ?? false });
      return session;
    } catch (err) {
      ws.close();
      throw err;
    }
  },

  /**
   * Enforces the ARCH-27 3-Tier Browser Connection Hierarchy for Firefox:
   *   Tier 1 (Primary): TestudoAssistiveBridge (ws://127.0.0.1:3851, accepts moz-extension:// & chrome-extension://)
   *   Tier 2 (First Fallback): Native Firefox WebDriver BiDi (ws://127.0.0.1:9222/session)
   *   Tier 3 (Last-Resort Emergency Fallback): Playwright Firefox
   * Emits mandatory [TESTUDO-BROWSER-FALLBACK] diagnostics with exact root-cause failure reasons before each fallback.
   */
  async connectWithFailover(options: BidiFailoverConnectOptions = {}): Promise<BidiFailoverConnectResult> {
    const bridgePort = options.bridgePort ?? DEFAULT_ASSISTIVE_BRIDGE_PORT;
    const bidiPort = options.bidiPort ?? options.port ?? DEFAULT_BIDI_PORT;
    const host = options.host || '127.0.0.1';
    const failures: BrowserTierFailureReport[] = [];

    const reportFailure = (
      tier: 1 | 2 | 3,
      tierName: BrowserTierFailureReport['tierName'],
      reason: string,
      nextTierDesc: string
    ) => {
      const report: BrowserTierFailureReport = {
        tier,
        tierName,
        reason,
        timestamp: new Date().toISOString()
      };
      failures.push(report);
      const alertMsg = `[TESTUDO-BROWSER-FALLBACK] Tier ${tier} (${tierName}) FAILED: ${reason}. ${nextTierDesc}`;
      console.warn(alertMsg);
      if (typeof options.onTierFailure === 'function') {
        options.onTierFailure(report, alertMsg);
      }
    };

    // TIER 1: Testudo-JS Assistive Bridge (ws://127.0.0.1:3851)
    const bridge = new TestudoAssistiveBridge({
      host,
      port: bridgePort,
      authToken: options.bridgeAuthToken
    });
    try {
      await bridge.start();
      const status = await bridge.getStatus();
      if (!status.extensionConnected) {
        throw new Error(
          `No Sir Testudo WebExtension connected on ws://${host}:${bridgePort}/ws (connectedClients=0)`
        );
      }
      let attachedTabId: number | undefined;
      if (options.targetUrlPattern) {
        const attached = await bridge.attachExistingTab(options.targetUrlPattern, {
          reload: options.reloadOnAttach ?? false
        });
        attachedTabId = attached.tabId;
      } else if (options.url) {
        const bg = await bridge.openBackgroundTab(options.url, {
          groupTitle: '[Testudo Agent]',
          collapsed: true,
          active: false
        });
        attachedTabId = bg.tabId;
      }
      return {
        activeTier: 1,
        driver: 'testudo-assistive-bridge',
        bridge,
        attachedTabId,
        failures,
        close: async () => {
          await bridge.close();
        }
      };
    } catch (tier1Err: any) {
      await bridge.close().catch(() => {});
      reportFailure(
        1,
        'testudo-assistive-bridge',
        tier1Err?.message || String(tier1Err),
        `Falling back to Tier 2 (Native Firefox WebDriver BiDi on ws://${host}:${bidiPort}/session)...`
      );
    }

    // TIER 2: Native Firefox WebDriver BiDi Port
    try {
      const session = await TestudoBidi.connect({
        ...options,
        host,
        port: bidiPort
      });
      return {
        activeTier: 2,
        driver: 'native-webdriver-bidi',
        session,
        failures,
        close: async () => {
          await session.close();
        }
      };
    } catch (tier2Err: any) {
      reportFailure(
        2,
        'native-debug-port-cdp',
        tier2Err?.message || String(tier2Err),
        options.allowPlaywrightFallback === false
          ? 'Playwright fallback is disabled (allowPlaywrightFallback: false).'
          : 'Falling back to Tier 3 (Playwright Firefox Emergency Fallback)...'
      );
    }

    if (options.allowPlaywrightFallback === false) {
      const summary = failures.map((f) => `Tier ${f.tier} (${f.tierName}): ${f.reason}`).join(' | ');
      throw new Error(`[Testudo Browser Failover Exhausted] ${summary}`);
    }

    // TIER 3: Playwright Firefox Emergency Fallback
    try {
      const pwModName = 'playwright';
      const pw: any = await import(pwModName);
      const firefoxLauncher = pw.firefox || pw.default?.firefox;
      if (!firefoxLauncher) {
        throw new Error('Playwright firefox launcher not found');
      }
      const browser = await firefoxLauncher.launch({
        executablePath: options.executablePath,
        headless: true
      });
      const page = await browser.newPage();
      if (options.url) {
        await page.goto(options.url, { waitUntil: 'domcontentloaded' });
      }
      return {
        activeTier: 3,
        driver: 'playwright-emergency-fallback',
        playwrightBrowser: browser,
        playwrightPage: page,
        failures,
        close: async () => {
          await browser.close();
        }
      };
    } catch (tier3Err: any) {
      reportFailure(
        3,
        'playwright-emergency-fallback',
        tier3Err?.message || String(tier3Err),
        'All 3 browser connection tiers failed.'
      );
      const summary = failures.map((f) => `Tier ${f.tier} (${f.tierName}): ${f.reason}`).join(' | ');
      throw new Error(`[Testudo Browser Failover Exhausted] ${summary}`);
    }
  },

  /**
   * Spawns a local stock Headless Mozilla Firefox process directly via node:child_process
   * (zero Geckodriver, zero Playwright, zero Selenium) with Gecko Fission Site Isolation +
   * unified W3C WebDriver BiDi WebSocket + loopback Marionette CTAP2 authenticator support.
   */
  async launchHeadless(options: FirefoxHeadlessLaunchOptions = {}): Promise<TestudoBidiSession> {
    const extraArgs = options.extraArgs || [];
    for (const rawFlag of extraArgs) {
      const normalized = String(rawFlag || '').trim().toLowerCase();
      if (DANGEROUS_FIREFOX_FLAG_PREFIXES.some((p) => normalized.startsWith(p))) {
        throw new Error(`[Testudo BiDi] Blocked dangerous Firefox flag in extraArgs: ${rawFlag}`);
      }
    }

    const firefoxBin = resolveLocalFirefoxExecutable(options.executablePath);
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testudo-bidi-profile-'));
    const width = options.width ?? 1440;
    const height = options.height ?? 900;

    const basePrefs: Record<string, string | number | boolean> = {
      'remote.active-protocols': 3,
      'marionette.port': 0,
      'fission.autostart': true,
      'fission.bfcacheInParent': true,
      'dom.security.https_first': false,
      'dom.security.https_first_pbm': false,
      'network.captive-portal-service.enabled': false,
      'network.connectivity-service.enabled': false,
      'toolkit.telemetry.reportingpolicy.firstRun': false,
      'datareporting.policy.dataSubmissionPolicyBypassNotification': true,
      'browser.shell.checkDefaultBrowser': false,
      'browser.startup.homepage_override.mstone': 'ignore',
      'browser.tabs.warnOnClose': false,
      'security.webauth.webauthn': true,
      'security.webauth.webauthn_enable_softtoken': true,
      'security.webauth.webauthn_enable_usbtoken': false,
      'security.webauthn.ctap2': true,
      ...(options.extraPrefs || {})
    };

    const userJsLines = Object.entries(basePrefs).map(
      ([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`
    );
    fs.writeFileSync(path.join(userDataDir, 'user.js'), userJsLines.join('\n') + '\n', 'utf8');

    const args = [
      '--headless',
      '--no-remote',
      '--marionette',
      '--remote-debugging-port=0',
      '--profile',
      userDataDir,
      ...extraArgs,
      options.url || 'about:blank'
    ];

    const child = spawn(firefoxBin, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const MAX_LOG_CHARS = 65536;
    const { bidiBaseWsUrl, marionettePort } = await new Promise<{
      bidiBaseWsUrl: string;
      marionettePort: number;
    }>((resolve, reject) => {
      let combinedLog = '';
      let settled = false;
      const mpFile = path.join(userDataDir, 'MarionetteActivePort');

      const cleanupOnFail = () => {
        try {
          if (fs.existsSync(userDataDir)) {
            fs.rmSync(userDataDir, { recursive: true, force: true });
          }
        } catch {
          // ignore
        }
      };

      const checkReady = () => {
        if (settled) return;
        const match = combinedLog.match(/WebDriver BiDi listening on (ws:\/\/[^\s\r\n]+)/);
        if (match && match[1] && fs.existsSync(mpFile)) {
          const portRaw = fs.readFileSync(mpFile, 'utf8').trim();
          const mPort = Number(portRaw);
          if (Number.isInteger(mPort) && mPort > 0) {
            settled = true;
            clearTimeout(timer);
            clearInterval(poller);
            child.stdout?.off('data', onChunk);
            child.stderr?.off('data', onChunk);
            child.stdout?.resume();
            child.stderr?.resume();
            resolve({ bidiBaseWsUrl: match[1], marionettePort: mPort });
          }
        }
      };

      const onChunk = (chunk: Buffer) => {
        combinedLog += chunk.toString('utf8');
        if (combinedLog.length > MAX_LOG_CHARS) {
          combinedLog = combinedLog.slice(-MAX_LOG_CHARS);
        }
        checkReady();
      };

      const poller = setInterval(checkReady, 40);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearInterval(poller);
        child.kill('SIGTERM');
        cleanupOnFail();
        reject(
          new Error(`[Testudo BiDi] Timed out waiting for headless Firefox BiDi endpoint. Log: ${combinedLog}`)
        );
      }, 20000);

      child.stdout?.on('data', onChunk);
      child.stderr?.on('data', onChunk);
      child.once('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poller);
        cleanupOnFail();
        reject(err);
      });
      child.once('exit', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poller);
        cleanupOnFail();
        reject(
          new Error(`[Testudo BiDi] Headless Firefox exited prematurely with code ${code}. Log: ${combinedLog}`)
        );
      });
    });

    try {
      const { client: marionetteClient, webSocketUrl } =
        await MarionetteLoopbackClient.connectAndCreateUnifiedSession(marionettePort);
      const finalWsUrl = webSocketUrl || `${bidiBaseWsUrl}/session`;
      const ws = await connectBidiWebSocket(finalWsUrl);

      const tempSession = new TestudoBidiSession({
        ws,
        contextId: '',
        ownsTarget: true,
        wsUrl: finalWsUrl,
        childProcess: child,
        userDataDir,
        marionetteClient,
        autoInjectTestudo: options.autoInjectTestudo ?? true
      });

      const tree = await tempSession.send<{ contexts: BidiContextInfo[] }>('browsingContext.getTree', {});
      const rootCtx = tree?.contexts?.[0]?.context;
      if (!rootCtx) {
        await tempSession.close();
        throw new Error('[Testudo BiDi] Headless Firefox launched but exposed no top-level browsingContext.');
      }

      (tempSession as any).contextId = rootCtx;
      await tempSession.setViewport({ width, height });
      await tempSession.initializeTestudo({ reload: false });
      return tempSession;
    } catch (err) {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      try {
        if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      throw err;
    }
  }
};
