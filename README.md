# Bullet Journal — iOS PWA

A local-first, analog-inspired bullet journal. All data lives in **IndexedDB**
on-device (nothing is sent to a server), and the app is built to be added to
an iPhone home screen as a standalone PWA.

## What's in this folder

```
App.jsx              the entire app — one React component, IndexedDB layer,
                      and all views (Daily / Monthly / Future / Collections)
manifest.json         PWA manifest (icons, standalone display, theme color)
sw.js                 service worker (stale-while-revalidate, iOS-aware)
icons/                app icons (placeholders — swap in your own artwork)

index.html            production entry point → loads /src/main.jsx (Vite)
quickstart.html        zero-build entry point → transpiles App.jsx in the
                      browser with Babel standalone. Great for instantly
                      testing on your phone; not what you should ship.
src/main.jsx          Vite entry that mounts <App />
src/index.css         Tailwind directives
tailwind.config.js
postcss.config.js
vite.config.js         production build config (uses vite-plugin-pwa to
                      precompile the service worker)
package.json
```

## Fastest way to try it on your iPhone (no build step)

1. Serve this folder over HTTPS (iOS refuses to install PWAs or register
   service workers over plain HTTP, `localhost` on the same device is the
   one exception). The easiest options:
   - `npx serve .` on your laptop, then use a tunnel like `npx localtunnel --port 3000`
     or Cloudflare's `cloudflared tunnel --url http://localhost:3000`
   - or just deploy straight to Vercel/Netlify (drag-and-drop this folder — see below)
2. On your iPhone, open **`quickstart.html`** in Safari.
3. Tap the **Share** icon → **Add to Home Screen**.
4. Launch it from the home screen icon — it now runs standalone (no Safari
   chrome), with the service worker caching the shell for offline use.

## Production build (recommended before real deployment)

The quickstart page pulls React, Babel, and Tailwind from a CDN and
transpiles JSX in the browser on every load — fine for testing, wasteful for
daily use. For the real deployment:

```bash
npm install
npm run build      # outputs to dist/
npm run preview    # sanity-check the production build locally
```

Then deploy the `dist/` folder to any static host (Vercel, Netlify, GitHub
Pages, Cloudflare Pages, S3+CloudFront). Point your iPhone at that URL and
use **Add to Home Screen** the same way as above. `index.html` in this build
is the one that ships — `quickstart.html` isn't part of the Vite build and
you can leave it out of `dist/`.

## Icons

Placeholder icons (a simple bullet-and-rule mark on the paper background)
are already generated in `icons/`. Replace them with your own artwork at the
same file names and dimensions:

| File | Size | Purpose |
|---|---|---|
| `icon-192.png` | 192×192 | Android/general |
| `icon-512.png` | 512×512 | Android/general |
| `icon-maskable-192.png` | 192×192 | Android adaptive icon (keep the mark inside the middle ~66%) |
| `icon-maskable-512.png` | 512×512 | Android adaptive icon |
| `apple-touch-icon.png` | 180×180 | iOS home screen icon |

## How the data model works

Everything is stored in IndexedDB (`bujo-db`), in three object stores:

- **entries** — every bullet you log. Fields: `text`, `type`
  (`task`/`event`/`note`), `priority` (bool), `status` (tasks only: `open` /
  `done` / `migrated` / `scheduled` / `irrelevant`), `date` (daily log day),
  `monthKey` (for open-ended monthly tasks), `futureKey` (for Future Log
  items), `collectionId` (if logged directly into a collection), `threadId`
  (if a daily bullet is linked/"threaded" to a collection page).
- **collections** — your custom Index pages (`name`, `createdAt`).
- **meta** — small key/value data, currently used for the 1–5 daily mood dots
  (`mood-YYYY-MM-DD`).

IndexedDB is used instead of `localStorage` specifically because iOS Safari
is aggressive about purging localStorage/WebSQL after ~7 days of inactivity
in some configurations, while IndexedDB backed by standalone-mode PWAs is
significantly more durable. Even so: **use Settings → Export backup JSON**
periodically — no local storage mechanism on iOS is guaranteed forever, and
the export is a plain JSON file you can re-import any time via **Import
backup JSON**, or keep in iCloud Drive/Files as a safety net.

## Feature map

- **Rapid Logging bar** (bottom-docked): tap a type chip (Task/Event/Note) or
  type a leading `•` `*` `○` `—` character to auto-select the signifier; the
  ★ Priority toggle adds a star next to the bullet.
- **Daily Log**: today's stream, a 1–5 mood/weather dot tracker, and an
  **End of Day Reflection** button once any tasks are still open.
- **Reflection Mode**: full-screen, one task at a time — Complete / Migrate
  → tomorrow / Schedule → a future month / mark Irrelevant. Each action maps
  to the classic BuJo signifier change (`X`, `→`, `←`, struck-through).
- **Monthly Log**: dual-pane — a vertical date list on top for anything
  logged on a specific day that month, and open-ended Monthly Tasks below.
- **Future Log**: a 12-month grid; tap a month to expand it and log directly
  into that slot.
- **Collections**: create named index pages (e.g. "Books to Read"); any
  daily bullet can be **Threaded** to a collection so tapping its thread
  link jumps straight to that page — the digital equivalent of a page-number
  index in a paper notebook.
- **Haptics**: `navigator.vibrate` fires short pulses on complete, migrate,
  and delete, mimicking the tactile snap of crossing something off on paper.
  (iOS Safari does not support the Vibration API as of this writing — the
  calls are wrapped in a try/catch and silently no-op there; they work on
  Android/Chrome. If Apple ships support, this app benefits with no changes needed.)
- **Backup**: Settings → Export/Import a full JSON snapshot of every entry,
  collection, and mood value.

## iOS-specific implementation notes

- `env(safe-area-inset-top)` / `env(safe-area-inset-bottom)` padding is
  applied to the header, bottom nav, rapid-log bar, and modals so nothing
  sits under the notch/home indicator.
- The outer `<body>` is pinned (`position: fixed; overflow: hidden`) so the
  whole-page elastic bounce is disabled; each scrollable region opts back in
  with `overscroll-behavior: contain` so you still get natural scrolling
  inside the journal itself without the page yanking behind it.
- All interactive targets are sized to at least 44×44px per Apple's Human
  Interface Guidelines.
- `apple-mobile-web-app-capable` + `apple-mobile-web-app-status-bar-style`
  give you the chrome-free standalone window when launched from the home
  screen icon.
