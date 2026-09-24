/*
 * Shelf core — pure, dependency-free helpers.
 * URL parsing, naming, validation, search, theming, layout.
 * Works in the browser (window.ShelfCore) and in Node (module.exports) for tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShelfCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var LIMITS = Object.freeze({ name: 60, folderName: 40, url: 2048, apps: 500, folders: 100, iconChars: 2000000 });
  var LOGO_VERSION = 3;
  var WEB = ['http:', 'https:'];
  var ALLOWED_SCHEMES = ['http:', 'https:', 'chrome:', 'edge:', 'brave:', 'vivaldi:', 'opera:', 'about:', 'mailto:'];

  /* ───────────────────────── utils ───────────────────────── */

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function fail(error) { return { ok: false, error: error }; }

  function uid() {
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    } catch (e) { /* ignore */ }
    return (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(0, 16);
  }

  function isIPv4(h) { return /^(\d{1,3}\.){3}\d{1,3}$/.test(h); }
  function isLocalHost(h) {
    return h === 'localhost' || /\.localhost$/.test(h) || isIPv4(h) || h.charAt(0) === '[';
  }

  /* ───────────────────────── URLs ───────────────────────── */

  function normalizeUrl(input) {
    if (typeof input !== 'string') return fail('Enter a website address');
    var s = input.trim().replace(/^[<"'`]+|[>"'`]+$/g, '').trim();
    if (!s) return fail('Enter a website address');
    if (s.length > LIMITS.url) return fail('That address is too long');
    // eslint-disable-next-line no-control-regex
    if (/[\s\u0000-\u001f\u007f]/.test(s)) return fail('Addresses can’t contain spaces');

    // plain e-mail address → mailto:
    if (/^[^\s@/:]+@[^\s@/:]+\.[a-z]{2,}$/i.test(s)) s = 'mailto:' + s;

    var auto = false;
    var hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(s);
    var hostPort = /^[a-z0-9.-]+:\d{1,5}(?:[/?#]|$)/i.test(s);
    if (!hasScheme || hostPort) {
      s = 'https://' + s.replace(/^\/+/, '');
      auto = true;
    }

    var u;
    try { u = new URL(s); } catch (e) { return fail('That doesn’t look like a valid address'); }
    var proto = u.protocol.toLowerCase();
    if (ALLOWED_SCHEMES.indexOf(proto) < 0) {
      return fail('“' + proto.replace(':', '') + ':” links aren’t supported');
    }
    if (WEB.indexOf(proto) >= 0) {
      var host = u.hostname;
      if (!host || host.charAt(0) === '.' || /\.\./.test(host) || host === '-') return fail('Add a domain, like example.com');
      if (auto && host.indexOf('.') < 0 && !isLocalHost(host)) return fail('Add a domain, like example.com');
      if (auto && isLocalHost(host)) u.protocol = 'http:';
      var tld = host.split('.').pop();
      if (auto && !isLocalHost(host) && !/^([a-z]{2,63}|xn--[a-z0-9-]+)$/i.test(tld)) return fail('Add a domain, like example.com');
    }
    return { ok: true, url: u.href };
  }

  function parse(url) { try { return new URL(url); } catch (e) { return null; } }

  function hostOf(url) {
    var u = parse(url);
    return u ? u.hostname.replace(/^www\./i, '').toLowerCase() : '';
  }

  function displayUrl(url) {
    var u = parse(url);
    if (!u) return String(url || '');
    if (WEB.indexOf(u.protocol) >= 0) {
      var host = safeUnicodeHost(u.hostname.replace(/^www\./i, ''));
      var rest = (u.port ? ':' + u.port : '') + (u.pathname === '/' ? '' : u.pathname) + u.search;
      return (host + rest).replace(/\/$/, '');
    }
    if (u.protocol === 'mailto:') return decodeSafe(u.pathname);
    return u.href.replace(/\/$/, '');
  }

  function sameUrl(a, b) {
    var ua = parse(a), ub = parse(b);
    if (!ua || !ub) return a === b;
    var k = function (u) {
      return (u.hostname.replace(/^www\./i, '') + (u.port ? ':' + u.port : '') + u.pathname.replace(/\/+$/, '') + u.search).toLowerCase();
    };
    return ua.protocol.replace('http:', 'https:') === ub.protocol.replace('http:', 'https:') && k(ua) === k(ub);
  }

  function decodeSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  /* ───────────────────────── punycode (RFC 3492 decode) ───────────────────────── */

  function punyDecode(input) {
    var base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
    var output = [], n = 128, bias = 72, i = 0;
    var basic = input.lastIndexOf('-');
    if (basic < 0) basic = 0;
    for (var j = 0; j < basic; j++) output.push(input.charCodeAt(j));
    function adapt(delta, numPoints, first) {
      var k = 0;
      delta = first ? Math.floor(delta / damp) : delta >> 1;
      delta += Math.floor(delta / numPoints);
      for (; delta > ((base - tMin) * tMax) >> 1; k += base) delta = Math.floor(delta / (base - tMin));
      return Math.floor(k + ((base - tMin + 1) * delta) / (delta + skew));
    }
    for (var idx = basic > 0 ? basic + 1 : 0; idx < input.length;) {
      var oldi = i, w = 1;
      for (var k = base; ; k += base) {
        if (idx >= input.length) throw new Error('punycode');
        var c = input.charCodeAt(idx++);
        var digit = c >= 48 && c <= 57 ? c - 22 : c >= 65 && c <= 90 ? c - 65 : c >= 97 && c <= 122 ? c - 97 : base;
        if (digit >= base) throw new Error('punycode');
        i += digit * w;
        var t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
        if (digit < t) break;
        w *= base - t;
      }
      var len = output.length + 1;
      bias = adapt(i - oldi, len, oldi === 0);
      n += Math.floor(i / len);
      i %= len;
      output.splice(i++, 0, n);
    }
    return String.fromCodePoint.apply(String, output);
  }

  function safeUnicodeHost(host) {
    return String(host).split('.').map(function (l) {
      if (!/^xn--/i.test(l)) return l;
      try { return punyDecode(l.slice(4).toLowerCase()); } catch (e) { return l; }
    }).join('.');
  }

  /* ───────────────────────── naming ───────────────────────── */

  var NAME_RULES = [
    [/^mail\.google\.com/, 'Gmail'], [/^gmail\.com/, 'Gmail'],
    [/^calendar\.google\.com/, 'Calendar'], [/^drive\.google\.com/, 'Drive'],
    [/^docs\.google\.com\/spreadsheets/, 'Sheets'], [/^docs\.google\.com\/presentation/, 'Slides'],
    [/^docs\.google\.com\/forms/, 'Forms'], [/^docs\.google\.com/, 'Docs'],
    [/^sheets\.google\.com/, 'Sheets'], [/^slides\.google\.com/, 'Slides'],
    [/^meet\.google\.com/, 'Meet'], [/^photos\.google\.com/, 'Photos'], [/^keep\.google\.com/, 'Keep'],
    [/^chat\.google\.com/, 'Google Chat'], [/^contacts\.google\.com/, 'Contacts'],
    [/^translate\.google\./, 'Translate'], [/^news\.google\./, 'Google News'], [/^gemini\.google\.com/, 'Gemini'],
    [/^maps\.google\./, 'Maps'], [/^google\.[a-z.]+\/maps/, 'Maps'], [/^analytics\.google\.com/, 'Analytics'],
    [/^console\.cloud\.google\.com/, 'Google Cloud'], [/^notebooklm\.google\.com/, 'NotebookLM'],
    [/^music\.youtube\.com/, 'YouTube Music'], [/^studio\.youtube\.com/, 'YouTube Studio'],
    [/^mail\.yahoo\.com/, 'Yahoo Mail'], [/^outlook\.(live|office|office365)\.com/, 'Outlook'],
    [/^teams\.(microsoft|live)\.com/, 'Teams'], [/^(www\.)?office\.com/, 'Microsoft 365'],
    [/^onedrive\.live\.com/, 'OneDrive'], [/^portal\.azure\.com/, 'Azure'],
    [/^console\.aws\.amazon\.com/, 'AWS Console'], [/^web\.whatsapp\.com/, 'WhatsApp'],
    [/^app\.slack\.com/, 'Slack'], [/^web\.telegram\.org/, 'Telegram'],
    [/^x\.com/, 'X'], [/^twitter\.com/, 'X'], [/^chat\.openai\.com/, 'ChatGPT'], [/^chatgpt\.com/, 'ChatGPT'],
    [/^claude\.ai/, 'Claude'], [/^open\.spotify\.com/, 'Spotify'], [/^app\.asana\.com/, 'Asana'],
    [/^linear\.app/, 'Linear'], [/^app\.hubspot\.com/, 'HubSpot'], [/^mail\.proton\.me/, 'Proton Mail'],
    [/^news\.ycombinator\.com/, 'Hacker News'], [/^en\.wikipedia\.org/, 'Wikipedia'],
  ];

  var BRAND_CASE = {
    github: 'GitHub', gitlab: 'GitLab', youtube: 'YouTube', linkedin: 'LinkedIn', chatgpt: 'ChatGPT',
    whatsapp: 'WhatsApp', paypal: 'PayPal', stackoverflow: 'Stack Overflow', hubspot: 'HubSpot',
    clickup: 'ClickUp', tiktok: 'TikTok', icloud: 'iCloud', openai: 'OpenAI', producthunt: 'Product Hunt',
    soundcloud: 'SoundCloud', wordpress: 'WordPress', imdb: 'IMDb', ebay: 'eBay', bbc: 'BBC', cnn: 'CNN',
    nytimes: 'NYTimes', duckduckgo: 'DuckDuckGo', digitalocean: 'DigitalOcean', huggingface: 'Hugging Face',
    leetcode: 'LeetCode', hackerrank: 'HackerRank', codepen: 'CodePen', stackblitz: 'StackBlitz',
    codesandbox: 'CodeSandbox', mongodb: 'MongoDB', quickbooks: 'QuickBooks', npmjs: 'npm', pypi: 'PyPI',
    salesforce: 'Salesforce', mailchimp: 'Mailchimp', youtu: 'YouTube', airbnb: 'Airbnb', netflix: 'Netflix',
    primevideo: 'Prime Video', hotstar: 'Hotstar', disneyplus: 'Disney+', hbomax: 'HBO Max', dribbble: 'Dribbble',
    deepl: 'DeepL', perplexity: 'Perplexity', grok: 'Grok', vercel: 'Vercel', supabase: 'Supabase',
    atlassian: 'Atlassian', zendesk: 'Zendesk', freshdesk: 'Freshdesk', jira: 'Jira', miro: 'Miro',
    bitbucket: 'Bitbucket', devto: 'DEV', substack: 'Substack', calendly: 'Calendly', typeform: 'Typeform',
  };

  function mainLabel(host) {
    var labels = String(host).toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
    if (labels.length <= 1) return labels[0] || '';
    var sld = ['co', 'com', 'net', 'org', 'gov', 'ac', 'edu', 'ne', 'or', 'go', 'gob', 'nic', 'mil', 'ltd', 'plc', 'sch'];
    var i = labels.length - 2;
    if (labels.length >= 3 && sld.indexOf(labels[i]) >= 0 && labels[labels.length - 1].length === 2) i -= 1;
    return labels[i];
  }

  function titleCase(label) {
    if (BRAND_CASE[label]) return BRAND_CASE[label];
    return label.split(/[-_]+/).filter(Boolean).map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  function deriveName(url) {
    var u = parse(url);
    if (!u) return '';
    if (u.protocol === 'mailto:') return decodeSafe(u.pathname).split('@')[0] || 'Email';
    if (WEB.indexOf(u.protocol) < 0) {
      var target = (u.host || u.pathname || '').replace(/^\/+/, '').split(/[/?#]/)[0];
      return target ? titleCase(target.toLowerCase()) : u.protocol.replace(':', '');
    }
    var host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
    var key = host + u.pathname;
    for (var r = 0; r < NAME_RULES.length; r++) {
      if (NAME_RULES[r][0].test(key)) return NAME_RULES[r][1];
    }
    if (isLocalHost(host)) return host + (u.port ? ':' + u.port : '');
    var label = safeUnicodeHost(mainLabel(host));
    return titleCase(label).slice(0, LIMITS.name) || host;
  }

  function monogram(name) {
    var s = String(name || '').trim();
    if (!s) return '?';
    var first;
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        var it = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)[Symbol.iterator]().next();
        first = it.value && it.value.segment;
      }
    } catch (e) { /* ignore */ }
    if (!first) first = Array.from(s)[0];
    return first.toLocaleUpperCase();
  }

  function hueOf(str) {
    var h = 2166136261;
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h) % 360;
  }

  var GRADIENTS = [
    ['#5AC8FA', '#007AFF'], ['#8E8CFF', '#5856D6'], ['#DA8FFF', '#AF52DE'], ['#FF7A95', '#FF2D55'],
    ['#FF8A7A', '#FF3B30'], ['#FFB35C', '#FF7A00'], ['#4A4A55', '#1C1C22'], ['#5EDB7A', '#20A847'],
    ['#63E6BE', '#0CA678'], ['#6FD8F0', '#1C9CB8'], ['#B89A74', '#86684A'], ['#A1A1A8', '#636368'],
  ];
  function gradientOf(str) { return GRADIENTS[hueOf(str) % GRADIENTS.length]; }

  /* ───────────────────────── icons ───────────────────────── */

  function isSafeImageSrc(src) {
    if (typeof src !== 'string' || !src || src.length > LIMITS.iconChars) return false;
    if (/^data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=\s]+$/i.test(src)) return true;
    var u = parse(src);
    return !!u && WEB.indexOf(u.protocol) >= 0 && src.length <= LIMITS.url;
  }

  function iconCandidates(url, hint) {
    var u = parse(url);
    if (!u || WEB.indexOf(u.protocol) < 0) return [];
    var list = [
      { src: 'https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=' + encodeURIComponent(u.origin) + '&size=128', min: 32, cors: true },
      { src: u.origin + '/apple-touch-icon.png', min: 57, bleed: true },
      { src: 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(u.hostname) + '&sz=128', min: 32 },
    ];
    if (hint && isSafeImageSrc(hint)) list.push({ src: hint, min: 16 });
    list.push({ src: u.origin + '/favicon.ico', min: 16 });
    return list;
  }

  /* ───────────────────────── validation ───────────────────────── */

  function sanitizeIcon(icon) {
    if (typeof icon === 'string') icon = { type: 'custom', src: icon };
    if (!isObj(icon)) return { type: 'auto' };
    if (icon.type === 'letter') return { type: 'letter' };
    if (icon.type === 'custom' && isSafeImageSrc(icon.src)) return { type: 'custom', src: icon.src };
    return { type: 'auto' };
  }

  function sanitizeCache(c, url) {
    if (!isObj(c) || c.url !== url || typeof c.at !== 'number') return null;
    if (c.src != null && !isSafeImageSrc(c.src)) return null;
    var out = { url: url, src: c.src || null, bleed: !!c.bleed, tiny: !!c.tiny, at: c.at, v: typeof c.v === 'number' ? c.v : 0 };
    if (typeof c.fit === 'number' && c.fit >= 0.3 && c.fit <= 1) out.fit = c.fit;
    return out;
  }

  function cleanText(raw, max) {
    // eslint-disable-next-line no-control-regex
    return (typeof raw === 'string' ? raw : '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  }
  function validId(id) { return typeof id === 'string' && /^[\w-]{1,64}$/.test(id); }
  function isFolder(x) { return isObj(x) && x.type === 'folder'; }

  function sanitizeApp(a) {
    if (!isObj(a) || a.type === 'folder') return null;
    var n = normalizeUrl(typeof a.url === 'string' ? a.url : '');
    if (!n.ok) return null;
    var name = cleanText(typeof a.name === 'string' ? a.name : a.title, LIMITS.name);
    if (!name) name = deriveName(n.url) || 'App';
    var app = {
      id: validId(a.id) ? a.id : uid(),
      name: name,
      url: n.url,
      icon: sanitizeIcon(a.icon),
    };
    if (a.hint && isSafeImageSrc(a.hint) && a.hint.length < 60000) app.hint = a.hint;
    if (a.dock === true || (typeof a.dock === 'number' && isFinite(a.dock))) app.dock = typeof a.dock === 'number' && a.dock > 0 ? Math.min(1e6, a.dock) : true;   // number = position in the Dock (1-based)
    if (isObj(a.logo) && isSafeImageSrc(a.logo.src) && app.icon.type === 'auto' && !a.cache) {
      a = Object.assign({}, a, { cache: { url: n.url, src: a.logo.src, bleed: !!a.logo.bleed, tiny: !!a.logo.tiny, fit: a.logo.fit, at: Date.now(), v: LOGO_VERSION } });
    }
    var cache = sanitizeCache(a.cache, n.url);
    if (cache && app.icon.type === 'auto') app.cache = cache;
    return app;
  }

  function sanitizeApps(list) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length && out.length < LIMITS.apps; i++) {
      var a = sanitizeApp(list[i]);
      if (!a) continue;
      if (seen[a.id]) a.id = uid();
      seen[a.id] = true;
      out.push(a);
    }
    return out;
  }

  /* ───────────────────────── items (apps + folders) ───────────────────────── */

  function sanitizeItems(list) {
    if (!Array.isArray(list)) return [];
    var seen = {}, out = [], n = { apps: 0, folders: 0 };
    function app(a) {
      if (n.apps >= LIMITS.apps) return null;
      var x = sanitizeApp(a);
      if (!x) return null;
      if (seen[x.id]) x.id = uid();
      seen[x.id] = true;
      n.apps++;
      if (typeof a.opens === 'number' && isFinite(a.opens) && a.opens > 0) x.opens = Math.min(1e7, Math.floor(a.opens));
      if (typeof a.last === 'number' && isFinite(a.last) && a.last > 0) x.last = a.last;
      return x;
    }
    function appsOf(f, into) {
      (Array.isArray(f.apps) ? f.apps : []).forEach(function (a) {
        if (isFolder(a)) appsOf(a, into); // nested folders are flattened
        else { var x = app(a); if (x) into.push(x); }
      });
    }
    list.forEach(function (it) {
      if (isFolder(it)) {
        if (n.folders >= LIMITS.folders) { appsOf(it, out); return; }
        var id = validId(it.id) && !seen[it.id] ? it.id : uid();
        seen[id] = true;
        n.folders++;
        var f = { id: id, type: 'folder', name: cleanText(it.name, LIMITS.folderName) || 'Folder', apps: [] };
        appsOf(it, f.apps);
        out.push(f);
      } else {
        var x = app(it);
        if (x) out.push(x);
      }
    });
    return out;
  }

  function flatten(items) {
    var out = [];
    (items || []).forEach(function (it) {
      if (isFolder(it)) it.apps.forEach(function (a) { out.push({ app: a, folder: it }); });
      else out.push({ app: it, folder: null });
    });
    return out;
  }
  function countApps(items) { return flatten(items).length; }
  function countFolders(items) { return (items || []).filter(isFolder).length; }

  function usageOf(x) { return isFolder(x) ? x.apps.reduce(function (s, a) { return s + (a.opens || 0); }, 0) : (x.opens || 0); }
  function lastOf(x) { return isFolder(x) ? x.apps.reduce(function (m, a) { return Math.max(m, a.last || 0); }, 0) : (x.last || 0); }
  function sortList(list, mode) {
    var arr = list.map(function (x, i) { return { x: x, i: i }; });
    if (mode === 'name') {
      arr.sort(function (p, q) { return String(p.x.name).localeCompare(String(q.x.name), undefined, { sensitivity: 'base', numeric: true }) || p.i - q.i; });
    } else if (mode === 'usage') {
      arr.sort(function (p, q) { return usageOf(q.x) - usageOf(p.x) || lastOf(q.x) - lastOf(p.x) || p.i - q.i; });
    }
    return arr.map(function (p) { return p.x; });
  }
  /* Bakes a sort mode into the stored order (used when switching to manual). */
  function applySortDeep(items, mode) {
    var out = sortList(items, mode);
    out.forEach(function (it) { if (isFolder(it)) it.apps = sortList(it.apps, mode); });
    return out;
  }

  function folderScore(f, q) {
    var n = fold(f.name);
    if (n === q) return 95;
    if (n.indexOf(q) === 0) return 85;
    return n.indexOf(q) >= 0 ? 65 : 0;
  }
  function searchItems(items, query) {
    var q = fold(query);
    if (!q) return items.slice();
    var res = [], order = 0;
    items.forEach(function (it) {
      if (isFolder(it)) {
        var fs = folderScore(it, q);
        if (fs) res.push({ x: it, s: fs, i: order++ });
        it.apps.forEach(function (a) { var s1 = score(a, q); if (s1) res.push({ x: a, s: s1, i: order++ }); });
      } else {
        var s2 = score(it, q);
        if (s2) res.push({ x: it, s: s2, i: order++ });
      }
    });
    res.sort(function (a, b) { return b.s - a.s || a.i - b.i; });
    return res.map(function (r) { return r.x; });
  }

  var CATEGORIES = [
    ['AI', /(chatgpt|openai|claude\.ai|anthropic|gemini\.google|perplexity|copilot|poe\.com|grok|mistral|deepseek|midjourney|huggingface)/],
    ['Developer', /(github|gitlab|bitbucket|stackoverflow|vercel|netlify|npmjs|codepen|console\.aws|portal\.azure|cloud\.google|supabase|heroku|atlassian|jira|localhost|replit|codesandbox|stackblitz|docker|render\.com|railway|figma\.com\/dev)/],
    ['Social', /(facebook|instagram|twitter|(^|\.)x\.com|linkedin|reddit|whatsapp|telegram|discord|messenger|threads|snapchat|tiktok|pinterest|mastodon|bsky|quora)/],
    ['Entertainment', /(youtube|netflix|spotify|twitch|primevideo|disneyplus|hulu|hbomax|max\.com|hotstar|soundcloud|music\.apple|tv\.apple|crunchyroll|jiocinema|imdb)/],
    ['Shopping', /(amazon\.|ebay|etsy|flipkart|walmart|target\.com|aliexpress|myntra|bestbuy|ikea)/],
    ['Finance', /(paypal|stripe|bank|chase|wise\.com|revolut|robinhood|coinbase|zerodha|groww|quickbooks|xero|splitwise)/],
    ['News', /(news|nytimes|bbc|cnn|theguardian|reuters|bloomberg|wsj|medium\.com|substack|ycombinator|verge|techcrunch)/],
    ['Design', /(figma|canva|dribbble|behance|adobe|framer|sketch|unsplash|miro)/],
    ['Productivity', /(mail\.|calendar|drive\.|docs\.|notion|office|outlook|asana|trello|monday|clickup|linear\.app|todoist|evernote|airtable|dropbox|icloud|slack|zoom|meet\.|teams\.|keep\.|onedrive|box\.com|calendly)/],
  ];
  function categoryOf(url) {
    var u = parse(url);
    if (!u) return null;
    var key = u.hostname.toLowerCase() + u.pathname;
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i][1].test(key)) return CATEGORIES[i][0];
    return null;
  }
  function guessFolderName(apps) {
    var tally = {}, best = null;
    (apps || []).forEach(function (a) {
      var c = categoryOf(a.url);
      if (!c) return;
      tally[c] = (tally[c] || 0) + 1;
      if (!best || tally[c] > tally[best]) best = c;
    });
    return best || 'Folder';
  }

  /* Compact form for browser sync (small, no caches, no uploaded images). */
  function compactForSync(items) {
    function app(a) {
      var o = { i: a.id, n: a.name, u: a.url };
      if (a.hint && !/^data:/i.test(a.hint) && a.hint.length <= 300) o.h = a.hint;
      if (a.dock) o.k = typeof a.dock === 'number' ? a.dock + 1 : 1;
      if (a.icon.type === 'letter') o.c = 'letter';
      else if (a.icon.type === 'custom') { if (/^data:/i.test(a.icon.src)) o.d = 1; else o.c = a.icon.src; }
      return o;
    }
    return items.map(function (it) { return isFolder(it) ? { i: it.id, f: it.name, a: it.apps.map(app) } : app(it); });
  }
  /* Rebuilds items from sync, keeping device-only data (uploaded logos, caches, usage). */
  function mergeSynced(compact, localItems) {
    var byId = {}, byUrl = {};
    flatten(localItems || []).forEach(function (e) { byId[e.app.id] = e.app; if (!byUrl[e.app.url]) byUrl[e.app.url] = e.app; });
    function app(c) {
      c = isObj(c) ? c : {};
      var o = { id: c.i, name: c.n, url: c.u, icon: c.c === 'letter' ? { type: 'letter' } : c.c ? { type: 'custom', src: c.c } : { type: 'auto' } };
      if (typeof c.h === 'string') o.hint = c.h;
      if (c.k) o.dock = typeof c.k === 'number' && c.k > 1 ? c.k - 1 : true;
      var l = byId[c.i] || byUrl[c.u];
      if (l) {
        if (c.d && l.icon && l.icon.type === 'custom') o.icon = l.icon;
        if (l.cache && l.url === o.url) o.cache = l.cache;
        if (l.hint && !o.hint) o.hint = l.hint;
        if (l.opens) o.opens = l.opens;
        if (l.last) o.last = l.last;
      }
      return o;
    }
    var raw = (Array.isArray(compact) ? compact : []).map(function (c) {
      return isObj(c) && typeof c.f === 'string' ? { id: c.i, type: 'folder', name: c.f, apps: (Array.isArray(c.a) ? c.a : []).map(app) } : app(c);
    });
    return sanitizeItems(raw);
  }

  /* Union for a first-time sync between two devices that both have apps: nothing is lost. */
  function unionItems(primary, secondary) {
    var out = sanitizeItems(JSON.parse(JSON.stringify(primary || [])));
    var have = {};
    flatten(out).forEach(function (e) { have[e.app.url] = true; });
    var fid = {};
    out.forEach(function (it) { if (isFolder(it)) fid[it.name.toLowerCase()] = it; });
    sanitizeItems(JSON.parse(JSON.stringify(secondary || []))).forEach(function (it) {
      if (isFolder(it)) {
        var fresh = it.apps.filter(function (a) { return !have[a.url]; });
        if (!fresh.length && fid[it.name.toLowerCase()]) return;
        var target = fid[it.name.toLowerCase()];
        if (!target) { target = { id: it.id, type: 'folder', name: it.name, apps: [] }; out.push(target); fid[it.name.toLowerCase()] = target; }
        fresh.forEach(function (a) { have[a.url] = true; target.apps.push(a); });
      } else if (!have[it.url]) { have[it.url] = true; out.push(it); }
    });
    return sanitizeItems(out);
  }

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  /* ───────────────────────── colors & themes ───────────────────────── */

  function normHex(v) {
    if (typeof v !== 'string') return null;
    var s = v.trim();
    if (/^#[0-9a-f]{3}$/i.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    return /^#[0-9a-f]{6}$/i.test(s) ? s.toUpperCase() : null;
  }
  function rgb(hex) {
    var h = normHex(hex) || '#000000';
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function toHex(c) {
    return '#' + c.map(function (x) { return clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0'); }).join('').toUpperCase();
  }
  function rgba(hex, a) { var c = rgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function mix(a, b, t) { var x = rgb(a), y = rgb(b); return toHex([0, 1, 2].map(function (i) { return x[i] + (y[i] - x[i]) * t; })); }
  function luminance(hex) {
    var c = rgb(hex).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrastRatio(a, b) {
    var l1 = luminance(a), l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function readableOn(hex) { return luminance(hex) > 0.5 ? '#000000' : '#FFFFFF'; }

  var PALETTES = {
    classic:  { name: 'Classic',  light: { bg: '#F2F2F7', surface: '#FFFFFF', text: '#1C1C1E' }, dark: { bg: '#1C1C1E', surface: '#2C2C2E', text: '#F5F5F7' } },
    graphite: { name: 'Graphite', light: { bg: '#E9E9EB', surface: '#F8F8F9', text: '#1D1D1F' }, dark: { bg: '#0F0F10', surface: '#1E1E20', text: '#ECECEE' } },
    ocean:    { name: 'Ocean',    light: { bg: '#E8F0F9', surface: '#FFFFFF', text: '#0E2233' }, dark: { bg: '#0A1522', surface: '#142338', text: '#E4EEF9' } },
    forest:   { name: 'Forest',   light: { bg: '#EBF1EA', surface: '#FFFFFF', text: '#15261A' }, dark: { bg: '#0C1510', surface: '#17241B', text: '#E3EFE5' } },
    sand:     { name: 'Sand',     light: { bg: '#F4EEE5', surface: '#FFFCF7', text: '#2A2017' }, dark: { bg: '#191511', surface: '#27211B', text: '#F2EADF' } },
    rose:     { name: 'Rosé', light: { bg: '#F9EDF0', surface: '#FFFFFF', text: '#2D1720' }, dark: { bg: '#1B1014', surface: '#2A1A20', text: '#F7E7EC' } },
    midnight: { name: 'Midnight', light: { bg: '#EBEDF7', surface: '#FFFFFF', text: '#171A33' }, dark: { bg: '#0B0D1B', surface: '#16192F', text: '#E7E9FA' } },
  };

  var ACCENTS = ['#0A84FF', '#5E5CE6', '#BF5AF2', '#FF375F', '#FF453A', '#FF9F0A', '#30D158', '#40C8E0', '#8E8E93'];

  var BASE_SETTINGS = Object.freeze({
    theme: 'system', palette: 'classic', accent: '#0A84FF',
    custom: { enabled: false, light: { bg: null, surface: null, text: null }, dark: { bg: null, surface: null, text: null } },
    view: 'grid', orientation: 'vertical', columns: 4, listColumns: 1, rows: 2,
    iconSize: 'medium', iconShape: 'rounded', showNames: true,
    showSearch: true, autofocusSearch: true, openInBackground: false,
    sort: 'manual', glass: false, wallpaper: 'aurora', sync: true,
    openIn: 'new', density: 'regular', glassStyle: 'frosted', motion: 'full',
    splash: true, haptics: true, suggestSite: true, onboarded: false,
    windowSize: 'standard', logoColor: 'accent', webSearch: 'google', showDock: true,
    todoHome: true, todoBadge: true, todoNotify: true, todoSound: true, todoHideDone: false, todoSnooze: '10', todoSort: 'manual',
  });

  var ENUMS = {
    theme: ['system', 'light', 'dark'],
    palette: Object.keys(PALETTES),
    view: ['grid', 'list'],
    orientation: ['vertical', 'horizontal'],
    iconSize: ['small', 'medium', 'large'],
    iconShape: ['rounded', 'circle', 'square'],
    sort: ['manual', 'name', 'usage'],
    openIn: ['new', 'background', 'current'],
    density: ['compact', 'regular', 'spacious'],
    glassStyle: ['frosted', 'clear', 'tinted'],
    motion: ['full', 'reduced'],
    windowSize: ['compact', 'standard', 'large'],
    logoColor: ['accent', 'classic', 'mono'],
    webSearch: ['google', 'duckduckgo', 'bing', 'brave', 'off'],
    todoSnooze: ['5', '10', '15', '30', '60'],
    todoSort: ['manual', 'due', 'priority'],
    wallpaper: ['aurora', 'sunset', 'ocean', 'meadow', 'dusk', 'mono', 'accent', 'photo'],
  };

  function sanitizeSettings(input, defaults) {
    var d = isObj(defaults) ? defaults : BASE_SETTINGS;
    var i = isObj(input) ? input : {};
    function pick(k) {
      var a = ENUMS[k];
      return a.indexOf(i[k]) >= 0 ? i[k] : a.indexOf(d[k]) >= 0 ? d[k] : BASE_SETTINGS[k];
    }
    function int(k, lo, hi) {
      var v = typeof i[k] === 'number' ? i[k] : typeof i[k] === 'string' && i[k].trim() ? Number(i[k]) : NaN;
      if (Number.isFinite(v)) return clamp(Math.round(v), lo, hi);
      var dv = Number(d[k]);
      return Number.isFinite(dv) ? clamp(Math.round(dv), lo, hi) : BASE_SETTINGS[k];
    }
    function bool(k) { return typeof i[k] === 'boolean' ? i[k] : typeof d[k] === 'boolean' ? d[k] : BASE_SETTINGS[k]; }
    function cset(o) { o = isObj(o) ? o : {}; return { bg: normHex(o.bg), surface: normHex(o.surface), text: normHex(o.text) }; }
    var ci = isObj(i.custom) ? i.custom : isObj(d.custom) ? d.custom : {};
    return withDerived({
      theme: pick('theme'),
      palette: pick('palette'),
      accent: normHex(i.accent) || normHex(d.accent) || BASE_SETTINGS.accent,
      custom: { enabled: ci.enabled === true, light: cset(ci.light), dark: cset(ci.dark) },
      view: pick('view'),
      orientation: pick('orientation'),
      columns: int('columns', 1, 8),
      listColumns: int('listColumns', 1, 3),
      rows: int('rows', 1, 6),
      iconSize: pick('iconSize'),
      iconShape: pick('iconShape'),
      showNames: bool('showNames'),
      showSearch: bool('showSearch'),
      autofocusSearch: bool('autofocusSearch'),
      openIn: ENUMS.openIn.indexOf(i.openIn) >= 0 ? i.openIn : i.openInBackground === true ? 'background' : pick('openIn'),
      openInBackground: false,
      sort: pick('sort'),
      glass: bool('glass'),
      wallpaper: pick('wallpaper'),
      sync: bool('sync'),
      density: pick('density'),
      glassStyle: pick('glassStyle'),
      motion: pick('motion'),
      splash: bool('splash'),
      haptics: bool('haptics'),
      suggestSite: bool('suggestSite'),
      onboarded: bool('onboarded'),
      windowSize: pick('windowSize'),
      logoColor: pick('logoColor'),
      webSearch: pick('webSearch'),
      showDock: bool('showDock'),
      todoHome: bool('todoHome'),
      todoBadge: bool('todoBadge'),
      todoNotify: bool('todoNotify'),
      todoSound: bool('todoSound'),
      todoHideDone: bool('todoHideDone'),
      todoSnooze: pick('todoSnooze'),
      todoSort: pick('todoSort'),
    });
  }

  function withDerived(st) { st.openInBackground = st.openIn === 'background'; return st; }

  function blobs(base, a, b, c) {
    return 'radial-gradient(60% 55% at 12% 8%, ' + a + ' 0%, transparent 70%),' +
      'radial-gradient(55% 50% at 92% 22%, ' + b + ' 0%, transparent 70%),' +
      'radial-gradient(70% 60% at 45% 105%, ' + c + ' 0%, transparent 70%),' + base;
  }
  var WALLPAPERS = {
    aurora: { name: 'Aurora', light: ['#E4E9F7', '#9DBEFF', '#F3B2FF', '#8FEBD8'], dark: ['#0A0C18', '#2F4FD6', '#8A2BA6', '#0E7C86'] },
    sunset: { name: 'Sunset', light: ['#FBEFE6', '#FFC98F', '#FF9FB0', '#D9B8FF'], dark: ['#150A0E', '#D9530B', '#B81F55', '#5A36C2'] },
    ocean:  { name: 'Ocean',  light: ['#E3F1FC', '#7CC4FF', '#6DE6C3', '#A9C7FF'], dark: ['#06111E', '#1462B0', '#08806A', '#3143C4'] },
    meadow: { name: 'Meadow', light: ['#EFF8E6', '#B7EFA9', '#FFE58A', '#8DEBD0'], dark: ['#08120A', '#2C8A3F', '#7C8A10', '#0B6E7A'] },
    dusk:   { name: 'Dusk',   light: ['#EEE8F6', '#C5B3FF', '#FFB3D1', '#9FC9FF'], dark: ['#0D0A17', '#5B3CC4', '#A3246B', '#1D4FA8'] },
    mono:   { name: 'Mono',   light: ['#EEEFF2', '#D4D7DE', '#FFFFFF', '#C7CCD6'], dark: ['#0B0B0D', '#3A3D45', '#1D1F24', '#50545E'] },
    accent: { name: 'Accent', light: null, dark: null },
  };
  // Your own photo (device-only). Colours fall back to Aurora while it loads or on other devices.
  WALLPAPERS.photo = { name: 'Photo', light: WALLPAPERS.aurora.light, dark: WALLPAPERS.aurora.dark };
  function wallpaperColors(s, dark) {
    var w = WALLPAPERS[s.wallpaper] || WALLPAPERS.aurora;
    var c = dark ? w.dark : w.light;
    if (!c) {
      var a = normHex(s.accent) || BASE_SETTINGS.accent;
      c = dark ? [mix(a, '#000000', 0.9), mix(a, '#000000', 0.25), mix(a, '#8E44FF', 0.45), mix(a, '#00C2A8', 0.4)]
               : [mix(a, '#FFFFFF', 0.9), mix(a, '#FFFFFF', 0.35), mix(a, '#FF9FD1', 0.55), mix(a, '#9FF0DC', 0.5)];
    }
    return c;
  }
  function wallpaperCss(s, dark) { var c = wallpaperColors(s, dark); return blobs(c[0], c[1], c[2], c[3]); }

  function baseColors(s, dark) {
    if (s.glass) {
      var cg = s.custom && s.custom.enabled ? s.custom[dark ? 'dark' : 'light'] || {} : {};
      return { bg: cg.bg || wallpaperColors(s, dark)[0], surface: cg.surface || '#FFFFFF', text: cg.text || (dark ? '#FFFFFF' : '#15171C') };
    }
    var pal = (PALETTES[s.palette] || PALETTES.classic)[dark ? 'dark' : 'light'];
    var c = s.custom && s.custom.enabled ? s.custom[dark ? 'dark' : 'light'] || {} : {};
    return { bg: c.bg || pal.bg, surface: c.surface || pal.surface, text: c.text || pal.text };
  }

  function accentOf(s) { return normHex(s.accent) || BASE_SETTINGS.accent; }
  function computeTheme(s, dark) {
    var b = baseColors(s, dark);
    var accent = normHex(s.accent) || BASE_SETTINGS.accent;
    var deep = luminance(b.bg) < 0.2;
    return {
      '--bg': b.bg,
      '--bg-page': mix(b.bg, b.text, deep ? 0.03 : 0.035),
      '--surface': b.surface,
      '--text': b.text,
      '--text-2': rgba(b.text, 0.6),
      '--text-3': rgba(b.text, 0.36),
      '--fill': rgba(b.text, 0.07),
      '--fill-2': rgba(b.text, 0.13),
      '--separator': rgba(b.text, deep ? 0.15 : 0.12),
      '--accent': accent,
      '--on-accent': readableOn(accent),
      '--accent-soft': rgba(accent, 0.2),
      '--bg-glass': rgba(b.bg, 0.8),
      '--surface-glass': rgba(b.surface, 0.9),
      '--thumb': s.glass ? (dark ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.95)') : deep ? mix(b.surface, '#FFFFFF', 0.18) : '#FFFFFF',
      '--shadow': deep ? 'rgba(0,0,0,.5)' : 'rgba(0,0,0,.14)',
      '--wallpaper': s.glass ? (s.custom && s.custom.enabled && (s.custom[dark ? 'dark' : 'light'] || {}).bg ? b.bg : wallpaperCss(s, dark)) : 'none',
      '--glass': s.glassStyle === 'clear' ? rgba(b.surface, dark ? 0.05 : 0.2) : s.glassStyle === 'tinted' ? rgba(mix(b.surface, accentOf(s), dark ? 0.55 : 0.28), dark ? 0.2 : 0.45) : rgba(b.surface, dark ? 0.1 : 0.4),
      '--glass-strong': s.glassStyle === 'clear' ? rgba(b.surface, dark ? 0.09 : 0.36) : s.glassStyle === 'tinted' ? rgba(mix(b.surface, accentOf(s), dark ? 0.55 : 0.25), dark ? 0.26 : 0.62) : rgba(b.surface, dark ? 0.14 : 0.62),
      '--glass-edge': dark ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.75)',
      '--glass-hi': dark ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.95)',
      '--glass-tint': dark ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.25)',
      '--brand-a': s.logoColor === 'classic' ? '#4C8DFF' : s.logoColor === 'mono' ? (dark ? '#8E8E93' : '#48484A') : mix(accent, '#FFFFFF', 0.18),
      '--brand-b': s.logoColor === 'classic' ? '#5B4FE0' : s.logoColor === 'mono' ? (dark ? '#48484A' : '#1C1C1E') : mix(accent, '#000000', 0.16),
    };
  }

  var ICON_PX = { small: 46, medium: 56, large: 66 };
  var ROW_ICON_PX = { small: 28, medium: 32, large: 38 };

  function computeLayout(s) {
    var icon = ICON_PX[s.iconSize] || 56;
    var width;
    if (s.view === 'grid') {
      var cell = icon + (s.showNames ? 26 : 16) + (s.density === 'compact' ? -6 : s.density === 'spacious' ? 10 : 0);
      var cols = s.orientation === 'vertical' ? s.columns : 4;
      width = 32 + cols * cell + (cols - 1) * 4;
    } else {
      var lc = s.orientation === 'vertical' ? s.listColumns : 1;
      width = s.orientation === 'vertical' ? 24 + lc * 250 + (lc - 1) * 8 : 380;
    }
    // Popup window: a phone-sized canvas by default (Chrome allows up to 800 × 600).
    var W = { compact: [360, 520], standard: [400, 600], large: [480, 600] }[s.windowSize] || [400, 600];
    width = clamp(Math.round(Math.max(width, W[0])), 340, 780);
    return {
      width: width,
      vars: {
        '--popup-w': width + 'px',
        '--popup-h': W[1] + 'px',
        '--icon': icon + 'px',
        '--row-icon': (ROW_ICON_PX[s.iconSize] || 32) + 'px',
        '--cols': String(s.view === 'list' ? s.listColumns : s.columns),
        '--rows': String(s.rows),
        '--tile-r': s.iconShape === 'circle' ? '50%' : s.iconShape === 'square' ? '13%' : '23%',
        '--row-gap': s.density === 'compact' ? '10px' : s.density === 'spacious' ? '24px' : '16px',
        '--list-h': s.density === 'compact' ? '44px' : s.density === 'spacious' ? '60px' : '52px',
      },
    };
  }

  /* ───────────────────────── search ───────────────────────── */

  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  function score(app, q) {
    var name = fold(app.name);
    var host = fold(hostOf(app.url));
    var url = fold(app.url);
    if (name === q) return 100;
    if (name.indexOf(q) === 0) return 90;
    var words = name.split(/[\s\-_.]+/);
    for (var i = 0; i < words.length; i++) if (words[i].indexOf(q) === 0) return 80;
    if (name.indexOf(q) >= 0) return 70;
    if (host.indexOf(q) === 0) return 60;
    if (host.indexOf(q) >= 0) return 50;
    if (url.indexOf(q) >= 0) return 40;
    // subsequence on name ("gml" → Gmail)
    // compact subsequence on name ("gml" → Gmail), must start at a word boundary
    if (q.length < 2) return 0;
    for (var st = 0; st < name.length; st++) {
      if (name[st] !== q[0] || (st > 0 && /[a-z0-9]/.test(name[st - 1]))) continue;
      var j = 1, k2 = st + 1;
      for (; k2 < name.length && j < q.length; k2++) if (name[k2] === q[j]) j++;
      if (j === q.length && k2 - st <= q.length * 2 + 2) return 20;
    }
    return 0;
  }

  function filterApps(apps, query) {
    var q = fold(query);
    if (!q) return apps.slice();
    return apps
      .map(function (a, i) { return { a: a, i: i, s: score(a, q) }; })
      .filter(function (x) { return x.s > 0; })
      .sort(function (x, y) { return y.s - x.s || x.i - y.i; })
      .map(function (x) { return x.a; });
  }

  /* ───────────────────────── import / export ───────────────────────── */

  /* logos (optional): { url: small data: image } — the device copy, so a restored backup shows logos instantly, even offline. */
  function exportPayload(items, settings, version, logos, todos) {
    function app(a) {
      var o = { name: a.name, url: a.url };
      if (a.icon && a.icon.type !== 'auto') o.icon = a.icon;
      if (a.hint) o.hint = a.hint;
      var auto = !a.icon || a.icon.type === 'auto';
      var c = a.cache && a.cache.url === a.url ? a.cache : null;
      var local = logos && typeof logos[a.url] === 'string' && isSafeImageSrc(logos[a.url]) ? logos[a.url] : null;
      if (auto && (local || (c && c.src))) {
        o.logo = { src: local || c.src, bleed: !!(c && c.bleed), tiny: !!(c && c.tiny) };
        if (c && c.fit) o.logo.fit = c.fit;
      }
      if (a.opens) o.opens = a.opens;
      if (a.dock) o.dock = a.dock;
      return o;
    }
    return {
      app: 'Shelf',
      schema: 2,
      version: version || '2',
      exportedAt: new Date().toISOString(),
      items: items.map(function (it) { return isFolder(it) ? { type: 'folder', name: it.name, apps: it.apps.map(app) } : app(it); }),
      settings: settings,
      todos: todos || undefined,
    };
  }

  function parseImport(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('The file is empty');
    if (text.length > 20000000) throw new Error('The file is too large');
    var data;
    try { data = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { throw new Error('This isn’t a valid backup file'); }
    var raw = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.items) ? data.items : isObj(data) && Array.isArray(data.apps) ? data.apps : null;
    var todos = isObj(data) && isObj(data.todos) ? data.todos : null;
    if (!raw && todos) raw = [];
    if (!raw) throw new Error('No apps found in this file');
    function strip(a) {
      if (!isObj(a)) return a;
      var copy = {};
      for (var k in a) if (Object.prototype.hasOwnProperty.call(a, k) && k !== 'id' && k !== 'cache') copy[k] = a[k];
      if (isFolder(a)) copy.apps = (Array.isArray(a.apps) ? a.apps : []).map(strip);
      return copy;
    }
    var rawCount = 0;
    raw.forEach(function (a) { rawCount += isFolder(a) && Array.isArray(a.apps) ? a.apps.length : isFolder(a) ? 0 : 1; });
    var items = sanitizeItems(raw.map(strip));
    var count = countApps(items);
    var todoCount = todos && Array.isArray(todos.tasks) ? todos.tasks.filter(function (t) { return isObj(t) && !t.deleted; }).length : 0;
    if (!count && !countFolders(items) && !todoCount) throw new Error('No valid apps found in this file');
    return { items: items, apps: flatten(items).map(function (e) { return e.app; }), settings: isObj(data) && isObj(data.settings) ? data.settings : null, skipped: Math.max(0, rawCount - count), todos: todos, todoCount: todoCount };
  }

  return {
    LOGO_VERSION: LOGO_VERSION, unionItems: unionItems,
    LIMITS: LIMITS, PALETTES: PALETTES, ACCENTS: ACCENTS, BASE_SETTINGS: BASE_SETTINGS, WALLPAPERS: WALLPAPERS,
    isFolder: isFolder, sanitizeItems: sanitizeItems, flatten: flatten, countApps: countApps, countFolders: countFolders,
    sortList: sortList, applySortDeep: applySortDeep, searchItems: searchItems, guessFolderName: guessFolderName,
    categoryOf: categoryOf, compactForSync: compactForSync, mergeSynced: mergeSynced, hashStr: hashStr,
    wallpaperCss: wallpaperCss, wallpaperColors: wallpaperColors, cleanText: cleanText,
    uid: uid, clamp: clamp, normalizeUrl: normalizeUrl, hostOf: hostOf, displayUrl: displayUrl, sameUrl: sameUrl,
    deriveName: deriveName, monogram: monogram, hueOf: hueOf, gradientOf: gradientOf, punyDecode: punyDecode,
    isSafeImageSrc: isSafeImageSrc, iconCandidates: iconCandidates,
    sanitizeApp: sanitizeApp, sanitizeApps: sanitizeApps, sanitizeSettings: sanitizeSettings, sanitizeIcon: sanitizeIcon,
    normHex: normHex, mix: mix, rgba: rgba, luminance: luminance, contrastRatio: contrastRatio,
    baseColors: baseColors, computeTheme: computeTheme, computeLayout: computeLayout,
    filterApps: filterApps, exportPayload: exportPayload, parseImport: parseImport,
  };
});
