/**
 * @aventine/testudo - Native Zero-Dependency CDP & Assistive Browser Bridge (@aventine/testudo/cdp)
 *
 * Replaces Playwright and Puppeteer with two unified, zero-dependency browser control planes:
 * 1. TestudoAssistiveBridge (ws://127.0.0.1:3851): Connects to the side-loaded Sir Testudo MV3
 *    Chrome Extension in everyday Chrome (including Flatpak Chrome) without requiring
 *    --remote-debugging-port=9222. Supports hot-injecting Testudo into existing open tabs
 *    WITHOUT reloading (or optional reload-and-inject), opening background tab groups without
 *    stealing focus, and pausing/auto-resuming on CAPTCHA or 2FA challenges.
 * 2. TestudoCdp / TestudoCdpSession: Direct RFC 6455 WebSocket Chrome DevTools Protocol client
 *    that attaches to existing Chrome debug ports (9222/9223) OR spawns headless local Chrome
 *    directly via node:child_process for CI verification, screenshots, and PDF generation.
 *
 * Zero external dependencies. Uses only Node.js built-in modules.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { spawn, ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Duplex } from 'node:stream';
import type { WorkflowStep, WorkflowReport, WorkflowRunOptions } from '../workflow.js';
import type {
  KineticScrollOptions,
  KineticScrollResult,
  ThinkPauseOptions,
  ExpandAllOptions
} from '../kinetic.js';
import type { TestudoLiveMetric } from '../launcher.js';
import { scrubHeadersZeroPlaintext } from '../security-enclave.js';
import type { TestudoWireInterceptor } from '../intercept.js';
import type { ElementXrayReport, ShadowBoundaryHop } from '../xray.js';

export interface ChallengeDetectionResult {
  detected: boolean;
  challengeType?: string;
  selector?: string;
  reason?: string;
}

export interface ConciergeScreenSnapshot {
  url: string;
  title: string;
  manifestName: string;
  challenge: ChallengeDetectionResult;
  liveMetrics: TestudoLiveMetric[];
  documentedControls: Array<{ selector: string; title: string; present: boolean; text?: string }>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_ASSISTIVE_BRIDGE_PORT = 3851;
export const DEFAULT_CDP_PORT = 9222;
export const MAX_WS_PAYLOAD_BYTES = 16 * 1024 * 1024;
export const MAX_HTTP_BODY_BYTES = 2 * 1024 * 1024;

const ALLOWED_EXTENSION_EVENTS = new Set([
  'extension-ready',
  'human-assist-required',
  'human-assist-resolved'
]);

const DANGEROUS_CHROME_FLAG_PREFIXES = [
  '--renderer-cmd-prefix',
  '--utility-cmd-prefix',
  '--gpu-launcher',
  '--ppapi-plugin-launcher',
  '--remote-debugging-address=0.0.0.0'
];

function extractHostWithoutPort(rawHost: string): string {
  const trimmed = String(rawHost || '').trim().toLowerCase();
  if (!trimmed) return '';
  if (trimmed.startsWith('[')) {
    const closeIdx = trimmed.indexOf(']');
    if (closeIdx === -1) return '';
    return trimmed.slice(1, closeIdx);
  }
  const colonIdx = trimmed.indexOf(':');
  return colonIdx === -1 ? trimmed : trimmed.slice(0, colonIdx);
}

function isLoopbackHost(rawHost: string): boolean {
  const host = extractHostWithoutPort(rawHost);
  if (!host || host === '0.0.0.0' || host === '::') return false;
  return (
    host === '127.0.0.1' ||
    host === 'localhost' ||
    host === '::1' ||
    host === '0:0:0:0:0:0:0:1' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

function constantTimeTokenMatch(candidate: string, expected: string): boolean {
  if (!candidate || !expected) return false;
  const a = crypto.createHash('sha256').update(String(candidate), 'utf8').digest();
  const b = crypto.createHash('sha256').update(String(expected), 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

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

let cachedIifeSource: string | null = null;

/**
 * Loads the self-contained dist/testudo.iife.js bundle from disk for zero-reload injection.
 */
export function getTestudoIifeSource(): string {
  if (cachedIifeSource) return cachedIifeSource;
  const candidates = [
    path.resolve(__dirname, '../testudo.iife.js'),
    path.resolve(__dirname, '../../dist/testudo.iife.js'),
    path.resolve(process.cwd(), 'packages/testudo-js/dist/testudo.iife.js'),
    path.resolve(process.cwd(), 'dist/testudo.iife.js')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      cachedIifeSource = fs.readFileSync(candidate, 'utf8');
      return cachedIifeSource;
    }
  }
  throw new Error(
    '[Testudo CDP] Could not locate dist/testudo.iife.js. Run "npm run build" in packages/testudo-js first.'
  );
}

// ============================================================================
// Minimal Zero-Dependency RFC 6455 WebSocket Wire Framing (Client & Server)
// ============================================================================

function encodeWsFrame(payload: string | Buffer, masked: boolean, opcode: number = 0x01): Buffer {
  const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const len = data.length;
  let headerLen = 2;
  if (len >= 126 && len < 65536) {
    headerLen = 4;
  } else if (len >= 65536) {
    headerLen = 10;
  }
  const maskOffset = headerLen;
  const totalHeaderLen = masked ? headerLen + 4 : headerLen;
  const frame = Buffer.allocUnsafe(totalHeaderLen + len);

  frame[0] = 0x80 | (opcode & 0x0f); // FIN + opcode
  const maskBit = masked ? 0x80 : 0x00;

  if (len < 126) {
    frame[1] = maskBit | len;
  } else if (len < 65536) {
    frame[1] = maskBit | 126;
    frame.writeUInt16BE(len, 2);
  } else {
    frame[1] = maskBit | 127;
    frame.writeBigUInt64BE(BigInt(len), 2);
  }

  if (masked) {
    const maskKey = crypto.randomBytes(4);
    maskKey.copy(frame, maskOffset);
    for (let i = 0; i < len; i++) {
      frame[totalHeaderLen + i] = data[i] ^ maskKey[i & 3];
    }
  } else {
    data.copy(frame, totalHeaderLen);
  }

  return frame;
}

class MinimalWsConnection extends EventEmitter {
  private socket: Duplex;
  private isClient: boolean;
  private rxBuffer: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentBytes: number = 0;
  private maxPayloadBytes: number;
  public closed: boolean = false;

  constructor(socket: Duplex, isClient: boolean, maxPayloadBytes: number = MAX_WS_PAYLOAD_BYTES) {
    super();
    this.socket = socket;
    this.isClient = isClient;
    this.maxPayloadBytes = maxPayloadBytes;

    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('close', () => {
      if (!this.closed) {
        this.closed = true;
        this.emit('close');
      }
    });
    socket.on('error', (err) => {
      this.emit('error', err);
    });
  }

  public send(text: string): void {
    if (this.closed) {
      throw new Error('[Testudo WS] Cannot send on a closed WebSocket connection.');
    }
    const frame = encodeWsFrame(text, this.isClient, 0x01);
    this.socket.write(frame);
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      const closeFrame = encodeWsFrame(Buffer.alloc(0), this.isClient, 0x08);
      this.socket.write(closeFrame);
    } catch {
      // ignore write error on teardown
    }
    try {
      this.socket.destroy();
    } catch {
      // ignore
    }
    this.emit('close');
  }

  private onData(chunk: Buffer): void {
    if (this.rxBuffer.length + chunk.length > this.maxPayloadBytes + 64) {
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
        if (bigLen > BigInt(this.maxPayloadBytes)) {
          this.close();
          return;
        }
        payloadLen = Number(bigLen);
        offset = 10;
      }

      if (payloadLen > this.maxPayloadBytes) {
        this.close();
        return;
      }

      const maskLen = masked ? 4 : 0;
      const totalFrameLen = offset + maskLen + payloadLen;
      if (this.rxBuffer.length < totalFrameLen) {
        return; // Wait for remaining bytes
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
        // Close frame
        this.close();
        return;
      } else if (opcode === 0x09) {
        // Ping -> send Pong
        if (!this.closed) {
          this.socket.write(encodeWsFrame(payload, this.isClient, 0x0a));
        }
      } else if (opcode === 0x0a) {
        // Pong
      } else if (opcode === 0x01 || opcode === 0x02 || opcode === 0x00) {
        if (this.fragmentBytes + payload.length > this.maxPayloadBytes) {
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

async function connectWebSocketClient(wsUrl: string, timeoutMs: number = 10000): Promise<MinimalWsConnection> {
  const parsed = new URL(wsUrl);
  const key = crypto.randomBytes(16).toString('base64');

  return new Promise<MinimalWsConnection>((resolve, reject) => {
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`[Testudo WS] Connection timed out after ${timeoutMs}ms: ${wsUrl}`));
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
      const conn = new MinimalWsConnection(socket, true);
      if (head && head.length > 0) {
        socket.emit('data', head);
      }
      resolve(conn);
    });

    req.on('response', (res) => {
      clearTimeout(timer);
      reject(new Error(`[Testudo WS] Unexpected HTTP response ${res.statusCode} when upgrading ${wsUrl}`));
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    req.end();
  });
}

function upgradeHttpToWebSocketServer(req: http.IncomingMessage, socket: Duplex, head: Buffer): MinimalWsConnection {
  const key = req.headers['sec-websocket-key'];
  if (!key || typeof key !== 'string') {
    socket.destroy();
    throw new Error('[Testudo WS Server] Missing Sec-WebSocket-Key header');
  }
  const acceptKey = crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');

  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '\r\n'
  ];
  socket.write(responseHeaders.join('\r\n'));
  const conn = new MinimalWsConnection(socket, false);
  if (head && head.length > 0) {
    socket.emit('data', head);
  }
  return conn;
}

// ============================================================================
// 1. TestudoAssistiveBridge (Extension Bridge on ws://127.0.0.1:3851)
// ============================================================================

export interface BrowserTabSummary {
  id: number;
  windowId: number;
  title: string;
  url: string;
  active: boolean;
  groupId?: number;
  status?: string;
}

export interface AssistiveBridgeOptions {
  host?: string;
  port?: number;
  authToken?: string;
  allowRemoteHost?: boolean;
}

export interface AttachTabOptions {
  reload?: boolean;
  mountWidget?: boolean;
  focusOnChallenge?: boolean;
}

export interface OpenBackgroundTabOptions {
  groupTitle?: string;
  groupColor?: 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';
  collapsed?: boolean;
  active?: boolean;
  injectTestudo?: boolean;
}

/**
 * Local WebSocket + HTTP RPC Assistive Bridge Server & Client.
 * Bridges Node.js workflows to the side-loaded Sir Testudo Chrome Extension so everyday
 * Chrome sessions can be augmented in-place without --remote-debugging-port=9222.
 */
export class TestudoAssistiveBridge extends EventEmitter {
  public readonly host: string;
  public readonly port: number;
  public readonly authToken: string;
  private server: http.Server | null = null;
  private extensionClients: Set<MinimalWsConnection> = new Set();
  private pendingRequests: Map<
    number,
    { resolve: (val: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  > = new Map();
  private nextRequestId: number = 1;
  private proxyMode: boolean = false;

  constructor(options: AssistiveBridgeOptions = {}) {
    super();
    this.host = options.host || '127.0.0.1';
    this.port = options.port ?? DEFAULT_ASSISTIVE_BRIDGE_PORT;
    const configuredToken = options.authToken || process.env.TESTUDO_BRIDGE_TOKEN;
    if (!isLoopbackHost(this.host) && (!options.allowRemoteHost || !configuredToken)) {
      throw new Error(
        `[Testudo Assistive Bridge] Refusing to bind bridge to non-loopback host "${this.host}" without explicit allowRemoteHost: true and authToken.`
      );
    }
    this.authToken = configuredToken || crypto.randomBytes(32).toString('hex');
  }

  public getAuthToken(): string {
    return this.authToken;
  }

  private validateBridgeRequest(
    req: http.IncomingMessage,
    allowQueryToken: boolean = false
  ): { ok: boolean; status: number; error?: string } {
    const rawHostHeader = String(req.headers.host || '').trim();
    const reqHost = extractHostWithoutPort(rawHostHeader);
    if (!reqHost || reqHost === '0.0.0.0' || reqHost === '::') {
      return { ok: false, status: 403, error: 'Invalid or forbidden Host header' };
    }
    const expectedHost = extractHostWithoutPort(this.host);
    const hostValid = isLoopbackHost(this.host)
      ? isLoopbackHost(reqHost)
      : reqHost === expectedHost;
    if (!hostValid) {
      return { ok: false, status: 403, error: 'Host header mismatch (DNS rebinding guard)' };
    }

    const originHeader = req.headers.origin;
    if (originHeader !== undefined) {
      const originStr = String(originHeader).trim();
      if (!originStr.startsWith('chrome-extension://') && !originStr.startsWith('moz-extension://')) {
        return { ok: false, status: 403, error: 'Forbidden Origin header' };
      }
    }

    let providedToken = '';
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      providedToken = authHeader.slice('Bearer '.length).trim();
    } else if (typeof req.headers['x-testudo-token'] === 'string') {
      providedToken = req.headers['x-testudo-token'].trim();
    } else if (allowQueryToken && req.url) {
      try {
        const parsedUrl = new URL(req.url, `http://127.0.0.1:${this.port || 80}`);
        providedToken = (parsedUrl.searchParams.get('token') || '').trim();
      } catch {
        providedToken = '';
      }
    }

    if (!constantTimeTokenMatch(providedToken, this.authToken)) {
      return { ok: false, status: 401, error: 'Missing or invalid bridge bearer token' };
    }

    return { ok: true, status: 200 };
  }

  /**
   * Starts the local bridge server, or switches into HTTP RPC client mode if another process
   * is already hosting the bridge on the target port.
   */
  public async start(): Promise<{ mode: 'server' | 'client'; port: number; authToken: string }> {
    if (this.server) {
      return { mode: 'server', port: this.port, authToken: this.authToken };
    }

    const server = http.createServer(async (req, res) => {
      const authCheck = this.validateBridgeRequest(req, false);
      if (!authCheck.ok) {
        res.writeHead(authCheck.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: authCheck.error }));
        return;
      }

      const urlPath = (req.url || '/').split('?')[0];

      if (req.method === 'GET' && urlPath === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            extensionConnected: this.extensionClients.size > 0,
            connectedClients: this.extensionClients.size,
            port: this.port
          })
        );
        return;
      }

      if (req.method === 'GET' && urlPath === '/iife.js') {
        try {
          const src = getTestudoIifeSource();
          res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
          res.end(src);
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
        }
        return;
      }

      if (req.method === 'POST' && urlPath === '/rpc') {
        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        let aborted = false;

        req.on('data', (chunk: Buffer) => {
          if (aborted) return;
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          receivedBytes += buf.length;
          if (receivedBytes > MAX_HTTP_BODY_BYTES) {
            aborted = true;
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Payload Too Large' }));
            req.destroy();
            return;
          }
          chunks.push(buf);
        });
        req.on('end', async () => {
          if (aborted) return;
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            const parsed = JSON.parse(body || '{}');
            const result = await this.sendCommand(parsed.command, parsed.params || {}, parsed.timeoutMs ?? 30000);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, result }));
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
          }
        });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Not found' }));
    });

    server.headersTimeout = 10000;
    server.requestTimeout = 35000;

    server.on('upgrade', (req, socket, head) => {
      try {
        const urlPath = (req.url || '/').split('?')[0];
        if (urlPath !== '/ws') {
          socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        const authCheck = this.validateBridgeRequest(req, true);
        if (!authCheck.ok) {
          const statusLine = authCheck.status === 401 ? '401 Unauthorized' : '403 Forbidden';
          socket.write(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\n\r\n`);
          socket.destroy();
          return;
        }

        const wsConn = upgradeHttpToWebSocketServer(req, socket, head);
        this.extensionClients.add(wsConn);
        this.emit('extension-connected', { clients: this.extensionClients.size });

        wsConn.on('message', (raw: string) => {
          this.handleExtensionMessage(wsConn, raw);
        });

        wsConn.on('close', () => {
          this.extensionClients.delete(wsConn);
          this.emit('extension-disconnected', { clients: this.extensionClients.size });
        });
      } catch {
        socket.destroy();
      }
    });

    return new Promise((resolve, reject) => {
      server.once('error', (err: any) => {
        if (err && err.code === 'EADDRINUSE') {
          this.proxyMode = true;
          resolve({ mode: 'client', port: this.port, authToken: this.authToken });
        } else {
          reject(err);
        }
      });

      server.listen(this.port, this.host, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          (this as any).port = addr.port;
        }
        this.server = server;
        this.proxyMode = false;
        resolve({ mode: 'server', port: this.port, authToken: this.authToken });
      });
    });
  }

  public isExtensionConnected(): boolean {
    return this.extensionClients.size > 0;
  }

  public async getStatus(): Promise<{ ok: boolean; extensionConnected: boolean; connectedClients: number; port: number }> {
    if (!this.proxyMode && this.server) {
      return {
        ok: true,
        extensionConnected: this.extensionClients.size > 0,
        connectedClients: this.extensionClients.size,
        port: this.port
      };
    }

    return new Promise((resolve) => {
      const req = http.get(
        {
          hostname: this.host,
          port: this.port,
          path: '/status',
          timeout: 1500,
          headers: {
            Authorization: `Bearer ${this.authToken}`
          }
        },
        (res) => {
          const chunks: Buffer[] = [];
          let totalBytes = 0;
          res.on('data', (chunk: Buffer) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            totalBytes += buf.length;
            if (totalBytes <= MAX_HTTP_BODY_BYTES) {
              chunks.push(buf);
            }
          });
          res.on('end', () => {
            if (res.statusCode !== 200 || totalBytes > MAX_HTTP_BODY_BYTES) {
              resolve({ ok: false, extensionConnected: false, connectedClients: 0, port: this.port });
              return;
            }
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch {
              resolve({ ok: false, extensionConnected: false, connectedClients: 0, port: this.port });
            }
          });
        }
      );
      req.on('error', () => {
        resolve({ ok: false, extensionConnected: false, connectedClients: 0, port: this.port });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, extensionConnected: false, connectedClients: 0, port: this.port });
      });
    });
  }

  public async waitForExtension(timeoutMs: number = 10000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await this.getStatus();
      if (status.extensionConnected) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  private handleExtensionMessage(_wsConn: MinimalWsConnection, raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'event') {
      if (typeof msg.event === 'string' && ALLOWED_EXTENSION_EVENTS.has(msg.event)) {
        this.emit(msg.event, msg.payload);
      }
      return;
    }

    if (typeof msg.id === 'number') {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(String(msg.error)));
        } else {
          pending.resolve(msg.result);
        }
      }
    }
  }

  public async sendCommand<T = any>(command: string, params: Record<string, any> = {}, timeoutMs: number = 30000): Promise<T> {
    if (this.proxyMode) {
      return new Promise<T>((resolve, reject) => {
        const body = JSON.stringify({ command, params, timeoutMs });
        const req = http.request(
          {
            hostname: this.host,
            port: this.port,
            path: '/rpc',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              Authorization: `Bearer ${this.authToken}`
            },
            timeout: timeoutMs + 2000
          },
          (res) => {
            const chunks: Buffer[] = [];
            let totalBytes = 0;
            res.on('data', (chunk: Buffer) => {
              const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              totalBytes += buf.length;
              if (totalBytes > MAX_HTTP_BODY_BYTES) {
                req.destroy(new Error('[Testudo Bridge] RPC response exceeded MAX_HTTP_BODY_BYTES'));
                return;
              }
              chunks.push(buf);
            });
            res.on('end', () => {
              try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if (!parsed.ok) {
                  reject(new Error(parsed.error || `[Testudo Bridge] RPC ${command} failed`));
                } else {
                  resolve(parsed.result as T);
                }
              } catch (err) {
                reject(err);
              }
            });
          }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
      });
    }

    const client = Array.from(this.extensionClients)[0];
    if (!client) {
      throw new Error(
        `[Testudo Assistive Bridge] No Chrome Extension connected on ws://${this.host}:${this.port}. Load packages/testudo-js/extension in Chrome.`
      );
    }

    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`[Testudo Assistive Bridge] Command "${command}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      client.send(JSON.stringify({ id, command, params }));
    });
  }

  /**
   * Lists all open tabs across the user's Chrome session without disrupting focus.
   */
  public async listTabs(): Promise<BrowserTabSummary[]> {
    return this.sendCommand<BrowserTabSummary[]>('LIST_TABS');
  }

  /**
   * Attaches to an existing open tab by tabId or URL substring.
   * By default (reload: false), hot-injects Testudo-JS into the live DOM without reloading,
   * preserving scroll position, modals, and form inputs.
   * When reload: true, reloads the tab and injects Testudo-JS immediately on load complete.
   */
  public async attachExistingTab(
    tabIdOrUrlPattern: number | string,
    options: AttachTabOptions = {}
  ): Promise<{ tabId: number; url: string; title: string; reloaded: boolean; injected: boolean }> {
    let targetTabId: number;
    if (typeof tabIdOrUrlPattern === 'number') {
      targetTabId = tabIdOrUrlPattern;
    } else {
      const tabs = await this.listTabs();
      const match = tabs.find(
        (t) =>
          (t.url && t.url.includes(tabIdOrUrlPattern)) ||
          (t.title && t.title.toLowerCase().includes(tabIdOrUrlPattern.toLowerCase()))
      );
      if (!match) {
        throw new Error(`[Testudo Assistive Bridge] No existing tab matched "${tabIdOrUrlPattern}".`);
      }
      targetTabId = match.id;
    }

    const command = options.reload ? 'RELOAD_AND_INJECT_TAB' : 'INJECT_TAB_NO_RELOAD';
    return this.sendCommand(command, {
      tabId: targetTabId,
      mountWidget: options.mountWidget ?? false,
      focusOnChallenge: options.focusOnChallenge ?? true,
      iifeSource: getTestudoIifeSource()
    });
  }

  /**
   * Opens a background tab inside a collapsed "[Testudo Agent]" tab group (active: false)
   * so background research or multi-page verification never steals focus from the user's active tab.
   */
  public async openBackgroundTab(
    url: string,
    options: OpenBackgroundTabOptions = {}
  ): Promise<{ tabId: number; groupId?: number; url: string }> {
    return this.sendCommand('OPEN_BACKGROUND_TAB_GROUP', {
      url,
      groupTitle: options.groupTitle ?? '[Testudo Agent]',
      groupColor: options.groupColor ?? 'orange',
      collapsed: options.collapsed ?? true,
      active: options.active ?? false,
      injectTestudo: options.injectTestudo ?? true,
      iifeSource: getTestudoIifeSource()
    });
  }

  /**
   * Evaluates an expression or function inside the specified tab's MAIN world where window.$T lives.
   */
  public async evaluateInTab<T = any>(tabId: number, fnOrExpression: string | ((...args: any[]) => T), ...args: any[]): Promise<T> {
    const expression =
      typeof fnOrExpression === 'function'
        ? `(${fnOrExpression.toString()})(...${JSON.stringify(args)})`
        : String(fnOrExpression);

    return this.sendCommand<T>('EVALUATE_TESTUDO', {
      tabId,
      expression
    });
  }

  /**
   * Executes a multi-step $T.workflow inside the target tab, automatically pausing for human
   * assistance if a CAPTCHA, Cloudflare Turnstile, or 2FA prompt is detected.
   */
  public async runWorkflowInTab(
    tabId: number,
    name: string,
    steps: WorkflowStep[],
    options: WorkflowRunOptions = {}
  ): Promise<WorkflowReport> {
    return this.sendCommand<WorkflowReport>(
      'RUN_WORKFLOW',
      {
        tabId,
        name,
        steps,
        options
      },
      (options.challengeTimeoutMs ?? 300000) + 30000
    );
  }

  /**
   * Captures a complete Sir Testudo Concierge semantic DOM & challenge snapshot from the tab.
   */
  public async snapshotTab(tabId: number): Promise<ConciergeScreenSnapshot> {
    return this.evaluateInTab<ConciergeScreenSnapshot>(tabId, () => {
      const w = window as any;
      if (!w.$T || !w.$T.concierge) {
        throw new Error('[Testudo] window.$T.concierge is not initialized in this tab');
      }
      return w.$T.concierge.snapshotScreen();
    });
  }

  /**
   * Closes a specific tab opened by the agent.
   */
  public async closeTab(tabId: number): Promise<void> {
    await this.sendCommand('CLOSE_TAB', { tabId });
  }

  /**
   * Attaches MV3 chrome.debugger on-demand to a live tab for closed-Shadow piercing and isTrusted:true CDP input.
   */
  public async attachDebugger(tabId: number, protocolVersion: string = '1.3'): Promise<{ attached: boolean; tabId: number; protocolVersion: string }> {
    return this.sendCommand('ATTACH_DEBUGGER', { tabId, protocolVersion });
  }

  /**
   * Sends a privileged CDP command via MV3 chrome.debugger to a live tab (supports autoDetach: true).
   */
  public async sendCdp<T = any>(
    tabId: number,
    method: string,
    commandParams: Record<string, any> = {},
    options: { autoDetach?: boolean } = {}
  ): Promise<T> {
    return this.sendCommand<T>('SEND_CDP_COMMAND', {
      tabId,
      method,
      commandParams,
      autoDetach: Boolean(options.autoDetach)
    });
  }

  /**
   * Detaches MV3 chrome.debugger from a tab immediately so Chrome's top debugger banner clears.
   */
  public async detachDebugger(tabId: number): Promise<{ detached: boolean; tabId: number }> {
    return this.sendCommand('DETACH_DEBUGGER', { tabId });
  }

  public async close(): Promise<void> {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('[Testudo Assistive Bridge] Bridge closed'));
    }
    this.pendingRequests.clear();

    for (const client of this.extensionClients) {
      client.close();
    }
    this.extensionClients.clear();

    if (this.server) {
      const srv = this.server;
      this.server = null;
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  }
}

// ============================================================================
// 2. TestudoCdpSession & TestudoCdp (Direct Native WebSocket CDP Driver)
// ============================================================================

export interface ChildOopifSessionInfo {
  sessionId: string;
  targetId: string;
  type: string;
  title: string;
  url: string;
}

export interface ObservedCookieSummary {
  name: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
  blindedValueHash: string;
}

export interface LiveWireRequestRecord {
  requestId: string;
  sessionId?: string;
  url: string;
  method: string;
  status: number;
  mimeType: string;
  tlsProtocol: string;
  tlsCipher: string;
  scrubbedRequestHeaders: Record<string, string>;
  scrubbedResponseHeaders: Record<string, string>;
  cookiesObserved: ObservedCookieSummary[];
  serverTimingHeader?: string;
  timingUs: {
    dnsUs: number;
    tcpUs: number;
    tlsUs: number;
    sendUs: number;
    ttfbUs: number;
  };
}

export interface LiveWireCaptureReport {
  capturedRequests: LiveWireRequestRecord[];
  nativeIntrinsicsUntouched: boolean;
}

export interface SpiderLayerNode {
  layerKind: 'root-page' | 'same-origin-frame' | 'cross-origin-oopif' | 'shadow-root';
  frameId?: string;
  sessionId?: string;
  url?: string;
  shadowMode?: 'open' | 'closed';
  hostTag?: string;
  hostId?: string;
  interactiveCount: number;
  children: SpiderLayerNode[];
}

export interface FullBrowserXrayReport extends ElementXrayReport {
  cdpSessionId?: string;
  closedShadowAncestry: ShadowBoundaryHop[];
  privilegedFrameAncestry: Array<{
    frameId: string;
    parentId?: string;
    url: string;
    securityOrigin: string;
    isCrossOriginOopif: boolean;
  }>;
}

export interface VirtualAuthenticatorOptions {
  protocol?: 'ctap2' | 'u2f';
  transport?: 'usb' | 'nfc' | 'ble' | 'cable' | 'internal';
  hasResidentKey?: boolean;
  hasUserVerification?: boolean;
  isUserVerified?: boolean;
  automaticPresenceSimulation?: boolean;
}

export interface CdpTargetInfo {
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

export interface CdpConnectOptions {
  host?: string;
  port?: number;
  /**
   * Attach to an existing open tab matching this URL substring or title instead of opening a new window.
   */
  targetUrlPattern?: string;
  /**
   * Attach to a specific targetId.
   */
  targetId?: string;
  /**
   * Initial URL when creating a new target.
   */
  url?: string;
  /**
   * Rule 13 Window Isolation: defaults to true when creating a new target so existing tabs are untouched.
   */
  newWindow?: boolean;
  /**
   * When attaching to an existing tab, whether to reload the page before injecting Testudo (default: false).
   */
  reloadOnAttach?: boolean;
  /**
   * Automatically inject dist/testudo.iife.js on attach and on every new document navigation (default: true).
   */
  autoInjectTestudo?: boolean;
}

export interface HeadlessLaunchOptions {
  executablePath?: string;
  url?: string;
  width?: number;
  height?: number;
  extraArgs?: string[];
  autoInjectTestudo?: boolean;
  /**
   * Explicit opt-in for --no-sandbox / --disable-setuid-sandbox in constrained container environments.
   * Defaults to false so OS sandboxing remains active by default.
   */
  unsafeNoSandbox?: boolean;
  /**
   * Explicit opt-in for --allow-file-access-from-files. Defaults to false.
   */
  allowFileAccessFromFiles?: boolean;
}

/**
 * Resolves a local Chrome/Chromium executable on Linux/macOS for zero-dependency headless execution.
 */
export function resolveLocalChromeExecutable(explicitPath?: string): string {
  if (explicitPath && fs.existsSync(explicitPath)) {
    return explicitPath;
  }
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  // Check Puppeteer cache directory (~/.cache/puppeteer/chrome/...)
  const puppeteerCacheRoot = path.join(os.homedir(), '.cache/puppeteer/chrome');
  if (fs.existsSync(puppeteerCacheRoot)) {
    try {
      const versions = fs.readdirSync(puppeteerCacheRoot).sort().reverse();
      for (const ver of versions) {
        const candidate = path.join(puppeteerCacheRoot, ver, 'chrome-linux64/chrome');
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    } catch {
      // ignore read errors
    }
  }

  const systemCandidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium'
  ];
  for (const candidate of systemCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    '[Testudo CDP] Could not locate a local Chrome binary. Set CHROME_PATH or install Chrome.'
  );
}

async function fetchJson<T = any>(url: string, method: string = 'GET', timeoutMs: number = 5000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const parsed = new URL(url);
    let settled = false;
    const req = http.request(
      {
        hostname: parsed.hostname || '127.0.0.1',
        port: Number(parsed.port || 80),
        path: `${parsed.pathname}${parsed.search}`,
        method,
        timeout: timeoutMs
      },
      (res) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        res.on('data', (chunk: Buffer | string) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buf.length;
          if (totalBytes > MAX_HTTP_BODY_BYTES) {
            if (!settled) {
              settled = true;
              res.destroy();
              req.destroy();
              reject(new Error(`[Testudo CDP] HTTP response from ${url} exceeded ${MAX_HTTP_BODY_BYTES} bytes`));
            }
            return;
          }
          chunks.push(buf);
        });
        res.on('end', () => {
          if (settled) return;
          settled = true;
          const data = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            reject(new Error(`[Testudo CDP] Invalid JSON from ${url}: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    req.on('timeout', () => {
      if (!settled) {
        settled = true;
        req.destroy();
        reject(new Error(`[Testudo CDP] HTTP request timed out: ${url}`));
      }
    });
    req.end();
  });
}

/**
 * Direct Native Chrome DevTools Protocol Session powered by Testudo-JS ($T).
 */
export class TestudoCdpSession extends EventEmitter {
  private ws: MinimalWsConnection;
  public readonly targetId: string;
  public readonly ownsTarget: boolean;
  public readonly browserWsUrl?: string;
  private childProcess?: ChildProcess;
  private userDataDir?: string;
  private autoInjectTestudo: boolean;
  private nextCommandId: number = 1;
  private pendingCommands: Map<
    number,
    { resolve: (val: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  > = new Map();
  private childSessions: Map<string, ChildOopifSessionInfo> = new Map();
  private frameDefaultContexts: Map<string, { contextId: number; sessionId?: string; origin: string }> = new Map();
  private enclaveProbeSource: string = '';
  private liveWireRequests: Map<string, LiveWireRequestRecord> = new Map();
  private liveWireEnabled: boolean = false;
  private activeAuthenticatorId?: string;
  private closed: boolean = false;

  constructor(params: {
    ws: MinimalWsConnection;
    targetId: string;
    ownsTarget: boolean;
    browserWsUrl?: string;
    childProcess?: ChildProcess;
    userDataDir?: string;
    autoInjectTestudo?: boolean;
  }) {
    super();
    this.ws = params.ws;
    this.targetId = params.targetId;
    this.ownsTarget = params.ownsTarget;
    this.browserWsUrl = params.browserWsUrl;
    this.childProcess = params.childProcess;
    this.userDataDir = params.userDataDir;
    this.autoInjectTestudo = params.autoInjectTestudo ?? true;

    this.ws.on('message', (raw: string) => this.handleMessage(raw));
    this.ws.on('close', () => {
      this.closed = true;
      for (const [, pending] of this.pendingCommands) {
        clearTimeout(pending.timer);
        pending.reject(new Error('[Testudo CDP] WebSocket connection closed'));
      }
      this.pendingCommands.clear();
      this.childSessions.clear();
      this.frameDefaultContexts.clear();
    });
  }

  private bootstrapChildOopifSession(sessionId: string): void {
    void (async () => {
      try {
        await this.send('Page.enable', {}, 5000, sessionId).catch(() => {});
        await this.send('Runtime.enable', {}, 5000, sessionId).catch(() => {});
        await this.send('DOM.enable', {}, 5000, sessionId).catch(() => {});
        if (this.liveWireEnabled) {
          await this.send('Network.enable', {}, 5000, sessionId).catch(() => {});
        }
        if (this.enclaveProbeSource) {
          await this.send(
            'Page.addScriptToEvaluateOnNewDocument',
            { source: this.enclaveProbeSource, worldName: 'TestudoEnclave' },
            5000,
            sessionId
          ).catch(() => {});
        }
        if (this.autoInjectTestudo) {
          const iifeSource = getTestudoIifeSource();
          await this.send('Page.addScriptToEvaluateOnNewDocument', { source: iifeSource }, 5000, sessionId).catch(() => {});
          await this.send(
            'Runtime.evaluate',
            { expression: iifeSource, awaitPromise: false, returnByValue: false },
            5000,
            sessionId
          ).catch(() => {});
        }
      } catch {
        // child target may have detached during rapid navigation
      }
    })();
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
        if (msg.error) {
          pending.reject(new Error(`[CDP Error ${msg.error.code}] ${msg.error.message}`));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    if (msg.method === 'Target.attachedToTarget' && msg.params?.sessionId) {
      const sId = String(msg.params.sessionId);
      const tInfo = msg.params.targetInfo || {};
      this.childSessions.set(sId, {
        sessionId: sId,
        targetId: String(tInfo.targetId || ''),
        type: String(tInfo.type || 'iframe'),
        title: String(tInfo.title || ''),
        url: String(tInfo.url || '')
      });
      if (tInfo.type === 'iframe' || tInfo.type === 'page') {
        this.bootstrapChildOopifSession(sId);
      }
    } else if (msg.method === 'Target.detachedFromTarget' && msg.params?.sessionId) {
      const sId = String(msg.params.sessionId);
      this.childSessions.delete(sId);
      for (const [fId, ctx] of this.frameDefaultContexts) {
        if (ctx.sessionId === sId) this.frameDefaultContexts.delete(fId);
      }
    } else if (msg.method === 'Target.targetInfoChanged' && msg.params?.targetInfo) {
      const tInfo = msg.params.targetInfo;
      for (const [, existing] of this.childSessions) {
        if (existing.targetId === tInfo.targetId) {
          existing.url = String(tInfo.url || existing.url);
          existing.title = String(tInfo.title || existing.title);
        }
      }
    } else if (msg.method === 'Runtime.executionContextCreated' && msg.params?.context) {
      const ctx = msg.params.context;
      const frameId = ctx.auxData?.frameId;
      if (frameId && ctx.auxData?.isDefault) {
        this.frameDefaultContexts.set(String(frameId), {
          contextId: Number(ctx.id),
          sessionId: msg.sessionId ? String(msg.sessionId) : undefined,
          origin: String(ctx.origin || '')
        });
      }
    } else if (msg.method === 'Page.loadEventFired' && msg.sessionId && this.autoInjectTestudo) {
      const sId = String(msg.sessionId);
      const iifeSource = getTestudoIifeSource();
      this.send(
        'Runtime.evaluate',
        { expression: iifeSource, awaitPromise: false, returnByValue: false },
        5000,
        sId
      ).catch(() => {});
    }

    if (msg.method) {
      this.emit(msg.method, msg.params, msg.sessionId);
    }
  }

  public async send<T = any>(
    method: string,
    params: Record<string, any> = {},
    timeoutMs: number = 30000,
    sessionId?: string
  ): Promise<T> {
    if (this.closed) {
      throw new Error(`[Testudo CDP] Cannot send ${method}: session is closed.`);
    }
    const id = this.nextCommandId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error(`[Testudo CDP] Command ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingCommands.set(id, { resolve, reject, timer });
      const payload: Record<string, any> = { id, method, params };
      if (sessionId) {
        payload.sessionId = sessionId;
      }
      this.ws.send(JSON.stringify(payload));
    });
  }

  /**
   * Enables Page, Runtime, DOM, and flattened OOPIF auto-attach, registering Testudo-JS IIFE
   * for preload as well as immediate zero-reload execution in the current document.
   */
  public async initializeTestudo(options: { reload?: boolean } = {}): Promise<void> {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('DOM.enable').catch(() => {});
    await this.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true
    }).catch(() => {});

    if (!this.autoInjectTestudo) {
      return;
    }

    const iifeSource = getTestudoIifeSource();
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source: iifeSource });

    if (options.reload) {
      await this.reloadAndInject();
    } else {
      await this.injectTestudo();
    }
  }

  /**
   * Injects dist/testudo.iife.js into the active page WITHOUT reloading, preserving
   * all scroll state, open modals, and form inputs.
   */
  public async injectTestudo(sessionId?: string): Promise<boolean> {
    const iifeSource = getTestudoIifeSource();
    await this.send(
      'Runtime.evaluate',
      {
        expression: iifeSource,
        awaitPromise: false,
        returnByValue: false
      },
      15000,
      sessionId
    );
    const check = await this.evaluateInSession(sessionId, () => Boolean((window as any).$T));
    return Boolean(check);
  }

  /**
   * Reloads the current page and ensures window.$T is injected immediately after load.
   */
  public async reloadAndInject(timeoutMs: number = 15000): Promise<boolean> {
    const loadPromise = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.once('Page.loadEventFired', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await this.send('Page.reload', { ignoreCache: false });
    await loadPromise;
    return this.injectTestudo();
  }

  /**
   * Navigates the target to a URL and injects Testudo-JS once loaded (if autoInjectTestudo is true).
   */
  public async goto(url: string, options: { timeoutMs?: number } = {}): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 20000;
    const loadPromise = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      const onLoad = (_params: any, evtSessionId?: string) => {
        if (!evtSessionId) {
          clearTimeout(timer);
          this.removeListener('Page.loadEventFired', onLoad);
          resolve();
        }
      };
      this.on('Page.loadEventFired', onLoad);
    });
    await this.send('Page.navigate', { url });
    await loadPromise;
    if (this.autoInjectTestudo) {
      await this.injectTestudo();
    }
  }

  /**
   * Sets the full HTML content of the page and injects Testudo-JS.
   * Ideal for fast unit/integration tests and benchmark harnesses without an HTTP server.
   */
  public async setContent(html: string, _options?: { waitUntil?: string }): Promise<void> {
    const frameTree = await this.send<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree');
    const frameId = frameTree?.frameTree?.frame?.id;
    if (frameId) {
      await this.send('Page.setDocumentContent', { frameId, html });
    } else {
      await this.evaluate((markup: string) => {
        document.open();
        document.write(markup);
        document.close();
      }, html);
    }
    await new Promise((r) => setTimeout(r, 15));
    await this.injectTestudo();
  }

  private async evaluateInSession<T = any>(
    sessionId: string | undefined,
    fnOrExpression: string | ((...args: any[]) => T | Promise<T>),
    ...args: any[]
  ): Promise<T> {
    const expression =
      typeof fnOrExpression === 'function'
        ? `(${fnOrExpression.toString()})(...${JSON.stringify(args)})`
        : String(fnOrExpression);

    const res = await this.send<{
      result: { type: string; value?: T; description?: string };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    }>(
      'Runtime.evaluate',
      {
        expression,
        awaitPromise: true,
        returnByValue: true
      },
      30000,
      sessionId
    );

    if (res.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`[Testudo CDP Evaluate Error] ${desc}`);
    }

    return res.result?.value as T;
  }

  /**
   * Evaluates a function or JS expression inside the browser page and returns its serialized value.
   */
  public async evaluate<T = any>(fnOrExpression: string | ((...args: any[]) => T | Promise<T>), ...args: any[]): Promise<T> {
    return this.evaluateInSession(undefined, fnOrExpression, ...args);
  }

  /**
   * Dispatches a hardware-routed Blink mouse click at viewport coordinates (x, y) so event.isTrusted === true.
   */
  public async dispatchTrustedClickAt(x: number, y: number): Promise<void> {
    const rx = Math.round(x * 100) / 100;
    const ry = Math.round(y * 100) / 100;
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: rx,
      y: ry,
      button: 'none',
      buttons: 0
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: rx,
      y: ry,
      button: 'left',
      buttons: 1,
      clickCount: 1
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: rx,
      y: ry,
      button: 'left',
      buttons: 0,
      clickCount: 1
    });
  }

  /**
   * Dispatches hardware-routed Blink keystrokes so keydown/beforeinput/input/keyup carry event.isTrusted === true.
   */
  public async dispatchTrustedKeyText(text: string): Promise<void> {
    for (const ch of Array.from(String(text))) {
      await this.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: ch,
        unmodifiedText: ch,
        key: ch
      });
      await this.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: ch
      });
    }
  }

  /**
   * Framework-safe click via $T.click(selector) by default, or Blink hardware-routed isTrusted:true click when options.trusted === true.
   */
  public async click(selector: string, options?: { trusted?: boolean }): Promise<void> {
    if (options?.trusted) {
      if (selector.includes('>>>')) {
        await this.pierceClick(selector, { trusted: true });
        return;
      }
      const coords = await this.evaluate((sel: string) => {
        const w = window as any;
        const el = (w.$T ? w.$T.scan.resolveElement(sel) : document.querySelector(sel)) as HTMLElement | null;
        if (!el) throw new Error(`[Testudo] Element not found for trusted click: ${sel}`);
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

  /**
   * Framework-safe typing via $T.type(selector, text, options), or Blink hardware-routed isTrusted:true typing when options.trusted === true.
   */
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
          if (!el) throw new Error(`[Testudo] Element not found for trusted type: ${sel}`);
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

  /**
   * Framework-safe <select> and custom ARIA combobox selection via $T.select(selector, value).
   */
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

  /**
   * Reads trimmed text or input value of an element.
   */
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

  /**
   * Compatibility locator shim so legacy Playwright-bridge helpers (createPlaywrightTestudo)
   * execute natively over TestudoCdpSession with zero Playwright dependency.
   */
  public locator(selector: string) {
    return {
      count: async (): Promise<number> => {
        return this.evaluate((sel: string) => document.querySelectorAll(sel).length, selector);
      },
      click: async (): Promise<void> => {
        await this.click(selector);
      },
      fill: async (text: string): Promise<void> => {
        await this.type(selector, text, { clear: true, delay: 0 });
      },
      pressSequentially: async (text: string, options?: { delay?: number }): Promise<void> => {
        await this.type(selector, text, { clear: false, delay: options?.delay ?? 0 });
      },
      selectOption: async (value: string): Promise<void> => {
        await this.select(selector, value);
      },
      innerText: async (): Promise<string> => {
        return (await this.textContent(selector)) ?? '';
      },
      textContent: async (): Promise<string | null> => {
        return this.textContent(selector);
      }
    };
  }

  /**
   * Polls a predicate inside the page until it returns a truthy value or times out.
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
        // retry while page or script is still loading
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`[Testudo CDP] waitForFunction timed out after ${timeoutMs}ms`);
  }

  /**
   * Waits until an element matching selector appears in the DOM.
   */
  public async waitForSelector(selector: string, options: { timeout?: number } = {}): Promise<void> {
    await this.waitForFunction(
      (sel: string) => Boolean(document.querySelector(sel)),
      { timeout: options.timeout ?? 5000 },
      selector
    );
  }

  /**
   * Evaluates a function against the first DOM element matching selector.
   */
  public async $eval<T = any>(
    selector: string,
    pageFunction: (el: Element, ...args: any[]) => T | Promise<T>,
    ...args: any[]
  ): Promise<T> {
    const fnStr = pageFunction.toString();
    return this.evaluate(
      async (sel: string, serializedFn: string, extraArgs: any[]) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`[Testudo CDP] $eval failed: selector "${sel}" not found`);
        const fn = new Function('return (' + serializedFn + ')')();
        return await fn(el, ...extraArgs);
      },
      selector,
      fnStr,
      args
    );
  }

  /**
   * Injects a <script> tag by URL, file path, or inline content into the page.
   */
  public async addScriptTag(options: { url?: string; path?: string; content?: string }): Promise<void> {
    if (options.path) {
      const code = fs.readFileSync(options.path, 'utf8');
      await this.send('Runtime.evaluate', { expression: code, awaitPromise: false });
      return;
    }
    if (options.content) {
      await this.send('Runtime.evaluate', { expression: options.content, awaitPromise: false });
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
   * Sets exact viewport dimensions via CDP Emulation.setDeviceMetricsOverride.
   */
  public async setViewport(options: { width: number; height: number; deviceScaleFactor?: number }): Promise<void> {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: options.width,
      height: options.height,
      deviceScaleFactor: options.deviceScaleFactor ?? 1,
      mobile: false
    }).catch(() => {});
  }

  /**
   * Executes Rule 13 non-monotonic "double-take" kinetic scrolling inside the page.
   */
  public async kineticScroll(options?: KineticScrollOptions): Promise<KineticScrollResult> {
    return this.evaluate(async (opts: any) => {
      const w = window as any;
      if (!w.$T?.kinetic) throw new Error('[Testudo] window.$T.kinetic not initialized');
      return w.$T.kinetic.scrollFeed(opts);
    }, options || {});
  }

  /**
   * Expands all truncated text toggles ("...more", "See more") in a single DOM pass.
   */
  public async expandAll(options?: ExpandAllOptions): Promise<{ clickedCount: number; matchedTexts: string[] }> {
    return this.evaluate((opts: any) => {
      const w = window as any;
      if (!w.$T?.kinetic) throw new Error('[Testudo] window.$T.kinetic not initialized');
      return w.$T.kinetic.expandAll(opts || {});
    }, options || {});
  }

  /**
   * Waits for a Rule 13 prime/odd power-user think pause with sub-second jitter.
   */
  public async thinkPause(options?: ThinkPauseOptions): Promise<{ plannedMs: number; waitedMs: number }> {
    return this.evaluate(async (opts: any) => {
      const w = window as any;
      if (!w.$T?.kinetic) throw new Error('[Testudo] window.$T.kinetic not initialized');
      return w.$T.kinetic.thinkPause(opts || {});
    }, options || {});
  }

  /**
   * Runs a full multi-step $T.workflow inside the page, including automatic CAPTCHA/2FA human-assist pause/resume.
   */
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

  /**
   * Returns a complete Sir Testudo Concierge screen snapshot (scanned elements, active challenge state, error badges).
   */
  public async conciergeSnapshot(): Promise<ConciergeScreenSnapshot> {
    return this.evaluate(() => {
      const w = window as any;
      if (!w.$T?.concierge) throw new Error('[Testudo] window.$T.concierge not initialized');
      return w.$T.concierge.snapshotScreen();
    });
  }

  /**
   * Detects whether a CAPTCHA, Cloudflare Turnstile, or 2FA challenge is currently blocking the page.
   */
  public async detectChallenge(): Promise<ChallengeDetectionResult> {
    return this.evaluate(() => {
      const w = window as any;
      if (!w.$T?.concierge) throw new Error('[Testudo] window.$T.concierge not initialized');
      return w.$T.concierge.detectChallenge();
    });
  }

  /**
   * Captures a PNG or JPEG screenshot via CDP Page.captureScreenshot.
   */
  public async screenshot(options: { path?: string; format?: 'png' | 'jpeg'; type?: 'png' | 'jpeg'; fullPage?: boolean } = {}): Promise<Buffer> {
    const format = options.format ?? options.type ?? 'png';
    const res = await this.send<{ data: string }>('Page.captureScreenshot', {
      format,
      captureBeyondViewport: options.fullPage ?? false
    });
    const buf = Buffer.from(res.data, 'base64');
    if (options.path) {
      writeFileAtomicSync(options.path, buf);
    }
    return buf;
  }

  /**
   * Renders the current page to a PDF buffer via CDP Page.printToPDF.
   */
  public async pdf(options: { path?: string; printBackground?: boolean } = {}): Promise<Buffer> {
    const res = await this.send<{ data: string }>('Page.printToPDF', {
      printBackground: options.printBackground ?? true
    });
    const buf = Buffer.from(res.data, 'base64');
    if (options.path) {
      writeFileAtomicSync(options.path, buf);
    }
    return buf;
  }

  /**
   * Rule 19 Split-World Zero-Trust Enclave + OOPIF Cross-Origin Auto-Attach:
   * Pre-registers the <4KB surgical W3C probe inside 'TestudoEnclave' IsolatedWorld across
   * both root frames and out-of-process cross-origin iframes (Target.setAutoAttach flatten:true).
   */
  public async enableSplitWorldEnclave(probeScriptSource: string): Promise<{ scriptIdentifier: string }> {
    this.enclaveProbeSource = probeScriptSource;
    await this.send('Page.enable', {}).catch(() => {});
    await this.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true
    }).catch(() => {});
    const reg = await this.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', {
      source: probeScriptSource,
      worldName: 'TestudoEnclave'
    });
    for (const [sId] of this.childSessions) {
      await this.send(
        'Page.addScriptToEvaluateOnNewDocument',
        { source: probeScriptSource, worldName: 'TestudoEnclave' },
        5000,
        sId
      ).catch(() => {});
    }
    return { scriptIdentifier: reg.identifier || 'testudo-enclave-1' };
  }

  /**
   * Rule 19 Surgical Single-Node Closed ShadowRoot Inspection:
   * Never calls full-document DOM.getDocument({ pierce: true }); inspects only 1 target node when needed.
   */
  public async describeClosedShadowNode(objectId: string, depth: number = 2, sessionId?: string): Promise<any> {
    return this.send('DOM.describeNode', { objectId, depth, pierce: true }, 15000, sessionId);
  }

  private static parseCdpAttrMap(rawAttrs?: string[]): Map<string, string> {
    const map = new Map<string, string>();
    if (!Array.isArray(rawAttrs)) return map;
    for (let i = 0; i + 1 < rawAttrs.length; i += 2) {
      map.set(String(rawAttrs[i]).toLowerCase(), String(rawAttrs[i + 1]));
    }
    return map;
  }

  private static matchesCdpNodeSegment(node: any, rawSegment: string): boolean {
    if (!node || node.nodeType !== 1) return false;
    let seg = rawSegment.trim();
    if (!seg) return false;
    if (seg === '*') return true;

    const attrs = TestudoCdpSession.parseCdpAttrMap(node.attributes);
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
      const nodeTag = String(node.localName || node.nodeName || '').toLowerCase();
      if (nodeTag !== remainingTag) return false;
    }
    return true;
  }

  private static searchDescribedSubtree(
    node: any,
    segment: string,
    ancestry: ShadowBoundaryHop[],
    insideShadow: boolean
  ): { backendNodeId: number; shadowAncestry: ShadowBoundaryHop[] } | null {
    if (!node) return null;
    if (insideShadow && TestudoCdpSession.matchesCdpNodeSegment(node, segment) && typeof node.backendNodeId === 'number') {
      return { backendNodeId: node.backendNodeId, shadowAncestry: [...ancestry] };
    }

    const hostAttrs = TestudoCdpSession.parseCdpAttrMap(node.attributes);
    const hostTag = String(node.localName || node.nodeName || 'div').toLowerCase();
    const hostId = hostAttrs.get('id') || undefined;
    const hostTestId = hostAttrs.get('data-testid') || undefined;

    if (Array.isArray(node.shadowRoots)) {
      for (const sr of node.shadowRoots) {
        const hop: ShadowBoundaryHop = {
          hostTag,
          hostId,
          hostTestId,
          mode: sr.shadowRootType === 'closed' ? 'closed' : 'open'
        };
        const nextAncestry = [...ancestry, hop];
        if (Array.isArray(sr.children)) {
          for (const child of sr.children) {
            const hit = TestudoCdpSession.searchDescribedSubtree(child, segment, nextAncestry, true);
            if (hit) return hit;
          }
        }
      }
    }

    if (node.contentDocument) {
      const hit = TestudoCdpSession.searchDescribedSubtree(node.contentDocument, segment, ancestry, true);
      if (hit) return hit;
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const hit = TestudoCdpSession.searchDescribedSubtree(child, segment, ancestry, insideShadow);
        if (hit) return hit;
      }
    }
    return null;
  }

  /**
   * Surgically pierces open and closed Shadow DOMs along a `host >>> inner` selector chain
   * without calling full-document DOM.getDocument({ pierce: true }).
   */
  public async pierceResolve(
    deepSelector: string,
    sessionId?: string
  ): Promise<{ objectId: string; backendNodeId?: number; closedShadowAncestry: ShadowBoundaryHop[]; sessionId?: string }> {
    const segments = String(deepSelector || '')
      .split('>>>')
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) {
      throw new Error('[Testudo CDP] pierceResolve requires a non-empty selector');
    }

    const firstExpr = `(function(sel){ const w = window; return w.$T ? w.$T.scan.resolveElement(sel) : document.querySelector(sel); })(${JSON.stringify(
      segments[0]
    )})`;
    const firstEval = await this.send<{ result?: { objectId?: string; subtype?: string } }>(
      'Runtime.evaluate',
      { expression: firstExpr, returnByValue: false },
      15000,
      sessionId
    );
    let currentObjectId = firstEval.result?.objectId;
    if (!currentObjectId || firstEval.result?.subtype === 'null') {
      throw new Error(`[Testudo CDP] Shadow/Frame host not found for segment "${segments[0]}" in "${deepSelector}"`);
    }

    let currentBackendNodeId: number | undefined;
    const accumulatedAncestry: ShadowBoundaryHop[] = [];

    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      const desc = await this.describeClosedShadowNode(currentObjectId, 8, sessionId);
      const found = TestudoCdpSession.searchDescribedSubtree(desc?.node, seg, [], false);
      if (!found) {
        throw new Error(`[Testudo CDP] Pierced target "${seg}" not found inside host "${segments[i - 1]}"`);
      }
      for (const hop of found.shadowAncestry) {
        accumulatedAncestry.push(hop);
      }
      currentBackendNodeId = found.backendNodeId;
      const resolved = await this.send<{ object?: { objectId?: string } }>(
        'DOM.resolveNode',
        { backendNodeId: found.backendNodeId },
        15000,
        sessionId
      );
      if (!resolved.object?.objectId) {
        throw new Error(`[Testudo CDP] DOM.resolveNode failed for backendNodeId ${found.backendNodeId}`);
      }
      currentObjectId = resolved.object.objectId;
    }

    return {
      objectId: currentObjectId,
      backendNodeId: currentBackendNodeId,
      closedShadowAncestry: accumulatedAncestry,
      sessionId
    };
  }

  /**
   * Clicks an element inside an open or genuinely closed Shadow DOM (supports { trusted: true }).
   */
  public async pierceClick(deepSelector: string, options?: { trusted?: boolean; sessionId?: string }): Promise<void> {
    const target = await this.pierceResolve(deepSelector, options?.sessionId);
    if (options?.trusted) {
      const box = await this.send<{ result?: { value?: { x: number; y: number } } }>(
        'Runtime.callFunctionOn',
        {
          objectId: target.objectId,
          functionDeclaration: `function() {
            if (typeof this.scrollIntoView === 'function') this.scrollIntoView({ block: 'center', inline: 'center' });
            const r = this.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }`,
          returnByValue: true
        },
        15000,
        target.sessionId
      );
      const pt = box.result?.value;
      if (!pt) throw new Error(`[Testudo CDP] Could not compute bounding rect for ${deepSelector}`);
      await this.dispatchTrustedClickAt(pt.x, pt.y);
      return;
    }

    await this.send(
      'Runtime.callFunctionOn',
      {
        objectId: target.objectId,
        functionDeclaration: `function() {
          if (typeof this.focus === 'function') this.focus();
          if (typeof this.click === 'function') {
            this.click();
          } else {
            this.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
          }
        }`,
        returnByValue: true
      },
      15000,
      target.sessionId
    );
  }

  /**
   * Types into an <input>, <textarea>, or contenteditable element inside an open or closed Shadow DOM.
   */
  public async pierceType(
    deepSelector: string,
    text: string,
    options?: { trusted?: boolean; clear?: boolean; sessionId?: string }
  ): Promise<{ value: string; masked: boolean }> {
    const target = await this.pierceResolve(deepSelector, options?.sessionId);
    const shouldClear = options?.clear !== false;

    if (options?.trusted) {
      const box = await this.send<{ result?: { value?: { x: number; y: number } } }>(
        'Runtime.callFunctionOn',
        {
          objectId: target.objectId,
          functionDeclaration: `function(clearFirst) {
            if (typeof this.scrollIntoView === 'function') this.scrollIntoView({ block: 'center', inline: 'center' });
            if (clearFirst && 'value' in this) {
              const proto = Object.getPrototypeOf(this);
              const desc = Object.getOwnPropertyDescriptor(proto, 'value');
              if (desc && desc.set) desc.set.call(this, ''); else this.value = '';
              this.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            }
            const r = this.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }`,
          arguments: [{ value: shouldClear }],
          returnByValue: true
        },
        15000,
        target.sessionId
      );
      const pt = box.result?.value;
      if (!pt) throw new Error(`[Testudo CDP] Could not compute bounding rect for ${deepSelector}`);
      await this.dispatchTrustedClickAt(pt.x, pt.y);
      await this.dispatchTrustedKeyText(text);
    } else {
      await this.send(
        'Runtime.callFunctionOn',
        {
          objectId: target.objectId,
          functionDeclaration: `function(val, clearFirst) {
            if (typeof this.focus === 'function') this.focus();
            const nextVal = clearFirst ? val : String(this.value || '') + val;
            if ('value' in this) {
              const proto = Object.getPrototypeOf(this);
              const desc = Object.getOwnPropertyDescriptor(proto, 'value');
              if (desc && desc.set) desc.set.call(this, nextVal); else this.value = nextVal;
            } else {
              this.textContent = nextVal;
            }
            this.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          }`,
          arguments: [{ value: text }, { value: shouldClear }],
          returnByValue: true
        },
        15000,
        target.sessionId
      );
    }

    const readBack = await this.pierceTextContent(deepSelector, options?.sessionId);
    return { value: readBack ?? '', masked: false };
  }

  /**
   * Reads textContent or input value from an element inside an open or closed Shadow DOM.
   */
  public async pierceTextContent(deepSelector: string, sessionId?: string): Promise<string | null> {
    const target = await this.pierceResolve(deepSelector, sessionId);
    const res = await this.send<{ result?: { value?: string | null } }>(
      'Runtime.callFunctionOn',
      {
        objectId: target.objectId,
        functionDeclaration: `function() {
          if ('value' in this && (this.tagName === 'INPUT' || this.tagName === 'TEXTAREA' || this.tagName === 'SELECT')) {
            return String(this.value);
          }
          return String(this.innerText ?? this.textContent ?? '').trim();
        }`,
        returnByValue: true
      },
      15000,
      target.sessionId
    );
    return res.result?.value ?? null;
  }

  /**
   * Lists currently attached out-of-process cross-origin iframe (OOPIF) sessions.
   */
  public listChildOopifSessions(): ChildOopifSessionInfo[] {
    return Array.from(this.childSessions.values()).map((c) => ({ ...c }));
  }

  private static flattenFrameTree(
    node: any,
    acc: Array<{ id: string; parentId?: string; url: string; securityOrigin: string }> = []
  ): Array<{ id: string; parentId?: string; url: string; securityOrigin: string }> {
    if (!node || !node.frame) return acc;
    acc.push({
      id: String(node.frame.id || ''),
      parentId: node.frame.parentId ? String(node.frame.parentId) : undefined,
      url: String(node.frame.url || ''),
      securityOrigin: String(node.frame.securityOrigin || '')
    });
    if (Array.isArray(node.childFrames)) {
      for (const ch of node.childFrames) {
        TestudoCdpSession.flattenFrameTree(ch, acc);
      }
    }
    return acc;
  }

  /**
   * Executes a function or $T workflow inside a cross-origin or same-origin child iframe matching urlOrFramePattern.
   * Transparently routes to Site-Isolated OOPIF child sessionIds OR in-process frame execution contexts.
   */
  public async evaluateInFrame<T = any>(
    urlOrFramePattern: string,
    fnOrExpression: string | ((...args: any[]) => T | Promise<T>),
    ...args: any[]
  ): Promise<T> {
    const pat = String(urlOrFramePattern || '');
    if (!pat) {
      throw new Error('[Testudo CDP] evaluateInFrame requires a non-empty urlOrFramePattern');
    }

    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      for (const [sId, info] of this.childSessions) {
        if (info.url.includes(pat) || info.targetId === pat || sId === pat) {
          if (this.autoInjectTestudo) {
            const hasT = await this.evaluateInSession(sId, () => Boolean((window as any).$T)).catch(() => false);
            if (!hasT) {
              await this.injectTestudo(sId).catch(() => {});
            }
          }
          return this.evaluateInSession<T>(sId, fnOrExpression, ...args);
        }
      }

      const ft = await this.send<{ frameTree: any }>('Page.getFrameTree').catch(() => null);
      const frames = TestudoCdpSession.flattenFrameTree(ft?.frameTree);
      const matchedFrame = frames.find((f) => f.parentId && (f.url.includes(pat) || f.id === pat));
      if (matchedFrame) {
        let ctxInfo = this.frameDefaultContexts.get(matchedFrame.id);
        let contextId = ctxInfo?.contextId;
        const ctxSessionId = ctxInfo?.sessionId;
        if (!contextId) {
          const iso = await this.send<{ executionContextId: number }>(
            'Page.createIsolatedWorld',
            {
              frameId: matchedFrame.id,
              worldName: 'TestudoFrameBridge',
              grantUniveralAccess: true
            },
            5000,
            ctxSessionId
          ).catch(() => null);
          contextId = iso?.executionContextId;
        }
        if (contextId) {
          if (this.autoInjectTestudo) {
            const iifeSource = getTestudoIifeSource();
            await this.send(
              'Runtime.evaluate',
              {
                contextId,
                expression: `if (!window.$T) { ${iifeSource} }`,
                awaitPromise: false,
                returnByValue: false
              },
              10000,
              ctxSessionId
            ).catch(() => {});
          }
          const expression =
            typeof fnOrExpression === 'function'
              ? `(${fnOrExpression.toString()})(...${JSON.stringify(args)})`
              : String(fnOrExpression);
          const evalRes = await this.send<{
            result: { value?: T };
            exceptionDetails?: { text: string; exception?: { description?: string } };
          }>(
            'Runtime.evaluate',
            {
              contextId,
              expression,
              awaitPromise: true,
              returnByValue: true
            },
            15000,
            ctxSessionId
          );
          if (evalRes.exceptionDetails) {
            const desc = evalRes.exceptionDetails.exception?.description || evalRes.exceptionDetails.text;
            throw new Error(`[Testudo CDP Frame Evaluate Error] ${desc}`);
          }
          return evalRes.result?.value as T;
        }
      }
      await new Promise((r) => setTimeout(r, 80));
    }

    throw new Error(`[Testudo CDP] No child frame or OOPIF matched pattern "${pat}"`);
  }

  /**
   * Spiders the complete multi-layer browser hierarchy: Root Page -> Same-Origin Frames -> Cross-Origin OOPIFs -> Open & Closed Shadow Roots.
   */
  public async spiderLayers(): Promise<SpiderLayerNode> {
    const ft = await this.send<{ frameTree: any }>('Page.getFrameTree');
    const frames = TestudoCdpSession.flattenFrameTree(ft?.frameTree);
    const rootFrame = frames[0] || { id: 'root', url: '', securityOrigin: '' };

    const inspectSessionDomAndShadows = async (sessionId?: string): Promise<{ interactiveCount: number; shadows: SpiderLayerNode[] }> => {
      const summary = await this.evaluateInSession(sessionId, () => {
        const interactiveCount = document.querySelectorAll('button, a, input, select, textarea, [role]').length;
        const candidates: Array<{ selector: string; tag: string; id: string; openShadow: boolean }> = [];
        const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
        for (let i = 0; i < all.length && candidates.length < 32; i++) {
          const el = all[i];
          const tag = (el.tagName || '').toLowerCase();
          if (el.shadowRoot || tag.includes('-') || el.hasAttribute('data-shadow-host') || el.id.includes('closed') || el.id.includes('shadow')) {
            const sel = el.id ? `#${el.id}` : tag;
            candidates.push({ selector: sel, tag, id: el.id || '', openShadow: Boolean(el.shadowRoot) });
          }
        }
        return { interactiveCount, candidates };
      }).catch(() => ({ interactiveCount: 0, candidates: [] }));

      const shadowNodes: SpiderLayerNode[] = [];
      for (const cand of summary.candidates) {
        const objRes = await this.send<{ result?: { objectId?: string } }>(
          'Runtime.evaluate',
          { expression: `document.querySelector(${JSON.stringify(cand.selector)})`, returnByValue: false },
          5000,
          sessionId
        ).catch(() => null);
        const objId = objRes?.result?.objectId;
        if (!objId) continue;
        const desc = await this.describeClosedShadowNode(objId, 4, sessionId).catch(() => null);
        const roots = desc?.node?.shadowRoots;
        if (Array.isArray(roots) && roots.length > 0) {
          for (const sr of roots) {
            let count = 0;
            const countInteractive = (n: any) => {
              if (!n) return;
              if (n.nodeType === 1) {
                const t = String(n.localName || n.nodeName || '').toLowerCase();
                if (t === 'button' || t === 'a' || t === 'input' || t === 'select' || t === 'textarea') count++;
              }
              if (Array.isArray(n.children)) n.children.forEach(countInteractive);
            };
            countInteractive(sr);
            shadowNodes.push({
              layerKind: 'shadow-root',
              shadowMode: sr.shadowRootType === 'closed' ? 'closed' : 'open',
              hostTag: cand.tag,
              hostId: cand.id || undefined,
              interactiveCount: count,
              children: []
            });
          }
        }
      }
      return { interactiveCount: summary.interactiveCount, shadows: shadowNodes };
    };

    const rootInspected = await inspectSessionDomAndShadows(undefined);
    const children: SpiderLayerNode[] = [...rootInspected.shadows];

    const handledUrls = new Set<string>();
    for (const [sId, oopif] of this.childSessions) {
      handledUrls.add(oopif.url);
      const sub = await inspectSessionDomAndShadows(sId);
      children.push({
        layerKind: 'cross-origin-oopif',
        sessionId: sId,
        frameId: oopif.targetId,
        url: oopif.url,
        interactiveCount: sub.interactiveCount,
        children: sub.shadows
      });
    }

    for (const f of frames.slice(1)) {
      if (handledUrls.has(f.url)) continue;
      const isCross = Boolean(f.securityOrigin && rootFrame.securityOrigin && f.securityOrigin !== rootFrame.securityOrigin);
      let count = 0;
      if (f.url && f.url !== 'about:blank') {
        count = await this.evaluateInFrame(f.id, () =>
          document.querySelectorAll('button, a, input, select, textarea, [role]').length
        ).catch(() => 0);
      }
      children.push({
        layerKind: isCross ? 'cross-origin-oopif' : 'same-origin-frame',
        frameId: f.id,
        url: f.url,
        interactiveCount: count,
        children: []
      });
    }

    return {
      layerKind: 'root-page',
      frameId: rootFrame.id,
      url: rootFrame.url,
      interactiveCount: rootInspected.interactiveCount,
      children
    };
  }

  /**
   * Assigns local files directly to an <input type="file"> element via privileged CDP DOM.setFileInputFiles.
   */
  public async setFileInputFiles(selector: string, files: string[]): Promise<void> {
    const target = await this.pierceResolve(selector);
    await this.send('DOM.setFileInputFiles', {
      objectId: target.objectId,
      files: files.map((f) => path.resolve(f))
    });
  }

  /**
   * Enables a virtual CTAP2/FIDO2 hardware passkey authenticator via CDP WebAuthn domain.
   */
  public async enableVirtualAuthenticator(options: VirtualAuthenticatorOptions = {}): Promise<string> {
    await this.send('WebAuthn.enable', { enableUI: false });
    const res = await this.send<{ authenticatorId: string }>('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: options.protocol ?? 'ctap2',
        transport: options.transport ?? 'internal',
        hasResidentKey: options.hasResidentKey ?? true,
        hasUserVerification: options.hasUserVerification ?? true,
        isUserVerified: options.isUserVerified ?? true,
        automaticPresenceSimulation: options.automaticPresenceSimulation ?? true
      }
    });
    this.activeAuthenticatorId = res.authenticatorId;
    return res.authenticatorId;
  }

  /**
   * Lists resident FIDO2/WebAuthn credentials stored inside the virtual authenticator.
   */
  public async getVirtualCredentials(authenticatorId?: string): Promise<any[]> {
    const authId = authenticatorId || this.activeAuthenticatorId;
    if (!authId) throw new Error('[Testudo CDP] No active virtual authenticator');
    const res = await this.send<{ credentials?: any[] }>('WebAuthn.getCredentials', { authenticatorId: authId });
    return res.credentials || [];
  }

  /**
   * Removes the virtual WebAuthn authenticator cleanly.
   */
  public async removeVirtualAuthenticator(authenticatorId?: string): Promise<void> {
    const authId = authenticatorId || this.activeAuthenticatorId;
    if (!authId) return;
    await this.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: authId }).catch(() => {});
    if (this.activeAuthenticatorId === authId) {
      this.activeAuthenticatorId = undefined;
    }
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
   * Enables live out-of-process CDP Network wire telemetry with Pillar-1 HMAC secret blinding
   * (captures HttpOnly cookies, TLS protocol/cipher, Server-Timing, and sub-ms phase timings with zero raw secrets stored).
   */
  public async enableLiveWireCapture(options: { hmacSalt?: string } = {}): Promise<void> {
    const salt = options.hmacSalt || 'TESTUDO_HEADER_BLIND_V1';
    if (this.liveWireEnabled) return;
    this.liveWireEnabled = true;

    const ensureRecord = (requestId: string, sessionId?: string): LiveWireRequestRecord => {
      const key = `${sessionId || 'root'}:${requestId}`;
      let rec = this.liveWireRequests.get(key);
      if (!rec) {
        rec = {
          requestId,
          sessionId,
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

    this.on('Network.requestWillBeSent', (params: any, sessionId?: string) => {
      if (!params?.requestId) return;
      const rec = ensureRecord(String(params.requestId), sessionId);
      rec.url = String(params.request?.url || rec.url);
      rec.method = String(params.request?.method || rec.method);
      const scrubbed = scrubHeadersZeroPlaintext(params.request?.headers || {}, salt);
      rec.scrubbedRequestHeaders = { ...rec.scrubbedRequestHeaders, ...scrubbed };
    });

    this.on('Network.requestWillBeSentExtraInfo', (params: any, sessionId?: string) => {
      if (!params?.requestId) return;
      const rec = ensureRecord(String(params.requestId), sessionId);
      const scrubbed = scrubHeadersZeroPlaintext(params.headers || {}, salt);
      rec.scrubbedRequestHeaders = { ...rec.scrubbedRequestHeaders, ...scrubbed };
    });

    this.on('Network.responseReceived', (params: any, sessionId?: string) => {
      if (!params?.requestId || !params?.response) return;
      const rec = ensureRecord(String(params.requestId), sessionId);
      const resp = params.response;
      rec.url = String(resp.url || rec.url);
      rec.status = Number(resp.status || rec.status);
      rec.mimeType = String(resp.mimeType || rec.mimeType);
      if (resp.securityDetails) {
        rec.tlsProtocol = String(resp.securityDetails.protocol || rec.tlsProtocol);
        rec.tlsCipher = String(resp.securityDetails.cipher || rec.tlsCipher);
      } else if (resp.protocol) {
        rec.tlsProtocol = String(resp.protocol);
      }
      const scrubbed = scrubHeadersZeroPlaintext(resp.headers || {}, salt);
      rec.scrubbedResponseHeaders = { ...rec.scrubbedResponseHeaders, ...scrubbed };
      if (scrubbed['server-timing']) {
        rec.serverTimingHeader = scrubbed['server-timing'];
      }
      const cookies = TestudoCdpSession.parseSetCookieHeadersPillar1(
        resp.headers?.['set-cookie'] || resp.headers?.['Set-Cookie'],
        salt
      );
      for (const c of cookies) {
        if (!rec.cookiesObserved.some((e) => e.name === c.name && e.blindedValueHash === c.blindedValueHash)) {
          rec.cookiesObserved.push(c);
        }
      }
      const t = resp.timing;
      if (t) {
        const spanUs = (a: number, b: number) => (typeof a === 'number' && typeof b === 'number' && a >= 0 && b >= a ? Math.round((b - a) * 1000) : 0);
        rec.timingUs = {
          dnsUs: spanUs(t.dnsStart, t.dnsEnd),
          tcpUs: spanUs(t.connectStart, t.connectEnd),
          tlsUs: spanUs(t.sslStart, t.sslEnd),
          sendUs: spanUs(t.sendStart, t.sendEnd),
          ttfbUs: spanUs(t.sendEnd, t.receiveHeadersStart ?? t.receiveHeadersEnd)
        };
      }
    });

    this.on('Network.responseReceivedExtraInfo', (params: any, sessionId?: string) => {
      if (!params?.requestId) return;
      const rec = ensureRecord(String(params.requestId), sessionId);
      const rawHeaders = params.headers || {};
      const scrubbed = scrubHeadersZeroPlaintext(rawHeaders, salt);
      rec.scrubbedResponseHeaders = { ...rec.scrubbedResponseHeaders, ...scrubbed };
      if (scrubbed['server-timing']) {
        rec.serverTimingHeader = scrubbed['server-timing'];
      }
      const rawSetCookie = rawHeaders['set-cookie'] ?? rawHeaders['Set-Cookie'];
      const cookies = TestudoCdpSession.parseSetCookieHeadersPillar1(rawSetCookie, salt);
      for (const c of cookies) {
        if (!rec.cookiesObserved.some((e) => e.name === c.name && e.blindedValueHash === c.blindedValueHash)) {
          rec.cookiesObserved.push(c);
        }
      }
    });

    await this.send('Network.enable', {});
    for (const [sId] of this.childSessions) {
      await this.send('Network.enable', {}, 5000, sId).catch(() => {});
    }
  }

  /**
   * Returns the Pillar-1 scrubbed wire capture report and verifies MAIN-world fetch/XHR remain [native code].
   */
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
   * Binds a TestudoWireInterceptor out-of-process via CDP Fetch.enable + Fetch.requestPaused
   * so HTTP 429/503/corrupt-JSON fault mocks execute with zero window.fetch monkey-patching.
   */
  public async enableWireInterception(interceptor: TestudoWireInterceptor): Promise<void> {
    this.on('Fetch.requestPaused', (params: any, sessionId?: string) => {
      const reqId = params?.requestId;
      if (!reqId) return;
      const method = String(params.request?.method || 'GET');
      const url = String(params.request?.url || '');
      const matched = interceptor.matchRequest(method, url);
      if (!matched) {
        this.send('Fetch.continueRequest', { requestId: reqId }, 10000, sessionId).catch(() => {});
        return;
      }
      const fulfill = () => {
        const responseHeaders = Object.entries(matched.headers || {}).map(([name, value]) => ({
          name,
          value: String(value)
        }));
        this.send(
          'Fetch.fulfillRequest',
          {
            requestId: reqId,
            responseCode: matched.status,
            responseHeaders,
            body: Buffer.from(matched.body, 'utf8').toString('base64')
          },
          10000,
          sessionId
        ).catch(() => {});
      };
      if (matched.delayMs > 0) {
        setTimeout(fulfill, matched.delayMs);
      } else {
        fulfill();
      }
    });

    await this.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  }

  /**
   * Full bottom-to-top X-Ray spider: combines React/Vue/Angular Fiber state + sanitized props
   * with closed/open Shadow ancestry and privileged CDP Frame/OOPIF lineage.
   */
  public async xray(
    selector: string,
    options: { frameUrlPattern?: string } = {}
  ): Promise<FullBrowserXrayReport> {
    let targetSessionId: string | undefined;
    if (options.frameUrlPattern) {
      for (const [sId, info] of this.childSessions) {
        if (info.url.includes(options.frameUrlPattern) || sId === options.frameUrlPattern) {
          targetSessionId = sId;
          break;
        }
      }
    }

    let baseReport: ElementXrayReport;
    let closedShadowAncestry: ShadowBoundaryHop[] = [];

    if (selector.includes('>>>')) {
      const resolved = await this.pierceResolve(selector, targetSessionId);
      closedShadowAncestry = resolved.closedShadowAncestry;
      if (this.autoInjectTestudo) {
        const hasT = await this.evaluateInSession(targetSessionId, () => Boolean((window as any).$T)).catch(() => false);
        if (!hasT) await this.injectTestudo(targetSessionId).catch(() => {});
      }
      const callRes = await this.send<{ result?: { value?: ElementXrayReport } }>(
        'Runtime.callFunctionOn',
        {
          objectId: resolved.objectId,
          functionDeclaration: `function(selStr) {
            const w = window;
            if (w.$T && typeof w.$T.xray === 'function') {
              const r = w.$T.xray(this);
              r.selector = selStr;
              return r;
            }
            return { found: true, selector: selStr, tag: (this.tagName || 'div').toLowerCase(), role: '', accessibleName: '', rect: { x: 0, y: 0, width: 0, height: 0 }, components: [], shadowAncestry: [], windowAncestry: [] };
          }`,
          arguments: [{ value: selector }],
          returnByValue: true
        },
        15000,
        targetSessionId
      );
      baseReport = callRes.result?.value || {
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

    const ft = await this.send<{ frameTree: any }>('Page.getFrameTree').catch(() => null);
    const frames = TestudoCdpSession.flattenFrameTree(ft?.frameTree);
    let rootOrigin = frames[0]?.securityOrigin || '';
    if (!rootOrigin && frames[0]?.url) {
      try { rootOrigin = new URL(frames[0].url).origin; } catch { /* ignore */ }
    }
    const privilegedFrameAncestry = frames.map((f) => {
      let origin = f.securityOrigin || '';
      if (!origin && f.url) {
        try { origin = new URL(f.url).origin; } catch { /* ignore */ }
      }
      return {
        frameId: f.id,
        parentId: f.parentId,
        url: f.url,
        securityOrigin: origin,
        isCrossOriginOopif: Boolean(f.parentId && origin && rootOrigin && origin !== rootOrigin)
      };
    });
    for (const [, oopif] of this.childSessions) {
      if (!privilegedFrameAncestry.some((f) => f.url === oopif.url)) {
        let origin = '';
        try { origin = new URL(oopif.url).origin; } catch { /* ignore */ }
        privilegedFrameAncestry.push({
          frameId: oopif.targetId,
          parentId: frames[0]?.id || 'root',
          url: oopif.url,
          securityOrigin: origin,
          isCrossOriginOopif: Boolean(!rootOrigin || !origin || origin !== rootOrigin)
        });
      }
    }

    return {
      ...baseReport,
      cdpSessionId: targetSessionId,
      closedShadowAncestry,
      privilegedFrameAncestry
    };
  }

  /**
   * Rule 19 ECMAScript ClearKeptObjects() Macrotask + 2x V8/Oilpan Garbage Collection:
   * Settles WeakRefs and Blink DOM wrappers deterministically between stepped (10, 25, 50) click bursts.
   */
  public async collectDoubleGarbageAfterMacrotask(): Promise<{ listeners: number; nodes: number; jsHeapBytes: number }> {
    await this.evaluate(() => new Promise((r) => setTimeout(r, 0))).catch(() => {});
    await this.send('HeapProfiler.enable', {}).catch(() => {});
    await this.send('HeapProfiler.collectGarbage', {}).catch(() => {});
    await this.evaluate(() => new Promise((r) => setTimeout(r, 0))).catch(() => {});
    await this.send('HeapProfiler.collectGarbage', {}).catch(() => {});
    await this.send('Performance.enable', {}).catch(() => {});
    const perf = await this.send<{ metrics?: Array<{ name: string; value: number }> }>('Performance.getMetrics', {}).catch(() => ({ metrics: [] }));
    const list = perf.metrics || [];
    const pick = (k: string) => list.find((m) => m.name === k)?.value ?? 0;
    return {
      listeners: pick('JSEventListeners'),
      nodes: pick('Nodes'),
      jsHeapBytes: pick('JSHeapUsedSize')
    };
  }

  /**
   * Closes the CDP session.
   * Enforces Rule 13 teardown: only closes the browser target if ownsTarget === true,
   * never killing the user's shared browser process or pre-existing tabs.
   */
  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    try {
      if (this.ownsTarget && this.targetId && !this.childProcess) {
        await this.send('Target.closeTarget', { targetId: this.targetId }, 3000).catch(() => {});
      }
    } finally {
      this.ws.close();
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

export interface BrowserTierFailureReport {
  tier: 1 | 2 | 3;
  tierName: 'testudo-assistive-bridge' | 'native-debug-port-cdp' | 'playwright-emergency-fallback';
  reason: string;
  timestamp: string;
}

export interface FailoverConnectOptions extends CdpConnectOptions {
  bridgePort?: number;
  bridgeAuthToken?: string;
  cdpPort?: number;
  allowPlaywrightFallback?: boolean;
  unsafeNoSandbox?: boolean;
  onTierFailure?: (failure: BrowserTierFailureReport, message: string) => void;
}

export interface FailoverConnectResult {
  activeTier: 1 | 2 | 3;
  driver: 'testudo-assistive-bridge' | 'native-debug-port-cdp' | 'playwright-emergency-fallback';
  bridge?: TestudoAssistiveBridge;
  attachedTabId?: number;
  session?: TestudoCdpSession;
  playwrightBrowser?: any;
  playwrightPage?: any;
  failures: BrowserTierFailureReport[];
  close: () => Promise<void>;
}

/**
 * Factory and discovery entry point for Direct Native CDP connections, Headless Chrome launches,
 * and the ARCH-27 3-Tier Browser Failover Router.
 */
export const TestudoCdp = {
  /**
   * Lists all open page targets on an active Chrome CDP port.
   */
  async listTargets(host: string = '127.0.0.1', port: number = DEFAULT_CDP_PORT): Promise<CdpTargetInfo[]> {
    const list = await fetchJson<CdpTargetInfo[]>(`http://${host}:${port}/json/list`);
    return list.filter((t) => t.type === 'page');
  },

  /**
   * Enforces the ARCH-27 3-Tier Browser Connection Hierarchy with Mandatory Failure Telemetry:
   *   Tier 1 (Primary): TestudoAssistiveBridge (ws://127.0.0.1:3851)
   *   Tier 2 (First Fallback): Native Debug Port CDP (127.0.0.1:9222 / 9223)
   *   Tier 3 (Last-Resort Emergency Fallback): Playwright
   * Always informs the user if Tier 1 or Tier 2 fails and the exact reason why before escalating.
   */
  async connectWithFailover(options: FailoverConnectOptions = {}): Promise<FailoverConnectResult> {
    const bridgePort = options.bridgePort ?? DEFAULT_ASSISTIVE_BRIDGE_PORT;
    const cdpPort = options.cdpPort ?? options.port ?? DEFAULT_CDP_PORT;
    const host = options.host || '127.0.0.1';
    const failures: BrowserTierFailureReport[] = [];

    const reportFailure = (tier: 1 | 2 | 3, tierName: BrowserTierFailureReport['tierName'], reason: string, nextTierDesc: string) => {
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

    // ------------------------------------------------------------------------
    // TIER 1: Testudo-JS Assistive Bridge (ws://127.0.0.1:3851)
    // ------------------------------------------------------------------------
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
          `No Sir Testudo Chrome Extension connected on ws://${host}:${bridgePort}/ws (connectedClients=0)`
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
        `Falling back to Tier 2 (Native Debug Port CDP on ${host}:${cdpPort})...`
      );
    }

    // ------------------------------------------------------------------------
    // TIER 2: Native Debug Port CDP (127.0.0.1:9222 / 9223)
    // ------------------------------------------------------------------------
    try {
      const session = await TestudoCdp.connect({
        ...options,
        host,
        port: cdpPort
      });
      return {
        activeTier: 2,
        driver: 'native-debug-port-cdp',
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
          : 'Falling back to Tier 3 (Playwright Emergency Fallback)...'
      );
    }

    if (options.allowPlaywrightFallback === false) {
      const summary = failures.map((f) => `Tier ${f.tier} (${f.tierName}): ${f.reason}`).join(' | ');
      throw new Error(`[Testudo Browser Failover Exhausted] ${summary}`);
    }

    // ------------------------------------------------------------------------
    // TIER 3: Playwright Emergency Last-Resort Fallback
    // ------------------------------------------------------------------------
    try {
      const pwModName = 'playwright';
      const pw: any = await import(pwModName);
      const chromium = pw.chromium || pw.default?.chromium;
      if (!chromium) {
        throw new Error('Playwright chromium launcher not found');
      }
      const chromeBin = resolveLocalChromeExecutable();
      const pwArgs = ['--disable-dev-shm-usage'];
      if (options.unsafeNoSandbox === true) {
        pwArgs.push('--no-sandbox', '--disable-setuid-sandbox');
      }
      const browser = await chromium.launch({
        executablePath: chromeBin,
        headless: true,
        args: pwArgs
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
   * Connects to an existing Chrome debug port (e.g., 9222 or 9223).
   * - If targetId or targetUrlPattern is provided, attaches directly to the user's existing open tab
   *   and hot-injects Testudo-JS without reloading (unless reloadOnAttach: true is set).
   * - Otherwise creates an isolated window via Target.createTarget({ newWindow: true }) per Rule 13.
   */
  async connect(options: CdpConnectOptions = {}): Promise<TestudoCdpSession> {
    const host = options.host || '127.0.0.1';
    const port = options.port ?? DEFAULT_CDP_PORT;

    const versionInfo = await fetchJson<{ webSocketDebuggerUrl: string }>(`http://${host}:${port}/json/version`);
    const browserWsUrl = versionInfo.webSocketDebuggerUrl;

    let targetId = options.targetId;
    let targetWsUrl: string | undefined;
    let ownsTarget = false;

    if (targetId || options.targetUrlPattern) {
      const pages = await TestudoCdp.listTargets(host, port);
      const matched = pages.find((p) => {
        if (targetId && p.id === targetId) return true;
        if (
          options.targetUrlPattern &&
          ((p.url && p.url.includes(options.targetUrlPattern)) ||
            (p.title && p.title.toLowerCase().includes(options.targetUrlPattern.toLowerCase())))
        ) {
          return true;
        }
        return false;
      });

      if (matched && matched.webSocketDebuggerUrl) {
        targetId = matched.id;
        targetWsUrl = matched.webSocketDebuggerUrl;
        ownsTarget = false;
      } else if (options.targetUrlPattern || targetId) {
        throw new Error(
          `[Testudo CDP] Could not find existing tab matching "${options.targetUrlPattern || targetId}" on ${host}:${port}`
        );
      }
    }

    if (!targetWsUrl) {
      // Create an isolated dedicated window via browser-level CDP socket (Rule 13 Window Isolation)
      const browserWs = await connectWebSocketClient(browserWsUrl);
      try {
        const createCmdId = 1;
        const created = await new Promise<{ targetId: string }>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('[Testudo CDP] Target.createTarget timed out')), 10000);
          browserWs.on('message', (raw: string) => {
            try {
              const msg = JSON.parse(raw);
              if (msg.id === createCmdId) {
                clearTimeout(timer);
                if (msg.error) reject(new Error(msg.error.message));
                else resolve(msg.result);
              }
            } catch {
              // ignore
            }
          });
          browserWs.send(
            JSON.stringify({
              id: createCmdId,
              method: 'Target.createTarget',
              params: {
                url: options.url || 'about:blank',
                newWindow: options.newWindow ?? true
              }
            })
          );
        });
        targetId = created.targetId;
        ownsTarget = true;
      } finally {
        browserWs.close();
      }

      const pages = await TestudoCdp.listTargets(host, port);
      const createdTarget = pages.find((p) => p.id === targetId);
      targetWsUrl = createdTarget?.webSocketDebuggerUrl || `ws://${host}:${port}/devtools/page/${targetId}`;
    }

    const pageWs = await connectWebSocketClient(targetWsUrl);
    const session = new TestudoCdpSession({
      ws: pageWs,
      targetId: targetId!,
      ownsTarget,
      browserWsUrl,
      autoInjectTestudo: options.autoInjectTestudo ?? true
    });

    await session.initializeTestudo({ reload: options.reloadOnAttach ?? false });

    return session;
  },

  /**
   * Spawns a local headless Chrome process directly via node:child_process (zero Playwright/Puppeteer)
   * and returns a connected TestudoCdpSession with window.$T pre-injected.
   */
  async launchHeadless(options: HeadlessLaunchOptions = {}): Promise<TestudoCdpSession> {
    const extraArgs = options.extraArgs || [];
    for (const rawFlag of extraArgs) {
      const normalizedFlag = String(rawFlag || '').trim().toLowerCase();
      if (
        DANGEROUS_CHROME_FLAG_PREFIXES.some((prefix) => normalizedFlag.startsWith(prefix)) ||
        normalizedFlag.startsWith('--disable-web-security')
      ) {
        throw new Error(`[Testudo CDP] Blocked dangerous Chrome flag in extraArgs: ${rawFlag}`);
      }
      if (
        !options.unsafeNoSandbox &&
        (normalizedFlag === '--no-sandbox' || normalizedFlag === '--disable-setuid-sandbox')
      ) {
        throw new Error(
          `[Testudo CDP] Blocked ${rawFlag} by default. Pass unsafeNoSandbox: true explicitly to opt in.`
        );
      }
    }

    const chromeBin = resolveLocalChromeExecutable(options.executablePath);
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testudo-cdp-profile-'));
    const width = options.width ?? 1440;
    const height = options.height ?? 900;

    const args = [
      '--headless=new',
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${userDataDir}`,
      `--window-size=${width},${height}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-gpu'
    ];
    if (options.unsafeNoSandbox === true) {
      args.push('--no-sandbox', '--disable-setuid-sandbox');
    }
    if (options.allowFileAccessFromFiles === true) {
      args.push('--allow-file-access-from-files');
    }
    args.push(...extraArgs, options.url || 'about:blank');

    const child = spawn(chromeBin, args, {
      stdio: ['ignore', 'ignore', 'pipe']
    });

    const MAX_STDERR_LOG_CHARS = 65536;
    const browserWsUrl = await new Promise<string>((resolve, reject) => {
      let stderrLog = '';
      const cleanupDirOnFail = () => {
        try {
          if (fs.existsSync(userDataDir)) {
            fs.rmSync(userDataDir, { recursive: true, force: true });
          }
        } catch {
          // ignore
        }
      };

      const timer = setTimeout(() => {
        child.stderr?.off('data', onData);
        child.kill('SIGTERM');
        cleanupDirOnFail();
        reject(new Error(`[Testudo CDP] Timed out waiting for headless Chrome DevTools endpoint. Stderr: ${stderrLog}`));
      }, 15000);

      const onData = (chunk: Buffer) => {
        stderrLog += chunk.toString('utf8');
        if (stderrLog.length > MAX_STDERR_LOG_CHARS) {
          stderrLog = stderrLog.slice(-MAX_STDERR_LOG_CHARS);
        }
        const match = stderrLog.match(/DevTools listening on (ws:\/\/[^\s\r\n]+)/);
        if (match && match[1]) {
          clearTimeout(timer);
          child.stderr?.off('data', onData);
          child.stderr?.resume();
          resolve(match[1]);
        }
      };

      child.stderr?.on('data', onData);
      child.once('error', (err) => {
        clearTimeout(timer);
        child.stderr?.off('data', onData);
        cleanupDirOnFail();
        reject(err);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        child.stderr?.off('data', onData);
        cleanupDirOnFail();
        reject(new Error(`[Testudo CDP] Headless Chrome exited prematurely with code ${code}. Stderr: ${stderrLog}`));
      });
    });

    const parsedWs = new URL(browserWsUrl);
    const host = parsedWs.hostname || '127.0.0.1';
    const port = Number(parsedWs.port);

    // Wait briefly for initial page target to register
    let pages: CdpTargetInfo[] = [];
    for (let i = 0; i < 30; i++) {
      pages = await TestudoCdp.listTargets(host, port).catch(() => []);
      if (pages.length > 0 && pages[0].webSocketDebuggerUrl) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    if (pages.length === 0 || !pages[0].webSocketDebuggerUrl) {
      child.kill('SIGTERM');
      try {
        if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      throw new Error('[Testudo CDP] Headless Chrome launched but exposed no page targets.');
    }

    const pageTarget = pages[0];
    const pageWs = await connectWebSocketClient(pageTarget.webSocketDebuggerUrl!);
    const session = new TestudoCdpSession({
      ws: pageWs,
      targetId: pageTarget.id,
      ownsTarget: true,
      browserWsUrl,
      childProcess: child,
      userDataDir,
      autoInjectTestudo: options.autoInjectTestudo ?? true
    });

    await session.setViewport({ width, height });
    await session.initializeTestudo({ reload: false });

    return session;
  }
};
