---
paths:
  - "service-worker.js"
  - "sw-register.js"
  - "sw-*.test.mjs"
  - "manifest.json"
  - "firebase-client.js"
  - "firebase-client.test.mjs"
  - "e2e/offline.spec.js"
  - "playwright.offline.mjs"
---

# The offline-first shell — service worker, manifest, Firestore's local cache

How the app opens instantly and offline, and how a release reaches a device. These decisions moved
here from `CLAUDE.md` (its architecture table and its "Service worker caching" notes). What every
session needs stays there in one line: **every asset is served from a version-named cache and a
cached file is never re-fetched, so a change reaches devices only through a version bump.** The
deployed-site checks are `CLAUDE.md` → *Deployment health check*; notification taps and the
deep-link allowlist are `notifications.md`.

## Decisions — never change without discussion

| Decision | Rule |
|----------|------|
| SW caching: HTML + JS/CSS served from the version cache, never re-fetched (owner approval, Jul 2026) | HTML, JS, and CSS are all served instantly from the version-pinned cache, never re-fetched once cached — no blocking network wait on any page open (network-first HTML cost 100–500ms per open, or the full 2s timeout on poor signal). An HTML cache MISS (first visit/evicted storage) falls back to the old network-first 2s race. Freshness propagates via the version-bump → new SW → new cache → warm-up → controllerchange-reload lifecycle for ALL code; roster DATA is live from Firestore, never from cached JS. Serving HTML and JS from the same version cache also shrinks the mixed-version deploy window network-first had. Do not revert without discussion. |
| Firebase SDK cache-first from an SDK-versioned cache | The gstatic SDK modules (version-pinned, immutable) are served cache-first from `myb-roster-sdk-v{FIREBASE_SDK_VERSION}` and warmed with the app — offline launch no longer depends on the browser HTTP cache keeping ~400 KB of CDN files (evictable under storage pressure on budget Androids). The SDK cache survives app version bumps and is swept only when the SDK version changes. **Bumping the SDK in `firebase-client.js` requires bumping `FIREBASE_SDK_VERSION` in `service-worker.js` in the same commit** — enforced by `sw-asset-check.test.mjs`. |
| `persistentLocalCache()` in `firebase-client.js` | Firestore stores queries in IndexedDB. Do not revert to `getFirestore()` — Huddle viewer and override cache depend on instant load. |
| `subscribeToLatestHuddle` in `firebase-client.js` | Persistent `onSnapshot` — Huddle viewer updates automatically when a new Huddle arrives. Do not replace with one-time fetch. |
| SW offline fallback only for navigation requests | Only `event.request.destination === 'document'` requests get the offline HTML page. JS/CSS get `Response.error()`. Without this, `/admin-app.js` matched `'admin'` in the fallback logic and got HTML for a JS request — MIME-type error. Which page each keyword falls back to is the `[keyword, page]` table in the doc branch of `service-worker.js`; anything else falls back to `index.html`. |
| SW synthesised offline page uses status 200 | Some browsers suppress 5xx response bodies. `Cache-Control: no-store` prevents caching the synthesised page. |
| SW `new Request(url)` fetch pattern | `new Request(event.request.url, { cache: 'no-cache', ... })` (no-cache, so the browser can revalidate with a 304) instead of passing opts to an existing Request. Passing opts alongside a Request doesn't reliably override cache mode on older Safari/Chromium. |
| PWA shortcuts in `manifest.json` | The long-press shortcuts (`shortcuts`). Changes require reinstall to take effect on existing installs. |
| **`manifest.json` `name` is SHORT, and that is the splash screen** | Chrome's pre-Android-12 splash draws `background_color`, the largest icon, and **`name` as text at the bottom** — in the DEVICE'S system font, because it is painted before any web content exists, so Inter can never reach it. Android 12+ uses the platform SplashScreen API instead, which shows the icon alone and no label, which is why this is invisible on a newer phone. A long `name` with an **em dash** an OEM font may not have made Android fall back mid-string — reported as "a strange font". It is "Marylebone Roster", matching `#splash-title` in `index.html`, which the member sees a beat later. **Keep it short and keep it ASCII**; `short_name` is the launcher label and does not reach the splash. Like the shortcuts above, it reaches an existing install only on REINSTALL (the WebAPK is regenerated). |
| Maskable icons | 512px entry uses `"purpose": "any maskable"` for Android adaptive shapes. Smaller icons omit this. |

## How the service worker caches

- **Update lifecycle:** install does ONLY `skipWaiting()`; activate does ONLY `clients.claim()`; the
  whole-app precache runs as a DETACHED post-activation warm-up. **Never move the precache back into
  install's or activate's `waitUntil`** — install's held every update behind a no-cache fetch of every
  precached asset (the whole app — `CORE_ASSETS` + `SUPPLEMENTARY_ASSETS` in `service-worker.js`; the
  figure is deliberately NOT written here, because it understated the cost every time it was, and
  `doc-parity.test.mjs` derives it), which was the "app updates with a lot of lag" complaint, and
  activate's would queue every fetch of the freshly-reloaded page behind the warm-up.
- **Warm-up resilience:** a `__precache-complete` marker is written only when EVERY asset cached; the
  SW's top-level startup check re-runs an incomplete warm-up on every wake (covers a killed mid-run
  warm-up AND first installs — offline-first coverage converges instead of silently staying partial);
  the fetch handler piggybacks the in-flight warm-up onto `event.waitUntil` so page traffic keeps the
  SW alive through it. **OLDER app caches are deleted only once every app asset has cached** — they
  are the transition fallback, so a partial warm-up keeps them and retries — and only OLDER ones,
  never a newer version's; old SDK caches go once the new SDK cache is fully warmed.
- **The fallback lookup is the newest OLDER cache, never a bare `caches.match()`.** A document falls
  back to the CURRENT-version cache first, then `matchNewestManagedCache`; `caches.match()` searches in
  creation order and returns the OLDEST version's copy, which served previous-version HTML to a
  fresh-JS page (a mixed-version hazard). The JS/CSS path uses the same newest-older lookup as its last
  resort for pure-offline mid-transition.
- **Latency:** Navigation Preload is turned OFF on activate (Nov 2026 — with HTML never re-fetched
  once cached it was a wasted request on every open; a miss is the worker's own `no-cache` fetch, and
  the doc branch still consumes a preload that arrives); the warm-up runs in batches of 8 (not the
  whole list in parallel) and skips assets the reloading page already cached;
  fonts/icons warm without `cache:'no-cache'` (immutable, served from HTTP cache); navigations are
  cached under the bare path (query stripped — `ignoreSearch` on fallback match) and redirected
  responses are re-wrapped before caching/serving (`unredirect` — Firebase 301s `/index.html`→`/`;
  in-app links navigate to `./`); the 2s abort is guarded so it can never kill a response that
  already resolved.
- **An `opaqueredirect` is passed straight through** (status 0 — a redirect under the navigation's
  'manual' redirect mode, which is how a navigation-preload answer surfaced the start_url
  `./index.html` → `/` 301 while preload was on; it is off since November 2026, and the pass-through stays
  for one that arrives) so the browser follows it — treating it as a broken-site response would send every
  installed-PWA launch down the cache fallback. `manifest.json` `start_url` and the Calendar shortcut
  point at `./` (a reinstall picks that up; the pass-through covers existing installs).
- **HTML documents** — instant from this version's cache, never re-fetched once cached. Cache miss →
  network-first with the 2s cache-fallback race.
- **All JS + CSS** — served instantly from this version's cache. **A cached file is never re-fetched
  or rewritten.** The old once-per-process background refresh used the page's cache mode, so on the
  Pages mirror (`max-age=600`) it stored the PREVIOUS release's modules in the NEW cache, and an old
  worker stored new files in its old cache. A miss is fetched `cache: 'no-cache'`. Code freshness is
  the version-bump → new SW → new cache lifecycle (each deploy precaches fresh assets and the new SW
  claims immediately); roster DATA is always live from Firestore regardless of cached JS version.
- **Cache-first:** icons, fonts, `manifest.json` — stable assets; and the gstatic Firebase SDK in its
  own `myb-roster-sdk-v{ver}` cache (warmed with the app, swept on SDK bump only).
- **Anything under `docs/` is left to the browser** (Nov 2026): the Pages mirror serves the whole
  repository, and caching the New link pack's PDFs kept a republished PDF stale until the next release.
- **Cache name:** `myb-roster-v{APP_VERSION}` — a version bump auto-invalidates.
