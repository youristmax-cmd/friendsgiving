/**
 * Friendsgiving potluck — Apps Script backend.
 *
 * Bound to the sign-up Google Sheet, which is the single source of truth.
 * Tabs: Slots (one row per dish slot), Guests (roster, never sent to the
 * browser), Log (append-only history of claims and releases).
 *
 * One-time: run setup() from the editor, then Deploy → New deployment →
 * Web app, Execute as: Me, Who has access: Anyone.
 */

var SLOTS = 'Slots';
var GUESTS = 'Guests';
var LOG = 'Log';

var SLOT_HEADERS = ['SlotId', 'Course', 'Item', 'Serving Size', 'Big', 'Name', 'Description', 'ClaimId', 'ClaimedAt', 'Members'];
var GUEST_HEADERS = ['Name', 'Couple', 'Aliases'];
var LOG_HEADERS = ['Timestamp', 'Action', 'SlotId', 'Item', 'Name', 'Description', 'ClaimId', 'Typed name'];

// Used by setup() to fill Course/Big for the items in Sheet1. Edit the Slots tab afterwards if needed.
var ITEM_DEFAULTS = {
  'appetizer': { course: 'To Start' },
  'brisket': { course: 'The Main', big: true },
  'potato': { course: 'Sides' },
  'vegetable': { course: 'Sides' },
  'salad': { course: 'Sides', big: true },
  'mac and cheese': { course: 'Sides', big: true },
  'dessert': { course: 'Sweets' },
  'non-alcoholic drinks': { course: 'Drinks' },
  'alcoholic drinks': { course: 'Drinks' }
};

var IDEMPOTENT_MS = 10000;
var MAX_NAME = 80;
var MAX_DESC = 300;

// ---------------------------------------------------------------- web app

function doGet(e) {
  var p = (e && e.parameter) || {};
  return respond_(function () {
    if (p.action === 'menu') return menu_(p.me);
    if (p.action === 'open') return openItems_(p.name);
    if (p.action === 'identify') return identifyView_(p.name);
    throw userError_('bad_action', 'Unknown action.');
  });
}

function doPost(e) {
  return respond_(function () {
    var body;
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { throw userError_('bad_request', 'Body must be JSON.'); }
    if (body.action === 'claim') return claim_(body);
    throw userError_('bad_action', 'Unknown action.');
  });
}

function respond_(fn) {
  var out;
  try {
    out = fn();
  } catch (err) {
    out = err && err.code ? { error: err.code, message: err.message } : { error: 'server', message: 'Something went wrong on our end.' };
    if (!(err && err.code)) console.error(err && err.stack || err);
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function userError_(code, message) {
  var err = new Error(message);
  err.code = code;
  return err;
}

// ---------------------------------------------------------------- reads

function menu_(me) {
  var entries = readSlots_().filter(function (s) { return !!s.name; }).map(function (s) {
    return {
      course: s.course,
      item: s.item,
      serves: s.serves,
      by: s.name,
      title: s.desc || s.item,
      mine: !!me && !!s.claimId && s.claimId === String(me)
    };
  });
  return { entries: entries };
}

function openItems_(rawName) {
  var slots = readSlots_();
  var own = null;
  if (rawName && String(rawName).trim()) {
    var ident = identify_(String(rawName).slice(0, MAX_NAME), readGuests_());
    if (ident.status === 'match') own = ownSlots_(slots, ident)[0] || null;
  }
  return { items: openList_(slots, own) };
}

function identifyView_(rawName) {
  var ident = identify_(String(rawName || '').slice(0, MAX_NAME), readGuests_());
  if (ident.status !== 'match') return { status: ident.status };
  var own = ownSlots_(readSlots_(), ident)[0] || null;
  return {
    status: 'match',
    matchName: ident.matchName,
    byName: ident.byName,
    initials: ident.initials,
    isCouple: ident.isCouple,
    isPair: ident.isPair,
    partnerFirst: ident.partner ? firstOf_(ident.partner.name) : '',
    existing: own ? claimView_(own) : null
  };
}

function claimView_(s) {
  return { item: s.item, serves: s.serves, course: s.course, description: s.desc };
}

// One entry per item that still has an open slot, in sheet order. `own` (the
// guest's current slot, when swapping) counts as open for them.
function openList_(slots, own) {
  var order = [];
  var byItem = {};
  slots.forEach(function (s) {
    if (s.name && s !== own) return;
    var key = s.item.toLowerCase();
    if (!byItem[key]) {
      byItem[key] = { item: s.item, serves: s.serves, big: s.big, course: s.course };
      order.push(key);
    }
  });
  return order.map(function (k) { return byItem[k]; });
}

// ---------------------------------------------------------------- claim

function claim_(b) {
  var rawName = clean_(b.name, MAX_NAME);
  var item = clean_(b.item, 60);
  var desc = clean_(b.description, MAX_DESC);
  if (!rawName) throw userError_('name_required', 'Please tell us your name.');
  if (!item) throw userError_('item_required', 'Please pick a dish.');
  if (!desc) throw userError_('description_required', 'Please describe your dish.');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw userError_('busy', 'Lots of people signing up at once. Try again in a moment.');
  try {
    var ident = identify_(rawName, readGuests_());
    if (ident.status !== 'match') throw userError_('name_unclear', 'Add your first and last name so we know which guest you are.');

    var slots = readSlots_();
    var itemKey = item.toLowerCase();
    var ofItem = slots.filter(function (s) { return s.item.toLowerCase() === itemKey; });
    if (!ofItem.length) throw userError_('unknown_item', 'That dish is not on the list.');

    var own = ownSlots_(slots, ident);
    var now = new Date();

    // Same kitchen + same item within a few seconds = the same claim (double tap, retry).
    var dup = own.filter(function (s) {
      return s.item.toLowerCase() === itemKey && s.claimId && s.claimedAt instanceof Date && now - s.claimedAt < IDEMPOTENT_MS;
    })[0];
    if (dup) return claimResult_(dup);

    var current = own[0] || null;
    if (current && !b.swap) return { error: 'has_claim', claim: claimView_(current) };

    var target = current && current.item.toLowerCase() === itemKey
      ? current
      : ofItem.filter(function (s) { return !s.name; })[0];
    if (!target) return { error: 'taken', items: openList_(slots, current) };

    if (current && current !== target) {
      writeClaim_(current, { name: '', desc: '', claimId: '', claimedAt: '', members: '' });
      log_('release', current, current.name, current.desc, current.claimId, rawName);
    }

    var claimId = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    var fields = {
      name: ident.byName,
      desc: desc,
      claimId: claimId,
      claimedAt: now,
      members: [ident.byName].concat(ident.members).join('|')
    };
    writeClaim_(target, fields);
    log_(current ? 'swap' : 'claim', target, fields.name, desc, claimId, rawName);
    SpreadsheetApp.flush();

    target.name = fields.name;
    target.desc = desc;
    target.claimId = claimId;
    return claimResult_(target);
  } finally {
    lock.releaseLock();
  }
}

function claimResult_(s) {
  return { ok: true, claimId: s.claimId, by: s.name, item: s.item, serves: s.serves, course: s.course };
}

// Slots this kitchen holds, in sheet order. Rows we wrote carry Members
// ("<Name we wrote>|g:sam rivera|g:jo"); if the Name was later edited
// by hand, or the row was typed in by hand, fall back to comparing names.
function ownSlots_(slots, ident) {
  var names = [ident.byName, ident.matchName].concat(ident.people.map(function (p) { return p.name; })).map(norm_);
  return slots.filter(function (s) {
    if (!s.name) return false;
    var parts = s.members ? s.members.split('|') : [];
    if (parts.length > 1 && parts[0] === s.name) {
      return ident.members.some(function (k) { return parts.indexOf(k, 1) > 0; });
    }
    return names.indexOf(norm_(s.name)) >= 0;
  });
}

function writeClaim_(s, f) {
  var sh = sheet_(SLOTS);
  var col = s.cols;
  sh.getRange(s.row, col.name).setValue(safe_(f.name));
  sh.getRange(s.row, col.desc).setValue(safe_(f.desc));
  sh.getRange(s.row, col.claimId).setValue(f.claimId);
  sh.getRange(s.row, col.claimedAt).setValue(f.claimedAt);
  sh.getRange(s.row, col.members).setValue(safe_(f.members));
}

function log_(action, s, name, desc, claimId, typed) {
  sheet_(LOG).appendRow([new Date(), action, s.id, s.item, safe_(name), safe_(desc), claimId, safe_(typed)]);
}

// ---------------------------------------------------------------- sheet access

function sheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw userError_('not_set_up', 'The sheet is not set up yet. Run setup() in Apps Script.');
  return sh;
}

function headerIndex_(sh, required) {
  var lastCol = sh.getLastColumn();
  var header = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var idx = {};
  header.forEach(function (h, i) { idx[String(h).trim().toLowerCase()] = i; });
  required.forEach(function (h) {
    if (!(h.toLowerCase() in idx)) throw userError_('not_set_up', 'The ' + sh.getName() + ' tab is missing its "' + h + '" column.');
  });
  return { idx: idx, width: lastCol };
}

function readSlots_() {
  var sh = sheet_(SLOTS);
  var h = headerIndex_(sh, SLOT_HEADERS);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var ix = h.idx;
  var cols = {
    name: ix['name'] + 1, desc: ix['description'] + 1, claimId: ix['claimid'] + 1,
    claimedAt: ix['claimedat'] + 1, members: ix['members'] + 1
  };
  return sh.getRange(2, 1, last - 1, h.width).getValues().map(function (r, i) {
    return {
      row: i + 2,
      cols: cols,
      id: str_(r[ix['slotid']]),
      course: str_(r[ix['course']]),
      item: str_(r[ix['item']]),
      serves: parseInt(r[ix['serving size']], 10) || 0,
      big: truthy_(r[ix['big']]),
      name: str_(r[ix['name']]),
      desc: str_(r[ix['description']]),
      claimId: str_(r[ix['claimid']]),
      claimedAt: r[ix['claimedat']],
      members: str_(r[ix['members']])
    };
  }).filter(function (s) { return !!s.item; });
}

function readGuests_() {
  var sh = sheet_(GUESTS);
  var h = headerIndex_(sh, GUEST_HEADERS);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var ix = h.idx;
  return sh.getRange(2, 1, last - 1, h.width).getValues().map(function (r) {
    var aliases = str_(r[ix['aliases']]);
    return {
      name: str_(r[ix['name']]),
      couple: str_(r[ix['couple']]),
      aliases: aliases ? aliases.split(',').map(function (a) { return a.trim(); }).filter(Boolean) : []
    };
  }).filter(function (p) { return !!p.name; });
}

function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function truthy_(v) { return v === true || /^(true|yes|y|x|1)$/i.test(str_(v)); }
function clean_(v, max) { return str_(v).replace(/\s+/g, ' ').slice(0, max); }
// Keep typed text from being read as a formula.
function safe_(v) { v = str_(v); return /^[=+\-@]/.test(v) ? "'" + v : v; }

// ---------------------------------------------------------------- name matching
// Ported from the approved design (Main.dc.html, renderVals → findPerson).

function norm_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z\s-]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

function lev_(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  var prev = [];
  for (var j = 0; j <= b.length; j++) prev[j] = j;
  for (var i = 1; i <= a.length; i++) {
    var cur = [i];
    for (var k = 1; k <= b.length; k++) {
      var cost = a[i - 1] === b[k - 1] ? 0 : 1;
      cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

function tol_(s) { return s.length <= 4 ? 1 : (s.length <= 8 ? 2 : 3); }

function findPerson_(text, people) {
  var q = norm_(text);
  var qt = q ? q.split(' ') : [];
  var found = [];
  if (q.length >= 2) {
    people.forEach(function (p, idx) {
      var full = norm_(p.name);
      var parts = full.split(' ');
      var first = parts[0];
      var last = parts.length > 1 ? parts[parts.length - 1] : '';
      var best = null;
      var consider = function (score) { if (best === null || score < best) best = score; };
      var dFull = lev_(q, full);
      if (dFull <= tol_(full)) consider(dFull);
      (p.aliases || []).forEach(function (a) { var na = norm_(a); var d = lev_(q, na); if (d <= tol_(na)) consider(d); });
      var d1 = lev_(qt[0], first);
      if (d1 <= tol_(first)) {
        if (qt.length === 1) consider(d1 + 0.5);
        else if (last) { var d2 = lev_(qt[qt.length - 1], last); if (d2 <= tol_(last)) consider(d1 + d2); }
      }
      if (last && qt.length === 1) { var dL = lev_(qt[0], last); if (dL <= tol_(last)) consider(dL + 1); }
      if (best !== null) found.push({ idx: idx, score: best });
    });
  }
  found.sort(function (a, b) { return a.score - b.score; });
  if (!found.length) return [];
  var top = found[0].score;
  return found.filter(function (m) { return m.score <= top + 0.5; }).map(function (m) { return people[m.idx]; });
}

function titleCase_(s) {
  return s.split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }).join(' ');
}

function firstOf_(n) { return n.split(' ')[0]; }

function memberKey_(p) { return (p.roster ? 'g:' : 'n:') + norm_(p.name); }

function rosterPerson_(p, people) { return { name: p.name, couple: p.couple, roster: true, order: people.indexOf(p) }; }

/**
 * Resolve typed text to a kitchen.
 * status: 'empty' (too short), 'ambiguous' (matches several guests), 'match'.
 * byName (what the sheet and menu show): couples by first names, "Sam & Jo";
 * singles by full roster name, or as typed (title-cased) when not on the list.
 */
function identify_(text, people) {
  var rawInput = String(text || '').trim();
  var q = norm_(rawInput);
  // "Sam and Jo", "Sam & Jo", "Sam + Jo" → a couple, whether or not we know them.
  var pairParts = rawInput.split(/\s*(?:&|\+|\band\b)\s*/i).map(function (s) { return s.trim(); }).filter(Boolean);
  var isPair = pairParts.length === 2;

  var guest = null;
  var partner = null;
  if (isPair) {
    var a = findPerson_(pairParts[0], people);
    var b = findPerson_(pairParts[1], people);
    guest = a.length === 1 ? rosterPerson_(a[0], people) : { name: titleCase_(pairParts[0]) };
    partner = b.length === 1 ? rosterPerson_(b[0], people) : { name: titleCase_(pairParts[1]) };
  } else if (q.length >= 2) {
    var r = findPerson_(rawInput, people);
    if (r.length === 1) {
      guest = rosterPerson_(r[0], people);
      var mate = guest.couple ? people.filter(function (p) { return p.couple === guest.couple && p.name !== guest.name; })[0] : null;
      partner = mate ? rosterPerson_(mate, people) : null;
    } else if (r.length > 1) {
      return { status: 'ambiguous' };
    } else {
      guest = { name: titleCase_(rawInput) }; // not on the list → treated as a single
    }
  }
  if (!guest) return { status: 'empty' };

  var isCouple = !!partner;
  var group = isCouple ? [guest, partner] : [guest];
  // Roster couples always read the same way, whichever partner signs up.
  var named = isCouple && guest.roster && partner.roster && partner.order < guest.order ? [partner, guest] : group;
  return {
    status: 'match',
    guest: guest,
    partner: partner,
    people: group,
    isPair: isPair,
    isCouple: isCouple,
    matchName: isPair ? guest.name + ' & ' + partner.name : guest.name,
    byName: isCouple ? firstOf_(named[0].name) + ' & ' + firstOf_(named[1].name) : guest.name,
    initials: isPair
      ? (firstOf_(guest.name).charAt(0) + firstOf_(partner.name).charAt(0)).toUpperCase()
      : guest.name.split(' ').map(function (w) { return w.charAt(0); }).join('').toUpperCase().slice(0, 2),
    members: group.map(memberKey_)
  };
}

// ---------------------------------------------------------------- one-time setup

/**
 * Builds the Slots, Guests and Log tabs from Sheet1 (Item | Serving Size |
 * Name | Description in A–D, People | couple in E–F). Sheet1 is left as it
 * is, as a backup. Safe to re-run: it stops if Slots already exists.
 */
function setup() {
  var ss = SpreadsheetApp.getActive();
  if (ss.getSheetByName(SLOTS)) throw new Error('A "Slots" tab already exists, so setup has already run. Delete Slots, Guests and Log to start over.');
  var src = ss.getSheetByName('Sheet1') || ss.getSheets()[0];
  var values = src.getDataRange().getValues();
  var header = values[0].map(function (h) { return str_(h).toLowerCase(); });
  var body = /item/.test(header[0]) || /people|name/.test(header[4] || '') ? values.slice(1) : values;

  // --- slots (A–D)
  var rows = body.filter(function (r) { return str_(r[0]); });
  var totals = {};
  rows.forEach(function (r) { var k = str_(r[0]).toLowerCase(); totals[k] = (totals[k] || 0) + 1; });
  var seen = {};
  var slotRows = rows.map(function (r) {
    var item = str_(r[0]);
    var key = item.toLowerCase();
    seen[key] = (seen[key] || 0) + 1;
    var slug = key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    var def = ITEM_DEFAULTS[key] || { course: 'Sides' };
    var name = str_(r[2]);
    return [
      totals[key] > 1 ? slug + '-' + seen[key] : slug,
      def.course,
      item,
      parseInt(r[1], 10) || str_(r[1]),
      !!def.big,
      name,
      str_(r[3]),
      '', '', ''
    ];
  });

  // --- guests (E–F)
  var guestRows = parseGuests_(body.map(function (r) { return [str_(r[4]), str_(r[5])]; }).filter(function (g) { return g[0]; }));

  var slots = ss.insertSheet(SLOTS);
  slots.getRange(1, 1, 1, SLOT_HEADERS.length).setValues([SLOT_HEADERS]).setFontWeight('bold');
  if (slotRows.length) slots.getRange(2, 1, slotRows.length, SLOT_HEADERS.length).setValues(slotRows);
  slots.getRange(2, SLOT_HEADERS.indexOf('ClaimedAt') + 1, Math.max(slotRows.length, 1), 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  slots.setFrozenRows(1);

  var guests = ss.insertSheet(GUESTS);
  guests.getRange(1, 1, 1, GUEST_HEADERS.length).setValues([GUEST_HEADERS]).setFontWeight('bold');
  if (guestRows.length) guests.getRange(2, 1, guestRows.length, GUEST_HEADERS.length).setValues(guestRows);
  guests.setFrozenRows(1);

  var log = ss.insertSheet(LOG);
  log.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');
  log.setFrozenRows(1);

  var couples = {};
  guestRows.forEach(function (g) { if (g[1]) (couples[g[1]] = couples[g[1]] || []).push(g[0]); });
  var claimed = slotRows.filter(function (r) { return r[5]; }).map(function (r) { return r[2] + ' → ' + r[5]; });
  Logger.log('Slots: ' + slotRows.length + ' rows. Already claimed: ' + (claimed.join(', ') || 'none'));
  Logger.log('Guests: ' + guestRows.length + ' people, ' + Object.keys(couples).length + ' couples:');
  Object.keys(couples).forEach(function (k) { Logger.log('  ' + k + ': ' + couples[k].join(' + ')); });
  Logger.log('Check the Guests tab. Same value in Couple = partners; put alternate spellings in Aliases (comma-separated).');
}

/**
 * Sheet1's "couple" column (F) can hold a shared tag per couple ("c1", "1",
 * "Smiths"), the partner's name, or a plain yes/x marker on both partners'
 * rows (paired with the next marked row). Returns [name, coupleId, aliases].
 */
function parseGuests_(pairs) {
  var yes = /^(yes|y|x|true|couple|✓|✔)$/i;
  var names = {};
  pairs.forEach(function (p) { names[norm_(p[0])] = p[0]; });
  var groupOf = {};
  var extra = [];
  var pendingYes = null;
  var n = 0;
  var nextId = function () { n += 1; return 'c' + n; };
  var tagIds = {};
  pairs.forEach(function (p) {
    var name = p[0];
    var tag = p[1];
    if (!tag) return;
    if (yes.test(tag)) {
      if (pendingYes) { groupOf[name] = groupOf[pendingYes]; pendingYes = null; }
      else { groupOf[name] = nextId(); pendingYes = name; }
      return;
    }
    var partner = names[norm_(tag)];
    if (partner) {
      groupOf[name] = groupOf[partner] || groupOf[name] || nextId();
      groupOf[partner] = groupOf[name];
      return;
    }
    if (!/^[a-z]?\d+$/i.test(tag) && /[a-z]/i.test(tag) && !tagIds[tag.toLowerCase()] && pairs.filter(function (o) { return o[1] === tag; }).length === 1) {
      // A partner named only in column F.
      groupOf[name] = nextId();
      extra.push([tag, groupOf[name]]);
      names[norm_(tag)] = tag;
      return;
    }
    var key = tag.toLowerCase();
    if (!tagIds[key]) tagIds[key] = nextId();
    groupOf[name] = tagIds[key];
  });
  var rows = pairs.map(function (p) { return [p[0], groupOf[p[0]] || '', '']; });
  extra.forEach(function (e) { rows.push([e[0], e[1], '']); });
  return rows;
}
