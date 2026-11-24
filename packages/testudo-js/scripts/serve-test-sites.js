/**
 * Testudo Static Test Server (scripts/serve-test-sites.js)
 * Zero-dependency local HTTP server for real-world browser E2E simulations.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const ALLOWED_PREFIXES = ['/demo/', '/dist/', '/assets/'];

export function createServer(port = 4173) {
  const rootReal = fs.realpathSync(ROOT_DIR);

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('405 Method Not Allowed');
      return;
    }

    let reqPath;
    try {
      const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
      reqPath = decodeURIComponent(parsedUrl.pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('400 Bad Request');
      return;
    }

    if (reqPath.includes('\0')) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('400 Bad Request');
      return;
    }

    if (reqPath === '/') {
      reqPath = '/demo/site1_financial_blotter.html';
    }

    const normalizedPosix = path.posix.normalize(reqPath);
    if (!ALLOWED_PREFIXES.some((prefix) => normalizedPosix.startsWith(prefix))) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }

    const candidatePath = path.resolve(rootReal, '.' + normalizedPosix);
    if (candidatePath !== rootReal && !candidatePath.startsWith(rootReal + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }

    fs.realpath(candidatePath, (realErr, realFilePath) => {
      if (realErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
      }

      if (realFilePath !== rootReal && !realFilePath.startsWith(rootReal + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('403 Forbidden');
        return;
      }

      fs.stat(realFilePath, (err, stats) => {
        if (err || !stats.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('404 Not Found');
          return;
        }

        const ext = path.extname(realFilePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, {
          'Content-Type': contentType,
          'X-Content-Type-Options': 'nosniff'
        });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        const stream = fs.createReadStream(realFilePath);
        stream.on('error', () => {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          }
          res.end();
        });
        stream.pipe(res);
      });
    });
  });

  return {
    start: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          const addr = server.address();
          const boundPort = typeof addr === 'object' && addr ? addr.port : port;
          console.log(`[TestudoServer] Live on http://127.0.0.1:${boundPort}`);
          resolve(server);
        });
      }),
    getPort: () => {
      const addr = server.address();
      return typeof addr === 'object' && addr ? addr.port : port;
    },
    stop: () =>
      new Promise((resolve) => {
        server.close(() => {
          console.log('[TestudoServer] Closed');
          resolve();
        });
      }),
    server
  };
}

// Allow direct CLI execution: node scripts/serve-test-sites.js [port]
if (process.argv[1] === __filename) {
  const port = parseInt(process.argv[2] || '4173', 10);
  const srv = createServer(port);
  srv.start();
}
