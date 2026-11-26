---
paths:
  - "service-worker.js"
  - "sw-register.js"
  - "test/sw-*.test.mjs"
  - "manifest.json"
  - "firebase-client.js"
  - "test/firebase-client.test.mjs"
  - "e2e/offline.spec.js"
  - "playwright.offline.mjs"
---

# The offline-first shell — service worker, manifest, Firestore's local cache

How the app opens instantly and offline, and how a release reaches a device. What every session needs
is in `CLAUDE.md` in one line: **every asset is served from a version-named cache and a cached file is
never re-fetched, so a change reaches devices only through a version bump.** The deployed-site checks
are `CLAUDE.md` → *Deployment health check*; notification taps and the deep-link allowlist are
`notifications.md`. The mechanics are commented in place in `service-worker.js`; this file keeps the
decisions and the reason each must not be undone.

## Decisions — never change without discussion

| Decision | Rule |
|----------|------|
| SW caching: HTML + JS/CSS served from the version cache, never re-fetched (owner approval, Jul 2026) | HTML, JS and CSS are served instantly from the version-pinned cache, never re-fetched once cached — no blocking network wait on any page open (network-first HTML cost 100–500ms per open, or the full 2s timeout on poor signal). An HTML cache MISS falls back to network-first with a 2s race. Freshness is the version-bump → new SW → new cache → warm-up → controllerchange-reload lifecycle for ALL code; roster DATA is live from Firestore. One cache for HTML and JS also shrinks the mixed-version window. Do not revert without discussion. |
| Firebase SDK cache-first from an SDK-versioned cache | The gstatic SDK modules (version-pinned, immutable) are served cache-first from `myb-roster-sdk-v{FIREBASE_SDK_VERSION}` and warmed with the app, so offline launch does not depend on the HTTP cache keeping ~400 KB of CDN files (evictable on budget Androids). Survives app bumps; swept only when the SDK version changes. **`FIREBASE_SDK_VERSION` in `service-worker.js` is WRITTEN from `firebase-client.js`**: bump the SDK there, then run `npm run generate:copies` in the same commit (`generated-copies.test.mjs` fails until it has run). |
| ONE service worker for every page | Every page registers the same `service-worker.js` at the same scope. Two workers sharing one scope competed and wiped each other's caches, so a page never gets a worker of its own. |
| `persistentLocalCache()` in `firebase-client.js` | Firestore stores queries in IndexedDB. Do not revert to `getFirestore()` — Huddle viewer and override cache depend on instant load. |
| `subscribeToLatestHuddle` in `firebase-client.js` | Persistent `onSnapshot` — Huddle viewer updates automatically when a new Huddle arrives. Do not replace with one-time fetch. |
| SW offline fallback only for navigation requests | Only `event.request.destination === 'document'` requests get the offline HTML page. JS/CSS get `Response.error()`. Without this, `/admin-app.js` matched `'admin'` in the fallback logic and got HTML for a JS request — MIME-type error. Which page each keyword falls back to is the `[keyword, page]` table in the doc branch of `service-worker.js`; anything else falls back to `index.html`. |
| SW synthesised offline page uses status 200 | Some browsers suppress 5xx response bodies. `Cache-Control: no-store` prevents caching the synthesised page. |
| SW `new Request(url)` fetch pattern | `new Request(event.request.url, { cache: 'no-cache', ... })` (no-cache, so the browser can revalidate with a 304) instead of passing opts to an existing Request. Passing opts alongside a Request doesn't reliably override cache mode on older Safari/Chromium. |
| PWA shortcuts in `manifest.json` | The long-press shortcuts (`shortcuts`). Changes require reinstall to take effect on existing installs. |
| **`manifest.json` `name` is SHORT, and that is the splash screen** | Chrome's pre-Android-12 splash draws `background_color`, the largest icon, and **`name` as text** in the DEVICE'S system font (painted before any web content exists, so Inter never reaches it); Android 12+ shows the icon alone. A long `name` with an **em dash** an OEM font lacked fell back mid-string — reported as "a strange font". It is "Marylebone Roster", matching `#splash-title` in `index.html`. **Keep it short and keep it ASCII**; `short_name` is the launcher label and does not reach the splash. It reaches an existing install only on REINSTALL. |
| **`manifest.json` `id` stays `"/"` — do not change it** | `id` is read against the ORIGIN of `start_url`, so on the Pages mirror `"/"` is the bare `garethdavidmiller.github.io/`, not `/roster-app/` — latent, since nothing installable is there. **Leave it anyway**: the id IS the installed app to Chrome, so a new one is a different app — every existing install, on both origins, stops matching this manifest and no longer takes its updates. |
| Maskable icons | 512px entry uses `"purpose": "any maskable"` for Android adaptive shapes. Smaller icons omit this. |

## How the service worker caches

- **Update lifecycle:** install does ONLY `skipWaiting()`; activate does ONLY `clients.claim()`; the
  whole-app precache (`CORE_ASSETS` + `SUPPLEMENTARY_ASSETS`) runs as a DETACHED post-activation
  warm-up. **Never move the precache back into install's or activate's `waitUntil`** — install's held
  every update behind a fetch of the whole app (the "app updates with a lot of lag" complaint), and
  activate's would queue the reloaded page's fetches behind the warm-up. Never write the precache's
  size down: `doc-parity.test.mjs` derives it.
- **An update's reload waits for a write no page started**: while the forced password change's write,
  or the record after a password change, is on its way (`backgroundWritesInFlight`, `claim-retry.js`),
  every reload path in `sw-register.js` holds until the page is next hidden with nothing on its way.
  The reasoning is that module's header.
- **Warm-up resilience:** `__precache-complete` is written only when EVERY asset cached, and an
  incomplete warm-up re-runs on every wake, so coverage converges instead of staying partial. **OLDER
  app caches are deleted only once every app asset has cached** — they are the transition fallback —
  and only OLDER ones, never a newer version's; old SDK caches go once the new one is fully warmed.
- **The fallback lookup is the newest OLDER cache, never a bare `caches.match()`**
  (`matchNewestManagedCache`): `caches.match()` returns the OLDEST version's copy, which served
  previous-version HTML to a fresh-JS page.
- **A cached file is never re-fetched or rewritten.** A background refresh using the page's cache mode
  stored the PREVIOUS release's modules in the NEW cache on the Pages mirror (`max-age=600`). A miss is
  fetched `cache: 'no-cache'`.
- **Navigation Preload stays OFF** (with HTML never re-fetched it was a wasted request on every open),
  and **an `opaqueredirect` is passed straight through** so the browser follows it — treating it as a
  broken response would send installed launches down the cache fallback. Navigations are cached under
  the bare path and redirected responses re-wrapped (`unredirect` — Firebase 301s `/index.html` → `/`);
  `start_url` and the Calendar shortcut point at `./`.
- **Cache-first:** icons, fonts, `manifest.json`, and the SDK in its own cache. The vendored PDF.js
  takes this branch too, unprecached, so **each build lives in `pdfjs/<version>/` and a new one goes
  into a new folder**: a file here is matched by ADDRESS in any version's cache, so new bytes under an
  old name could pair a new library with an old worker.
- **Anything under `docs/` is left to the browser**: the Pages mirror serves the whole repository, and
  caching the New link pack's PDFs kept a republished PDF stale until the next release.
- **Cache name:** `myb-roster-v{APP_VERSION}` — a version bump auto-invalidates.
