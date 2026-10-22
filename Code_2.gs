/**
 * MRE Halloween Carnival Volunteer Hub (Google Apps Script backend)
 *
 * One permanent backend for every year's carnival.
 *  - Each year ("event") has its own Google Form and its own response Sheet.
 *  - The front desk always works on the event marked "current".
 *  - Admins manage everything from the Admin tab on the website:
 *    start a new year, edit time slots, link a form, change passwords.
 *  - Nobody needs to edit this code or redeploy for any of that.
 *
 * Script Properties used (Project Settings > Script Properties):
 *   FRONT_DESK_PASSWORD   front desk sign-in
 *   ADMIN_PASSWORD        admin sign-in (also works at the front desk)
 *   HUB_CONFIG            managed automatically, do not edit by hand
 *   SHEET_ID              optional, only for upgrading an older single-sheet setup
 */

const TIMEZONE = 'America/Los_Angeles';
const CHECKIN_SHEET = 'CheckIns';
const HUB_FOLDER = 'MRE Carnival Volunteer Hub';

// Question titles used when the script builds a brand new form.
const Q = {
  name: 'Name',
  grade: 'Grade',
  booth: 'What organization are you affiliated with?',
  slot: 'What day/time are you available to volunteer?',
  receipt: 'Will you require a signed receipt of the community service hours you worked?'
};

// Column header guesses. Exact match first, then "header contains this text".
const DEFAULT_COLS = {
  name:    ['Name', 'Full Name', 'Volunteer Name'],
  first:   ['First Name'],
  last:    ['Last Name'],
  booth:   [Q.booth, 'organization', 'Booth', 'Item'],
  slot:    [Q.slot, 'day/time', 'Time Slot', 'Slot', 'Shift'],
  start:   ['Start Time'],
  end:     ['End Time'],
  phone:   ['Phone'],
  email:   ['Email Address', 'Email'],
  grade:   ['Grade'],
  receipt: [Q.receipt, 'signed receipt']
};
const MAP_FIELDS = ['name', 'booth', 'slot', 'grade', 'receipt', 'email'];

const HEADERS = ['Key', 'Name', 'Booth', 'Slot', 'Check In', 'Check Out',
                 'Checked In By', 'Checked Out By', 'Minutes', 'Source', 'Notes'];
const C = { KEY: 0, NAME: 1, BOOTH: 2, SLOT: 3, IN: 4, OUT: 5, INBY: 6, OUTBY: 7, MIN: 8, SRC: 9, NOTES: 10 };

/* =================== HTTP =================== */

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
    const role = roleFor(body.password);
    if (!role) {
      Utilities.sleep(800); // slows down guessing
      return json({ ok: false, error: 'Wrong password', auth: false });
    }
    const action = String(body.action || '');
    if (action.indexOf('admin_') === 0 && role !== 'admin') {
      return json({ ok: false, error: 'This needs the admin password' });
    }

    switch (action) {
      case 'login': {
        let event = null;
        try { event = currentEvent().name; } catch (x) {}
        return json({ ok: true, role, event });
      }
      case 'list': {
        const ev = currentEvent();
        return json({ ok: true, event: ev.name, volunteers: listVolunteers(ev), serverTime: fmt(new Date()) });
      }
      case 'checkin':  return json(withLock(() => checkIn(currentEvent(), body)));
      case 'checkout': return json(withLock(() => checkOut(currentEvent(), body)));
      case 'undo':     return json(withLock(() => undo(currentEvent(), body)));
      case 'walkin':   return json(withLock(() => walkIn(currentEvent(), body)));

      case 'admin_state':          return json(adminState());
      case 'admin_new_year':       return json(withLock(() => adminNewYear(body)));
      case 'admin_update_choices': return json(withLock(() => adminUpdateChoices(body)));
      case 'admin_link':           return json(withLock(() => adminLink(body)));
      case 'admin_save_mapping':   return json(withLock(() => adminSaveMapping(body)));
      case 'admin_set_current':    return json(withLock(() => adminSetCurrent(body)));
      case 'admin_toggle_form':    return json(withLock(() => adminToggleForm(body)));
      case 'admin_set_password':   return json(withLock(() => adminSetPassword(body)));
      case 'admin_hours':          return json(adminHours(body));
      default:                     return json({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function props() { return PropertiesService.getScriptProperties(); }

function roleFor(pw) {
  const admin = props().getProperty('ADMIN_PASSWORD');
  const desk = props().getProperty('FRONT_DESK_PASSWORD');
  if (!admin && !desk) throw new Error('No passwords are set yet. Add FRONT_DESK_PASSWORD and ADMIN_PASSWORD in Script Properties.');
  if (typeof pw !== 'string' || !pw) return null;
  if (admin && pw === admin) return 'admin';
  if (desk && pw === desk) return 'desk';
  return null;
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* =================== Helpers =================== */

function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

function makeKey(name, booth, slot) { return [norm(name), norm(booth), norm(slot)].join('|'); }

function fmt(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  return Utilities.formatDate(d, TIMEZONE, 'h:mm a');
}

function fmtFull(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  return Utilities.formatDate(d, TIMEZONE, 'M/d/yyyy h:mm a');
}

function findCol(headers, candidates) {
  const lower = headers.map(h => norm(h));
  for (const c of candidates || []) {
    const i = lower.indexOf(norm(c));
    if (i !== -1) return i;
  }
  for (const c of candidates || []) {
    const n = norm(c);
    if (!n) continue;
    const i = lower.findIndex(h => h && h.indexOf(n) !== -1);
    if (i !== -1) return i;
  }
  return -1;
}

function cleanList(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split('\n');
  const seen = {};
  return arr.map(s => String(s).trim()).filter(s => s && !seen[s] && (seen[s] = true));
}

function newId() { return 'ev' + Date.now(); }

/* =================== Event config =================== */

function loadConfig() {
  const raw = props().getProperty('HUB_CONFIG');
  if (raw) return JSON.parse(raw);

  // First run: upgrade the older single-sheet setup if there is one.
  const cfg = { current: '', events: {} };
  const legacy = props().getProperty('SHEET_ID');
  if (legacy) {
    let name = 'Current event';
    try { name = SpreadsheetApp.openById(legacy).getName(); } catch (x) {}
    cfg.events.legacy = {
      id: 'legacy', name, sheetId: legacy, formId: '', rosterTab: 'Form Responses 1',
      cols: {}, slots: [], orgs: [], multiSlot: false, created: new Date().toISOString()
    };
    cfg.current = 'legacy';
  }
  return cfg;
}

function saveConfig(cfg) { props().setProperty('HUB_CONFIG', JSON.stringify(cfg)); }

function currentEvent(cfg) {
  cfg = cfg || loadConfig();
  const ev = cfg.events[cfg.current];
  if (!ev) throw new Error('No event is set up yet. An admin needs to start one in the Admin tab.');
  return ev;
}

function getEvent(cfg, id) {
  const ev = cfg.events[id || cfg.current];
  if (!ev) throw new Error('That event no longer exists. Reload the page.');
  return ev;
}

function effectiveCols(ev) {
  const out = {};
  Object.keys(DEFAULT_COLS).forEach(k => {
    out[k] = ev.cols && Object.prototype.hasOwnProperty.call(ev.cols, k) ? ev.cols[k] : DEFAULT_COLS[k];
  });
  return out;
}

function eventSS(ev) { return SpreadsheetApp.openById(ev.sheetId); }

function rosterSheet(ev, ss) {
  ss = ss || eventSS(ev);
  const byName = ev.rosterTab && ss.getSheetByName(ev.rosterTab);
  if (byName) return byName;
  const sheets = ss.getSheets();
  const formTab = sheets.find(s => { try { return !!s.getFormUrl(); } catch (x) { return false; } });
  if (formTab) return formTab;
  const other = sheets.find(s => s.getName() !== CHECKIN_SHEET);
  if (!other) throw new Error('Could not find the sign-up responses tab in the sheet');
  return other;
}

function openForm(ev) {
  try {
    if (ev.formId) return FormApp.openById(ev.formId);
    const url = rosterSheet(ev).getFormUrl();
    return url ? FormApp.openByUrl(url) : null;
  } catch (x) {
    return null;
  }
}

function hubFolder() {
  const it = DriveApp.getFoldersByName(HUB_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(HUB_FOLDER);
}

/* =================== Form helpers =================== */

function findItem(form, candidates) {
  const items = form.getItems();
  const titles = items.map(i => norm(i.getTitle()));
  for (const c of candidates || []) {
    const i = titles.indexOf(norm(c));
    if (i !== -1) return items[i];
  }
  for (const c of candidates || []) {
    const n = norm(c);
    if (!n) continue;
    const i = titles.findIndex(t => t.indexOf(n) !== -1);
    if (i !== -1) return items[i];
  }
  return null;
}

function choiceItem(item) {
  if (!item) return null;
  const t = item.getType();
  if (t === FormApp.ItemType.MULTIPLE_CHOICE) return { kind: 'mc', obj: item.asMultipleChoiceItem() };
  if (t === FormApp.ItemType.CHECKBOX) return { kind: 'checkbox', obj: item.asCheckboxItem() };
  if (t === FormApp.ItemType.LIST) return { kind: 'list', obj: item.asListItem() };
  return null;
}

function setChoices(form, candidates, values, label) {
  const item = findItem(form, candidates);
  if (!item) return ['Could not find the ' + label + ' question on the form, so its choices were not changed.'];
  const ci = choiceItem(item);
  if (!ci) return ['The ' + label + ' question is a type-your-answer question, so there are no choices to update.'];
  ci.obj.setChoiceValues(values);
  return [];
}

function readChoices(form, candidates) {
  const ci = choiceItem(findItem(form, candidates));
  if (!ci) return { values: [], multi: false };
  return { values: ci.obj.getChoices().map(c => c.getValue()), multi: ci.kind === 'checkbox' };
}

function buildForm(name, orgs) {
  const form = FormApp.create(name + ' Volunteer Sign-Up');
  form.setDescription('Thank you for helping at the ' + name + '! Check every time slot you can cover.');
  try { form.setCollectEmail(true); } catch (x) {}
  form.addTextItem().setTitle(Q.name).setRequired(true);
  form.addTextItem().setTitle(Q.grade);
  form.addMultipleChoiceItem().setTitle(Q.booth)
    .setChoiceValues(orgs.length ? orgs : ['Not affiliated']).showOtherOption(true).setRequired(true);
  form.addCheckboxItem().setTitle(Q.slot).setChoiceValues(['To be announced']).setRequired(true);
  form.addMultipleChoiceItem().setTitle(Q.receipt).setChoiceValues(['Yes', 'No']).setRequired(true);
  return form;
}

function attachNewSheet(form, title, folder) {
  const ss = SpreadsheetApp.create(title);
  if (folder) DriveApp.getFileById(ss.getId()).moveTo(folder);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();
  const sheets = ss.getSheets();
  const resp = sheets.find(s => { try { return !!s.getFormUrl(); } catch (x) { return false; } }) || sheets[0];
  sheets.forEach(s => {
    if (s.getName() !== resp.getName() && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
  return { ss, rosterTab: resp.getName() };
}

/* =================== Roster (read only) =================== */

// Splits a checkbox answer like "11am - 1pm, 1pm - 3pm" into separate slots,
// using the known choice list so commas inside a slot name are safe.
function splitSlots(answer, known) {
  answer = String(answer || '').trim();
  if (!answer || !known || !known.length) return [answer];
  let rest = ', ' + answer + ', ';
  const found = [];
  known.slice().sort((a, b) => b.length - a.length).forEach(s => {
    const t = ', ' + s + ', ';
    if (rest.indexOf(t) !== -1) { found.push(s); rest = rest.replace(t, ', '); }
  });
  if (!found.length) return [answer];
  const out = known.filter(s => found.indexOf(s) !== -1);
  const left = rest.replace(/^(,\s*)+|(,\s*)+$/g, '').trim();
  if (left) out.push(left);
  return out;
}

function readRoster(ev) {
  const data = rosterSheet(ev).getDataRange().getDisplayValues();
  if (data.length < 2) return [];

  const h = data[0];
  const cols = effectiveCols(ev);
  const ix = {};
  Object.keys(cols).forEach(k => { ix[k] = findCol(h, cols[k]); });

  const seen = {};
  const out = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const get = k => ix[k] !== -1 ? String(row[ix[k]]).trim() : '';

    let name = get('name');
    if (!name && (ix.first !== -1 || ix.last !== -1)) name = (get('first') + ' ' + get('last')).trim();
    if (!name) continue;

    const booth = get('booth');
    let rawSlot = get('slot');
    if (!rawSlot && ix.start !== -1) rawSlot = get('start') + (get('end') ? ' - ' + get('end') : '');
    const extra = { phone: get('phone'), grade: get('grade'), receipt: get('receipt') };

    const slots = ev.multiSlot ? splitSlots(rawSlot, ev.slots) : [rawSlot];
    slots.forEach(slot => {
      const key = makeKey(name, booth, slot);
      if (seen[key]) return; // duplicate submission
      seen[key] = true;
      out.push({ key, name, booth, slot, phone: extra.phone, grade: extra.grade, receipt: extra.receipt });
    });
  }
  return out;
}

/* =================== Check-in store =================== */

function checkinSheet(ev, ss) {
  ss = ss || eventSS(ev);
  let sh = ss.getSheetByName(CHECKIN_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CHECKIN_SHEET);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('E:F').setNumberFormat('m/d/yyyy h:mm:ss am/pm');
  }
  return sh;
}

function readCheckins(ev) {
  const sh = checkinSheet(ev);
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
    if (v[C.SRC] && v[C.SRC] !== 'roster') rec.source = v[C.SRC];
    rec.status = rec.checkOut ? 'done' : (rec.checkIn ? 'here' : 'expected');
  }
  return rec;
}

function listVolunteers(ev) {
  const roster = readRoster(ev);
  const cis = readCheckins(ev);
  const used = {};
  const out = roster.map(p => { used[p.key] = true; return toRecord(p, cis[p.key]); });

  // Check-ins whose person is no longer on the roster stay visible.
  Object.keys(cis).forEach(k => {
    if (used[k]) return;
    const v = cis[k].v;
    const src = v[C.SRC] === 'walk-in' ? 'walk-in' : 'not on roster';
    out.push(toRecord({ key: k, name: v[C.NAME], booth: v[C.BOOTH], slot: v[C.SLOT], source: src }, cis[k]));
  });
  return out;
}

function lookup(ev, key) { return readRoster(ev).find(x => x.key === key) || null; }

function recordFor(ev, key) { return listVolunteers(ev).find(r => r.key === key) || null; }

/* =================== Front desk actions =================== */

function checkIn(ev, body) {
  const key = String(body.key || '');
  const existing = readCheckins(ev)[key];
  if (existing && existing.v[C.IN]) return { ok: false, error: 'Already checked in at ' + fmt(existing.v[C.IN]) };
  const p = lookup(ev, key);
  if (!p) return { ok: false, error: 'Volunteer not found on the sign-up list. Refresh and try again.' };

  checkinSheet(ev).appendRow([key, p.name, p.booth, p.slot, new Date(), '', body.deskName || '', '', '', 'roster', '']);
  return { ok: true, record: toRecord(p, readCheckins(ev)[key]) };
}

function checkOut(ev, body) {
  const key = String(body.key || '');
  const ci = readCheckins(ev)[key];
  if (!ci || !ci.v[C.IN]) return { ok: false, error: 'Not checked in yet' };
  if (ci.v[C.OUT]) return { ok: false, error: 'Already checked out at ' + fmt(ci.v[C.OUT]) };

  const sh = checkinSheet(ev);
  const now = new Date();
  const mins = Math.round((now - ci.v[C.IN]) / 60000);
  sh.getRange(ci.row, C.OUT + 1, 1, 1).setValue(now);
  sh.getRange(ci.row, C.OUTBY + 1, 1, 2).setValues([[body.deskName || '', mins]]);
  return { ok: true, record: recordFor(ev, key) };
}

function undo(ev, body) {
  const key = String(body.key || '');
  const ci = readCheckins(ev)[key];
  if (!ci) return { ok: false, error: 'Nothing to undo' };
  const sh = checkinSheet(ev);

  if (ci.v[C.OUT]) {
    sh.getRange(ci.row, C.OUT + 1, 1, 1).clearContent();
    sh.getRange(ci.row, C.OUTBY + 1, 1, 2).clearContent();
    return { ok: true, record: recordFor(ev, key) };
  }
  const wasWalkin = ci.v[C.SRC] === 'walk-in';
  sh.deleteRow(ci.row);
  if (wasWalkin) return { ok: true, removed: key };
  return { ok: true, record: recordFor(ev, key) };
}

function walkIn(ev, body) {
  const name = String(body.name || '').trim();
  if (!name) return { ok: false, error: 'Name is required' };
  const booth = String(body.booth || '').trim();
  const slot = String(body.slot || '').trim();
  const key = makeKey(name, booth, slot);

  if (lookup(ev, key)) return checkIn(ev, { key, deskName: body.deskName });
  if (readCheckins(ev)[key]) return { ok: false, error: 'That walk-in already exists' };

  checkinSheet(ev).appendRow([key, name, booth, slot, new Date(), '', body.deskName || '', '', '', 'walk-in', '']);
  return { ok: true, record: recordFor(ev, key) };
}

/* =================== Admin actions =================== */

function eventSummary(ev, isCurrent) {
  const s = {
    id: ev.id, name: ev.name, current: isCurrent, created: ev.created,
    slots: ev.slots || [], orgs: ev.orgs || [], multiSlot: !!ev.multiSlot,
    sheetUrl: '', formUrl: '', formEditUrl: '', accepting: null,
    responses: 0, checkins: 0, headers: [], mapping: {}, warnings: []
  };
  try {
    const ss = eventSS(ev);
    s.sheetUrl = ss.getUrl();
    const sh = rosterSheet(ev, ss);
    const lastCol = sh.getLastColumn();
    s.headers = lastCol ? sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].filter(String) : [];
    const cols = effectiveCols(ev);
    MAP_FIELDS.forEach(k => {
      const i = findCol(s.headers, cols[k]);
      s.mapping[k] = i === -1 ? '' : s.headers[i];
    });
    s.responses = Math.max(0, sh.getLastRow() - 1);
    const ci = ss.getSheetByName(CHECKIN_SHEET);
    s.checkins = ci ? Math.max(0, ci.getLastRow() - 1) : 0;
    if (s.headers.length && !s.mapping.name) s.warnings.push('Could not find the Name column. Fix it under "Match the sheet columns".');
  } catch (x) {
    s.warnings.push('Cannot open this event\'s spreadsheet: ' + x.message);
  }
  const form = openForm(ev);
  if (form) {
    try {
      s.formUrl = form.getPublishedUrl();
      s.formEditUrl = form.getEditUrl();
      s.accepting = form.isAcceptingResponses();
    } catch (x) {}
  } else {
    s.warnings.push('No Google Form is connected to this event.');
  }
  return s;
}

function adminState() {
  const cfg = loadConfig();
  const events = Object.keys(cfg.events).map(k => cfg.events[k])
    .sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return {
    ok: true,
    current: cfg.current,
    events: events.map(ev => eventSummary(ev, ev.id === cfg.current)),
    deskPasswordSet: !!props().getProperty('FRONT_DESK_PASSWORD')
  };
}

function adminNewYear(body) {
  const name = String(body.name || '').trim();
  if (!name) return { ok: false, error: 'Give the event a name' };
  const slots = cleanList(body.slots);
  const orgs = cleanList(body.orgs);
  if (!slots.length) return { ok: false, error: 'Add at least one time slot' };

  const cfg = loadConfig();
  const prev = cfg.events[cfg.current] || null;
  const prevForm = prev ? openForm(prev) : null;
  const folder = hubFolder();
  const notes = [];
  let form, cols;

  if (body.copyPrevious && prevForm) {
    const copy = DriveApp.getFileById(prevForm.getId()).makeCopy(name + ' Volunteer Sign-Up', folder);
    form = FormApp.openById(copy.getId());
    try { form.removeDestination(); } catch (x) {}
    form.setTitle(name + ' Volunteer Sign-Up');
    cols = prev.cols ? JSON.parse(JSON.stringify(prev.cols)) : {};
    notes.push('Copied last year\'s form questions.');
  } else {
    form = buildForm(name, orgs);
    DriveApp.getFileById(form.getId()).moveTo(folder);
    cols = { name: [Q.name], grade: [Q.grade], booth: [Q.booth], slot: [Q.slot], receipt: [Q.receipt], email: ['Email Address'] };
    notes.push('Built a new sign-up form.');
  }

  const colsFull = effectiveCols({ cols });
  setChoices(form, colsFull.slot, slots, 'time slot').forEach(n => notes.push(n));
  if (orgs.length) setChoices(form, colsFull.booth, orgs, 'organization').forEach(n => notes.push(n));
  const slotInfo = readChoices(form, colsFull.slot);

  const dest = attachNewSheet(form, name + ' Volunteer Responses', folder);
  checkinSheet(null, dest.ss);
  form.setAcceptingResponses(true);

  const id = newId();
  cfg.events[id] = {
    id, name, formId: form.getId(), sheetId: dest.ss.getId(), rosterTab: dest.rosterTab,
    cols, slots, orgs, multiSlot: slotInfo.multi, created: new Date().toISOString()
  };

  if (body.closePrevious && prevForm) {
    try { prevForm.setAcceptingResponses(false); notes.push('Closed last year\'s form to new sign-ups.'); } catch (x) {}
  }

  cfg.current = id;
  saveConfig(cfg);
  return { ok: true, notes, event: eventSummary(cfg.events[id], true) };
}

function adminUpdateChoices(body) {
  const cfg = loadConfig();
  const ev = getEvent(cfg, body.eventId);
  const slots = cleanList(body.slots);
  const orgs = cleanList(body.orgs);
  if (!slots.length) return { ok: false, error: 'Keep at least one time slot' };

  const form = openForm(ev);
  if (!form) return { ok: false, error: 'No Google Form is connected to this event, so there is nothing to update.' };

  const cols = effectiveCols(ev);
  const notes = [];
  setChoices(form, cols.slot, slots, 'time slot').forEach(n => notes.push(n));
  if (orgs.length) setChoices(form, cols.booth, orgs, 'organization').forEach(n => notes.push(n));

  ev.slots = slots;
  ev.orgs = orgs;
  ev.multiSlot = readChoices(form, cols.slot).multi;
  saveConfig(cfg);
  return { ok: true, notes, event: eventSummary(ev, ev.id === cfg.current) };
}

function adminLink(body) {
  const link = String(body.link || '').trim();
  const name = String(body.name || '').trim();
  if (!name) return { ok: false, error: 'Give the event a name' };
  let form = null, ss = null;

  if (/docs\.google\.com\/forms\//.test(link)) {
    if (/\/forms\/d\/e\//.test(link) || /forms\.gle/.test(link)) {
      return { ok: false, error: 'That is the share link. Open the form for editing and copy that link instead (it ends in /edit).' };
    }
    form = FormApp.openByUrl(link);
    try { ss = SpreadsheetApp.openById(form.getDestinationId()); } catch (x) { ss = null; }
    if (!ss) ss = attachNewSheet(form, name + ' Volunteer Responses', hubFolder()).ss;
  } else if (/docs\.google\.com\/spreadsheets\//.test(link)) {
    ss = SpreadsheetApp.openByUrl(link);
    const tab = ss.getSheets().find(s => { try { return !!s.getFormUrl(); } catch (x) { return false; } });
    if (tab) { try { form = FormApp.openByUrl(tab.getFormUrl()); } catch (x) {} }
  } else {
    return { ok: false, error: 'Paste a Google Form edit link or a Google Sheet link' };
  }

  const cfg = loadConfig();
  const id = newId();
  const ev = { id, name, formId: form ? form.getId() : '', sheetId: ss.getId(), rosterTab: '',
               cols: {}, slots: [], orgs: [], multiSlot: false, created: new Date().toISOString() };
  ev.rosterTab = rosterSheet(ev, ss).getName();
  if (form) {
    const s = readChoices(form, DEFAULT_COLS.slot);
    ev.slots = s.values;
    ev.multiSlot = s.multi;
    ev.orgs = readChoices(form, DEFAULT_COLS.booth).values;
  }
  checkinSheet(ev, ss);
  cfg.events[id] = ev;
  if (body.makeCurrent !== false) cfg.current = id;
  saveConfig(cfg);
  return { ok: true, event: eventSummary(ev, cfg.current === id) };
}

function adminSaveMapping(body) {
  const cfg = loadConfig();
  const ev = getEvent(cfg, body.eventId);
  const m = body.mapping || {};
  if (!m.name) return { ok: false, error: 'Pick which column holds the volunteer\'s name' };
  ev.cols = ev.cols || {};
  MAP_FIELDS.forEach(k => { ev.cols[k] = m[k] ? [String(m[k])] : []; });
  saveConfig(cfg);
  return { ok: true, event: eventSummary(ev, ev.id === cfg.current) };
}

function adminSetCurrent(body) {
  const cfg = loadConfig();
  const ev = getEvent(cfg, body.eventId);
  cfg.current = ev.id;
  saveConfig(cfg);
  return { ok: true };
}

function adminToggleForm(body) {
  const cfg = loadConfig();
  const ev = getEvent(cfg, body.eventId);
  const form = openForm(ev);
  if (!form) return { ok: false, error: 'No Google Form is connected to this event' };
  form.setAcceptingResponses(!!body.open);
  return { ok: true, accepting: form.isAcceptingResponses() };
}

function adminSetPassword(body) {
  const which = body.which === 'admin' ? 'ADMIN_PASSWORD' : 'FRONT_DESK_PASSWORD';
  const other = which === 'ADMIN_PASSWORD' ? 'FRONT_DESK_PASSWORD' : 'ADMIN_PASSWORD';
  const value = String(body.value || '');
  if (value.length < 4) return { ok: false, error: 'Use at least 4 characters' };
  if (value === props().getProperty(other)) return { ok: false, error: 'The admin and front desk passwords must be different' };
  props().setProperty(which, value);
  return { ok: true };
}

function adminHours(body) {
  const cfg = loadConfig();
  const ev = getEvent(cfg, body.eventId);
  const roster = {};
  try { readRoster(ev).forEach(p => { roster[p.key] = p; }); } catch (x) {}

  const sh = checkinSheet(ev);
  const last = sh.getLastRow();
  const rows = [];
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, HEADERS.length).getValues().forEach(v => {
      if (!v[C.KEY]) return;
      const p = roster[v[C.KEY]] || {};
      const mins = v[C.MIN] === '' ? '' : Number(v[C.MIN]);
      rows.push({
        name: v[C.NAME], organization: v[C.BOOTH], slot: v[C.SLOT], grade: p.grade || '',
        receipt: p.receipt || '', checkIn: fmtFull(v[C.IN]), checkOut: fmtFull(v[C.OUT]),
        minutes: mins, hours: mins === '' ? '' : Math.round(mins / 6) / 10,
        source: v[C.SRC] || 'roster'
      });
    });
  }
  return { ok: true, event: ev.name, rows };
}

/* =================== Run from the editor =================== */

// Run this once after pasting the code. It grants permissions and logs the setup.
function testSetup() {
  hubFolder();
  const p = props();
  Logger.log('Front desk password set: ' + !!p.getProperty('FRONT_DESK_PASSWORD'));
  Logger.log('Admin password set: ' + !!p.getProperty('ADMIN_PASSWORD'));
  const cfg = loadConfig();
  if (!cfg.events[cfg.current]) {
    Logger.log('No event yet. Sign in on the website with the admin password and start one.');
    return;
  }
  const ev = currentEvent(cfg);
  Logger.log('Current event: ' + ev.name);
  const r = readRoster(ev);
  Logger.log('Volunteers found: ' + r.length);
  Logger.log(JSON.stringify(r.slice(0, 5), null, 2));
}
