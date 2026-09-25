/*
 * Shelf To-Do — pure logic shared by the popup, the full page, the website and the background worker.
 *
 * Data (stored under "shelf.todos"):
 *   { v: 1, lists: [List], tasks: [Task] }
 *   List = { id, name, color, order, updated, deleted? }
 *   Task = { id, list, text, notes, done, doneAt, due, remind, snooze, prio, repeat, order, created, updated, deleted? }
 *
 * Every change stamps `updated`. Deletions are kept as tombstones for 30 days, so browser sync can
 * merge two computers deterministically: for each id, the newest version wins. Nothing is lost.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShelfTodos = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var LIMITS = Object.freeze({ lists: 40, tasks: 3000, text: 300, notes: 4000, listName: 40 });
  var COLORS = ['#0A84FF', '#FF9F0A', '#30D158', '#FF375F', '#BF5AF2', '#40C8E0', '#FFD60A', '#5E5CE6', '#FF453A', '#A2845E', '#8E8E93'];
  var REPEATS = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'];
  var TOMB_MS = 30 * 864e5;
  var MIN = 60e3, HOUR = 3600e3, DAY = 864e5;

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function uid() {
    try { if (typeof crypto !== 'undefined' && crypto.getRandomValues) { var a = new Uint32Array(2); crypto.getRandomValues(a); return 't' + a[0].toString(36) + a[1].toString(36); } } catch (e) { /* ignore */ }
    return 't' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  function clean(s, max) {
    // eslint-disable-next-line no-control-regex
    return (typeof s === 'string' ? s : '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
  }
  function oneLine(s, max) { return clean(String(s || '').replace(/\s+/g, ' '), max); }
  function hex(v) { var m = /^#?([0-9a-f]{6})$/i.exec(String(v || '').trim()); return m ? '#' + m[1].toUpperCase() : null; }
  function num(v) { return typeof v === 'number' && isFinite(v) && v > 0 ? Math.round(v) : null; }
  function validId(id) { return typeof id === 'string' && /^[\w-]{1,64}$/.test(id); }

  /* ───────── sanitize ───────── */
  function sanitizeList(l, i) {
    if (!isObj(l) || !validId(l.id)) return null;
    var out = { id: l.id, name: oneLine(l.name, LIMITS.listName) || 'To-Do', color: hex(l.color) || COLORS[i % COLORS.length], order: typeof l.order === 'number' && isFinite(l.order) ? l.order : i, updated: num(l.updated) || 1 };
    if (l.deleted) { out.deleted = true; }
    return out;
  }
  function sanitizeTask(t, i) {
    if (!isObj(t) || !validId(t.id)) return null;
    if (t.deleted) return { id: t.id, deleted: true, updated: num(t.updated) || 1, order: 0, created: 0 };
    var out = {
      id: t.id, list: validId(t.list) ? t.list : '', text: oneLine(t.text, LIMITS.text), notes: clean(t.notes, LIMITS.notes),
      done: t.done === true, doneAt: num(t.doneAt), due: num(t.due), remind: t.remind === true, snooze: num(t.snooze),
      prio: [0, 1, 2, 3].indexOf(t.prio) >= 0 ? t.prio : 0, repeat: REPEATS.indexOf(t.repeat) >= 0 ? t.repeat : 'none',
      order: typeof t.order === 'number' && isFinite(t.order) ? t.order : i, created: num(t.created) || num(t.updated) || 1, updated: num(t.updated) || 1,
    };
    if (t.deleted) out.deleted = true;
    if (!out.deleted && !out.text) return null;
    if (!out.due) { out.remind = false; out.snooze = null; }
    if (out.done) out.snooze = null;
    return out;
  }
  function sanitize(input, now) {
    now = now || Date.now();
    var d = isObj(input) ? input : {};
    var seen = {}, lists = [], tasks = [];
    (Array.isArray(d.lists) ? d.lists : []).forEach(function (l, i) {
      var x = sanitizeList(l, i);
      if (!x || seen[x.id]) return;
      if (x.deleted && now - x.updated > TOMB_MS) return;
      seen[x.id] = 1; lists.push(x);
    });
    lists = lists.filter(function (l, i) { return l.deleted || lists.slice(0, i).filter(function (y) { return !y.deleted; }).length < LIMITS.lists; });
    var liveList = {};
    lists.forEach(function (l) { if (!l.deleted) liveList[l.id] = 1; });
    var tseen = {};
    (Array.isArray(d.tasks) ? d.tasks : []).forEach(function (t, i) {
      var x = sanitizeTask(t, i);
      if (!x || tseen[x.id]) return;
      if (x.deleted && now - x.updated > TOMB_MS) return;
      tseen[x.id] = 1; tasks.push(x);
    });
    // Tasks whose list vanished go to the first list (never lost).
    var first = lists.filter(function (l) { return !l.deleted; }).sort(byOrder)[0];
    tasks.forEach(function (t) { if (!t.deleted && !liveList[t.list]) { if (first) t.list = first.id; } });
    if (tasks.length > LIMITS.tasks) {
      // Drop the oldest completed ones first.
      tasks.sort(function (a, b) { return (a.done - b.done) || (b.updated - a.updated); });
      tasks = tasks.slice(0, LIMITS.tasks);
    }
    return { v: 1, lists: lists, tasks: tasks };
  }
  function empty() { return { v: 1, lists: [], tasks: [] }; }
  function byOrder(a, b) { return (a.order - b.order) || (a.created || 0) - (b.created || 0); }

  /* ───────── merge (sync between computers) ───────── */
  function merge(a, b, now) {
    a = sanitize(a, now); b = sanitize(b, now);
    function mergeArr(x, y) {
      var map = {};
      x.concat(y).forEach(function (o) { var cur = map[o.id]; if (!cur || o.updated > cur.updated || (o.updated === cur.updated && JSON.stringify(o) > JSON.stringify(cur))) map[o.id] = o; });
      return Object.keys(map).map(function (k) { return map[k]; });
    }
    return sanitize({ lists: mergeArr(a.lists, b.lists).sort(byOrder), tasks: mergeArr(a.tasks, b.tasks).sort(byOrder) }, now);
  }
  function canonical(st) {
    var s = sanitize(st);
    function srt(arr) { return arr.slice().sort(function (p, q) { return p.id < q.id ? -1 : 1; }); }
    return JSON.stringify({ l: srt(s.lists), t: srt(s.tasks) });
  }
  function equal(a, b) { return canonical(a) === canonical(b); }

  /* ───────── compact form for browser sync (short keys, fits the 100 KB budget) ───────── */
  function compact(st, maxChars) {
    var s = sanitize(st);
    var lists = s.lists.map(function (l) { var o = { i: l.id, n: l.name, c: l.color, o: l.order, u: l.updated }; if (l.deleted) o.x = 1; return o; });
    function ct(t) {
      if (t.deleted) return { i: t.id, u: t.updated, x: 1 };
      var o = { i: t.id, l: t.list, t: t.text, o: t.order, u: t.updated, c: t.created };
      if (t.notes) o.n = t.notes;
      if (t.done) { o.d = 1; if (t.doneAt) o.da = t.doneAt; }
      if (t.due) o.du = t.due;
      if (t.remind) o.r = 1;
      if (t.snooze) o.s = t.snooze;
      if (t.prio) o.p = t.prio;
      if (t.repeat !== 'none') o.rp = t.repeat;
      return o;
    }
    // Priority when space is short: open tasks, then tombstones, then recently completed.
    var open = s.tasks.filter(function (t) { return !t.deleted && !t.done; });
    var tomb = s.tasks.filter(function (t) { return t.deleted; });
    var done = s.tasks.filter(function (t) { return !t.deleted && t.done; }).sort(function (a, b) { return b.updated - a.updated; });
    var out = { l: lists, t: open.map(ct) };
    var body = JSON.stringify(out);
    maxChars = maxChars || Infinity;
    [tomb, done].forEach(function (group) {
      group.forEach(function (t) {
        var c = ct(t), add = JSON.stringify(c).length + 1;
        if (body.length + add <= maxChars) { out.t.push(c); body = null; body = JSON.stringify(out); }
      });
    });
    if (body.length > maxChars) {
      // Even the open tasks don't fit: keep the lists and as many open tasks as possible (they stay on this device).
      while (out.t.length && JSON.stringify(out).length > maxChars) out.t.pop();
    }
    return out;
  }
  function expand(c) {
    if (!isObj(c)) return empty();
    var lists = (Array.isArray(c.l) ? c.l : []).map(function (l) { return isObj(l) ? { id: l.i, name: l.n, color: l.c, order: l.o, updated: l.u, deleted: !!l.x } : null; });
    var tasks = (Array.isArray(c.t) ? c.t : []).map(function (t) {
      if (!isObj(t)) return null;
      if (t.x) return { id: t.i, updated: t.u, deleted: true, text: '' };
      return { id: t.i, list: t.l, text: t.t, notes: t.n || '', done: !!t.d, doneAt: t.da, due: t.du, remind: !!t.r, snooze: t.s, prio: t.p || 0, repeat: t.rp || 'none', order: t.o, updated: t.u, created: t.c };
    });
    return sanitize({ lists: lists, tasks: tasks });
  }

  /* ───────── queries ───────── */
  function liveLists(st) { return (st && st.lists || []).filter(function (l) { return !l.deleted; }).sort(byOrder); }
  function liveTasks(st, listId) { return (st && st.tasks || []).filter(function (t) { return !t.deleted && (!listId || t.list === listId); }).sort(byOrder); }
  function alertAt(t) { return t && !t.deleted && !t.done && t.remind && t.due ? (t.snooze || t.due) : null; }
  function effectiveDue(t) { return t && t.due ? (t.snooze && !t.done ? t.snooze : t.due) : null; }
  function isOverdue(t, now) { var d = effectiveDue(t); return !!(t && !t.deleted && !t.done && d && d <= (now || Date.now())); }
  function startOfDay(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function isToday(ms, now) { return !!ms && startOfDay(ms) === startOfDay(now || Date.now()); }
  function counts(st, now) {
    now = now || Date.now();
    var out = { open: 0, overdue: 0, today: 0, done: 0, lists: {} };
    liveTasks(st).forEach(function (t) {
      var c = out.lists[t.list] || (out.lists[t.list] = { open: 0, overdue: 0, today: 0, done: 0 });
      if (t.done) { out.done++; c.done++; return; }
      out.open++; c.open++;
      if (isOverdue(t, now)) { out.overdue++; c.overdue++; }
      else if (t.due && isToday(effectiveDue(t), now)) { out.today++; c.today++; }
    });
    return out;
  }

  /* ───────── repeating tasks ───────── */
  function nextDue(due, repeat, now) {
    if (!due || !repeat || repeat === 'none') return null;
    now = now || Date.now();
    var d = new Date(due), guard = 0;
    function step() {
      if (repeat === 'daily') d.setDate(d.getDate() + 1);
      else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
      else if (repeat === 'weekdays') { do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); }
      else if (repeat === 'monthly') { var day = new Date(due).getDate(); d.setDate(1); d.setMonth(d.getMonth() + 1); d.setDate(Math.min(day, daysIn(d))); }
      else if (repeat === 'yearly') { var dd = new Date(due).getDate(); d.setDate(1); d.setFullYear(d.getFullYear() + 1); d.setDate(Math.min(dd, daysIn(d))); }
    }
    step();
    while (d.getTime() <= now && guard++ < 2000) step();
    return d.getTime();
  }
  function daysIn(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }

  /* ───────── natural-language quick add ─────────
   * "Call Sam tomorrow 5pm !!"   "Pay rent 1st #Home"   "Stand-up in 10 min"   "Gym every weekday 7am"
   */
  var WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function parseQuick(input, now, lists) {
    now = now || Date.now();
    var text = ' ' + String(input || '') + ' ';
    var res = { text: '', due: null, remind: false, prio: 0, list: null, repeat: 'none', tokens: [] };
    var date = null, time = null, rel = null;
    function take(re, fn) {
      var m = re.exec(text);
      if (!m) return false;
      var ok = fn(m);
      if (ok === false) return false;
      res.tokens.push(m[0].trim());
      text = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
      return true;
    }
    // priority
    take(/\s(!{1,3})(?=\s)/, function (m) { res.prio = m[1].length; });
    // list
    if (lists && lists.length) take(/\s#([^\s#]{1,40})(?=\s)/, function (m) {
      var q = m[1].toLowerCase();
      var hit = lists.filter(function (l) { return l.name.toLowerCase().replace(/\s+/g, '') === q; })[0] || lists.filter(function (l) { return l.name.toLowerCase().replace(/\s+/g, '').indexOf(q) === 0; })[0];
      if (!hit) return false;
      res.list = hit.id;
    });
    // repeat
    take(/\s(every\s?day|daily|every\s?weekday|weekdays|every\s?week|weekly|every\s?month|monthly|every\s?year|yearly)(?=\s)/i, function (m) {
      var k = m[1].toLowerCase().replace(/\s/g, '');
      res.repeat = /day$|daily/.test(k) && !/weekday/.test(k) ? 'daily' : /weekday/.test(k) ? 'weekdays' : /week/.test(k) ? 'weekly' : /month/.test(k) ? 'monthly' : 'yearly';
    });
    // relative
    take(/\sin\s(\d{1,3}|an?|half an?)\s?(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)(?=\s)/i, function (m) {
      var n = /^half/i.test(m[1]) ? 0.5 : /^an?$/i.test(m[1]) ? 1 : Number(m[1]);
      var u = m[2].toLowerCase()[0];
      rel = now + n * (u === 'm' ? MIN : u === 'h' ? HOUR : u === 'd' ? DAY : 7 * DAY);
    });
    // days
    take(/\s(today|tonight|tomorrow|tmrw|tmr|next week|this weekend|weekend)(?=\s)/i, function (m) {
      var k = m[1].toLowerCase(), d = new Date(now);
      if (k === 'tonight') { time = time || [20, 0]; }
      else if (k === 'tomorrow' || k === 'tmrw' || k === 'tmr') d.setDate(d.getDate() + 1);
      else if (k === 'next week') { d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); }
      else if (/weekend/.test(k)) { d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || (d.getDay() === 6 ? 0 : 7))); }
      date = [d.getFullYear(), d.getMonth(), d.getDate()];
    });
    var sameWeekday = false;
    if (!date) take(/\s(?:on\s|next\s)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|urday|sday)?(?=\s)/i, function (m) {
      var target = WD.indexOf(m[1].toLowerCase().slice(0, 3)), d = new Date(now);
      var diff = (target - d.getDay() + 7) % 7;
      if (diff === 0) { if (/next/i.test(m[0])) diff = 7; else sameWeekday = true; }
      d.setDate(d.getDate() + diff);
      date = [d.getFullYear(), d.getMonth(), d.getDate()];
    });
    if (!date) take(/\s(?:on\s)?(\d{1,2})(?:st|nd|rd|th)?\s(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?=\s)/i, function (m) {
      date = pickYear(Number(m[1]), MONTHS.indexOf(m[2].toLowerCase().slice(0, 3)), now);
    });
    if (!date) take(/\s(?:on\s)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s(\d{1,2})(?:st|nd|rd|th)?(?=\s)/i, function (m) {
      date = pickYear(Number(m[2]), MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)), now);
    });
    if (!date) take(/\s(\d{4})-(\d{2})-(\d{2})(?=\s)/, function (m) { date = [Number(m[1]), Number(m[2]) - 1, Number(m[3])]; });
    if (!date) take(/\s(?:on\s)?(\d{1,2})\/(\d{1,2})(?=\s)/, function (m) { var mo = Number(m[1]) - 1, da = Number(m[2]); if (mo > 11 || da > 31) return false; date = pickYear(da, mo, now); });
    if (!date) take(/\s(?:on\s)?(?:the\s)?(\d{1,2})(st|nd|rd|th)(?=\s)/i, function (m) {
      var d = new Date(now), day = Number(m[1]);
      if (day < 1 || day > 31) return false;
      if (day < d.getDate()) d.setMonth(d.getMonth() + 1);
      d.setDate(Math.min(day, daysIn(d)));
      date = [d.getFullYear(), d.getMonth(), d.getDate()];
    });
    // times
    take(/\s(?:at\s|@)?(\d{1,2})(?::(\d{2}))?\s?(am|pm|a\.m\.|p\.m\.)(?=\s)/i, function (m) {
      var hh = Number(m[1]) % 12, mm = Number(m[2] || 0);
      if (Number(m[1]) > 12 || mm > 59) return false;
      if (/p/i.test(m[3])) hh += 12;
      time = [hh, mm];
    }) || take(/\s(?:at\s|@)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, function (m) { time = [Number(m[1]), Number(m[2])]; })
      || take(/\s(noon|midday|midnight|morning|afternoon|evening|night)(?=\s)/i, function (m) {
        var k = m[1].toLowerCase();
        time = k === 'noon' || k === 'midday' ? [12, 0] : k === 'midnight' ? [23, 59] : k === 'morning' ? [9, 0] : k === 'afternoon' ? [15, 0] : k === 'evening' ? [18, 0] : [20, 0];
      })
      || take(/\sat\s(\d{1,2})(?=\s)/i, function (m) { var hh = Number(m[1]); if (hh > 23) return false; if (hh >= 1 && hh <= 7) hh += 12; time = [hh, 0]; });

    if (rel) res.due = rel;
    else if (date || time) {
      var base = new Date(now);
      var y = date ? date[0] : base.getFullYear(), mo = date ? date[1] : base.getMonth(), da = date ? date[2] : base.getDate();
      var t = time || [9, 0];
      var dt = new Date(y, mo, da, t[0], t[1], 0, 0).getTime();
      if (!date && dt <= now) dt += DAY;                // "5pm" after 5pm → tomorrow
      if (sameWeekday && dt <= now) dt += 7 * DAY;      // "friday 9am" said on Friday at 10am → next Friday
      res.due = dt;
    }
    if (res.repeat !== 'none' && !res.due) { var dflt = new Date(now); dflt.setHours(9, 0, 0, 0); if (dflt.getTime() <= now) dflt.setDate(dflt.getDate() + 1); res.due = dflt.getTime(); }
    res.remind = !!res.due;
    res.text = oneLine(text, LIMITS.text).replace(/\s+([,.;:])/g, '$1');
    if (!res.text) { res.text = oneLine(input, LIMITS.text); res.due = null; res.remind = false; res.tokens = []; res.prio = 0; res.repeat = 'none'; res.list = null; }
    return res;
  }
  function pickYear(day, month, now) {
    if (month < 0 || day < 1 || day > 31) return null;
    var n = new Date(now), y = n.getFullYear();
    var cand = new Date(y, month, day);
    if (cand.getTime() < startOfDay(now)) y++;
    return [y, month, day];
  }

  /* ───────── formatting ───────── */
  function fmtTime(ms) {
    try { return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); } catch (e) { var d = new Date(ms); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); }
  }
  function fmtDue(ms, now) {
    if (!ms) return '';
    now = now || Date.now();
    var d0 = startOfDay(now), d = startOfDay(ms), diff = Math.round((d - d0) / DAY);
    var t = new Date(ms), tm = fmtTime(ms);
    var day;
    if (diff === 0) day = 'Today';
    else if (diff === 1) day = 'Tomorrow';
    else if (diff === -1) day = 'Yesterday';
    else if (diff > 1 && diff < 7) { try { day = t.toLocaleDateString(undefined, { weekday: 'long' }); } catch (e) { day = WD[t.getDay()]; } }
    else { try { day = t.toLocaleDateString(undefined, t.getFullYear() === new Date(now).getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { day = t.toDateString(); } }
    return day + (tm ? ', ' + tm : '');
  }
  function fmtRel(ms, now) {
    now = now || Date.now();
    var s = Math.round((ms - now) / 1000), a = Math.abs(s), out;
    if (a < 45) return s >= 0 ? 'now' : 'just now';
    if (a < 3600) out = Math.round(a / 60) + ' min';
    else if (a < 86400) out = Math.round(a / 3600) + ' h';
    else out = Math.round(a / 86400) + ' d';
    return s >= 0 ? 'in ' + out : out + ' ago';
  }
  var REPEAT_LABEL = { none: 'Never', daily: 'Every Day', weekdays: 'Every Weekday', weekly: 'Every Week', monthly: 'Every Month', yearly: 'Every Year' };

  /* ───────── mutations (pure: return a new state) ───────── */
  function touch(o, now) { o.updated = Math.max((o.updated || 0) + 1, now || Date.now()); return o; }
  function addList(st, name, color, now) {
    now = now || Date.now();
    var s = sanitize(st, now), n = liveLists(s).length;
    if (n >= LIMITS.lists) return { state: s, list: null };
    var used = liveLists(s).map(function (l) { return l.color; });
    var free = COLORS.filter(function (c) { return used.indexOf(c) < 0; })[0] || COLORS[n % COLORS.length];
    var l = { id: uid(), name: oneLine(name, LIMITS.listName) || 'To-Do', color: hex(color) || free, order: (s.lists.reduce(function (m, x) { return Math.max(m, x.order); }, -1)) + 1, updated: now };
    s.lists.push(l);
    return { state: s, list: l };
  }
  function addTask(st, fields, now) {
    now = now || Date.now();
    var s = sanitize(st, now);
    var list = fields.list && liveLists(s).some(function (l) { return l.id === fields.list; }) ? fields.list : null;
    if (!list) { var first = liveLists(s)[0]; if (!first) { var r = addList(s, 'To-Do', null, now); s = r.state; first = r.list; } list = first.id; }
    var minOrder = liveTasks(s, list).reduce(function (m, t) { return Math.min(m, t.order); }, 1);
    var t = sanitizeTask({
      id: uid(), list: list, text: fields.text, notes: fields.notes || '', due: fields.due || null, remind: !!(fields.due && fields.remind !== false),
      prio: fields.prio || 0, repeat: fields.repeat || 'none', order: fields.atEnd ? liveTasks(s, list).length + 1 : minOrder - 1, created: now, updated: now,
    }, 0);
    if (!t) return { state: s, task: null };
    s.tasks.push(t);
    return { state: s, task: t };
  }
  function updateTask(st, id, patch, now) {
    now = now || Date.now();
    var s = sanitize(st, now);
    var t = s.tasks.filter(function (x) { return x.id === id && !x.deleted; })[0];
    if (!t) return { state: s, task: null };
    Object.keys(patch || {}).forEach(function (k) { if (k !== 'id' && k !== 'created') t[k] = patch[k]; });
    if ('due' in (patch || {}) && !('snooze' in patch)) t.snooze = null;
    touch(t, now);
    var clean2 = sanitizeTask(t, 0);
    if (!clean2) return { state: s, task: null };
    s.tasks[s.tasks.indexOf(t)] = clean2;
    return { state: s, task: clean2 };
  }
  /* Completing a repeating task moves it to its next date instead (like Reminders). */
  function toggleDone(st, id, now) {
    now = now || Date.now();
    var s = sanitize(st, now), t = s.tasks.filter(function (x) { return x.id === id && !x.deleted; })[0];
    if (!t) return { state: s, task: null, repeated: false };
    if (!t.done && t.repeat !== 'none' && t.due) {
      var nd = nextDue(t.due, t.repeat, now);
      return { state: updateTask(s, id, { due: nd, snooze: null }, now).state, task: t, repeated: true, next: nd };
    }
    return Object.assign(updateTask(s, id, { done: !t.done, doneAt: !t.done ? now : null }, now), { repeated: false });
  }
  /* Snooze moves the to-do to the new time (so its date, sorting and badge all follow).
   * Repeating to-dos keep their schedule: only this occurrence is snoozed. */
  function snooze(st, id, until, now) {
    now = now || Date.now();
    var s = sanitize(st, now), t = s.tasks.filter(function (x) { return x.id === id && !x.deleted; })[0];
    if (!t || !until) return { state: s, task: null };
    if (t.repeat !== 'none' && t.due) return updateTask(s, id, { snooze: until, remind: true }, now);
    return updateTask(s, id, { due: until, snooze: null, remind: true }, now);
  }
  function removeTask(st, id, now) {
    now = now || Date.now();
    var s = sanitize(st, now), t = s.tasks.filter(function (x) { return x.id === id; })[0];
    if (!t) return { state: s, task: null };
    var copy = JSON.parse(JSON.stringify(t));
    s.tasks[s.tasks.indexOf(t)] = { id: t.id, text: '', deleted: true, updated: Math.max(now, t.updated + 1), created: t.created, order: t.order, list: t.list, done: false, remind: false, prio: 0, repeat: 'none', notes: '' };
    return { state: s, task: copy };
  }
  function restoreTask(st, task, now) {
    now = now || Date.now();
    var s = sanitize(st, now), copy = Object.assign({}, task, { updated: now });
    delete copy.deleted;
    s.tasks = s.tasks.filter(function (x) { return x.id !== task.id; });
    s.tasks.push(copy);
    return { state: sanitize(s, now), task: copy };
  }
  function updateList(st, id, patch, now) {
    now = now || Date.now();
    var s = sanitize(st, now), l = s.lists.filter(function (x) { return x.id === id && !x.deleted; })[0];
    if (!l) return { state: s, list: null };
    if ('name' in patch) l.name = oneLine(patch.name, LIMITS.listName) || l.name;
    if ('color' in patch) l.color = hex(patch.color) || l.color;
    if ('order' in patch && typeof patch.order === 'number') l.order = patch.order;
    touch(l, now);
    return { state: s, list: l };
  }
  function removeList(st, id, now) {
    now = now || Date.now();
    var s = sanitize(st, now), l = s.lists.filter(function (x) { return x.id === id && !x.deleted; })[0];
    if (!l) return { state: s, removed: 0 };
    var n = 0;
    s.tasks.forEach(function (t, i) { if (t.list === id && !t.deleted) { n++; s.tasks[i] = { id: t.id, text: '', deleted: true, updated: Math.max(now, t.updated + 1), created: t.created, order: t.order, list: id, done: false, remind: false, prio: 0, repeat: 'none', notes: '' }; } });
    l.deleted = true; touch(l, now);
    return { state: s, removed: n };
  }
  function reorder(st, listId, ids, now) {
    now = now || Date.now();
    var s = sanitize(st, now);
    ids.forEach(function (id, i) { var t = s.tasks.filter(function (x) { return x.id === id && !x.deleted; })[0]; if (t && t.order !== i) { t.order = i; touch(t, now); } });
    return { state: s };
  }
  function reorderLists(st, ids, now) {
    now = now || Date.now();
    var s = sanitize(st, now);
    ids.forEach(function (id, i) { var l = s.lists.filter(function (x) { return x.id === id && !x.deleted; })[0]; if (l && l.order !== i) { l.order = i; touch(l, now); } });
    return { state: s };
  }
  function clearDone(st, listId, now) {
    now = now || Date.now();
    var s = sanitize(st, now), n = 0;
    s.tasks.slice().forEach(function (t) { if (!t.deleted && t.done && (!listId || t.list === listId)) { s = removeTask(s, t.id, now).state; n++; } });
    return { state: s, removed: n };
  }
  function wipe(st, now) {
    now = now || Date.now();
    var s = sanitize(st, now);
    liveLists(s).forEach(function (l) { s = removeList(s, l.id, now).state; });
    liveTasks(s).forEach(function (t) { s = removeTask(s, t.id, now).state; });
    return s;
  }
  /* Import: bring in lists/tasks from a backup file without touching what's already here. */
  function importInto(st, incoming, now) {
    now = now || Date.now();
    var s = sanitize(st, now), inc = sanitize(incoming, now);
    function liveIds(arr) { var m = {}; arr.forEach(function (o) { if (!o.deleted) m[o.id] = 1; }); return m; }
    var haveL = liveIds(s.lists), haveT = liveIds(s.tasks);
    // Anything the backup has that isn't here (or was deleted here) comes back, stamped now so sync keeps it.
    inc.lists.forEach(function (l) { if (l.deleted || haveL[l.id]) return; s.lists = s.lists.filter(function (x) { return x.id !== l.id; }); s.lists.push(Object.assign({}, l, { updated: now })); });
    inc.tasks.forEach(function (t) { if (t.deleted || haveT[t.id]) return; s.tasks = s.tasks.filter(function (x) { return x.id !== t.id; }); s.tasks.push(Object.assign({}, t, { updated: now })); });
    return sanitize(s, now);
  }

  return {
    LIMITS: LIMITS, COLORS: COLORS, REPEATS: REPEATS, REPEAT_LABEL: REPEAT_LABEL, MIN: MIN, HOUR: HOUR, DAY: DAY,
    uid: uid, sanitize: sanitize, empty: empty, merge: merge, equal: equal, canonical: canonical, compact: compact, expand: expand,
    liveLists: liveLists, liveTasks: liveTasks, alertAt: alertAt, effectiveDue: effectiveDue, isOverdue: isOverdue, isToday: isToday, startOfDay: startOfDay, counts: counts,
    nextDue: nextDue, parseQuick: parseQuick, fmtDue: fmtDue, fmtTime: fmtTime, fmtRel: fmtRel,
    addList: addList, addTask: addTask, updateTask: updateTask, toggleDone: toggleDone, snooze: snooze, removeTask: removeTask, restoreTask: restoreTask,
    updateList: updateList, removeList: removeList, reorder: reorder, reorderLists: reorderLists, clearDone: clearDone, wipe: wipe, importInto: importInto,
  };
});
