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

export function createServer(port = 4173) {
  const server = http.createServer((req, res) => {
    // Add CORS headers for testing
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    let reqPath = decodeURIComponent(parsedUrl.pathname);
    if (reqPath === '/') {
      reqPath = '/demo/site1_financial_blotter.html';
    }

    const filePath = path.join(ROOT_DIR, reqPath);

    // Guard against path traversal
    if (!filePath.startsWith(ROOT_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`404 Not Found: ${reqPath}`);
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    });
  });

  return {
    start: () => new Promise((resolve) => {
      server.listen(port, '127.0.0.1', () => {
        console.log(`[TestudoServer] Live on http://127.0.0.1:${port}`);
        resolve(server);
      });
    }),
    stop: () => new Promise((resolve) => {
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
