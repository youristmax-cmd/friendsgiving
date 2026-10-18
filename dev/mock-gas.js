// Minimal in-memory stand-in for the Apps Script services Code.gs uses, so the
// real backend file can run under Node for local dev and tests.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function makeSheet(name, grid) {
  const data = grid || [];
  const width = () => data.reduce((m, r) => Math.max(m, r.length), 0);
  const cell = (r, c) => (data[r] && data[r][c] !== undefined ? data[r][c] : '');
  const range = (row, col, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(row - 1 + i, col - 1 + j))),
    setValues(vals) {
      vals.forEach((r, i) => r.forEach((v, j) => {
        while (data.length < row + i) data.push([]);
        data[row - 1 + i][col - 1 + j] = v;
      }));
      return this;
    },
    setValue(v) {
      while (data.length < row) data.push([]);
      // Like Sheets, a leading apostrophe stores the rest as plain text.
      data[row - 1][col - 1] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v;
      return this;
    },
    setFontWeight() { return this; },
    setNumberFormat() { return this; }
  });
  return {
    data,
    getName: () => name,
    getLastRow: () => {
      for (let i = data.length - 1; i >= 0; i--) if ((data[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1;
      return 0;
    },
    getLastColumn: () => width(),
    getRange: range,
    getDataRange: () => range(1, 1, Math.max(data.length, 1), Math.max(width(), 1)),
    appendRow(row) { data.push(row.slice()); },
    setFrozenRows() {}
  };
}

function makeSpreadsheet(sheets) {
  const list = Object.entries(sheets).map(([n, g]) => makeSheet(n, g));
  return {
    sheets: list,
    getSheetByName: (n) => list.find((s) => s.getName() === n) || null,
    getSheets: () => list,
    insertSheet(n) { const s = makeSheet(n, []); list.push(s); return s; }
  };
}

// Loads Code.gs into a fresh context bound to `ss`. Returns the script's globals.
function loadBackend(ss, { latencyMs = 0 } = {}) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  let locked = false;
  const ctx = {
    console,
    Date,
    JSON,
    Math,
    SpreadsheetApp: { getActive: () => ss, flush() {} },
    LockService: {
      getScriptLock: () => ({
        tryLock() { if (locked) return false; locked = true; return true; },
        releaseLock() { locked = false; }
      })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return this.content; } })
    },
    Utilities: { getUuid: () => crypto.randomUUID() },
    Logger: { log: (m) => ctx.__log.push(String(m)) },
    __log: []
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'Code.gs' });
  ctx.__latencyMs = latencyMs;
  return ctx;
}

// Sheet1 as the spec describes it, built from the handoff data (kept out of git).
function handoffSheet1({ coupleFormat = 'id' } = {}) {
  const root = path.join(__dirname, '..', '_handoff', 'data');
  const dishes = JSON.parse(fs.readFileSync(path.join(root, 'dishes.json'), 'utf8'));
  const guests = JSON.parse(fs.readFileSync(path.join(root, 'guests.json'), 'utf8')).guests;
  const rows = [['Item', 'Serving Size', 'Name', 'Description', 'People', 'couple']];
  const n = Math.max(dishes.slots.length, guests.length);
  for (let i = 0; i < n; i++) {
    const s = dishes.slots[i];
    const g = guests[i];
    let tag = '';
    if (g && g.couple) {
      if (coupleFormat === 'id') tag = g.couple;
      else if (coupleFormat === 'yes') tag = 'x';
      else if (coupleFormat === 'partner') tag = guests.find((o) => o.couple === g.couple && o !== g).name;
    }
    rows.push([s ? s.item : '', s ? s.serves : '', s && s.claimedBy ? s.claimedBy : '', '', g ? g.name : '', tag]);
  }
  return rows;
}

module.exports = { makeSpreadsheet, loadBackend, handoffSheet1 };
