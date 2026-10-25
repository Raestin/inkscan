'use strict';
// Localhost-only synthetic QA server. Never serve the production repository root.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, 'fixture');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.gz': 'application/gzip' };
const csp = "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";
const server = http.createServer((req, res) => {
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
  let name;
  try { name = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch { res.writeHead(400); return res.end(); }
  const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.writeHead(200);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});
server.listen(4173, '127.0.0.1', () => console.log('Synthetic fixture only: http://127.0.0.1:4173'));
