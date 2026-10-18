// Potluck rules: name matching, open dishes, claims and swaps.
// Pure functions over a plain state object, so the Worker and the tests share them.
// State: { slots: [{ id, course, item, serves, big, name, desc, claimId, claimedAt, members }] }

export const COURSES = ['To Start', 'The Main', 'Sides', 'Sweets', 'Drinks'];

const IDEMPOTENT_MS = 10000;
export const MAX_NAME = 80;
export const MAX_DESC = 300;

// One row per slot, in menu order. `big` = the cooking-heavy dishes couples are steered toward.
export function seedSlots() {
  const s = (id, item, course, serves, big, name) => ({
    id, item, course, serves, big: !!big, name: name || '', desc: '', claimId: '', claimedAt: 0, members: []
  });
  return [
    s('app-1', 'Appetizer', 'To Start', 15, false, 'Carly'),
    s('app-2', 'Appetizer', 'To Start', 15),
    s('brisket', 'Brisket', 'The Main', 25, true, 'Max'),
    s('potato-1', 'Potato', 'Sides', 12),
    s('potato-2', 'Potato', 'Sides', 12),
    s('veg-1', 'Vegetable', 'Sides', 15),
    s('veg-2', 'Vegetable', 'Sides', 15),
    s('salad', 'Salad', 'Sides', 25, true),
    s('mac', 'Mac and cheese', 'Sides', 25, true),
    s('dessert-1', 'Dessert', 'Sweets', 7, false, 'Carly'),
    s('dessert-2', 'Dessert', 'Sweets', 7),
    s('dessert-3', 'Dessert', 'Sweets', 7),
    s('na-drinks', 'Non-alcoholic drinks', 'Drinks', 25),
    s('drinks-1', 'Alcoholic drinks', 'Drinks', 12),
    s('drinks-2', 'Alcoholic drinks', 'Drinks', 12)
  ];
}

export class UserError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
export const clean = (v, max) => str(v).replace(/\s+/g, ' ').slice(0, max);

// ---------------------------------------------------------------- name matching
// Ported from the approved design (Main.dc.html, renderVals → findPerson).

export function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z\s-]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = [];
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

const tol = (s) => (s.length <= 4 ? 1 : (s.length <= 8 ? 2 : 3));

function findPerson(text, people) {
  const q = norm(text);
  const qt = q ? q.split(' ') : [];
  const found = [];
  if (q.length >= 2) {
    people.forEach((p, idx) => {
      const full = norm(p.name);
      const parts = full.split(' ');
      const first = parts[0];
      const last = parts.length > 1 ? parts[parts.length - 1] : '';
      let best = null;
      const consider = (score) => { if (best === null || score < best) best = score; };
      const dFull = lev(q, full);
      if (dFull <= tol(full)) consider(dFull);
      (p.aliases || []).forEach((a) => { const na = norm(a); const d = lev(q, na); if (d <= tol(na)) consider(d); });
      const d1 = lev(qt[0], first);
      if (d1 <= tol(first)) {
        if (qt.length === 1) consider(d1 + 0.5);
        else if (last) { const d2 = lev(qt[qt.length - 1], last); if (d2 <= tol(last)) consider(d1 + d2); }
      }
      if (last && qt.length === 1) { const dL = lev(qt[0], last); if (dL <= tol(last)) consider(dL + 1); }
      if (best !== null) found.push({ idx, score: best });
    });
  }
  found.sort((a, b) => a.score - b.score);
  if (!found.length) return [];
  const top = found[0].score;
  return found.filter((m) => m.score <= top + 0.5).map((m) => people[m.idx]);
}

const titleCase = (s) => s.split(/\s+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
const firstOf = (n) => n.split(' ')[0];
const rosterPerson = (p, people) => ({ name: p.name, couple: p.couple, roster: true, order: people.indexOf(p) });
const memberKey = (p) => (p.roster ? 'g:' : 'n:') + norm(p.name);

/**
 * Resolve typed text to a kitchen.
 * status: 'empty' (too short) or 'match'. A name that fits several guests goes
 * through as typed, flagged `ambiguous`, so nobody is forced to give a last name.
 * byName (what the menu shows): couples by first names, "Sam & Jo";
 * singles by full roster name, or as typed (title-cased) when not on the list.
 */
export function identify(text, people) {
  const rawInput = String(text || '').trim();
  const q = norm(rawInput);
  // "Sam and Jo", "Sam & Jo", "Sam + Jo" → a couple, whether or not we know them.
  const pairParts = rawInput.split(/\s*(?:&|\+|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
  const isPair = pairParts.length === 2;

  let guest = null;
  let partner = null;
  let ambiguous = false;
  if (isPair) {
    const a = findPerson(pairParts[0], people);
    const b = findPerson(pairParts[1], people);
    guest = a.length === 1 ? rosterPerson(a[0], people) : { name: titleCase(pairParts[0]) };
    partner = b.length === 1 ? rosterPerson(b[0], people) : { name: titleCase(pairParts[1]) };
  } else if (q.length >= 2) {
    const r = findPerson(rawInput, people);
    if (r.length === 1) {
      guest = rosterPerson(r[0], people);
      const mate = guest.couple ? people.find((p) => p.couple === guest.couple && p.name !== guest.name) : null;
      partner = mate ? rosterPerson(mate, people) : null;
    } else {
      ambiguous = r.length > 1;
      guest = { name: titleCase(rawInput) }; // not on the list (or not sure who) → treated as a single
    }
  }
  if (!guest) return { status: 'empty' };

  const isCouple = !!partner;
  const group = isCouple ? [guest, partner] : [guest];
  // Roster couples always read the same way, whichever partner signs up.
  const named = isCouple && guest.roster && partner.roster && partner.order < guest.order ? [partner, guest] : group;
  return {
    status: 'match',
    guest,
    partner,
    people: group,
    isPair,
    isCouple,
    ambiguous,
    matchName: isPair ? guest.name + ' & ' + partner.name : guest.name,
    byName: isCouple ? firstOf(named[0].name) + ' & ' + firstOf(named[1].name) : guest.name,
    initials: isPair
      ? (firstOf(guest.name).charAt(0) + firstOf(partner.name).charAt(0)).toUpperCase()
      : guest.name.split(' ').map((w) => w.charAt(0)).join('').toUpperCase().slice(0, 2),
    members: group.map(memberKey)
  };
}

// ---------------------------------------------------------------- reads

// Slots this kitchen holds, in menu order. Claims made here carry member keys;
// rows set by hand (the hosts' seeded rows, admin edits) match by name.
export function ownSlots(slots, ident) {
  const names = [ident.byName, ident.matchName].concat(ident.people.map((p) => p.name)).map(norm);
  return slots.filter((s) => {
    if (!s.name) return false;
    if (s.members && s.members.length) return ident.members.some((k) => s.members.includes(k));
    return names.includes(norm(s.name));
  });
}

// One entry per item that still has an open slot. `own` (the guest's current
// slot, when swapping) counts as open for them.
export function openList(slots, own) {
  const seen = new Map();
  slots.forEach((s) => {
    if (s.name && s !== own) return;
    const k = s.item.toLowerCase();
    if (!seen.has(k)) seen.set(k, { item: s.item, serves: s.serves, big: s.big, course: s.course });
  });
  return [...seen.values()];
}

const claimView = (s) => ({ item: s.item, serves: s.serves, course: s.course, description: s.desc });

export function identifyView(state, rawName, people) {
  const ident = identify(String(rawName || '').slice(0, MAX_NAME), people);
  if (ident.status !== 'match') return { status: ident.status };
  const own = ownSlots(state.slots, ident)[0] || null;
  return {
    status: 'match',
    matchName: ident.matchName,
    byName: ident.byName,
    initials: ident.initials,
    isCouple: ident.isCouple,
    isPair: ident.isPair,
    ambiguous: ident.ambiguous,
    partnerFirst: ident.partner ? firstOf(ident.partner.name) : '',
    existing: own ? claimView(own) : null
  };
}

export function openItems(state, rawName, people) {
  let own = null;
  if (str(rawName)) {
    const ident = identify(String(rawName).slice(0, MAX_NAME), people);
    if (ident.status === 'match') own = ownSlots(state.slots, ident)[0] || null;
  }
  return { items: openList(state.slots, own) };
}

// Names and descriptions only; claim ids never leave the server except to their owner.
export function menu(state, me) {
  return {
    entries: state.slots.filter((s) => !!s.name).map((s) => ({
      course: s.course,
      item: s.item,
      serves: s.serves,
      by: s.name,
      title: s.desc || s.item,
      mine: !!me && !!s.claimId && s.claimId === String(me)
    }))
  };
}

// ---------------------------------------------------------------- claim

/**
 * Claim (or swap to) a dish. Mutates state.slots. The caller must run this
 * one request at a time (the Worker's Durable Object does) and persist after.
 * Returns { result, log: [entries to append] }.
 */
export function claim(state, body, people, { now = Date.now(), newId }) {
  const rawName = clean(body.name, MAX_NAME);
  const item = clean(body.item, 60);
  const desc = clean(body.description, MAX_DESC);
  if (!rawName) throw new UserError('name_required', 'Please tell us your name.');
  if (!item) throw new UserError('item_required', 'Please pick a dish.');
  if (!desc) throw new UserError('description_required', 'Please describe your dish.');

  const ident = identify(rawName, people);
  if (ident.status !== 'match') throw new UserError('name_unclear', 'Add your first and last name so we know which guest you are.');

  const slots = state.slots;
  const itemKey = item.toLowerCase();
  const ofItem = slots.filter((s) => s.item.toLowerCase() === itemKey);
  if (!ofItem.length) throw new UserError('unknown_item', 'That dish is not on the list.');

  const own = ownSlots(slots, ident);
  // Same kitchen + same item within a few seconds = the same claim (double tap, retry).
  const dup = own.find((s) => s.item.toLowerCase() === itemKey && s.claimId && now - s.claimedAt < IDEMPOTENT_MS);
  if (dup) return { result: claimResult(dup), log: [] };

  const current = own[0] || null;
  if (current && !body.swap) return { result: { error: 'has_claim', claim: claimView(current) }, log: [] };

  const target = current && current.item.toLowerCase() === itemKey ? current : ofItem.find((s) => !s.name);
  if (!target) return { result: { error: 'taken', items: openList(slots, current) }, log: [] };

  const log = [];
  if (current && current !== target) {
    log.push({ at: now, action: 'release', slotId: current.id, item: current.item, name: current.name, desc: current.desc, claimId: current.claimId, typed: rawName });
    Object.assign(current, { name: '', desc: '', claimId: '', claimedAt: 0, members: [] });
  }
  Object.assign(target, { name: ident.byName, desc, claimId: newId(), claimedAt: now, members: ident.members });
  log.push({ at: now, action: current ? 'swap' : 'claim', slotId: target.id, item: target.item, name: target.name, desc, claimId: target.claimId, typed: rawName });
  return { result: claimResult(target), log };
}

const claimResult = (s) => ({ ok: true, claimId: s.claimId, by: s.name, item: s.item, serves: s.serves, course: s.course });

// ---------------------------------------------------------------- host edits

/**
 * Host-only edits (behind the admin key). Ops:
 *   set      { slotId, name, description }  write a row by hand (counts as claimed)
 *   release  { slotId }                     free a slot
 *   add      { item, course, serves, big }  add a slot
 *   remove   { slotId }                     delete an open slot
 */
export function adminEdit(state, body, { now = Date.now() } = {}) {
  const slots = state.slots;
  const find = () => {
    const s = slots.find((x) => x.id === body.slotId);
    if (!s) throw new UserError('unknown_slot', 'No slot with that id.');
    return s;
  };
  if (body.op === 'set') {
    const s = find();
    Object.assign(s, { name: clean(body.name, MAX_NAME), desc: clean(body.description, MAX_DESC), claimId: '', claimedAt: now, members: [] });
    return { action: 'admin-set', slot: s };
  }
  if (body.op === 'release') {
    const s = find();
    Object.assign(s, { name: '', desc: '', claimId: '', claimedAt: 0, members: [] });
    return { action: 'admin-release', slot: s };
  }
  if (body.op === 'add') {
    const item = clean(body.item, 60);
    const course = COURSES.includes(body.course) ? body.course : 'Sides';
    const serves = parseInt(body.serves, 10);
    if (!item || !serves) throw new UserError('bad_request', 'add needs item and serves.');
    const base = item.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    let n = 1;
    while (slots.some((x) => x.id === base + '-' + n)) n++;
    const s = { id: base + '-' + n, item, course, serves, big: !!body.big, name: '', desc: '', claimId: '', claimedAt: 0, members: [] };
    // Keep the menu order: after the last slot of the same item, else the same course.
    let at = -1;
    slots.forEach((x, i) => { if (x.item.toLowerCase() === item.toLowerCase() || (at < 0 && x.course === course)) at = i; });
    slots.splice(at < 0 ? slots.length : at + 1, 0, s);
    return { action: 'admin-add', slot: s };
  }
  if (body.op === 'remove') {
    const s = find();
    if (s.name) throw new UserError('claimed', 'Release the slot before removing it.');
    slots.splice(slots.indexOf(s), 1);
    return { action: 'admin-remove', slot: s };
  }
  throw new UserError('bad_action', 'Unknown admin op.');
}
