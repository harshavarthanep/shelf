/*
 * Shelf store — shared by the popup, the full page and the background worker.
 *
 * Where your data lives (safest first):
 *   1. chrome.storage.local  — extension storage. NOT touched by "Clear browsing data"
 *                              (cache, cookies, history). Only uninstalling removes it.
 *   2. chrome.storage.sync   — a compact copy in your browser account (Chrome / Edge /
 *                              Firefox Sync). Survives uninstall + reinstall and syncs devices.
 *   3. Local snapshots       — the last 10 versions, restorable from Settings.
 *   4. Export file           — a JSON backup you keep yourself.
 */
(function (root, factory) {
  var Core = root.ShelfCore || (typeof require === 'function' ? require('./core.js') : null);
  var api = factory(Core, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShelfStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, g) {
  'use strict';

  /* ───────── browser API (promise + callback styles) ───────── */
  var API = null, PROMISE = false;
  try {
    if (g.browser && g.browser.runtime && g.browser.runtime.id) { API = g.browser; PROMISE = true; }
    else if (g.chrome && g.chrome.runtime && g.chrome.runtime.id) API = g.chrome;
  } catch (e) { API = null; }

  function call(ns, method) {
    var args = Array.prototype.slice.call(arguments, 2);
    return new Promise(function (resolve, reject) {
      try {
        var fn = ns && ns[method];
        if (typeof fn !== 'function') { reject(new Error('unavailable')); return; }
        if (PROMISE) { Promise.resolve(fn.apply(ns, args)).then(resolve, reject); return; }
        fn.apply(ns, args.concat(function (res) {
          var err = g.chrome && g.chrome.runtime && g.chrome.runtime.lastError;
          if (err) reject(new Error(err.message || 'error')); else resolve(res);
        }));
      } catch (e) { reject(e); }
    });
  }

  var KEYS = {
    items: 'shelf.items', legacyApps: 'shelf.apps', settings: 'shelf.settings', meta: 'shelf.meta',
    snaps: 'shelf.snapshots', device: 'shelf.device', syncState: 'shelf.syncState',
    syncBase: 'shelf.syncBase', logos: 'shelf.logos', wallpaperImg: 'shelf.wallpaperImage',
  };
  var SYNC_META = 'sb.meta', SYNC_PREFIX = 'sb.', CHUNK = 2000, SYNC_MAX = 95000;

  var hasLS = (function () { try { return typeof localStorage !== 'undefined' && !!localStorage; } catch (e) { return false; } })();
  function lsArea(prefix) {
    return {
      get: function (keys) {
        var o = {};
        if (!hasLS) return Promise.resolve(o);
        var list = keys == null ? Object.keys(localStorage).filter(function (k) { return k.indexOf(prefix) === 0; }).map(function (k) { return k.slice(prefix.length); }) : keys;
        list.forEach(function (k) {
          try { var v = localStorage.getItem(prefix + k); if (v != null) o[k] = JSON.parse(v); } catch (e) { /* corrupt → skip */ }
        });
        return Promise.resolve(o);
      },
      set: function (obj) {
        try { Object.keys(obj).forEach(function (k) { localStorage.setItem(prefix + k, JSON.stringify(obj[k])); }); return Promise.resolve(); }
        catch (e) { return Promise.reject(e); }
      },
      remove: function (keys) { try { keys.forEach(function (k) { localStorage.removeItem(prefix + k); }); } catch (e) { /* ignore */ } return Promise.resolve(); },
    };
  }
  function extArea(area, fallback) {
    if (!area) return fallback;
    return {
      get: function (keys) { return call(area, 'get', keys).then(function (r) { return r || {}; }); },
      set: function (obj) { return call(area, 'set', obj); },
      remove: function (keys) { return call(area, 'remove', keys); },
    };
  }
  /* Website mode: IndexedDB (large quota, survives better than localStorage) with localStorage fallback. */
  function idbArea(fallback) {
    var idb = null;
    try { idb = g.indexedDB || null; } catch (e) { idb = null; }
    if (!idb) return fallback;
    var dbp = null;
    function open() {
      if (!dbp) {
        dbp = new Promise(function (res, rej) {
          try {
            var r = idb.open('shelf', 1);
            r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
            r.onsuccess = function () { res(r.result); };
            r.onerror = function () { rej(r.error || new Error('idb')); };
            r.onblocked = function () { rej(new Error('idb blocked')); };
          } catch (e) { rej(e); }
        });
        dbp.catch(function () { dbp = null; });
      }
      return dbp;
    }
    function run(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction('kv', mode), st = t.objectStore('kv'), out = {};
          fn(st, out);
          t.oncomplete = function () { res(out); };
          t.onerror = function () { rej(t.error || new Error('idb tx')); };
          t.onabort = function () { rej(t.error || new Error('idb abort')); };
        });
      });
    }
    return {
      get: function (keys) {
        return run('readonly', function (st, out) {
          if (keys == null) {
            var c = st.openCursor();
            c.onsuccess = function () { var cur = c.result; if (cur) { out[cur.key] = cur.value; cur.continue(); } };
          } else keys.forEach(function (k) { var rq = st.get(k); rq.onsuccess = function () { if (rq.result !== undefined) out[k] = rq.result; }; });
        }).then(function (o) {
          // one-time migration from localStorage (older web/file versions)
          var missing = (keys || []).filter(function (k) { return !(k in o); });
          if (!missing.length) return o;
          return fallback.get(missing).then(function (ls) { Object.keys(ls).forEach(function (k) { o[k] = ls[k]; }); return o; });
        }, function () { return fallback.get(keys); });
      },
      set: function (obj) {
        var clean = JSON.parse(JSON.stringify(obj));
        return run('readwrite', function (st) { Object.keys(clean).forEach(function (k) { st.put(clean[k], k); }); })
          .then(function () { return undefined; }, function () { return fallback.set(obj); });
      },
      remove: function (keys) {
        return run('readwrite', function (st) { keys.forEach(function (k) { st.delete(k); }); }).then(function () { return fallback.remove(keys); }, function () { return fallback.remove(keys); });
      },
    };
  }
  var local = API && API.storage && API.storage.local ? extArea(API.storage.local, null) : idbArea(lsArea(''));
  /* Cross-tab change notifications for website mode (extension uses storage.onChanged). */
  var channel = null;
  try { if (!API && typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel('shelf'); } catch (e) { channel = null; }
  var sync = API && API.storage && API.storage.sync ? extArea(API.storage.sync, null) : null;

  /* ───────── device id ───────── */
  var devicePromise = null;
  function deviceId() {
    if (!devicePromise) {
      devicePromise = local.get([KEYS.device]).then(function (d) {
        if (typeof d[KEYS.device] === 'string') return d[KEYS.device];
        var id = Core.uid();
        return local.set((function () { var o = {}; o[KEYS.device] = id; return o; })()).then(function () { return id; }, function () { return id; });
      }, function () { return Core.uid(); });
    }
    return devicePromise;
  }

  /* ───────── sync backup (chunked) ───────── */
  function syncPayload(items, settings, device, at) {
    return JSON.stringify({ v: 2, at: at, dev: device, s: settings, i: Core.compactForSync(items) });
  }
  var lastSyncBody = null;
  function writeSync(items, settings) {
    if (!sync) return Promise.resolve({ ok: false, reason: 'unsupported' });
    return deviceId().then(function (dev) {
      var at = Date.now();
      var body = JSON.stringify({ s: settings, i: Core.compactForSync(items) });
      if (body === lastSyncBody) return { ok: true, skipped: true };
      var payload = syncPayload(items, settings, dev, at);
      if (payload.length > SYNC_MAX) return recordSync({ ok: false, reason: 'too-large', at: at });
      var obj = {}, n = 0;
      for (var i = 0; i < payload.length; i += CHUNK) obj[SYNC_PREFIX + (n++)] = payload.slice(i, i + CHUNK);
      obj[SYNC_META] = { n: n, at: at, dev: dev, h: Core.hashStr(payload), v: 2 };
      return sync.set(obj).then(function () {
        lastSyncBody = body;
        return sync.get(null).then(function (all) {
          var stale = Object.keys(all).filter(function (k) { return /^sb\.\d+$/.test(k) && Number(k.slice(3)) >= n; });
          return stale.length ? sync.remove(stale) : null;
        }).catch(function () { /* ignore */ });
      }).then(function () { setBase(at); return recordSync({ ok: true, at: at }); }, function (e) {
        var msg = String(e && e.message || e);
        return recordSync({ ok: false, reason: /quota/i.test(msg) ? 'too-large' : /MAX_WRITE|rate/i.test(msg) ? 'rate' : 'error', at: at, message: msg });
      });
    });
  }
  function setBase(at) { var o = {}; o[KEYS.syncBase] = at; return local.set(o).catch(function () {}); }
  function recordSync(r) {
    var o = {}; o[KEYS.syncState] = r;
    return local.set(o).then(function () { return r; }, function () { return r; });
  }
  function syncState() { return local.get([KEYS.syncState]).then(function (d) { return d[KEYS.syncState] || null; }, function () { return null; }); }

  function readSync() {
    if (!sync) return Promise.resolve(null);
    return sync.get(null).then(function (all) {
      var m = all[SYNC_META];
      if (!m || typeof m.n !== 'number' || m.n < 1 || m.n > 60) return null;
      var s = '';
      for (var i = 0; i < m.n; i++) {
        var c = all[SYNC_PREFIX + i];
        if (typeof c !== 'string') return null;
        s += c;
      }
      if (Core.hashStr(s) !== m.h) return null;
      var p;
      try { p = JSON.parse(s); } catch (e) { return null; }
      if (!p || !Array.isArray(p.i)) return null;
      return { compact: p.i, settings: p.s, at: p.at || m.at || 0, dev: p.dev || m.dev || '' };
    }).catch(function () { return null; });
  }

  /* ───────── reconcile local ⇄ browser account ─────────
   * remote newer + local untouched  → apply remote (fast-forward)
   * both changed (e.g. first sync on a second computer) → union, nothing is lost
   * otherwise → push local
   */
  var reconciling = null;
  function reconcile(defaults) {
    if (!sync) return Promise.resolve({ action: 'unsupported' });
    if (reconciling) return reconciling;
    reconciling = Promise.all([readSync(), local.get([KEYS.items, KEYS.settings, KEYS.meta, KEYS.syncBase]), deviceId()]).then(function (r) {
      var sb = r[0], d = r[1], dev = r[2];
      var st = Core.sanitizeSettings(d[KEYS.settings], defaults);
      if (!st.sync) return { action: 'off' };
      var items = Array.isArray(d[KEYS.items]) ? Core.sanitizeItems(d[KEYS.items]) : [];
      var base = typeof d[KEYS.syncBase] === 'number' ? d[KEYS.syncBase] : 0;
      var localAt = (d[KEYS.meta] && d[KEYS.meta].updatedAt) || 0;
      if (!sb) return items.length ? writeSync(items, st).then(function () { return { action: 'pushed' }; }) : { action: 'none' };
      if (JSON.stringify(sb.compact) === JSON.stringify(Core.compactForSync(items))) return setBase(Math.max(base, sb.at)).then(function () { return { action: 'none' }; });
      var remoteNew = sb.at > base && sb.dev !== dev;
      var localNew = localAt > base;
      if (remoteNew && (!localNew || !items.length)) {
        var next = Core.mergeSynced(sb.compact, items);
        var nst = sb.settings ? Core.sanitizeSettings(Object.assign({}, sb.settings, { sync: true, onboarded: st.onboarded || !!(sb.settings && sb.settings.onboarded) }), defaults) : st;
        return snapshot('Before sync update', items, st).then(function () {
          return writeLocal(next, nst, 'sync').then(function () { return setBase(sb.at); });
        }).then(function () { return { action: 'applied', count: Core.countApps(next) }; });
      }
      if (remoteNew && localNew) {
        var merged = Core.unionItems(Core.mergeSynced(sb.compact, items), items);
        return snapshot('Before merging devices', items, st).then(function () {
          return writeLocal(merged, st, 'sync');
        }).then(function () { return writeSync(merged, st); }).then(function () { return { action: 'merged', count: Core.countApps(merged) }; });
      }
      return writeSync(items, st).then(function () { return { action: 'pushed' }; });
    }).catch(function (e) { console.warn('[Shelf] reconcile failed', e); return { action: 'error' }; }).then(function (res) { reconciling = null; return res; }, function (e) { reconciling = null; throw e; });
    return reconciling;
  }
  function writeLocal(items, settings, origin) {
    return deviceId().then(function (dev) {
      var o = {};
      o[KEYS.items] = items; o[KEYS.settings] = settings;
      o[KEYS.meta] = { schema: 2, rev: Core.uid(), updatedAt: Date.now(), device: dev, origin: origin || 'sync' };
      chain = chain.then(function () { return local.set(o); });
      return chain;
    });
  }

  /* ───────── logo image cache (device-only, keeps logos instant & offline) ───────── */
  function getLogos() { return local.get([KEYS.logos]).then(function (d) { var m = d[KEYS.logos]; return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; }, function () { return {}; }); }
  function setLogos(map) { var o = {}; o[KEYS.logos] = map; return local.set(o).catch(function () {}); }

  /* ───────── snapshots ───────── */
  var MAX_SNAPS = 10;
  function slim(items) {
    var json = JSON.stringify(items);
    if (json.length < 1500000) return JSON.parse(json);
    return JSON.parse(json, function (k, v) {
      if (k === 'icon' && v && v.type === 'custom' && /^data:/i.test(v.src)) return { type: 'auto' };
      if (k === 'cache') return undefined;
      return v;
    });
  }
  function getSnapshots() {
    return local.get([KEYS.snaps]).then(function (d) { return Array.isArray(d[KEYS.snaps]) ? d[KEYS.snaps] : []; }, function () { return []; });
  }
  function snapshot(reason, items, settings) {
    if (!items || !Core.countApps(items) && !Core.countFolders(items)) return Promise.resolve();
    return getSnapshots().then(function (list) {
      var entry = { at: Date.now(), reason: reason || 'Automatic', apps: Core.countApps(items), folders: Core.countFolders(items), items: slim(items), settings: settings };
      var first = list[0];
      if (first && JSON.stringify(first.items) === JSON.stringify(entry.items)) return; // unchanged
      list.unshift(entry);
      var o = {}; o[KEYS.snaps] = list.slice(0, MAX_SNAPS);
      return local.set(o).catch(function () {
        o[KEYS.snaps] = list.slice(0, 3);
        return local.set(o).catch(function () { /* storage full */ });
      });
    });
  }
  function autoSnapshot(items, settings) {
    return getSnapshots().then(function (list) {
      if (!list.length || Date.now() - (list[0].at || 0) > 6 * 3600e3) return snapshot('Automatic', items, settings);
    });
  }

  /* ───────── load / save ───────── */
  function load(defaults, seed, origin) {
    return Promise.all([local.get([KEYS.items, KEYS.legacyApps, KEYS.settings, KEYS.meta]), deviceId()]).then(function (r) {
      var d = r[0], dev = r[1];
      var meta = d[KEYS.meta];
      var out = { device: dev, meta: meta || null, restored: null, migrated: false, fresh: !meta };
      out.settings = Core.sanitizeSettings(d[KEYS.settings], defaults);
      if (Array.isArray(d[KEYS.items])) out.items = Core.sanitizeItems(d[KEYS.items]);
      else if (Array.isArray(d[KEYS.legacyApps])) { out.items = Core.sanitizeItems(d[KEYS.legacyApps]); out.migrated = true; }
      else out.items = null;

      if (out.items) return out;
      // Nothing usable locally (fresh install, reinstall, or corrupted data) → try sync, then snapshots.
      return readSync().then(function (sb) {
        if (sb) {
          out.items = Core.mergeSynced(sb.compact, []);
          out.settings = Core.sanitizeSettings(sb.settings, defaults);
          out.restored = 'sync';
          return out;
        }
        return getSnapshots().then(function (snaps) {
          if (meta && snaps.length) {
            out.items = Core.sanitizeItems(snaps[0].items);
            out.restored = 'snapshot';
          } else out.items = meta ? [] : (seed ? seed() : []);
          return out;
        });
      });
    }).then(function (out) {
      if (out.migrated || out.restored || out.fresh) return save(out.items, out.settings, { origin: origin }).then(function (m) {
        out.meta = m;
        if (out.migrated) local.remove([KEYS.legacyApps]).catch(function () {});
        return out;
      });
      return out;
    });
  }

  var chain = Promise.resolve(), syncTimer = null, IS_BG = false;
  chain = Promise.resolve();
  function save(items, settings, opts) {
    opts = opts || {};
    var p = deviceId().then(function (dev) {
      var meta = { schema: 2, rev: opts.rev || Core.uid(), updatedAt: Date.now(), device: dev, origin: opts.origin || 'bg' };
      var o = {};
      o[KEYS.items] = items; o[KEYS.settings] = settings; o[KEYS.meta] = meta;
      var conflict = false;
      chain = chain.then(function () {
        if (!opts.ifRev) return local.set(o);
        // Background-style writes (logo caches) never overwrite newer changes made elsewhere.
        return local.get([KEYS.meta]).then(function (d) {
          var cur = d[KEYS.meta];
          if (cur && cur.rev && cur.rev !== opts.ifRev) { conflict = true; return; }
          return local.set(o);
        });
      });
      return chain.then(function () {
        if (conflict) return Object.assign({}, meta, { conflict: true });
        if (channel) { try { channel.postMessage({ type: 'saved', origin: meta.origin, rev: meta.rev }); } catch (e) { /* ignore */ } }
        return meta;
      });
    });
    if (settings && settings.sync && !opts.noSync && sync) {
      p.then(function (m) {
        if (m && m.conflict) return;
        if (IS_BG) { scheduleSync(opts.syncNow ? 0 : 2000); return; }
        // Pages (popup) close instantly — hand the sync write to the background worker.
        call(API.runtime, 'sendMessage', { type: 'shelf:sync' }).catch(function () { scheduleSync(opts.syncNow ? 0 : 1500); });
      });
    }
    return p;
  }
  /* Debounced: always writes the latest stored state. */
  function scheduleSync(delay) {
    if (!sync) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      reconcile().catch(function (e) { console.warn('[Shelf] sync failed', e); });
    }, delay || 0);
  }
  function flushSync(items, settings) { clearTimeout(syncTimer); return settings && settings.sync ? writeSync(items, settings) : Promise.resolve(null); }

  return {
    API: API, PROMISE: PROMISE, call: call, KEYS: KEYS, local: local, sync: sync, hasSync: !!sync, channel: channel,
    reconcile: reconcile, getLogos: getLogos, setLogos: setLogos,
    load: load, save: save, deviceId: deviceId, scheduleSync: scheduleSync, setBackground: function () { IS_BG = true; },
    readSync: readSync, writeSync: writeSync, flushSync: flushSync, syncState: syncState, isSyncKey: function (k) { return k === SYNC_META; },
    getSnapshots: getSnapshots, snapshot: snapshot, autoSnapshot: autoSnapshot,
  };
});
