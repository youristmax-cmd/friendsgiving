// Local preview of the static site, talking to `wrangler dev` (cd worker && npm run dev).
// `node dev/server.js` → http://localhost:8080
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8080);
const API = process.env.API || 'http://localhost:8787/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff': 'font/woff' };

const send = (res, code, body, type) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT) || /\/(_handoff|dev|worker|\.git)(\/|$)/.test(file.slice(ROOT.length))) return send(res, 404, 'not found', 'text/plain');
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!url.pathname.endsWith('/')) { res.writeHead(301, { Location: url.pathname + '/' + url.search }); return res.end(); }
    file = path.join(file, 'index.html');
  }
  if (!fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
  let body = fs.readFileSync(file);
  if (file === path.join(ROOT, 'config.js')) body = String(body).replace(/apiUrl:\s*'[^']*'/, `apiUrl: '${API}'`);
  send(res, 200, body, TYPES[path.extname(file)] || 'application/octet-stream');
}).listen(PORT, () => console.log(`http://localhost:${PORT}  →  API ${API}`));
