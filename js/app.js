/* Shelf — UI (v2: folders, liquid glass, sync, snapshots) */
(function () {
  'use strict';

  var Core = window.ShelfCore;
  var Store = window.ShelfStore;
  var CONFIG = window.SHELF_CONFIG || {};
  var API = Store.API, call = Store.call;
  var g = globalThis;
  var doc = document, html = doc.documentElement;
  var IS_PAGE = html.classList.contains('page') || /options\.html$/i.test(location.pathname) || /[?&]page=1\b/.test(location.search);
  var IS_WEB = !API;                       // website / PWA (GitHub Pages) or opened as a plain file
  if (IS_WEB) IS_PAGE = true;
  if (IS_PAGE) html.classList.add('page');
  if (IS_WEB) html.classList.add('web');
  var IS_TOUCH = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  var IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var IS_STANDALONE = !!((window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone);
  var IS_FIREFOX = /firefox/i.test(navigator.userAgent);
  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var SYS_REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var REDUCED = SYS_REDUCED;
  var VIEW_ID = Core.uid();
  var VERSION = (function () { try { return API.runtime.getManifest().version; } catch (e) { return '2.4.0'; } })();

  /* ═════════════════════ State ═════════════════════ */

  var DEFAULTS = Core.sanitizeSettings(CONFIG.defaultSettings, Core.BASE_SETTINGS);
  var state = {
    items: [], settings: Core.sanitizeSettings(null, DEFAULTS),
    query: '', editing: false, view: 'home', currentTab: null, device: null, updatedAt: 0, ready: false,
  };
  var layers = [];
  var fv = null; // open folder view

  function isFolder(x) { return Core.isFolder(x); }
  function locate(id) {
    for (var i = 0; i < state.items.length; i++) {
      var it = state.items[i];
      if (it.id === id) return { entry: it, list: state.items, index: i, folder: null };
      if (isFolder(it)) {
        for (var j = 0; j < it.apps.length; j++) if (it.apps[j].id === id) return { entry: it.apps[j], list: it.apps, index: j, folder: it };
      }
    }
    return null;
  }
  function folders() { return state.items.filter(isFolder); }
  /* Always act on the live object: storage reloads replace objects, so never trust a captured reference. */
  function live(x) { if (!x) return null; var l = locate(x.id); return l ? l.entry : null; }
  function liveFolder(id) { var l = locate(id); return l && isFolder(l.entry) ? l.entry : null; }
  function totalApps() { return Core.countApps(state.items); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function seedItems() {
    if (!CONFIG.useDefaultApps || !Array.isArray(CONFIG.defaultApps)) return [];
    return Core.sanitizeItems(CONFIG.defaultApps);
  }

  function save(opts) {
    opts = opts || {};
    opts.origin = VIEW_ID;
    opts.rev = Core.uid();
    if (!opts.ifRev) state.rev = opts.rev;      // known synchronously → our own writes are never mistaken for foreign ones
    clearTimeout(lazySaveTimer); lazySaveTimer = 0;
    return Store.save(state.items, state.settings, opts).then(function (meta) {
      if (meta.conflict) { reloadFromStorage(); return; }
      state.updatedAt = meta.updatedAt;
      state.rev = meta.rev;
    }, function (e) {
      console.error('[Shelf] save failed', e);
      toast(/quota/i.test(String(e && e.message)) ? 'Storage is full — try smaller custom logos' : 'Couldn’t save your changes');
    });
  }
  var lazySaveTimer = 0;
  function lazySave() { clearTimeout(lazySaveTimer); lazySaveTimer = setTimeout(function () { lazySaveTimer = 0; save({ noSync: true, ifRev: state.rev }); }, 600); }
  window.addEventListener('pagehide', function () { if (lazySaveTimer) save({ noSync: true, ifRev: state.rev }); });
  function snapshot(reason) { return Store.snapshot(reason, state.items, state.settings).catch(function () {}); }

  /* ═════════════════════ DOM helpers ═════════════════════ */

  var PROPS = { value: 1, checked: 1, disabled: 1, hidden: 1, type: 1, tabIndex: 1, textContent: 1, selected: 1 };
  function h(tag, props) {
    var el = doc.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'style') { Object.keys(v).forEach(function (p) { if (p.indexOf('--') === 0) el.style.setProperty(p, v[p]); else el.style[p] = v[p]; }); }
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (PROPS[k]) el[k] = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(el, k); }); return; }
    el.appendChild(kid instanceof Node ? kid : doc.createTextNode(String(kid)));
  }

  var ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M6 12h12"/>',
    chevL: '<path d="m15 18-6-6 6-6"/>',
    chevR: '<path d="m9 18 6-6-6-6"/>',
    chevUD: '<path d="m8 9 4-4 4 4M8 15l4 4 4-4"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M17 7 7 17M7 7l10 10"/>',
    more: '<circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.9 1.4-1.9-.3-1 .3-2.1 1.4-2.1H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="7.5" r="1.2" fill="currentColor" stroke="none"/>',
    drop: '<path d="M12 3.5s6 6.3 6 10.8a6 6 0 0 1-12 0c0-4.5 6-10.8 6-10.8z"/>',
    glass: '<rect x="4" y="4" width="16" height="16" rx="5"/><path d="M8 9.5c.8-1.6 2-2.4 3.5-2.5" />',
    photo: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="8.5" r="1.5"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
    arrows: '<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/>',
    cols: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M9.2 5v14M14.8 5v14"/>',
    rows: '<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M3.5 9.4h17M3.5 14.6h17"/>',
    list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.8" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.8" cy="17.5" r="1.3" fill="currentColor" stroke="none"/>',
    arrowsV: '<path d="M12 3.5v17M8 7.5l4-4 4 4M8 16.5l4 4 4-4"/>',
    arrowsH: '<path d="M3.5 12h17M7.5 8l-4 4 4 4M16.5 8l4 4-4 4"/>',
    checklist: '<path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="m3.5 6.5 1.4 1.4L7.6 5.2M3.5 12l1.4 1.4 2.7-2.7"/><circle cx="5.3" cy="17.5" r="1.4"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
    bellBadge: '<path d="M6 16.5V11a6 6 0 0 1 8.5-5.4M18 11v5.5l1.5 1.5h-15"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/><circle cx="18" cy="6" r="2.6" fill="currentColor" stroke="none"/>',
    repeat: '<path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19M16 3l3 3-3 3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5M8 21l-3-3 3-3"/>',
    note: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12h6M9 15.5h6"/>',
    flag: '<path d="M5.5 21V4M5.5 4.5h11l-2.2 4 2.2 4h-11"/>',
    zz: '<path d="M4 6h6l-6 7h6M13 12h7l-7 8h7"/>',
    sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    dots3: '<circle cx="5.5" cy="12" r="2.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="2.2"/><circle cx="18.5" cy="12" r="2.2" fill="currentColor" stroke="none"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5z"/>',
    resize: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M14 8.5h1.5v1.5M10 15.5H8.5V14M15.5 8.5l-7 7"/>',
    size: '<path d="M14 4h6v6M10 20H4v-6M20 4l-6 6M4 20l6-6"/>',
    shape: '<rect x="3.5" y="3.5" width="10" height="10" rx="3"/><circle cx="15.5" cy="15.5" r="5"/>',
    sort: '<path d="M4 7h11M4 12h7M4 17h4M17 5v14M14 16l3 3 3-3"/>',
    text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
    cursor: '<path d="M9 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H9M15 4h-2a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h2"/>',
    tab: '<rect x="3" y="5" width="18" height="15" rx="2.5"/><path d="M3 10h18M9 5v5"/>',
    pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
    upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    grip: '<path d="M5 8h14M5 12h14M5 16h14"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    window: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M6.5 6.5h.01M9 6.5h.01"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8h.01"/>',
    chat: '<path d="M5 18.5 4 21l4-1.4A8.5 8.5 0 1 0 5 18.5z"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    folderPlus: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 10.5v5M9.5 13h5"/>',
    out: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9"/>',
    cloud: '<path d="M7 18h10.5a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18z"/>',
    history: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5M12 8v4l3 2"/>',
    bookmark: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3z"/><path d="m9 12 2 2 4-4"/>',
    blank: '',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
    haptic: '<rect x="8" y="3" width="8" height="18" rx="2.5"/><path d="M4 8v8M20 8v8M1.5 10v4M22.5 10v4"/>',
    motion: '<path d="M4 12h3l2-6 4 12 2-6h5"/>',
    share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>',
    addSquare: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/>',
    menuDots: '<circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none"/>',
    hamburger: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    dock: '<rect x="3" y="4" width="18" height="13" rx="2.5"/><path d="M7 20h10"/>',
    gear: '',
  };
  ICONS.gear = (function () {
    var pts = [];
    function pt(r, deg) { var a = (deg - 90) * Math.PI / 180; return (12 + r * Math.cos(a)).toFixed(2) + ' ' + (12 + r * Math.sin(a)).toFixed(2); }
    for (var k = 0; k < 8; k++) { var b = k * 45; pts.push(pt(7.1, b - 14), pt(9.6, b - 8), pt(9.6, b + 8), pt(7.1, b + 14)); }
    return '<path d="M' + pts.join('L') + 'Z"/><circle cx="12" cy="12" r="3"/>';
  })();
  /* Icons are parsed once from the built-in SVG table (no innerHTML), then cloned. */
  var iconCache = {}, svgParser = new DOMParser();
  function icon(name, cls) {
    var tpl = iconCache[name];
    if (!tpl) {
      var parsed = svgParser.parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' + (ICONS[name] || '') + '</svg>', 'image/svg+xml').documentElement;
      tpl = iconCache[name] = parsed && parsed.nodeName === 'svg' ? doc.importNode(parsed, true) : doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      tpl.setAttribute('viewBox', '0 0 24 24');
      tpl.setAttribute('aria-hidden', 'true');
    }
    var s = tpl.cloneNode(true);
    s.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
    return s;
  }

  var $ = function (sel) { return doc.querySelector(sel); };
  var rootEl = $('#root'), homeEl = $('#home'), appsEl = $('#apps'), emptyEl = $('#empty'), noResEl = $('#no-results');
  var dotsEl = $('#dots'), settingsEl = $('#settings'), topbar = $('#topbar'), searchInput = $('#search');
  var searchClear = $('#search-clear'), btnAdd = $('#btn-add'), btnSettings = $('#btn-settings'), btnDone = $('#btn-done');
  var editTitle = $('#edit-title'), toastEl = $('#toast');
  btnSettings.appendChild(icon('gear'));
  function scroller() { return IS_PAGE ? homeEl : (doc.scrollingElement || doc.documentElement); }

  /* ═════════════════════ Theme ═════════════════════ */

  var mql = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : { matches: false };
  function isDark() { var t = state.settings.theme; return t === 'dark' || (t === 'system' && !!mql.matches); }
  function applyTheme() {
    var s = state.settings, dark = isDark();
    var vars = Core.computeTheme(s, dark), layout = Core.computeLayout(s).vars;
    Object.keys(vars).forEach(function (k) { html.style.setProperty(k, vars[k]); });
    Object.keys(layout).forEach(function (k) { html.style.setProperty(k, layout[k]); });
    html.setAttribute('data-scheme', dark ? 'dark' : 'light');
    if (s.glass) html.setAttribute('data-glass', ''); else html.removeAttribute('data-glass');
    html.setAttribute('data-glass-style', s.glassStyle || 'frosted');
    html.classList.toggle('wall-photo', !!(s.glass && s.wallpaper === 'photo' && wallPhoto));
    if (s.glass && s.wallpaper === 'photo' && wallPhoto) {
      html.style.setProperty('--wallpaper', (dark ? 'linear-gradient(rgba(0,0,0,.30),rgba(0,0,0,.30)),' : 'linear-gradient(rgba(255,255,255,.10),rgba(255,255,255,.10)),') + 'url("' + wallPhoto + '") center / cover no-repeat, ' + vars['--bg']);
    }
    REDUCED = SYS_REDUCED || s.motion === 'reduced';
    html.classList.toggle('reduce-motion', REDUCED);
    pageLayout();
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', vars['--bg']);
    try {
      localStorage.setItem('shelf.boot', JSON.stringify({ theme: s.theme, glass: s.glass, splash: s.splash, reduced: s.motion === 'reduced', photo: !!(s.glass && s.wallpaper === 'photo' && wallPhoto), light: Core.computeTheme(s, false), dark: Core.computeTheme(s, true), layout: layout }));
      if (s.glass && s.wallpaper === 'photo' && wallPhoto) { if (localStorage.getItem('shelf.bootPhoto') !== wallPhoto) localStorage.setItem('shelf.bootPhoto', wallPhoto); }
      else localStorage.removeItem('shelf.bootPhoto');
    } catch (e) { /* storage blocked */ }
  }
  /* Full-page / website: fit as many icons as the screen allows (phone → tablet → desktop → foldable). */
  var PAGE = { cols: 4, list: 1, icon: 56, w: 0 };
  function pageLayout() {
    if (!IS_PAGE) { html.style.setProperty('--hcols', '4'); html.style.setProperty('--hn', '1'); return false; }
    var s = state.settings;
    var vw = window.innerWidth || 1024;
    var w = homeEl.clientWidth || vw;
    var base = { small: 46, medium: 56, large: 66 }[s.iconSize] || 56;
    var scale = vw >= 1024 ? 1.2 : vw >= 600 ? 1.12 : 1;
    var ic = Math.round(base * scale);
    var cell = ic + (s.showNames ? (vw >= 600 ? 42 : 24) : 18);
    // Same side margin for the search bar, the grid, lists and horizontal pages → everything lines up.
    var px = w < 360 ? 12 : w < 600 ? 16 : Math.max(32, Math.round((w - 1040) / 2));
    var inner = Math.max(200, w - 2 * px);
    var cols = Core.clamp(Math.floor((inner + 4) / cell), 3, 12);
    var lc = s.listColumns === 1 ? Core.clamp(Math.floor(inner / 360), 1, 3) : Core.clamp(Math.min(s.listColumns, Math.floor(inner / 260)), 1, 3);
    var changed = cols !== PAGE.cols || lc !== PAGE.list || ic !== PAGE.icon || px !== PAGE.px;
    PAGE = { cols: cols, list: lc, icon: ic, w: w, px: px };
    html.style.setProperty('--px', px + 'px');
    html.style.setProperty('--hn', String(lc));
    html.style.setProperty('--icon', ic + 'px');
    html.style.setProperty('--row-icon', Math.round(({ small: 28, medium: 32, large: 38 }[s.iconSize] || 32) * (scale > 1 ? 1.12 : 1)) + 'px');
    html.style.setProperty('--cols', String(s.view === 'list' ? lc : cols));
    html.style.setProperty('--hcols', String(cols));
    html.classList.toggle('phone', vw < 600);
    html.classList.toggle('tablet', vw >= 600 && vw < 1024);
    html.classList.toggle('desktop', vw >= 1024);
    return changed;
  }
  function effCols() { return IS_PAGE ? PAGE.cols : state.settings.columns; }
  function effListCols() { return IS_PAGE ? PAGE.list : state.settings.listColumns; }
  function visCols() { return IS_PAGE ? PAGE.cols : 4; }
  function onSchemeChange() { if (state.settings.theme === 'system') { applyTheme(); updateSettings(); } }
  if (mql.addEventListener) mql.addEventListener('change', onSchemeChange);
  else if (mql.addListener) mql.addListener(onSchemeChange);

  /* ═════════════════════ Logos ═════════════════════ */

  var iconMem = new Map();
  var ICON_TTL = 14 * 864e5, FAIL_TTL = 864e5;
  var active = 0, queue = [];
  function limit(fn) {
    return new Promise(function (res, rej) {
      function run() { active++; fn().then(res, rej).then(function () { active--; if (queue.length) queue.shift()(); }); }
      if (active < 10) run(); else queue.push(run);
    });
  }
  /* Measures a logo (needs CORS): are the corners opaque (full-bleed art) and how much of the square is used? */
  function measure(img) {
    try {
      var S = 40, c = doc.createElement('canvas');
      c.width = S; c.height = S;
      var x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0, S, S);
      var d = x.getImageData(0, 0, S, S).data;
      var A = function (px, py) { return d[(py * S + px) * 4 + 3]; };
      var opaque = [A(1, 1), A(S - 2, 1), A(1, S - 2), A(S - 2, S - 2)].every(function (v) { return v > 235; });
      var minX = S, minY = S, maxX = -1, maxY = -1;
      for (var py = 0; py < S; py++) for (var px = 0; px < S; px++) {
        if (A(px, py) > 28) { if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py; }
      }
      var used = maxX < 0 ? 0 : Math.max(maxX - minX + 1, maxY - minY + 1) / S;
      // Keep a small copy of the logo on this device → instant, offline logos next time.
      var data = null;
      try {
        var T = 96, c2 = doc.createElement('canvas');
        c2.width = T; c2.height = T;
        var k = Math.min(T / (img.naturalWidth || T), T / (img.naturalHeight || T));
        var w2 = (img.naturalWidth || T) * k, h2 = (img.naturalHeight || T) * k;
        var x2 = c2.getContext('2d');
        x2.imageSmoothingQuality = 'high';
        x2.drawImage(img, (T - w2) / 2, (T - h2) / 2, w2, h2);
        data = c2.toDataURL('image/webp', 0.92);
        if (!/^data:image\/webp/.test(data)) data = c2.toDataURL('image/png');
        if (data.length > 60000) data = null;
      } catch (e2) { data = null; }
      return { opaque: opaque, used: used, data: data };
    } catch (e) { return null; }
  }
  function probe(src, ms, cors) {
    return new Promise(function (resolve) {
      var img = new Image(), done = false;
      var t = setTimeout(function () { fin(null); }, ms || 3000);
      function fin(v) { if (done) return; done = true; clearTimeout(t); img.onload = img.onerror = null; resolve(v); }
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      if (cors) img.crossOrigin = 'anonymous';
      img.onload = function () {
        var info = img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : { w: 128, h: 128 };
        if (cors) info.shape = measure(img);
        fin(info);
      };
      img.onerror = function () { fin(null); };
      img.src = src;
    });
  }
  var ICON_V = 3;
  function cacheFresh(c, url) { return !!c && c.url === url && c.v === ICON_V && (Date.now() - c.at) < (c.src ? ICON_TTL : FAIL_TTL); }
  function toResult(c, r) {
    var square = Math.abs(r.w - r.h) <= 2;
    var res = { src: c.src, bleed: !!c.bleed && square, tiny: false, fit: null, data: r.shape && r.shape.data || null };
    if (r.shape) {
      if (r.shape.opaque && square) res.bleed = true;              // app-icon style artwork → edge to edge
      else if (r.shape.used > 0.15) res.fit = Core.clamp(0.64 / r.shape.used, 0.46, 1); // optically even logo size
    }
    if (!res.bleed && !res.fit && r.w < 48) res.tiny = true;
    return res;
  }
  /* All sources are requested in parallel; the best-ranked one that works wins, without waiting on slow hosts. */
  function pickBest(cands) {
    return new Promise(function (resolve) {
      var results = new Array(cands.length), pending = cands.length, settled = false, grace = 0;
      function decide(final) {
        if (settled) return;
        for (var i = 0; i < cands.length; i++) {
          var r = results[i];
          if (r === undefined) { if (final) continue; return; }
          if (r) { settled = true; clearTimeout(grace); resolve(r); return; }
        }
        if (final) { settled = true; resolve(null); }
      }
      if (!cands.length) { resolve(null); return; }
      cands.forEach(function (c, i) {
        var attempt = probe(c.src, 3000, !!c.cors).then(function (r) { return r || (c.cors ? probe(c.src, 2500, false) : null); });
        attempt.then(function (r) {
          results[i] = r && r.w >= c.min ? toResult(c, r) : null;
          pending--;
          if (results[i] && !grace) grace = setTimeout(function () { decide(true); }, 650);
          decide(pending === 0);
        });
      });
    });
  }
  function resolveAuto(app) {
    if (cacheFresh(app.cache, app.url)) return Promise.resolve(app.cache);
    var key = app.url + '|' + (app.hint || '');
    if (iconMem.has(key)) return iconMem.get(key);
    var p = limit(function () { return pickBest(Core.iconCandidates(app.url, app.hint)); }).then(function (best) {
      var res = { url: app.url, src: best ? best.src : null, bleed: !!(best && best.bleed), tiny: !!(best && best.tiny), at: Date.now(), v: ICON_V };
      if (best && best.fit) res.fit = best.fit;
      if (best && best.data) rememberLogo(app.url, best.data);
      if (!best && navigator.onLine === false) { iconMem.delete(key); return res; }
      var touched = false;
      Core.flatten(state.items).forEach(function (e) { if (e.app.url === app.url && e.app.icon.type === 'auto') { e.app.cache = res; touched = true; } });
      if (touched) lazySave();
      return res;
    });
    iconMem.set(key, p);
    return p;
  }
  /* Device-only logo image cache (Store key shelf.logos): url → small data URL */
  var logoData = {}, logoTimer = 0;
  function rememberLogo(url, data) {
    if (!url || !data || logoData[url] === data) return;
    logoData[url] = data;
    clearTimeout(logoTimer);
    logoTimer = setTimeout(saveLogos, 900);
  }
  function saveLogos() {
    var keep = {}, n = 0;
    Core.flatten(state.items).forEach(function (e) { if (logoData[e.app.url] && n < 600) { keep[e.app.url] = logoData[e.app.url]; n++; } });
    logoData = keep;
    Store.setLogos(keep);
  }
  function buildIcon(app) {
    var tile = h('span', { class: 'icon', 'aria-hidden': 'true' });
    function mono() {
      var gr = Core.gradientOf(app.name || app.url);
      tile.className = 'icon mono';
      tile.style.setProperty('--g1', gr[0]); tile.style.setProperty('--g2', gr[1]);
      tile.textContent = Core.monogram(app.name || Core.deriveName(app.url));
    }
    function show(src, opt, instant) {
      opt = opt || {};
      var img = new Image();
      img.alt = ''; img.decoding = 'async'; img.draggable = false; img.referrerPolicy = 'no-referrer';
      try { img.fetchPriority = 'high'; } catch (e) { /* older browsers */ }
      img.onload = function () { img.classList.add('on'); };
      img.onerror = function () {
        if (app.icon.type === 'auto' && app.cache && navigator.onLine !== false) { app.cache = null; iconMem.clear(); }
        mono();
      };
      tile.className = 'icon' + (opt.bleed ? ' bleed' : '') + (opt.tiny ? ' tiny' : '') + (opt.fit ? ' fitted' : '');
      if (opt.fit) tile.style.setProperty('--fit', (opt.fit * 100).toFixed(1) + '%'); else tile.style.removeProperty('--fit');
      tile.textContent = '';
      tile.appendChild(img);
      if (instant) { tile.classList.add('instant'); img.classList.add('on'); }
      img.src = src;
      if (img.complete && img.naturalWidth) { img.classList.add('on'); tile.classList.add('instant'); }
    }
    var type = (app.icon && app.icon.type) || 'auto';
    if (type === 'letter') mono();
    else if (type === 'custom') show(app.icon.src, { bleed: true });
    else {
      var c = app.cache;
      var local = logoData[app.url];
      if (local) {
        show(local, c && c.url === app.url ? c : {}, true);
        if (!cacheFresh(c, app.url)) resolveAuto(app);          // refresh quietly in the background
      }
      else if (c && c.url === app.url && c.src) show(c.src, c);
      else if (cacheFresh(c, app.url)) mono();
      else {
        tile.classList.add('pending');
        resolveAuto(app).then(function (r) { if (r && r.src) show(r.src, r); else mono(); }, mono);
      }
    }
    return tile;
  }
  var iconNodes = new Map();
  function iconFor(app) {
    var sig = app.url + '|' + JSON.stringify(app.icon) + '|' + app.name + '|' + (app.cache ? app.cache.src : '');
    var hit = iconNodes.get(app.id);
    if (hit && hit.sig === sig && !hit.el.isConnected) return hit.el;
    var el = buildIcon(app);
    iconNodes.set(app.id, { sig: sig, el: el });
    return el;
  }
  function folderTile(folder) {
    var grid = h('span', { class: 'mini-grid' });
    folder.apps.slice(0, 9).forEach(function (a) { grid.appendChild(buildIcon(a)); });
    return h('span', { class: 'icon folder-icon', 'aria-hidden': 'true' }, folder.apps.length ? grid : icon('folder'));
  }

  /* ═════════════════════ Rendering ═════════════════════ */

  function homeDisplay() {
    return state.query.trim() ? Core.searchItems(state.items, state.query) : Core.sortList(state.items, state.settings.sort);
  }
  function folderCols() { return state.settings.view === 'list' ? 1 : Core.clamp(effCols(), 3, 4); }
  function containerClass(orientation, editing, inFolder) {
    var s = state.settings, cls = ['apps', s.view, orientation];
    if (s.view === 'list' && orientation === 'vertical' && (inFolder || effListCols() === 1)) cls.push('single');
    if (editing) cls.push('editing');
    if (inFolder) cls.push('in-folder');
    return cls.join(' ');
  }
  function hListCols() { return IS_PAGE ? PAGE.list : 1; }
  /* Horizontal pages fill row by row, page by page — like the iPhone Home Screen. */
  function placeItems(container, horizontal) {
    var kids = container.children, i;
    if (!horizontal) {
      if (container.dataset.placed) { for (i = 0; i < kids.length; i++) { kids[i].style.gridRow = ''; kids[i].style.gridColumn = ''; kids[i].classList.remove('snap'); } delete container.dataset.placed; }
      return;
    }
    var s = state.settings, cols = s.view === 'grid' ? visCols() : hListCols(), perPage = s.rows * cols;
    for (i = 0; i < kids.length; i++) {
      var k = i % perPage, page = (i - k) / perPage;
      kids[i].style.gridRow = String(Math.floor(k / cols) + 1);
      kids[i].style.gridColumn = String(page * cols + (k % cols) + 1);
      kids[i].classList.toggle('snap', k === 0);
    }
    container.dataset.placed = '1';
  }
  function fill(container, list, horizontal) {
    var s = state.settings, pageCols = s.view === 'grid' ? visCols() : hListCols(), perPage = s.rows * pageCols;
    var searching = !!state.query.trim() && container === appsEl;
    container.textContent = '';          // detach old nodes first so logo nodes can be reused (no flicker)
    var frag = doc.createDocumentFragment();
    list.forEach(function (x) {
      frag.appendChild(isFolder(x) ? buildFolderItem(x) : buildAppItem(x, searching));
    });
    container.appendChild(frag);
    placeItems(container, horizontal);
    // Horizontal pages: pad the last page so it snaps flush like every other page.
    var n = list.length, rem = n % perPage;
    if (horizontal && n > perPage && rem && rem < pageCols) {
      container.style.setProperty('--hend', String(Math.ceil(n / perPage) * pageCols));
      container.classList.add('hpad');
    } else { container.style.removeProperty('--hend'); container.classList.remove('hpad'); }
  }

  /* ───── Dock: favorites pinned at the bottom (they stay in the grid too) ─────
   * Unlimited — it scrolls sideways when full. Press and hold (or Edit) to rearrange or remove, like iOS. */
  var dockEl = h('nav', { class: 'dock', 'aria-label': 'Dock', hidden: true });
  homeEl.appendChild(dockEl);
  var dockShelf = h('div', { class: 'dock-shelf', role: 'list' });
  dockEl.appendChild(dockShelf);
  var dockTip = h('div', { class: 'dock-tip', 'aria-hidden': 'true' });
  doc.body.appendChild(dockTip);
  var DOCK_MAX = 200;
  function dockApps() {
    return Core.flatten(state.items).map(function (e, i) { return { a: e.app, i: i }; }).filter(function (x) { return x.a.dock; })
      .sort(function (x, y) {
        var p = typeof x.a.dock === 'number' ? x.a.dock : 1e7 + x.i, q = typeof y.a.dock === 'number' ? y.a.dock : 1e7 + y.i;
        return p - q;
      }).map(function (x) { return x.a; });
  }
  function renumberDock(list) { list.forEach(function (a, i) { var l = live(a); if (l) l.dock = i + 1; }); }
  function setDock(app, on) {
    var a = live(app);
    if (!a) return;
    var list = dockApps();
    if (on && list.length >= DOCK_MAX) { toast('The Dock is full'); return; }
    if (on) { list.push(a); renumberDock(list); }
    else { delete a.dock; renumberDock(list.filter(function (x) { return x.id !== a.id; })); }
    haptic();
    save(); renderHome();
    if (on) { var el = dockShelf.querySelector('[data-id="' + a.id + '"]'); if (el) { el.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' }); if (el.animate && !REDUCED) el.animate([{ transform: 'scale(.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.34,1.45,.64,1)' }); } }
    toast(on ? a.name + ' added to the Dock' : a.name + ' removed from the Dock', on ? null : { action: 'Undo', onAction: function () { setDock(a, true); } });
  }
  function renderDock() {
    var list = dockApps();
    var show = state.settings.showDock && list.length > 0 && !state.query.trim();
    dockEl.hidden = !show;
    homeEl.classList.toggle('with-dock', show);
    dockEl.classList.toggle('editing', !!state.editing);
    if (!show) { dockShelf.textContent = ''; dockShelf.dataset.sig = ''; return; }
    var sig = list.map(function (a) { return a.id + a.name + a.url + (a.icon && a.icon.type) + (a.icon && a.icon.src || '').length; }).join('|') + state.settings.iconShape;
    if (dockShelf.dataset.sig !== sig) {
      dockShelf.dataset.sig = sig;
      dockShelf.textContent = '';
      list.forEach(function (a) {
        dockShelf.appendChild(h('a', { class: 'dock-app', href: a.url, draggable: 'false', role: 'listitem', 'data-id': a.id, 'aria-label': a.name, style: { '--jd': jiggleDelay() } },
          buildIcon(a), h('span', { class: 'del', role: 'button', 'aria-label': 'Remove ' + a.name + ' from the Dock' }, icon('minus'))));
      });
    }
    requestAnimationFrame(dockFade);
  }
  function dockFade() {
    var max = dockShelf.scrollWidth - dockShelf.clientWidth;
    dockEl.classList.toggle('scroll-l', dockShelf.scrollLeft > 2);
    dockEl.classList.toggle('scroll-r', max > 2 && dockShelf.scrollLeft < max - 2);
  }
  dockShelf.addEventListener('scroll', function () { hideDockTip(); dockFade(); }, { passive: true });
  dockShelf.addEventListener('wheel', function (e) {
    if (dockShelf.scrollWidth <= dockShelf.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    dockShelf.scrollLeft += e.deltaY; e.preventDefault();
  }, { passive: false });
  function showDockTip(it) {
    if (state.editing || dockDrag) return;
    var a = live({ id: it.dataset.id });
    if (!a) return;
    dockTip.textContent = a.name;
    var r = it.getBoundingClientRect();
    dockTip.style.left = (r.left + r.width / 2) + 'px';
    dockTip.style.top = (r.top - 12) + 'px';
    dockTip.classList.add('show');
  }
  function hideDockTip() { dockTip.classList.remove('show'); }
  dockShelf.addEventListener('pointerover', function (e) { var it = e.target.closest('.dock-app'); if (it && e.pointerType === 'mouse') showDockTip(it); });
  dockShelf.addEventListener('pointerout', function (e) { if (!e.relatedTarget || !dockShelf.contains(e.relatedTarget)) hideDockTip(); });
  var dockSuppress = false;
  dockShelf.addEventListener('click', function (e) {
    var it = e.target.closest('.dock-app');
    if (!it) return;
    e.preventDefault();
    e.stopPropagation();          // the Dock may re-render below; don't let the click leak out and end edit mode
    if (dockSuppress) { dockSuppress = false; return; }
    var a = live({ id: it.dataset.id });
    if (!a) return;
    if (e.target.closest('.del')) { setDock(a, false); return; }
    if (state.editing) { openAppSheet(a); return; }
    haptic(); hideDockTip();
    openApp(a, { background: e.metaKey || e.ctrlKey || state.settings.openIn === 'background', newWindow: e.shiftKey, forceNew: e.metaKey || e.ctrlKey, fromEl: it.querySelector('.icon') });
  });
  dockShelf.addEventListener('auxclick', function (e) {
    var it = e.target.closest('.dock-app');
    if (!it || e.button !== 1) return;
    e.preventDefault();
    var a = live({ id: it.dataset.id }); if (a) openApp(a, { background: true });
  });
  dockShelf.addEventListener('contextmenu', function (e) {
    var it = e.target.closest('.dock-app');
    if (!it) return;
    e.preventDefault();
    if (dockDrag || lastPointerType === 'touch') return;
    var a = live({ id: it.dataset.id }); if (!a) return;
    hideDockTip();
    var r = it.getBoundingClientRect();
    showMenu(e.clientX || r.left, (e.clientY || r.top) - 8, [
      { label: 'Open', icon: 'open', run: function () { openApp(a); } },
      IS_WEB ? null : { label: 'Open in Background', icon: 'tab', run: function () { openApp(a, { background: true }); } },
      '-',
      { label: 'Edit…', icon: 'pencil', run: function () { openAppSheet(a); } },
      { label: 'Rearrange Dock', icon: 'grid', run: enterEdit },
      { label: 'Remove from Dock', icon: 'dock', run: function () { setDock(a, false); } },
    ]);
  });
  dockShelf.addEventListener('dragstart', function (e) { e.preventDefault(); });

  /* Press and hold → edit mode; in edit mode drag sideways to reorder. */
  var dockDrag = null;
  dockShelf.addEventListener('pointerdown', function (e) {
    var it = e.target.closest('.dock-app');
    if (!it || e.button !== 0 || e.target.closest('.del')) return;
    lastPointerType = e.pointerType || 'mouse';
    var p = { it: it, x0: e.clientX, y0: e.clientY, id: e.pointerId, started: false, timer: 0, armed: state.editing };
    if (!state.editing) {
      p.timer = setTimeout(function () {
        if (!state.items.length) return;
        haptic('heavy'); hideDockTip();
        enterEdit(); dockSuppress = true; p.armed = true;
        if (p.touch) {
          var a = live({ id: it.dataset.id });
          if (a) { var r = it.getBoundingClientRect(); p.menu = showMenu(r.left, r.top - 8, [
            { label: 'Edit…', icon: 'pencil', run: function () { openAppSheet(a); } },
            { label: 'Remove from Dock', icon: 'dock', run: function () { setDock(a, false); } }]); }
        }
      }, 480);
    } else e.preventDefault();
    p.touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    function move(ev) {
      if (ev.pointerId !== p.id) return;
      var dx = ev.clientX - p.x0, dy = ev.clientY - p.y0;
      if (!p.armed) { if (Math.hypot(dx, dy) > 8) { clearTimeout(p.timer); cleanup(); } return; }
      if (!p.started) {
        if (Math.hypot(dx, dy) < 5) return;
        if (p.menu) { p.menu(null); p.menu = null; }
        startDockDrag(p, ev);
      }
      if (p.started) { ev.preventDefault(); moveDockDrag(ev); }
    }
    function up() {
      clearTimeout(p.timer);
      cleanup();
      if (p.started) endDockDrag();
    }
    function cleanup() { doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up); doc.removeEventListener('pointercancel', up); }
    doc.addEventListener('pointermove', move, { passive: false });
    doc.addEventListener('pointerup', up); doc.addEventListener('pointercancel', up);
  });
  dockShelf.addEventListener('touchmove', function (e) { if (dockDrag) e.preventDefault(); }, { passive: false });
  function startDockDrag(p, ev) {
    p.started = true; dockSuppress = true;
    var items = Array.prototype.slice.call(dockShelf.children);
    dockDrag = { p: p, el: p.it, from: items.indexOf(p.it), to: items.indexOf(p.it), x0: ev.clientX, scroll0: dockShelf.scrollLeft, slots: items.map(function (x) { var r = x.getBoundingClientRect(); return r.left + r.width / 2 + dockShelf.scrollLeft; }), w: items.length > 1 ? (items[1].getBoundingClientRect().left - items[0].getBoundingClientRect().left) : p.it.offsetWidth };
    p.it.classList.add('lifting');
    dockEl.classList.add('dragging');
    haptic();
  }
  function moveDockDrag(ev) {
    var d = dockDrag, items = Array.prototype.slice.call(dockShelf.children);
    var sr = dockShelf.getBoundingClientRect();
    if (ev.clientX < sr.left + 36) dockShelf.scrollLeft -= 10; else if (ev.clientX > sr.right - 36) dockShelf.scrollLeft += 10;
    var dx = ev.clientX - d.x0 + (dockShelf.scrollLeft - d.scroll0);
    d.el.style.transform = 'translate(' + dx + 'px, -6px) scale(1.12)';
    var cx = d.slots[d.from] + dx, to = d.from;
    d.slots.forEach(function (c, i) { if (i < d.from && cx < c + d.w * 0.2) to = Math.min(to, i); if (i > d.from && cx > c - d.w * 0.2) to = Math.max(to, i); });
    if (to !== d.to) { d.to = to; haptic(); }
    items.forEach(function (x, i) {
      if (x === d.el) return;
      var shift = d.from < d.to && i > d.from && i <= d.to ? -d.w : d.from > d.to && i >= d.to && i < d.from ? d.w : 0;
      x.style.transform = shift ? 'translateX(' + shift + 'px)' : '';
    });
  }
  function endDockDrag() {
    var d = dockDrag;
    dockDrag = null;
    dockEl.classList.remove('dragging');
    var items = Array.prototype.slice.call(dockShelf.children);
    var ids = items.map(function (x) { return x.dataset.id; });
    if (d.to !== d.from) ids.splice(d.to, 0, ids.splice(d.from, 1)[0]);
    // settle: move the node, then animate from its dragged position
    var first = d.el.getBoundingClientRect();
    items.forEach(function (x) { x.style.transform = ''; });
    d.el.classList.remove('lifting');
    if (d.to !== d.from) {
      var ref = items.filter(function (x) { return x !== d.el; })[d.to] || null;
      dockShelf.insertBefore(d.el, ref);
    }
    var last = d.el.getBoundingClientRect();
    if (d.el.animate && !REDUCED) d.el.animate([{ transform: 'translate(' + (first.left - last.left) + 'px, -6px) scale(1.12)' }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.3,1.3,.5,1)' });
    if (d.to !== d.from) {
      renumberDock(ids.map(function (id) { return live({ id: id }); }).filter(Boolean));
      dockShelf.dataset.sig = '';
      save();
    }
    setTimeout(function () { dockSuppress = false; }, 60);
  }

  var pendingRender = false;
  function renderHome() {
    if (drag) { pendingRender = true; return; }
    var s = state.settings, list = homeDisplay(), q = state.query.trim();
    appsEl.className = containerClass(s.orientation, state.editing, false);
    fill(appsEl, list, s.orientation === 'horizontal');
    var none = state.items.length === 0;
    appsEl.hidden = list.length === 0;
    emptyEl.hidden = !none;
    noResEl.hidden = none || !q || list.length > 0;
    if (none) renderEmpty();
    if (!noResEl.hidden) renderNoResults(q);
    if (none && state.editing) exitEdit();
    renderDots();
    renderSuggest();
    renderDock();
    if (todosReady) { renderTodoDots(); updateAppBadge(); }
    if (fv) renderFolderView();
  }

  function jiggleDelay() { return (-(Math.random() * 0.26)).toFixed(2) + 's'; }
  function buildAppItem(app, searching) {
    var s = state.settings, isList = s.view === 'list';
    var shown = Core.displayUrl(app.url);
    var where = searching ? locate(app.id) : null;
    var sub = where && where.folder ? where.folder.name + ' · ' + shown : shown;
    var a = h('a', {
      class: 'app' + (isList ? ' row' : ''), href: app.url, draggable: 'false', role: 'listitem',
      'data-id': app.id, 'aria-label': app.name + ', ' + sub, title: !isList && !s.showNames ? app.name : null,
      style: { '--jd': jiggleDelay() },
    });
    var del = h('span', { class: 'del', role: 'button', 'aria-label': 'Remove ' + app.name }, icon('minus'));
    var ic = iconFor(app);
    if (isList) {
      a.append(del, ic, h('span', { class: 'meta' }, h('span', { class: 'name' }, app.name), h('span', { class: 'host' }, sub)),
        icon('chevR', 'chev'), h('span', { class: 'grip', 'aria-hidden': 'true' }, icon('grip')));
    } else {
      a.appendChild(ic);
      if (s.showNames) a.appendChild(h('span', { class: 'label' }, app.name));
      a.appendChild(del);
    }
    return a;
  }
  function buildFolderItem(folder) {
    var s = state.settings, isList = s.view === 'list', n = folder.apps.length;
    var a = h('a', {
      class: 'app folder' + (isList ? ' row' : ''), href: '#', draggable: 'false', role: 'listitem', 'data-id': folder.id, 'data-kind': 'folder',
      'aria-label': 'Folder ' + folder.name + ', ' + plural(n, 'app'), title: !isList && !s.showNames ? folder.name : null,
      style: { '--jd': jiggleDelay() },
    });
    var del = h('span', { class: 'del', role: 'button', 'aria-label': 'Delete folder ' + folder.name }, icon('minus'));
    var tile = folderTile(folder);
    if (isList) {
      a.append(del, tile, h('span', { class: 'meta' }, h('span', { class: 'name' }, folder.name), h('span', { class: 'host' }, plural(n, 'app'))),
        icon('chevR', 'chev'), h('span', { class: 'grip', 'aria-hidden': 'true' }, icon('grip')));
    } else {
      a.appendChild(tile);
      if (s.showNames) a.appendChild(h('span', { class: 'label' }, folder.name));
      a.appendChild(del);
    }
    return a;
  }

  function suggestionChips(onPick) {
    var list = Array.isArray(CONFIG.suggestions) ? Core.sanitizeApps(CONFIG.suggestions) : [];
    var all = Core.flatten(state.items);
    list = list.filter(function (sug) { return !all.some(function (e) { return Core.sameUrl(e.app.url, sug.url); }); });
    if (!list.length) return null;
    return h('div', { class: 'chips' }, list.slice(0, 8).map(function (sug) {
      return h('button', { type: 'button', class: 'chip', title: Core.displayUrl(sug.url), onclick: function () { onPick(sug); } },
        buildIcon(sug), h('span', { class: 't' }, sug.name));
    }));
  }
  function renderEmpty() {
    var chips = suggestionChips(function (sug) { addApp({ url: sug.url, name: sug.name }); });
    emptyEl.textContent = '';
    emptyEl.append(
      brandMark('big empty-mark'),
      h('h2', null, 'Your shelf is empty'),
      h('p', null, 'Add the sites you use every day. Each one opens in a new tab with a single click.'),
      h('div', { class: 'btns' },
        h('button', { type: 'button', class: 'btn primary', onclick: function () { openAppSheet(); } }, icon('plus'), 'Add App'),
        state.currentTab ? h('button', { type: 'button', class: 'btn secondary', onclick: addCurrentTab }, 'Add This Site') : null),
      API && API.permissions ? h('button', { type: 'button', class: 'link-btn', onclick: importBookmarks }, icon('bookmark'), 'Import from Bookmarks') : null,
      chips ? h('div', { class: 'popular' }, h('div', { class: 'popular-title' }, 'Popular'), chips) : null);
  }
  var ENGINES = { google: ['Google', 'https://www.google.com/search?q='], duckduckgo: ['DuckDuckGo', 'https://duckduckgo.com/?q='], bing: ['Bing', 'https://www.bing.com/search?q='], brave: ['Brave Search', 'https://search.brave.com/search?q='] };
  function webSearch(q, opts) {
    var e = ENGINES[state.settings.webSearch];
    if (!e || !q) return false;
    openApp({ id: 'web-search', name: e[0], url: e[1] + encodeURIComponent(q) }, opts || {});
    return true;
  }
  function renderNoResults(q) {
    var n = Core.normalizeUrl(q);
    var looksUrl = n.ok && /[.:]/.test(q) && !/\s/.test(q);
    var e = ENGINES[state.settings.webSearch];
    noResEl.textContent = '';
    noResEl.append(h('div', { class: 'nores-art', 'aria-hidden': 'true' }, icon('search')), h('h2', null, 'No Results'), h('p', null, 'No apps match “' + q + '”.'),
      h('div', { class: 'btns' },
        looksUrl ? h('button', { type: 'button', class: 'btn primary', onclick: function () { openAppSheet(null, { url: q }); } }, icon('plus'), 'Add ' + Core.displayUrl(n.url)) : null,
        e ? h('button', { type: 'button', class: 'btn ' + (looksUrl ? 'secondary' : 'primary'), onclick: function () { webSearch(q); } }, icon('globe'), 'Search ' + e[0]) : null),
      e ? h('p', { class: 'nores-hint' }, 'Press Enter to ' + (looksUrl ? 'add it' : 'search ' + e[0]) + '.') : null);
  }

  /* Horizontal paging */
  function snapPoints() {
    var pad = parseFloat(getComputedStyle(appsEl).paddingLeft) || 0;
    return Array.prototype.map.call(appsEl.querySelectorAll('.snap'), function (el) { return Math.max(0, el.offsetLeft - pad); });
  }
  function currentPage(points) {
    var x = appsEl.scrollLeft, best = 0;
    points.forEach(function (p, i) { if (Math.abs(p - x) < Math.abs(points[best] - x)) best = i; });
    return best;
  }
  function renderDots() {
    var horizontal = state.settings.orientation === 'horizontal';
    var points = horizontal && !appsEl.hidden ? snapPoints() : [];
    var maxScroll = appsEl.scrollWidth - appsEl.clientWidth;
    points = points.filter(function (p, i) { return i === 0 || p <= maxScroll + 8; });
    if (points.length < 2 || points.length > 14) { dotsEl.hidden = true; return; }
    dotsEl.hidden = false;
    var cur = currentPage(points);
    dotsEl.textContent = '';
    points.forEach(function (p, i) {
      dotsEl.appendChild(h('button', { type: 'button', class: 'dot' + (i === cur ? ' on' : ''), 'aria-label': 'Page ' + (i + 1),
        onclick: function () { appsEl.scrollTo({ left: p, behavior: 'smooth' }); } }));
    });
  }
  var dotRaf = 0;
  appsEl.addEventListener('scroll', function () {
    cancelAnimationFrame(dotRaf);
    dotRaf = requestAnimationFrame(function () {
      if (dotsEl.hidden) return;
      var cur = currentPage(snapPoints());
      Array.prototype.forEach.call(dotsEl.children, function (d, i) { d.classList.toggle('on', i === cur); });
    });
  }, { passive: true });
  var lastWheel = 0;
  appsEl.addEventListener('wheel', function (e) {
    if (state.settings.orientation !== 'horizontal' || e.ctrlKey) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || appsEl.scrollWidth <= appsEl.clientWidth) return;
    e.preventDefault();
    var now = Date.now();
    if (now - lastWheel < 380) return;
    lastWheel = now;
    var pts = snapPoints();
    appsEl.scrollTo({ left: pts[Core.clamp(currentPage(pts) + (e.deltaY > 0 ? 1 : -1), 0, pts.length - 1)], behavior: REDUCED ? 'auto' : 'smooth' });
  }, { passive: false });

  function flip(container, mutate, opts) {
    var before = new Map();
    Array.prototype.forEach.call(container.children, function (el) { before.set(el.dataset.id, el.getBoundingClientRect()); });
    mutate();
    if (REDUCED) return;
    Array.prototype.forEach.call(container.children, function (el) {
      if (!el.animate) return;
      var b = before.get(el.dataset.id);
      if (!b) {
        if (opts && opts.popId === el.dataset.id) el.animate([{ opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.34,1.45,.64,1)' });
        return;
      }
      var a = el.getBoundingClientRect(), dx = b.left - a.left, dy = b.top - a.top;
      if (dx || dy) el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.32,.72,0,1)' });
    });
  }

  /* ═════════════════════ Actions ═════════════════════ */

  function launchFx(id, background, fromEl) {
    if (REDUCED) return;
    var el = fromEl || doc.querySelector('.layer.folder-layer .app[data-id="' + id + '"] .icon') || appsEl.querySelector('.app[data-id="' + id + '"] .icon');
    if (!el || !el.animate) return;
    if (background) { el.animate([{ transform: 'scale(.86)' }, { transform: 'scale(1.06)' }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.3,1.25,.5,1)' }); return; }
    var r = el.getBoundingClientRect(), ghost = el.cloneNode(true);
    ghost.classList.add('launch-ghost');
    Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    doc.body.appendChild(ghost);
    var a = ghost.animate([{ transform: 'scale(1)', opacity: 1, filter: 'blur(0)' }, { transform: 'scale(2.4)', opacity: 0, filter: 'blur(6px)' }], { duration: 300, easing: 'cubic-bezier(.32,.72,0,1)' });
    a.onfinish = function () { ghost.remove(); };
    setTimeout(function () { ghost.remove(); }, 600);
  }
  function openApp(app, opts) {
    opts = opts || {};
    app = live(app) || app;
    var background = !!opts.background && !IS_WEB;
    app.opens = (app.opens || 0) + 1;
    app.last = Date.now();
    if (!opts.quiet) launchFx(app.id, background, opts.fromEl);
    var tracked = !!locate(app.id);
    var current = !opts.forceNew && !opts.background && !opts.newWindow && !opts.quiet && state.settings.openIn === 'current';
    if (!API || !API.tabs) {
      // Website mode: must open synchronously inside the tap/click or browsers block it.
      var saving = tracked ? save({ noSync: true, ifRev: state.rev }) : Promise.resolve();
      if (current) { saving.then(function () { location.href = app.url; }); return Promise.resolve(); }
      try { window.open(app.url, '_blank', 'noopener'); } catch (e) { location.href = app.url; }
      return Promise.resolve();
    }
    var p;
    if (opts.newWindow && API.windows) p = call(API.windows, 'create', { url: app.url, focused: true });
    else if (current) p = call(API.tabs, 'update', { url: app.url });
    else p = call(API.tabs, 'create', { url: app.url, active: !background });
    var saved = tracked ? save({ noSync: true, ifRev: state.rev }) : Promise.resolve();
    return p.then(function () {
      if (opts.quiet) return;
      if (background) toast('Opened ' + app.name + ' in background');
      else if (!IS_PAGE) saved.then(function () { setTimeout(function () { window.close(); }, REDUCED ? 0 : 140); });
    }, function () {
      try { window.open(app.url, '_blank', 'noopener'); } catch (e) { /* ignore */ }
      toast('Your browser blocked opening this page');
    });
  }
  function openAll(folder) {
    folder = live(folder);
    if (!folder) return;
    if (IS_WEB) { toast('Browsers allow one new tab per tap on the web'); return; }
    var apps = Core.sortList(folder.apps, state.settings.sort);
    if (!apps.length) { toast('This folder is empty'); return; }
    function go() {
      apps.reduce(function (p, a) { return p.then(function () { return openApp(a, { background: true, quiet: true }); }); }, Promise.resolve())
        .then(function () { toast('Opened ' + plural(apps.length, 'tab')); });
    }
    if (apps.length > 10) {
      dialog({ title: 'Open ' + apps.length + ' Tabs?', message: 'All apps in “' + folder.name + '” will open in background tabs.',
        buttons: [{ label: 'Cancel', value: null }, { label: 'Open All', value: true, style: 'bold' }] }).then(function (ok) { if (ok) go(); });
    } else go();
  }

  function addApp(data, opts) {
    opts = opts || {};
    var app = Core.sanitizeApp({ id: Core.uid(), url: data.url, name: data.name, icon: data.icon, hint: data.hint });
    if (!app) { toast('That address isn’t valid'); return null; }
    if (data.cache && data.cache.url === app.url && app.icon.type === 'auto') app.cache = data.cache;
    if (totalApps() >= Core.LIMITS.apps) { toast('You’ve reached the ' + Core.LIMITS.apps + ' app limit'); return null; }
    if (state.query) setQuery('', true);
    var folder = opts.folder ? liveFolder(opts.folder.id) : null;
    if (folder) {
      folder.apps.push(app);
      renderHome();
      if (!opts.silent) toast('Added ' + app.name + ' to ' + folder.name);
    } else {
      flip(appsEl, function () { state.items.push(app); renderHome(); }, { popId: app.id });
      if (!opts.silent) toast('Added ' + app.name);
      var el = appsEl.querySelector('[data-id="' + app.id + '"]');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' });
    }
    save();
    return app;
  }
  function addCurrentTab() { var t = state.currentTab; if (t) openAppSheet(null, { url: t.url, hint: t.favIconUrl }); }

  function createFolder(name, apps, index) {
    if (Core.countFolders(state.items) >= Core.LIMITS.folders) { toast('You’ve reached the folder limit'); return null; }
    var f = { id: Core.uid(), type: 'folder', name: Core.cleanText(name, Core.LIMITS.folderName) || 'Folder', apps: apps || [] };
    if (typeof index === 'number' && index >= 0) state.items.splice(index, 0, f); else state.items.push(f);
    return f;
  }
  function newFolderFlow() {
    promptDialog({ title: 'New Folder', message: 'Group apps like Work, Tools or Social.', placeholder: 'Folder name', confirm: 'Create' }).then(function (name) {
      if (name == null) return;
      if (state.view === 'settings') closeSettings();
      if (state.query) setQuery('', true);
      var f = createFolder(name || 'Folder');
      if (!f) return;
      save();
      flip(appsEl, renderHome, { popId: f.id });
      setTimeout(function () { openFolderView(f, appsEl.querySelector('[data-id="' + f.id + '"]')); }, 60);
    });
  }

  function removeApp(app, item) {
    var l = locate(app.id);
    if (!l) return;
    var folder = l.folder, idx = l.index;
    var container = item && item.parentNode ? item.parentNode : appsEl;
    function commit() {
      var cur = locate(app.id);
      if (!cur) return;
      flip(container, function () { cur.list.splice(cur.index, 1); renderHome(); });
      save();
    }
    if (item && item.isConnected && !REDUCED) { item.classList.add('removing'); setTimeout(commit, 200); } else commit();
    toast('Removed ' + app.name, {
      action: 'Undo',
      onAction: function () {
        if (locate(app.id)) return;
        var lf = folder ? liveFolder(folder.id) : null;
        var list = lf ? lf.apps : state.items;
        list.splice(Math.min(idx, list.length), 0, app);
        save(); renderHome();
      },
    });
  }

  function moveApp(appId, folder, opts) {
    if (folder) { folder = liveFolder(folder.id); if (!folder) { toast('That folder no longer exists'); return; } }
    var l = locate(appId);
    if (!l || isFolder(l.entry) || l.folder === folder) return;
    l.list.splice(l.index, 1);
    if (folder) folder.apps.push(l.entry);
    else {
      var at = l.folder ? state.items.indexOf(l.folder) + 1 : state.items.length;
      state.items.splice(at, 0, l.entry);
    }
    save();
    renderHome();
    if (!(opts && opts.silent)) toast(folder ? 'Moved to ' + folder.name : 'Moved out of ' + l.folder.name);
  }

  function deleteFolder(folderRef) {
    var fid = folderRef.id, folder = liveFolder(fid);
    if (!folder) return;
    var n = folder.apps.length;
    var buttons = n
      ? [{ label: 'Delete Folder, Keep Apps', value: 'keep', style: 'bold' }, { label: 'Delete Folder and ' + plural(n, 'App'), value: 'all', style: 'destructive' }, { label: 'Cancel', value: null }]
      : [{ label: 'Cancel', value: null }, { label: 'Delete', value: 'all', style: 'destructive' }];
    dialog({ title: 'Delete “' + folder.name + '”?', message: n ? 'This folder contains ' + plural(n, 'app') + '.' : 'This folder is empty.', buttons: buttons }).then(function (choice) {
      if (!choice) return;
      folder = liveFolder(fid);
      if (!folder) return;
      (choice === 'all' && folder.apps.length ? snapshot('Before deleting “' + folder.name + '”') : Promise.resolve()).then(function () {
        folder = liveFolder(fid);
        if (!folder) return;
        var beforeItems = state.items.slice(), beforeApps = folder.apps.slice();
        if (fv && fv.fid === fid) fv.close(null);
        var idx = state.items.indexOf(folder);
        if (choice === 'keep') state.items.splice.apply(state.items, [idx, 1].concat(folder.apps));
        else state.items.splice(idx, 1);
        save(); renderHome();
        toast(choice === 'keep' ? 'Folder deleted, apps kept' : 'Deleted ' + folder.name, {
          action: 'Undo',
          onAction: function () { folder.apps = beforeApps; state.items = beforeItems; save(); renderHome(); },
        });
      });
    });
  }
  function renameFolder(folder, name) {
    folder = live(folder);
    if (!folder) return false;
    var clean = Core.cleanText(name, Core.LIMITS.folderName);
    if (!clean || clean === folder.name) return false;
    folder.name = clean;
    save(); renderHome();
    return true;
  }

  function mergeInto(dragId, targetId) {
    var d = locate(dragId), t = locate(targetId);
    if (!d || !t || d.folder || t.folder || isFolder(d.entry) || d.entry === t.entry) return;
    d.list.splice(d.index, 1);
    if (isFolder(t.entry)) {
      t.entry.apps.push(d.entry);
      save(); renderHome();
      toast('Added ' + d.entry.name + ' to ' + t.entry.name);
      return;
    }
    var ti = state.items.indexOf(t.entry);
    state.items.splice(ti, 1);
    var f = createFolder(Core.guessFolderName([t.entry, d.entry]), [t.entry, d.entry], ti);
    if (!f) { state.items.splice(ti, 0, t.entry); state.items.push(d.entry); save(); renderHome(); return; }
    save(); renderHome();
    openFolderView(f, appsEl.querySelector('[data-id="' + f.id + '"]'), { rename: true });
  }

  function setQuery(q, silent) {
    state.query = q;
    if (searchInput.value !== q) searchInput.value = q;
    searchClear.hidden = !q;
    topbar.classList.toggle('search-off', !state.settings.showSearch && !q);
    if (!silent) renderHome();
  }
  function ensureManual() {
    if (state.settings.sort === 'manual') return false;
    state.items = Core.applySortDeep(state.items, state.settings.sort);
    state.settings = Core.sanitizeSettings(Object.assign({}, state.settings, { sort: 'manual' }), DEFAULTS);
    save(); updateSettings();
    toast('Switched to manual order');
    return true;
  }
  function enterEdit() {
    if (state.editing || !state.items.length) return;
    closeMenus();
    if (state.query) setQuery('', true);
    var changed = ensureManual();
    state.editing = true;
    if (changed) renderHome();
    appsEl.classList.add('editing');
    dockEl.classList.add('editing');
    topbar.classList.add('editing');
    editTitle.hidden = false; btnDone.hidden = false;
    haptic();
    renderSuggest();
    if (doc.activeElement === searchInput) searchInput.blur();
  }
  function exitEdit() {
    if (!state.editing) return;
    state.editing = false;
    appsEl.classList.remove('editing');
    dockEl.classList.remove('editing');
    topbar.classList.remove('editing');
    editTitle.hidden = true; btnDone.hidden = true;
    renderSuggest();
  }
  function copyText(text) {
    function fallback() {
      var ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
      ta.value = text; doc.body.appendChild(ta); ta.select();
      try { doc.execCommand('copy'); } catch (e) { /* ignore */ }
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(fallback); else fallback();
    toast('Link copied');
  }

  /* ═════════════════════ Toast ═════════════════════ */

  var toastTimer = 0;
  function toast(msg, opt) {
    opt = opt || {};
    clearTimeout(toastTimer);
    toastEl.textContent = '';
    toastEl.appendChild(h('span', { class: 'msg' }, msg));
    if (opt.action) toastEl.appendChild(h('button', { type: 'button', onclick: function () { hideToast(); if (opt.onAction) opt.onAction(); } }, opt.action));
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    toastTimer = setTimeout(hideToast, opt.action ? 5500 : 2200);
  }
  function hideToast() {
    toastEl.classList.remove('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (!toastEl.classList.contains('show')) toastEl.textContent = ''; }, 350);
  }

  /* ═════════════════════ Layers ═════════════════════ */

  function updateChrome() {
    var covered = layers.some(function (l) { return l.kind !== 'menu'; });
    rootEl.classList.toggle('tall', state.view === 'settings' || covered);
    html.classList.toggle('lock', state.view === 'settings' || covered);
    rootEl.inert = layers.length > 0;
    homeEl.inert = state.view === 'settings' || layers.length > 0;
  }
  function openLayer(content, kind, opts) {
    opts = opts || {};
    var prevFocus = doc.activeElement;
    var layer = h('div', { class: 'layer ' + kind + '-layer' });
    layer.appendChild(content);
    var closed = false;
    var entry = { kind: kind, layer: layer, close: close, onEscape: opts.onEscape };
    function close(val) {
      if (closed) return;
      closed = true;
      layer.classList.remove('open');
      layer.classList.add('closing');
      var i = layers.indexOf(entry);
      if (i >= 0) layers.splice(i, 1);
      updateChrome();
      setTimeout(function () { layer.remove(); }, kind === 'menu' ? 0 : 380);
      if (opts.onClose) opts.onClose(val);
      var top = layers[layers.length - 1];
      var target = top ? (top.layer.contains(prevFocus) ? prevFocus : null) : prevFocus;
      if (target && target.focus && doc.contains(target)) { try { target.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
    layer.addEventListener('pointerdown', function (e) {
      if (e.target !== layer) return;
      if (opts.onBackdrop) opts.onBackdrop(); else close(null);
    });
    if (kind === 'menu') layer.addEventListener('contextmenu', function (e) { e.preventDefault(); close(null); });
    if (content.classList && content.classList.contains('sheet')) {
      content.addEventListener('scroll', function () { content.classList.toggle('scrolled', content.scrollTop > 2); }, { passive: true });
    }
    layers.push(entry);
    doc.body.appendChild(layer);
    updateChrome();
    if (opts.beforeOpen) opts.beforeOpen(layer);
    void layer.offsetWidth;
    layer.classList.add('open');
    return close;
  }
  function topLayer() { return layers[layers.length - 1]; }
  function closeMenus() { layers.filter(function (l) { return l.kind === 'menu'; }).forEach(function (l) { l.close(null); }); }
  function trapFocus(e, container) {
    var f = Array.prototype.filter.call(container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (el) { return !el.disabled && el.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!container.contains(doc.activeElement)) { e.preventDefault(); first.focus(); }
  }

  function dialog(o) {
    return new Promise(function (resolve) {
      var buttons = o.buttons || [{ label: 'OK', value: true, style: 'bold' }];
      var close;
      var box = h('div', { class: 'alert', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': o.title },
        h('h3', null, o.title), o.message ? h('p', null, o.message) : null, o.body || null,
        h('div', { class: 'alert-btns' + (buttons.length > 2 ? ' vertical' : '') }, buttons.map(function (b) {
          return h('button', { type: 'button', class: b.style || '', onclick: function () { close(typeof b.value === 'function' ? b.value() : b.value); } }, b.label);
        })));
      close = openLayer(box, 'alert', { onClose: function (v) { resolve(v == null ? null : v); } });
      var def = o.focus || box.querySelector('.bold') || box.querySelector('button');
      setTimeout(function () { if (def) { def.focus(); if (def.select) def.select(); } }, 40);
    });
  }
  function promptDialog(o) {
    var input = h('input', { type: 'text', class: 'alert-input', value: o.value || '', placeholder: o.placeholder || '', maxlength: String(Core.LIMITS.folderName), autocomplete: 'off', spellcheck: 'false' });
    var p = dialog({
      title: o.title, message: o.message, body: input, focus: input,
      buttons: [{ label: 'Cancel', value: null }, { label: o.confirm || 'Save', value: function () { return { v: input.value.trim() }; }, style: 'bold' }],
    }).then(function (r) { return r && typeof r === 'object' ? r.v : null; });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); var btn = input.parentNode.querySelector('.bold'); if (btn) btn.click(); }
    });
    return p;
  }

  function showMenu(x, y, items, opts) {
    closeMenus();
    var close;
    var menu = h('div', { class: 'menu', role: 'menu' }, opts && opts.title ? h('div', { class: 'menu-title' }, opts.title) : null);
    items.forEach(function (it) {
      if (!it) return;
      if (it === '-') { if (menu.lastChild && menu.lastChild.tagName !== 'HR' && menu.lastChild.className !== 'menu-title') menu.appendChild(h('hr')); return; }
      menu.appendChild(h('button', { type: 'button', role: 'menuitem', class: (it.danger ? 'danger' : '') + (it.checked ? ' checked' : ''), disabled: !!it.disabled,
        onclick: function () { close(null); it.run(); } }, h('span', null, it.label), icon(it.checked ? 'check' : it.icon)));
    });
    while (menu.lastChild && menu.lastChild.tagName === 'HR') menu.lastChild.remove();
    function place() {
      var vw = window.innerWidth, vh = window.innerHeight, w = menu.offsetWidth, hh = Math.min(menu.scrollHeight, vh - 12);
      var left = Math.max(6, Math.min(x, vw - w - 6));
      var top = y + hh > vh - 6 ? Math.max(6, Math.min(y - hh - 12, vh - hh - 6)) : y;  // flip above when there is no room below
      if (top < 6) top = 6;
      menu.style.left = left + 'px'; menu.style.top = top + 'px';
      menu.style.setProperty('--ox', (x - left) + 'px'); menu.style.setProperty('--oy', (y - top) + 'px');
    }
    close = openLayer(menu, 'menu', { onClose: function (v) { rootEl.style.minHeight = ''; window.removeEventListener('resize', place); if (opts && opts.onClose) opts.onClose(v); } });
    // A short popup can't fit a tall menu: grow the popup window first (extension popups size to their content).
    if (!IS_PAGE && menu.scrollHeight + 16 > window.innerHeight) {
      rootEl.style.minHeight = Math.min(590, menu.scrollHeight + 24) + 'px';
      y = Math.min(y, Math.max(6, Math.min(590, menu.scrollHeight + 24) - menu.scrollHeight - 12));
    }
    place();
    window.addEventListener('resize', place);
    menu.addEventListener('keydown', function (e) {
      var btns = Array.prototype.filter.call(menu.querySelectorAll('button'), function (b) { return !b.disabled; });
      var i = btns.indexOf(doc.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
      else if (e.key === 'Tab') { e.preventDefault(); close(null); }
    });
    if (!IS_TOUCH) setTimeout(function () { var b = menu.querySelector('button:not(:disabled)'); if (b) b.focus({ preventScroll: true }); }, 20);
    window.addEventListener('blur', function onBlur() { window.removeEventListener('blur', onBlur); close(null); });
    return close;
  }
  function menuAt(el) { var r = el.getBoundingClientRect(); return { x: r.right - 214, y: r.bottom + 6 }; }

  function liftFor(item) {
    var box = item && item.parentNode;
    if (!item || !box || REDUCED) return {};
    item.classList.add('lifted'); box.classList.add('has-lift');
    return { onClose: function () { item.classList.remove('lifted'); box.classList.remove('has-lift'); } };
  }
  function itemMenu(entry, item, x, y) {
    if (isFolder(entry)) {
      return showMenu(x, y, [
        { label: 'Open Folder', icon: 'folder', run: function () { openFolderView(entry, item); } },
        entry.apps.length && !IS_WEB ? { label: 'Open All ' + plural(entry.apps.length, 'App'), icon: 'open', run: function () { openAll(entry); } } : null,
        '-',
        { label: 'Rename…', icon: 'pencil', run: function () { promptDialog({ title: 'Rename Folder', value: entry.name, confirm: 'Rename' }).then(function (v) { if (v) renameFolder(entry, v); }); } },
        { label: 'Add Apps…', icon: 'plus', run: function () { openAppPicker(entry); } },
        { label: 'Rearrange', icon: 'grid', run: enterEdit },
        '-',
        { label: 'Delete Folder…', icon: 'trash', danger: true, run: function () { deleteFolder(entry); } },
      ], liftFor(item));
    }
    var inFolder = !!(fv && fv.grid.contains(item));
    return showMenu(x, y, [
      { label: 'Open', icon: 'open', run: function () { openApp(entry); } },
      IS_WEB ? null : { label: 'Open in Background', icon: 'tab', run: function () { openApp(entry, { background: true }); } },
      IS_WEB ? null : { label: 'Open in New Window', icon: 'window', run: function () { openApp(entry, { newWindow: true }); } },
      '-',
      { label: 'Edit…', icon: 'pencil', run: function () { openAppSheet(entry); } },
      { label: 'Move to Folder…', icon: 'folder', run: function () { moveMenu(entry, x, y); } },
      { label: 'Rearrange', icon: 'grid', run: function () { if (inFolder) folderEnterEdit(); else enterEdit(); } },
      { label: 'Copy Link', icon: 'link', run: function () { copyText(entry.url); } },
      state.settings.showDock ? (entry.dock ? { label: 'Remove from Dock', icon: 'dock', run: function () { setDock(entry, false); } }
        : { label: 'Add to Dock', icon: 'dock', run: function () { setDock(entry, true); } }) : null,
      '-',
      { label: 'Remove', icon: 'trash', danger: true, run: function () { removeApp(entry, doc.querySelector('#apps .app[data-id="' + entry.id + '"], .folder-view .app[data-id="' + entry.id + '"]')); } },
    ], item && item.closest('.dock') ? {} : liftFor(item));
  }
  function moveMenu(app, x, y) {
    var l = locate(app.id);
    if (!l) return;
    var list = folders().map(function (f) {
      return { label: f.name, icon: 'folder', checked: f === l.folder, disabled: f === l.folder, run: function () { if (fv && fv.fid !== f.id) fv.close(null); moveApp(app.id, f); } };
    });
    showMenu(x, y, [
      l.folder ? { label: 'Move Out of “' + l.folder.name + '”', icon: 'out', run: function () { if (fv) fv.close(null); moveApp(app.id, null); } } : null,
      '-',
    ].concat(list, ['-', {
      label: 'New Folder…', icon: 'folderPlus', run: function () {
        promptDialog({ title: 'New Folder', placeholder: 'Folder name', value: Core.categoryOf(app.url) || '', confirm: 'Create' }).then(function (name) {
          if (name == null) return;
          var cur = locate(app.id);
          if (!cur) return;
          var at = cur.folder ? state.items.indexOf(cur.folder) + 1 : cur.index;
          var f = createFolder(name || 'Folder', [], at);
          if (f) { if (fv) fv.close(null); moveApp(app.id, f); }
        });
      },
    }]), { title: 'Move “' + app.name + '”' });
  }
  function addMenu() {
    var p = menuAt(btnAdd);
    showMenu(p.x, p.y, [
      { label: 'New App', icon: 'plus', run: function () { openAppSheet(); } },
      { label: 'New Folder', icon: 'folderPlus', run: newFolderFlow },
      state.currentTab ? { label: 'Add This Page', icon: 'bookmark', run: addCurrentTab } : null,
      '-',
      { label: 'New To-Do', icon: 'checklist', run: function () { openTodos(defaultListId() || 'new', { focusAdd: true }); } },
      { label: 'New To-Do List', icon: 'dots3', run: function () { newList(); } },
      TD.liveLists(todos).length ? { label: 'Today’s To-Dos', icon: 'calendar', run: function () { openTodos('today'); } } : null,
    ]);
  }

  /* ═════════════════════ Folder view ═════════════════════ */

  function pill(ic, label, onClick, cls) {
    return h('button', { type: 'button', class: 'glass-pill' + (cls ? ' ' + cls : ''), onclick: onClick, 'aria-label': label || null }, ic ? icon(ic) : null, label ? h('span', null, label) : null);
  }
  function openFolderView(folderRef, originEl, opts) {
    opts = opts || {};
    var fid = folderRef.id;
    var folder = liveFolder(fid);
    if (!folder) return;
    function F() { return liveFolder(fid); }
    if (fv) fv.close(null);
    exitEdit();
    closeMenus();
    var title = h('input', { class: 'folder-title', type: 'text', value: folder.name, maxlength: String(Core.LIMITS.folderName), 'aria-label': 'Folder name', spellcheck: 'false', autocomplete: 'off' });
    var grid = h('div', { class: 'apps', role: 'list', 'aria-label': 'Apps in ' + folder.name });
    var empty = h('div', { class: 'folder-empty' },
      h('div', { class: 'folder-empty-art' }, icon('folder')),
      h('p', null, 'This folder is empty.'),
      h('button', { type: 'button', class: 'btn primary small', onclick: function () { if (F()) openAppPicker(F()); } }, icon('plus'), 'Add Apps'));
    var panel = h('div', { class: 'folder-panel' }, grid, empty);
    var btnMore = pill('more', null, function () { var p = menuAt(btnMore); if (F()) folderMoreMenu(F(), p.x, p.y); }, 'icon-only');
    btnMore.setAttribute('aria-label', 'More');
    var btnAddApps = pill('plus', 'Add Apps', function () { if (F()) openAppPicker(F()); });
    var btnOpenAll = pill('open', 'Open All', function () { if (F()) openAll(F()); });
    var btnDoneF = pill(null, 'Done', function () { folderExitEdit(); }, 'strong');
    btnDoneF.hidden = true;
    var actions = h('div', { class: 'folder-actions' }, btnAddApps, btnOpenAll, btnMore, btnDoneF);
    var hint = h('div', { class: 'folder-hint' }, icon('out'), 'Release to move out of folder');
    var view = h('div', { class: 'folder-view', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Folder ' + folder.name }, title, panel, actions, hint);

    var ctx = {
      kind: 'folder', fid: fid, container: grid,
      list: function () { var f = F(); return f ? f.apps : []; },
      editing: function () { return !!(fv && fv.editing); },
      enterEdit: folderEnterEdit,
      step: function () { return { horizontal: false, cols: folderCols() }; },
      scroller: function () { return panel; },
    };
    var me = { fid: fid, view: view, title: title, grid: grid, panel: panel, empty: empty,
      btnAdd: btnAddApps, btnOpen: btnOpenAll, btnMore: btnMore, btnDone: btnDoneF, editing: false, ctx: ctx, close: null };
    Object.defineProperty(me, 'folder', { get: F });
    fv = me;
    bindGrid(grid, ctx);

    function commitTitle() {
      var f = F();
      if (!f) return;
      var v = Core.cleanText(title.value, Core.LIMITS.folderName);
      if (!v) { title.value = f.name; return; }
      renameFolder(f, v);
    }
    title.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); title.blur(); }
    });
    title.addEventListener('blur', commitTitle);

    me.close = openLayer(view, 'folder', {
      beforeOpen: function () {
        renderFolderView();
        if (originEl && originEl.isConnected && !REDUCED) {
          var r = originEl.getBoundingClientRect(), v = view.getBoundingClientRect();
          view.style.setProperty('--ox', (r.left + r.width / 2 - v.left) + 'px');
          view.style.setProperty('--oy', (r.top + r.height / 2 - v.top) + 'px');
        }
      },
      onEscape: function () {
        if (doc.activeElement === title) { title.value = (F() || folder).name; title.blur(); return; }
        if (me.editing) folderExitEdit(); else me.close(null);
      },
      onClose: function () { if (doc.activeElement === title) commitTitle(); if (fv === me) fv = null; renderHome(); },
    });
    setTimeout(function () {
      if (fv !== me) return;
      if (opts.rename) { title.focus(); title.select(); }
      else { var f = grid.querySelector('.app'); if (f) f.focus({ preventScroll: true }); else btnAddApps.focus(); }
    }, REDUCED ? 0 : 320);
  }
  function renderFolderView() {
    if (!fv) return;
    var f = fv.folder;
    if (!f) { fv.close(null); return; }
    if (doc.activeElement !== fv.title) fv.title.value = f.name;
    fv.view.setAttribute('aria-label', 'Folder ' + f.name);
    var list = Core.sortList(f.apps, state.settings.sort);
    fv.grid.className = containerClass('vertical', fv.editing, true);
    fv.grid.style.setProperty('--cols', String(folderCols()));
    fill(fv.grid, list, false);
    fv.grid.hidden = !list.length;
    fv.empty.hidden = !!list.length;
    fv.btnOpen.hidden = fv.editing || !list.length || IS_WEB;
    fv.btnAdd.hidden = fv.editing || !list.length;
    fv.btnMore.hidden = fv.editing;
    fv.btnDone.hidden = !fv.editing;
  }
  function folderEnterEdit() {
    if (!fv || fv.editing || !fv.folder || !fv.folder.apps.length) return;
    ensureManual();
    fv.editing = true;
    renderFolderView();
  }
  function folderExitEdit() { if (!fv || !fv.editing) return; fv.editing = false; renderFolderView(); }
  function folderMoreMenu(folder, x, y) {
    showMenu(x, y, [
      { label: 'Rename', icon: 'pencil', run: function () { if (fv) { fv.title.focus(); fv.title.select(); } } },
      folder.apps.length ? { label: 'Rearrange Apps', icon: 'grid', run: folderEnterEdit } : null,
      '-',
      { label: 'Delete Folder…', icon: 'trash', danger: true, run: function () { deleteFolder(folder); } },
    ]);
  }

  /* ═════════════════════ Sheets ═════════════════════ */

  function sheetShell(o) {
    var right = o.right ? h('button', { type: 'button', class: 'text-btn strong', disabled: !!o.right.disabled }, o.right.label) : h('span');
    var left = h('button', { type: 'button', class: 'text-btn' }, o.left || 'Cancel');
    var body = h('div', { class: 'sheet-body' });
    append(body, o.body);
    var sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title },
      h('div', { class: 'grabber', 'aria-hidden': 'true' }),
      h('div', { class: 'sheet-nav' }, h('div', { class: 'l' }, left), h('h3', null, o.title), h('div', { class: 'r' }, right)),
      body);
    var close = openLayer(sheet, 'sheet', { onBackdrop: o.onBackdrop, onClose: o.onClose });
    left.addEventListener('click', function () { close(null); });
    if (o.right) right.addEventListener('click', function () { o.right.onClick(close); });
    return { close: close, sheet: sheet, body: body, right: right };
  }

  var MAX_UPLOAD = 8 * 1024 * 1024;
  function processImageFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || '')) { reject(new Error('Choose an image file (PNG, JPG, SVG, WebP…)')); return; }
      if (file.size > MAX_UPLOAD) { reject(new Error('That image is too large (max 8 MB)')); return; }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Couldn’t read that file')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('That image couldn’t be opened')); };
        img.onload = function () {
          try {
            var S = 160, c = doc.createElement('canvas');
            c.width = S; c.height = S;
            var ctx = c.getContext('2d');
            var w = img.naturalWidth || S, hh = img.naturalHeight || S, scale = Math.min(S / w, S / hh);
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, (S - w * scale) / 2, (S - hh * scale) / 2, w * scale, hh * scale);
            var out = c.toDataURL('image/png');
            if (out.length > 220000) { var webp = c.toDataURL('image/webp', 0.9); if (/^data:image\/webp/.test(webp) && webp.length < out.length) out = webp; }
            resolve(out);
          } catch (e) { reject(new Error('That image couldn’t be processed')); }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function field(label, input, extra) { return h('div', { class: 'field' }, h('label', { for: input.id }, label), input, extra || null); }

  function openAppSheet(existing, prefill) {
    closeMenus();
    prefill = prefill || {};
    var isEdit = !!existing;
    var eid = isEdit ? existing.id : null;
    var where = isEdit ? locate(eid) : null;
    if (isEdit && where) existing = where.entry;
    var initialUrl = existing ? existing.url : (prefill.url || '');
    var draft = {
      icon: existing ? JSON.parse(JSON.stringify(existing.icon)) : { type: 'auto' },
      hint: existing ? existing.hint || null : prefill.hint || null,
      nameTouched: isEdit || !!prefill.name, dirty: false, newFolderName: null,
    };
    var uidp = 'f' + Core.uid().slice(0, 6);
    var urlInput = h('input', { id: uidp + 'u', class: 'in-url', type: 'text', inputmode: 'url', placeholder: 'example.com', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: initialUrl || '' });
    var nameInput = h('input', { id: uidp + 'n', class: 'in-name', type: 'text', placeholder: 'Name', autocomplete: 'off', maxlength: String(Core.LIMITS.name), value: existing ? existing.name : (prefill.name || '') });
    var urlMsg = h('div', { class: 'field-msg', role: 'alert' });
    var iconMsg = h('div', { class: 'field-msg', role: 'alert' });
    var previewIconWrap = h('span');
    var previewLabel = h('span', { class: 'label' });
    var saveBtn = h('button', { type: 'button', class: 'text-btn strong' }, isEdit ? 'Save' : 'Add');
    var cancelBtn = h('button', { type: 'button', class: 'text-btn' }, 'Cancel');
    var fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
    var logoUrlInput = h('input', { id: uidp + 'l', type: 'text', inputmode: 'url', placeholder: 'https://…/logo.png', autocomplete: 'off', spellcheck: 'false',
      value: draft.icon.type === 'custom' && !/^data:/.test(draft.icon.src) ? draft.icon.src : '' });

    var folderVal = where && where.folder ? where.folder.id : (prefill.folderId && liveFolder(prefill.folderId) ? prefill.folderId : (fv && !isEdit && fv.folder ? fv.fid : ''));
    var folderBtn = h('button', { type: 'button', id: uidp + 'f', class: 'sel-btn', 'aria-haspopup': 'menu' }, h('span', { class: 'sel-val' }), icon('chevUD'));
    function folderLabel() {
      if (folderVal === '__pending') return draft.newFolderName + ' (new)';
      var f = folderVal ? liveFolder(folderVal) : null;
      if (!f) { folderVal = ''; return 'None'; }
      return f.name;
    }
    function syncFolderBtn() { folderBtn.firstChild.textContent = folderLabel(); folderBtn.classList.toggle('is-none', !folderVal); }
    function setFolderVal(v) { folderVal = v; draft.dirty = true; syncFolderBtn(); }
    folderBtn.addEventListener('click', function () {
      var r = folderBtn.getBoundingClientRect();
      showMenu(r.left, r.bottom + 6, [
        { label: 'None', icon: 'minus', checked: !folderVal, run: function () { setFolderVal(''); } },
        folders().length || draft.newFolderName ? '-' : null,
      ].concat(folders().map(function (f) {
        return { label: f.name, icon: 'folder', checked: folderVal === f.id, run: function () { setFolderVal(f.id); } };
      }), [
        draft.newFolderName ? { label: draft.newFolderName + ' (new)', icon: 'folder', checked: folderVal === '__pending', run: function () { setFolderVal('__pending'); } } : null,
        '-',
        { label: 'New Folder…', icon: 'folderPlus', run: promptNewFolder },
      ]), { title: 'Choose Folder' });
    });
    function promptNewFolder() {
      var n0 = Core.normalizeUrl(urlInput.value);
      promptDialog({ title: 'New Folder', message: 'The app will be added to this new folder.', placeholder: 'Folder name', value: n0.ok ? Core.categoryOf(n0.url) || '' : '', confirm: 'Create' }).then(function (name) {
        if (name == null) return;
        draft.newFolderName = Core.cleanText(name, Core.LIMITS.folderName) || 'Folder';
        setFolderVal('__pending');
      });
    }
    if (prefill.newFolder) setTimeout(promptNewFolder, 450);
    syncFolderBtn();

    var iconSegBtns = [];
    var iconSeg = h('div', { class: 'seg wide', role: 'radiogroup', 'aria-label': 'Logo', style: { '--n': '3' } }, h('span', { class: 'thumb' }));
    [['auto', 'Automatic'], ['letter', 'Letter'], ['custom', 'Custom']].forEach(function (o) {
      var b = h('button', { type: 'button', role: 'radio', onclick: function () { setIconType(o[0]); } }, o[1]);
      iconSegBtns.push([o[0], b]);
      iconSeg.appendChild(b);
    });
    var customPanel = h('div', { class: 'icon-panel' },
      h('div', { class: 'group' }, field('Image', logoUrlInput),
        h('button', { type: 'button', class: 'srow btn-row', onclick: pickFile }, h('span', { class: 'lbl', style: { color: 'var(--accent)' } }, 'Upload Image…'), icon('upload'))),
      h('div', { class: 'drop-hint' }, 'Tip: you can also paste or drop an image here.'), iconMsg);

    var tabBtn = null;
    if (!isEdit && state.currentTab && !prefill.url) {
      var ct = state.currentTab;
      tabBtn = h('button', { type: 'button', class: 'current-tab', onclick: function () {
        draft.hint = ct.favIconUrl; urlInput.value = ct.url; draft.nameTouched = false; nameInput.value = '';
        onUrlChange(true); nameInput.focus();
      } }, buildIcon({ id: 'ct', url: ct.url, name: Core.deriveName(ct.url), icon: { type: 'auto' }, hint: ct.favIconUrl }),
      h('span', { class: 'meta' }, h('span', { class: 'name' }, 'Add This Page'), h('span', { class: 'host' }, Core.displayUrl(ct.url))), icon('plus', 'plus'));
    }
    var sugWrap = null;
    if (!isEdit) {
      var chips = suggestionChips(function (sug) {
        urlInput.value = sug.url; nameInput.value = sug.name; draft.nameTouched = true; draft.hint = null;
        onUrlChange(true);
      });
      if (chips) sugWrap = h('div', { class: 'sheet-section' }, h('div', { class: 'sheet-caption' }, 'Popular'), chips);
    }

    var sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': isEdit ? 'Edit App' : 'New App' },
      h('div', { class: 'grabber', 'aria-hidden': 'true' }),
      h('div', { class: 'sheet-nav' }, h('div', { class: 'l' }, cancelBtn), h('h3', null, isEdit ? 'Edit App' : 'New App'), h('div', { class: 'r' }, saveBtn)),
      h('div', { class: 'sheet-body' },
        h('div', { class: 'preview' }, previewIconWrap, previewLabel),
        tabBtn ? h('div', { style: { marginBottom: '14px' } }, tabBtn) : null,
        h('div', { class: 'group' }, field('URL', urlInput), field('Name', nameInput),
          h('div', { class: 'field' }, h('label', { for: folderBtn.id }, 'Folder'), folderBtn)),
        urlMsg,
        h('div', { class: 'sheet-section' }, h('div', { class: 'sheet-caption' }, 'Logo'), iconSeg, customPanel),
        sugWrap,
        isEdit ? h('div', { class: 'sheet-section' }, h('div', { class: 'group' },
          h('button', { type: 'button', class: 'srow btn-row danger', onclick: function () {
            close(null); var le = live(existing); if (le) removeApp(le, doc.querySelector('.app[data-id="' + le.id + '"]'));
          } }, h('span', { class: 'lbl' }, 'Remove App')))) : null,
        fileInput));

    var close = openLayer(sheet, 'sheet', {
      onBackdrop: function () {
        if (draft.dirty) { sheet.classList.remove('bump'); void sheet.offsetWidth; sheet.classList.add('bump'); } else close(null);
      },
    });

    function currentName() { var n = Core.normalizeUrl(urlInput.value); return nameInput.value.trim() || (n.ok ? Core.deriveName(n.url) : ''); }
    function tempApp() {
      var n = Core.normalizeUrl(urlInput.value);
      return { id: 'preview', url: n.ok ? n.url : '', name: currentName() || 'New App', icon: draft.icon, hint: draft.hint,
        cache: existing && n.ok && existing.url === n.url && existing.icon.type === 'auto' ? existing.cache : undefined };
    }
    var lastPreviewKey = '';
    function refreshPreview(force) {
      var t = tempApp();
      var key = !t.url && t.icon.type === 'auto' ? 'empty' : t.url + '|' + JSON.stringify(t.icon) + '|' + (t.icon.type === 'auto' && t.url ? '' : t.name) + '|' + (t.hint || '');
      if (force || key !== lastPreviewKey) {
        lastPreviewKey = key;
        var tile;
        if (key === 'empty') {
          tile = h('span', { class: 'icon mono', style: { '--g1': '#5AC8FA', '--g2': '#007AFF' } }, icon('sparkle'));
          tile.firstChild.style.cssText = 'width:44%;height:44%;color:#fff';
        } else tile = buildIcon(t);
        previewIconWrap.replaceWith(tile);
        previewIconWrap = tile;
      }
      var nm = currentName();
      previewLabel.textContent = nm || 'Name';
      previewLabel.classList.toggle('placeholder', !nm);
      var n2 = Core.normalizeUrl(urlInput.value);
      nameInput.placeholder = (n2.ok ? Core.deriveName(n2.url) : '') || 'Name';
    }
    function validate(showErrors) {
      var n = Core.normalizeUrl(urlInput.value), ok = n.ok;
      urlMsg.className = 'field-msg';
      urlMsg.textContent = '';
      if (!n.ok && showErrors && urlInput.value.trim()) { urlMsg.className = 'field-msg error'; urlMsg.textContent = n.error; }
      else if (n.ok) {
        var dup = Core.flatten(state.items).find(function (e) { return e.app.id !== eid && Core.sameUrl(e.app.url, n.url); });
        if (dup) urlMsg.textContent = 'Heads up: “' + dup.app.name + '”' + (dup.folder ? ' in ' + dup.folder.name : '') + ' already opens this address.';
      }
      if (draft.icon.type === 'custom' && !draft.icon.src) ok = false;
      saveBtn.disabled = !ok;
      return n;
    }
    var urlTimer = 0;
    function onUrlChange(immediate) {
      draft.dirty = true;
      clearTimeout(urlTimer);
      var run = function () {
        var n = Core.normalizeUrl(urlInput.value);
        if (!draft.nameTouched) nameInput.value = n.ok ? Core.deriveName(n.url) : '';
        if (sugWrap) sugWrap.hidden = !!urlInput.value.trim();
        validate(urlInput.value.trim().length > 3 || immediate === true);
        refreshPreview();
      };
      if (immediate === true) run(); else { validate(false); urlTimer = setTimeout(run, 250); }
    }
    function setIconType(type) {
      draft.dirty = true;
      if (type === 'custom') {
        var src = draft.icon.type === 'custom' ? draft.icon.src : (logoUrlInput.value.trim() || draft.lastCustom || '');
        draft.icon = { type: 'custom', src: Core.isSafeImageSrc(src) ? src : '' };
      } else draft.icon = { type: type };
      syncIconSeg(); validate(false); refreshPreview();
      if (type === 'custom' && !draft.icon.src) setTimeout(function () { logoUrlInput.focus(); }, 50);
    }
    function syncIconSeg() {
      var idx = 0;
      iconSegBtns.forEach(function (p, i) { var on = p[0] === draft.icon.type; if (on) idx = i; p[1].setAttribute('aria-checked', String(on)); });
      iconSeg.style.setProperty('--i', String(idx));
      customPanel.hidden = draft.icon.type !== 'custom';
    }
    function setCustomSrc(src) {
      draft.icon = { type: 'custom', src: src }; draft.lastCustom = src; draft.dirty = true;
      iconMsg.className = 'field-msg'; iconMsg.textContent = '';
      syncIconSeg(); validate(false); refreshPreview();
    }
    function iconError(msg) { iconMsg.className = 'field-msg error'; iconMsg.textContent = msg; }
    function handleFile(file) {
      processImageFile(file).then(function (src) { logoUrlInput.value = ''; setCustomSrc(src); },
        function (e) { if (draft.icon.type !== 'custom') setIconType('custom'); iconError(e.message); });
    }
    function pickFile() {
      if (IS_FIREFOX && !IS_PAGE) { iconError('Firefox closes the popup while choosing files. Paste an image, use an image URL, or open Shelf in a full page (Settings → About).'); return; }
      fileInput.value = '';
      fileInput.click();
    }
    var logoTimer = 0;
    logoUrlInput.addEventListener('input', function () {
      clearTimeout(logoTimer);
      draft.dirty = true;
      logoTimer = setTimeout(function () {
        var v = logoUrlInput.value.trim();
        if (!v) { if (draft.icon.type === 'custom' && !/^data:/.test(draft.icon.src)) { draft.icon = { type: 'custom', src: '' }; validate(false); refreshPreview(); } return; }
        var n = /^data:image\//i.test(v) ? { ok: true, url: v } : Core.normalizeUrl(v);
        if (!n.ok || !Core.isSafeImageSrc(n.url)) { iconError('Enter a valid image address (https://…)'); return; }
        probe(n.url, 6000).then(function (r) {
          if (logoUrlInput.value.trim() !== v) return;
          if (!r) { iconError('Couldn’t load an image from that address'); return; }
          setCustomSrc(n.url);
        });
      }, 400);
    });
    fileInput.addEventListener('change', function () { if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]); });
    sheet.addEventListener('paste', function (e) {
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && /^image\//.test(items[i].type)) { e.preventDefault(); handleFile(items[i].getAsFile()); return; }
      }
    });
    sheet.addEventListener('dragover', function (e) {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); sheet.classList.add('dragover'); }
    });
    sheet.addEventListener('dragleave', function (e) { if (e.target === sheet) sheet.classList.remove('dragover'); });
    sheet.addEventListener('drop', function (e) {
      sheet.classList.remove('dragover');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) { e.preventDefault(); handleFile(f); }
    });
    urlInput.addEventListener('input', onUrlChange);
    urlInput.addEventListener('blur', function () { if (urlInput.value.trim()) { validate(true); refreshPreview(); } });
    nameInput.addEventListener('input', function () { draft.dirty = true; draft.nameTouched = nameInput.value.trim().length > 0; refreshPreview(); });
    [urlInput, nameInput, logoUrlInput].forEach(function (inp) {
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } });
    });
    cancelBtn.addEventListener('click', function () { close(null); });
    saveBtn.addEventListener('click', submit);

    function targetFolder() {
      if (folderVal === '__pending' && draft.newFolderName) return createFolder(draft.newFolderName);
      return folderVal ? liveFolder(folderVal) : null;
    }
    function submit() {
      var n = validate(true);
      if (!n.ok) {
        if (!urlInput.value.trim()) { urlMsg.className = 'field-msg error'; urlMsg.textContent = 'Enter a website address'; }
        urlInput.focus();
        urlInput.parentNode.classList.remove('shake'); void urlInput.offsetWidth; urlInput.parentNode.classList.add('shake');
        return;
      }
      if (draft.icon.type === 'custom' && !draft.icon.src) { iconError('Add an image URL or upload an image'); logoUrlInput.focus(); return; }
      if (!isEdit && totalApps() >= Core.LIMITS.apps) { toast('You’ve reached the ' + Core.LIMITS.apps + ' app limit'); return; }
      var name = (nameInput.value.trim() || Core.deriveName(n.url) || 'App').slice(0, Core.LIMITS.name);
      var memo = iconMem.get(n.url + '|' + (draft.hint || ''));
      if (isEdit) {
        var liveEntry = locate(eid);
        if (!liveEntry) { close(null); toast('This app was removed elsewhere'); return; }
        existing = liveEntry.entry;
      }
      var folder = targetFolder();
      if (isEdit) {
        var clean = Core.sanitizeApp({ id: existing.id, url: n.url, name: name, icon: draft.icon, hint: draft.hint });
        if (!clean) return;
        var urlChanged = existing.url !== clean.url;
        existing.url = clean.url; existing.name = clean.name; existing.icon = clean.icon;
        if (clean.hint) existing.hint = clean.hint; else delete existing.hint;
        if (urlChanged || clean.icon.type !== 'auto') delete existing.cache;
        iconNodes.delete(existing.id);
        var cur = locate(existing.id);
        close(true);
        if (cur && cur.folder !== folder) moveApp(existing.id, folder, { silent: true });
        save(); renderHome();
        toast('Saved');
        return;
      }
      close(true);
      var added = addApp({ url: n.url, name: name, icon: draft.icon, hint: draft.hint }, { folder: folder });
      if (added && memo) memo.then(function (r) { if (r && r.url === added.url && added.icon.type === 'auto') { added.cache = r; lazySave(); } });
    }

    syncIconSeg();
    if (sugWrap && urlInput.value.trim()) sugWrap.hidden = true;
    if (initialUrl && !isEdit) { onUrlChange(true); draft.dirty = true; } else { validate(false); refreshPreview(true); }
    setTimeout(function () { (isEdit || !initialUrl ? urlInput : nameInput).focus({ preventScroll: true }); if (isEdit) urlInput.select(); }, 60);
  }

  function openAppPicker(folderRef) {
    closeMenus();
    var fid = folderRef.id, folder = liveFolder(fid);
    if (!folder) return;
    var cands = Core.flatten(state.items).filter(function (e) { return e.folder !== folder; });
    var selected = new Set();
    var filter = h('input', { type: 'search', class: 'picker-search', placeholder: 'Search apps', autocomplete: 'off', spellcheck: 'false' });
    var list = h('div', { class: 'group picker-list', role: 'listbox', 'aria-multiselectable': 'true' });
    var shell;
    function row(e) {
      var r = h('button', { type: 'button', class: 'pick-row', role: 'option', 'aria-selected': 'false', 'data-id': e.app.id },
        h('span', { class: 'check' }, icon('check')), buildIcon(e.app),
        h('span', { class: 'meta' }, h('span', { class: 'name' }, e.app.name), h('span', { class: 'host' }, e.folder ? 'In ' + e.folder.name : Core.displayUrl(e.app.url))));
      r.addEventListener('click', function () {
        if (selected.has(e.app.id)) selected.delete(e.app.id); else selected.add(e.app.id);
        r.setAttribute('aria-selected', String(selected.has(e.app.id)));
        update();
      });
      return r;
    }
    var rows = cands.map(function (e) { return { e: e, el: row(e) }; });
    rows.forEach(function (r) { list.appendChild(r.el); });
    filter.addEventListener('input', function () {
      var q = filter.value.trim();
      var hits = q ? new Set(Core.filterApps(cands.map(function (e) { return e.app; }), q).map(function (a) { return a.id; })) : null;
      rows.forEach(function (r) { r.el.hidden = !!hits && !hits.has(r.e.app.id); });
    });
    function update() {
      shell.right.disabled = selected.size === 0;
      shell.right.textContent = selected.size ? 'Add (' + selected.size + ')' : 'Add';
    }
    var plusTile = h('span', { class: 'icon mono', style: { '--g1': '#5AC8FA', '--g2': '#007AFF' } }, icon('plus'));
    plusTile.firstChild.style.cssText = 'width:55%;height:55%;color:#fff;stroke-width:2.4';
    var newRow = h('button', { type: 'button', class: 'current-tab', onclick: function () { shell.close(null); openAppSheet(null, { folderId: fid }); } },
      plusTile, h('span', { class: 'meta' }, h('span', { class: 'name' }, 'New App…'), h('span', { class: 'host' }, 'Add a new website to ' + folder.name)));
    shell = sheetShell({
      title: 'Add to ' + folder.name,
      right: { label: 'Add', disabled: true, onClick: function (close) {
        var ids = cands.filter(function (e) { return selected.has(e.app.id); }).map(function (e) { return e.app.id; });
        var target = liveFolder(fid);
        close(true);
        if (!target) { toast('That folder no longer exists'); return; }
        var moved = 0;
        ids.forEach(function (id) {
          var l = locate(id);
          if (!l || isFolder(l.entry) || l.folder === target) return;
          l.list.splice(l.index, 1);
          target.apps.push(l.entry);
          moved++;
        });
        save(); renderHome();
        toast(moved ? 'Added ' + plural(moved, 'app') + ' to ' + target.name : 'Nothing to add');
      } },
      body: [h('div', { style: { marginBottom: '12px' } }, newRow),
        cands.length ? [cands.length > 8 ? filter : null, list] : h('p', { class: 'sheet-note' }, 'All your apps are already in this folder.')],
    });
    setTimeout(function () { (cands.length > 8 ? filter : newRow).focus(); }, 60);
  }

  /* ═════════════════════ Settings ═════════════════════ */

  var updaters = [];
  function updateSettings() { updaters.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } }); }
  function setSetting(patch) {
    state.settings = Core.sanitizeSettings(Object.assign({}, state.settings, patch), DEFAULTS);
    applyTheme();
    setQuery(state.query, true);
    renderHome();
    updateSettings();
    save({ syncNow: patch.sync === true });
  }
  function seg(key, options, label) {
    var el = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label || key, style: { '--n': String(options.length) } }, h('span', { class: 'thumb' }));
    var btns = options.map(function (o) {
      var b = h('button', { type: 'button', role: 'radio', onclick: function () { if (state.settings[key] === o[0]) return; var p = {}; p[key] = o[0]; haptic(); setSetting(p); } }, o[1]);
      el.appendChild(b);
      return b;
    });
    el.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var i = options.findIndex(function (o) { return o[0] === state.settings[key]; });
      var j = (i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
      var p = {}; p[key] = options[j][0]; setSetting(p); btns[j].focus();
    });
    updaters.push(function () {
      var i = Math.max(0, options.findIndex(function (o) { return o[0] === state.settings[key]; }));
      el.style.setProperty('--i', String(i));
      btns.forEach(function (b, j) { b.setAttribute('aria-checked', String(i === j)); b.tabIndex = i === j ? 0 : -1; });
    });
    return el;
  }
  /* iOS-style pop-up button: shows the value, opens a menu of choices */
  function pickerRow(ic, color, label, key, options, opts) {
    var val = h('span', { class: 'pick-val' });
    var btn = h('button', { type: 'button', class: 'pick-btn', 'aria-haspopup': 'menu', 'aria-label': label }, val, icon('chevUD'));
    btn.addEventListener('click', function () {
      var r = btn.getBoundingClientRect();
      haptic();
      showMenu(Math.max(8, r.right - 220), r.bottom + 6, options.map(function (o) {
        return { label: o[1], icon: 'blank', checked: state.settings[key] === o[0], run: function () { var p = {}; p[key] = o[0]; haptic(); setSetting(p); } };
      }), { title: label });
    });
    updaters.push(function () { var o = options.find(function (x) { return x[0] === state.settings[key]; }) || options[0]; val.textContent = o[1]; });
    return row(ic, color, label, btn, opts);
  }
  function toggle(key, label) {
    var input = h('input', { type: 'checkbox', class: 'switch', role: 'switch', 'aria-label': label });
    input.addEventListener('change', function () { var p = {}; p[key] = input.checked; haptic(); setSetting(p); });
    updaters.push(function () { input.checked = !!state.settings[key]; });
    return input;
  }
  function stepper() {
    var minus = h('button', { type: 'button', 'aria-label': 'Fewer' }, icon('minus'));
    var plus = h('button', { type: 'button', 'aria-label': 'More' }, icon('plus'));
    var v = h('span', { class: 'v', 'aria-live': 'polite' });
    function info() {
      var s = state.settings;
      if (s.orientation === 'horizontal') return { key: 'rows', min: 1, max: 6 };
      return s.view === 'list' ? { key: 'listColumns', min: 1, max: 3 } : { key: 'columns', min: 1, max: 8 };
    }
    function change(d) { var i = info(); var p = {}; p[i.key] = Core.clamp(state.settings[i.key] + d, i.min, i.max); setSetting(p); }
    minus.addEventListener('click', function () { change(-1); });
    plus.addEventListener('click', function () { change(1); });
    updaters.push(function () { var i = info(), cur = state.settings[i.key]; v.textContent = String(cur); minus.disabled = cur <= i.min; plus.disabled = cur >= i.max; });
    return h('div', { class: 'stepper' }, minus, v, plus);
  }
  function brandMark(cls) { return h('span', { class: 'brand-mark' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')); }
  function sicon(name, color) { return h('span', { class: 'sicon', style: { '--c': color } }, icon(name)); }
  function row(ic, color, label, control, opts) {
    opts = opts || {};
    var lbl = h('span', { class: 'lbl' }, label);
    var si = ic ? (typeof ic === 'string' ? sicon(ic, color) : ic) : null;
    var r = h('div', { class: 'srow' + (ic ? ' has-icon' : '') }, si, lbl, control);
    if (opts.dynLabel) updaters.push(function () { lbl.textContent = opts.dynLabel(); });
    if (opts.dynIcon && si) {
      var shownIc = ic;
      updaters.push(function () {
        var want = opts.dynIcon();
        if (want === shownIc) return;
        shownIc = want;
        si.replaceChild(icon(want), si.firstChild);
        si.classList.remove('swap'); void si.offsetWidth; si.classList.add('swap');
      });
    }
    if (opts.disabledWhen) updaters.push(function () { r.classList.toggle('disabled', !!opts.disabledWhen()); });
    if (opts.hiddenWhen) updaters.push(function () { r.hidden = !!opts.hiddenWhen(); });
    return r;
  }
  function btnRow(ic, color, label, onClick, opts) {
    opts = opts || {};
    var val = h('span', { class: 'val' });
    var r = h('button', { type: 'button', class: 'srow btn-row' + (ic ? ' has-icon' : '') + (opts.danger ? ' danger' : ''), onclick: onClick },
      ic ? sicon(ic, color) : null, h('span', { class: 'lbl' }, label), opts.danger ? null : val);
    if (opts.value) updaters.push(function () { val.textContent = ''; append(val, opts.value()); val.appendChild(icon('chevR')); });
    else if (!opts.danger) val.appendChild(icon(opts.external ? 'open' : 'chevR'));
    if (opts.hiddenWhen) updaters.push(function () { r.hidden = !!opts.hiddenWhen(); });
    return r;
  }
  function stackRow(ic, color, label, content, opts) {
    var r = h('div', { class: 'srow stack has-icon' }, h('div', { class: 'head' }, sicon(ic, color), h('span', { class: 'lbl' }, label)), content);
    if (opts && opts.hiddenWhen) updaters.push(function () { r.hidden = !!opts.hiddenWhen(); });
    return r;
  }
  function palettePicker() {
    var wrap = h('div', { class: 'palettes', role: 'radiogroup', 'aria-label': 'Theme' });
    var btns = Object.keys(Core.PALETTES).map(function (key) {
      var p = Core.PALETTES[key];
      function half(c) { return h('span', { class: 'half', style: { background: c.bg } }, h('i', { style: { background: c.surface } }), h('i', { style: { background: c.text, opacity: '.55' } })); }
      var b = h('button', { type: 'button', class: 'pal', role: 'radio', onclick: function () { setSetting({ palette: key }); } }, h('span', { class: 'prev' }, half(p.light), half(p.dark)), p.name);
      wrap.appendChild(b);
      return [key, b];
    });
    updaters.push(function () { btns.forEach(function (x) { x[1].setAttribute('aria-checked', String(x[0] === state.settings.palette)); }); });
    return wrap;
  }
  function wallpaperPicker() {
    var wrap = h('div', { class: 'palettes wallpapers', role: 'radiogroup', 'aria-label': 'Wallpaper' });
    var btns = Object.keys(Core.WALLPAPERS).filter(function (k) { return k !== 'photo'; }).map(function (key) {
      var prev = h('span', { class: 'prev wp' }, h('i'), h('i'));
      var b = h('button', { type: 'button', class: 'pal', role: 'radio', onclick: function () { haptic(); setSetting({ wallpaper: key }); } }, prev, Core.WALLPAPERS[key].name);
      wrap.appendChild(b);
      return [key, b, prev];
    });
    var photoPrev = h('span', { class: 'prev wp photo' }, icon('photo'));
    var photoBtn = h('button', { type: 'button', class: 'pal', role: 'radio', onclick: function () {
      if (wallPhoto && state.settings.wallpaper !== 'photo') { haptic(); setSetting({ wallpaper: 'photo' }); return; }
      pickWallpaperPhoto();
    } }, photoPrev, 'Photo');
    wrap.appendChild(photoBtn);
    updaters.push(function () {
      photoBtn.setAttribute('aria-checked', String(state.settings.wallpaper === 'photo'));
      photoBtn.lastChild.textContent = wallPhoto && state.settings.wallpaper === 'photo' ? 'Change…' : 'Photo';
      photoPrev.style.backgroundImage = wallPhoto ? 'url("' + wallPhoto + '")' : '';
      photoPrev.classList.toggle('has-photo', !!wallPhoto);
    });
    updaters.push(function () {
      var dark = isDark();
      btns.forEach(function (x) {
        x[1].setAttribute('aria-checked', String(x[0] === state.settings.wallpaper));
        x[2].style.background = Core.wallpaperCss(Object.assign({}, state.settings, { wallpaper: x[0] }), dark);
      });
    });
    return wrap;
  }
  function accentPicker() {
    var wrap = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Accent color' });
    var btns = Core.ACCENTS.map(function (c) {
      var b = h('button', { type: 'button', class: 'sw', role: 'radio', 'aria-label': c, style: { '--c': c }, onclick: function () { setSetting({ accent: c }); } });
      wrap.appendChild(b);
      return [c, b];
    });
    var input = h('input', { type: 'color', 'aria-label': 'Custom accent color' });
    var custom = h('label', { class: 'sw custom', title: 'Custom color', role: 'radio' }, input);
    input.addEventListener('input', function () { setSetting({ accent: input.value }); });
    wrap.appendChild(custom);
    updaters.push(function () {
      var a = state.settings.accent, preset = false;
      btns.forEach(function (x) { var on = x[0].toUpperCase() === a; preset = preset || on; x[1].setAttribute('aria-checked', String(on)); });
      custom.setAttribute('aria-checked', String(!preset));
      custom.style.setProperty('--c', a);
      custom.style.background = preset ? '' : a;
      if (doc.activeElement !== input) input.value = a.toLowerCase();
    });
    return wrap;
  }
  function colorRow(label, key) {
    var input = h('input', { type: 'color', 'aria-label': label });
    var chip = h('label', { class: 'color-chip' }, input);
    var hex = h('span', { class: 'hex' });
    input.addEventListener('input', function () {
      var mode = isDark() ? 'dark' : 'light';
      var custom = JSON.parse(JSON.stringify(state.settings.custom));
      custom[mode][key] = input.value; custom.enabled = true;
      setSetting({ custom: custom });
    });
    var r = row(null, null, label, h('span', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, hex, chip), { hiddenWhen: function () { return !state.settings.custom.enabled; } });
    updaters.push(function () {
      var c = Core.baseColors(state.settings, isDark())[key];
      chip.style.setProperty('--c', c); hex.textContent = c;
      if (doc.activeElement !== input) input.value = c.toLowerCase();
    });
    return r;
  }

  function ago(ts) {
    if (!ts) return 'never';
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    var m = Math.round(s / 60); if (m < 60) return m + ' min ago';
    var hr = Math.round(m / 60); if (hr < 24) return plural(hr, 'hour') + ' ago';
    var d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  var syncInfo = null;
  function refreshSyncInfo() { return Store.syncState().then(function (s) { syncInfo = s; updateSettings(); }); }

  /* ───── Haptics: vibration on Android; the iOS 18+ switch trick on iPhone ───── */
  var hapticLabel = null;
  function haptic(kind) {
    if (!state.settings.haptics) return;
    try {
      if (navigator.vibrate && !IS_IOS) { navigator.vibrate(kind === 'heavy' ? [14, 40, 14] : kind === 'success' ? [8, 36, 10] : 9); return; }
      if (IS_IOS && IS_TOUCH) {
        if (!hapticLabel) {
          var inp = h('input', { type: 'checkbox', tabIndex: -1 });
          inp.setAttribute('switch', '');
          hapticLabel = h('label', { 'aria-hidden': 'true', style: { position: 'fixed', left: '-200px', top: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' } }, inp);
          doc.body.appendChild(hapticLabel);
        }
        hapticLabel.click();
      }
    } catch (e) { /* not supported */ }
  }

  /* ───── Website (PWA) extras ───── */
  var installPrompt = null, persisted = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installPrompt = e; updateSettings(); });
  window.addEventListener('appinstalled', function () { installPrompt = null; toast('Shelf installed'); updateSettings(); });
  function webInstallRow() {
    var val = h('span', { class: 'val' });
    var r = h('button', { type: 'button', class: 'srow btn-row has-icon', onclick: function () {
      if (IS_STANDALONE) { toast('Shelf is already installed'); return; }
      installNow();
    } }, sicon('download', '#30D158'), h('span', { class: 'lbl' }, 'Install App'), val);
    updaters.push(function () { val.textContent = IS_STANDALONE ? 'Installed' : ''; if (!IS_STANDALONE) val.appendChild(icon('chevR')); });
    return r;
  }
  function webPersistRow() {
    var val = h('span', { class: 'val' });
    var r = h('button', { type: 'button', class: 'srow btn-row has-icon', onclick: function () { requestPersist(true); } },
      sicon('shield', '#34C759'), h('span', { class: 'lbl' }, 'Protected Storage'), val);
    updaters.push(function () { val.textContent = persisted === true ? 'On' : persisted === false ? 'Tap to turn on' : 'Checking…'; });
    return r;
  }
  function requestPersist(userAsked) {
    var st = navigator.storage;
    if (!st || !st.persisted) { persisted = false; updateSettings(); if (userAsked) toast('This browser can’t protect storage — export a backup'); return; }
    st.persisted().then(function (p) {
      if (p) return true;
      if (!userAsked && IS_FIREFOX) return false;           // Firefox asks with a prompt → only on request
      return st.persist ? st.persist() : false;
    }).then(function (p) {
      persisted = !!p; updateSettings();
      if (userAsked) toast(p ? 'Storage is protected' : IS_IOS ? 'Add Shelf to your Home Screen to protect it' : 'The browser declined — install Shelf or export a backup');
    }).catch(function () { persisted = false; updateSettings(); });
  }
  function handleIncoming() {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    if (q.has('todo')) {
      var tq = q.get('todo') || 'today', act = q.get('act');
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
      setTimeout(function () {
        var tk = taskById(tq);
        if (tk && act === 'done') { completeTaskFromAnywhere(tk.id); openTodos(tk.list); return; }
        if (tk && act === 'snooze') { snoozeFor(tk.id, Date.now() + (Number(state.settings.todoSnooze) || 10) * 60e3); openTodos(tk.list, { task: tk.id }); return; }
        if (tk) openTodos(tk.list, { task: tk.id });
        else openTodos(tq === 'new' ? defaultListId() || 'new' : tq, { focusAdd: tq === 'new' });
      }, 150);
      return;
    }
    if (q.has('welcome')) { try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ } setTimeout(function () { showWelcome(true); }, 200); return; }
    if (q.get('q')) { var qq = q.get('q'); try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ } setQuery(qq); searchInput.focus(); return; }
    if (q.has('new')) { try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ignore */ } openAppSheet(); return; }
    var raw = q.get('add') || q.get('url') || '';
    if (!raw) { var t = q.get('text') || ''; var m = t.match(/https?:\/\/\S+/); if (m) raw = m[0]; }
    if (!raw) return;
    var name = Core.cleanText(q.get('name') || q.get('title') || '', Core.LIMITS.name);
    var hint = q.get('hint') || '';
    var wantsFolder = q.get('folder') === 'new';
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ignore */ }
    var nrm = Core.normalizeUrl(raw);
    if (!nrm.ok) { toast('That shared link isn’t a valid address'); return; }
    var dup = Core.flatten(state.items).find(function (e) { return Core.sameUrl(e.app.url, nrm.url); });
    if (dup && !wantsFolder) { toast('“' + dup.app.name + '” is already on your shelf'); return; }
    if (dup && wantsFolder) { openAppSheet(dup.app, { newFolder: true }); return; }
    openAppSheet(null, { url: nrm.url, name: name, hint: Core.isSafeImageSrc(hint) ? hint : null, newFolder: wantsFolder });
  }
  function introAnimation() {
    if (REDUCED || !appsEl.animate) return;
    Array.prototype.slice.call(appsEl.children, 0, 40).forEach(function (el, i) {
      el.animate([{ opacity: 0, transform: 'scale(.82) translateY(6px)' }, { opacity: 1, transform: 'none' }],
        { duration: 420, delay: Math.min(i, 16) * 14, easing: 'cubic-bezier(.3,1.3,.5,1)', fill: 'backwards' });
    });
  }

  /* ───── Browser detection for install help ───── */
  var UA = navigator.userAgent || '';
  var BROWSER = /CriOS/.test(UA) ? 'ios-chrome' : /FxiOS/.test(UA) ? 'ios-firefox' : /EdgiOS/.test(UA) ? 'ios-edge' : IS_IOS ? 'ios-safari'
    : /SamsungBrowser/.test(UA) ? 'samsung' : /Android/.test(UA) && /Firefox/.test(UA) ? 'android-firefox' : /Android/.test(UA) ? 'android-chrome'
    : /Edg\//.test(UA) ? 'desktop-edge' : /Firefox/.test(UA) ? 'desktop-firefox' : /Safari/.test(UA) && !/Chrome|Chromium/.test(UA) ? 'desktop-safari' : 'desktop-chrome';
  function installSteps() {
    var ipad = IS_IOS && /iPad|Macintosh/.test(UA);
    switch (BROWSER) {
      case 'ios-safari': return [['share', 'Tap the Share button', ipad ? 'It’s at the top right of Safari.' : 'It’s in the toolbar at the bottom of Safari.'], ['addSquare', 'Choose “Add to Home Screen”', 'Scroll down the share sheet if you don’t see it.'], ['check', 'Tap “Add”', 'Shelf opens full screen from your Home Screen.']];
      case 'ios-chrome': return [['share', 'Tap the Share button', 'It’s in the address bar at the top right.'], ['addSquare', 'Choose “Add to Home Screen”', ''], ['check', 'Tap “Add”', '']];
      case 'ios-edge': case 'ios-firefox': return [['hamburger', 'Open the browser menu', ''], ['share', 'Tap “Share”', ''], ['addSquare', 'Choose “Add to Home Screen”', '']];
      case 'samsung': return [['hamburger', 'Open the menu (≡)', 'At the bottom right.'], ['addSquare', 'Tap “Add page to” → “Home screen”', ''], ['check', 'Tap “Add”', '']];
      case 'android-firefox': return [['menuDots', 'Open the menu (⋮)', ''], ['addSquare', 'Tap “Install”', ''], ['check', 'Confirm “Add”', '']];
      case 'android-chrome': return [['menuDots', 'Open the menu (⋮)', 'At the top right.'], ['addSquare', 'Tap “Install app” or “Add to Home screen”', ''], ['check', 'Tap “Install”', '']];
      case 'desktop-safari': return [['dock', 'In the menu bar choose File → “Add to Dock…”', 'Needs macOS Sonoma or later.'], ['check', 'Click “Add”', 'Shelf opens in its own window.']];
      case 'desktop-firefox': return [['info', 'Firefox can’t install web apps', 'Use the Shelf add-on for Firefox, or bookmark this page.']];
      default: return [['download', 'Click the install icon in the address bar', 'Or open the browser menu (⋮) → “Install Shelf…”.'], ['check', 'Click “Install”', 'Shelf opens in its own window, like an app.']];
    }
  }
  function openInstallGuide() {
    var steps = installSteps();
    var list = h('div', { class: 'group guide-steps' }, steps.map(function (st, i) {
      return h('div', { class: 'srow has-icon step' }, h('span', { class: 'step-num' }, String(i + 1)), sicon(st[0], '#0A84FF'),
        h('span', { class: 'meta' }, h('span', { class: 'name wrap' }, st[1]), st[2] ? h('span', { class: 'host wrap' }, st[2]) : null));
    }));
    var shell = sheetShell({ title: 'Install Shelf', left: 'Close', body: [
      h('div', { class: 'install-hero' }, brandMark('big'),
        h('h2', null, 'Get the Shelf app'), h('p', null, 'Full screen, works offline, and your apps are better protected.')),
      list] });
    if (BROWSER === 'ios-safari' && !/iPad|Macintosh/.test(UA)) {
      var arrow = h('div', { class: 'share-arrow', 'aria-hidden': 'true' }, icon('share'), h('span', null, 'Tap Share'));
      shell.sheet.classList.add('with-arrow');
      doc.body.appendChild(arrow);
      var obs = setInterval(function () { if (!shell.sheet.isConnected) { arrow.remove(); clearInterval(obs); } }, 400);
    }
  }
  function installNow() {
    if (IS_STANDALONE) { toast('Shelf is already installed'); return; }
    if (installPrompt) {
      installPrompt.prompt();
      installPrompt.userChoice.then(function (c) { if (c && c.outcome === 'accepted') haptic('success'); installPrompt = null; updateSettings(); }).catch(function () {});
      return;
    }
    openInstallGuide();
  }
  var bannerShown = false;
  function maybeInstallBanner() {
    if (!IS_WEB || IS_STANDALONE || bannerShown || !/^https?:$/.test(location.protocol) || BROWSER === 'desktop-firefox') return;
    var last = 0;
    try { last = Number(localStorage.getItem('shelf.installDismissedAt')) || 0; } catch (e) { /* ignore */ }
    if (Date.now() - last < 14 * 864e5) return;
    if (layers.length || state.view === 'settings') { setTimeout(maybeInstallBanner, 4000); return; }
    bannerShown = true;
    var close = function (remember) {
      if (remember) { try { localStorage.setItem('shelf.installDismissedAt', String(Date.now())); } catch (e) { /* ignore */ } }
      banner.classList.remove('show');
      setTimeout(function () { banner.remove(); }, 400);
    };
    var banner = h('div', { class: 'install-banner', role: 'dialog', 'aria-label': 'Install Shelf' },
      brandMark(),
      h('div', { class: 'meta' }, h('span', { class: 'name' }, 'Install Shelf'), h('span', { class: 'host' }, IS_IOS ? 'Add it to your Home Screen for a full-screen app.' : 'Full screen, offline, one tap away.')),
      h('button', { type: 'button', class: 'btn primary small', onclick: function () { close(false); installNow(); } }, IS_IOS ? 'How' : 'Install'),
      h('button', { type: 'button', class: 'icon-btn close-x', 'aria-label': 'Not now', onclick: function () { close(true); } }, icon('x')));
    doc.body.appendChild(banner);
    void banner.offsetWidth;
    banner.classList.add('show');
  }

  /* ───── Welcome & How-to ───── */
  function featureRow(ic, color, title, text) {
    return h('div', { class: 'feature' }, sicon(ic, color), h('div', null, h('div', { class: 'f-title' }, title), h('div', { class: 'f-text' }, text)));
  }
  function showWelcome(force) {
    if (!force && state.settings.onboarded) return;
    var done = function () { if (!state.settings.onboarded) setSetting({ onboarded: true }); };
    var shell = sheetShell({ title: '', left: 'Skip', onClose: done, body: [
      h('div', { class: 'welcome-hero' },
        brandMark('big'),
        h('h2', null, 'Welcome to Shelf'),
        h('p', null, 'Your favorite sites as beautiful apps — organized, searchable and one tap away.')),
      h('div', { class: 'features' },
        featureRow('plus', '#30D158', 'Add any site', IS_PAGE ? 'Tap +, paste a link. The name and logo fill in by themselves.' : 'Tap +, or tap “Add” on the site you’re on. Right-click any page → Add Page to Shelf.'),
        featureRow('folder', '#0A84FF', 'Make folders', 'Press and hold an app, then drop it on another — just like iPhone.'),
        featureRow('glass', 'linear-gradient(135deg,#64D2FF,#BF5AF2)', 'Make it yours', 'Liquid Glass, wallpapers (even your own photo), icons or list, sizes and spacing.'),
        featureRow('shield', '#34C759', 'Always safe', IS_WEB ? 'Saved on this device with 10 automatic versions. Install Shelf and export a backup for extra safety.' : 'Syncs with your browser account and keeps 10 automatic versions.')),
      h('button', { type: 'button', class: 'btn primary block', onclick: function () { shell.close(true); haptic('success'); if (!state.items.length) setTimeout(function () { openAppSheet(); }, 380); } }, 'Get Started'),
      h('button', { type: 'button', class: 'link-btn center', onclick: function () { shell.close(true); setTimeout(openGuide, 380); } }, icon('book'), 'How to use Shelf')] });
    shell.sheet.classList.add('welcome');
  }
  function openGuide() {
    var mod = IS_MAC ? '⌘' : 'Ctrl';
    var sections = [
      ['Getting Started', [
        ['plus', '#30D158', 'Add an app', 'Tap + → New App and paste any address. Shelf fills in the name and logo — change them anytime.'],
        IS_PAGE ? null : ['bookmark', '#FF375F', 'Add the site you’re on', 'Tap the “Add” suggestion at the top, use + → Add This Page, or right-click any page → Add Page to Shelf (choose Home, a folder or New Folder).'],
        ['open', '#0A84FF', 'Open apps', IS_TOUCH ? 'Tap an app to open it. Choose New Tab, Background Tab or Current Tab in Settings → Open Apps In.' : 'Click to open. ' + mod + '-click or middle-click opens in the background, Shift-click opens a new window.'],
      ]],
      ['Organize', [
        ['grid', '#FF9F0A', 'Rearrange', IS_TOUCH ? 'Press and hold an app, then move your finger. Tap Done when finished.' : 'Press and hold (or right-click → Rearrange), then drag. Press Esc or Done when finished.'],
        ['folder', '#0A84FF', 'Folders', 'Drop one app onto another to make a folder, or use + → New Folder. Right-click an app → Move to Folder.'],
        ['dock', '#5E5CE6', 'Dock', 'Right-click (or press and hold) an app → Add to Dock to keep favorites at the bottom, like a phone. Turn the Dock off in Settings → Home Screen.'],
        ['pencil', '#5E5CE6', 'Folder options', 'Open a folder to rename it, Add Apps, Open All, or drag an app outside to take it out. Deleting a folder can keep its apps.'],
      ]],
      ['To-Do', [
        ['checklist', '#0A84FF', 'Quick to-dos', 'Tap + → New To-Do. Type naturally: “Call Sam tomorrow 5pm !!” sets the date, a reminder and priority. Add #list to pick a list, “every weekday” to repeat.'],
        ['dots3', '#5E5CE6', 'Lists as dots', 'Each list is a coloured dot next to +. Tap a dot to open it; right-click (or press and hold) to rename, recolour or delete. A red number means something is overdue.'],
        ['bell', '#FF9F0A', 'Reminders', IS_WEB ? 'When a to-do is due you get a banner, a sound and — if you allow it — a system notification, while Shelf is open. Snooze or complete it right there.' : 'When a to-do is due you get a system notification with Snooze and Done, even when Shelf is closed. The toolbar icon shows how many are overdue.'],
        ['grip', '#8E8E93', 'Organize', 'Drag the handle to reorder, swipe left to delete on touch screens, click the text to edit it, or open Details for notes, repeat and priority. Everything has Undo.'],
        IS_PAGE ? null : ['link', '#40C8E0', 'From anywhere', 'Select text on any page → right-click → Add to To-Do. Or type “sh + Buy milk tomorrow” in the address bar.'],
      ]],
      ['Find', [
        ['search', '#8E8E93', 'Search', 'Just start typing — even inside folders. Press Enter to open the top result. No match? Enter searches the web (choose Google, DuckDuckGo, Bing or Brave in Settings → Behavior).'],
        IS_PAGE ? null : ['link', '#40C8E0', 'Address bar', 'Type “sh”, press Space, then an app name. Enter opens it.'],
        IS_TOUCH ? null : ['keyboard', '#636366', 'Keyboard', 'Alt+1–9 opens your first nine apps. ' + mod + ' + , opens Settings. Arrow keys move between apps.'],
      ]],
      ['Make It Yours', [
        ['glass', '#64D2FF', 'Liquid Glass', 'Settings → Appearance → Liquid Glass. Pick a style and a wallpaper — or your own photo.'],
        ['cols', '#40C8E0', 'Layout', 'Icons or List, vertical or horizontal pages, apps per row, icon size and shape, and spacing.'],
        ['sparkle', '#BF5AF2', 'Behavior', 'Splash screen, haptics, reduce motion, and where apps open.'],
        ['resize', '#64D2FF', 'Shelf icon & window', 'Color the Shelf icon with your accent, Classic Blue or Graphite. In the extension, pick a Compact, Standard or Large window.'],
      ]],
      ['Your Data', [
        IS_WEB ? ['download', '#30D158', 'Install the app', 'Settings → Install App. Installed, Shelf works offline and your data is better protected.'] : ['cloud', '#0A84FF', 'Sync', 'Sync Across Devices keeps your apps in your browser account and merges them across computers.'],
        ['history', '#5E5CE6', 'Versions', 'Shelf saves a version every few hours and before big changes. Settings → Restore Previous Version.'],
        ['upload', '#FF9F0A', 'Backups', 'Export Backup saves a file you can import anywhere — the extension and the website use the same format.'],
      ]],
    ];
    var body = sections.map(function (sec) {
      return [h('div', { class: 'group-title' }, sec[0]), h('div', { class: 'group guide' }, sec[1].filter(Boolean).map(function (it) {
        return h('div', { class: 'srow has-icon guide-row' }, sicon(it[0], it[1]), h('span', { class: 'meta' }, h('span', { class: 'name' }, it[2]), h('span', { class: 'host wrap' }, it[3])));
      }))];
    });
    sheetShell({ title: 'How to Use Shelf', left: 'Done', body: body });
  }

  /* ───── Wallpaper photo (device-only) ───── */
  var wallPhoto = null;
  function processWallpaper(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || '')) { reject(new Error('Choose a photo (JPG, PNG, HEIC…)')); return; }
      if (file.size > 25 * 1024 * 1024) { reject(new Error('That photo is too large (max 25 MB)')); return; }
      var url = URL.createObjectURL(file), img = new Image();
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That photo couldn’t be opened')); };
      img.onload = function () {
        try {
          var M = 1600, k = Math.min(1, M / Math.max(img.naturalWidth, img.naturalHeight));
          var c = doc.createElement('canvas');
          c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          resolve(c.toDataURL('image/jpeg', 0.82));
        } catch (e) { reject(new Error('That photo couldn’t be processed')); }
      };
      img.src = url;
    });
  }
  function pickWallpaperPhoto() {
    if (IS_FIREFOX && !IS_PAGE) { toast('Opening full page to choose a photo…'); setTimeout(openFullPage, 500); return; }
    var input = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    doc.body.appendChild(input);
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      processWallpaper(f).then(function (data) {
        wallPhoto = data;
        var o = {}; o[Store.KEYS.wallpaperImg] = data;
        return Store.local.set(o).then(function () { setSetting({ wallpaper: 'photo', glass: true }); toast('Wallpaper set'); haptic('success'); });
      }).catch(function (e) { toast(e.message || 'Couldn’t use that photo'); });
    });
    input.click();
  }

  /* ───── Suggest the site you're on ───── */
  var suggestEl = null, suggestDismissed = false;
  function renderSuggest() {
    if (!suggestEl) { suggestEl = h('div', { class: 'suggest', hidden: true }); appsEl.parentNode.insertBefore(suggestEl, appsEl); }
    var t = state.currentTab;
    var show = !!t && !IS_PAGE && state.settings.suggestSite && !suggestDismissed && !state.query && !state.editing && state.items.length > 0;
    suggestEl.hidden = !show;
    if (!show) return;
    if (suggestEl.dataset.url === t.url) return;
    suggestEl.dataset.url = t.url;
    var name = Core.deriveName(t.url);
    suggestEl.textContent = '';
    suggestEl.append(
      h('button', { type: 'button', class: 'suggest-pill', title: 'Add ' + Core.displayUrl(t.url), onclick: function () {
        var added = addApp({ url: t.url, name: name, hint: t.favIconUrl }, { silent: true });
        if (!added) return;
        haptic('success');
        state.currentTab = null; renderSuggest();
        toast('Added ' + added.name, { action: 'Undo', onAction: function () { var l = locate(added.id); if (l) { l.list.splice(l.index, 1); save(); renderHome(); } } });
      } }, buildIcon({ id: 'sg', url: t.url, name: name, icon: { type: 'auto' }, hint: t.favIconUrl }),
        h('span', { class: 'meta' }, h('span', { class: 'name' }, 'Add “' + name + '”'), h('span', { class: 'host' }, Core.displayUrl(t.url))),
        h('span', { class: 'plus-badge' }, icon('plus'))),
      h('button', { type: 'button', class: 'suggest-x', 'aria-label': 'Dismiss', onclick: function () { suggestDismissed = true; renderSuggest(); } }, icon('x')));
  }

  /* ───── Sync now ───── */
  function syncNow() {
    if (!Store.hasSync) return;
    toast('Syncing…');
    Store.reconcile(DEFAULTS).then(function (r) {
      refreshSyncInfo();
      var msg = { applied: 'Updated from your other devices', merged: 'Merged apps from your other devices', pushed: 'Synced', none: 'Everything is up to date', off: 'Sync is off', error: 'Sync failed — try again later' }[r.action] || 'Synced';
      toast(msg);
      if (r.action === 'applied' || r.action === 'merged') reloadFromStorage();
    });
  }

  function buildSettings() {
    var back = h('button', { type: 'button', class: 'nav-back', onclick: closeSettings }, icon('chevL'), 'Apps');
    var nav = h('div', { class: 'navbar' }, back, h('div', { class: 'nav-title' }, 'Settings'), h('div'));
    settingsEl.addEventListener('scroll', function () { nav.classList.toggle('scrolled', settingsEl.scrollTop > 2); }, { passive: true });

    var customFoot = h('div', { class: 'group-foot' });
    updaters.push(function () {
      var s = state.settings;
      if (!s.custom.enabled) { customFoot.className = 'group-foot'; customFoot.textContent = s.glass ? 'Liquid Glass turns panels into frosted glass over a wallpaper.' : 'Override background, tile and text colors.'; return; }
      var b = Core.baseColors(s, isDark()), warn = Core.contrastRatio(b.text, b.bg) < 3;
      customFoot.className = 'group-foot' + (warn ? ' warn' : '');
      customFoot.textContent = (warn ? 'Low contrast — text may be hard to read. ' : '') + 'Editing colors for ' + (isDark() ? 'Dark' : 'Light') + ' appearance. Switch appearance to edit the other.';
    });
    var resetColors = btnRow(null, null, 'Reset Colors', function () {
      setSetting({ custom: { enabled: false, light: { bg: null, surface: null, text: null }, dark: { bg: null, surface: null, text: null } } });
      toast('Colors reset');
    }, { hiddenWhen: function () { return !state.settings.custom.enabled; } });

    var syncFoot = h('div', { class: 'group-foot' });
    updaters.push(function () {
      var s = state.settings, msg, warn = false;
      if (IS_WEB) msg = 'On the website, apps are saved in this browser only. Clearing this site’s data removes them — install Shelf and export a backup now and then.';
      else if (!Store.hasSync) msg = 'This browser doesn’t support sync. Use Export Backup to keep a copy.';
      else if (!s.sync) msg = 'Sync is off. Your apps are only on this device.';
      else if (syncInfo && !syncInfo.ok && syncInfo.reason === 'too-large') { msg = 'Too much data to sync (browser limit is about 100 KB). Your apps are safe on this device — export a backup too.'; warn = true; }
      else if (syncInfo && !syncInfo.ok) { msg = 'The last sync attempt failed. Shelf will retry automatically.'; warn = true; }
      else msg = 'Synced with your browser account' + (syncInfo && syncInfo.at ? ' · ' + ago(syncInfo.at) : '') + '. Uploaded logos stay on this device.';
      syncFoot.className = 'group-foot' + (warn ? ' warn' : '');
      syncFoot.textContent = msg;
    });
    var appCount = function () {
      var n = totalApps(), f = Core.countFolders(state.items);
      return plural(n, 'app') + (f ? ', ' + plural(f, 'folder') : '');
    };
    var syncToggle = (function () {
      var input = h('input', { type: 'checkbox', class: 'switch', role: 'switch', 'aria-label': 'Sync across devices', disabled: !Store.hasSync });
      input.addEventListener('change', function () { setSetting({ sync: input.checked }); if (input.checked) toast('Sync is on'); setTimeout(refreshSyncInfo, 3000); });
      updaters.push(function () { input.checked = Store.hasSync && state.settings.sync; });
      return input;
    })();
    var mod = IS_MAC ? '⌘' : 'Ctrl';

    var body = h('div', { class: 'settings-body' },
      h('div', { class: 'group-title' }, 'Appearance'),
      h('div', { class: 'group' },
        row('moon', '#5E5CE6', 'Appearance', seg('theme', [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], 'Appearance')),
        row('glass', 'linear-gradient(135deg,#64D2FF,#BF5AF2)', 'Liquid Glass', toggle('glass', 'Liquid Glass')),
        pickerRow('sparkle', '#64D2FF', 'Glass Style', 'glassStyle', [['frosted', 'Frosted'], ['clear', 'Clear'], ['tinted', 'Tinted']], { hiddenWhen: function () { return !state.settings.glass; } }),
        stackRow('photo', '#FF375F', 'Wallpaper', wallpaperPicker(), { hiddenWhen: function () { return !state.settings.glass; } }),
        stackRow('palette', '#FF9F0A', 'Theme', palettePicker(), { hiddenWhen: function () { return state.settings.glass; } }),
        stackRow('drop', 'var(--accent)', 'Accent Color', accentPicker()),
        pickerRow(h('span', { class: 'sicon sicon-brand' }, brandMark()), null, 'Shelf Icon', 'logoColor', [['accent', 'Accent Color'], ['classic', 'Classic Blue'], ['mono', 'Graphite']]),
        IS_PAGE ? null : pickerRow('resize', '#64D2FF', 'Window Size', 'windowSize', [['compact', 'Compact'], ['standard', 'Standard'], ['large', 'Large']]),
        row('sliders', '#8E8E93', 'Custom Colors', (function () {
          var input = h('input', { type: 'checkbox', class: 'switch', role: 'switch', 'aria-label': 'Custom colors' });
          input.addEventListener('change', function () { var c = JSON.parse(JSON.stringify(state.settings.custom)); c.enabled = input.checked; haptic(); setSetting({ custom: c }); });
          updaters.push(function () { input.checked = state.settings.custom.enabled; });
          return input;
        })()),
        colorRow('Background', 'bg'), colorRow('Tiles & Cards', 'surface'), colorRow('Text', 'text'), resetColors),
      customFoot,

      h('div', { class: 'group-title' }, 'Home Screen'),
      h('div', { class: 'group' },
        row('grid', '#0A84FF', 'View', seg('view', [['grid', 'Icons'], ['list', 'List']], 'View'), { dynIcon: function () { return state.settings.view === 'list' ? 'list' : 'grid'; } }),
        row('arrowsV', '#30D158', 'Direction', seg('orientation', [['vertical', 'Vertical'], ['horizontal', 'Horizontal']], 'Direction'), { dynIcon: function () { return state.settings.orientation === 'horizontal' ? 'arrowsH' : 'arrowsV'; } }),
        row('cols', '#40C8E0', 'Apps per Row', stepper(), { dynLabel: function () {
          return state.settings.orientation === 'horizontal' ? (state.settings.view === 'list' ? 'Rows per Page' : 'Apps per Column') : (state.settings.view === 'list' ? 'Columns' : 'Apps per Row');
        }, dynIcon: function () { return state.settings.orientation === 'horizontal' ? 'rows' : 'cols'; } }),
        pickerRow('sort', '#5856D6', 'Sort', 'sort', [['manual', 'Manual'], ['name', 'Name (A–Z)'], ['usage', 'Most Used']]),
        row('size', '#FF375F', 'Icon Size', seg('iconSize', [['small', 'S'], ['medium', 'M'], ['large', 'L']], 'Icon size')),
        pickerRow('shape', '#BF5AF2', 'Icon Shape', 'iconShape', [['rounded', 'Rounded'], ['circle', 'Circle'], ['square', 'Square']]),
        pickerRow('cols', '#FF9F0A', 'Spacing', 'density', [['compact', 'Compact'], ['regular', 'Regular'], ['spacious', 'Spacious']]),
        row('text', '#34C759', 'Show Names', toggle('showNames', 'Show names'), { disabledWhen: function () { return state.settings.view === 'list'; } }),
        row('dock', '#5E5CE6', 'Dock', toggle('showDock', 'Dock'))),
      (function () {
        var f = h('div', { class: 'group-foot' });
        updaters.push(function () {
          var s2 = state.settings;
          f.textContent = (s2.view === 'list' ? 'Names are always shown in List view.' : s2.sort !== 'manual' ? 'Rearranging switches back to Manual order.' : 'Tip: drag one app onto another to make a folder.') +
            (s2.showDock ? ' Right-click an app → Add to Dock to keep favorites at the bottom.' : '') +
            (IS_PAGE ? ' Full-screen view fits as many apps per row as your screen allows.' : '');
        });
        return f;
      })(),

      h('div', { class: 'group-title' }, 'Behavior'),
      h('div', { class: 'group' },
        pickerRow('tab', '#30D158', 'Open Apps In', 'openIn', IS_WEB ? [['new', 'New Tab'], ['current', 'This Tab']] : [['new', 'New Tab'], ['background', 'Background Tab'], ['current', 'Current Tab']]),
        row('search', '#8E8E93', 'Search Bar', toggle('showSearch', 'Search bar')),
        pickerRow('globe', '#0A84FF', 'Search the Web With', 'webSearch', [['google', 'Google'], ['duckduckgo', 'DuckDuckGo'], ['bing', 'Bing'], ['brave', 'Brave Search'], ['off', 'Off']]),
        row('cursor', '#0A84FF', 'Focus Search on Open', toggle('autofocusSearch', 'Focus search on open'), { disabledWhen: function () { return !state.settings.showSearch; } }),
        IS_PAGE ? null : row('bookmark', '#FF375F', 'Suggest the Site You’re On', toggle('suggestSite', 'Suggest the site you are on')),
        row('sparkle', '#5E5CE6', 'Splash Screen', toggle('splash', 'Splash screen')),
        row('haptic', '#FF9F0A', 'Haptics', toggle('haptics', 'Haptics')),
        row('motion', '#40C8E0', 'Reduce Motion', (function () {
          var input = h('input', { type: 'checkbox', class: 'switch', role: 'switch', 'aria-label': 'Reduce motion' });
          input.addEventListener('change', function () { haptic(); setSetting({ motion: input.checked ? 'reduced' : 'full' }); });
          updaters.push(function () { input.checked = state.settings.motion === 'reduced'; });
          return input;
        })())),
      h('div', { class: 'group-foot' }, IS_WEB
        ? 'Haptics work on phones that support them. Install Shelf to your home screen for a full-screen app, and share any page to Shelf to add it.'
        : mod + '-click or middle-click opens in the background; Shift-click opens a new window. Right-click any page → “Add Page to Shelf” to add it to Home or a folder. Type “sh” + Space in the address bar to open apps.'),

      todoSettingsRows(),

      h('div', { class: 'group-title' }, 'Apps'),
      h('div', { class: 'group' },
        btnRow('plus', '#30D158', 'Add App', function () { openAppSheet(); }),
        btnRow('folderPlus', '#0A84FF', 'New Folder', newFolderFlow),
        btnRow('pencil', '#FF9F0A', 'Edit & Rearrange', function () {
          if (!state.items.length) { toast('Add an app first'); return; }
          closeSettings(); setTimeout(enterEdit, 250);
        }, { value: appCount })),

      h('div', { class: 'group-title' }, 'Backup & Sync'),
      h('div', { class: 'group' },
        IS_WEB ? null : row('cloud', '#0A84FF', 'Sync Across Devices', syncToggle),
        IS_WEB ? null : btnRow('cloud', '#34C759', 'Sync Now', function () { syncNow(); }, { hiddenWhen: function () { return !Store.hasSync || !state.settings.sync; } }),
        IS_WEB ? webPersistRow() : null,
        btnRow('history', '#5E5CE6', 'Restore Previous Version', openRestoreSheet),
        btnRow('download', '#30D158', 'Export Backup', exportData),
        btnRow('upload', '#FF9F0A', 'Import Backup', importData),
        API && API.permissions ? btnRow('bookmark', '#FF375F', 'Import Bookmarks', importBookmarks) : null,
        btnRow(null, null, 'Reset Everything', resetAll, { danger: true })),
      syncFoot,
      h('div', { class: 'safe-note' }, icon('shield'), h('span', null,
        IS_WEB ? 'Shelf keeps your last 10 versions automatically and asks the browser for protected storage. For the strongest protection, install it to your home screen and export a backup now and then.'
          : 'Your apps live in extension storage, which clearing cache, cookies or history never touches. Shelf also keeps your last 10 versions automatically. Only uninstalling removes local data — keep Sync on or export a backup.')),

      h('div', { class: 'group-title' }, 'Help'),
      h('div', { class: 'group' },
        btnRow('book', '#0A84FF', 'How to Use Shelf', openGuide),
        IS_WEB ? webInstallRow() : null,
        IS_TOUCH ? null : btnRow('keyboard', '#636366', 'Keyboard Shortcuts', showShortcuts),
        btnRow('sparkle', '#BF5AF2', 'Welcome Tour', function () { showWelcome(true); }),
        CONFIG.feedbackUrl ? btnRow('chat', '#30D158', 'Send Feedback', function () { openApp({ name: 'Feedback', url: CONFIG.feedbackUrl }, { forceNew: true }); }, { external: true }) : null),

      h('div', { class: 'group-title' }, 'About'),
      h('div', { class: 'group' },
        row('info', '#8E8E93', 'Version', h('span', { class: 'val' }, VERSION)),
        IS_PAGE ? null : btnRow('expand', '#0A84FF', 'Open in Full Page', openFullPage, { external: true })),
      h('div', { class: 'brand-foot' },
        brandMark(),
        h('div', { class: 'brand-name' }, 'Shelf ' + VERSION),
        h('div', { class: 'made-by' }, 'Made with ', h('span', { class: 'heart', 'aria-label': 'love' }, '♥'), ' by Harsha Varthan E P')));
    settingsEl.append(nav, body);
  }

  function openSettings() {
    if (state.view === 'settings') return;
    closeMenus(); exitEdit();
    state.view = 'settings';
    refreshSyncInfo();
    updateSettings();
    rootEl.classList.add('in-settings');
    settingsEl.setAttribute('aria-hidden', 'false');
    settingsEl.scrollTop = 0;
    try { scroller().scrollTop = 0; } catch (e) { /* ignore */ }
    updateChrome();
    setTimeout(function () { var b = settingsEl.querySelector('.nav-back'); if (b) b.focus({ preventScroll: true }); }, 60);
  }
  function closeSettings() {
    if (state.view !== 'settings') return;
    state.view = 'home';
    rootEl.classList.remove('in-settings');
    settingsEl.setAttribute('aria-hidden', 'true');
    updateChrome();
    setTimeout(function () { if (layers.length) return; if (state.settings.showSearch) searchInput.focus({ preventScroll: true }); else btnSettings.focus({ preventScroll: true }); }, 60);
  }
  function openFullPage() {
    var p = API && API.runtime && API.runtime.openOptionsPage ? call(API.runtime, 'openOptionsPage') : Promise.reject();
    p.then(function () { if (!IS_PAGE) window.close(); }, function () {
      try { window.open(API && API.runtime ? API.runtime.getURL('options.html') : 'options.html', '_blank'); } catch (e) { /* ignore */ }
    });
  }
  function showShortcuts() {
    var mod = IS_MAC ? '⌘' : 'Ctrl', alt = IS_MAC ? '⌥' : 'Alt';
    var rows = [
      ['Search', 'Just type, or /'], ['Open first result', 'Enter'], ['To-Do', alt + ' + T'], ['Open app 1–9', alt + ' + 1–9'],
      ['Open in background', mod + ' + Click'], ['Open in new window', 'Shift + Click'], ['Move between apps', '← ↑ → ↓'],
      ['Make a folder', 'Drag onto an app'], ['Reorder (edit mode)', alt + ' + Arrows'], ['Remove (edit mode)', 'Delete'],
      ['Settings', mod + ' + ,'], ['Back / Close', 'Esc'],
    ].concat(IS_WEB ? [] : [['Open Shelf', IS_MAC ? '⌥⇧S' : 'Alt+Shift+S'], ['Address bar', 'sh + Space']]);
    if (IS_WEB) rows = rows.filter(function (r) { return !/background|new window/i.test(r[0]); });
    dialog({ title: 'Keyboard Shortcuts', body: h('div', { class: 'kbd-list' }, rows.map(function (r) { return h('div', null, h('span', null, r[0]), h('kbd', null, r[1])); })),
      buttons: [{ label: 'Done', value: true, style: 'bold' }] });
  }

  /* ═════════════════════ Data ═════════════════════ */

  function replaceAll(items, settings, msg) {
    if (fv) fv.close(null);
    state.items = items;
    if (settings) state.settings = Core.sanitizeSettings(Object.assign({}, settings, { sync: state.settings.sync }), DEFAULTS);
    iconNodes.clear();
    save(); applyTheme(); setQuery('', true); renderHome(); updateSettings();
    if (msg) toast(msg);
  }
  function exportData() {
    if (IS_FIREFOX && !IS_PAGE) { toast('Opening full page for export…'); setTimeout(openFullPage, 500); return; }
    try {
      var blob = new Blob([JSON.stringify(Core.exportPayload(state.items, state.settings, VERSION, logoData, TD.liveLists(todos).length || TD.liveTasks(todos).length ? todos : null), null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var d = new Date(), stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      var a = h('a', { href: url, download: 'shelf-backup-' + stamp + '.json', style: { display: 'none' } });
      doc.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      toast('Backup downloaded');
    } catch (e) { toast('Export failed'); }
  }
  function importData() {
    if (IS_FIREFOX && !IS_PAGE) { toast('Opening full page for import…'); setTimeout(openFullPage, 500); return; }
    var input = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
    doc.body.appendChild(input);
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      if (f.size > 20 * 1024 * 1024) { toast('That file is too large'); return; }
      var reader = new FileReader();
      reader.onerror = function () { toast('Couldn’t read that file'); };
      reader.onload = function () {
        var parsed;
        try { parsed = Core.parseImport(String(reader.result)); } catch (e) {
          dialog({ title: 'Can’t Import', message: e.message, buttons: [{ label: 'OK', value: true, style: 'bold' }] });
          return;
        }
        var n = parsed.apps.length, nf = Core.countFolders(parsed.items);
        var msg = 'Found ' + plural(n, 'app') + (nf ? ' in ' + plural(nf, 'folder') : '') + (parsed.todoCount ? ' and ' + plural(parsed.todoCount, 'to-do') : '') + (parsed.skipped ? ' (' + parsed.skipped + ' invalid skipped)' : '') + '.' +
          (state.items.length ? '\nMerge adds new ones to your shelf. Replace swaps everything' + (parsed.settings ? ', including settings' : '') + '.' : '');
        var buttons = state.items.length
          ? [{ label: 'Merge', value: 'merge', style: 'bold' }, { label: 'Replace', value: 'replace', style: 'destructive' }, { label: 'Cancel', value: null }]
          : [{ label: 'Cancel', value: null }, { label: 'Import', value: 'replace', style: 'bold' }];
        dialog({ title: 'Import Backup?', message: msg, buttons: buttons }).then(function (choice) {
          if (!choice) return;
          snapshot('Before import').then(function () {
            if (parsed.todos) commitTodos(choice === 'merge' ? TD.importInto(todos, parsed.todos) : TD.importInto(TD.wipe(todos), parsed.todos));
            if (choice === 'merge') {
              var added = mergeItems(parsed.items);
              replaceAll(state.items, null, added ? 'Added ' + plural(added, 'app') : parsed.todoCount ? 'To-dos imported' : 'Everything was already on your shelf');
            } else replaceAll(parsed.items.length || !parsed.todoCount ? parsed.items : state.items, parsed.settings, 'Imported ' + plural(n, 'app') + (parsed.todoCount ? ' and ' + plural(parsed.todoCount, 'to-do') : ''));
          });
        });
      };
      reader.readAsText(f);
    });
    input.click();
  }
  /* Merges folders by name, skips duplicate URLs, respects limits. Returns # of apps added. */
  function mergeItems(incoming) {
    var added = 0;
    function has(url) { return Core.flatten(state.items).some(function (e) { return Core.sameUrl(e.app.url, url); }); }
    function room() { return totalApps() < Core.LIMITS.apps; }
    incoming.forEach(function (it) {
      if (isFolder(it)) {
        var fresh = it.apps.filter(function (a) { return !has(a.url); });
        if (!fresh.length) return;
        var target = folders().find(function (f) { return f.name.toLowerCase() === it.name.toLowerCase(); }) || createFolder(it.name);
        if (!target) { fresh.forEach(function (a) { if (room()) { a.id = Core.uid(); state.items.push(a); added++; } }); return; }
        fresh.forEach(function (a) { if (room() && !has(a.url)) { a.id = Core.uid(); target.apps.push(a); added++; } });
      } else if (!has(it.url) && room()) { it.id = Core.uid(); state.items.push(it); added++; }
    });
    return added;
  }
  function resetAll() {
    dialog({ title: 'Reset Everything?', message: 'This removes all your apps, folders and to-dos and restores default settings. A copy is kept in Restore Previous Version.',
      buttons: [{ label: 'Cancel', value: null, style: 'bold' }, { label: 'Reset', value: true, style: 'destructive' }] }).then(function (ok) {
      if (!ok) return;
      snapshot('Before reset').then(function () {
        iconMem.clear();
        wallPhoto = null;
        Store.local.remove([Store.KEYS.wallpaperImg]).catch(function () {});
        commitTodos(TD.wipe(todos));
        replaceAll(seedItems(), Core.sanitizeSettings({ onboarded: true }, DEFAULTS), 'Shelf has been reset');
      });
    });
  }
  function openRestoreSheet() {
    Promise.all([Store.getSnapshots(), Store.readSync()]).then(function (r) {
      var snaps = r[0], sb = r[1];
      var list = h('div', { class: 'group' });
      var shell;
      function restoreRow(title, sub, getItems, settings, todoState) {
        var b = h('button', { type: 'button', class: 'srow btn-row restore-row' },
          h('span', { class: 'meta' }, h('span', { class: 'name' }, title), h('span', { class: 'host' }, sub)), icon('chevR', 'chev'));
        b.addEventListener('click', function () {
          dialog({ title: 'Restore This Version?', message: 'Your current apps will be replaced. A copy of them is saved first, so you can switch back.',
            buttons: [{ label: 'Cancel', value: null }, { label: 'Restore', value: true, style: 'bold' }] }).then(function (ok) {
            if (!ok) return;
            snapshot('Before restore').then(function () { shell.close(true); if (todoState) commitTodos(TD.importInto(TD.wipe(todos), todoState)); replaceAll(getItems(), settings, 'Restored'); });
          });
        });
        list.appendChild(b);
      }
      var syncCount = sb ? Core.countApps(Core.mergeSynced(sb.compact, [])) + Core.countFolders(Core.mergeSynced(sb.compact, [])) : 0;
      if (sb && syncCount) {
        var n = Core.countApps(Core.mergeSynced(sb.compact, []));
        restoreRow('Browser Sync', ago(sb.at) + ' · ' + plural(n, 'app'), function () { return Core.mergeSynced(sb.compact, state.items); }, sb.settings);
      }
      snaps.forEach(function (s) {
        restoreRow(s.reason || 'Automatic', ago(s.at) + ' · ' + plural(s.apps || 0, 'app') + (s.folders ? ', ' + plural(s.folders, 'folder') : '') + (s.todos ? ', ' + plural(s.todos, 'to-do') : ''),
          function () { return Core.sanitizeItems(s.items); }, s.settings, s.todoState || null);
      });
      shell = sheetShell({
        title: 'Restore', left: 'Close',
        body: list.children.length
          ? [h('p', { class: 'sheet-note' }, 'Shelf saves a version every few hours and before big changes like reset, import and deleting folders.'), list]
          : h('p', { class: 'sheet-note' }, 'No previous versions yet. Shelf saves one automatically every few hours and before big changes.'),
      });
    });
  }

  function importBookmarks() {
    if (!API || !API.permissions) { toast('Bookmarks aren’t available here'); return; }
    if (IS_FIREFOX && !IS_PAGE) { toast('Opening full page…'); setTimeout(openFullPage, 500); return; }
    call(API.permissions, 'request', { permissions: ['bookmarks'] }).then(function (granted) {
      if (!granted) { toast('Permission is needed to read bookmarks'); return; }
      var bm = (g.browser && g.browser.bookmarks) || (g.chrome && g.chrome.bookmarks);
      return call(bm, 'getTree').then(showBookmarkPicker);
    }).catch(function (e) { console.warn(e); toast('Couldn’t read bookmarks'); });
  }
  function showBookmarkPicker(tree) {
    function links(node) { var out = []; (function walk(n) { (n.children || []).forEach(function (c) { if (c.url) out.push(c); else walk(c); }); })(node); return out; }
    var options = [];
    (function walk(nodes, depth, path) {
      (nodes || []).forEach(function (n) {
        if (n.url || !n.children) return;
        var title = n.title || (depth === 0 ? 'Bookmarks' : 'Folder');
        var count = links(n).length;
        if (depth > 0 && count) options.push({ node: n, title: title, path: path, count: count, subs: n.children.filter(function (c) { return !c.url && links(c).length; }).length });
        if (depth < 3) walk(n.children, depth + 1, depth > 0 ? (path ? path + ' › ' : '') + title : '');
      });
    })(tree, 0, '');
    var chosen = null, shell;
    var list = h('div', { class: 'group picker-list', role: 'radiogroup' });
    options.forEach(function (o) {
      var r = h('button', { type: 'button', class: 'pick-row radio', role: 'radio', 'aria-checked': 'false' },
        h('span', { class: 'check' }, icon('check')), h('span', { class: 'sicon', style: { '--c': '#FF9F0A' } }, icon('folder')),
        h('span', { class: 'meta' }, h('span', { class: 'name' }, o.title), h('span', { class: 'host' },
          (o.path ? o.path + ' · ' : '') + plural(o.count, 'link') + (o.subs ? ', ' + plural(o.subs, 'subfolder') : ''))));
      r.addEventListener('click', function () {
        chosen = o;
        Array.prototype.forEach.call(list.children, function (c) { c.setAttribute('aria-checked', String(c === r)); });
        shell.right.disabled = false;
      });
      list.appendChild(r);
    });
    shell = sheetShell({
      title: 'Import Bookmarks',
      onClose: function () { call(API.permissions, 'remove', { permissions: ['bookmarks'] }).catch(function () {}); },
      right: { label: 'Import', disabled: true, onClick: function (close) {
        if (!chosen) return;
        var items = [];
        (chosen.node.children || []).forEach(function (c) {
          if (c.url) items.push({ name: c.title, url: c.url });
          else if (c.children) { var ls = links(c); if (ls.length) items.push({ type: 'folder', name: c.title || 'Folder', apps: ls.map(function (l) { return { name: l.title, url: l.url }; }) }); }
        });
        var clean = Core.sanitizeItems(items);
        close(true);
        snapshot('Before bookmark import').then(function () {
          var added = mergeItems(clean);
          replaceAll(state.items, null, added ? 'Imported ' + plural(added, 'app') : 'Nothing new to import');
        });
      } },
      body: options.length ? [h('p', { class: 'sheet-note' }, 'Links become apps and subfolders become Shelf folders. Duplicates are skipped. Shelf gives the bookmarks permission back when you’re done.'), list]
        : h('p', { class: 'sheet-note' }, 'No bookmark folders with links were found.'),
    });
  }

  /* ═════════════════════ Grid interactions (home + folder) ═════════════════════ */

  /* Arrow keys on row-by-row horizontal pages; Left/Right cross into the neighbouring page. */
  function pageStep(i, key, st) {
    var cols = st.cols, per = st.rows * cols, k = i % per, page = (i - k) / per, r = Math.floor(k / cols), c = k % cols;
    if (key === 'ArrowLeft') return c > 0 ? -1 : page > 0 ? ((page - 1) * per + r * cols + cols - 1) - i : 0;
    if (key === 'ArrowRight') return c < cols - 1 ? 1 : ((page + 1) * per + r * cols) - i;
    if (key === 'ArrowUp') return r > 0 ? -cols : 0;
    return r < st.rows - 1 ? cols : 0;
  }
  function stepInfo() {
    var s = state.settings;
    if (s.orientation === 'horizontal') return { horizontal: true, rows: s.rows, cols: s.view === 'grid' ? visCols() : hListCols() };
    return { horizontal: false, cols: s.view === 'list' ? effListCols() : effCols() };
  }
  var homeCtx = {
    kind: 'home', container: appsEl,
    list: function () { return state.items; },
    editing: function () { return state.editing; },
    enterEdit: enterEdit,
    step: stepInfo,
    scroller: scroller,
  };

  var drag = null, suppressClick = false, autoRaf = 0;

  function bindGrid(container, ctx) {
    container.addEventListener('click', function (e) {
      var item = e.target.closest('.app');
      if (!item || !container.contains(item)) return;
      e.preventDefault();
      if (suppressClick) { suppressClick = false; return; }
      var l = locate(item.dataset.id);
      if (!l) return;
      if (e.target.closest('.del')) { if (isFolder(l.entry)) deleteFolder(l.entry); else removeApp(l.entry, item); return; }
      if (isFolder(l.entry)) { openFolderView(l.entry, item); return; }
      if (ctx.editing()) { openAppSheet(l.entry); return; }
      haptic();
      openApp(l.entry, { background: e.metaKey || e.ctrlKey || state.settings.openIn === 'background', newWindow: e.shiftKey, forceNew: e.metaKey || e.ctrlKey });
    });
    container.addEventListener('auxclick', function (e) {
      if (e.button !== 1) return;
      var item = e.target.closest('.app');
      if (!item) return;
      e.preventDefault();
      var l = locate(item.dataset.id);
      if (!l || ctx.editing()) return;
      if (isFolder(l.entry)) openAll(l.entry); else openApp(l.entry, { background: true });
    });
    container.addEventListener('mousedown', function (e) { if (e.button === 1) e.preventDefault(); });
    container.addEventListener('dragstart', function (e) { e.preventDefault(); });
    container.addEventListener('contextmenu', function (e) {
      var item = e.target.closest('.app');
      if (!item) return;
      e.preventDefault();
      if (drag || lastPointerType === 'touch' || lastPointerType === 'pen') return;
      var l = locate(item.dataset.id);
      if (!l) return;
      var x = e.clientX, y = e.clientY;
      if (!x && !y) { var r = item.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
      itemMenu(l.entry, item, x, y);
    });
    container.addEventListener('pointerdown', function (e) { onPointerDown(e, ctx); });
  }

  var lastPointerType = 'mouse', pressActive = false;
  function onPointerDown(e, ctx) {
    lastPointerType = e.pointerType || 'mouse';
    if (e.button !== 0 || (ctx.kind === 'home' && state.query) || drag) return;
    var item = e.target.closest('.app');
    if (!item || e.target.closest('.del')) return;
    var touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (ctx.editing()) e.preventDefault();
    var p = { ctx: ctx, item: item, x0: e.clientX, y0: e.clientY, id: e.pointerId, timer: 0, armed: ctx.editing(), started: false, last: e, menu: null };
    if (ctx.editing()) pressActive = true;
    if (!ctx.editing()) {
      p.timer = setTimeout(function () {
        haptic('heavy');
        pressActive = true;
        p.armed = true;
        suppressClick = true;
        if (touch) {
          var l = locate(item.dataset.id);
          if (l) { item.classList.add('pressed'); p.menu = itemMenu(l.entry, item, p.x0 - 60, p.y0 + 16); }
          return;
        }
        ctx.enterEdit();
        var fresh = ctx.container.querySelector('.app[data-id="' + item.dataset.id + '"]');
        if (fresh) p.item = fresh;
        startDrag(p);
      }, 480);
    }
    function onMove(ev) {
      if (ev.pointerId !== p.id) return;
      p.last = ev;
      if (p.started) { moveDrag(ev); return; }
      var dist = Math.hypot(ev.clientX - p.x0, ev.clientY - p.y0);
      if (p.menu && dist > 10) {                       // long-press menu open → finger moves → rearrange
        closeMenus(); p.menu = null; item.classList.remove('pressed');
        ctx.enterEdit();
        var fresh = ctx.container.querySelector('.app[data-id="' + item.dataset.id + '"]');
        if (fresh) p.item = fresh;
        startDrag(p);
        return;
      }
      if (!p.menu && dist > 6) { if (p.armed) startDrag(p); else cleanup(); }
    }
    function onUp(ev) {
      if (ev.pointerId !== p.id) return;
      cleanup(); item.classList.remove('pressed');
      if (p.started) endDrag();
      else if (p.armed) setTimeout(function () { suppressClick = false; }, 350);
    }
    function cleanup() {
      clearTimeout(p.timer);
      pressActive = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }
  // Keep the page from scrolling while a long-press / drag is in progress on touch screens.
  doc.addEventListener('touchmove', function (e) { if (drag || pressActive) e.preventDefault(); }, { passive: false });

  function startDrag(p) {
    if (p.started || !p.item.isConnected || drag) return;
    p.started = true;
    suppressClick = true;
    var container = p.ctx.container;
    var items = Array.prototype.slice.call(container.children);
    var ar = container.getBoundingClientRect();
    var slots = items.map(function (el) {
      var r = el.getBoundingClientRect();
      return { l: r.left - ar.left + container.scrollLeft, t: r.top - ar.top + container.scrollTop, w: r.width, h: r.height };
    });
    var r = p.item.getBoundingClientRect();
    var ghost = p.item.cloneNode(true);
    ghost.classList.add('ghost');
    ghost.removeAttribute('href');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.left = r.left + 'px'; ghost.style.top = r.top + 'px';
    ghost.style.width = r.width + 'px'; ghost.style.height = r.height + 'px';
    doc.body.appendChild(ghost);
    p.item.classList.add('placeholder');
    drag = { ctx: p.ctx, container: container, item: p.item, ghost: ghost, slots: slots, dx: p.x0 - r.left, dy: p.y0 - r.top, gx: r.left, gy: r.top,
      index: items.indexOf(p.item), px: p.x0, py: p.y0, isFolder: p.item.dataset.kind === 'folder', mergeEl: null, mergeTimer: 0, mergeReady: false, outside: false, pendingTarget: -1, reorderTimer: 0 };
    html.classList.add('dragging');
    moveDrag(p.last);
    autoScroll();
  }
  function clearMerge() {
    var d = drag;
    if (!d) return;
    clearTimeout(d.mergeTimer);
    if (d.mergeEl) d.mergeEl.classList.remove('merge-target');
    d.ghost.classList.remove('merging');
    d.mergeEl = null; d.mergeReady = false;
  }
  function moveDrag(ev) {
    var d = drag;
    if (!d) return;
    d.px = ev.clientX; d.py = ev.clientY;
    d.ghost.style.transform = 'translate(' + (ev.clientX - d.dx - d.gx) + 'px,' + (ev.clientY - d.dy - d.gy) + 'px)';

    if (d.ctx.kind === 'folder' && fv) {
      var pr = fv.panel.getBoundingClientRect(), m = 14;
      var out = ev.clientX < pr.left - m || ev.clientX > pr.right + m || ev.clientY < pr.top - m || ev.clientY > pr.bottom + m;
      if (out !== d.outside) { d.outside = out; fv.view.classList.toggle('drop-out', out); }
      if (out) return;
    }
    var container = d.container, ar = container.getBoundingClientRect();
    var px = ev.clientX - ar.left + container.scrollLeft, py = ev.clientY - ar.top + container.scrollTop;
    var target = -1, best = Infinity;
    d.slots.forEach(function (s, i) { if (px >= s.l && px <= s.l + s.w && py >= s.t && py <= s.t + s.h) { target = i; best = -1; } });
    if (target < 0) d.slots.forEach(function (s, i) { var dist = Math.hypot(px - (s.l + s.w / 2), py - (s.t + s.h / 2)); if (dist < best) { best = dist; target = i; } });
    var el = container.children[target];

    // Make a folder: hold an app over another app or folder (icon view, home screen)
    var mergeable = d.ctx.kind === 'home' && !d.isFolder && state.settings.view === 'grid';
    if (mergeable && el && el !== d.item) {
      var ic = el.querySelector('.icon');
      if (ic) {
        var r = ic.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (Math.abs(ev.clientX - cx) < r.width * 0.36 && Math.abs(ev.clientY - cy) < r.height * 0.36) {
          clearTimeout(d.reorderTimer); d.pendingTarget = -1;
          if (d.mergeEl !== el) {
            clearMerge();
            d.mergeEl = el;
            d.mergeTimer = setTimeout(function () {
              if (drag === d && d.mergeEl === el) { el.classList.add('merge-target'); d.ghost.classList.add('merging'); d.mergeReady = true; }
            }, 300);
          }
          return;
        }
      }
    }
    clearMerge();
    if (target >= 0 && target !== d.index && el && el !== d.item) {
      if (!mergeable) { reorderTo(d, target); return; }
      // Short dwell so passing over an icon's edge on the way to its centre doesn't shuffle it away.
      if (d.pendingTarget !== target) {
        clearTimeout(d.reorderTimer);
        d.pendingTarget = target;
        d.reorderTimer = setTimeout(function () { if (drag === d && d.pendingTarget === target) reorderTo(d, target); }, 150);
      }
    } else { clearTimeout(d.reorderTimer); d.pendingTarget = -1; }
  }
  function reorderTo(d, target) {
    var el = d.container.children[target];
    d.pendingTarget = -1;
    if (!el || el === d.item || target === d.index) return;
    var from = d.index;
    flip(d.container, function () { if (target > from) el.after(d.item); else el.before(d.item); if (d.container === appsEl) placeItems(appsEl, state.settings.orientation === 'horizontal'); });
    d.index = target;
  }
  function autoScroll() {
    cancelAnimationFrame(autoRaf);
    if (!drag) return;
    var d = drag, speed = 0;
    if (d.ctx.kind === 'home' && state.settings.orientation === 'horizontal') {
      var ar = appsEl.getBoundingClientRect();
      if (d.px < ar.left + 30) speed = -8; else if (d.px > ar.right - 30) speed = 8;
      if (speed) { appsEl.scrollLeft += speed; moveDrag({ clientX: d.px, clientY: d.py }); }
    } else {
      var sc = d.ctx.scroller();
      var box = d.ctx.kind === 'folder' || IS_PAGE ? sc.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      if (d.py < box.top + (d.ctx.kind === 'home' ? 70 : 24)) speed = -8; else if (d.py > box.bottom - 24) speed = 8;
      if (speed && !d.outside) {
        var before = sc.scrollTop;
        sc.scrollTop += speed;
        if (sc.scrollTop !== before) moveDrag({ clientX: d.px, clientY: d.py });
      }
    }
    autoRaf = requestAnimationFrame(autoScroll);
  }
  function endDrag() {
    var d = drag;
    drag = null;
    cancelAnimationFrame(autoRaf);
    html.classList.remove('dragging');
    if (!d) return;
    clearTimeout(d.mergeTimer); clearTimeout(d.reorderTimer);
    var id = d.item.dataset.id;
    function dropGhost(fade) {
      if (fade || !d.item.isConnected) {
        d.ghost.style.transition = 'transform .22s ease, opacity .22s ease';
        d.ghost.style.opacity = '0';
        d.ghost.style.transform += ' scale(.6)';
      } else {
        var r = d.item.getBoundingClientRect();
        d.ghost.classList.add('landing');
        d.ghost.style.transition = 'transform .26s cubic-bezier(.32,.72,0,1)';
        d.ghost.style.transform = 'translate(' + (r.left - d.gx) + 'px,' + (r.top - d.gy) + 'px)';
      }
      setTimeout(function () { d.ghost.remove(); d.item.classList.remove('placeholder'); }, REDUCED ? 0 : 250);
    }
    setTimeout(function () { suppressClick = false; }, 400);

    if (d.ctx.kind === 'folder' && d.outside) {
      dropGhost(true);
      if (fv) { fv.view.classList.remove('drop-out'); fv.close(null); }
      moveApp(id, null);
      return;
    }
    if (d.mergeReady && d.mergeEl) {
      var targetId = d.mergeEl.dataset.id;
      d.mergeEl.classList.remove('merge-target');
      dropGhost(true);
      mergeInto(id, targetId);
      return;
    }
    dropGhost(false);
    var list = d.ctx.list();
    var map = new Map(list.map(function (a) { return [a.id, a]; }));
    var next = Array.prototype.map.call(d.container.children, function (el) { return map.get(el.dataset.id); }).filter(Boolean);
    if (next.length === list.length && next.some(function (a, i) { return a !== list[i]; })) {
      list.splice.apply(list, [0, list.length].concat(next));
      save();
      if (d.ctx.kind === 'folder') setTimeout(renderHome, 260); // refresh the folder tile preview
    }
    if (pendingRender) { pendingRender = false; setTimeout(renderHome, 260); }
  }

  function moveByKey(item, key, ctx) {
    var l = locate(item.dataset.id);
    if (!l) return;
    var st = ctx.step(), delta;
    if (st.horizontal) delta = pageStep(l.index, key, st);
    else if (!st.horizontal) delta = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -st.cols : st.cols;
    var j = Core.clamp(l.index + delta, 0, l.list.length - 1);
    if (j === l.index) return;
    flip(ctx.container, function () { l.list.splice(l.index, 1); l.list.splice(j, 0, l.entry); renderHome(); });
    save();
    var el = ctx.container.querySelector('[data-id="' + l.entry.id + '"]');
    if (el) el.focus();
  }
  function navigate(item, key, ctx) {
    var items = Array.prototype.slice.call(ctx.container.children);
    var i = items.indexOf(item), st = ctx.step(), delta;
    if (st.horizontal) delta = pageStep(i, key, st);
    else if (!st.horizontal) delta = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -st.cols : st.cols;
    var j = i + delta;
    if (j < 0) { if (ctx.kind === 'home' && state.settings.showSearch) searchInput.focus(); return; }
    if (j >= items.length) j = items.length - 1;
    if (items[j]) { items[j].focus(); if (items[j].scrollIntoView) items[j].scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  function gridKeys(e, ctx) {
    var item = e.target.closest && e.target.closest('.app');
    if (!item || !ctx.container.contains(item)) return false;
    if (/^Arrow/.test(e.key)) {
      e.preventDefault();
      if (e.altKey && ctx.editing()) moveByKey(item, e.key, ctx); else navigate(item, e.key, ctx);
      return true;
    }
    if (ctx.editing() && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      var l = locate(item.dataset.id);
      if (!l) return true;
      if (isFolder(l.entry)) { deleteFolder(l.entry); return true; }
      var nextEl = item.nextElementSibling || item.previousElementSibling;
      removeApp(l.entry, item);
      if (nextEl) setTimeout(function () { if (nextEl.isConnected) nextEl.focus(); }, 260);
      return true;
    }
    return false;
  }
  bindGrid(appsEl, homeCtx);

  /* ═════════════════════ Global events ═════════════════════ */

  searchInput.addEventListener('input', function () { setQuery(searchInput.value); });
  searchClear.addEventListener('click', function () { setQuery(''); searchInput.focus(); });
  btnAdd.addEventListener('click', addMenu);
  btnSettings.addEventListener('click', openSettings);
  btnDone.addEventListener('click', exitEdit);
  homeEl.addEventListener('click', function (e) { if (state.editing && !e.target.closest('.app') && !e.target.closest('.topbar') && !e.target.closest('.dock')) exitEdit(); });
  doc.addEventListener('click', function (e) { if (fv && fv.editing && fv.panel.contains(e.target) && !e.target.closest('.app')) folderExitEdit(); });

  doc.addEventListener('keydown', function (e) {
    if (e.isComposing) return;
    var top = topLayer();
    if (top) {
      if (e.key === 'Escape') { e.preventDefault(); if (top.onEscape) top.onEscape(); else top.close(null); return; }
      if (top.kind === 'folder' && fv && !(e.target.matches && e.target.matches('input')) && gridKeys(e, fv.ctx)) return;
      if (e.key === 'Tab' && top.kind !== 'menu') trapFocus(e, top.layer);
      return;
    }
    if (state.view === 'settings') { if (e.key === 'Escape') { e.preventDefault(); closeSettings(); } return; }
    var inSearch = e.target === searchInput;
    var isField = e.target.matches && e.target.matches('input, textarea, select, [contenteditable]');
    if (e.key === 'Escape') {
      if (drag) return;
      e.preventDefault();
      if (state.editing) { exitEdit(); return; }
      if (state.query) { setQuery(''); searchInput.focus(); return; }
      if (!IS_PAGE) window.close();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); return; }
    if (e.altKey && !e.metaKey && !e.ctrlKey && (e.code === 'KeyT')) { e.preventDefault(); openTodos(defaultListId() || 'today', { focusAdd: true }); return; }
    if (e.altKey && !e.metaKey && !e.ctrlKey && /^Digit[1-9]$/.test(e.code || '')) {
      var nth = homeDisplay()[Number(e.code.slice(5)) - 1];
      if (nth) {
        e.preventDefault();
        if (isFolder(nth)) openFolderView(nth, appsEl.querySelector('[data-id="' + nth.id + '"]')); else openApp(nth, { background: e.shiftKey });
      }
      return;
    }
    if (inSearch) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var first = homeDisplay()[0], q = state.query.trim();
        var bg = e.metaKey || e.ctrlKey || state.settings.openIn === 'background';
        if (first && isFolder(first)) openFolderView(first, appsEl.querySelector('[data-id="' + first.id + '"]'));
        else if (first) openApp(first, { background: bg, newWindow: e.shiftKey });
        else if (q && Core.normalizeUrl(q).ok && /[.:]/.test(q) && !/\s/.test(q)) openAppSheet(null, { url: q });
        else if (q) webSearch(q, { background: bg, newWindow: e.shiftKey });
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        var f = appsEl.querySelector('.app');
        if (f) f.focus();
      }
      return;
    }
    if (isField) return;
    if (gridKeys(e, homeCtx)) return;
    if (!state.editing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === '/' || (e.key.length === 1 && /\S/.test(e.key)))) {
      if (e.key === '/') e.preventDefault();
      topbar.classList.remove('search-off');
      searchInput.focus();
    }
  });

  /* ═════════════════════ Storage events & sync ═════════════════════ */

  var reloadTimer = 0;
  function reloadFromStorage() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function () {
      if (drag || layers.some(function (l) { return l.kind === 'sheet'; })) { reloadFromStorage(); return; }
      Store.load(DEFAULTS, seedItems, VIEW_ID).then(function (st) {
        state.items = st.items;
        state.settings = st.settings;
        state.updatedAt = st.meta ? st.meta.updatedAt : 0;
        state.rev = st.meta ? st.meta.rev : null;
        if (fv && !fv.folder) fv.close(null);
        iconNodes.clear();
        applyTheme(); renderHome(); updateSettings();
      });
    }, 80);
  }
  function requestSync() {
    call(API.runtime, 'sendMessage', { type: 'shelf:sync' }).catch(function () { Store.writeSync(state.items, state.settings); });
  }
  function applyRemote(sb) {
    snapshot('Before sync update').then(function () {
      state.items = Core.mergeSynced(sb.compact, state.items);
      if (sb.settings) state.settings = Core.sanitizeSettings(Object.assign({}, sb.settings, { sync: state.settings.sync }), DEFAULTS);
      if (fv) fv.close(null);
      iconNodes.clear();
      save({ noSync: true });
      applyTheme(); renderHome(); updateSettings();
      toast('Updated from your other device');
    });
  }
  function checkRemote() {
    if (!Store.hasSync || !state.settings.sync || !API) return;
    Store.reconcile(DEFAULTS).then(function (r) {
      refreshSyncInfo();
      if (r.action === 'applied') toast('Updated from your other device');
      else if (r.action === 'merged') toast('Merged apps from your other devices');
    });
  }
  if (API && API.storage && API.storage.onChanged) {
    API.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local' && changes[Store.KEYS.meta]) {
        var nv = changes[Store.KEYS.meta].newValue;
        if (!nv || nv.origin !== VIEW_ID) reloadFromStorage();
      }
      if (area === 'local' && changes[Store.KEYS.syncState]) { syncInfo = changes[Store.KEYS.syncState].newValue || null; updateSettings(); }
      if (area === 'local' && changes[Store.KEYS.todos] && todosReady) reloadTodos();
      /* sync-area changes are reconciled by the background worker; its local write reloads this view */
    });
  } else {
    window.addEventListener('storage', function (e) { if (e.key === Store.KEYS.meta) reloadFromStorage(); if (e.key === Store.KEYS.todos && todosReady) reloadTodos(); });
  }
  window.addEventListener('online', function () { iconMem.clear(); });

  /* ═════════════════════ To-Do ═════════════════════
   * Lists live as coloured dots on the home screen. A dot opens that list in a modal.
   * Tasks: natural-language quick add, due date & time, reminders, snooze, repeat, priority, notes,
   * drag to reorder, swipe to delete (touch), undo for everything destructive.
   */
  var TD = window.ShelfTodos;
  var todos = TD.empty(), todosReady = false, tdm = null;
  var lastListKey = 'shelf.todoLastList';
  function lastList() { try { return localStorage.getItem(lastListKey) || ''; } catch (e) { return ''; } }
  function rememberList(id) { try { localStorage.setItem(lastListKey, id); } catch (e) { /* ignore */ } }
  function listById(id) { return TD.liveLists(todos).filter(function (l) { return l.id === id; })[0] || null; }
  function taskById(id) { return TD.liveTasks(todos).filter(function (t) { return t.id === id; })[0] || null; }
  function defaultListId() { var l = listById(lastList()) || TD.liveLists(todos)[0]; return l ? l.id : null; }

  function commitTodos(next, opts) {
    opts = opts || {};
    todos = TD.sanitize(next);
    Store.saveTodos(todos, { origin: VIEW_ID }).catch(function () { toast('Couldn’t save your to-dos'); });
    if (API && API.runtime) call(API.runtime, 'sendMessage', { type: 'shelf:todos' }).catch(function () {});
    afterTodosChanged(opts);
  }
  function afterTodosChanged(opts) {
    renderTodoDots();
    if (tdm && !(opts && opts.keepModal)) tdm.render();
    updateAppBadge();
    scheduleTodoCheck();
    updateSettings();
  }
  function reloadTodos() {
    Store.getTodos().then(function (st) {
      if (TD.equal(st, todos)) return;
      todos = st;
      afterTodosChanged();
    });
  }

  /* ───── Home: one coloured dot per list ───── */
  var todoDotsEl = h('div', { class: 'todo-dots', role: 'group', 'aria-label': 'To-do lists', hidden: true });
  btnAdd.parentNode.insertBefore(todoDotsEl, btnAdd);
  function renderTodoDots() {
    var lists = TD.liveLists(todos), show = todosReady && state.settings.todoHome && lists.length > 0;
    todoDotsEl.hidden = !show;
    if (!show) { todoDotsEl.textContent = ''; return; }
    var now = Date.now(), c = TD.counts(todos, now), MAXD = IS_PAGE && window.innerWidth >= 600 ? 8 : 5;
    var sig = JSON.stringify([lists.map(function (l) { return [l.id, l.color, l.name]; }), c.lists, c.overdue, MAXD]);
    if (todoDotsEl.dataset.sig === sig) return;
    todoDotsEl.dataset.sig = sig;
    todoDotsEl.textContent = '';
    lists.slice(0, MAXD).forEach(function (l) {
      var lc = c.lists[l.id] || { open: 0, overdue: 0, today: 0 };
      var label = l.name + ' — ' + (lc.open ? plural(lc.open, 'to-do') : 'nothing to do') + (lc.overdue ? ', ' + lc.overdue + ' overdue' : '');
      todoDotsEl.appendChild(h('button', { type: 'button', class: 'tdot' + (lc.open ? '' : ' empty') + (lc.overdue ? ' due' : ''), style: { '--c': l.color },
        'data-id': l.id, title: label, 'aria-label': label }, h('i')));
    });
    if (lists.length > MAXD) todoDotsEl.appendChild(h('button', { type: 'button', class: 'tdot more', title: 'All lists', 'aria-label': 'All lists', 'data-id': '' }, '+' + (lists.length - MAXD)));
    if (c.overdue) todoDotsEl.appendChild(h('span', { class: 'tbadge', 'aria-label': c.overdue + ' overdue' }, c.overdue > 99 ? '99+' : String(c.overdue)));
  }
  todoDotsEl.addEventListener('click', function (e) {
    var b = e.target.closest('.tdot');
    if (!b) return;
    haptic();
    openTodos(b.dataset.id || 'today');
  });
  todoDotsEl.addEventListener('contextmenu', function (e) {
    var b = e.target.closest('.tdot');
    if (!b || !b.dataset.id) return;
    e.preventDefault();
    listMenu(b.dataset.id, e.clientX, e.clientY);
  });
  (function () {
    var pressT = 0;
    todoDotsEl.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch') return;
      var b = e.target.closest('.tdot');
      if (!b || !b.dataset.id) return;
      pressT = setTimeout(function () { haptic('heavy'); suppressDotClick = true; var r = b.getBoundingClientRect(); listMenu(b.dataset.id, r.left, r.bottom + 6); }, 500);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { todoDotsEl.addEventListener(ev, function () { clearTimeout(pressT); }); });
  })();
  var suppressDotClick = false;
  todoDotsEl.addEventListener('click', function (e) { if (suppressDotClick) { suppressDotClick = false; e.stopImmediatePropagation(); } }, true);

  function listMenu(id, x, y) {
    var l = listById(id);
    if (!l) return;
    showMenu(x, y, [
      { label: 'Open', icon: 'checklist', run: function () { openTodos(id); } },
      { label: 'Rename…', icon: 'pencil', run: function () { renameList(id); } },
      { label: 'Change Color…', icon: 'drop', run: function () { pickListColor(id); } },
      '-',
      { label: 'New List…', icon: 'plus', run: function () { newList(); } },
      '-',
      { label: 'Delete List…', icon: 'trash', danger: true, run: function () { deleteList(id); } },
    ], { title: l.name });
  }
  function newList(then) {
    if (TD.liveLists(todos).length >= TD.LIMITS.lists) { toast('You’ve reached the list limit'); return; }
    promptDialog({ title: 'New List', message: 'Lists show as coloured dots on your home screen.', placeholder: 'List name', value: TD.liveLists(todos).length ? '' : 'To-Do', confirm: 'Create' }).then(function (name) {
      if (name == null) return;
      var r = TD.addList(todos, name || 'To-Do');
      if (!r.list) return;
      commitTodos(r.state);
      rememberList(r.list.id);
      haptic('success');
      if (then) then(r.list); else openTodos(r.list.id, { focusAdd: true });
    });
  }
  function renameList(id) {
    var l = listById(id);
    if (!l) return;
    promptDialog({ title: 'Rename List', value: l.name, confirm: 'Rename' }).then(function (name) {
      if (!name) return;
      commitTodos(TD.updateList(todos, id, { name: name }).state);
    });
  }
  function pickListColor(id) {
    var l = listById(id);
    if (!l) return;
    var cur = l.color;
    var grid = h('div', { class: 'td-swatches', role: 'radiogroup', 'aria-label': 'Color' });
    function paint() { Array.prototype.forEach.call(grid.children, function (b) { if (b.dataset.c) b.setAttribute('aria-checked', String(b.dataset.c === cur)); }); }
    TD.COLORS.forEach(function (c) {
      grid.appendChild(h('button', { type: 'button', class: 'td-sw', role: 'radio', 'data-c': c, style: { '--c': c }, 'aria-label': c, onclick: function () { cur = c; haptic(); paint(); commitTodos(TD.updateList(todos, id, { color: c }).state); } }));
    });
    var custom = h('input', { type: 'color', class: 'td-sw custom', value: cur, 'aria-label': 'Custom color' });
    custom.addEventListener('input', function () { cur = custom.value.toUpperCase(); paint(); });
    custom.addEventListener('change', function () { commitTodos(TD.updateList(todos, id, { color: custom.value }).state); });
    grid.appendChild(custom);
    paint();
    dialog({ title: 'List Color', message: l.name, body: grid, buttons: [{ label: 'Done', value: true, style: 'bold' }] });
  }
  function deleteList(id) {
    var l = listById(id);
    if (!l) return;
    var n = TD.liveTasks(todos, id).length;
    dialog({ title: 'Delete “' + l.name + '”?', message: n ? 'This also deletes its ' + plural(n, 'to-do') + '.' : 'This list is empty.',
      buttons: [{ label: 'Cancel', value: null, style: 'bold' }, { label: 'Delete', value: true, style: 'destructive' }] }).then(function (ok) {
      if (!ok) return;
      var before = JSON.parse(JSON.stringify(todos));
      commitTodos(TD.removeList(todos, id).state);
      if (tdm && tdm.list === id) tdm.select(defaultListId() || 'today');
      toast('Deleted ' + l.name, { action: 'Undo', onAction: function () {
        // Restore: bring the list and its tasks back with fresh timestamps so sync keeps them.
        var now = Date.now(), s = TD.sanitize(todos);
        before.lists.forEach(function (x) { if (x.id === id) { var c = Object.assign({}, x, { updated: now + 1 }); delete c.deleted; s.lists = s.lists.filter(function (y) { return y.id !== id; }).concat([c]); } });
        before.tasks.forEach(function (t) { if (t.list === id && !t.deleted) s = TD.restoreTask(s, t, now + 1).state; });
        commitTodos(s);
      } });
    });
  }

  /* ───── Modal ───── */
  function openTodos(which, opts) {
    opts = opts || {};
    if (!todosReady) return;
    if (!TD.liveLists(todos).length && which !== 'today') {
      var r = TD.addList(todos, 'To-Do');
      commitTodos(r.state);
      which = r.list.id;
    }
    if (tdm) { tdm.select(which || defaultListId() || 'today'); if (opts.focusAdd) tdm.focusAdd(); if (opts.task) tdm.reveal(opts.task); return; }
    closeMenus();
    var sel = which === 'today' ? 'today' : (listById(which) ? which : defaultListId() || 'today');
    var showDone = false, dragRow = null, eatClick = false, limit = 150;
    var tabs = h('div', { class: 'td-tabs', role: 'tablist' });
    var closeBtn = h('button', { type: 'button', class: 'td-icon-btn td-close', 'aria-label': 'Close' }, icon('x'));
    var bigDot = h('button', { type: 'button', class: 'td-bigdot', 'aria-label': 'List color' });
    var title = h('h2', { class: 'td-title', tabindex: '0' });
    var sub = h('div', { class: 'td-sub' });
    var moreBtn = h('button', { type: 'button', class: 'td-icon-btn', 'aria-label': 'List options' }, icon('more'));
    var input = h('input', { type: 'text', class: 'td-input', maxlength: String(TD.LIMITS.text), autocomplete: 'off', spellcheck: 'true', enterkeyhint: 'done', 'aria-label': 'New to-do' });
    var addBtn = h('button', { type: 'submit', class: 'td-addbtn', 'aria-label': 'Add to-do', disabled: true }, icon('plus'));
    var preview = h('div', { class: 'td-preview', 'aria-live': 'polite' });
    var form = h('form', { class: 'td-add' }, h('span', { class: 'td-add-ring', 'aria-hidden': 'true' }), input, addBtn);
    var openList = h('div', { class: 'td-list', role: 'list' });
    var doneToggle = h('button', { type: 'button', class: 'td-done-toggle' });
    var doneList = h('div', { class: 'td-list done', role: 'list' });
    var emptyEl = h('div', { class: 'td-empty' });
    var moreBtn2 = h('button', { type: 'button', class: 'td-more-rows', hidden: true, onclick: function () { limit += 200; render(); } });
    var scroll = h('div', { class: 'td-scroll' }, openList, moreBtn2, emptyEl, doneToggle, doneList);
    var card = h('div', { class: 'todo-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'To-Do' },
      h('div', { class: 'td-head' }, tabs, closeBtn),
      h('div', { class: 'td-titlerow' }, bigDot, h('div', { class: 'td-titles' }, title, sub), moreBtn),
      form, preview, scroll);
    var close = openLayer(card, 'todo', { onClose: function () { tdm = null; } });
    closeBtn.addEventListener('click', function () { close(null); });

    function color() { var l = listById(sel); return l ? l.color : 'var(--accent)'; }
    function renderTabs() {
      var c = TD.counts(todos), lists = TD.liveLists(todos);
      tabs.textContent = '';
      var todayN = c.overdue + c.today;
      tabs.appendChild(h('button', { type: 'button', role: 'tab', class: 'td-tab today', 'aria-selected': String(sel === 'today'), 'data-id': 'today' },
        icon('calendar'), h('span', null, 'Today'), todayN ? h('b', { class: c.overdue ? 'over' : '' }, String(todayN)) : null));
      lists.forEach(function (l) {
        var lc = c.lists[l.id] || { open: 0, overdue: 0 };
        tabs.appendChild(h('button', { type: 'button', role: 'tab', class: 'td-tab', 'aria-selected': String(sel === l.id), 'data-id': l.id, style: { '--c': l.color } },
          h('i'), h('span', null, l.name), lc.open ? h('b', { class: lc.overdue ? 'over' : '' }, String(lc.open)) : null));
      });
      if (lists.length < TD.LIMITS.lists) tabs.appendChild(h('button', { type: 'button', class: 'td-tab add', 'aria-label': 'New list', title: 'New list', 'data-id': '+' }, icon('plus')));
      var on = tabs.querySelector('[aria-selected="true"]');
      if (on && on.scrollIntoView) { try { on.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* ignore */ } }
    }
    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('.td-tab');
      if (!b) return;
      haptic();
      if (b.dataset.id === '+') { newList(function (l) { select(l.id); focusAdd(); }); return; }
      select(b.dataset.id);
    });
    tabs.addEventListener('contextmenu', function (e) { var b = e.target.closest('.td-tab'); if (!b || !listById(b.dataset.id)) return; e.preventDefault(); listMenu(b.dataset.id, e.clientX, e.clientY); });
    tabs.addEventListener('wheel', function (e) { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { tabs.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });

    function sortTasks(arr) {
      var mode = state.settings.todoSort;
      if (sel === 'today' || mode === 'due') return arr.slice().sort(function (a, b) { return (TD.effectiveDue(a) || Infinity) - (TD.effectiveDue(b) || Infinity) || b.prio - a.prio || a.order - b.order; });
      if (mode === 'priority') return arr.slice().sort(function (a, b) { return b.prio - a.prio || (TD.effectiveDue(a) || Infinity) - (TD.effectiveDue(b) || Infinity) || a.order - b.order; });
      return arr;
    }
    function visibleTasks() {
      var now = Date.now(), end = TD.startOfDay(now) + TD.DAY;
      if (sel === 'today') return TD.liveTasks(todos).filter(function (t) { var d = TD.effectiveDue(t); return d && (d < end) && (!t.done || TD.isToday(t.doneAt, now)); });
      return TD.liveTasks(todos, sel);
    }
    function render() {
      if (sel !== 'today' && !listById(sel)) sel = defaultListId() || 'today';
      var l = listById(sel), now = Date.now();
      card.style.setProperty('--lc', sel === 'today' ? 'var(--accent)' : color());
      renderTabs();
      title.textContent = sel === 'today' ? 'Today' : l.name;
      title.title = sel === 'today' ? '' : 'Click to rename';
      bigDot.hidden = sel === 'today';
      moreBtn.hidden = false;
      var all = visibleTasks(), open = sortTasks(all.filter(function (t) { return !t.done; })), done = all.filter(function (t) { return t.done; }).sort(function (a, b) { return (b.doneAt || 0) - (a.doneAt || 0); });
      var over = open.filter(function (t) { return TD.isOverdue(t, now); }).length;
      sub.textContent = (open.length ? plural(open.length, 'to-do') : 'All done') + (over ? ' · ' + over + ' overdue' : '') + (done.length ? ' · ' + done.length + ' completed' : '');
      sub.classList.toggle('over', over > 0);
      input.placeholder = sel === 'today' ? 'Add for today — e.g. “Call Sam 5pm”' : 'New to-do — try “Pay rent tomorrow 9am !”';
      patchList(openList, open.slice(0, limit), now);
      moreBtn2.hidden = open.length <= limit;
      moreBtn2.textContent = 'Show ' + Math.min(200, open.length - limit) + ' more';
      var hideDone = state.settings.todoHideDone && !showDone;
      doneToggle.hidden = !done.length;
      doneToggle.textContent = '';
      doneToggle.append(icon('chevR', 'chev' + (hideDone ? '' : ' open')), h('span', null, 'Completed'), h('b', null, String(done.length)),
        done.length && !hideDone ? h('span', { class: 'td-clear', role: 'button', tabindex: '0' }, 'Clear') : null);
      doneList.hidden = hideDone || !done.length;
      if (!doneList.hidden) patchList(doneList, done.slice(0, 100), now); else doneList.textContent = '';
      emptyEl.hidden = open.length > 0;
      if (!open.length) {
        emptyEl.textContent = '';
        emptyEl.append(h('div', { class: 'td-empty-art', 'aria-hidden': 'true' }, icon(done.length ? 'check' : 'checklist')),
          h('div', { class: 'td-empty-t' }, done.length ? 'All done!' : sel === 'today' ? 'Nothing due today' : 'No to-dos yet'),
          h('div', { class: 'td-empty-s' }, done.length ? 'Nice work. Add another above.' : 'Type above and press Enter. Add a time like “tomorrow 5pm” to get a reminder.'));
      }
    }
    /* Keyed patching keeps focus, scroll and animations stable while typing or ticking. */
    function patchList(box, list, now) {
      var existing = {};
      Array.prototype.forEach.call(box.children, function (el) { existing[el.dataset.id] = el; });
      var frag = [];
      list.forEach(function (t) {
        var sig = JSON.stringify([t.text, t.done, t.due, t.snooze, t.remind, t.prio, t.repeat, !!t.notes, t.list, TD.isOverdue(t, now), sel === 'today', Math.floor(now / 60000)]);
        var el = existing[t.id];
        if (!el || el.dataset.sig !== sig) {
          var fresh = taskRow(t, now);
          fresh.dataset.sig = sig;
          if (el && el.classList.contains('editing')) fresh = el; // don't clobber an inline edit
          else if (el) el.replaceWith(fresh);
          el = fresh;
        }
        delete existing[t.id];
        frag.push(el);
      });
      Object.keys(existing).forEach(function (k) { existing[k].remove(); });
      frag.forEach(function (el, i) { if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null); });
    }
    function taskRow(t, now) {
      var l = listById(t.list), over = TD.isOverdue(t, now), due = TD.effectiveDue(t);
      var meta = h('div', { class: 'td-meta' },
        due ? h('span', { class: 'td-chip due' + (over ? ' over' : TD.isToday(due, now) ? ' today' : '') }, icon(t.remind ? 'bell' : 'clock'), (t.snooze ? 'Snoozed · ' : '') + TD.fmtDue(due, now)) : null,
        t.repeat !== 'none' ? h('span', { class: 'td-chip' }, icon('repeat'), TD.REPEAT_LABEL[t.repeat].replace('Every ', '')) : null,
        t.notes ? h('span', { class: 'td-chip', title: t.notes.slice(0, 200) }, icon('note')) : null,
        sel === 'today' && l ? h('span', { class: 'td-chip list', style: { '--c': l.color } }, h('i'), l.name) : null);
      var row = h('div', { class: 'td-row' + (t.done ? ' done' : '') + (over ? ' over' : '') + (t.prio ? ' p' + t.prio : ''), role: 'listitem', 'data-id': t.id, tabindex: '-1', style: l ? { '--c': l.color } : null },
        h('button', { type: 'button', class: 'td-check', role: 'checkbox', 'aria-checked': String(t.done), 'aria-label': (t.done ? 'Mark not done: ' : 'Complete: ') + t.text }, h('span', { class: 'ring' }), icon('check')),
        h('div', { class: 'td-main' },
          h('div', { class: 'td-text' }, t.prio ? h('span', { class: 'td-prio', 'aria-label': ['', 'Low', 'Medium', 'High'][t.prio] + ' priority' }, '!!!'.slice(0, t.prio)) : null, h('span', { class: 't' }, t.text)),
          meta.childNodes.length ? meta : null),
        h('div', { class: 'td-actions' },
          !t.done && due ? h('button', { type: 'button', class: 'td-icon-btn snooze', title: 'Snooze', 'aria-label': 'Snooze' }, icon('zz')) : null,
          h('button', { type: 'button', class: 'td-icon-btn info', title: 'Details', 'aria-label': 'Details' }, icon('info'))),
        !t.done && sel !== 'today' && state.settings.todoSort === 'manual' ? h('span', { class: 'td-grip', 'aria-hidden': 'true' }, icon('grip')) : null);
      return row;
    }

    /* Row interactions */
    scroll.addEventListener('click', function (e) {
      if (e.target.closest('.td-clear')) { clearCompleted(); return; }
      if (e.target.closest('.td-done-toggle')) { haptic(); setSetting({ todoHideDone: !state.settings.todoHideDone }); showDone = false; render(); return; }
      if (eatClick) { eatClick = false; return; }
      var row = e.target.closest('.td-row');
      if (!row || row.classList.contains('swiping')) return;
      var id = row.dataset.id;
      if (e.target.closest('.td-check')) { completeTask(id, row); return; }
      if (e.target.closest('.snooze')) { var r = e.target.closest('.snooze').getBoundingClientRect(); snoozeMenu(id, r.right - 214, r.bottom + 4); return; }
      if (e.target.closest('.info')) { openTaskEditor(id); return; }
      if (e.target.closest('.td-text') && !row.classList.contains('done') && !IS_TOUCH) { inlineEdit(row, id); return; }
      openTaskEditor(id);
    });
    scroll.addEventListener('contextmenu', function (e) {
      var row = e.target.closest('.td-row');
      if (!row) return;
      e.preventDefault();
      taskMenu(row.dataset.id, e.clientX, e.clientY);
    });
    scroll.addEventListener('keydown', function (e) {
      var row = e.target.closest && e.target.closest('.td-row');
      if (!row || row.classList.contains('editing')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteTask(row.dataset.id); }
      else if (e.key === ' ' && e.target === row) { e.preventDefault(); completeTask(row.dataset.id, row); }
      else if (e.key === 'Enter' && e.target === row) { e.preventDefault(); openTaskEditor(row.dataset.id); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        var rows = Array.prototype.slice.call(scroll.querySelectorAll('.td-row')), i = rows.indexOf(row), n = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
        if (n) { e.preventDefault(); n.focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); input.focus(); }
      }
    });
    function inlineEdit(row, id) {
      var t = taskById(id), textEl = row.querySelector('.td-text');
      if (!t || !textEl) return;
      row.classList.add('editing');
      var ed = h('input', { type: 'text', class: 'td-inline', value: t.text, maxlength: String(TD.LIMITS.text), 'aria-label': 'Edit to-do' });
      textEl.replaceWith(ed);
      ed.focus(); ed.select();
      var done = false;
      function finish(save) {
        if (done) return;
        done = true;
        row.classList.remove('editing');
        var v = ed.value.trim();
        if (save && v && v !== t.text) {
          var q = TD.parseQuick(v, Date.now(), TD.liveLists(todos)), patch = { text: q.text };
          if (q.due && !t.due) { patch.due = q.due; patch.remind = true; }
          if (q.prio) patch.prio = q.prio;
          commitTodos(TD.updateTask(todos, id, patch).state);
          if (patch.due) maybeAskNotify();
        } else render();
      }
      ed.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      });
      ed.addEventListener('blur', function () { finish(true); });
    }
    function completeTask(id, row) {
      var t = taskById(id);
      if (!t) return;
      var r = TD.toggleDone(todos, id);
      if (!t.done) {
        haptic('success'); chime(true);
        if (row && !REDUCED) {
          row.classList.add('completing');
          todos = TD.sanitize(r.state);
          Store.saveTodos(todos, { origin: VIEW_ID });
          if (API && API.runtime) call(API.runtime, 'sendMessage', { type: 'shelf:todos' }).catch(function () {});
          renderTodoDots(); updateAppBadge(); scheduleTodoCheck(); updateSettings();
          setTimeout(function () { if (tdm) tdm.render(); }, r.repeated ? 450 : 620);
        } else commitTodos(r.state);
        if (r.repeated) toast('Next: ' + TD.fmtDue(r.next));
        else toast('Completed “' + t.text + '”', { action: 'Undo', onAction: function () { var cur = taskById(id); if (cur && cur.done) commitTodos(TD.toggleDone(todos, id).state); } });
      } else { haptic(); commitTodos(r.state); }
    }
    function clearCompleted() {
      var before = TD.liveTasks(todos).filter(function (t) { return t.done && (sel === 'today' || t.list === sel); });
      if (!before.length) return;
      var s = todos;
      before.forEach(function (t) { s = TD.removeTask(s, t.id).state; });
      commitTodos(s);
      toast('Cleared ' + plural(before.length, 'completed to-do'), { action: 'Undo', onAction: function () {
        var s2 = todos; before.forEach(function (t) { s2 = TD.restoreTask(s2, t).state; }); commitTodos(s2);
      } });
    }

    /* Quick add */
    function parsed() { return TD.parseQuick(input.value, Date.now(), TD.liveLists(todos)); }
    function renderPreview() {
      var v = input.value.trim();
      addBtn.disabled = !v;
      preview.textContent = '';
      if (!v) { preview.hidden = true; return; }
      var q = parsed(), l = q.list ? listById(q.list) : null, bits = [];
      if (q.due) bits.push(h('span', { class: 'td-chip due' }, icon('bell'), TD.fmtDue(q.due)));
      if (q.repeat !== 'none') bits.push(h('span', { class: 'td-chip' }, icon('repeat'), TD.REPEAT_LABEL[q.repeat]));
      if (q.prio) bits.push(h('span', { class: 'td-chip prio' }, icon('flag'), ['', 'Low', 'Medium', 'High'][q.prio]));
      if (l) bits.push(h('span', { class: 'td-chip list', style: { '--c': l.color } }, h('i'), l.name));
      preview.hidden = !bits.length;
      append(preview, bits);
    }
    input.addEventListener('input', renderPreview);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value.trim();
      if (!v) return;
      var q = parsed(), listId = q.list || (sel === 'today' ? defaultListId() : sel), due = q.due;
      if (!due && sel === 'today') { var d = new Date(); d.setHours(18, 0, 0, 0); if (d.getTime() <= Date.now()) d = new Date(Date.now() + TD.HOUR); due = d.getTime(); }
      if (TD.liveTasks(todos).length >= TD.LIMITS.tasks) { toast('You’ve reached the to-do limit — clear some completed ones'); return; }
      var r = TD.addTask(todos, { text: q.text, due: due, remind: !!q.due, prio: q.prio, repeat: q.repeat, list: listId, atEnd: state.settings.todoSort === 'manual' && false });
      if (!r.task) return;
      input.value = ''; renderPreview();
      haptic();
      if (sel !== 'today') rememberList(sel);
      commitTodos(r.state);
      var el = openList.querySelector('[data-id="' + r.task.id + '"]');
      if (el && el.animate && !REDUCED) el.animate([{ opacity: 0, transform: 'translateY(-8px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.3,1.3,.5,1)' });
      if (q.list && q.list !== sel && sel !== 'today') toast('Added to ' + (listById(q.list) || {}).name);
      if (r.task.remind) maybeAskNotify();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { var f = scroll.querySelector('.td-row'); if (f) { e.preventDefault(); f.focus(); } }
    });

    /* Title: rename · colour · options */
    title.addEventListener('click', function () { if (sel !== 'today') renameList(sel); });
    title.addEventListener('keydown', function (e) { if (e.key === 'Enter' && sel !== 'today') { e.preventDefault(); renameList(sel); } });
    bigDot.addEventListener('click', function () { if (sel !== 'today') pickListColor(sel); });
    moreBtn.addEventListener('click', function () {
      var r = moreBtn.getBoundingClientRect(), l = listById(sel), mode = state.settings.todoSort;
      showMenu(r.right - 214, r.bottom + 6, [
        { label: 'Sort: Manual', icon: 'blank', checked: mode === 'manual', run: function () { setSetting({ todoSort: 'manual' }); render(); } },
        { label: 'Sort: Due Date', icon: 'blank', checked: mode === 'due', run: function () { setSetting({ todoSort: 'due' }); render(); } },
        { label: 'Sort: Priority', icon: 'blank', checked: mode === 'priority', run: function () { setSetting({ todoSort: 'priority' }); render(); } },
        '-',
        { label: state.settings.todoHideDone ? 'Show Completed' : 'Hide Completed', icon: 'check', run: function () { setSetting({ todoHideDone: !state.settings.todoHideDone }); showDone = false; render(); } },
        { label: 'Clear Completed', icon: 'trash', run: clearCompleted },
        l ? '-' : null,
        l ? { label: 'Rename List…', icon: 'pencil', run: function () { renameList(sel); } } : null,
        l ? { label: 'Change Color…', icon: 'drop', run: function () { pickListColor(sel); } } : null,
        { label: 'New List…', icon: 'plus', run: function () { newList(function (nl) { select(nl.id); focusAdd(); }); } },
        l ? '-' : null,
        l ? { label: 'Delete List…', icon: 'trash', danger: true, run: function () { deleteList(sel); } } : null,
      ]);
    });

    /* Drag to reorder (grip) · swipe to delete (touch) */
    openList.addEventListener('pointerdown', function (e) {
      var row = e.target.closest('.td-row');
      if (!row || e.button !== 0) return;
      if (e.target.closest('.td-grip')) { startReorder(e, row); return; }
      if (e.pointerType === 'touch' && !e.target.closest('button')) startSwipe(e, row);
    });
    doneList.addEventListener('pointerdown', function (e) {
      var row = e.target.closest('.td-row');
      if (row && e.pointerType === 'touch' && !e.target.closest('button')) startSwipe(e, row);
    });
    function startReorder(e, row) {
      e.preventDefault();
      var rows = Array.prototype.slice.call(openList.children), y0 = e.clientY, moved = false;
      var rects = rows.map(function (r) { return r.getBoundingClientRect(); }), from = rows.indexOf(row), to = from;
      var hRow = rects[from].height + 6;
      row.classList.add('dragging'); openList.classList.add('reordering');
      try { row.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      function move(ev) {
        var dy = ev.clientY - y0;
        if (Math.abs(dy) > 3) moved = true;
        row.style.transform = 'translateY(' + dy + 'px) scale(1.02)';
        var mid = rects[from].top + rects[from].height / 2 + dy, t = from;
        rects.forEach(function (r, i) { if (i < from && mid < r.top + r.height / 2) t = Math.min(t, i); if (i > from && mid > r.top + r.height / 2) t = Math.max(t, i); });
        if (t !== to) { to = t; haptic(); }
        rows.forEach(function (r, i) {
          if (r === row) return;
          var shift = from < to && i > from && i <= to ? -hRow : from > to && i >= to && i < from ? hRow : 0;
          r.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
        });
        var sr = scroll.getBoundingClientRect();
        if (ev.clientY < sr.top + 30) scroll.scrollTop -= 8; else if (ev.clientY > sr.bottom - 30) scroll.scrollTop += 8;
      }
      function up() {
        row.removeEventListener('pointermove', move); row.removeEventListener('pointerup', up); row.removeEventListener('pointercancel', up);
        rows.forEach(function (r) { r.style.transform = ''; });
        row.classList.remove('dragging'); openList.classList.remove('reordering');
        if (moved) { eatClick = true; setTimeout(function () { eatClick = false; }, 80); }
        if (!moved || to === from) return;
        var ids = rows.map(function (r) { return r.dataset.id; });
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        var all = TD.liveTasks(todos, sel).filter(function (t) { return t.done; }).map(function (t) { return t.id; });
        commitTodos(TD.reorder(todos, sel, ids.concat(all)).state);
      }
      row.addEventListener('pointermove', move); row.addEventListener('pointerup', up); row.addEventListener('pointercancel', up);
    }
    function startSwipe(e, row) {
      var x0 = e.clientX, y0 = e.clientY, dx = 0, active = false, pid = e.pointerId;
      function move(ev) {
        if (ev.pointerId !== pid) return;
        var mx = ev.clientX - x0, my = ev.clientY - y0;
        if (!active) { if (Math.abs(my) > 10) return cleanup(); if (mx < -12) { active = true; row.classList.add('swiping'); try { row.setPointerCapture(pid); } catch (err) { /* ignore */ } } else return; }
        dx = Math.min(0, mx);
        row.style.transform = 'translateX(' + dx + 'px)';
        row.classList.toggle('swipe-arm', dx < -row.offsetWidth * 0.35);
      }
      function cleanup() {
        doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', end); doc.removeEventListener('pointercancel', end);
      }
      function end() {
        cleanup();
        if (!active) return;
        var arm = row.classList.contains('swipe-arm');
        eatClick = true; setTimeout(function () { eatClick = false; }, 80);
        setTimeout(function () { row.classList.remove('swiping'); }, 50);
        if (arm) { row.style.transform = 'translateX(-110%)'; row.style.opacity = '0'; haptic('heavy'); setTimeout(function () { deleteTask(row.dataset.id); }, 180); }
        else { row.style.transform = ''; row.classList.remove('swipe-arm'); }
      }
      doc.addEventListener('pointermove', move); doc.addEventListener('pointerup', end); doc.addEventListener('pointercancel', end);
    }

    function select(id) {
      sel = id === 'today' ? 'today' : listById(id) ? id : defaultListId() || 'today';
      if (sel !== 'today') rememberList(sel);
      showDone = false; limit = 150;
      render();
      if (!REDUCED && scroll.animate) scroll.animate([{ opacity: 0.4, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
    }
    function focusAdd() { setTimeout(function () { input.focus({ preventScroll: true }); }, IS_TOUCH ? 350 : 60); }
    function reveal(id) {
      var t = taskById(id);
      if (!t) return;
      if (sel !== 'today' && t.list !== sel) select(t.list);
      var el = scroll.querySelector('[data-id="' + id + '"]');
      if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(function () { el.classList.remove('flash'); }, 1400); el.focus({ preventScroll: true }); }
    }
    tdm = { render: render, select: select, focusAdd: focusAdd, reveal: reveal, close: close, get list() { return sel; }, card: card };
    render(); renderPreview();
    if (opts.focusAdd || (!IS_TOUCH && !opts.task)) focusAdd();
    if (opts.task) setTimeout(function () { reveal(opts.task); }, 60);
    // keep due times fresh while open
    var tick = setInterval(function () { if (!tdm) { clearInterval(tick); return; } render(); }, 30000);
  }

  /* ───── Task details sheet ───── */
  function toLocalInput(ms) {
    if (!ms) return '';
    var d = new Date(ms), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fromLocalInput(v) { if (!v) return null; var t = new Date(v).getTime(); return isFinite(t) ? t : null; }
  function presetTime(kind) {
    var d = new Date(), now = Date.now();
    if (kind === 'hour') return now + TD.HOUR;
    if (kind === 'today') { d.setHours(18, 0, 0, 0); return d.getTime() > now ? d.getTime() : now + TD.HOUR; }
    if (kind === 'tonight') { d.setHours(20, 0, 0, 0); return d.getTime() > now ? d.getTime() : now + TD.HOUR; }
    if (kind === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); }
    if (kind === 'week') { d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); return d.getTime(); }
    if (kind === 'weekend') { d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); d.setHours(10, 0, 0, 0); return d.getTime(); }
    return null;
  }
  function openTaskEditor(id) {
    var t0 = taskById(id);
    if (!t0) return;
    var draft = JSON.parse(JSON.stringify(t0));
    var text = h('textarea', { class: 'td-f-text', rows: '2', maxlength: String(TD.LIMITS.text), 'aria-label': 'To-do' });
    text.value = draft.text;
    var notes = h('textarea', { class: 'td-f-notes', rows: '3', maxlength: String(TD.LIMITS.notes), placeholder: 'Notes, links, details…', 'aria-label': 'Notes' });
    notes.value = draft.notes || '';
    var when = h('input', { type: 'datetime-local', class: 'td-f-when', 'aria-label': 'Date and time' });
    when.value = toLocalInput(draft.due);
    var remind = h('input', { type: 'checkbox', class: 'switch', role: 'switch', 'aria-label': 'Remind me' });
    var repeatBtn = h('button', { type: 'button', class: 'pick-btn' }, h('span', { class: 'pick-val' }), icon('chevUD'));
    var listBtn = h('button', { type: 'button', class: 'pick-btn' }, h('span', { class: 'pick-val' }), icon('chevUD'));
    var prio = h('div', { class: 'seg td-prio-seg', role: 'radiogroup', 'aria-label': 'Priority' });
    var thumb = h('span', { class: 'thumb', 'aria-hidden': 'true' });
    prio.appendChild(thumb);
    [['0', 'None'], ['1', '!'], ['2', '!!'], ['3', '!!!']].forEach(function (o) {
      prio.appendChild(h('button', { type: 'button', role: 'radio', 'data-v': o[0], onclick: function () { draft.prio = Number(o[0]); haptic(); paint(); } }, o[1]));
    });
    var presets = h('div', { class: 'td-presets' },
      [['hour', 'In 1 Hour'], ['today', 'Today'], ['tonight', 'Tonight'], ['tomorrow', 'Tomorrow'], ['week', 'Next Week'], ['none', 'None']].map(function (p) {
        return h('button', { type: 'button', class: 'chip', onclick: function () {
          haptic();
          draft.due = p[0] === 'none' ? null : presetTime(p[0]);
          draft.snooze = null;
          if (draft.due && !t0.due) draft.remind = true;
          if (!draft.due) draft.remind = false;
          when.value = toLocalInput(draft.due); paint();
        } }, p[1]);
      }));
    when.addEventListener('change', function () { draft.due = fromLocalInput(when.value); draft.snooze = null; if (draft.due && !draft.remind && !t0.due) draft.remind = true; paint(); });
    remind.addEventListener('change', function () { draft.remind = remind.checked; haptic(); if (draft.remind) maybeAskNotify(); paint(); });
    repeatBtn.addEventListener('click', function () {
      var r = repeatBtn.getBoundingClientRect();
      showMenu(r.right - 214, r.bottom + 6, TD.REPEATS.map(function (k) { return { label: TD.REPEAT_LABEL[k], icon: 'blank', checked: draft.repeat === k, run: function () { draft.repeat = k; if (k !== 'none' && !draft.due) { draft.due = presetTime('tomorrow'); when.value = toLocalInput(draft.due); } paint(); } }; }), { title: 'Repeat' });
    });
    listBtn.addEventListener('click', function () {
      var r = listBtn.getBoundingClientRect();
      showMenu(r.right - 214, r.bottom + 6, TD.liveLists(todos).map(function (l) { return { label: l.name, icon: 'blank', checked: draft.list === l.id, run: function () { draft.list = l.id; paint(); } }; }), { title: 'List' });
    });
    function paint() {
      remind.checked = !!draft.remind && !!draft.due;
      remind.disabled = !draft.due;
      repeatBtn.firstChild.textContent = TD.REPEAT_LABEL[draft.repeat];
      var l = listById(draft.list);
      listBtn.firstChild.textContent = l ? l.name : '—';
      var btns = prio.querySelectorAll('button');
      btns.forEach(function (b, i) { b.setAttribute('aria-checked', String(Number(b.dataset.v) === draft.prio)); if (Number(b.dataset.v) === draft.prio) prio.style.setProperty('--i', String(i)); });
      prio.style.setProperty('--n', '4');
      dueNote.textContent = draft.due ? (draft.due < Date.now() ? 'Overdue · ' : '') + TD.fmtDue(draft.due) + ' · ' + TD.fmtRel(draft.due) : 'No date';
      dueNote.classList.toggle('over', !!draft.due && draft.due < Date.now());
    }
    var dueNote = h('div', { class: 'td-duenote' });
    var body = [
      h('div', { class: 'group td-f' }, h('div', { class: 'td-f-row' }, text), h('div', { class: 'td-f-row' }, notes)),
      h('div', { class: 'group-title' }, 'When'),
      h('div', { class: 'group' },
        h('div', { class: 'srow has-icon' }, sicon('calendar', '#FF453A'), h('span', { class: 'lbl' }, 'Date & Time'), when),
        h('div', { class: 'srow stack' }, presets, dueNote),
        h('div', { class: 'srow has-icon' }, sicon('bell', '#FF9F0A'), h('span', { class: 'lbl' }, 'Remind Me'), remind),
        h('div', { class: 'srow has-icon' }, sicon('repeat', '#8E8E93'), h('span', { class: 'lbl' }, 'Repeat'), repeatBtn)),
      h('div', { class: 'group-title' }, 'Details'),
      h('div', { class: 'group' },
        h('div', { class: 'srow has-icon' }, sicon('flag', '#FF9F0A'), h('span', { class: 'lbl' }, 'Priority'), prio),
        h('div', { class: 'srow has-icon' }, sicon('checklist', '#0A84FF'), h('span', { class: 'lbl' }, 'List'), listBtn)),
      h('div', { class: 'group td-f-danger' },
        h('button', { type: 'button', class: 'srow btn-row danger', onclick: function () { shell.close(true); deleteTask(id); } }, h('span', { class: 'lbl' }, 'Delete To-Do'))),
      h('div', { class: 'td-created' }, 'Created ' + TD.fmtDue(t0.created) + (t0.done && t0.doneAt ? ' · Completed ' + TD.fmtDue(t0.doneAt) : '')),
    ];
    var shell = sheetShell({ title: 'Details', left: 'Cancel', right: { label: 'Done', onClick: function (close) { if (save()) close(true); } }, body: body });
    shell.sheet.classList.add('td-editor');
    function save() {
      var v = text.value.replace(/\s+/g, ' ').trim();
      if (!v) { toast('A to-do needs a name'); text.focus(); return false; }
      var patch = { text: v, notes: notes.value, due: draft.due, remind: !!draft.remind && !!draft.due, repeat: draft.repeat, prio: draft.prio, list: draft.list };
      if (draft.due === t0.due) { delete patch.due; }
      var r = TD.updateTask(todos, id, patch);
      if (r.task) { commitTodos(r.state); haptic('success'); }
      return true;
    }
    text.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (save()) shell.close(true); } });
    paint();
    if (!IS_TOUCH) setTimeout(function () { text.focus(); text.setSelectionRange(text.value.length, text.value.length); }, 80);
  }
  function deleteTask(id) {
    var r = TD.removeTask(todos, id);
    if (!r.task) return;
    commitTodos(r.state);
    toast('Deleted “' + r.task.text + '”', { action: 'Undo', onAction: function () { commitTodos(TD.restoreTask(todos, r.task).state); } });
  }
  function taskMenu(id, x, y) {
    var t = taskById(id);
    if (!t) return;
    showMenu(x, y, [
      { label: t.done ? 'Mark Not Done' : 'Complete', icon: 'check', run: function () { var row = tdm && tdm.card.querySelector('[data-id="' + id + '"]'); completeTaskFromAnywhere(id, row); } },
      { label: 'Details…', icon: 'info', run: function () { openTaskEditor(id); } },
      !t.done && t.due ? { label: 'Snooze…', icon: 'zz', run: function () { snoozeMenu(id, x, y); } } : null,
      !t.done ? { label: t.due ? 'Change Date…' : 'Add a Reminder…', icon: 'bell', run: function () { openTaskEditor(id); } } : null,
      { label: 'Copy', icon: 'link', run: function () { copyText(t.text + (t.notes ? '\n' + t.notes : '')); } },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, run: function () { deleteTask(id); } },
    ]);
  }
  function completeTaskFromAnywhere(id) {
    var t = taskById(id);
    if (!t) return;
    var r = TD.toggleDone(todos, id);
    commitTodos(r.state);
    if (!t.done) { haptic('success'); chime(true); toast(r.repeated ? 'Next: ' + TD.fmtDue(r.next) : 'Completed “' + t.text + '”', r.repeated ? null : { action: 'Undo', onAction: function () { var c = taskById(id); if (c && c.done) commitTodos(TD.toggleDone(todos, id).state); } }); }
  }
  function snoozeFor(id, until) {
    var r = TD.snooze(todos, id, until);
    if (!r.task) return;
    commitTodos(r.state);
    haptic();
    toast('Snoozed until ' + TD.fmtDue(until));
  }
  function snoozeMenu(id, x, y) {
    var now = Date.now(), m = Number(state.settings.todoSnooze) || 10;
    var eve = new Date(); eve.setHours(18, 0, 0, 0);
    showMenu(x, y, [
      { label: m + ' Minutes (default)', icon: 'zz', run: function () { snoozeFor(id, Date.now() + m * 60e3); } },
      m !== 5 ? { label: '5 Minutes', icon: 'blank', run: function () { snoozeFor(id, Date.now() + 5 * 60e3); } } : null,
      m !== 30 ? { label: '30 Minutes', icon: 'blank', run: function () { snoozeFor(id, Date.now() + 30 * 60e3); } } : null,
      { label: '1 Hour', icon: 'blank', run: function () { snoozeFor(id, Date.now() + TD.HOUR); } },
      eve.getTime() > now + 30 * 60e3 ? { label: 'This Evening', icon: 'blank', run: function () { snoozeFor(id, eve.getTime()); } } : null,
      { label: 'Tomorrow Morning', icon: 'blank', run: function () { snoozeFor(id, presetTime('tomorrow')); } },
      { label: 'Next Week', icon: 'blank', run: function () { snoozeFor(id, presetTime('week')); } },
      '-',
      { label: 'Pick a Time…', icon: 'calendar', run: function () { openTaskEditor(id); } },
    ], { title: 'Snooze' });
  }

  /* ───── Reminders inside the app: banner + chime + (website) system notification, badges ───── */
  var bannerBox = h('div', { class: 'td-banners', 'aria-live': 'assertive' });
  doc.body.appendChild(bannerBox);
  var shownAlerts = {}, pageOpenedAt = Date.now(), checkTimer = 0;
  function scheduleTodoCheck() {
    clearTimeout(checkTimer);
    if (!todosReady) return;
    var now = Date.now(), next = Infinity;
    TD.liveTasks(todos).forEach(function (t) { var a = TD.alertAt(t); if (a && a > now) next = Math.min(next, a); });
    checkTodos();
    checkTimer = setTimeout(scheduleTodoCheck, Math.max(1000, Math.min(next - now + 250, 30000)));
  }
  function checkTodos() {
    var now = Date.now(), due = [];
    TD.liveTasks(todos).forEach(function (t) {
      var a = TD.alertAt(t);
      if (!a || a > now || shownAlerts[t.id] === a) return;
      // Extension: the background worker sends the system notification; here we only banner what comes due while open.
      if (!IS_WEB && a < pageOpenedAt - 1000) { shownAlerts[t.id] = a; return; }
      due.push([t, a]);
    });
    if (!due.length) { updateAppBadge(); return; }
    if (IS_WEB) {
      Store.getNotified().then(function (seen) {
        var fresh = due.filter(function (x) { return seen[x[0].id] !== x[1] && now - x[1] < 7 * TD.DAY; });
        due.forEach(function (x) { shownAlerts[x[0].id] = x[1]; seen[x[0].id] = x[1]; });
        Store.setNotified(seen);
        fresh.slice(0, 3).forEach(function (x) { announce(x[0]); });
      });
    } else {
      due.forEach(function (x) { shownAlerts[x[0].id] = x[1]; });
      due.slice(0, 3).forEach(function (x) { announce(x[0]); });
    }
    updateAppBadge();
  }
  function announce(t) {
    if (!state.settings.todoNotify) return;
    showBanner(t);
    chime(false);
    haptic('heavy');
    if (IS_WEB) systemNotify(t);
  }
  function showBanner(t) {
    var l = listById(t.list);
    var b = h('div', { class: 'td-banner', role: 'alert', style: l ? { '--c': l.color } : null },
      h('div', { class: 'td-banner-top' }, brandMark(), h('span', { class: 'app' }, 'SHELF · TO-DO'), h('span', { class: 'when' }, 'now'),
        h('button', { type: 'button', class: 'td-banner-x', 'aria-label': 'Dismiss' }, icon('x'))),
      h('div', { class: 'td-banner-title' }, t.text),
      h('div', { class: 'td-banner-sub' }, (l ? l.name + ' · ' : '') + (t.snooze ? 'Snoozed reminder' : 'Due ' + TD.fmtDue(t.due))),
      h('div', { class: 'td-banner-btns' },
        h('button', { type: 'button', 'data-a': 'snooze', title: 'Snooze ' + (Number(state.settings.todoSnooze) >= 60 ? '1 hour' : state.settings.todoSnooze + ' minutes') }, icon('zz'), (Number(state.settings.todoSnooze) >= 60 ? '1 h' : state.settings.todoSnooze + ' min')),
        h('button', { type: 'button', 'data-a': 'done', class: 'primary' }, icon('check'), 'Done'),
        h('button', { type: 'button', 'data-a': 'open' }, 'Open')));
    var gone = false;
    function dismiss() { if (gone) return; gone = true; b.classList.remove('show'); b.classList.add('hide'); setTimeout(function () { b.remove(); }, 420); }
    b.addEventListener('click', function (e) {
      var a = e.target.closest('[data-a]'), x = e.target.closest('.td-banner-x');
      if (x) { dismiss(); return; }
      if (!a) { dismiss(); openTodos(t.list, { task: t.id }); return; }
      dismiss();
      if (a.dataset.a === 'snooze') snoozeFor(t.id, Date.now() + (Number(state.settings.todoSnooze) || 10) * 60e3);
      else if (a.dataset.a === 'done') completeTaskFromAnywhere(t.id);
      else openTodos(t.list, { task: t.id });
    });
    // swipe up to dismiss
    (function () {
      var y0 = null;
      b.addEventListener('pointerdown', function (e) { if (!e.target.closest('button')) { y0 = e.clientY; } });
      b.addEventListener('pointermove', function (e) { if (y0 == null) return; var dy = Math.min(0, e.clientY - y0); b.style.transform = 'translateY(' + dy + 'px)'; });
      b.addEventListener('pointerup', function (e) { if (y0 == null) return; var dy = e.clientY - y0; y0 = null; if (dy < -30) dismiss(); else b.style.transform = ''; });
    })();
    while (bannerBox.children.length >= 3) bannerBox.firstChild.remove();
    bannerBox.appendChild(b);
    void b.offsetWidth; b.classList.add('show');
    var timer = setTimeout(dismiss, 14000);
    b.addEventListener('pointerenter', function () { clearTimeout(timer); });
    b.addEventListener('pointerleave', function () { clearTimeout(timer); timer = setTimeout(dismiss, 6000); });
  }
  var audioCtx = null;
  function chime(soft) {
    if (!state.settings.todoSound) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(function () {});
      var t = audioCtx.currentTime;
      (soft ? [[1318.5, 0]] : [[880, 0], [1318.5, 0.12]]).forEach(function (n) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t + n[1]);
        g.gain.exponentialRampToValueAtTime(soft ? 0.05 : 0.11, t + n[1] + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + (soft ? 0.25 : 0.6));
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t + n[1]); o.stop(t + n[1] + 0.65);
      });
    } catch (e) { /* audio blocked */ }
  }
  function systemNotify(t) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      var l = listById(t.list), body = (l ? l.name + ' · ' : '') + (t.snooze ? 'Snoozed reminder' : 'Due ' + TD.fmtDue(t.due));
      var opts = { body: body, tag: 'todo-' + t.id, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { id: t.id }, renotify: true, requireInteraction: true,
        actions: [{ action: 'snooze', title: 'Snooze' }, { action: 'done', title: 'Done' }] };
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function (reg) { return reg.showNotification(t.text, opts); }).catch(function () { try { new Notification(t.text, { body: body, tag: opts.tag }); } catch (e) { /* ignore */ } });
      } else new Notification(t.text, { body: body, tag: opts.tag });
    } catch (e) { /* ignore */ }
  }
  var titleBase = doc.title;
  function updateAppBadge() {
    if (!todosReady) return;
    var n = TD.counts(todos).overdue;
    if (IS_WEB) {
      doc.title = n ? '(' + n + ') ' + titleBase : titleBase;
      try {
        if (n && state.settings.todoBadge && navigator.setAppBadge) navigator.setAppBadge(n).catch(function () {});
        else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(function () {});
      } catch (e) { /* ignore */ }
    }
  }
  /* Permission for system notifications — asked once, the first time a reminder is set. */
  var notifPerm = null;   // true / false / null (unknown)
  function refreshNotifPerm() {
    if (IS_WEB) { notifPerm = 'Notification' in window ? Notification.permission === 'granted' : false; updateSettings(); return Promise.resolve(notifPerm); }
    if (!API || !API.permissions) { notifPerm = false; return Promise.resolve(false); }
    return call(API.permissions, 'contains', { permissions: ['notifications'] }).then(function (ok) { notifPerm = !!ok; updateSettings(); return notifPerm; }, function () { notifPerm = false; return false; });
  }
  function requestNotif(userAsked) {
    if (IS_WEB) {
      if (!('Notification' in window)) { if (userAsked) toast(IS_IOS ? 'Add Shelf to your Home Screen to get notifications' : 'This browser doesn’t support notifications'); return Promise.resolve(false); }
      if (Notification.permission === 'denied') { if (userAsked) toast('Notifications are blocked — allow them in your browser’s site settings'); return Promise.resolve(false); }
      return Promise.resolve(Notification.requestPermission()).then(function (p) { notifPerm = p === 'granted'; updateSettings(); if (userAsked || notifPerm) toast(notifPerm ? 'Notifications are on' : 'Notifications stay off — reminders still show in Shelf'); return notifPerm; }, function () { return false; });
    }
    if (!API || !API.permissions) return Promise.resolve(false);
    return call(API.permissions, 'request', { permissions: ['notifications'] }).then(function (ok) {
      notifPerm = !!ok; updateSettings();
      toast(ok ? 'Notifications are on' : 'Notifications stay off — the toolbar badge still shows what’s due');
      if (ok) call(API.runtime, 'sendMessage', { type: 'shelf:todos' }).catch(function () {});
      return !!ok;
    }, function () { return false; });
  }
  function maybeAskNotify() {
    if (notifPerm || !state.settings.todoNotify) return;
    var asked = false;
    try { asked = localStorage.getItem('shelf.notifAsked') === '1'; } catch (e) { /* ignore */ }
    if (asked) return;
    try { localStorage.setItem('shelf.notifAsked', '1'); } catch (e) { /* ignore */ }
    requestNotif(false);
  }
  document.addEventListener('visibilitychange', function () { if (!doc.hidden) { reloadTodos(); scheduleTodoCheck(); } });
  if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
    navigator.serviceWorker.addEventListener('message', function (e) {
      var d = e.data || {};
      if (d.type !== 'todo-action' || !d.id) return;
      Store.getTodos().then(function (st) { todos = st; if (d.act === 'done') completeTaskFromAnywhere(d.id); else if (d.act === 'snooze') snoozeFor(d.id, Date.now() + (Number(state.settings.todoSnooze) || 10) * 60e3); else openTodos('today', { task: d.id }); });
    });
  }

  /* ───── Settings rows ───── */
  function todoSettingsRows() {
    var permVal = h('span', { class: 'val' });
    var permRow = h('button', { type: 'button', class: 'srow btn-row has-icon', onclick: function () { if (notifPerm) { toast(IS_WEB ? 'Turn notifications off in your browser’s site settings' : 'Notifications are on'); return; } requestNotif(true); } },
      sicon('bell', '#FF3B30'), h('span', { class: 'lbl' }, 'System Notifications'), permVal);
    updaters.push(function () { permVal.textContent = notifPerm ? 'Allowed' : 'Allow'; permVal.appendChild(icon('chevR')); });
    return [
      h('div', { class: 'group-title' }, 'To-Do'),
      h('div', { class: 'group' },
        btnRow('checklist', '#0A84FF', 'Open To-Do', function () { closeSettings(); setTimeout(function () { openTodos(defaultListId() || 'today'); }, 260); }, { value: function () { var c = TD.counts(todos); return c.open ? c.open + (c.overdue ? ' · ' + c.overdue + ' overdue' : '') : ''; } }),
        btnRow('plus', '#30D158', 'New List', function () { newList(); }),
        row('dots3', '#5E5CE6', 'Show Lists on Home Screen', toggle('todoHome', 'Show lists on home screen')),
        row('bellBadge', '#FF453A', IS_WEB ? 'App Icon Badge' : 'Toolbar Badge', toggle('todoBadge', 'Badge for overdue to-dos')),
        row('bell', '#FF9F0A', 'Reminders', toggle('todoNotify', 'Reminders')),
        permRow,
        row('sound', '#FF375F', 'Reminder Sound', toggle('todoSound', 'Reminder sound')),
        pickerRow('zz', '#5856D6', 'Snooze For', 'todoSnooze', [['5', '5 Minutes'], ['10', '10 Minutes'], ['15', '15 Minutes'], ['30', '30 Minutes'], ['60', '1 Hour']]),
        row('check', '#34C759', 'Hide Completed', toggle('todoHideDone', 'Hide completed'))),
      h('div', { class: 'group-foot' }, IS_WEB
        ? 'Reminders appear while Shelf is open (as a banner, a sound and a system notification if allowed). Installed on your home screen, Shelf also shows the overdue count on its icon.'
        : 'Reminders arrive as system notifications with Snooze and Done, even when Shelf is closed. The toolbar icon shows how many to-dos are overdue. To-dos sync with your browser account.'),
    ];
  }

  /* ═════════════════════ Init ═════════════════════ */

  var tabSeen = null;
  function refreshCurrentTab() {
    if (!tabSeen) return;
    state.currentTab = Core.flatten(state.items).some(function (e) { return Core.sameUrl(e.app.url, tabSeen.url); }) ? null : tabSeen;
  }
  function detectCurrentTab() {
    if (IS_PAGE || !API || !API.tabs) return Promise.resolve();
    return call(API.tabs, 'query', { active: true, lastFocusedWindow: true }).then(function (tabs) {
      var t = tabs && tabs[0];
      if (!t || !/^https?:/i.test(t.url || '')) return;
      var n = Core.normalizeUrl(String(t.url).split('#')[0]);
      if (!n.ok) {                                   // very long / unusual URLs → fall back to the page, then the site
        try { var u0 = new URL(t.url); n = Core.normalizeUrl(u0.origin + u0.pathname); if (!n.ok) n = Core.normalizeUrl(u0.origin); } catch (e) { /* ignore */ }
      }
      if (!n.ok) return;
      var fav = Core.isSafeImageSrc(t.favIconUrl) && !/^data:/i.test(t.favIconUrl) ? t.favIconUrl : null;
      var candidate = { url: n.url, title: String(t.title || ''), favIconUrl: fav };
      tabSeen = candidate;
      state.currentTab = Core.flatten(state.items).some(function (e) { return Core.sameUrl(e.app.url, n.url); }) ? null : candidate;
    }).catch(function () { /* not available */ });
  }
  function onHomeScroll() {
    var y = IS_PAGE ? homeEl.scrollTop : (window.scrollY || doc.documentElement.scrollTop);
    topbar.classList.toggle('scrolled', y > 2);
  }
  (IS_PAGE ? homeEl : window).addEventListener('scroll', onHomeScroll, { passive: true });
  function idle(fn) { (window.requestIdleCallback || function (f) { return setTimeout(f, 300); })(fn); }

  var splashEl = doc.getElementById('splash');
  function hideSplash() {
    if (!splashEl || !html.classList.contains('splash-on')) { if (splashEl) splashEl.remove(); splashEl = null; return; }
    if (!state.settings.splash) { html.classList.remove('splash-on'); splashEl.remove(); splashEl = null; return; }
    var minMs = REDUCED ? 700 : IS_PAGE ? 1500 : 1250;
    var wait = Math.max(0, minMs - (window.performance ? performance.now() : 0));
    setTimeout(function () {
      if (!splashEl) return;
      html.classList.add('splash-out');
      setTimeout(function () { html.classList.remove('splash-on', 'splash-out'); if (splashEl) splashEl.remove(); splashEl = null; introAnimation(); }, REDUCED ? 120 : 560);
    }, wait);
  }

  var heightTimer = 0;
  function rememberHeight() {
    return;                                   // popup has a fixed, phone-like height since 2.3
    clearTimeout(heightTimer);
    heightTimer = setTimeout(function () {
      html.style.removeProperty('--boot-h');
      var hh = Math.round(rootEl.offsetHeight);
      if (layers.length || state.view === 'settings' || rootEl.style.minHeight || rootEl.classList.contains('tall')) return;
      if (hh > 100) { try { localStorage.setItem('shelf.bootH', String(Math.min(hh, 600))); } catch (e) { /* ignore */ } }
    }, 60);
  }
  function init() {
    buildSettings();
    applyTheme();
    var tabP = detectCurrentTab();
    Promise.all([
      Store.load(DEFAULTS, seedItems, VIEW_ID),
      Store.getLogos(),
      Store.local.get([Store.KEYS.wallpaperImg]).catch(function () { return {}; }),
      Store.getTodos().catch(function () { return TD.empty(); }),
    ]).then(function (r) {
      todos = r[3] || TD.empty();
      todosReady = true;
      var st = r[0];
      logoData = r[1] || {};
      var wp = r[2] && r[2][Store.KEYS.wallpaperImg];
      wallPhoto = typeof wp === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(wp) && wp.indexOf('"') < 0 ? wp : null;
      state.items = st.items;
      state.settings = st.settings;
      state.device = st.device;
      state.updatedAt = st.meta ? st.meta.updatedAt : 0;
      state.rev = st.meta ? st.meta.rev : null;
      if (st.restored === 'sync' && state.items.length) setTimeout(function () { toast('Restored ' + plural(totalApps(), 'app') + ' from browser sync'); }, 700);
      else if (st.restored === 'snapshot') setTimeout(function () { toast('Recovered your apps from a backup'); }, 700);
    }).catch(function (e) { console.error('[Shelf] load failed', e); }).then(function () {
      applyTheme();
      setQuery('', true);
      refreshCurrentTab();
      renderHome();
      updateSettings();
      state.ready = true;
      rememberHeight();
      renderTodoDots(); refreshNotifPerm(); scheduleTodoCheck(); updateAppBadge();
      var splashing = !!splashEl && html.classList.contains('splash-on') && state.settings.splash;
      hideSplash();
      if (!splashing) introAnimation();
      if (IS_PAGE) handleIncoming();
      if (IS_WEB && !state.settings.onboarded && !state.items.length && !layers.length) setTimeout(function () { if (!layers.length) showWelcome(false); }, splashing ? 1900 : 250);
      if (IS_WEB) { idle(function () { requestPersist(false); }); setTimeout(maybeInstallBanner, 4500); }
      if (state.settings.showSearch && state.settings.autofocusSearch && state.items.length && !IS_TOUCH) setTimeout(function () { if (!layers.length) searchInput.focus({ preventScroll: true }); }, 30);
      idle(function () { Store.autoSnapshot(state.items, state.settings).catch(function () {}); checkRemote(); });
      return tabP;
    }).then(function () {
      refreshCurrentTab();
      if (state.currentTab && !state.items.length) renderEmpty();
      renderSuggest();
    });
  }

  /* Re-fit the grid when the window, device orientation or fold posture changes. */
  var fitRaf = 0;
  function onResize() {
    cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(function () {
      if (!IS_PAGE) return;
      if (pageLayout() && (state.settings.orientation === 'horizontal' || fv)) renderHome();
      renderDots();
    });
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.ResizeObserver && IS_PAGE) { try { new ResizeObserver(onResize).observe(homeEl); } catch (e) { /* ignore */ } }
  if (Store.channel) Store.channel.onmessage = function (e) {
    if (!e.data || e.data.origin === VIEW_ID) return;
    if (e.data.type === 'todos') { if (todosReady) reloadTodos(); return; }
    reloadFromStorage();
  };
  if (IS_WEB && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* offline support unavailable */ }); });
  }

  window.addEventListener('error', function (e) { console.error('[Shelf]', e.error || e.message); });
  init();

  window.__shelf = { state: state, render: renderHome, save: save, locate: locate };
})();
