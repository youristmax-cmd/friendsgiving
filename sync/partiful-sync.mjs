// Apply a Partiful guest-list snapshot to the live sign-up.
//   node sync/partiful-sync.mjs <snapshot.json> [--dry-run]
// Snapshot: { "guests": [{ "name": "...", "status": "going|maybe|cant|invited" }] }
// The fixed list (_handoff/data/guests.json, same as the Worker secret) never changes. On top of it:
//   - Partiful guests not on the list (and not "can't go") are added as singles
//   - a couple where one partner can't go becomes two singles, so the other signs up alone
//   - every RSVP is stored for the admin page
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findPerson, norm, RSVPS } from '../worker/src/core.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.FG_API || 'https://friendsgiving.maxyourist.workers.dev/';
const [file, flag] = process.argv.slice(2);
const dry = flag === '--dry-run';

const base = JSON.parse(fs.readFileSync(path.join(ROOT, '_handoff/data/guests.json'), 'utf8')).guests;
const key = process.env.FG_KEY || fs.readFileSync(path.join(ROOT, '.admin-key'), 'utf8').trim();
const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
const guests = (snap.guests || []).filter((g) => g && typeof g.name === 'string' && RSVPS.includes(g.status));

// A bad read (logged out, page didn't load) must not wipe the RSVPs.
if (guests.length < 5) {
  console.error('Snapshot has only ' + guests.length + ' guests; not applying it.');
  process.exit(2);
}

const titleCase = (s) => s.trim().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const rsvp = {};
const added = [];
const unclear = [];
guests.forEach((g) => {
  const m = findPerson(g.name, base);
  if (m.length === 1) rsvp[norm(m[0].name)] = g.status;
  else if (m.length > 1) unclear.push(g.name);
  else if (g.status !== 'cant') {
    const name = titleCase(g.name);
    if (!added.some((a) => norm(a.name) === norm(name))) added.push({ name });
    rsvp[norm(name)] = g.status;
  }
});

// One partner can't go and the other is coming (or may be): both become singles.
const solo = [];
[...new Set(base.filter((p) => p.couple).map((p) => p.couple))].forEach((c) => {
  const pair = base.filter((p) => p.couple === c);
  const st = pair.map((p) => rsvp[norm(p.name)]);
  if (st.includes('cant') && st.some((s) => s === 'going' || s === 'maybe')) pair.forEach((p) => solo.push(p.name));
});

const post = (body) => fetch(API, { method: 'POST', body: JSON.stringify({ action: 'admin', key, ...body }) }).then((r) => r.json());
const before = (await post({ op: 'view' })).households || [];
const was = new Map();
before.forEach((h) => h.names.forEach((n, i) => was.set(norm(n), h.rsvp ? h.rsvp[i] : '')));

const changes = Object.entries(rsvp).filter(([k, v]) => was.get(k) !== v).map(([k, v]) => k + ': ' + (was.get(k) || 'none') + ' → ' + v);
const stamp = new Date().toLocaleString();
console.log(stamp + ' · ' + guests.length + ' on Partiful · ' + Object.keys(rsvp).length + ' matched · ' + added.length + ' added · ' + solo.length / 2 + ' couples split');
if (added.length) console.log('  added: ' + added.map((a) => a.name).join(', '));
if (solo.length) console.log('  now singles: ' + solo.join(', '));
if (unclear.length) console.log('  unclear (fits more than one guest, skipped): ' + unclear.join(', '));
if (changes.length) console.log('  rsvp changes: ' + changes.join('; '));
if (dry) { console.log('  (dry run, nothing sent)'); process.exit(0); }
const r = await post({ op: 'roster', added, solo, rsvp });
if (!r.ok) { console.error('  failed: ' + JSON.stringify(r)); process.exit(1); }
console.log('  applied · ' + r.guests + ' guests on the list now');
