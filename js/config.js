/*
 * ─────────────────────────────────────────────────────────────
 *  Shelf Shelf — configuration
 *  Edit this file, then click "Reload" on the extension card
 *  (chrome://extensions). Defaults only apply on first run or
 *  after Settings → Reset everything.
 * ─────────────────────────────────────────────────────────────
 */
// eslint-disable-next-line no-unused-vars
var SHELF_CONFIG = {
  /*
   * Pre-load the apps below on first run?
   *   false → the shelf starts empty (default)
   *   true  → the shelf starts with defaultApps
   */
  useDefaultApps: false,

  /*
   * Default apps (and folders). `name` and `icon` are optional:
   *   - name is derived from the URL when omitted
   *   - icon is fetched automatically when omitted; set it to an
   *     image URL (https://…) or a data:image/… URI for a custom logo
   */
  defaultApps: [
    { name: 'Gmail', url: 'https://mail.google.com/' },
    { name: 'Calendar', url: 'https://calendar.google.com/' },
    { name: 'Drive', url: 'https://drive.google.com/' },
    { name: 'YouTube', url: 'https://www.youtube.com/' },
    { name: 'GitHub', url: 'https://github.com/' },
    { name: 'ChatGPT', url: 'https://chatgpt.com/' },
    { name: 'Claude', url: 'https://claude.ai/' },
    { name: 'Notion', url: 'https://www.notion.so/' },
    // { name: 'My Tool', url: 'https://example.com', icon: 'https://example.com/logo.png' },
    // { type: 'folder', name: 'Work', apps: [ { name: 'Slack', url: 'https://app.slack.com/' } ] },
  ],

  /*
   * One-tap suggestions shown on the empty screen and in "New App".
   * Set to [] to hide them.
   */
  suggestions: [
    { name: 'Gmail', url: 'https://mail.google.com/' },
    { name: 'Calendar', url: 'https://calendar.google.com/' },
    { name: 'Drive', url: 'https://drive.google.com/' },
    { name: 'YouTube', url: 'https://www.youtube.com/' },
    { name: 'GitHub', url: 'https://github.com/' },
    { name: 'ChatGPT', url: 'https://chatgpt.com/' },
    { name: 'Claude', url: 'https://claude.ai/' },
    { name: 'LinkedIn', url: 'https://www.linkedin.com/' },
  ],

  /*
   * Default settings (users can change all of these in Settings).
   *   theme:        'system' | 'light' | 'dark'
   *   palette:      'classic' | 'graphite' | 'ocean' | 'forest' | 'sand' | 'rose' | 'midnight'
   *   accent:       any #RRGGBB color
   *   view:         'grid' | 'list'
   *   orientation:  'vertical' | 'horizontal'
   *   columns:      1–8  (apps per row, vertical icon view)
   *   listColumns:  1–3  (columns in vertical list view)
   *   rows:         1–6  (apps per column, horizontal)
   *   iconSize:     'small' | 'medium' | 'large'
   *   iconShape:    'rounded' | 'circle'
   */
  defaultSettings: {
    theme: 'system',
    palette: 'classic',
    accent: '#0A84FF',
    view: 'grid',
    orientation: 'vertical',
    columns: 4,
    listColumns: 1,
    rows: 2,
    iconSize: 'medium',
    iconShape: 'rounded',
    showNames: true,
    showSearch: true,
    autofocusSearch: true,
    openInBackground: false,
    sort: 'manual',        // 'manual' | 'name' | 'usage'
    glass: false,          // Liquid Glass look
    wallpaper: 'aurora',   // 'aurora' | 'sunset' | 'ocean' | 'meadow' | 'dusk' | 'mono' | 'accent'
    sync: true,            // keep a backup in the browser account + sync devices
  },

  /*
   * "Rate Shelf Shelf" (Settings → Help, and a one-time request after a few days of use).
   * {id} becomes the extension's ID, which on a store install is the store listing ID.
   * '' turns rating off for that store (e.g. until the Firefox or Safari listing is live).
   */
  reviewUrls: {
    chrome: 'https://chromewebstore.google.com/detail/bhhnembgfddoomakgmegbhkpklcgelhn/reviews',
    edge: 'https://microsoftedge.microsoft.com/addons/detail/{id}',
    firefox: '',   // e.g. 'https://addons.mozilla.org/firefox/addon/shelf-shelf/reviews/'
    safari: '',    // your App Store link, once published
  },
  /* When to ask for a rating: after this many days installed, opens, and different days used. Asked at most 3 times. */
  reviewPrompt: { afterDays: 4, afterOpens: 8, activeDays: 3 },

  /*
   * Optional: a URL for "Send Feedback" in Settings → Help (a form, GitHub issues or mailto:).
   * '' uses the Chrome Web Store support tab in Chrome, and hides the row elsewhere.
   */
  feedbackUrl: 'mailto:h24creationz@gmail.com	',
};
