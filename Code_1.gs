/**
 * MRE Volunteer Check-In API
 * Paste into Extensions > Apps Script on the sign-up Google Sheet.
 *
 * Design rules:
 *  - The ROSTER tab is read only. It can be re-imported or auto-updated anytime.
 *  - All check-in data lives in the CHECKINS tab, keyed by name + booth + slot.
 *    Roster changes never touch it, so no check-in is ever lost.
 *  - Timestamps come from the server clock, not the front desk device.
 *  - The password lives in Script Properties and is checked on every request.
 */

const CONFIG = {
  ROSTER_SHEET: 'Form Responses 1', // Google Form response tab (rename here if yours differs)
  CHECKIN_SHEET: 'CheckIns',        // created automatically on first use
  TIMEZONE: 'America/Los_Angeles',
  // Matched case-insensitively. Exact match first, then "header contains this text".
  COLS: {
    name:    ['Name'],
    first:   [],
    last:    [],
    booth:   ['What organization are you affiliated with?', 'organization'],
    slot:    ['What day/time are you available to volunteer?', 'day/time'],
    start:   [],
    end:     [],
    phone:   [],
    email:   ['Email Address'],
    grade:   ['Grade'],
    receipt: ['Will you require a signed receipt of the community service hours you worked?', 'signed receipt']
  }
};

const HEADERS = ['Key', 'Name', 'Booth', 'Slot', 'Check In', 'Check Out',
                 'Checked In By', 'Checked Out By', 'Minutes', 'Source', 'Notes'];
const C = { KEY: 0, NAME: 1, BOOTH: 2, SLOT: 3, IN: 4, OUT: 5, INBY: 6, OUTBY: 7, MIN: 8, SRC: 9, NOTES: 10 };

/* ---------- HTTP ---------- */

function doGet() {
  return json({ ok: true, msg: 'Check-in API is running. Use POST.' });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: 'Bad request' });
  }

  try {
    if (!passwordOk(body.password)) {
      Utilities.sleep(800); // slows down guessing
      return json({ ok: false, error: 'Wrong password', auth: false });
    }
    switch (body.action) {
      case 'login':    return json({ ok: true });
      case 'list':     return json({ ok: true, volunteers: listVolunteers(), serverTime: fmt(new Date()) });
      case 'checkin':  return json(withLock(() => checkIn(body)));
      case 'checkout': return json(withLock(() => checkOut(body)));
      case 'undo':     return json(withLock(() => undo(body)));
      case 'walkin':   return json(withLock(() => walkIn(body)));
      default:         return json({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function passwordOk(pw) {
  const real = PropertiesService.getScriptProperties().getProperty('FRONT_DESK_PASSWORD');
  if (!real) throw new Error('FRONT_DESK_PASSWORD is not set in Script Properties');
  return typeof pw === 'string' && pw === real;
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------- Helpers ---------- */

function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function makeKey(name, booth, slot) {
  return [norm(name), norm(booth), norm(slot)].join('|');
}

function fmt(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  return Utilities.formatDate(d, CONFIG.TIMEZONE, 'h:mm a');
}

function findCol(headers, candidates) {
  const lower = headers.map(h => norm(h));
  for (const c of candidates) {
    const i = lower.indexOf(norm(c));
    if (i !== -1) return i;
  }
  for (const c of candidates) {
    const i = lower.findIndex(h => h && h.includes(norm(c)));
    if (i !== -1) return i;
  }
  return -1;
}

function ss() {
  // Works both when the script is attached to the Sheet and when it is a standalone project.
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('Set SHEET_ID in Script Properties (this script is not attached to a Sheet)');
  return active;
}

/* ---------- Roster (read only) ---------- */

function readRoster() {
  const sh = ss().getSheetByName(CONFIG.ROSTER_SHEET);
  if (!sh) throw new Error('Roster tab "' + CONFIG.ROSTER_SHEET + '" not found');
  const data = sh.getDataRange().getDisplayValues(); // display values avoid 1899 date weirdness
  if (data.length < 2) return [];

  const h = data[0];
  const ix = {};
  Object.keys(CONFIG.COLS).forEach(k => { ix[k] = findCol(h, CONFIG.COLS[k]); });

  const seen = {};
  const out = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    let name = ix.name !== -1 ? row[ix.name] : '';
    if (!name && (ix.first !== -1 || ix.last !== -1)) {
      name = [ix.first !== -1 ? row[ix.first] : '', ix.last !== -1 ? row[ix.last] : ''].join(' ');
    }
    name = String(name).trim();
    if (!name) continue; // empty slot

    const booth = ix.booth !== -1 ? String(row[ix.booth]).trim() : '';
    let slot = ix.slot !== -1 ? String(row[ix.slot]).trim() : '';
    if (!slot && ix.start !== -1) {
      slot = row[ix.start] + (ix.end !== -1 && row[ix.end] ? ' - ' + row[ix.end] : '');
    }
    const get = k => ix[k] !== -1 ? String(row[ix[k]]).trim() : '';
    const phone = get('phone');
    const grade = get('grade');
    const receipt = get('receipt');

    const key = makeKey(name, booth, slot);
    if (seen[key]) continue; // duplicate form submission
    seen[key] = true;
    out.push({ key, name, booth, slot, phone, grade, receipt });
  }
  return out;
}

/* ---------- Check-in store ---------- */

function checkinSheet() {
  let sh = ss().getSheetByName(CONFIG.CHECKIN_SHEET);
  if (!sh) {
    sh = ss().insertSheet(CONFIG.CHECKIN_SHEET);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('E:F').setNumberFormat('m/d/yyyy h:mm:ss am/pm');
  }
  return sh;
}

function readCheckins() {
  const sh = checkinSheet();
  const last = sh.getLastRow();
  const map = {};
  if (last < 2) return map;
  const vals = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  vals.forEach((v, i) => { if (v[C.KEY]) map[v[C.KEY]] = { row: i + 2, v }; });
  return map;
}

function toRecord(base, ci) {
  const rec = {
    key: base.key, name: base.name, booth: base.booth, slot: base.slot,
    phone: base.phone || '', grade: base.grade || '', receipt: base.receipt || '',
    source: base.source || 'roster',
    checkIn: '', checkOut: '', checkInBy: '', checkOutBy: '', minutes: '', status: 'expected'
  };
  if (ci) {
    const v = ci.v;
    rec.checkIn = fmt(v[C.IN]);
    rec.checkOut = fmt(v[C.OUT]);
    rec.checkInBy = v[C.INBY] || '';
    rec.checkOutBy = v[C.OUTBY] || '';
    rec.minutes = v[C.MIN] === '' ? '' : v[C.MIN];
    if (v[C.SRC]) rec.source = v[C.SRC];
    rec.status = rec.checkOut ? 'done' : (rec.checkIn ? 'here' : 'expected');
  }
  return rec;
}

function listVolunteers() {
  const roster = readRoster();
  const cis = readCheckins();
  const used = {};
  const out = roster.map(p => { used[p.key] = true; return toRecord(p, cis[p.key]); });

  // Check-ins whose person is no longer on the roster (walk-ins, or removed/renamed rows).
  // They stay visible so no history disappears.
  Object.keys(cis).forEach(k => {
    if (used[k]) return;
    const v = cis[k].v;
    const src = v[C.SRC] === 'walk-in' ? 'walk-in' : 'not on roster';
    out.push(toRecord({ key: k, name: v[C.NAME], booth: v[C.BOOTH], slot: v[C.SLOT], source: src }, cis[k]));
  });
  return out;
}

function lookup(key) {
  const p = readRoster().find(x => x.key === key);
  return p || null;
}

/* ---------- Actions ---------- */

function checkIn(body) {
  const key = String(body.key || '');
  const cis = readCheckins();
  const existing = cis[key];
  if (existing && existing.v[C.IN]) {
    return { ok: false, error: 'Already checked in at ' + fmt(existing.v[C.IN]) };
  }
  const p = lookup(key);
  if (!p) return { ok: false, error: 'Volunteer not found on roster. Refresh and try again.' };

  const sh = checkinSheet();
  const now = new Date();
  sh.appendRow([key, p.name, p.booth, p.slot, now, '', body.deskName || '', '', '', 'roster', '']);
  return { ok: true, record: toRecord(p, readCheckins()[key]) };
}

function checkOut(body) {
  const key = String(body.key || '');
  const ci = readCheckins()[key];
  if (!ci || !ci.v[C.IN]) return { ok: false, error: 'Not checked in yet' };
  if (ci.v[C.OUT]) return { ok: false, error: 'Already checked out at ' + fmt(ci.v[C.OUT]) };

  const sh = checkinSheet();
  const now = new Date();
  const mins = Math.round((now - ci.v[C.IN]) / 60000);
  sh.getRange(ci.row, C.OUT + 1, 1, 1).setValue(now);
  sh.getRange(ci.row, C.OUTBY + 1, 1, 2).setValues([[body.deskName || '', mins]]);
  return { ok: true, record: recordFor(key) };
}

function undo(body) {
  const key = String(body.key || '');
  const ci = readCheckins()[key];
  if (!ci) return { ok: false, error: 'Nothing to undo' };
  const sh = checkinSheet();

  if (ci.v[C.OUT]) {
    // Undo the checkout only
    sh.getRange(ci.row, C.OUT + 1, 1, 1).clearContent();
    sh.getRange(ci.row, C.OUTBY + 1, 1, 2).clearContent();
    return { ok: true, record: recordFor(key) };
  }
  // Undo the check-in (removes the row; a walk-in disappears entirely)
  const wasWalkin = ci.v[C.SRC] === 'walk-in';
  sh.deleteRow(ci.row);
  if (wasWalkin) return { ok: true, removed: key };
  return { ok: true, record: recordFor(key) };
}

function walkIn(body) {
  const name = String(body.name || '').trim();
  if (!name) return { ok: false, error: 'Name is required' };
  const booth = String(body.booth || '').trim();
  const slot = String(body.slot || '').trim();
  const key = makeKey(name, booth, slot);

  // If they are actually on the roster, treat it as a normal check-in.
  if (lookup(key)) return checkIn({ key, deskName: body.deskName });
  if (readCheckins()[key]) return { ok: false, error: 'That walk-in already exists' };

  checkinSheet().appendRow([key, name, booth, slot, new Date(), '', body.deskName || '', '', '', 'walk-in', '']);
  return { ok: true, record: recordFor(key) };
}

function recordFor(key) {
  return listVolunteers().find(r => r.key === key) || null;
}

/* ---------- Run once from the editor to test ---------- */

function testRoster() {
  const r = readRoster();
  Logger.log('Roster rows: ' + r.length);
  Logger.log(JSON.stringify(r.slice(0, 5), null, 2));
}
