/* Applies the last-used theme + size before first paint (no flash, no popup resize jump). */
(function () {
  var r = document.documentElement;
  try {
    if (/options\.html$/i.test(location.pathname) || /[?&]page=1\b/.test(location.search)) r.classList.add('page');
    var ext = (window.chrome && chrome.runtime && chrome.runtime.id) || (window.browser && browser.runtime && browser.runtime.id);
    if (!ext) { r.classList.add('page'); r.classList.add('web'); }
    var raw = null;
    try { raw = localStorage.getItem('shelf.boot'); } catch (e) { /* blocked */ }
    var b = raw ? JSON.parse(raw) : {};
    if (b.splash !== false && !/[?&](nosplash|add|url|text|q)=/.test(location.search)) r.classList.add('splash-on');
    if (b.reduced) r.classList.add('reduce-motion');

    if (!raw) return;
    var dark = b.theme === 'dark' || (b.theme === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    var vars = (dark ? b.dark : b.light) || {};
    var k;
    for (k in vars) if (/^--[\w-]+$/.test(k)) r.style.setProperty(k, String(vars[k]));
    for (k in b.layout || {}) if (/^--[\w-]+$/.test(k)) r.style.setProperty(k, String(b.layout[k]));
    r.setAttribute('data-scheme', dark ? 'dark' : 'light');
    if (b.glass) r.setAttribute('data-glass', '');
    if (b.photo && b.glass) {
      var ph = localStorage.getItem('shelf.bootPhoto');
      if (ph && ph.indexOf('"') < 0 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(ph.slice(0, 64) + 'A')) {
        r.style.setProperty('--wallpaper', (dark ? 'linear-gradient(rgba(0,0,0,.30),rgba(0,0,0,.30)),' : 'linear-gradient(rgba(255,255,255,.10),rgba(255,255,255,.10)),') + 'url("' + ph + '") center / cover no-repeat, ' + (vars['--bg'] || '#000'));
      }
    }
  } catch (e) { /* first run or storage blocked — CSS defaults apply */ }
})();
