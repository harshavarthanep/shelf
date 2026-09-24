# Shelf — website version (GitHub Pages)

This folder is the same Shelf app as a website you can install. Use it on phones, tablets and any browser that doesn't support extensions.

## Put it on GitHub Pages (5 minutes)

1. Create a new repository on GitHub, for example `shelf`.
2. Upload **everything in this folder** (keep the `css`, `js` and `icons` folders) to the root of the repo.
3. Open the repo's **Settings → Pages**. Under *Build and deployment*, set **Source: Deploy from a branch**, **Branch: main**, **Folder: / (root)**, then click **Save**.
4. After about a minute, your site is live at `https://<your-username>.github.io/shelf/`.

Any static host works too (Netlify, Vercel, Cloudflare Pages). It's plain HTML, CSS and JS with no build step.

## Install it like an app

- **iPhone / iPad (Safari):** tap Share → **Add to Home Screen**.
- **Android (Chrome):** open the menu (⋮) → **Install app**. Or use Settings → **Install App** in Shelf.
- **Desktop Chrome / Edge:** click the install icon in the address bar.
- **Mac Safari (Sonoma or later):** File → **Add to Dock**.

You don't have to remember these. A few seconds after the first visit, Shelf shows an **Install** card with the right steps for the visitor's browser (iPhone Safari, Chrome on iPhone, Android Chrome, Samsung Internet, Mac Safari, desktop Chrome and Edge). If someone taps **×**, the card stays hidden for 14 days. The steps are always available in **Settings → Install App**.

Installed, Shelf opens full screen and works offline. It also shows up in the Android **share sheet**: share any page to Shelf to add it.

## Add the page you're on from any browser (bookmarklet)

Create a bookmark with this as its URL. Replace the address with your own site:

```
javascript:location.href='https://YOUR-NAME.github.io/shelf/?add='+encodeURIComponent(location.href)+'&name='+encodeURIComponent(document.title)
```

Tap the bookmark on any page and Shelf opens with that page ready to add.

## First visit

New visitors see a short splash screen and a **Welcome** tour. **Settings → Help → How to Use Shelf** has the full guide. The splash can be turned off in **Settings → Behavior**.

## To-dos and reminders

Tap **+ → New To-Do**. Your lists appear as coloured dots on the home screen.

On the website, reminders appear while Shelf is open:
- a banner and a sound
- a system notification, if you allow notifications
- the overdue count in the tab title
- the overdue count on the app icon, when Shelf is installed

Browsers can't wake a website that isn't open, so for reminders that arrive even when Shelf is closed, use the browser extension.

## Keeping your apps safe on the web

- Apps are stored in the browser's IndexedDB. Shelf asks the browser for **protected storage** so it isn't cleared automatically.
- Clearing *this site's* data in your browser **does** delete them. Installing to the home screen gives the strongest protection, especially on iPhone.
- Shelf keeps your **last 10 versions** (Settings → Restore Previous Version).
- Use **Export Backup** now and then. The same file imports into the Chrome extension, and the other way round.

## Updating

Replace the files and change the `VERSION` line at the top of `sw.js`, for example to `shelf-web-2.2.1`. Visitors get the new version on their next visit.
