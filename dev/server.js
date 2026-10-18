// Local preview: serves the site and runs apps-script/Code.gs (against an
// in-memory copy of the sheet) behind /api. `node dev/server.js` → :8080
// LATENCY=900 simulates Apps Script's response time.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { makeSpreadsheet, loadBackend, handoffSheet1 } = require('./mock-gas');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8080);
const LATENCY = Number(process.env.LATENCY || 0);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff': 'font/woff', '.json': 'application/json' };

const ss = makeSpreadsheet({ Sheet1: handoffSheet1() });
const gas = loadBackend(ss);
gas.setup();

const send = (res, code, body, type) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
const later = (fn) => setTimeout(fn, LATENCY);

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api') {
    if (req.method === 'GET') return later(() => send(res, 200, gas.doGet({ parameter: Object.fromEntries(url.searchParams) }).getContent(), 'application/json'));
    let body = '';
    req.on('data', (c) => { body += c; });
    return req.on('end', () => later(() => send(res, 200, gas.doPost({ postData: { contents: body } }).getContent(), 'application/json')));
  }
  if (url.pathname === '/__sheet') return send(res, 200, JSON.stringify(Object.fromEntries(ss.sheets.map((s) => [s.getName(), s.data]))), 'application/json');
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT) || /\/(_handoff|dev|\.git)(\/|$)/.test(file.slice(ROOT.length))) return send(res, 404, 'not found', 'text/plain');
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!url.pathname.endsWith('/')) { res.writeHead(301, { Location: url.pathname + '/' + url.search }); return res.end(); }
    file = path.join(file, 'index.html');
  }
  if (!fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
  let body = fs.readFileSync(file);
  if (path.basename(file) === 'config.js' && path.dirname(file) === ROOT) {
    body = String(body).replace(/apiUrl:\s*'[^']*'/, "apiUrl: '/api'");
  }
  send(res, 200, body, TYPES[path.extname(file)] || 'application/octet-stream');
}).listen(PORT, () => console.log(`http://localhost:${PORT}  (latency ${LATENCY}ms)`));
