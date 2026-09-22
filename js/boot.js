/* Applies the last-used theme + size before first paint (no flash, no popup resize jump). */
(function () {
  var r = document.documentElement;
  try {
    if (/options\.html$/i.test(location.pathname) || /[?&]page=1\b/.test(location.search)) r.classList.add('page');
    var ext = (window.chrome && chrome.runtime && chrome.runtime.id) || (window.browser && browser.runtime && browser.runtime.id);
    if (!ext) { r.classList.add('page'); r.classList.add('web'); }
    var raw = localStorage.getItem('shelf.boot');
    if (!raw) return;
    var b = JSON.parse(raw);
    var dark = b.theme === 'dark' || (b.theme === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    var vars = (dark ? b.dark : b.light) || {};
    var k;
    for (k in vars) if (/^--[\w-]+$/.test(k)) r.style.setProperty(k, String(vars[k]));
    for (k in b.layout || {}) if (/^--[\w-]+$/.test(k)) r.style.setProperty(k, String(b.layout[k]));
    r.setAttribute('data-scheme', dark ? 'dark' : 'light');
    if (b.glass) r.setAttribute('data-glass', '');
  } catch (e) { /* first run or storage blocked — CSS defaults apply */ }
})();
