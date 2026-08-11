# CLAUDE.md

*Last updated: August 2026 — v20.50 · Updated every 0.10 version*

# Claude Code Instructions — MYB Roster App

## Project identity — read this first

| Property | Value |
|----------|-------|
| GitHub repository | `Garethdavidmiller/roster-app` |
| Firebase project ID | `myb-roster` |
| Firebase project region | `europe-west2` (London) |
| Current app version | `20.50` (latest 0.10 milestone; exact value in `roster-data.js` — `APP_VERSION` is authoritative). The version stamp in **every** doc (this file, AI_MAP, OPERATIONS_REFERENCE, KNOWN_LIMITATIONS, ROADMAP) is enforced against the latest 0.10 milestone by `sw-asset-check.test.mjs` and `githooks/pre-commit` — a bump crossing a 0.10 line fails until each doc is reviewed and re-stamped. |
| Hosted URL | Deployed to Firebase Hosting via GitHub Actions on push to `main` |
| Staff-facing URL | `https://myb-roster.web.app` (canonical — Firebase Hosting; **primary install + notification target** since v14.29). A GitHub Pages mirror is still served at `https://garethdavidmiller.github.io/roster-app/` — the **roster-app repo's OWN** Pages, built from `main`; **note the `/roster-app/` path**, NOT the bare origin (which is a separate empty repo that 404s) — kept alive only for staff who already installed from it. `STAFF_SITE_URL` in `functions/index.js` is now the bare `https://myb-roster.web.app` (no sub-path). It only sets the notification payload's path/hash — each device's service worker discards the origin and re-bases the page onto its own scope, so existing github.io installs keep working. See API key note below. |
| Cloud Function URLs | `https://europe-west2-myb-roster.cloudfunctions.net/ingestHuddle` |
| | `https://europe-west2-myb-roster.cloudfunctions.net/parseRosterPDF` |
| | `https://europe-west2-myb-roster.cloudfunctions.net/setupRosterAuth` |
| | `https://europe-west2-myb-roster.cloudfunctions.net/resetMemberPassword` (admin-only break-glass — resets a member's password to their surname default; PASSWORD_PLAN.md Track C) |
| | `https://europe-west2-myb-roster.cloudfunctions.net/unlockCalendarViewer` (the staff Calendar PIN exchange, v20.12 — POST a four-digit PIN, get a custom token carrying ONE claim, `calendarViewer: true`. The PIN lives ONLY in the `CALENDAR_VIEWER_PIN` secret; never in source, docs, tests or any client asset. Server-throttled TWO ways since v20.35: 30 failed attempts per source per 15 min, **and** an all-sources ceiling of 200 per 15 min under a fixed key no header can influence — the per-source key is derived from the END of `x-forwarded-for` because a caller can only PREPEND to it, and taking the first entry (as v20.12–v20.34 did) let anyone mint an unlimited supply of buckets) |
| | `https://europe-west2-myb-roster.cloudfunctions.net/getSignInStats` (admin-only READ — the EXACT unique-account sign-in counts, from Firebase Auth's own `lastSignInTime`. Returns four integers; no identity. v18.96) |
| | `https://europe-west2-myb-roster.cloudfunctions.net/requestPasswordReset` (the app's ONLY public unauthenticated endpoint — a locked-out member asks the admin to reset their password; records a request, never resets anything. Since v18.95 it also pushes the request to the **admin's devices only** via `sendTargetedPush` — never `fanOutPush`) |
| Development branch convention | `claude/<description>-<sessionId>` — always push to this branch, never directly to `main` |

**GitHub Actions secrets required:**

| Secret | What it is |
|--------|-----------|
| ~~`FIREBASE_SERVICE_ACCOUNT`~~ | **Retired — no longer used.** All three deploy workflows now authenticate via **Workload Identity Federation** (short-lived GitHub OIDC tokens exchanged for the `github-deploy@myb-roster.iam.gserviceaccount.com` service account — pool `github-pool`, provider `github-provider`, repo-scoped by an `assertion.repository` condition). **A2 complete:** the old SA JSON key and the `FIREBASE_SERVICE_ACCOUNT` GitHub secret have both been deleted (deploys confidence-checked with the key gone), so no standing full-project deploy credential remains in GitHub. See SECURITY_RELEASE_PLAN.md → Appendix A2. |
| `HUDDLE_SECRET` | Bearer token for `ingestHuddle` — also set in Firebase Secret Manager |
| `ANTHROPIC_API_KEY` | Claude AI key for `parseRosterPDF` — Firebase Secret Manager only |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push keys — Firebase Secret Manager only |
| `CALENDAR_VIEWER_PIN` | The shared staff Calendar PIN (v20.12) — Firebase Secret Manager only, set INTERACTIVELY (`firebase functions:secrets:set CALENDAR_VIEWER_PIN`). Rotating it needs no client release; see OPERATIONS_REFERENCE.md → "Rotating the Calendar PIN" |

**Workflows:** `deploy-functions.yml` (functions only) · `deploy-hosting.yml` (PWA → Firebase Hosting, added v8.14) · `deploy-rules.yml` (Firestore/Storage rules). **All three authenticate via Workload Identity Federation** (`google-github-actions/auth`, pinned `v2.1.13`) — each job declares `permissions: id-token: write` and exchanges GitHub's OIDC token for short-lived credentials; there is no `FIREBASE_SERVICE_ACCOUNT` key file. The GitHub Pages staff mirror at `garethdavidmiller.github.io/roster-app/` is served by the **roster-app repo's own native Pages** ("pages build and deployment" — Settings → Pages → Deploy from `main`/root), so there is **no Pages workflow file**. The root **`.nojekyll`** marker (empty file — do not delete) makes Pages skip its Jekyll build and copy files directly: without it every mirror deploy ran the app through Jekyll, which hard-times-out at 10 minutes and caused repeated mirror deploy failures (Jul 2026). (The old cross-repo `deploy-pages.yml` + `PAGES_DEPLOY_TOKEN` secret were removed v14.25: redundant — they pushed a copy to a separate bare-origin `garethdavidmiller.github.io` repo that nothing used, and failed on every run.)

**⚠️ Firebase API key referrer restriction — add every domain the app is served from:**
The Firebase web API key is restricted to specific HTTP referrers in GCP Console → APIs & Services → Credentials. If a domain is missing, **every Firebase Auth call silently fails** — sign-ins, Firestore writes, and push subscriptions all break with no visible error in the app UI. Current allowlist must include:
- `myb-roster.firebaseapp.com/*`
- `myb-roster.web.app/*`
- `garethdavidmiller.github.io/*` ← staff-facing URL, must stay until GitHub Pages is retired
If a new custom domain is ever added, update the GCP allowlist in the same change. See KNOWN_LIMITATIONS.md task #1 for full history.

---

## Deployment health check — do this occasionally (and in every review)

> **⚠️ The installed PWA hides live-site breakage.** The app is offline-first, so
> a phone that already has it installed launches — and even updates — straight
> from the service-worker cache, **even when the live site is completely broken**
> (splash that never clears, `404`, CSP failure, expired API-key referrer). You
> will NOT see the problem from your own installed app. This is how a real outage
> went unnoticed (Firebase URL stuck on splash + GitHub Pages staff URL `404`,
> while every installed phone kept working). **"My phone works" is never evidence
> the site is up.**

**Verify the LIVE URLs in a fresh browser / private window (no cache, no SW):**

- [ ] `https://myb-roster.web.app` — loads *past* the splash to the calendar
- [ ] `https://garethdavidmiller.github.io/roster-app/` — loads (not `404`); the GitHub Pages staff mirror (**note the `/roster-app/` path** — the bare origin is a separate empty repo that 404s)
- [ ] A sub-page deep-link works (`/admin.html`, `/paycalc.html`) — not just the root
- [ ] DevTools → Console on each shows **no red errors** (CSP / failed module / `404` / `api-key-not-valid` / referrer-blocked)

**Cadence:** every code/app review, **and** immediately after any change to
`firebase.json` (CSP/headers), the Firebase SDK version in `firebase-client.js`,
the GCP API-key referrer allowlist, or the hosting/Pages setup. Full rationale
and the symptom table: KNOWN_LIMITATIONS.md → "The installed PWA masks live-site
breakage".

---

## Version bumping (MANDATORY on every change)

> **⚠️ INCREMENT IS EXACTLY 0.01 PER CHANGE — never 0.10.** A batch/change goes e.g.
> `15.90 → 15.91 → 15.92`. The **"update every 0.10 version"** documentation rule further down is
> ONLY about *when to re-stamp the docs* (when the version crosses a 0.10 line, e.g. `…99 → 16.00`) —
> it is **not** the step size. Do not confuse the two: bumping by 0.10 per batch (the v15.70→15.80→15.90
> slip) burns the version space and is wrong. The version only ever *increases* (it names the SW cache),
> so never set a value ≤ what is already on `main`.

> **⚠️ PRE-COMMIT CHECK — do this before every `git commit`:**
> Ask: "Did this change touch anything a user can see or experience?" UI text, layout,
> behaviour, CSS, security rules, SW caching — all require a bump. If yes, run `npm run bump`
> before committing. Forgetting and fixing in a follow-up commit is worse than bumping
> unnecessarily, because staff may be served a stale cached asset.

**2 runtime bump locations (v16.81 — was 9; the 7 pure-comment stamps were dropped):**

> **What requires a bump:** any change that alters runtime behaviour — logic, data, UI,
> CSS layout/appearance, security rules, HTTP headers, manifest, service worker caching.
> **What does NOT require a bump:** pure documentation edits (`.md` files only), comment-only
> changes inside JS/CSS with no runtime effect, and whitespace/formatting fixes with no
> semantic change. If in doubt, bump — the cache invalidation cost is zero and the benefit
> of always-fresh assets is real.

| File | Location |
|------|----------|
| `roster-data.js` | `export const APP_VERSION = '...'` — **primary source** (every runtime read) |
| `service-worker.js` | `const APP_VERSION = '...'` — names the SW cache (the freshness lever) |

**Always use `npm run bump <version>`** (e.g. `npm run bump 13.48`) — never hand-edit either location. Implemented by `scripts/bump-version.mjs`. The runtime version staff see (About lightbox) reads `APP_VERSION`. The old SW line-1 and six HTML line-2 comment stamps were removed in the v16.81 debt sweep: they carried no runtime effect but made the bump touch 8 files on ~half of all commits and conflicted across parallel `claude/*` branches. `sw-asset-check.test.mjs` now checks only the two runtime locations.

`?v=` cache-busting strings were removed at v9.94 — do not add them back. Cache freshness is handled by `Cache-Control: no-cache` in `firebase.json`.

**Documentation update policy:** Update every **0.10 version** (e.g. 10.10 → 10.20), or immediately on: new pay grade, auth/Firestore model change, SW strategy change, new page or module, data model change.

**Same-commit rule:** Any commit that adds, removes, or renames a JS module — **or removes/renames an exported symbol** from one — must also update `CLAUDE.md` and `AI_MAP.md` in the same commit. The pre-commit hook (`githooks/pre-commit`) enforces both: the module rule (modules must be listed in both docs) and the export rule (a staged module whose exports shrank vs `HEAD` requires `AI_MAP.md` to be staged too). The hook **also blocks** a commit when `AI_MAP.md`'s "Last updated" line has fallen behind the latest 0.10 milestone (mirrors `sw-asset-check.test.mjs`, so the 0.10 documentation sweep is enforced locally as well as in CI). It additionally runs ESLint on all staged JS files (if ESLint is installed) and checks that `firebase-client.js` does not import multiple different Firebase SDK versions at once.

---

## How to work with the owner

Gareth built this app through extended Claude.ai collaboration. He has strong operational knowledge and is actively learning software development. Every session is both development and teaching.

- **Explain decisions** — what, why, what the alternative was
- **Plain language first** — explain new concepts before implementation
- **Name the pattern** — name any design pattern and say why it fits
- **Flag trade-offs** — briefly note what the other option was
- **Never assume prior knowledge** of cloud services, auth patterns, or backend concepts

---

## Compact instructions

When compacting, always preserve:
- The list of modified files and their purpose
- Any unresolved errors or test failures
- The current version number being worked on
- Any decisions made about architecture or approach
- The branch name

---

## Current file structure

**This tree ROUTES; it does not explain** (v20.11). Each entry says what a file is and where its
reasoning lives — it is not the place to record why a module works the way it does, and it is not a
changelog.

That rule was applied retroactively, and the numbers are why. The tree had reached **136k characters
— 54% of this file — carrying 208 version references**: `links-design.js`'s entry alone spanned
twelve releases from v19.38 to v20.02. Because `CLAUDE.md` is loaded into *every* session, that was
~59k tokens of mostly-changelog paid on every task regardless of relevance. Worse, the same class of
fact lived in two places with no rule about which: measured across the long entries, the overlap
between a tree entry and its own module header ranged from **5% to 83%**. It landed in whichever
file happened to be open, and then the two drifted — which is the mechanism behind every stale doc
claim this repo has had to correct.

**Three homes, one fact each:**

| What | Where | Why there |
|---|---|---|
| **Routing** — what a file is, what it owns | this tree, one line | it is what you need before you have opened anything |
| **Design reasoning** — the invariants an edit can silently break | the module's own header | it is where an editor is already looking, and it cannot drift from the code beside it |
| **Release history** — what changed at which version | git log, and the plan docs | it describes the past; it cannot be checked, and it is read almost never |

Nothing was deleted in the v20.11 pass — reasoning that was only in this file was **moved into the
module header first** and verified there. When you add a module, give it a one-line entry here and
put the argument in its header. See `AI_MAP.md` for full module descriptions and export lists.

```
roster-app/
├── index.html              ← main PWA app (HTML + CSS only)
├── admin.html              ← staff self-service portal: AL booking, absence, override list
├── operations.html         ← admin-only: Huddle upload, Circular upload, Newsletter upload, Roster upload, Account status (per-member work email + password migration/reset — merged the old Work Email Progress card in v18.65), Error Log, Usage, App Speed (Project 0 latency), Staff Login Accounts
├── settings.html           ← Work Email, Password (set your own), Notifications, Pay Calculator Data (a POINTER to the paycalc transfer card, not a second copy of the controls). All four cards carry the canonical header shape — title + hint + optional chip + `?` + chevron — since v20.09, when Pay Calculator Data was the only one missing its `?`; a card without one reads as a control that failed to render, and that card is the one place in the app where something does NOT follow your account, which is the opposite of every expectation the rest of the app sets
├── paycalc.html            ← pay calculator (HTML + CSS only)
├── calendar-app.js         ← coordinator for index.html: event wiring, month navigation, Team Week View, notification wiring
├── calendar-state.js       ← display month/year state for index.html (getters/setters + persistViewedMonth)
├── calendar-swipe.js       ← Pointer Events swipe carousel for index.html: initSwipeHandler, isSwipeCooldown
├── calendar-al-lightbox.js ← AL lightbox + day-detail lightbox for index.html: initCalendarLightboxes() → { openDayDetail, closeALLightbox }
├── calendar-initial-fetch.js ← initial 3-month Firestore fetch and sync-chip UI for index.html: initInitialFetch({ isTeamViewMode, renderCalendar, authReady }). **TWO-PHASE since v19.01** (AUTH_PLAN.md → E1): phase 1 paints from the local Firestore cache with NO network and NO auth, phase 2 awaits `authReady` then runs the authoritative server read — so requiring a session for reads can never put a `signInAnonymously` round-trip in front of data the device already holds
├── calendar-keyboard.js    ← keyboard navigation + hover tooltip for index.html: initCalendarTooltip(), initCalendarKeyboard({ navigateToPaycalc, openDayDetail })
├── calendar-access.js ← the Calendar's ACCESS GATE (v20.12): decide at boot, show the staff-PIN unlock card, mint and hold the shared viewer session, and expose `calendarAccessReady` — the promise the whole Calendar waits on. Reads override data only for a named member or the shared `calendarViewer` capability; anonymous grants nothing. **The persistence ORDER and the claim VERIFICATION are the two security properties and both are easy to undo** — read the module header before touching the unlock ladder. Tested by calendar-access.test.mjs
├── calendar-access-core.js ← the PURE rules behind it (no DOM, no Firebase, so it loads in Node): `CALENDAR_VIEWER_UID`/`CALENDAR_VIEWER_CLAIM`, `isViewerUser`, `decideAccess`, PIN input shaping, `classifyUnlockFailure`, `attemptBackoffMs`. **The PIN is never compared here or in any client file** — a client-side check turns a 10,000-space secret into an offline brute force. `session.js` imports `isViewerUser` from here rather than keeping a second copy. Tested by calendar-access-core.test.mjs
├── calendar-data-state.js  ← what the Calendar KNOWS about a month's overrides, and what it may therefore SHOW: `noteKnowledge`, `forget`, `knowledgeOf`, `worstKnowledge`, `decideDisplay`. Pure — no DOM, no Firebase, no imports. **Cache absence is not evidence that no override exists**, which is the whole module; the four states and why none of them collapses into another are argued in the header. Tested by calendar-data-state.test.mjs
├── calendar-overrides.js   ← Firestore override cache for index.html (fetch/ensure range, getShiftTypesInMonth) + `fetchOverridesForRangeFromCache` (v19.01 — the local-cache, no-network, no-auth read that phase 1 of the calendar's two-phase load paints from; merges ADDITIVELY, never evicts) — the GATE (`setOverrideAccess`, whose grant is a fresh start: it clears the month claims, or a re-unlocked Calendar can never read again) — the WRITE ORDERING (`_monthOwner` + `_monthSlices`, v20.44: a late superseded read may not evict what a newer one loaded; ordering the render without ordering the write was half a fix) — and, since v20.40, the RECORDER: `ensureOverridesCached` notes each month authoritative/error, and a failed month now repaints ONCE (see `_failureRepainted` — the render↔fetch loop it guards is invisible from either end)
├── calendar-member.js      ← team member selection for index.html (dropdown, current member, stale-name handling)
├── calendar-renderer.js    ← calendar cell/grid building for index.html
├── calendar-huddle-viewer.js    ← Huddle viewer overlay: initHuddleViewer, _triggerAutoOpen, hashchange
├── calendar-doc-viewer.js  ← Circular/Newsletter in-app viewer (index.html): opens a #circular/#newsletter notification deep link in a lightbox. Reuses createLightbox; separate from the Huddle viewer.
├── nav-panel.js            ← shared nav drawer: exports initNavPanel, archiveNotice, isNoticeExpired, resetNavPanel; the NAV_PAGES/INFORMATION/GUIDES arrays are internal data (not exported)
├── notif.js                ← shared Web Push: notifSupported, getNotifState, peekNotifState, enable/disableNotifications
├── overlay.js              ← shared overlay helpers: lockBodyScroll, createLightbox, _pushOverlayState, trapFocus, initCardCollapse, confirmDialog/promptDialog (v17.60 — Promise-based in-app replacements for native confirm()/prompt(), built on createLightbox; used by links-app.js + settings-app.js)
├── date-picker.js          ← brand-styled single-date picker for the Operations upload date fields: initDatePickers(ids) + pure monthCells(). Progressive-enhances each native `<input type="date">` (kept hidden as the value holder — consumers unchanged) into a trigger button that opens one shared modal calendar via createLightbox; sets value + dispatches input/change so the roster Saturday-snap and doc-upload defaults still flow through
├── about-lightbox.js       ← shared About (#iconLightbox) panel: initAboutLightbox(). Used by all six pages
├── tips-lightbox.js        ← shared per-card Tips panel: initTipsLightbox(CARD_TIPS, { getIsAdmin })
├── login-overlay.js        ← shared in-place sign-in overlay for all 5 protected pages: initLoginOverlay({ pageLabel, onSuccess }); grade/name dropdowns, surname-password check, client rate-limit. The sign-in core `runNamedSignIn` commits the local session ONLY after auth resolves — never before (the v14.75 half-signed-in/freeze fix; LOGIN_INCIDENT.md). Full detail + exports: AI_MAP.md.
├── password-force.js ← the MANDATORY "set your own password" overlay (PASSWORD_PLAN.md Phase 2): `initPasswordForce`, the pure `shouldForcePasswordSet` gate, `withTimeout` and `settleOrTimeout`. Shown once after a confirmed sign-in for a `named` identity still on the surname default. **It FAILS OPEN both before and after showing** — a mandatory overlay that cannot be satisfied is a lockout. Kill switch: `CONFIG.FORCE_PASSWORD_SET`. Tested by password-force.test.mjs
├── session.js              ← shared auth/session: ensureFirebaseSession/ensureNamedSession, primeAuth (v14.80 pre-warm), get/save/clearSession, and the B0 named-vs-anonymous identity signals. Full exports: AI_MAP.md.
├── auth-state-core.js      ← PURE identity state machine (ARCHITECTURE_PLAN.md Track 1, Phase 1): reduceAuthState(state, event)→state + INITIAL_STATE. No DOM/Firebase/localStorage. Tested by auth-state-core.test.mjs.
├── auth-state.js           ← auth STORE (Phase 2): getAuthSnapshot/subscribeAuth/dispatchAuth over the reducer. Imports ONLY auth-state-core.js (acyclic); session.js FEEDS it (observing only; sessionReady untouched). Full detail: AI_MAP/ARCHITECTURE_PLAN.
├── auth-policy.js          ← page-AUTHORISATION (Phase 3): PAGE_POLICIES map + pure requirePageAuth→{decision,reason} (allow/soft-allow/login/forbidden/pending) + rolesFor + requirePage. CLIENT UX only — server rules are the real boundary. Consumed by the 5 write coordinators (active since ENFORCE_NAMED_SESSION on). Full detail: AI_MAP/ARCHITECTURE_PLAN.
├── sw-register.js          ← shared SW registration + update lifecycle: registerServiceWorker(). v16.09: the first-install claim no longer reloads (hadController guard — it double-loaded every new device) and controllerchange is no longer {once:true} (a declined beforeReload confirm must not swallow the next update). Tested by sw-register.test.mjs
├── splash-watchdog.js      ← CLASSIC (non-module) recovery script for index.html, loaded via `<script defer src>` so it runs even when the ES-module graph fails to load. If the #splash is still up after 20s: one guarded auto-reload, then a Reload / Reset-cache (unregister SW + delete caches) panel. Registered in service-worker.js like any asset (v16.18). Detail: AI_MAP.md.
├── error-reporter.js       ← shared uncaught-error reporter: initErrorReporter() — writes to Firestore clientErrors
├── fetch-timeout.js ← the BOUND on every Cloud Function call: `fetchWithTimeout`, `isFetchTimeout`. Five client calls had none (v20.52, external review), and a stalled transport never rejects — so the reset-request button sat on "Sending…" for ever. **A budget goes ABOVE the endpoint's own `timeoutSeconds`, never below**, or the client reports a working-but-slow server as broken; and **a timeout on a WRITE must not say it did not happen** (the abort stops us waiting, not the server working). Tested by fetch-timeout.test.mjs
├── usage-reporter.js ← shared anonymous usage recorder: `recordUsage(page, identity?)` + `recordOpen` — page popularity and active-use counts, deduped client-side, no identity stored. **ONE identity argument since v19.95**; the figures step UP at that point and are not comparable either side of it. Tested by usage-reporter.test.mjs
├── usage-stats.js          ← pure usage maths: monthKey, dayKey, shouldCountMonth, shouldCountRolling, recentDayKeys, sumDailyWindow, orderPageCounts, staleDailyKeys
├── perf-reporter.js        ← shared anonymous latency recorder (Project 0): recordPageLatency buckets Navigation + Paint Timing (ttfb/domReady/fcp) + the three boot-phase spans (v20.33, split by the pure perf-stats.bootPhases) → analytics/perf_<YYYY-MM>; no identity, no raw ms; skips admin (developer) loads (still consumes the one-shot login marker). Full detail: AI_MAP.
├── perf-stats.js           ← pure latency maths: PERF_BUCKETS, bucketDuration, perfSampleKey, parsePerfSampleKey, summarisePerf, summarisePerfBy, BOOT_PHASES/bootPhases/summariseBootPhases (the boot-stage split + its phase-scaled bands) + PERF_DIMENSIONS (the conn/mode/version breakdown behind the card's "Why some are slower" section)
├── calendar-team-view.js        ← Team Week View: state, grid render, toggle. Overrides come from the SHARED month fetch (injected `ensureOverridesCached`) — it has no Firestore fetch of its own since v18.76
├── override-utils.js   ← override/member-start/shift helpers: tsToMillis, shouldReplaceOverride, reconcileRangeIntoCache (authoritative range-refresh — rebuild winners from the snapshot, evict deletes; shared by both fetch paths), isBeforeMemberStart, isRestShift, resolveEffectiveShift (shared override→display ladder for renderer/team-view/legend)
├── admin-app.js            ← coordinator for admin.html: login, AL/absence, Team Week View, module wiring. Body is an exported `init()` (Phase 4a.2) invoked by admin-boot.js — importing the module no longer auto-runs it (test seam). The in-place-login re-invocation calls the nested `initAuthorised()`, not `init()`.
├── admin-boot.js           ← 2-line bootstrap for admin.html: imports `init` from admin-app.js and calls it (CSP `script-src 'self'` blocks inline module scripts; keeps init() importable without auto-running, for tests)
├── operations-app.js       ← coordinator for operations.html: session guard, initHuddleUpload/RosterUpload/AuthSetup + the merged Account-status card (per-member work email set/edit/remove + password migration table + admin resetMemberPassword break-glass; v18.65 folded in the former Work Email Progress card). Body is an exported `init()` (Phase 4a.2) invoked by operations-boot.js — early-return access gate, no top-level throw. Delegates the three reporting cards to operations-reports.js
├── operations-reports.js   ← the three read-only reporting cards on operations.html — Error Log, Usage, App Speed (extracted from operations-app.js v17.46): initErrorLog/initUsageCard/initPageSpeedCard, each awaits sessionReady, reads Firestore, renders into its own card by id (no coordinator state). Exports `_cardLoadError` (the shared card-failure+retry helper) back to operations-app.js for its Account-status card — one-directional, no import cycle
├── operations-boot.js      ← 2-line bootstrap for operations.html: imports `init` from operations-app.js and calls it (CSP `script-src 'self'` blocks inline module scripts; keeps init() importable without auto-running, for tests)
├── settings-app.js         ← coordinator for settings.html: session, login, initHuddleNotifications, work email, Password card (set-your-own-password, v18.63). Body is an exported `init()` (Phase 4a.2, v17.09) invoked by settings-boot.js — importable without auto-running, for tests
├── settings-boot.js        ← 2-line bootstrap for settings.html: imports `init` from settings-app.js and calls it (CSP `script-src 'self'` blocks inline module scripts; keeps init() importable without auto-running, for tests)
├── huddle.js               ← initHuddleUpload (→ operations) + initHuddleNotifications (→ settings)
├── doc-upload.js           ← shared Operations upload-card skeleton (Circular/Newsletter/Huddle): file-pick → validate (type + 20 MB) → optional transform (Huddle DOCX→HTML) → upload → feedback. initDocUploadCard(cfg)
├── admin-auth.js           ← Staff Firebase Auth account setup card: initAuthSetup()
├── admin-al.js             ← Annual Leave Booking: initALSection(deps), triggerConfirmedALSave() — thin config wrapper over admin-range-booking.js (60-day cap, 🏖️ preview + spare warning, over-entitlement confirm bar)
├── admin-sick.js           ← Sick Days Recording: initSickSection(deps) — thin config wrapper over admin-range-booking.js (1-year cap, 🪑 preview; no entitlement cap)
├── admin-range-booking.js  ← shared skeleton for the two date-range booking sections: createRangeBookingSection(cfg) — dropdown + range picker → live preview → recordRangeOverrides save flow. Per-section differences (range rule, preview copy, AL pre-save entitlement check, refresh hooks) injected via config
├── admin-overrides.js      ← Change a Shift: PILL_TYPES, week grid, bulk bar, override list, recordRangeOverrides()
├── admin-rangepicker.js    ← Inline date-range calendar: buildRangePicker(prefix), getDateRange()
├── admin-roster-upload.js  ← Weekly Roster Upload: computeCellStates, renderReviewTable, shiftDisplay, _saveOverrideBatches (chunked Firestore save — each batch rebuilt inside writeWithClaimRetry so roster-import saves self-heal a stale admin/manager claim, like every other Admin write path)
├── paycalc-app.js          ← coordinator for paycalc.html (UI, DOM, autosave, HPP, sticky bar, back-pay). Body is an exported `init()` (Phase 4a.2) invoked by paycalc-boot.js — local-identity gate early-returns, no top-level throw
├── paycalc-boot.js         ← 2-line bootstrap for paycalc.html: imports `init` from paycalc-app.js and calls it (CSP blocks inline module scripts; keeps init() importable without auto-running, for tests)
├── paycalc-lightboxes.js   ← lightbox and overlay initialisation for paycalc.html: initPaycalcLightboxes() → { openAboutLightbox }
├── paycalc-periods.js      ← period arithmetic + select UI (getPeriods, prev/next, BH/Boxing-Day, CONDITIONAL_ROWS)
├── paycalc-settings.js     ← grade/contracted-hours helpers + settings persistence (getGrade, getEffectiveContr, getProRateFactor, saveSettings, loadSettings, …)
├── paycalc-roster-hint.js  ← roster-assist hint bar UI (updateRosterHint, fillFromRoster, fillCategoryFromRoster, snapKey, …)
├── paycalc-hpp.js          ← Holiday Pay Premium estimator and shared period helpers: isDataEmpty, _decodeHours, _varPayForPeriod, calcHPP, updatePriorHpp
├── paycalc-hpp-schedule.js ← PURE payslip ↔ tax-year relation for HPP (v18.85): periodsInTaxYear, hppPayslipForTaxYear, hppTaxYearForPayslip, hppPaidInTaxYear. A tax year's premium is paid on the FIRST JANUARY PAYSLIP OF THE FOLLOWING YEAR — `ty.hppPaidJan` falls OUTSIDE that year's own window, the clause four hand-rolled copies kept getting wrong (one caused the v18.84 year-summary bug). No DOM/imports — the period grid + tax-year table are passed in, so it is testable with no mocks. Tested by paycalc-hpp-schedule.test.mjs, whose round-trip assertion is the guard that would have caught v18.84
├── paycalc-year-summary.js ← "This tax year so far" for the Year to Date card (v18.41): computeYearSoFar — headless per-payslip re-run (computeGross/Tax/NI/SL over saved hours) summing taxable/tax/NI/SL/take-home + a rough full-year projection; rendered by paycalc-app.js after every calculate(). Tested by paycalc-year-summary.test.mjs
├── paycalc-backpay.js      ← back-pay lump sum calculator: prefillBackPay, calcBackPay, _bpAwardTaxYear, raiseByPercent, bpStoryHtml (the pure story strip leading the card, v18.39)
├── paycalc-backpay-state.js ← which FIGURE ends up in which back-pay box, and which of them the member may change: `BP_FIELDS`, `readBpFields`/`bpFieldWrites`, `resolveAuthoritativeRates`, `allRatesOnRecord`, `resolvePaidInPeriod`. Extracted because every recorded defect here is the same shape — a money figure comes out wrong and nothing says so. Three rules that must survive an edit are in the module header. Tested by paycalc-backpay-state.test.mjs
├── paycalc-format.js       ← shared pure helpers (no DOM): date/currency formatters fd, fdShort, fdLong, fmt + time-input cores clampMinute, decimalToHM (extracted from paycalc-app.js v17.74/Section G — the hrs/mins split, previously inline+duplicated, is now written once and tested). fdLong ("3 Jul 2026" full-year form) was de-duplicated from ~8 inline copies across paycalc-app/backpay/periods/roster-hint (v18.30). Imported by paycalc-app, -backpay, -periods, -roster-hint.
├── paycalc-breakdown.js    ← the two PURE HTML builders for the pay-result card — buildSummaryRows + buildBreakdownRows (+ fmtHrsMins) — extracted from calculate() in paycalc-app.js (v18.30, review item 20) so the result markup is written + unit-testable independent of the DOM read/calc phases. No DOM/Firebase; only dep is fmt. Byte-identical output to the old inline templates. Tested by paycalc-breakdown.test.mjs
├── paycalc-form-data.js ← the per-period form ↔ saved-data ROUND TRIP: `emptyPeriodData`, `readFormData`, `writeFormData`. Extracted because ~70 lines produced four money-affecting defects in four releases, every one a round-trip ASYMMETRY that a comment cannot catch and a write→read→write test can. Tested by paycalc-form-data.test.mjs
├── paycalc-inputs.js       ← the DOM-pure form-field input helpers extracted from paycalc-app.js's init() (v18.60, review item 10 — coordinator extraction): numVal / numValOr / intVal / hhmmDec / clampMins + the live "= 7h 30m" decimal hint (_decHintEl / decPreview). Depend ONLY on `document` + imported pure helpers (parseSmartFloat/parseSmartFloatOrNull from roster-data, clampMinute/decimalToHM from paycalc-format) — no coordinator state — so they lift out cleanly and are unit-testable against a fake `document`. The event WIRING that USES them (autoDecimalHours, onHhMm) stays in paycalc-app.js (it closes over calculate()/autosave()/period state). Tested by paycalc-inputs.test.mjs
├── paycalc-transfer.js ← the pay-data BACKUP FORMAT and import rules: `selectBackupKeys`, `summarise`, `buildBackup`, `validateBackup`, `rekeyEntries`, `backupFilename`. Exists because paycalc data lives in localStorage, which is per-ORIGIN and does not follow a member to a new phone or address. `validateBackup` is the TRUST BOUNDARY. Tested by paycalc-transfer.test.mjs
├── paycalc-transfer-card.js ← the DOM half of the "Move Your Pay Data" card on paycalc.html: `initTransferCard()`. Owns no RULE — every decision comes from paycalc-transfer.js. Restore is a REPLACE, never a merge, and it writes before removing (see the module header: `lsSet` swallows a storage error, so reading the values back is the only signal)
├── paycalc-calc.js         ← pure pay maths (no DOM/Firebase): tax, NI, SL, gross, GRADES, TAX_YEARS
├── paycalc-help.js         ← HELP_CONTENT tooltip data (pure, no DOM)
├── paycalc-migrations.js   ← localStorage key constants (SK, periodKey, etc.), runMigrations(), and the shared saved-period decoder parseSavedPeriod/readSavedPeriod (returns {data,error}; back-pay + HPP surface a corrupt period instead of silently dropping it)
├── paycalc-roster-suggestions.js ← roster pre-fill engine: getRosterSuggestion, fetchOverridesForPeriod
├── roster-data.js          ← shared: APP_VERSION, CONFIG, teamMembers, all roster data, utility functions
├── roster-cycle-data.js    ← raw roster cycle arrays — imported by roster-data.js only
├── firebase-client.js      ← shared: Firebase init, db, all Firestore helpers
├── auth-identity.js        ← pure account-identity helpers extracted from firebase-client (no Firebase import, so unit-testable): normaliseSurname (surname derivation for Firebase Auth) + nameToEmail (initial.surname@myb-roster.local account email). Re-exported by firebase-client.js; the surname-parity source-equivalence check + the functions/roster-parse-helpers.js duplicate track THIS file
├── storage-utils.js        ← pure Storage helpers extracted from firebase-client (no Firebase import, so unit-testable): isSafeStorageUrl (download-URL allowlist — a security control), isDocxUpload (upload file-type detect), officeViewerUrl (wraps a .docx download URL in Microsoft's Office Online viewer so Word circulars/newsletters open+render instead of downloading), sixMonthCutoffISO (month-underflow-safe 6-month retention cutoff for _pruneOldDocs). Re-exported by firebase-client.js
├── client-errors.js        ← the pure RULES of the client error log, for BOTH sides of it: `shouldReport` (v19.20 — the capture-side noise filters, extracted from error-reporter.js because that module imports the gstatic SDK and so can't load in Node) + the read-side ordering/retention (isResolvedErrorExpired, expiredResolvedIds, orderClientErrors, capUnresolvedErrors — the over-fetch→shown+truncated split, extracted from getClientErrors). The filters had shipped UNTESTED from v13.31 to v19.19, which is backwards for this code specifically: too narrow only leaves visible noise, but too broad silently swallows real errors and the Error Log looks healthy BECAUSE it is broken
├── claim-retry.js          ← pure stale-claim self-heal runner (runWithClaimRetry, isClaimRetryable) extracted from firebase-client.js so the security-critical write retry (permission-denied/storage-unauthorized → force token refresh → retry once → preserve original error) is unit-testable in Node. firebase-client's withClaimRetry/_uploadBytesWithClaimRetry inject the Firebase auth deps. Tested by claim-retry.test.mjs
├── ls.js                   ← iOS-safe localStorage wrappers: lsGet, lsSet, lsDel, lsKeys
├── storage-keys.js         ← single source for the CROSS-FILE localStorage keys (SELECTED_MEMBER + legacy alias, VIEWED_MONTH/YEAR, PW_FORCE_PENDING_PREFIX, and — v19.91 — `NOTICE_PW_OWN_DONE`, the `pw-own-2026` retirement flag written by settings-app.js and read by calendar-app.js); shared so a cross-file key has ONE spelling (v16.81). Per-module + paycalc-namespaced keys stay local.
├── index.css / admin.css / paycalc.css / operations.css / settings.css ← page-specific CSS
├── overtime.html           ← Overtime availability: one page carrying BOTH surfaces (a member's own form and the reviewer workspace), because they are the same subject seen from two sides and a second page would double every contract. Reviewer-only during the restricted live beta
├── overtime.css            ← CSS for overtime.html. One visual idea — the WEEK ROW — because every action on this page, member or manager, is per-week
├── overtime-app.js         ← coordinator for overtime.html: access gate, login, tabs, and the Manager PLANNING HORIZON. Body is an exported `init()` invoked by overtime-boot.js. **The horizon is the point of the page, not a convenience** — a weekly-window system's one catastrophic failure happens before any document exists (nobody created the week), and it is invisible everywhere else
├── overtime-boot.js        ← 2-line bootstrap for overtime.html (CSP blocks inline module scripts)
├── overtime-data.js        ← every call the Overtime page makes to the server, and the corrected clock it keeps from their answers: the four endpoint wrappers, the auth header, the timeout budgets (ABOVE each endpoint's own ceiling), and `correctedNow()`. `clientMutationId` is generated HERE so no call site can forget the thing that makes a timed-out submission reconcilable
├── overtime-format.js      ← the PURE client side of Overtime — how a window, a phase and a day's answer are put into words, plus `clockOffset` (round-trip corrected) and `submitDisposition`. **The client never refuses a submission near a deadline**: inside the grace band it sends and lets the server decide, because a client that refuses has denied somebody who was in time. Tested by overtime-format.test.mjs
├── overtime-form.js        ← the member's seven-day form: render, collect, submit, reconcile. **Three things here are easy to "tidy" and must not be** — an unanswered day stays unanswered (no default, no copy-last-week); the client never refuses a submission near the deadline; and a timeout goes into RECONCILIATION rather than being reported as a failure, because aborting stops us waiting and not the server writing
├── overtime-roster.js      ← what a member is actually rostered to do on each day of a window: ONE bounded Firestore read for one member over seven dates, resolved through the shared `resolveEffectiveShift` ladder. Deliberately NOT the calendar's fetcher — that module holds process-wide state and an authoritative reconciler, and a second one racing it is the Team View eviction bug all over again. Unknown context hides the roster-derived options rather than anchoring them to an unverified base roster
├── overtime-tips.js        ← CARD_TIPS for overtime.html's `?` panels. Pure data; the shape tips-content.test.mjs pins
├── links.html              ← link design workspace (rotation designer, `ROTATING_LINES` lines; visible to CONFIG.LINKS_DESIGNERS only)
├── links.css               ← CSS for links.html (grid, paint bar, picker chips, compare, heat map)
├── links-app.js            ← coordinator for links.html: multi-design Firestore, grid, paint, compare, generator UI. Body is an exported `init()` (Phase 4a.2) invoked by links-boot.js — early-return access gate, no top-level throw
├── links-boot.js           ← 2-line bootstrap for links.html: imports `init` from links-app.js and calls it (CSP blocks inline module scripts; keeps init() importable without auto-running, for tests)
├── links-concurrency.js    ← the PURE co-editing rules for the Links workspace (v19.38): `conflictOf` (did someone else save while we had the page open?), `baselineAfterWrite` (a failed read-back must flag the baseline UNKNOWN, never merely null) and `canAdvanceBaseline` (a rename may only move our baseline when nothing changed underneath it). Extracted because this logic has produced THREE bugs — v16.19, v16.23, v17.18 — every one a SILENT overwrite of a colleague's work, and every one fixed by reasoning inline in a 1,500-line coordinator with no seam to test through. The loser of the race sees a successful save and only finds out on reopening. Tested by links-concurrency.test.mjs, one case per historical bug
├── links-fatigue.js ← the ORR good-practice FATIGUE FACTORS (Dec 2021 guide p3) assessed against a design: `assessFatigue` + the pure rules it composes. **It reports factors PRESENT — it never passes or fails a design**, because the ORR is explicit these are not prescriptive limits. Every rule reports its status including CLEAR and NOT-APPLICABLE, and every rule laps the rotation. Full rules: the module header and `.claude/rules/links-design.md`. Tested by links-fatigue.test.mjs
├── links-limits.js ← the HARD limits — the ones a design either meets or does not: `MAX_CONSECUTIVE_WORKED_DAYS` (13), `POLICY_SOURCE_CONFIRMED`, `assessHardLimits`. **A separate module from links-fatigue.js on purpose** — a hard limit is the opposite kind of statement from an advisory factor, so the separation is structural (own function, own count, own section, red on a breach, renders when passing). The attribution history, the worst-case rule and the evidence flag are in the module header. Tested by links-limits.test.mjs
├── links-adjacency.js ← what happens BETWEEN the lines — the ORDER they sit in: `OBJECTIVES` (six switches), `scoreOrder`, `cost`, `reorderLines`, `applyOrder`. Reordering is FREE with respect to coverage, so the objectives compete only with each other. **Weights, the unconditional spare spread and the per-attempt determinism are argued in the module header.** Tested by links-adjacency.test.mjs
├── links-demand.js ← the SERVICE a design has to cover — trains per hour at Marylebone: `DEC_2026_MOVEMENTS` (stored as TIMES, not an hourly table — that is load-bearing), the derived `DEC_2026_DEMAND`, `summariseDemand` and friends. Demand = arrivals as well as departures, weighted by train length. It never scores a design. Tested by links-demand.test.mjs
├── links-window.js ← the OPERATING WINDOW of a design — when the station is staffed: `DEFAULT_WINDOW`, `normaliseWindow`, `isHourStaffed`, `heatSpan`, `formatWindow`, `windowsDiffer`, `isDefaultWindow`, `canonicaliseWindowTime`. Stored PER DESIGN so a proposal can test a moved boundary; compare mode diffs CELLS, not windows, so both columns must state it. Tested by links-window.test.mjs
├── links-deletion.js ← the PURE rules behind "Recently deleted": `isDeleted`, `isPurgeable`, `purgeableIds`, `daysLeft`, `deletedLabel`, `sortByDeleted`, `canSoftDelete`, `SOFT_DELETE_RETENTION_DAYS` (**dormant** — automatic purging suspended v19.86; no client-side age check survives a fast device clock). `isDeleted` and `isPurgeable` are deliberately NOT mirrors — see the module header. Tested by links-deletion.test.mjs
├── links-design.js ← pure link-design maths: `ROTATING_LINES` (the ONE declaration of the rotation length — never write the number down), shift classification/normalisation, coverage, the auto-generator (`generateLink` + waves), `runDesignChecks`, `weeklyHours`, the worked-run helpers and `endMinutesAbs`. **The invariants an edit can silently break are in the module header** — read it before touching the generator or the hours maths. Tested by links-design.test.mjs
├── links-design-doc.js ← the SHAPE of a link design, in memory and in Firestore, and every conversion between the two: `designFromDoc`, `binEntryFromDoc`, `docPayload`, `workingCopy`, `binEntryFrom`, `restoredEntryFrom`, `deepCopyPatterns`, `LEGACY_DOC_ID`. Eleven sites built these by hand in four shapes and it failed twice; the three rules are in the module header. Tested by links-design-doc.test.mjs
├── links-design-doc.test.mjs ← organised around the two INVARIANTS, not the functions — a per-function suite would pass on exactly the code that produced both bugs. `EVERY_SHAPE` lists all six producers, so a producer added later fails here rather than in somebody's proposal. Part of test:hygiene
├── links-seed.js ← the generator's TARGET SEED: `rosterSeedLines` + `buildRosterTargets` — read the roster people actually work, produce the shift-slot targets the generator starts from. The rule it enforces is that the seed samples exactly what the design represents. Tested by links-seed.test.mjs
├── links-analysis.js ← links.html read-only analysis panels — Coverage heat map, Design quality checks, and the sticky summary strip: `initLinksAnalysis({ getDesign, getBaseline })`. Pure render-from-a-pure-result. **Every class it emits must exist in links.css, and any section claiming a limit must name whose requirement it is** — both enforced by links-analysis.test.mjs
├── links-compare.js        ← links.html compare mode — two designs side-by-side with a gold-outline diff (extracted from links-app.js v17.71). **Single source of truth for compareMode/compareDesignId** (links-app.js only asks/resets, so they can not desync); reads the design collection read-only, never touches the save/concurrency baseline. It held its own `const TOTAL_POS = 28` until v19.98 — the fourth copy of a number `links-design.js` had been the single declaration of since v19.38, missed because this module was extracted afterwards and carried the literal out with it; at 22 lines it would have rendered six extra rows no analysis counted. Now imports `ROTATING_LINES`, pinned by `links-rotation-parity.test.mjs`. Exports + detail: AI_MAP.md. Tested by links-compare.test.mjs
├── shared.css              ← CSS shared by all six app pages (nav panel, lightbox, login, card-header, btn-action) — NOT the guides
├── guide-shell.css         ← shared chrome for all 5 guide pages (header + gold brand rule, .btn-back, .btn-pdf, chip-bar, print, palette tokens, and — v18.79 — the shared Inter @font-face + --font-sans so the guides render the app's brand typeface)
├── guide-doc.css           ← shared styles for the two document-style guides (guide.html, paycalc-guide.html): two-column print layout, info boxes, tables, numbered steps, banner. Loaded between guide-shell.css and page CSS. NOT linked by railcard-guide.html or fip.html.
├── guide.css / paycalc-guide.css / railcard-guide.css / fip.css ← page-specific guide CSS
├── purify.es.mjs           ← self-hosted DOMPurify v3.4.12. Upgrade: `npm pack dompurify@<ver>`, extract purify.es.mjs
├── service-worker.js       ← single SW for all pages; cache name includes APP_VERSION
├── manifest.json           ← PWA manifest for all pages
├── guide.html / paycalc-guide.html / railcard-guide.html / fip.html / rangers-guide.html ← printable guides (via nav panel)
├── rangers-guide.js / rangers-guide.css ← the Rangers & Rovers guide — the ranger/rover area passes staff accept or refuse at the gateline. A DIALECT of the railcard guide. It answers the **Marylebone** question first: every card carries `data-myb-validity` AND `data-chiltern-validity`, and **neither may be inferred from the other** (a pass can be a real ticket on our network and no use from London). Evidence state is per CLAIM, not per card, and has FOUR values — **a Conflict is not a stronger Draft, an `unconfirmed` is not a milder Conflict, and none of them may share a marker.** Full design: RANGERS_ROVERS_PLAN.md and `.claude/rules/guide-pages.md`
├── railcard-guide.js       ← JS for railcard-guide.html: print, chip-bar navigation. The PAGE was rebuilt for the Marylebone gateline at v20.38: it separates the RAILCARD's discount rule from the TICKET's validity from CHILTERN's revenue procedure, groups the cards by the KIND of morning rule (none / minimum fare / fixed cutoff / follows-the-ticket), and carries a directional Chiltern Off-Peak panel in place of the invented `~10:00` shortcuts. **The Network AREA ends at Banbury — verified, and do not "correct" it.** v20.38 briefly rewrote it to reach Birmingham on a bad inference from the map's station index (which also lists Bristol and Exeter), then settled it properly by extracting the map's own 41-vertex boundary polygon and testing point-in-polygon: Banbury inside and on the edge, Leamington/Solihull/Birmingham outside. A claim that LOOSENS a restriction needs more evidence than one that tightens it — this one would have made a gateline accept invalid tickets. Full design + the source audit: `.claude/rules/guide-pages.md`
├── fip.js                  ← JS for fip.html: (1) the **country finder** (v17.64) — live-filters the country cards (selected by `[id^="country-"]`, never counted in code or prose) + A–Z jump chips by country name OR operator/train text; progressive enhancement (JS off → all visible). (2) opens the target country `<details>` on a jump/deep link. (3) the sticky **section chip-bar** (v17.66) + **scrollspy** (v17.68) — mirrors railcard-guide.js; honours `prefers-reduced-motion`. Full detail: AI_MAP.md.
├── guide-print.js          ← shared print button for guide.html and paycalc-guide.html
├── guide-back.js           ← shared back-arrow retarget for all 5 guide pages (classic script, no exports): reads the `?from=<page>` hint nav-panel.js appends when opening a guide and points that guide's `←` at the page you actually came from, instead of its hardcoded default (calendar / pay calculator). Needed since v18.81 made guides navigate in the SAME tab — before that a new tab preserved the page you left. `from` is checked against an allowlist of the app's own pages, so it can never become an off-site link; no `from` leaves the authored href untouched
├── icon-*.png              ← 6 sizes: 120, 152, 167, 180, 192, 512 · icon-badge.png (monochrome notification badge, 96px)
├── fonts/
│   └── inter-latin.woff2   ← self-hosted Inter variable font (latin, wght 100–900)
├── CLAUDE.md / AI_MAP.md / OPERATIONS_REFERENCE.md / KNOWN_LIMITATIONS.md / ROADMAP.md ← the five VERSION-STAMPED docs (re-stamped every 0.10 milestone; enforced by `sw-asset-check.test.mjs`)
├── ROADMAP_HISTORY.md ← everything ROADMAP.md used to carry about the PAST — completed phases, shipped features, removed features with their restoration specs, reverted experiments, closed audits. **Moved VERBATIM.** If something here becomes live again, MOVE it back rather than copying it. Not version-stamped; not a runtime asset.
├── MAINTENANCE_CALENDAR.md ← the work that has a DEADLINE whether or not anyone plans it (v19.97, external review): the 2027/28 paycalc rollover (hard 6 Apr 2027), `MAX_YEAR` 2030→2032 (end 2028), the override-count archive trigger (~5,000 docs), the recurring guide/pay source reviews, and the after-every-new-starter checks. It was scattered through KNOWN_LIMITATIONS.md prose and GUIDE_SOURCES.md rows — the wrong place, because those files are read when investigating something and a tax-year rollover is not something you investigate. **Every row carries a WARNING POINT earlier than its deadline**, deliberately: "must be done by 6 April" reliably becomes "started on 4 April". Not version-stamped; not a runtime asset.
├── SECURITY_RELEASE_PLAN.md ← master sequencing/risk plan for the deferred security release (per-member isolation, named sessions, App Check, password retirement, WIF, firebase-admin bump). **Carries the CANONICAL TRACK STATUS table (v19.97) — the single source of truth for what stage every track is at.** Status had to be reconciled across five files, and `auth-plan-parity.test.mjs` exists because two of them had already drifted; every other plan now owns DESIGN and points here for STATUS. If you are updating a stage, update it there and nowhere else. Not version-stamped; not a runtime asset.
├── PASSWORD_PLAN.md ← the agreed "C-lite" chosen-password design (Track C with email deferred): gated dual-attempt sign-in, self-service set/change, admin break-glass, the migration flags and the Operations Account-status table. **Status lives in SECURITY_RELEASE_PLAN.md's canonical track table.** Not version-stamped; not a runtime asset.
├── AUTH_PLAN.md ← the full-app authentication design (Track E): what "behind authentication" can and cannot mean when the app shell is static files on public hosting, what is actually open today, and the E0–E6 phases either side of one binary decision gate. **Status lives in SECURITY_RELEASE_PLAN.md's canonical track table.** Not version-stamped; not a runtime asset.
├── ARCHITECTURE_PLAN.md     ← auth/session consolidation plan (Track 1: identity state machine + page-auth policy map, behaviour-preserving, landed ahead of the B3 strict cutover) + supporting refactors (testable coordinators, roster-data split) and the MILLER_ACTUALS privacy decision. Companion to SECURITY_RELEASE_PLAN.md. Not version-stamped; not a runtime asset.
├── LOGIN_INCIDENT.md        ← incident log for the v14.72–74 login freeze/slowness — RESOLVED (freeze fixed v14.75; B1 re-enabled v14.98). Records the diagnosis, the current auth-flag state (B1 `ENFORCE_NAMED_SESSION=true`; B2/B3 shipped — override write-isolation is now STRICT (v16.29), `CLAIM_EPOCH=2` since v15.33), and the re-enable checklist. READ THIS before touching login/auth. Not version-stamped.
├── RECOVERY_RUNBOOK.md      ← "break glass" backup/rollback/disaster-recovery runbook: preventative setup (Firestore PITR + scheduled backups + GCS exports) and task-led incident playbooks (deleted override, bad roster upload, Functions/Rules/Hosting rollback, GitHub-mirror failover, Firebase outage, restore-from-export). Owner-facing ops doc; not version-stamped; not a runtime asset.
├── LINKS_DEC2026_PLAN.md ← the Links workspace vs the **December 2026 timetable change** ("Dec 26" is the TT change, NOT Boxing Day). Records the measured Dec 2026 service at Marylebone, the CEA operating window and the one boundary the new timetable breaks, the measured BASELINE of the live link, and five work packages. **The release history of the links modules lives here** rather than in the CLAUDE.md tree. Not version-stamped; not a runtime asset.
├── RANGERS_ROVERS_PLAN.md ← the plan for the FIFTH guide page — the ranger/rover area passes staff accept or refuse at the gateline. Carries the evidence-class argument, the design decisions that are settled, the 17-item contract checklist for what a fifth guide touches, and the per-product source position. Not version-stamped; not a runtime asset.
├── OTHER_PLAN.md            ← the "Other" day family (Training/Induction/Assessment/Team Day/Union) — shipped v15.34–57, Union course v18.56, Meeting v18.61; pruned to the design decisions (cited from code as "OTHER_PLAN.md decision N"), the v15.40 Evolution record, and the Phase B checklist (now all shipped). Not version-stamped; not a runtime asset.
├── GUIDE_SOURCES.md         ← source register for the operational guides (railcard/FIP/pay): every high-risk claim's authoritative source, review dates, and National/Local/Tip/Fact class. Structurally enforced by guide-sources.test.mjs. Closes the v17.45 audit's content-assurance gap. Not version-stamped; not a runtime asset.
├── A11Y_FINDINGS.md         ← accessibility gate (e2e/axe.spec.js) baseline + fix-vs-waive triage: the current axe-core findings (nested-interactive on collapse headers; some color-contrast), recommendations, and the path to make the gate blocking. Not version-stamped; not a runtime asset.
├── test-fixtures/
│   └── miller-actuals.js   ← MILLER_ACTUALS payslip fixture (13 real 2025/26 payslips) — imported by paycalc.test.mjs; NOT served (excluded from Hosting; privacy — see ARCHITECTURE_PLAN.md)
├── githooks/
│   └── pre-commit          ← the enforced pre-commit hook (module/export doc rules, AI_MAP 0.10 stamp, staged-JS ESLint, single-SDK-version check — see "Same-commit rule")
├── robots.txt              ← staff-only app: nothing here has a public audience. Deliberately ALLOWS crawling — the de-index control is `noindex` (the `X-Robots-Tag` header in firebase.json + a `<meta name="robots">` in all ten pages, which is the only signal the headerless GitHub Pages mirror gets). `Disallow: /` would be counterproductive: a crawler that may not FETCH a page can never READ its noindex, so a URL found by another route could still be listed URL-only. Do not change it to Disallow. (v19.00, SECURITY_RELEASE_PLAN "E0")
├── .nojekyll               ← empty marker — makes GitHub Pages skip its Jekyll build (do NOT delete; see Workflows note above)
├── override-utils.test.mjs            ← tests for override-utils.js
├── roster-data.test.mjs    ← tests for roster-data.js
├── paycalc.test.mjs        ← tests for paycalc-calc.js
├── paycalc-roster-suggestions.test.mjs ← (--experimental-test-module-mocks)
├── roster-parse-helpers.test.mjs / links-design.test.mjs / admin-rangepicker.test.mjs / client-errors.test.mjs / usage-stats.test.mjs / perf-stats.test.mjs
├── functions-surface.test.mjs ← pins functions/index.js's fifteen exports (the DEPLOY surface — a re-export dropped in a refactor is a function DELETED on the next deploy, and nothing else fails first). Runs in test:functions, not npm test: it requires firebase-admin/functions from functions/node_modules
├── fetch-timeout.test.mjs ← tests the Cloud Function call bound. Organised around the one thing a bound gets wrong in practice — mistaking somebody ELSE's abort (a navigation, a caller's own controller) for its own, which would tell an admin a write "may still have gone through" after a request that never left. Part of test:hygiene. Teeth-verified
├── error-reporter.test.mjs ← tests the Error Log noise filters (`shouldReport` in client-errors.js). Written when a FIFTH filter was needed and the existing four had no tests at all — the asymmetry is the point: a filter that is too narrow leaves noise you can see, a filter that is too broad silently swallows real errors and nothing ever tells you. So each rule is pinned from BOTH sides — the thing it must suppress, and the neighbouring real error it must not. Teeth-verified four ways, one of which initially PASSED (loosening the IndexedDB phrase list to a bare 'Database' slipped through until a case was added that shares the API call and differs only in its tail). Part of test:hygiene
├── storage-utils.test.mjs ← tests for isSafeStorageUrl (bucket allowlist) + isDocxUpload + officeViewerUrl (Office viewer wrap/encoding) + sixMonthCutoffISO (month-underflow clamp); part of test:hygiene
├── auth-identity.test.mjs ← tests for normaliseSurname + nameToEmail (identity-critical account email derivation); part of test:hygiene
├── notif.test.mjs         ← tests for notif.js: notifSupported/isIOS, getNotifState VAPID rotation, peekNotifState (no side effects), enable/disableNotifications (--experimental-test-module-mocks)
├── surname-parity.test.mjs ← asserts the identity derivation stays in sync across the ESM/CommonJS boundary — `normaliseSurname` ↔ the functions copy, and (v19.98) `nameToEmail`, the ACCOUNT IDENTIFIER and the more consequential half: a drifted email provisions an account that does not exist while "Set up accounts" reports success. Part of test:hygiene
├── payday-cutoff-parity.test.mjs ← asserts isPayCutoffDay (functions/roster-parse-helpers.js) stays in sync with CONFIG.FIRST_PAYDAY/PAYDAY_INTERVAL_DAYS + getPaydaysAndCutoffs (roster-data.js) — source-equivalence on the hardcoded anchor + behavioural on every pure-grid (non-BH-shifted) cutoff; part of test:hygiene
├── import-graph.test.mjs   ← detects circular imports across all root ES modules (regex-based, no build step)
├── admin-overrides.test.mjs ← tests for getEffectiveShift, validateShiftRules, buildMemberDateMap (--experimental-test-module-mocks)
├── admin-roster-upload.test.mjs ← tests for shiftValueToOverrideType (parsed value → override type, incl. training + Sunday block) + _saveOverrideBatches stale-claim retry parity (permission-denied → token refresh → fresh batch → retry once) (--experimental-test-module-mocks)
├── nav-panel.test.mjs      ← tests for isNoticeExpired, archiveNotice, initNavPanel DOM guard (--experimental-test-module-mocks)
├── sw-register.test.mjs    ← tests for registerServiceWorker: first-install claim must not reload, update reloads once, beforeReload gets every controllerchange, SKIP_WAITING gating (no mocks; part of test:hygiene)
├── sw-internals.test.mjs   ← unit tests for service-worker.js's PURE helpers (_appCacheVersion, compareAppCacheDesc — the v16.86 cross-version cache sort — ctSafe, unredirect). The SW is a classic worker (can't be imported), so the test reads the SW source and evals each function BY NAME in a sandbox — assertions run against the SW's real code, no duplicate copy, no runtime change. Extraction throws (test fails loudly) if a helper is renamed. No mocks; part of test:hygiene
├── session.test.mjs        ← tests for constants, getSession, saveSession, clearSession, sessionReady/resolveSession, getSurname, refreshClaimsIfStale (--experimental-test-module-mocks)
├── login-overlay.test.mjs  ← tests for runNamedSignIn: the sign-in core commits the local session ONLY after auth resolves (timeout/throw/enforce-fail → no save), enforce on/off, transient-vs-persistent messages (--experimental-test-module-mocks)
├── auth-state-core.test.mjs ← tests for reduceAuthState (pure identity state machine; no mocks; part of test:hygiene)
├── auth-state.test.mjs     ← tests for the auth store: getAuthSnapshot/subscribeAuth/dispatchAuth, no-op/listener isolation (no mocks; part of test:hygiene). The session.js→store bridge is tested in session.test.mjs.
├── auth-policy.test.mjs    ← tests for requirePageAuth/requirePage/rolesFor: the page×status×role decision matrix + invariants (degraded never allows, soft never blocks, public always allows, fail-closed on unknown page). No mocks; part of test:hygiene.
├── overlay.test.mjs        ← tests for lockBodyScroll, unlockBodyScroll, trapFocus, initCardCollapse (no mocks; runs in test:hygiene)
├── date-picker.test.mjs    ← tests for the pure monthCells() month-grid helper in date-picker.js (no mocks; runs in test:hygiene)
├── overlay-history.test.mjs ← tests for the Android-Back history STACK in overlay.js: nested overlays each get their own entry, Back closes only the topmost, a handler's own _clearOverlayHistory doesn't cascade, dedupe on double-open (capturing popstate harness; runs in test:hygiene)
├── calendar-state.test.mjs / calendar-member.test.mjs / calendar-overrides.test.mjs ← tests for calendar-state.js, calendar-member.js, calendar-overrides.js (--experimental-test-module-mocks)
├── calendar-renderer.test.mjs   ← tests for createCalendarHeader, createDayCell, getSwipeDirection, buildCalendarContainer (fake DOM; --experimental-test-module-mocks)
├── calendar-initial-fetch.test.mjs ← tests for initInitialFetch: pre-fetch setup, success/failure paths, the sync-chip state machine, retry, visibilitychange, the E1 two-phase load, and recovery where there is NO sync chip (first run and Team View have none, which made the most load-bearing line in the module its least-tested one)
├── paycalc-periods.test.mjs ← tests for getPeriods, hasBoxingDay, hasBankHoliday, _setSelectPeriod, prevPeriod/nextPeriod; also getEffectiveContr, getProRateFactor, settingsKey, _bpAwardTaxYear (--experimental-test-module-mocks)
├── paycalc-hpp.test.mjs    ← tests for isDataEmpty, _decodeHours, _varPayForPeriod from paycalc-hpp.js (--experimental-test-module-mocks)
├── paycalc-hpp-schedule.test.mjs ← tests for the HPP payslip ↔ tax-year relation, incl. the inverse round-trip against the REAL tax-year table + period grid; no mocks, part of test:hygiene
├── paycalc-migrations.test.mjs ← tests for pcPrefix, setPaycalcNamespace, SK rebuild, one-shot namespace migration (--experimental-test-module-mocks)
├── paycalc-format.test.mjs ← tests for clampMinute + decimalToHM (hrs/mins split, incl. the 60→next-hour float guard) + fmt currency formatting + fd/fdShort/fdLong variant distinctness; no mocks, part of test:hygiene
├── paycalc-breakdown.test.mjs ← tests for buildSummaryRows + buildBreakdownRows + fmtHrsMins (paycalc-breakdown.js): per-line guards, back-pay/HPP branches, estimate labels; no mocks, part of test:hygiene
├── paycalc-form-data.test.mjs ← the round-trip tests for paycalc-form-data.js — write→read→write, plus a case per historical defect (blank/garbage pension → null, a typed 0 preserved as the real salary-sacrifice opt-out, the v18.43 default self-heal and its ±0.005 tolerance, actualNet's phantom £0, sign survival, and that every schema key is produced by a read so an added field can't be silently dropped on the next autosave). Teeth-verified against all four historical defects reintroduced one at a time. NOTE the fake DOM coerces `value`/`textContent` to strings like the real platform — writeFormData assigns raw numbers, and a naive `{value:''}` stub reported a product bug that does not exist (--experimental-test-module-mocks)
├── paycalc-backpay-state.test.mjs ← one describe block per historical defect, because they are five different ways for a money figure to come out wrong with nothing on screen to say so. Covers the round trip, the lock decision and the paid-in ladder. Part of test:hygiene
├── paycalc-transfer.test.mjs ← tests the pay-data backup/restore. The two things worth testing hardest are the TRUST BOUNDARY (a backup is a file from somewhere) and the ROUND TRIP (these are pay figures, not approximations). Part of test:hygiene
├── paycalc-key-parity.test.mjs ← the answer to "does the pay-data transfer need checking every time the pay calculator changes?" — yes, and a habit someone has to remember is the weakest form of that, so it is a static guard. Four contracts around localStorage key SHAPE, both failure modes of which are silent. Part of test:hygiene
├── links-rotation-parity.test.mjs ← the rotation LENGTH is declared once and stated nowhere. Four contracts covering both classes of copy the v19.38 sweep missed — a module-level literal, and ~15 copies in user-visible PROSE. Comments are stripped before matching, deliberately. Part of test:hygiene
├── roster-prompt-parity.test.mjs ← the roster-parse PROMPT is code, and nothing was checking it. Written after a staff report that AL was only recognised half the time — an INSTRUCTION CONFLICT, not flaky vision. Two contracts: no line-POSITION rule that can swallow a status code, and code-table parity with `normaliseShift`. Part of test:hygiene
├── paycalc-inputs.test.mjs ← tests for numVal/numValOr/intVal/hhmmDec/clampMins + _decHintEl/decPreview (paycalc-inputs.js) against a minimal fake DOM: smart-minus parse, empty→fallback, negative floor, minute clamp preserve-typed, lazy hint create/hide; no mocks, part of test:hygiene
├── paycalc-settings.test.mjs ← tests that the money-critical grade-lookup wrappers getStoredRateForYear + getPensionDefault DELEGATE correctly (asserted against the real awardRatesFor/getPensionForPeriod, not magic numbers) — previously the module was only ever mocked (--experimental-test-module-mocks)
├── usage-reporter.test.mjs ← tests recordUsage/recordOpen: the write-time admin exclusion (CONFIG.ADMIN_NAMES), page-view vs active-account gating, per-window active-account dedup, recordOpen no-dedup, and (v19.95) that a signed-OUT calendar visitor now counts as an active account while a first-run device with no identity still does not — plus that the calendar and an authenticated page are ONE account, since the dedup keys are deliberately shared across both routes (--experimental-test-module-mocks)
├── perf-reporter.test.mjs ← tests recordPageLatency: the admin exclusion + the one-shot login marker (consumed even when excluded so it can't mis-time a later staff load), markLoginStart/clearLoginStart (--experimental-test-module-mocks)
├── doc-upload.test.mjs ← tests the pure upload file-type gate isPdfFile/isDocxFile (MIME + case-insensitive extension; .doc≠.docx; "must END with .pdf") (--experimental-test-module-mocks; session/roster-data mocked only to load)
├── firestore.rules.test.mjs ← Firestore security rules integration tests (all 10 collections incl. analytics + passwordStatus); run with `npm run test:rules` — starts/stops Firestore + Storage emulators automatically via firebase emulators:exec; NOT part of npm test (requires Firebase emulator binary); gates every branch/PR (e2e.yml `rules` job) AND deploy-rules.yml before any rules ship
├── storage.rules.test.mjs  ← Firebase Storage security rules integration tests (huddles, circulars, newsletters, catch-all); run with `npm run test:rules` alongside firestore.rules.test.mjs
├── storage-rules-static.test.mjs ← static (no-emulator) hygiene guard: asserts the 20 MB `request.resource.size` cap is present in all 3 upload blocks (the emulator suite can't practically test the size cap); part of `npm test` (test:hygiene)
├── sw-asset-check.test.mjs ← deployment hygiene: SW asset lists, APP_VERSION sync, roster-members.json sync, the VAPID public key identical in `functions/index.js` and `notif.js` (a mismatch is silent AND permanent), modulepreload limits, notification deep-link allowlisting, the work-email domain, the `noindex` meta, and all 5 doc version stamps
├── csp-hygiene.test.mjs    ← static (no-emulator) CSP guard: asserts firebase.json's Content-Security-Policy stays in step with what the app actually loads — every contacted host is permitted AND no stale origin lingers. Part of test:hygiene. (Its REQUIRED host list is itself hand-maintained — add a newly-contacted host there.)
├── csp-meta-parity.test.mjs ← static guard that every served HTML page's `<meta http-equiv="Content-Security-Policy">` stays in lockstep with the firebase.json header CSP (minus the directives a meta CSP can't express — `frame-ancestors`/report/sandbox). The meta exists so the GitHub Pages staff mirror — which CANNOT serve HTTP headers — gets the SAME policy (and the CSP travels with the HTML through the SW cache on both origins). Part of test:hygiene. Teeth-verified
├── guide-sources.test.mjs ← structural guard for GUIDE_SOURCES.md: every high-risk row keeps its source, review dates and class; the two-way `data-guide-source` contract; the RENDERED freshness dates on FIP country cards; per-country rows citing their own page; and the provisional-state contract (a Draft/Conflict row must be declared on the page it certifies). Part of test:hygiene
├── app-name-parity.test.mjs ← **"MYB" may name the STATION; it may never name the SOFTWARE.** The on-screen name has been "Marylebone Roster" since v15.05 and was violated twice with no review catching either — the paycalc PRINT header (the one string that leaves the app on paper) and the staff-PIN card's "MYB member?" link. The distinction is the whole design: `MYB` is Marylebone's real station code, correct and expected in the guides, so a blanket ban would fire on those, acquire an exemption list and stop guarding. Scoped to `MYB` + a PRODUCT word, which needs no exemptions; the iOS home-screen meta is removed structurally, by attribute. Part of test:hygiene. Teeth-verified against both shipped defects
├── card-header-parity.test.mjs ← static guard for the two canonical card-header conventions across the 5 card-bearing app pages: every card title is an `h2` (operations.html had all nine as `h3` — styled identically, so its heading outline silently ran h1→h3; axe's heading-order rule is best-practice-tagged, so the a11y gate never saw it) and every card title leads with an emoji ("Change a Shift" was the only bare one in the app). Comments are stripped before matching so a long comment can't hide a card from the guard. Part of test:hygiene. Teeth-verified
├── doc-parity.test.mjs ← the documentation is CHECKED, not merely reviewed (v20.11). The 0.10 re-stamp is a prompt to look and verifies nothing — and looking has repeatedly not been enough (a nav-drawer entry wrong for ten versions, a `~90` count, six "22 lines" comments, a 30-day countdown promised ten versions after the purge was switched off). All one bug: **prose restating a fact that lives somewhere else.** Three contracts: every module routed from BOTH docs and every test + runner config from CLAUDE.md; no live doc writes down a count a constant owns (a doc stating the RULE may name the number it forbids); and **the file tree stays a routing table** — no entry over ~1,600 chars, and a cap on version references, because the tree had reached 136k chars and 208 stamps. Part of test:hygiene. Teeth-verified
├── overtime-endpoints.test.mjs ← the Overtime endpoints actually EXECUTED against a fake Firestore and token verifier, because a surface test proves the handlers were DEFINED, not that any of them works — the lesson of the Calendar PIN outage, whose token-mint path had never once run in production. Teeth-verified by 11 mutations; the first pass found one guard (the single-batch participant bound) with no test at all. Runs in test:functions
├── page-visibility-parity.test.mjs ← **`hidden` must actually hide.** The attribute works by a UA rule at the lowest possible specificity, so ANY author `display:` out-specifies it and the element renders in full while every piece of code around it believes it is hidden — nothing errors, nothing warns, and no behavioural test can see it. The app had hit this three times (calendar controls, the Links window editor, and — found by this guard — an empty AL banner on admin, an Operations shortcut shown to designers who are not admins, and an empty Links summary strip). Part of test:hygiene
├── page-contract-parity.test.mjs ← **a new app page joins EVERY contract, or fails here.** Written because adding the sixth page found that most parity suites carry a HAND-MAINTAINED page list — csp-meta, card-header, page-css and tips-content all went green against it by not looking at it, and their silence was indistinguishable from success (the same defect as the hand-listed `node --check` in deploy-functions.yml). It checks the CHECKERS: it enumerates served pages from the filesystem, the one source that cannot fall behind, and asserts each is named in every suite that should read it — plus noindex, colour-scheme, the boot shim, SW registration, the auth-policy entry, the nav pill and the analytics id. Part of test:hygiene. Teeth-verified six ways
├── overtime-format.test.mjs ← the Overtime client's words and its clock. The clock is the part that matters: `submitDisposition` decides whether a member is offered Submit in the minutes around a noon deadline, and the failure is not an error but a button that quietly is not there. `countsCopy` is the other — it is the one line where "no response" could be collapsed into "not available". Part of test:hygiene
├── overtime-core.test.mjs ← the Overtime rules, organised by the way each one can be wrong WITHOUT anyone noticing: a deadline an hour out, a historical milestone recomputed under today's policy, a participant list that moves under a finished week, an invented answer, a silent overwrite. Teeth-verified by mutation — and the first pass found a test with NONE: the London two-pass solve is provably redundant at 00:00 and 12:00, so the guard is now pinned at the hour where it does bite (01:00 on spring-forward, a local time that does not exist). Part of test:hygiene
├── calendar-data-state.test.mjs ← organised around the two failure DIRECTIONS, not the functions — a per-function suite would pass on exactly the code that produced the bug. `showing too much` is the shipped defect (a base roster presented as current); `showing too little` is what a hasty fix produces (a device holding good cached data reduced to a spinner), and it is why `cached` is its own state. Part of test:hygiene
├── calendar-access-core.test.mjs ← the Calendar access DECISION, pinned. Not a matrix — a matrix of two inputs and three outputs is nine assertions that would all still pass if the viewer were treated as a member. Each case is a state the shipped app can genuinely be in, and the two halves of the `named` rule each reject a real situation the other cannot see (a session with no restorable identity after iOS ITP eviction; an identity whose session has expired). Part of test:hygiene
├── calendar-access.test.mjs ← the unlock exchange and the viewer session lifecycle. Asserts ORDER as much as outcome, because two of the three security properties ARE orderings: sign out before switching persistence (or the shared viewer migrates into IndexedDB and survives the browser closing), and verify the claim before granting (a claimless token signs in perfectly and then has every read denied). Teeth-verified four ways (--experimental-test-module-mocks)
├── calendar-access-gate.test.mjs ← **no access, no override data — the invariant tightening firestore.rules does NOT deliver.** Rules are evaluated server-side, so a `getDocsFromCache` hit never consults them: a browser that unlocked yesterday still holds every override it saw. Asserts the three read paths refuse at source, and that the SAME cache paints normally once access is granted (a gate, not a disablement). Each gate teeth-verified by removal (--experimental-test-module-mocks)
├── calendar-viewer-auth.test.mjs ← the SERVER-side staff-PIN rules (functions/calendar-viewer-auth.js). Every interesting case is a boundary — the window that just expired, the block that just lifted, the attempt that REACHES the limit rather than passing it, a corrupt stored document — and none is reachable from an emulator test without waiting fifteen real minutes. Also asserts the viewer carries none of `name`/`admin`/`manager`/`linksDesigner`, each by name. Part of test:hygiene
├── calendar-viewer-parity.test.mjs ← the feature's two STATIC contracts: the viewer uid and claim agree across browser ESM, CommonJS and `firestore.rules` (a drift mints a token the rules ignore, so the PIN is accepted and every read then denied — an unlocked Calendar with no shifts and no error); and the PIN never enters the repository. It cannot check the VALUE — writing it here would be the leak — so it checks the shapes a leak takes. Part of test:hygiene
├── calendar-doc-viewer.test.mjs ← tests for the Circular/Newsletter in-app viewer used by notification taps (--experimental-test-module-mocks)
├── page-css-parity.test.mjs ← a page may only use classes its OWN stylesheets define. `settings.html` used `.card-explainer` — defined only in paycalc.css, which it does not load — for nine releases, rendering unstyled with nothing to throw. Deliberately scoped to cross-page borrowing rather than "every class exists". Part of test:hygiene
├── firestore-contract-parity.test.mjs ← static CLIENT ↔ `firestore.rules` parity: the three lists the rules restate as literals must match what the client can actually send (analytics counter ids checked BOTH ways, the Other-family flavours, the creatable override types). Complements `npm run test:rules`: that proves the rules behave as written, this proves they were written to match the client
├── focus-ring-parity.test.mjs ← guards the app's only INVISIBLE design system (v18.99). A focus ring is drawn only while a keyboard user is on the element, so it appears in no screenshot baseline, and axe has no rule for indicator quality — which is how the recipes drifted into ~80 literals across seven stylesheets and two Tab-reachable inputs ended up with `outline: none` and nothing in its place. Two contracts: (1) no app stylesheet hardcodes a recipe that has a token (`--focus-ring`/`--focus-outline`/`-gold`/`-light`, defined once in `shared.css`); (2) a `:focus`/`:focus-visible` rule that removes the outline must supply a `box-shadow` ring instead, or name itself in `NO_INDICATOR_EXEMPT` with the reason it is not a Tab stop. Part of test:hygiene. Teeth-verified
├── type-scale-parity.test.mjs ← guards that the `--type-*` scale actually IS the scale. Documented since v11.77 and never enforced; the app had drifted to 278 literal px font-sizes against 295 token uses. Only DUPLICATED values are policed — a repeated off-scale value is a candidate for its OWN token. Part of test:hygiene
├── chip-radius-parity.test.mjs ← a chip must not wear the lightbox/panel corner. Twelve chip rules used the panel token unnoticed because on a short element the two are INDISTINGUISHABLE — CSS scales radii proportionally, so they diverge only above ~40px. Fixed with zero pixel change. Part of test:hygiene
├── auth-plan-parity.test.mjs ← Track E is described in TWO files on purpose — AUTH_PLAN.md owns DESIGN, SECURITY_RELEASE_PLAN.md owns SEQUENCING — and nothing kept their phase lists in step. Five structural contracts. Part of test:hygiene
├── tips-content.test.mjs ← guards the four pages' CARD_TIPS and paycalc's HELP_CONTENT against the shape their renderers require. Written after a staff-reported production error: a `?` panel threw because one entry had been hand-added in the old flat shape. Four contracts per page. Part of test:hygiene
├── workflow-hygiene.test.mjs ← static guard for the CI workflows. `workflow-lint.yml` cannot guard its OWN toolchain and only runs when workflows change, so the PyYAML pin is asserted here — in the suite that runs on every branch. Also re-checks `timeout-minutes` independently, deliberately duplicating workflow-lint so the two fail separately
├── guide-colour-parity.test.mjs ← guards the guide palettes' contract with the app: guide-shell --navy/--gold must mirror the brand hex (css-tokens.md table), and guide-doc must define the complete --sb-* shift set. Values of --sb-* deliberately diverge (accepted drift); the CONTRACT is mirror-parity + completeness. Part of test:hygiene
├── module-parse.test.mjs   ← verifies every root JS module parses as valid ES module (--experimental-vm-modules) — guards against the settings-app.js incident where a fatal SyntaxError shipped undetected because node --check silently misses ES module errors
├── e2e/                    ← Playwright smoke suite (restored v13.95). `npm run test:e2e`. Real headless Chromium loads every page; Firebase SDK stubbed at the network layer (never touches the gstatic CDN). Catches blank-page breaks (SyntaxError, missing import, broken module graph, auth redirects) that pass all unit tests. NOT part of `npm test`. (CSP header violations need `npm run test:csp` — the local http-server serves no headers.) See ROADMAP_HISTORY.md → "Completed phases and everything shipped since".
│   ├── calendar.spec.js ← calendar render, first-run, stale-member, dropdown, nav drawer, and each guide recording its OWN open id. Runs on Desktop Chrome + Pixel 5
│   ├── auth.spec.js        ← login-overlay render + in-flight/failed states, B1 named-session enforcement (flag-ON: admin/settings re-show login, operations/links clear+in-place, paycalc soft) + happy path, and in-place sign-in (no reload) on every authenticated page
│   ├── paycalc.spec.js ← paycalc in-place login, signed-in period selector, desktop workspace geometry, one-time-notice stacking, and the backup/restore WIRING (the rules are unit-tested; only a browser can prove the paste box reaches the ladder)
│   ├── pages.spec.js       ← settings/operations/links login + signed-in render, operations desktop columns + long-email layout + App-speed card, admin touch-layout blowout guard, FIP jump-link + malformed-hash + the **booking-reach table** (v20.32 — that it answers per country, that the country finder does NOT sweep it in, and that it stacks with labelled cells at 375px, which is a media query over generated content that no static test can see), the Settings **Pay Calculator Data** pointer card (v19.16 — a pointer to the paycalc backup card, deliberately not a second copy of the controls), and the **roster review picker** (v19.35 — a flagged cell resolved from the review table: the picker only appears where the server sent two readings, a pick reaches the actual WRITE and not merely the "Save N changes" counter — those are two separate passes and asserting the counter alone had no teeth — Skip reverts to writing nothing, and Skip never wears the success colour, which the visual baseline provably cannot see)
│   ├── overtime.spec.js ← the Overtime page in a real browser. The unit suites cover the rules; this covers what only a browser answers — that the page BOOTS (a coordinator whose `sessionReady` nothing resolves loads its shell and then waits for ever, with no error and no timeout), that `hidden` actually hides, that a reviewer gets no personal form and no tab offering one, and that the planning horizon lists weeks nobody created. Found four defects on first run
│   ├── responsive.spec.js  ← desktop-geometry checks: calendar/team-view/admin at 1024–1440px + short-height laptop cases (no horizontal overflow)
│   ├── axe.spec.js         ← accessibility gate (axe-core, WCAG A/AA) — scans one rendered state per page. Tagged `@a11y`; GREEN + BLOCKING (part of `npm run test:e2e`) since v17.52; `npm run test:a11y` runs it standalone. One documented exclusion (calendar `.other-month` faint aria-hidden dates). Baseline in A11Y_FINDINGS.md. Imports test/expect from fixtures.js for the hermetic Firebase stub
│   ├── csp.spec.js         ← deployed-CSP proof (v17.62; telemetry allowance v18.89 — `IGNORED_BLOCKS` drops the two beacons Firebase Auth's `apis.google.com` iframe fires (`cleardot.gif`, `gen_204`), because refusing those IS the policy working and counting them as failures made the suite flake intermittently on CI while passing locally; teeth-verified — an injected real violation still fails): runs ONLY via `npm run test:csp` under `playwright.csp.mjs` (serves the app from the Firebase Hosting emulator so the real firebase.json CSP header is applied + enforced by Chromium). Per page: collects every `securitypolicyviolation`, asserts none — the RUNTIME counterpart to the static csp-hygiene.test.mjs. Excluded from the http-server smoke run. Teeth-verified
│   ├── visual.spec.js ← visual-regression baselines — runs ONLY via `npm run test:visual`. Clock-pinned, Firebase-stubbed, fixed-viewport screenshots vs committed PNGs. **Opt-in and deliberately NOT a CI gate** (pixel diffs are environment-sensitive), so a CSS change can still ship un-screenshotted — run it before merging one. Regeneration and the tolerance limits are documented in the spec header
│   ├── offline.spec.js     ← offline-behaviour proof: runs ONLY via `npm run test:offline` under `playwright.offline.mjs`. Verifies the SW/offline-first paths (calendar opens from cache with the network cut). EXCLUDED from the http-server smoke run
│   ├── visual-baselines/   ← committed baseline PNGs for visual.spec.js (18 — 10 page surfaces, 3 OVERLAYS added v19.03, the populated Operations Usage card v19.25, the roster review table v19.34, the Links **Recently deleted** panel v19.43 — added because that panel shipped BROKEN at v19.41 (bare `.lb-content` = a transparent box with no padding) and every behavioural test passed, generated in the dev-container headless Chromium). Regenerate wholesale if the rendering environment (browser/OS/font stack) changes
│   ├── helpers.js          ← shared spec helpers (collectFatalErrors, seedSession/seedMember, pickFirstMemberAndPassword, DESKTOP_WIDTHS, armEnforcementWithFailingSignIn, signInThroughOverlay, openRosterReview + ROSTER_REVIEW_PARSE — the review table only exists after a successful parse, so reaching it means stubbing the Cloud Function and driving the real upload; defined once because the CI wiring test and the opt-in visual baseline both need it) — imported by the smoke specs
│   └── fixtures.js         ← hermetic Firebase: intercepts `gstatic.com/firebasejs/**`, serves local no-op stubs of every symbol firebase-client.js imports. `writeBatch` RECORDS its `set()` payloads to `window.__E2E.batchWrites` (v19.35) so a spec can assert what was actually WRITTEN rather than what a summary line claims — the two are separate passes over the same state. `enforceNamedSession(page)` rewrites roster-data.js to flip `ENFORCE_NAMED_SESSION` on, and `window.__E2E.failSignIn` forces sign-in to fail — for the B1 enforcement tests
├── playwright.config.mjs   ← Playwright config: chromium + mobile-chrome projects, local http-server, SW blocked, CDN-free. Uses pre-installed Chromium in dev (`/opt/pw-browsers`); CI installs its own. `testIgnore: csp.spec.js` (that spec needs the Hosting emulator's headers)
├── playwright.csp.mjs      ← Playwright config for the deployed-CSP proof (e2e/csp.spec.js): baseURL → the Firebase Hosting emulator (127.0.0.1:5000), NO webServer (started by `npm run test:csp` = firebase emulators:exec --only hosting). Same chromium + mobile-chrome projects
├── playwright.visual.mjs   ← Playwright config for the visual-regression baselines (e2e/visual.spec.js, `npm run test:visual`): one desktop project, http-server webServer, tolerant-but-teethed `toHaveScreenshot` defaults (threshold 0.15, maxDiffPixelRatio 0.001), flat baseline dir `e2e/visual-baselines/`. Opt-in (NOT in `npm test`/CI) because pixel diffs are environment-sensitive
├── playwright.offline.mjs  ← Playwright config for the offline-behaviour proof (e2e/offline.spec.js, `npm run test:offline`). Opt-in (NOT in `npm test`/CI)
├── package.json            ← dev dependencies only
├── eslint.config.js        ← flat ESLint config (browser globals); run on staged JS by the pre-commit hook and `npm run check`
├── scripts/
│   ├── bump-version.mjs          ← `npm run bump <version>` — updates APP_VERSION in the 2 runtime locations (roster-data.js + service-worker.js)
│   ├── generate-roster-members.mjs ← `npm run generate:roster-members` — rebuilds functions/roster-members.json
│   └── typecheck.mjs             ← `npm run typecheck` — type-checks every root JS module via tsc --noEmit using jsconfig.json
├── jsconfig.json               ← TypeScript project config for `// @ts-check` coverage; drives `npm run typecheck`
├── firebase.json           ← Firebase Hosting config: CSP headers, cache rules, redirects, emulator ports. **Two-layer CSP:** the `Content-Security-Policy` HTTP header here is primary on Firebase Hosting; a MIRRORED `<meta http-equiv>` CSP in every served HTML page (v17.63) carries the same policy to the GitHub Pages staff mirror (which can not serve headers). Kept in lockstep by csp-meta-parity.test.mjs. **When you change the header CSP, update every page meta to match** (the parity test tells you exactly what).
├── firestore.rules         ← Firestore security rules (deployed via deploy-rules.yml, gated by firestore.rules.test.mjs)
├── storage.rules / firestore.indexes.json ← Firebase Storage rules + Firestore composite indexes
├── generate-sri.mjs        ← dev utility: patches Mammoth CDN SRI hash in huddle.js
└── functions/
    ├── index.js                  ← the COMPOSITION ROOT of the Cloud Functions (domain split, v20.55): defines the shared infrastructure (secrets, `VAPID_PUBLIC_KEY`, `STAFF_SITE_URL`, `ADMIN_FUNCTION_ORIGINS`, `readRawBody`), keeps `parseRosterPDF` (the AI prompt is pinned here by roster-prompt-parity) and `unlockCalendarViewer` (its handler source is pinned here by calendar-viewer-parity), and RE-EXPORTS the other thirteen endpoints from the three domain modules below. **The exports ARE the deploy surface** — a name dropped here is a function deleted in production; `functions-surface.test.mjs` pins all fifteen
    ├── documents.js               ← the DOCUMENT-AND-NOTIFICATION domain: `buildDocumentEndpoints(deps)` → ingestHuddle, the three onDocumentCreated notification triggers, the scheduled pay reminder, plus their private helpers (pruneOldHuddles, the fan-out wrappers, `HUDDLE_PUSH_PAUSED`). A factory taking the shared infra as arguments so index.js stays the one guarded home of the literals — the reasoning is in the module header
    ├── auth-endpoints.js          ← the ACCOUNT-AND-CREDENTIAL domain: `buildAuthEndpoints(deps)` → setupRosterAuth, resetMemberPassword, requestPasswordReset, getSignInStats. The pure DECISIONS these orchestrate (claimsForTier, resolveRosterAuthConfig, the throttles, summariseSignIns) already live unit-tested in roster-parse-helpers.js. unlockCalendarViewer deliberately stays in index.js — see the module header
    ├── push.js                    ← the web-push TRANSPORT (v20.52, extracted from index.js): lazy `web-push` require, one-per-instance VAPID setup, `fanOutPush` (everyone) and `sendTargetedPush` (named uids, **fails closed at every step, no fall-back-to-everyone branch**). Owns how a payload reaches a phone; never what it says or when. First cut of the index.js domain split
    ├── roster-parse-helpers.js   ← pure helpers: normaliseShift, buildWeekDates, extractAIJson, etc.
    ├── overtime.js                ← the OVERTIME domain: four endpoints and the Firestore orchestration behind them — `buildOvertimeEndpoints(deps)` → createOvertimeWindow (with `dryRun`, so preview and commit are ONE code path and cannot drift), getOvertimeManagerOverview (the six-week planning horizon — the only thing that shows a week nobody created), getMyOvertimeState (the member's sole read path, and where `serverNow` comes from) and submitOvertimeAvailability. Identity is always `decoded.name`, never the body; retention is filtered HERE rather than in the rules
    ├── overtime-core.js           ← every RULE Overtime Availability has, and no I/O at all: the London deadline clock, the frozen milestone timetable, the three phases, participant selection, the availability schema, and the concurrency decision. **The clock is the highest-risk function in the feature** — one hour out either refuses somebody in time or accepts somebody late, and this repo has no date library. Requires nothing, so it is tested in `test:hygiene` (every branch) rather than only in the Functions workflow. Design: OVERTIME_AVAILABILITY.md
    ├── calendar-viewer-auth.js    ← the PURE server-side staff-PIN rules: PIN shape, timing-safe compare, the privacy-conscious source key, and the throttle decision — per-source AND the v20.35 all-sources ceiling (`GLOBAL_SOURCE_KEY`/`GLOBAL_THROTTLE`), which holds even when request attribution is wrong. It never learns, stores, logs or returns a PIN. **The throttle numbers are sized against a station behind ONE corporate NAT address** — the reasoning is in the module header, and both directions matter
    ├── roster-members.json       ← generated from roster-data.js — do NOT hand-edit; run `npm run generate:roster-members`. Holds the AI-parsing name lists (cea/ces/dispatcher) AND the B4 server-owned auth lists (`activeMembers` + `roles.admin`/`manager`/`designer`) that setupRosterAuth trusts instead of the client payload. CI-locked by sw-asset-check.test.mjs
    └── package.json
```

**Run all tests:**
```
npm test              # test:hygiene + test:parse + test:unit (every root test file; the tree below lists them)
npm run check         # lint + typecheck + npm test (full pre-push gate)
npm run lint          # ESLint on all JS files
npm run typecheck     # tsc --noEmit on all root JS modules

# By test runner (same as npm test, useful for --watch or targeting specific files):
npm run test:hygiene  # sw-asset-check, doc-parity, app-name-parity, calendar-access-core, calendar-viewer-auth, calendar-viewer-parity, import-graph, links-design, links-seed, links-design-doc, links-demand, links-rotation-parity, admin-rangepicker, client-errors, claim-retry, overlay(+history), usage-stats, perf-stats, surname-parity, payday-cutoff-parity, storage-rules-static, storage-utils, auth-identity, auth-state-core, auth-state, auth-policy, sw-register, sw-internals, csp-hygiene, csp-meta-parity, date-picker, guide-sources, guide-colour-parity, links-analysis, links-compare, paycalc-format, paycalc-breakdown, paycalc-inputs, paycalc-hpp-schedule, paycalc-transfer, paycalc-backpay-state, paycalc-key-parity, card-header-parity, page-css-parity, firestore-contract-parity, focus-ring-parity, type-scale-parity, chip-radius-parity, auth-plan-parity, workflow-hygiene, tips-content, password-force, error-reporter, roster-prompt-parity (authoritative list: package.json `test:hygiene`)
npm run test:parse    # module-parse (--experimental-vm-modules)
npm run test:unit     # all --experimental-test-module-mocks tests
npm run test:functions # Cloud Functions tests (roster-parse-helpers.test.mjs + functions-surface.test.mjs, which requires functions/index.js and pins the fifteen-function deploy surface, + overtime-endpoints.test.mjs) — not part of npm test (needs functions/node_modules)

# Firestore + Storage security rules tests (requires Firebase emulator binary — starts automatically):
npm run test:rules

# E2E smoke tests (real headless Chromium; uses pre-installed browser in the dev env):
npm run test:e2e

# Accessibility gate (axe-core, WCAG A/AA; one rendered state per page). Opt-in — see A11Y_FINDINGS.md:
npm run test:a11y

# Deployed-CSP proof — serves the app via the Firebase Hosting emulator (real firebase.json CSP
# header applied) and asserts real Chromium refuses nothing the app loads. Runtime counterpart to
# the static csp-hygiene.test.mjs; not part of npm test. Gated in CI (e2e.yml `csp` job):
npm run test:csp

# Visual-regression baselines (Section B / F-VIS) — clock-pinned, Firebase-stubbed, fixed-member
# screenshots of every key surface compared against committed PNGs in e2e/visual-baselines/.
# Locks page composition (incl. the accepted desktop voids) against silent CSS/layout drift.
# Opt-in, env-sensitive, NOT in npm test/CI. Regenerate: `npm run test:visual -- --update-snapshots=all` (`=all` is load-bearing — a bare `--update-snapshots` only rewrites baselines whose comparison FAILED, so a baseline that drifted inside the tolerance could never be refreshed). **Then `git status e2e/visual-baselines/` and revert anything you cannot explain** (v19.62): `=all` rewrites every baseline including the ones that PASSED, so a run intended to capture ONE change came back with FIVE modified — four of them sub-tolerance rendering noise that would have been committed as though reviewed. Reverting a file and re-running is the check: still passes ⇒ it was noise and does not belong in the diff:
npm run test:visual

# Offline-behaviour proof (e2e/offline.spec.js under playwright.offline.mjs) — SW/offline-first paths
# with the network cut. Opt-in, NOT in npm test/CI:
npm run test:offline
```

**Service worker caching:**
- **Update lifecycle (v15.41; hardened v15.46):** install does ONLY `skipWaiting()`; activate does ONLY `clients.claim()`; the ~110-file precache runs as a DETACHED post-activation warm-up. Never move the precache back into install's or activate's `waitUntil` — install's held every update behind ~110 no-cache fetches (the "app updates with a lot of lag" complaint), and activate's would queue every fetch of the freshly-reloaded page behind the warm-up. **Warm-up resilience (v15.46):** a `__precache-complete` marker is written only when EVERY asset cached; the SW's top-level startup check re-runs an incomplete warm-up on every wake (covers a killed mid-run warm-up AND first installs — offline-first coverage converges instead of silently staying partial); the fetch handler piggybacks the in-flight warm-up onto `event.waitUntil` so page traffic keeps the SW alive through it; **old-version caches are deleted only after a FULLY-successful warm-up** (they are the transition fallback — a partial warm-up keeps them and retries). The doc/navigation fallback checks the CURRENT-version cache before the global any-cache lookup (the global `caches.match` prefers the OLDEST cache, which served previous-version HTML to a fresh-JS page — a mixed-version hazard); the JS/CSS SWR path keeps its any-cache LAST resort for pure-offline mid-transition. **v16.09 latency pass:** Navigation Preload is enabled on activate (the browser starts the network-first HTML fetch in parallel with SW boot; the doc branch consumes `event.preloadResponse`); the warm-up runs in batches of 8 (not ~100 parallel) and skips assets the reloading page already cached; fonts/icons warm without `cache:'no-cache'` (immutable, served from HTTP cache); navigations are cached under the bare path (query stripped — `ignoreSearch` on fallback match) and redirected responses are re-wrapped before caching/serving (`unredirect` — Firebase 301s `/index.html`→`/`; in-app links now navigate to `./`); the 2s abort is guarded so it can never kill a response that already resolved. An `opaqueredirect` (status 0 — a redirect under the navigation's 'manual' redirect mode, which is how navigation preload surfaces the start_url `./index.html` → `/` 301) is passed straight through so the browser follows it — treating it as a broken-site response would send every installed-PWA launch down the cache fallback. `manifest.json` `start_url` and the Calendar shortcut now point at `./` (takes effect on reinstall; the pass-through covers existing installs).
- Stale-while-revalidate: HTML documents too (v16.10) — instant from cache; the navigation-preload response doubles as the background refresh. Cache miss → network-first with the 2s cache-fallback race (the pre-v16.10 behaviour)
- Stale-while-revalidate: all JS + CSS (v14.18) — served instantly from cache, refreshed in the background **at most once per SW process lifetime** (v16.09: the cache is version-pinned and content never changes within a version, so per-request refreshes were ~35 guaranteed no-op 304s per page open competing with Firestore; one check per SW start keeps the un-bumped-deploy self-heal). Code freshness is preserved by the version-bump → new SW → new cache lifecycle (each deploy precaches fresh assets and the new SW claims immediately); roster DATA is always live from Firestore regardless of cached JS version
- Cache-first: icons, fonts, `manifest.json` — stable assets; and the gstatic Firebase SDK in its own `myb-roster-sdk-v{ver}` cache (v16.10 — warmed with the app, swept on SDK bump only)
- Cache name: `myb-roster-v{APP_VERSION}` — version bump auto-invalidates

---

## Brand colours — Chiltern Railways

Full hex table and "never hardcode" rule: see `.claude/rules/css-tokens.md` → Brand colours.

---

## Architecture decisions — never change without discussion

| Decision | Rule |
|----------|------|
| No framework (vanilla JS) | No build step. Do not introduce React, Vue, or any UI framework. A **few** vetted, self-contained libraries are allowed where they earn their place — currently Firebase (auth/Firestore/Storage), Mammoth (DOCX→HTML for the Huddle), and DOMPurify (sanitising that HTML). Adding another runtime library is a discuss-first decision, not a default. |
| No bundler | External dependencies load without a build step: **vendored** (served from origin) where offline-first or CSP demands it — DOMPurify (`purify.es.mjs`) and the Inter font are vendored — otherwise **from a pinned CDN** with SRI where practical (Firebase from gstatic, Mammoth from jsdelivr). Prefer vendoring for anything the app must work offline without. |
| **When a build step earns its keep (threshold, not yet crossed)** | The no-build rule is a deliberate trade (zero toolchain, direct debuggability, no build-supply-chain) paid for by hand-maintained work a bundler does for free: the ~35-entry `modulepreload` lists on the **two** heaviest pages only (index.html + paycalc.html — the deepest module graphs; admin/operations/settings/links deliberately have none, their graphs being shallower and their loads less latency-critical, all CI-locked by sw-asset-check.test.mjs), the ~110-entry SW precache, the 2-location version bump, `generate-*` codegen, the 5 CSP `*-boot.js` shims, the `firebase-client.js`-untestable-in-Node pure-helper splits, and the `normaliseSurname` browser/functions duplication. This cost rises with module count (~70 and growing). **Revisit the trade — do not auto-adopt — when either: (a) you want real TypeScript types** (you already run `tsc --noEmit` over ~70 `// @ts-check` files — the checker without the emit), **or (b) a bug is traced to drift in a hand-maintained preload/precache/duplication list.** Until one of those, the trade still favours no build. |
| **Self-hosted Inter typeface (v11.53)** | `fonts/inter-latin.woff2` is served from origin, NOT Google Fonts CDN. CSP is `font-src 'self'` — a CDN would mean loosening it, and self-hosting keeps the app offline-first (SW precaches the file) with no third-party request. One variable woff2 (latin, wght 100–900) covers every weight. `@font-face` lives in `shared.css`; `--font-sans` token in `:root` is the single place the stack is defined; every page's `body` uses `var(--font-sans)`. Do not re-add a Google Fonts `<link>`. **Inter is the app's ONLY typeface** — a Barlow Semi Condensed display face for the hero £/month heading was tried at v16.73 and reverted at v16.74 (owner decision: the gain was modest, and Inter — a neo-grotesque like the real Rail Alphabet — already fits the brand). Don't re-add a display face without a fresh discussion. |
| Pointer Events API for swipe | Handles touch, mouse, and trackpad in one handler. Do not revert to Touch Events. |
| `aria-live` for month announcements | Programmatic `.focus()` on the month heading caused mobile layout reflow. Do not switch. |
| `Math.ceil()` on carousel panel width | Eliminates sub-pixel seam on high-DPI screens. Do not remove. |
| CSS variables for all colours | Defined in `:root`. Never hardcode hex anywhere in CSS or JS. |
| Three-surface model (v11.55) | canvas (navy) → card → sunken; fields use `--field-bg`, brighten to `white` on focus. Full surface rules (incl. the `background-color`-longhand-on-fields rule): `.claude/rules/css-tokens.md`. |
| Motion vocabulary (v11.56) | Shared easing/duration tokens + `--press-scale` press feedback on primary buttons. Full rules: `.claude/rules/css-tokens.md`. |
| Typography scale (v11.77) | `--type-micro`…`--type-large` tokens; never below 16px on focusable fields (iOS focus-zoom). Full scale: `.claude/rules/css-tokens.md`. |
| Semantic elements (`<nav>`, `<header>`, `<main>`) | Screen readers depend on these landmarks. Do not revert to `<div>`. |
| SW caching: stale-while-revalidate for HTML + JS/CSS (v16.10; HTML was network-first v14.18–v16.09, changed with owner approval Jul 2026) | HTML, JS, and CSS are all served instantly from the version-pinned cache and refreshed in the background — no blocking network wait on any page open (network-first HTML cost 100–500ms per open, or the full 2s timeout on poor signal). An HTML cache MISS (first visit/evicted storage) falls back to the old network-first 2s race. Freshness propagates via the version-bump → new SW → new cache → warm-up → controllerchange-reload lifecycle for ALL code; roster DATA is live from Firestore, never from cached JS. Serving HTML and JS from the same version cache also shrinks the mixed-version deploy window network-first had. Do not revert without discussion. |
| Firebase SDK cache-first from an SDK-versioned cache (v16.10) | The gstatic SDK modules (version-pinned, immutable) are served cache-first from `myb-roster-sdk-v{FIREBASE_SDK_VERSION}` and warmed with the app — offline launch no longer depends on the browser HTTP cache keeping ~400 KB of CDN files (evictable under storage pressure on budget Androids). The SDK cache survives app version bumps and is swept only when the SDK version changes. **Bumping the SDK in `firebase-client.js` requires bumping `FIREBASE_SDK_VERSION` in `service-worker.js` in the same commit** — enforced by `sw-asset-check.test.mjs`. |
| `isChristmasRD()` applied before Firestore overrides | Forces Dec 25 and Dec 26 to RD first; Firestore can then override Dec 26 to RDW for overtime. Never reorder this. |
| `getBaseShift(member, date)` for all base shift lookups | Direct access to `roster.data[week][day]` bypasses `startDate` suppression, Christmas rules, and future base-shift logic. Always call `getBaseShift()`, never read `roster.data` directly. |
| Type pills in admin — single source of truth (v13.48) | `PILL_TYPES` in `admin-overrides.js` is the one authoritative list. `renderWeekGrid()` generates per-row pills from it; `admin-app.js` generates the bulk-bar pills from it at init (the `#bulkTypePills` div in `admin.html` is empty — populated at runtime). Order: AL · Shift · RDW · Absent · Rest Day · Other (v15.37; renamed from Training v15.40; **Spare moved OUT of the top row into the Other submenu v15.57** — a rarely-used placeholder, so 6 top pills now). Never hardcode either list. Other reveals per-row sub-controls (full-word flavour chips Training/Induction/Assessment/Team Day/Union/Meeting + **Spare** — + a pre-ticked-on-rest-day RDW tick + OPTIONAL times — `timesOptional: true`); the save collector composes the grammar `FLAVOUR[" RDW"][" HH:MM-HH:MM"]`. **Spare is special-cased:** it stays its own `spare_shift`/'SPARE' override type (📋 purple badge, not worked), so picking Spare in the submenu writes a `spare_shift` (not an 'other' day) and hides the RDW tick + times. |
| **`AL` pill label must stay as `AL`** | Compact mobile layout requires short labels. `AL` is the standard Chiltern abbreviation. Do not expand without discussing layout impact. |
| **`🪑` is the absence emoji — do not change** | Absence covers sickness, childcare, bereavement, and other reasons. Using 🤒 implies illness — GDPR concern. The reason for absence is never stored. **Always ask Gareth before changing the absence icon.** |
| `_staleMemberName` flag in `calendar-app.js` | When `getSelectedMemberIndex()` can't find a saved name, sets flag, falls back to default member. On the next page open the banner fires via `_showStaleMemberBanner()` — called from the pre-branch init block for team-view users (v14.08), or from inside `renderCalendar()` for calendar-view users. `takeStaleMemberName()` is one-shot so only one path fires. |
| Sync chip state machine in `calendar-app.js` | hidden → (800ms) → "↻ Updating…" → silent remove on success, or "⚠ Couldn't update" (stays, 10s timeout). "✓ Up to date" removed (v10.19) — noise. Never show raw errors to staff. |
| App Notices system (v13.36) | `nav-panel.js` owns the archive: `archiveNotice({ id, title, section, date, body })` writes to localStorage `myb_app_notices` (capped at 50 entries, deduped by `id`). "📣 App Notices" in `NAV_INFORMATION` opens the archive panel. Notice lightboxes live on individual pages; see **"One-time notice pattern"** section below for the full creation guide. Current notices are tracked in that section's table — do not duplicate the list here. |
| `_clearState` / `CONDITIONAL_ROWS` in `paycalc-app.js` | `_clearState` groups destructive-clear state atomically (includes `countdownTimer`). `CONDITIONAL_ROWS` is data-driven: condition → row/field IDs — add a new conditional row by adding one array entry. See `.claude/rules/paycalc.md`. |
| `touch-only` CSS class in `shared.css` | `display:none` by default; revealed via `@media (pointer: coarse)`. Use for touch-only UI. Do not use inline `display:none`. `(hover: hover)` inverse was dropped (v10.15) — some Android devices misreport it. |
| `window.matchMedia('(pointer: coarse)')` in `initSwipeHint()` | Gesture-tutorial UI must only show on touch devices. Always add this guard. |
| **Do not gate layout on `(hover: hover) and (pointer: fine)` alone** | Some Android devices misreport `hover: hover`. For layout breakpoints, always use `min-width`. Hover/pointer queries are only safe for cosmetic `:hover` transitions. |
| `paycalc.html` desktop grid on `<main>` | CSS grid applies to direct children only — declare on `main { display: grid }`. `.app` only holds max-width. |
| `lsGet` / `lsSet` / `lsDel` / `lsKeys` from `ls.js` | iOS Safari private mode throws `SecurityError` on any `localStorage` access. **Never call `localStorage` directly** in `calendar-app.js`, `admin-app.js`, or `paycalc-app.js` — always use these wrappers. `lsKeys()` (v14.11) returns a safe snapshot of all key names for code that must enumerate storage (e.g. the paycalc namespace migration). |
| Per-member paycalc localStorage namespacing (v14.11) | On a shared device two staff must not read each other's pay data — every per-member key carries a `myb_pc_<slug>_…` member segment (`pcPrefix()` in `paycalc-migrations.js` is the single source). **Never read/write a paycalc key without `pcPrefix()`/`SK`, and never namespace device-level flags** (`DEVICE_KEYS`). Legacy unnamespaced data is claimed via a one-time ownership prompt, never silently. Full detail: `.claude/rules/paycalc.md`. | **A retired device flag stays declared (v19.37):** `RETIRED_DEVICE_KEYS` in `paycalc-migrations.js` holds keys nothing writes any more but which still exist on devices — deleting one reclassifies it as member data and fires the ownership prompt at people with none (the v19.36 bug).
| VAPID fingerprint migration | Both pages store first 12 chars of VAPID key in `localStorage('myb_vapid_ver')`. On mismatch, silently unsubscribes → re-subscribes. Cloud Function `fanOutPush` deletes a subscription ONLY on 410/404 (genuinely dead); a 401 is a VAPID-auth failure (server misconfig, not a dead endpoint) and is logged, NOT deleted — deleting on 401 would wipe the whole collection on any VAPID key error (v16.15). |
| One-off notification prompt (`#notifPrompt`) | Appears once per device between `</nav>` and pay-period strip. Both Enable and × set `myb_notif_prompt_done`. Do not move below the calendar. |
| PWA shortcuts in `manifest.json` | Three long-press shortcuts. Changes require reinstall to take effect on existing installs. |
| Paycalc desktop workspace + sticky bar (`#stickyTotal`) | ≥1024px: three-column grid whose workspace is ONE shared row (v18.47) — `.pc-work` (period band + Hours + Settings) spans the two work columns beside the col-3 sidebar `.pc-side` (result + the four occasional cards, v16.67, owner-approved). One row means neither column's height can inflate the other's spacing (the old row-span model let an all-expanded sidebar open a mid-page navy void). The result is **not sticky**; the `#stickyTotal` fixed bottom bar keeps the take-home £ visible on all widths. Full layout rules (mobile `display:contents`, margin-reset specificity note): `.claude/rules/paycalc.md`. |
| 3-digit time input auto-correction in `admin-overrides.js` | On blur, if length is 3 and `parseInt(raw.slice(0,2)) > 23`, prepend `'0'`. Without this, `"630"` produced `"63:0"`. |
| Range picker clear button (`.rp-clear`) | Resets both `from` and `to` dates. Built into `buildRangePicker()` in `admin-rangepicker.js`. |
| **Sundays are non-contracted — AL and Absent cannot be recorded on Sundays** | Sundays are uncontracted for all grades (CEA, CES, Dispatcher). Neither `annual_leave` nor `sick` overrides may be written for a Sunday. Enforcement (do not remove any layer — they work together): (1) `admin-overrides.js` week grid disables both the AL and Absent pills on Sunday rows; (2) the bulk-apply bar silently skips Sunday rows when AL or Absent is the active type; (3) `recordRangeOverrides()` filters Sundays out of `workingDates` before writing overrides; (4) roster upload — `computeCellStates()` in `admin-roster-upload.js` normalises a Sunday PDF `AL`/`SICK` to `RD` (so it classifies as MATCH and is never written), with `shiftValueToOverrideType()` → `correction` plus a `value:'RD'` write-path backstop for the edited-cell path; (5) **display** — `calendar-app.js` calendar render and month-legend both suppress a `sick` override when `isSunday(dateStr)` (in addition to base `RD`/`OFF`), so absence never renders on a Sunday even from legacy data when the rotating roster brings a worked Sunday into the range (v12.61). A worked Sunday time is always RDW, never AL/Absent. |
| Sunday RD corrections on absence/AL save | Every Sunday in the range is checked; if `getBaseShift` returns a non-RD shift, an explicit `correction/RD` override is written alongside the AL/sick overrides. Used in both save handlers. |
| Range picker swipe — pointer capture on `grid` not `clip` | Events dispatched to a capture target do not bubble down to children — captures on `clip` breaks the drag animation. |
| Team Week View | Available to all logged-in staff. Grade state (`currentTeamGrade`) persists across re-renders. Week navigation clamped to `CONFIG.MIN_YEAR`/`MAX_YEAR`. **Overrides load via the SHARED month-fetch machinery** (`ensureOverridesCached`, injected — v18.76): the Team view no longer runs its own per-week Firestore query. The old independent per-week fetch called `reconcileRangeIntoCache` directly, which is AUTHORITATIVE for its range (it evicts in-range cache keys its snapshot omits) — so it was a SECOND authoritative reconciler racing the initial 3-month fetch on the same dates: a team-week fetch resolving LATER with a staler snapshot (served from Firestore's not-yet-synced local cache) evicted overrides the 3-month fetch had just loaded, wiping the grid back to the base roster on click-through-before-load. `ensureOverridesCached` is deduped by `fetchedMonths`, so a month the calendar already owns is a no-op here (cache already holds it — no re-query, no eviction) and only a genuinely un-fetched month (a week navigated outside the 3-month window) triggers ONE authoritative fetch; its `refreshFromCache` callback repaints the current week (focus-preserving; a no-op after exit), subsuming the old fetch-token guard. **No override-load status indicator** — deliberately not added (minimal-noise app). A review (Finding #5, Team View half) proposed a "freshness warning" when a Team View fetch fails; **accepted as won't-do** — it IS an override-load status indicator. The failure path is safe without one: `ensureOverridesCached` releases the month from `fetchedMonths` on failure (retryable) and leaves the last-good cache untouched, so a failed refresh keeps the last-good grid silently. |
| **Calendar access: a named session OR the staff PIN (v20.12)** | `overrides` reads used to be `allow read;` — no auth at all. They now require a member `name` claim or the shared `calendarViewer` capability. **Anonymous grants nothing**, which is the substance of the change: the Calendar used to sign every visitor in anonymously, so a rule written `request.auth != null` would have re-admitted exactly the people it closes out. The PIN is a low-friction STAFF BARRIER, not individual authentication — one code for the whole station, unattributable, unrevocable per person — and no surface may describe it as more. Three rules that are easy to undo: **the Calendar is not INITIALISED while locked** (absent, not hidden — see `calendar-access.js`); **`calendar-overrides.js` refuses the local-cache read independently**, because Firestore rules are server-side and a `getDocsFromCache` hit never reaches one; and **the viewer's persistence is session-only**, so signing it out must happen BEFORE restoring the member chain, never after. A fourth, added v20.41: **a grant is not always the FIRST grant.** `initCalendarAccess` takes two hooks — `onGranted` (once: build the workspace) and `onEveryGrant` (every time: reopen the override gate) — and `setOverrideAccess(true)` clears the fetched-month claims, because a re-grant follows a re-lock and months claimed under the old session would otherwise block every read under the new one. Anything the access-lost path turns OFF belongs in `onEveryGrant`. **OFF AGAIN (v20.50):** `CONFIG.CALENDAR_PIN_ACCESS` went `true` at v20.46 and back to `false` two hours later, because **a correct PIN could not unlock the Calendar** — `unlockCalendarViewer` returned 500 from its token-mint block and staff saw "Calendar couldn't be unlocked" with no roster. The lesson is about VERIFICATION, not the feature: the dark deploy was signed off on `GET`→405 and a WRONG PIN→401, and neither touches `createCustomToken`, which only a CORRECT PIN reaches — so the minting path had never run in production, and the e2e suite stubs the exchange (rightly) so CI never covers it either. **ON since v20.51, and step 2b PASSED** — a human holding the PIN unlocked the live Calendar. The v20.50 cause is now CONFIRMED as an IAM gap, not app code: under ADC `createCustomToken` signs through the IAM Credentials API, which needs the Cloud Run runtime SA to hold `iam.serviceAccountTokenCreator` on ITSELF, and gen-2 does not grant it. **That grant is a standing PREREQUISITE living in GCP IAM, not in this repo** — no test can see it, no deploy re-applies it, and it must be re-applied if the runtime service account changes or the project is rebuilt (RECOVERY_RUNBOOK → project facts). If an unlock ever fails again, retrieve `[unlockCalendarViewer] token mint failed <code> <message>` before changing anything. The `overrides` read rule still carries its `allow read;` hold line, so the PIN remains friction without protection until the rules tighten (runbook step 4, its own push, after a real soak). The three deploy workflows fire in PARALLEL from one push, so the client-then-rules ordering the rollout depends on has to be made by hand — release the two brakes in separate pushes, client first; while the hold line stands, rolling back is the one client line. Full design: AI_MAP → `calendar-access.js`; rollout + rollback: RECOVERY_RUNBOOK.md → "The Calendar PIN"; operations: OPERATIONS_REFERENCE.md. |
| `persistentLocalCache()` in `firebase-client.js` | Firestore stores queries in IndexedDB. Do not revert to `getFirestore()` — Huddle viewer and override cache depend on instant load. |
| `subscribeToLatestHuddle` in `firebase-client.js` | Persistent `onSnapshot` — Huddle viewer updates automatically when a new Huddle arrives. Do not replace with one-time fetch. |
| `normaliseSurname()` in `auth-identity.js` (v12.04; moved out of `firebase-client.js` v16.50) | Shared surname derivation for Firebase Auth: lowercases and strips non-alpha (the ≥6-char padding for the Firebase *password* is applied separately by the password builders in `session.js` / `functions`, **not** inside `normaliseSurname`). Lives in the pure `auth-identity.js` (so it's unit-testable) and is **re-exported by `firebase-client.js`**; `getSurname()` in `session.js` delegates to it. A deliberate duplicate also exists in `functions/roster-parse-helpers.js` — Cloud Functions are CommonJS and cannot import browser ES modules, so unification requires a build step. If the rule ever changes, update both locations (surname-parity.test.mjs enforces it). |
| `cors: ADMIN_FUNCTION_ORIGINS` on `parseRosterPDF`, `setupRosterAuth`, and `resetMemberPassword` | All three functions restrict CORS to an explicit origin allowlist (`ADMIN_FUNCTION_ORIGINS` in `functions/index.js`: `garethdavidmiller.github.io`, `myb-roster.web.app`, `myb-roster.firebaseapp.com`) — defence-in-depth on top of the real control, which is Firebase ID token + admin claim. Add any new hosting domain to that array. `ingestHuddle` keeps `cors: false` (server-to-server). |
| Only the TOPMOST overlay reacts to the keyboard (v19.53) | Every open overlay attaches its own `document` keydown listener, so ONE Escape used to close them ALL — and `trapFocus` on a buried overlay pulled Tab into a dialog the user couldn't see. `createLightbox`'s `onKey` now returns unless `_isTopOverlay(close)` (reads the existing `_backHandlers` stack; **fails open**, because a suppressed Escape traps the user). Back and ✕ were always correct. **A one-time notice must open via `openNoticeIfClear(lightbox)`, never `lightbox.open()`** — with two notices up, one Escape ran both `onClose` callbacks, so the buried one was archived and flagged permanently seen by someone who never saw it. Not opening leaves it unflagged, so it returns next load. The rule is unit-tested; the WIRING needs the e2e (deleting the `onKey` guard leaves every unit test green). |
| Android Back button overlay pattern | Overlays push `history.pushState({ mybOverlay: true })` when opening, close on `popstate`. `_pushOverlayState(handler)` / `_clearOverlayHistory()` helpers in all six app pages. |
| Canonical lightbox lifecycle (standardised v11.50, factored into `createLightbox` v12.50) | Every `.lb-overlay` lightbox (About, AL, Team info, Month jump, per-card Tips, paycalc Help/Welcome, links Beta) is built with **`createLightbox({ overlay, content, closeBtn, initialFocus, onOpen, onClose })` in `overlay.js`** — do NOT hand-write the lifecycle in a page module. It implements focus save/restore, `.visible`→`.open`, `lockBodyScroll`, Android Back (`_pushOverlayState`), Escape, the `trapFocus` Tab trap, and backdrop/closeBtn close — including a **mandatory 500ms `transitionend` fallback** (iOS suppresses `transitionend` on a backgrounded tab; reduced-motion finishes synchronously). Close controls are `<button class="lb-close">` (never `<span>` — not keyboard-focusable). The shared About/Tips panels are `about-lightbox.js` / `tips-lightbox.js`. **Exceptions:** the coming-soon lightbox is owned **only** by `nav-panel.js` (shares the drawer's history entry — never re-wire `#navComingSoonLightbox` or migrate it to `createLightbox`); the huddle viewer (`#huddleViewer`) is a full-bleed panel, so it has no overlay-click-to-close (intentional). Full lifecycle detail: AI_MAP → `overlay.js`. |
| Nav panel on all 6 pages (v10.57, extended v10.99 + v11.06 + v12.07; **restructured v20.06**, Reference reopened v20.09) | `nav-panel.js` injects overlay + drawer. Burger button `#navMenuBtn` in each page header. **THREE ZONES, ONE IDIOM EACH** (v20.06 — it had grown five competing treatments for one list of destinations, which is what "cluttered" turned out to mean; measured, it was not dense, there was ~130px of dead space): **pills** = go to a page · **Today** = the documents you open on a shift · **Reference** = look something up. `NAV_PAGES` drives the pill row; the current page is **rendered as an inert `aria-current` pill, NOT omitted** — the doc said "omitted" from v10.57 to v20.06 and the code never did that, which mattered because being shown is what keeps the row the same shape on every page so muscle memory works. **Settings is a pill**, not a pinned link — it is a page, and rendering it as an Information-style row was what forced the drawer's fourth zone. **Pills are one per row, full width**, and that is arithmetic not taste: the drawer is 260px, so a 2-col grid gives 110px while Calendar needs 135 and Settings 118 — and content-width flex cannot pair Calendar with anything (135 + the smallest, 86, blows the 220px budget), which is what left orphan rows at every permission count. **Reference (5 guides + App Notices) is EXPANDED by default** — collapsed at v20.06, reopened at **v20.09** (owner). The v20.06 fold measurement was real and was not the whole question: a collapsed section is one you have to know is there, and the guides are exactly what a reader does not know to look for. Re-measured signed-in at 360×640, expanded costs **194px of drawer scroll** (two of the five guides below the pinned footer) and at 390×844 costs **nothing** — the drawer fits whole. The toggle still works, so the short drawer is one tap away; it is just not the default. The derived count chip is the COLLAPSED-state affordance and is hidden by CSS while expanded, where the rows are the count. App Notices moved out of Workplace — it is a changelog, not a workplace document. `NAV_INFORMATION` drives the flat always-open section (Workplace: Daily Huddle, Weekly Retail Circular, Marylebone Newsletter, App Notices). `NAV_GUIDES` (v11.21) drives the Reference submenu (heading restyled v18.18 to the same caps-eyebrow rank as INFORMATION — no emoji; the gold chevron marks it collapsible): Staff & Admin Guide, Pay Calculator Guide, Railcard Guide, **Rangers & Rovers**, FIP Travel Guide — toggled by `#navGuidesToggle`, list is `#navGuidesList`. **`aria-expanded` is the ONLY state** (v20.09): the arrow's rotation and the count's visibility are both CSS-keyed to it. There used to be an `.open` class as well, and expanding by default is what exposed the drift — the initial markup carried `aria-expanded="true"` with no `.open`, so the arrow pointed down over an open section and stayed inverted for good, because the handler only ever toggles from wherever it started. To collapse it again, flip `aria-expanded` and re-add `hidden` on the list; change nothing else. Adding a guide = one entry in `NAV_GUIDES`; adding a live doc = one `links` entry in `NAV_INFORMATION`. A `NAV_INFORMATION` entry with `comingSoon: true` (instead of `url`) renders as a `<button>` that opens the injected `#navComingSoonLightbox` placeholder instead of navigating. |
| Dark (navy) drawer + scoped tokens (v11.54) | Continuous navy surface. Scoped tokens: `--nav-raised/strong`, `--nav-text/muted/faint`, `--nav-border`. Admin pill = `--nav-raised` + gold text (not navy-fill). Do not revert to white drawer. See `.claude/rules/css-tokens.md`. |
| Nav-panel logo = About; drawer head shows version (v11.21) | The drawer head is a `#navPanelBrand` button (logo + title + `Version {APP_VERSION}` muted text). Tapping it closes the panel (via `closePanelForNavigation`) then calls `onLogoClick`, which each page passes as `() => openAboutLightbox?.()` — opening that page's existing `#iconLightbox` (version, update status, bug report, and page-specific print/guide links). Each page exposes its scoped open fn through a module-level `let openAboutLightbox` assigned inside its About-lightbox IIFE. This replaces the header logo's old role (see header-logo back button entry). |
| Settings page — shared session, flat nav link (v11.06) | `settings.html` uses the same `AUTH_KEY` as `admin-app.js` — a user already signed in on any page arrives without seeing the login overlay. `initNavPanel` is called at module scope in `settings-app.js` regardless of sign-in state so unsigned users can navigate away via the Calendar/Admin pills. Settings link renders outside the scrollable `nav-panel-body` (pinned above footer) so it is always visible without scrolling. Hidden only on the settings page itself. Styled as a flat link (not a pill). `--indigo` badge colour. |
| Nav-panel footer initials badge (v12.22) | The footer shows a 26px circular badge (`#navPanelAvatar`) before the member name — previously showed a profile photo, now always shows initials on a stable per-name colour. `avatarInitials(name)` and `avatarHue(name)` from `roster-data.js` are called directly in `nav-panel.js` — no fetch, no localStorage, no event listeners. Profile photo feature removed at v12.22; full spec and revert checklist in ROADMAP_HISTORY.md → "Removed features — full restoration specs". |
| Operations page — admin-only pill (v10.99) | `NAV_PAGES` entry for Operations has `adminOnly: true`. `initNavPanel({ isAdmin })` filters it out for non-admins. `calendar-app.js`, `admin-app.js`, and `paycalc-app.js` pass `isAdmin: CONFIG.ADMIN_NAMES.includes(member)`. `operations-app.js` passes `isAdmin: true` (page already guards against non-admins). When NOT signed in, Operations shows the **shared in-place login** (`login-overlay.js`, v14.45+) — it no longer redirects to `admin.html` to authenticate. A signed-in **non-admin** is still redirected to `admin.html` (that is access control, not a login divert). |
| Links page — access control (v12.06) | `linksDesignerOnly: true` in `NAV_PAGES`. Add name to `CONFIG.LINKS_DESIGNERS` in `roster-data.js` to grant access — **and run `npm run generate:roster-members` in the same commit**, because the `linksDesigner` claim is set by `setupRosterAuth` from the server-owned `functions/roster-members.json`, not from the client list. Then run Operations → Set up accounts, or the new designer holds no claim and every save permission-denies. Current designers: `’G. Miller’`, `’S. Silva’`, `’M. Robson’`. |
| Links page — beta marker REMOVED (v19.50) | The gold-OUTLINE `.beta-chip` and its `beta-sheen` keyframes are gone (owner decision, Aug 2026 — the workspace is the tool the Dec 2026 proposals are built in, not a sketch to be announced). The first-visit notice was rewritten at v19.51 (`#linksWelcomeLb`, 14-day window, new `myb_links_welcome_seen` key) — the beta paragraph went, the useful one stayed. See `.claude/rules/links-design.md`. |
| Links page — design and save model (v12.09–v12.47) | Multi-design Firestore collection `linkDesigns` `{ name, patterns, updatedAt, updatedBy }`. Full rotation of `ROTATING_LINES` lines (**24 since v20.01**; 22 at v19.98, was 28) — every line must carry a real pattern; never restate the number, `links-rotation-parity.test.mjs` fails on a literal. CEAs do not work nights. Auto-generator is the only way to create a new design. Grid clicks delegated on `#linksGridBodyRows`. Position keys always `String`. Delete is a SOFT delete since v19.41 (a bin with no automatic expiry — v19.86/v19.96). See `.claude/rules/links-design.md` for full grid/paint/generator/coverage/checks/fatigue/concurrency/deletion/print detail — its `paths:` globs, so it loads whenever any `links-*.js` is edited. |
| Links page — fatigue factors are ADVISORY, never pass/fail (v19.46) | The Design checks card's second half reports which of the ORR's p3 factors are **present** in a design (`links-fatigue.js`). The ORR states these are not prescriptive limits, so **nothing here may render as red/green or read as a certificate** — a design showing few findings and being read as approved is the failure this feature must not cause. Three consequences that are easy to undo by accident: **never hardcode a status** (FF13's was, and put a green tick beneath the amber finding it duplicates); **NOT-APPLICABLE, CLEAR and STANDING are three different answers**, not synonyms for "fine"; and every rule must **lap the rotation**, since a person on line 28 goes to line 1 next week. Full rules + the four v19.48 regressions: `.claude/rules/links-design.md` → Fatigue factors. Project context: `LINKS_DEC2026_PLAN.md`. |
| Header back button removed (v10.63) | `admin.html` / `paycalc.html` no longer have a header `←` back button — it duplicated the nav drawer's Calendar pill (two competing nav paradigms) and clashed visually with the logo box. Navigation back to the roster is via the drawer. Header is now `[☰] [logo] Title … [badge]`. The admin "open calendar on the month I was editing" behaviour moved from the back button onto the `.nav-panel-pill--calendar` click in `admin-app.js`. `.btn-back` CSS removed from `shared.css` (still defined locally in `fip.html` / `railcard-guide.html`). |
| Header logo = back to calendar on sub-pages (v11.21) | On `admin.html` / `paycalc.html` / `operations.html` / `settings.html` the header logo `#appIcon` now navigates to `./` (the app root — `./index.html` 301s on Firebase Hosting, a wasted round trip per tap; changed v16.09) (`title`/`aria-label` = "Back to calendar"). This restores an iOS-friendly back affordance (iOS standalone PWA has no system back) without re-adding a visible back button — kept "invisible" as just the logo. The About lightbox it used to open moved to the **nav-panel drawer logo** (see that entry). The **calendar page keeps its header logo opening About** (`.title-icon` in `calendar-app.js`) — home has no "back" target. Do not wire the calendar header logo to navigate. |
| `.app-header` brand centering (v10.66) | `admin.html` / `paycalc.html` headers use `display:grid; grid-template-columns:1fr auto 1fr`. Burger sits in col 1 (`justify-self:start`), logo+title in an `.app-header-brand` flex wrapper in col 2 (auto, truly centred), badge in col 3 (`justify-self:end`). Equal `1fr` side columns guarantee the brand is always centred regardless of burger/badge width asymmetry. The calendar uses a different `.header` (balanced spacers), unaffected. |
| Sign-out in nav panel footer (v10.59) | Sign-out button moved from page headers to the nav panel footer. `initNavPanel({ onSignOut: fn })` — each page passes its own sign-out callback. Footer (member name + Sign out button) renders only when `onSignOut` is supplied. `.btn-signout` CSS removed from `shared.css`. |
| Notification bell in nav panel footer (v10.61) | `notif.js` is the shared Web Push module; `nav-panel.js` imports it and renders a 🔔/🔕 toggle in the footer (signed-in only, hidden when `notifSupported()` is false — incl. iOS non-standalone). Bell refreshes on every panel open; tap keeps the panel open. States: `on`/`off-default`/`off-lapsed`/`denied`/`unsupported`. `calendar-app.js` and `huddle.js` also import `notif.js` — VAPID key and subscribe/unsubscribe logic live in one place (v10.79). The `#notifPrompt` calendar strip stays on the calendar; the Notifications card lives on settings.html (moved v11.06). **The bell is a COMPACT icon next to Sign out (`.nav-panel-bell`)** — a labelled full-width "Notifications — On/Off" row has been tried and reverted TWICE (v13.14→v13.19, v16.56→v16.75; owner decision: the settings.html Notifications card is the canonical surface, the drawer bell is just a quick toggle). Don't re-promote it without a fresh discussion. |
| Guide pages back button → index.html (v10.57) | `railcard-guide.html` and `fip.html` back buttons now link to `./index.html` (not `./admin.html`) — guides are accessed from the nav panel, not the admin page. |
| Maskable icons | 512px entry uses `"purpose": "any maskable"` for Android adaptive shapes. Smaller icons omit this. |
| **Chiltern payroll rules** | Rostered Sat → `sat` (1.25×); Sat-on-RD → `rdw`. Sunday-on-BH: Sunday wins (1.5×) — `dow===0` before `isBH`. BH + `rdw` is additive (`bhOt` + `bh`). Confirmed May 2026; tests assert. See `.claude/rules/paycalc.md` for full detail. |
| `initALSection()` / `initSickSection()` in `admin-app.js` | `alMember`, `sickMember`, `syncMemberDisplay`, `syncSickMemberDisplay` are hoisted to module scope above the `fieldMember` change handler — that handler fires before init. Do not move them inside the init functions. |
| SW synthesised offline page uses status 200 | Some browsers suppress 5xx response bodies. `Cache-Control: no-store` prevents caching the synthesised page. |
| SW offline fallback only for navigation requests (v10.15) | Only `event.request.destination === 'document'` requests get the offline HTML page. JS/CSS get `Response.error()`. Without this, `/admin-app.js` matched `'admin'` in the fallback logic and got HTML for a JS request — MIME-type error. Fallback routing chain (v11.87): `paycalc` → `paycalc.html` · `operations` → `operations.html` · `settings` → `settings.html` · `admin` → `admin.html` · otherwise → `index.html`. |
| Huddle notification → `#huddle` hash pattern | SW navigates to `#huddle`; `calendar-app.js` `hashchange` handler triggers the viewer (`_autoOpen` is `let` so it can reset). **Two viewer paths — do not unify, do not revert notification path to direct `window.open`/`location.href`:** `htmlContent` present (DOCX converted server-side) → renders inline in both paths. No `htmlContent` (PDF or failed conversion) → the viewer shows an in-overlay "📄 Open Huddle" button (`#huddleOpenFileBtn`); its click is a real gesture (a direct `window.open`/`location.href` on a hash-open would be pop-up-blocked or knock the PWA out of standalone). The viewer is opened **only** via the `#huddle` hash — from both the nav-panel "Daily Huddle" link and notification taps (the old `#huddleBtn` was removed at v12.57). `huddles` Firestore reads are open (no auth) — `calendar-app.js` has no Auth session, so requiring auth would break auto-open on fresh visits. Full rationale: **OPERATIONS_REFERENCE.md → "Huddle notification tap behaviour"**. |
| `isBeforeMemberStart(member, date)` in `override-utils.js` (v10.16) | Returns true if `date` is before the member's `startDate`. Always use this helper — never inline the date comparison. |
| `navigateToPaycalc(paydayStr)` in `calendar-app.js` (v10.17) | Encapsulates session-check-then-navigate for payday and cutoff cell clicks. Always call this helper — never duplicate the navigation logic. |
| SW `new Request(url)` fetch pattern (v10.16) | `new Request(event.request.url, { cache: 'no-store', ... })` instead of passing opts to an existing Request. Passing opts alongside a Request doesn't reliably override cache mode on older Safari/Chromium. |
| `initErrorReporter()` call pattern (v13.78) | Writes to Firestore `clientErrors`, so a valid auth token is required. Three canonical call sites: (1) **`calendar-app.js`** — wait for auth persistence, run `reconcileExpiredIdentity()` (item 7 — sign out a lingering expired named identity), then sign in anonymously only if no named user remains: `authReady.then(()=>reconcileExpiredIdentity()).then(()=>auth.currentUser?null:signInAnonymously(auth).catch(()=>{})).catch(()=>{}).finally(()=>initErrorReporter())` — this preserves a valid named identity instead of racing with or replacing it; (2) **Authenticated pages with `sessionReady`** (`admin-app.js`, `settings-app.js`, `operations-app.js`, `links-app.js`) — call `sessionReady.then(()=>initErrorReporter())`; (3) **`paycalc-app.js`** (no `sessionReady`) — call `ensureNamedSession(name).catch(()=>{}).finally(afterAuth)`, where the `afterAuth` callback runs `initErrorReporter()` (alongside `recordUsage`/`recordPageLatency`); the `else` branch (no member) calls `afterAuth()` directly. Never call `initErrorReporter()` bare without an auth context — writes will be silently rejected by Firestore rules. |

---

## One-time notice pattern

Full HTML template, JS patterns (close-only and CTA+snooze), rules table, and monthly cleanup instructions are in `.claude/skills/new-notice/` — invoke `/new-notice` when adding a notice.

**Current notices** (keep this table current — monthly cleanup removes entries older than 180 days):

> **The Status column is load-bearing — keep it accurate** (added v19.51). A notice goes INERT the
> moment `isNoticeExpired` fires: the IIFE marks it seen and returns *without showing it*, so on any
> device that has not already opened that page it is dead code. But the removal rule above only
> fires at **180 days**, so a notice spends a long stretch expired-but-still-listed, and the table
> read as though both rows were live when in fact **neither had shown to anyone for weeks**. That is
> not merely untidy — it hides a real question. `ytd_2627` is the case in point: it prompts a member
> to enter their Year-to-Date figures at the start of the tax year, and a **new starter or a new
> device from July onwards gets no prompt at all**, which is exactly when accurate tax estimates
> need those figures. Expiring is right for an announcement; it may be wrong for a recurring
> seasonal prompt. Decide that rather than inherit it.

| ID | Page | Title | Badge | Posted | Expiry | Status | Dismiss mechanism |
|----|------|-------|-------|--------|--------|--------|-------------------|
| `ytd_2627` | `paycalc.html` | Enter your Year to Date figures | 💷 Pay | 6 Apr 2026 | 90 days | ⛔ **inert since ~5 Jul 2026** — copy is still accurate, but nobody new sees it (see note above) | One-time; `NOTICE_YTD_KEY` set on close |
| `links-workspace-2026` | `links.html` | Links Workspace | 🔗 Links | 2 Aug 2026 | **14 days** | ✅ live until ~16 Aug 2026 | One-time; `myb_links_welcome_seen` set on close |
| `pw-own-2026` | `index.html` | Set your own password | ⚙️ Settings | 6 Aug 2026 | **`CONFIG.PASSWORD_NOTICE_DAYS`** (90) | ✅ live until ~4 Nov 2026 — **review that date, don't just let it lapse** | CTA + snooze; 7d on close, 1d on CTA; `NOTICE_PW_OWN_DONE` (storage-keys.js). Also retired the moment Settings CONFIRMS the account is migrated, on any device (v19.91) |

The retired `links-beta-2026` (posted 9 Jun 2026, 28 days) was replaced at v19.51: the beta chip
went at v19.50, so its lead paragraph described a page that no longer existed. Only the paragraph
that was still true survived, joined by the fatigue-checks framing and the shared-designs/bin note
(which said 30 days until v19.86). It took a **new storage key** (`myb_links_welcome_seen`) — reusing the old one would have
meant every current designer, all of whom closed the beta notice months ago, never saw the
replacement.

> **`pw-own-2026` comes out when C5 ships, not when it expires.** Its job ends the moment the surname
> default is retired (SECURITY_RELEASE_PLAN → Track C5, gated on ~90% migrated) — after that it is
> telling people to fix something that no longer exists. The window is a backstop, not the plan — and
> since v19.91 it lives in **`CONFIG.PASSWORD_NOTICE_DAYS`** rather than inside the page, because
> `isNoticeExpired` marks a notice seen *without showing it*: on 4 Nov 2026 this becomes dead code on
> every device that has not already displayed it, while the table above still calls it live. If C5 has
> not shipped by then, raise that number and move the review date with it.
> It is also the ONLY notice aimed at members who never sign in, so do not "tidy" it by adding a
> `getSession()` guard: that would hide it from everyone it was written for.

**Monthly cleanup:** on the 1st of each month, remove any notice from the table where `(today − Posted) > 180 days` — delete the HTML block, JS IIFE, and bump the version.

---

## Payday calculator — integrated (v6.50)

| Component | Location |
|-----------|----------|
| `getPaydaysAndCutoffs(year)` | `roster-data.js` |
| `isPayday(date)` / `isCutoffDate(date)` | `roster-data.js` |
| 💷 / ✂️ calendar markers | `calendar-app.js` — `.payday` / `.cutoff` CSS classes |
| `getRosterSuggestion(p, member)` | `paycalc-roster-suggestions.js` — counts Sat/Sun/BH/Boxing Day/RDW. **Conservatism policy (v9.02, permanent):** does NOT infer ambiguous categories (swap shifts, rest-day weekday overrides). |
| `getEffectiveContr(p)` | `paycalc-settings.js` — contracted hours, pro-rated if member has `startDate` in the period |
| Reference guide | `paycalc-guide.html` |

---

## Shift types

| Value | Badge | Meaning |
|-------|-------|---------|
| `'RD'` | 🏠 Rest | Rest day |
| `'OFF'` | 🏠 Rest | Off day — bilingual roster only, treated identically to RD |
| `'SPARE'` | 📋 Spare | On standby, shift not yet assigned. Type `spare_shift`. Recorded via the **Other** pill's submenu (v15.57 — demoted from a top pill), but stays its own type/badge |
| `'RDW'` | 💼 RDW | Rest day worked — overtime |
| `'AL'` | 🏖️ AL | Annual leave |
| `'SICK'` | 🪑 Absent | Sick/absent day — recorded via override |
| `'HH:MM-HH:MM'` | ☀️/🌙/🦉 | Worked shift |
| `'TRG'` / `'IND'` / `'ASSESS'` / `'TEAM'` / `'UNION'` / `'MEET'` (+ optional `' RDW'`, `' HH:MM-HH:MM'`) | 🏷️ Train / Ind / Assess / Team / Union / Meet | The **"Other" family** (v15.35; evolved v15.40, Team Day v15.51, Union v18.56, Meeting v18.61, OTHER_PLAN.md): Training / Induction / Assessment / Team Day / Union course / Meeting. `'TEAM'` appears on the roster as the multi-word label "Team Day", `'UNION'` as "Union course", and `'MEET'` as the code "MTG" (also "MEETING"); the parser collapses each to its sentinel. LEAF-GREEN `other-day` family (`--other`, hue 136° — deliberately NOT bronze, which was hue-identical to Early's orange); hours slot shows actual times → `RDW` → base time — **except Meeting/Union (`hideBaseTime` in `OTHER_FLAVOURS`), which show the badge with NO time** unless a time is actually entered (they're attend-an-event days, not tied to a rostered shift; Training/Induction/Assessment/Team keep the base time as they run during your shift); tap shows the FULL word; pays as the day underneath (`resolveOtherPay` in `override-utils.js` — flavour-agnostic, unaffected by `hideBaseTime`); Sundays and Boxing Day (26 Dec) can never be training/Other days (confirmed by Gareth Jul 2026). The unknown-value fallback classes were renamed `unknown-day`/`badge-unknown` (v15.40) to free the `other-*` names |

**Classification:** Early 04:00–10:59 · Late 11:00–20:59 · Night 21:00–03:59

**isWorkedDay:** false for RD, OFF, SPARE, AL, SICK. True for everything else including RDW.

---

## Roster data structure

### teamMembers fields

```javascript
{
  name: 'G. Miller',       // MUST match Firestore memberName exactly
  currentWeek: 3,
  rosterType: 'main',      // 'main' | 'bilingual' | 'fixed' | 'ces' | 'dispatcher'
  role: 'CEA',             // 'CEA' | 'CES' | 'Dispatcher' | 'Management'
  hidden: false,           // Optional — hides from dropdown
  managerOnly: false,      // Optional — login-only manager/clerk account (Management group); hidden from the calendar member selector, has no roster of its own
  permanentShift: 'early', // Optional — forces early/late badge on all worked days
  startDate: new Date(2026, 3, 20), // Optional — midnight local time: new Date(year, month-1, day)
  noProRate: true,                  // Optional — set for secondment returns: startDate suppresses pre-return shifts but pay and AL are full-year (no pro-rating in paycalc; joiner banner hidden)
  proRatedAL: { 2026: 23 }, // Optional — overrides getALEntitlement for joining year only
  rosterChanges: [{ from: new Date(2026, 6, 1), rosterType: 'ces', currentWeek: 4 }] // Optional — scheduled roster moves
}
```

**`rosterChanges` (v12.31)** — date-driven roster transitions for a member who changes rosterType/link mid-life (e.g. a new starter on a temporary `fixed` pattern who later joins a rotating link). Each entry is `{ from: Date, rosterType, currentWeek }`; from `from` (midnight, **inclusive**) onward the member follows that rosterType/currentWeek instead of the base fields. Array must be **sorted ascending by `from`** — the latest entry whose `from` ≤ date wins. Resolved by `resolveMemberRoster(member, date)` in `roster-data.js`; `getBaseShift` and `getWeekNumberForDate` apply it automatically, so **no call site needs special handling**. The base `rosterType`/`currentWeek` describe the member *before* the first change. `startDate` (join-date RD suppression) is independent and still applies.

**AL entitlement** (`getALEntitlement` in `roster-data.js`) — `proRatedAL[year]` takes priority before any role check:

| Role / type | Days |
|-------------|------|
| CEA (main, bilingual, fixed — incl. C. Reen's fixed line) | 32/year |
| CES (`ces`) | 34/year |
| Dispatcher | 22 + 1 lieu per BH worked (`countDispatcherBankHolidaysWorked`) |

### Roster cycles

| Type | Weeks |
|------|-------|
| main | 20 |
| bilingual | 8 |
| fixed | 1 per member, no rotation — `currentWeek` selects which fixed pattern in `fixedRoster` (1 = C. Reen 12:00–19:00; 2 = S. Boyle / K. Jedlinski 09:00–16:00) |
| ces | 10 |
| dispatcher | 10 |

### Firestore collections

**overrides**
```
date         "YYYY-MM-DD"
memberName   Must match teamMembers[n].name exactly — one char mismatch = silent failure
type         "spare_shift" | "shift" | "rdw" | "annual_leave" | "correction" | "sick" | "other"
             Legacy (still in data, not creatable): "allocated" | "overtime" | "swap"
value        "HH:MM-HH:MM" for shift/rdw; "SPARE" for spare_shift; "AL" for annual_leave; "RD" for correction; "SICK" for sick;
             training uses the grammar FLAVOUR[" RDW"][" HH:MM-HH:MM"] — flavour "TRG"|"IND"|"ASSESS"|"TEAM", optional rest-day
             marker, optional actual times (see OTHER_PLAN.md; grammar single-source: override-utils.js)
note         Free text — "" if none. Field must always be present.
source       "manual" | "roster_import" — required by Firestore rules; written by all override save paths
changedBy    Optional — display name of who last changed the override; type-checked by the rules when present
createdAt    Firestore server timestamp
```

**huddles**
```
date         "YYYY-MM-DD" — also the document ID
storageUrl   Permanent tokenised download URL (both manual upload and Cloud Function ingest — the ingest path uses a download token, NOT a signed URL: GCS caps v4 signed-URL expiry at 7 days, too short for the 3-month retention window)
storagePath  Firebase Storage object path, e.g. "huddles/2026-06-25-lv9kab12.pdf" — versioned suffix
             prevents overwriting the old file before Firestore commits; absent on docs written before
             versioned paths — uploadHuddle's cleanup falls back to "huddles/{date}.{fileType}";
             pruneOldHuddles sweeps by the "huddles/<date>" prefix (covers legacy paths too)
fileType     "pdf" | "docx" — short form on browser writes (rule-constrained to ['pdf','docx'] since v14.29);
             the Cloud Function ingest path uses the Admin SDK and may store a MIME string
uploadedAt   Firestore server timestamp
uploadedBy   Member name string (manual upload) or "power-automate" (Cloud Function ingest)
htmlContent  Converted HTML string — present when a DOCX was uploaded/ingested; absent for PDFs
```
Reads: open (no auth required — calendar-app.js has no session; see Huddle notification tap behaviour in OPERATIONS_REFERENCE.md).
Writes: require auth + admin claim. Cloud Function writes via Admin SDK (bypasses rules).
Auto-prunes: docs older than **3 months** (Firestore doc + Storage file) are deleted by `pruneOldHuddles()` in `functions/index.js`, awaited at the end of every `ingestHuddle` run (the daily path). Huddles are higher-volume than circulars/newsletters (which keep 6 months) and rarely referenced after the day, so retention is shorter (v14.29). Storage delete on `/huddles` requires the admin-delete rule (v14.29).

**staffContact** (v12.68)
```
memberName  Must match teamMembers[n].name exactly — used as the document ID
workEmail   Work email address (5–200 chars; must be the `@chilternrailways.co.uk` domain — case-insensitive, anchored so look-alikes/subdomains are rejected, and no whitespace in the local part). Enforced by firestore.rules AND the client `isChilternWorkEmail()` (roster-data.js, single source `CONFIG.WORK_EMAIL_DOMAIN`); keep the two in sync (v14.97; rule local-part whitespace tightened v16.34)
updatedAt   Firestore server timestamp
```
Read/write restricted: owner can read/write their own doc; admin can read all.
Write requires the `name` JWT claim (set by setupRosterAuth) — anonymous fallback sessions cannot write.
Purpose: Stage 1 of password security improvements. Email will enable future account recovery (Stage 4).
Read/written/deleted by: `getStaffContact` / `saveStaffContact` / `deleteStaffContact` in `firebase-client.js`, called from `settings-app.js` (own email) and from `operations-app.js`'s merged **Account status** card (`saveStaffContact`/`deleteStaffContact` for admin set/edit/remove on a member's behalf). `getAllStaffContacts` (reads all docs) is also called from `operations-app.js` (Account status card).

**passwordStatus** (v18.63 — PASSWORD_PLAN.md Track C)
```
memberName   Must match teamMembers[n].name exactly — used as the document ID
passwordSetAt  Firestore server timestamp — the LAST time the member set their own password (Settings → Password). Written by the client (owner only).
resetAt        Firestore server timestamp — the last time an admin RESET this member back to their surname default. Written ONLY by the resetMemberPassword Cloud Function (Admin SDK, bypasses rules).
```
"Migrated" (has set their own password) = `passwordSetAt` present AND `passwordSetAt >= resetAt` (a later admin reset re-flags the account as surname-default). No password material is ever stored — only these two timestamps, which drive the Operations **Account status** table and the Settings status chip/nudge.
Read: owner or admin. Create/update (client): only the owner, only the `passwordSetAt` key, and it must equal `request.time` (so a client can only stamp "I just set my password now" on its own doc). `resetAt` is un-writable by any client (only the Admin SDK sets it). Delete: denied for everyone.
Written/read by: `savePasswordSetAt` / `getPasswordStatus` (owner) in `firebase-client.js` (called from `settings-app.js` after a successful password change), `getAllPasswordStatus` (admin, reads all) called from `operations-app.js` (Account status card), and the `resetMemberPassword` Cloud Function (writes `resetAt`).

**resetRequests** (v18.93 — PASSWORD_PLAN.md, the request queue)
```
memberName   Must match teamMembers[n].name exactly — used as the document ID
requestedAt  Firestore server timestamp — when they last asked
count        int — asks since the admin last cleared the row (so "asked 3 times" is visible)
provisioned  boolean — whether a Firebase account exists at all. false ⇒ the remedy is Set up
             accounts, NOT Reset. The login overlay must never distinguish these two (it would leak
             which names are provisioned); the admin's own card has no such constraint.
```
**Doc ID = the member name, deliberately:** the collection can therefore never exceed the roster size,
so flooding a public endpoint is impossible BY CONSTRUCTION rather than by rate limiting.
Read: admin only. **Create/update: DENIED to every client, including the admin** — the only writer is
the `requestPasswordReset` Cloud Function via the Admin SDK. That is not over-tightening: the member who
needs this has forgotten their password, so they have no Firebase identity at all (and `signInAnonymously`
runs only on the calendar), which is exactly why the request goes through a server endpoint instead of a
client write. Delete: admin only (clearing an actioned row).
No free text is ever stored — an unauthenticated endpoint writing caller-controlled strings into an admin
UI is an injection surface for no benefit; and the name comes from the server-owned `activeMembers` list,
never the request body, which is what makes it safe for the card to render.
Written by: the `requestPasswordReset` function. Read/cleared by: `getResetRequests` / `clearResetRequest`
in `firebase-client.js`, called from `operations-app.js`'s **Password Reset Requests** card. The member's
end is the login overlay's "Can't get in?" link (`requestPasswordReset` in `firebase-client.js` — the one
caller there that sends NO auth token).
**Admin notification (Phase 2, v18.95):** a genuinely-RECORDED request (never a throttled repeat — the
throttle is the notification's rate limit too) pushes `🙋 Reset requests — N waiting` to the admin, deep
-linking to `operations.html#reset-requests`. It goes through `sendTargetedPush`, **not** `fanOutPush`:
"N. Surname is locked out" broadcast to all ~50 staff would be a leak, so the send is filtered by the
`owner` uid and fails closed at every step (no target uids → nothing; a subscription doc with no `owner`
→ skipped, never assumed; no matches → log and stop). There is deliberately **no fall-back-to-everyone
branch**. Accepted cost: an admin device that subscribed before v17.76 (when `owner` was first stamped)
gets no push until the bell is toggled off and on. The push can never fail the request — the row in
Firestore is the doorbell, the push is a courtesy on top.

**pushSubscriptions**
```
endpoint     Browser push endpoint URL — also used (hashed) as the document ID
keys.p256dh  base64url-encoded p256dh public key
keys.auth    base64url-encoded auth secret
subscribedAt Firestore server timestamp — required by the rules
```
Written by `savePushSubscription`, deleted by `deletePushSubscription` in `firebase-client.js`.
Each document ID is a SHA-256 hash of the endpoint URL (first 20 hex chars). One doc per subscribed browser/device.
Read by the `ingestHuddle` Cloud Function (Admin SDK) when fanning out push notifications.
Client read: denied (`allow read: if false`) — no client may enumerate endpoints/keys. Create/update:
any authenticated session, shape-validated (`endpoint`, `keys.p256dh`, `keys.auth`, `subscribedAt`, and
the optional `owner`). `owner` = the writer's Firebase Auth uid, stamped by `savePushSubscription`; when
present the rules require it to equal `request.auth.uid`, so a session can only ever claim its own
subscription. **Delete (per-owner, A5 / F-SEC-5, v17.76 — was `request.auth != null` for any id):** an
authenticated session may delete a doc **only if `resource.data.owner == request.auth.uid`**, OR the doc
carries **no `owner`** (legacy docs written by older clients — kept deletable so VAPID-rotation cleanup
can't be locked out; orphans left by a uid change are swept server-side by `fanOutPush`'s 410/404
cleanup). New subscriptions are protected immediately; legacy ones harden as devices re-subscribe. This
closes the F-SEC-5 hardening gap (an identity that merely knew a doc id could previously delete any
subscription).

**clientErrors** (v13.31)
```
memberName   Display name of the member whose session caught the error
page         Filename where the error occurred (e.g. "admin.html")
message      Error message string — capped at 300 chars
stack        Stack trace string — capped at 800 chars
appVersion   APP_VERSION string at time of capture
userAgent    navigator.userAgent — capped at 150 chars
timestamp    Firestore server timestamp (when the error occurred)
resolved     boolean — false on create; set to true by admin to dismiss
resolvedAt   Firestore server timestamp — set when an admin resolves; retention is measured from this (90 days), not from `timestamp`
```
Write: any authenticated session (`request.auth != null`); shape-validated by Firestore rules.
Read/update/delete: admin only (`request.auth.token.admin == true`).
Written by: `logClientError` in `firebase-client.js`, called fire-and-forget from `error-reporter.js`.
Read/resolved by: `getClientErrors` / `resolveClientError` in `firebase-client.js`, called from `operations-app.js` Error Log card. `getClientErrors` queries unresolved and resolved separately (single-field equality, no composite index) so unresolved records are always prioritised — within expected operational volume (< 100 unresolved at once) a backlog of resolved records cannot hide them. It returns `{ errors, truncated }`: the unresolved query shows at most 100 with **no `orderBy`** (an `orderBy` would need the composite index this design deliberately avoids), so above that volume the shown 100 are arbitrary — not the newest. It fetches `100 + 1` and sets `truncated` only when the extra row returns (i.e. > 100 genuinely exist, not exactly 100), so the card shows a "showing the first 100" banner rather than silently hiding the rest (no-silent-caps, v15.69). Prunes resolved records 90 days past `resolvedAt`.

**analytics** (v14.14) — anonymous usage counters; **no member identity is ever stored**
```
Document  analytics/pv_<YYYY-MM>   { month: "YYYY-MM", counts: { <pageId>: <int> } }  — page popularity per month
Document  analytics/activeAccounts { months: { "YYYY-MM": <int> }, daily: { "YYYY-MM-DD": <int> } } — unique active-account counts
Document  analytics/origins       { daily: { "<YYYY-MM-DD>|<origin>[|pwa]": <int> } } — WHICH ADDRESS each account is on (v19.23; migration tracking)
Document  analytics/perf_<YYYY-MM> { month: "YYYY-MM", samples: { "<ver>|<page>|<metric>|<bucket>|<mode>|<conn>": <int> } } — page-load latency (Project 0, v14.89). Metrics: ttfb · fcp (first-contentful-paint, "appears") · domReady ("fully ready") · loginTotal (sign-in) · the three BOOT PHASES swBoot/sdkLoad/appBoot (v20.33 — contiguous spans of a load: SW wake → serve, serve → the `myb-sdk-ready` mark firebase-client.js sets as its body runs, mark → DCL; they let the card's "By stage of start-up" block state WHERE a slow start went instead of inferring it). admin loads excluded (v14.95)
```
Page ids: `calendar` | `admin` | `paycalc` | `operations` | `settings` | `links`. The same `counts` map also carries the **document/guide OPEN counters** (v18.20; every guide counted since v19.95, and the Rangers guide joined them at v20.05): `huddle` | `circular` | `newsletter` | `guide-staff` | `guide-paycalc` | `guide-railcard` | `guide-fip` | `guide-rangers` — incremented by `recordOpen(itemId, identity)` in `usage-reporter.js` at the real "opened" moments (Huddle viewer auto-open in `calendar-huddle-viewer.js`; the nav-drawer Circular/Newsletter open and the guide-link taps in `nav-panel.js` — the static guides have no Firebase, so their only in-app route is where the open is counted; the notification-tap doc viewer's Open button in `calendar-doc-viewer.js`). Same write-time admin exclusion as page views (the developer's opens are never recorded); no dedup — every open counts. All of them are allowlisted in `firestore.rules` (extend the allowlist when adding one — `firestore-contract-parity.test.mjs` checks the two lists both ways, so a missing id is a test failure rather than a silently-dropped counter). **The guide id lives on its `NAV_GUIDES` entry and is stamped onto the link as `data-open-id`** — never matched from the href, because `'./paycalc-guide.html'.includes('guide.html')` is TRUE and a substring test would count every Pay Calculator Guide open as a Staff Guide open, with both bars still looking plausible. Until v19.95 only two guides had a branch at all, so the group answered a narrower question than its heading claimed; `firestore-contract-parity.test.mjs` now fails if a `NAV_GUIDES` entry has no `openId` or the two lists drift. The Operations Usage card renders them as a separate "Documents & guides — opens" bar group under Page popularity.
Uniqueness of "active accounts" is deduped **client-side** (localStorage flags keyed by member name, which never leave the device) so the server only ever receives `increment(1)` — it stores *how many* accounts were active, never *which*. "Last 30 days" = sum of the `daily` buckets over the rolling window (each account self-suppresses for the window, so the sum is a true unique count). Counts are per account-device (multi-device users count more than once) — a usage trend, not an exact headcount. **The EXACT unique count sits beside it (v18.96)** and comes from a different source entirely: the `getSignInStats` Cloud Function reads Firebase Auth's own `lastSignInTime`, so uniqueness is a property of the data rather than something the app has to enforce — and nothing new is stored (no per-account record, no identity returned). It measures **sign-ins, not activity**: sessions last 60 days, so most page opens are session RESTORES. The 30-day sign-in window is therefore SHORTER than a session and no longer bounds active people in either direction — it misses anyone signed in 31–60 days ago who uses the app daily, as well as including anyone who signed in once and stopped (until v20.47 the session was 30 days, which made it a slight OVER-count; do not restore that claim unless the window is derived from `SESSION_MS`). There is no month-over-month history either (only the LAST sign-in is stored). Both figures are shown, each labelled with what it measures — the exact one does not replace the trend. `neverSignedIn` is the actionable number: accounts provisioned by Set up accounts that have never been used.
Write: any authenticated session (`request.auth != null`), including the calendar's anonymous Firebase session. Values aren't individually validatable (Firestore can't restrict to increment-only) — App Check is the eventual integrity control; the data is non-sensitive aggregate counts. No client delete.
Read: admin only (`request.auth.token.admin == true`).
Written by: `recordPageView` / `recordActiveAccount` in `firebase-client.js`, called from `usage-reporter.js` (`recordUsage`) on every page. Read by: `getUsageStats` in `firebase-client.js`, called from `operations-app.js` Usage card (which also prunes daily buckets past ~35 days). Decision/aggregation maths is the pure `usage-stats.js` module.
The `perf_<YYYY-MM>` doc (Project 0, v14.89) holds anonymous page-load latency: `recordPageLatency(page, identity?)` in `perf-reporter.js` buckets Navigation Timing (`ttfb`/`domReady`) **and Paint Timing (`fcp` — first-contentful-paint, "appears on screen")** and calls `recordPerfSample` in `firebase-client.js`; key dimensions (version/page/metric/bucket/PWA mode/connection class) are non-identifying — no member, no raw ms. **Admin (developer) sessions are excluded** so figures reflect real staff. The Operations "App speed" card (`getPerfStats` → `initPageSpeedCard`) reads THIS month + LAST month and shows two journeys — 🔑 Signing in, and 📄 Opening pages as two milestones (✨ First appears / ✅ Fully ready) with both bars per page. Bucketing/verdict maths is the pure `perf-stats.js` module. **"Why some are slower" (v20.19)** breaks the BUSIEST page down by connection, install mode and app version — dimensions every sample has always carried and the card used to discard, so it could say which page was slow and nothing about why. Read-side only; the busiest page is chosen at render rather than hardcoded, and groups below 20 samples are marked `(few)` because a handful of loads can read 100% and mean nothing. Each row states **"% over 1s"** — the complement of the card's own headline — not "% slow": the first real data showed every row reading 0–3% slow beside a bar with a wide amber middle, i.e. the tail is *over one second*, not over three, and a number naming the wrong band is trusted over the bar beside it. Versions roll up into ranges (`v20.10–v20.19`) for the reason in AI_MAP.

**Per-address migration counters (`analytics/origins`, v19.23).** While the app is served from BOTH `myb-roster.web.app` and the GitHub Pages mirror, this is the only record of how far the move has got. Keys are `YYYY-MM-DD|<origin>` and `YYYY-MM-DD|<origin>|pwa`; `<origin>` is a closed label set (`web`/`pages`/`fb`/`other`, from `originLabel` — never a raw hostname, whose dots would nest the map key). Deduped client-side per member per rolling 30 days, so the server only ever sees `+1`.

**Two INDEPENDENT dedup flags** (`myb_origin_seen_<member>` and `myb_origin_pwa_<member>`), not one: a single flag would freeze whichever mode an account happened to use first, so anyone who opened a browser tab before opening the installed app would never be counted as installed — and that is the entire question. `recordOriginUse({ countVisit, installed })` therefore takes the two gates separately; `countVisit:false, installed:true` is the real case where an account already counted this window has just opened the installed app.

**Deduped on `identity`, NOT `member`** — active accounts only count signed-in pages, so calendar-only staff (the majority, and exactly the people a migration strands) would never appear. `identity` is the calendar's selected member and never leaves the device.

**A SEPARATE doc from `activeAccounts`, deliberately.** That doc's rule pins it to `hasOnly(['months','daily'])` and Firestore evaluates the RESULTING document — so the moment a client wrote an extra key there, the doc would permanently contain it and every later write, including the counters that already work, would be denied until the rules deploy caught up. Hosting and rules ship from the same push via separate workflows with no ordering guarantee. Here a rules lag costs only the new metric.

**What it cannot see:** it counts OPENS, so an install nobody has opened in 30 days is invisible; someone using both addresses counts on each (which is what half-migrated looks like); and admin loads are excluded like every other metric. The Operations Usage card states all of this under the bars. Written by `recordOriginUse` in `firebase-client.js` ← `_recordOrigin` in `usage-reporter.js`; read by `getUsageStats` → `summariseOrigins`; rendered by `_appendOriginSection` in `operations-reports.js`.

**Admin-exclusion (usage + speed, v14.95):** both `recordUsage` and `recordPageLatency` drop a session whose active member is in `CONFIG.ADMIN_NAMES` — the figures must reflect real staff, not the developer's own testing. It is a WRITE-time filter (no identity is stored, so it can't be filtered on read); historical pre-v14.95 data stays polluted, but is clean going forward. The Operations cards now also offer a **This month / Last month** window (month-over-month trend; last month is a stable full window early in a month) — active accounts keep their existing "Last 30 days" rolling figure.

**circulars** (v13.58)
```
date         "YYYY-MM-DD" — also used as the document ID; re-uploading the same date overwrites
storageUrl   Permanent tokenised download URL
storagePath  Firebase Storage object path, e.g. "circulars/2026-06-25-lv9kab12.pdf" — added v13.99
             (versioned suffix prevents overwriting the old file before Firestore commits);
             absent on docs uploaded before v13.99 — _pruneOldDocs falls back to "{collection}/{date}.pdf"
fileType     "pdf" | "docx" (Word uploads allowed since v16.31; no inline HTML conversion — a PDF opens directly, a Word doc opens via Microsoft's Office Online viewer (`officeViewerUrl`, v16.45) so it renders with images instead of downloading; rule-constrained to [pdf,docx])
uploadedAt   Firestore server timestamp
uploadedBy   Member name string
```
Read: open (no auth required — `calendar-app.js` has no session; matches Huddle model). Write: admin only (Storage rules also enforce PDF-or-DOCX, ≤20 MB).
Written by: `uploadCircular(date, file, uploadedBy)` in `firebase-client.js`, called from `operations-app.js`.
Read by: `getLatestCircular()` in `firebase-client.js`, called from **`nav-panel.js`** (☰ → Weekly Retail Circular — opens **directly** in a new tab, one tap: a PDF by its own URL, a Word doc via the Office Online viewer) and from **`calendar-doc-viewer.js`** (the `#circular` in-app viewer used by **notification taps only**, which have no user gesture to open the file directly).
Auto-prunes: documents older than 6 months are deleted (Firestore doc + Storage file) fire-and-forget on every upload via `_pruneOldDocs()` in `firebase-client.js`.

**newsletters** (v13.59)
```
date         "YYYY-MM-DD" — also used as the document ID; re-uploading the same date overwrites
storageUrl   Permanent tokenised download URL
storagePath  Firebase Storage object path, e.g. "newsletters/2026-06-25-lv9kab12.pdf" — added v13.99;
             absent on docs uploaded before v13.99 — _pruneOldDocs falls back to "{collection}/{date}.pdf"
fileType     "pdf" | "docx" (Word uploads allowed since v16.31; no inline HTML conversion — a PDF opens directly, a Word doc opens via Microsoft's Office Online viewer (`officeViewerUrl`, v16.45) so it renders with images instead of downloading; rule-constrained to [pdf,docx])
uploadedAt   Firestore server timestamp
uploadedBy   Member name string
```
Read: open (no auth required — `calendar-app.js` has no session; matches Huddle model). Write: admin only (Storage rules also enforce PDF-or-DOCX, ≤20 MB).
Written by: `uploadNewsletter(date, file, uploadedBy)` in `firebase-client.js`, called from `operations-app.js`.
Read by: `getLatestNewsletter()` in `firebase-client.js`, called from **`nav-panel.js`** (☰ → Marylebone Newsletter — opens **directly** in a new tab, one tap: a PDF by its own URL, a Word doc via the Office Online viewer) and from **`calendar-doc-viewer.js`** (the `#newsletter` in-app viewer used by **notification taps only**).
Auto-prunes: documents older than 6 months are deleted (Firestore doc + Storage file) fire-and-forget on every upload via `_pruneOldDocs()` in `firebase-client.js`.

**linkDesigns** (v12.09)
```
name        Design name
patterns    Full-rotation pattern data, one entry per line (`ROTATING_LINES`)
updatedAt   Firestore server timestamp
updatedBy   Member name string
deletedAt   Optional (v19.41) — Firestore server timestamp. PRESENT = in the "Recently deleted"
            bin (hidden from the picker, restorable until removed by hand — automatic expiry SUSPENDED v19.86, see KNOWN_LIMITATIONS); ABSENT = live. Restore clears
            it with deleteField(), so absence is unambiguous.
deletedBy   Optional (v19.41) — display name of whoever deleted it
```
Read: a **named** session — `'name' in request.auth.token`, or `admin` (v19.39; was `request.auth != null`, which sounded like "any signed-in member" but included the calendar's unconditional `signInAnonymously` session, i.e. any visitor who could open the app URL). Deliberately NOT narrowed to `linksDesigner`: a designer whose token predates that claim must still be able to LOAD the workspace so their first write can permission-deny and self-heal through `writeWithClaimRetry`. Write: requires the `linksDesigner` claim OR `admin` (H2, shipped v16.29 — was any-authenticated write until then), AND (create/update, v17.02 — Finding #12) is **shape-validated**: `hasOnly(['name','patterns','updatedAt','updatedBy'])`, `name` a 1–100 char string, `patterns` a map, `updatedAt` a timestamp, `updatedBy` a ≤100 char string (delete carries no body). The create/update allowlist gained the optional `deletedAt`/`deletedBy` pair at **v19.41** (type-checked when present; a live design carries neither, which is why they are optional rather than required). `linksDesigner` is set by `setupRosterAuth` from `CONFIG.LINKS_DESIGNERS`; `links-app.js` wraps every write in `writeWithClaimRetry` so a stale token self-heals, and saves atomically via `runTransaction` (v17.02 — Finding #13). Designs are **not** member-owned (no per-member isolation — any designer edits, deletes or restores any design).
Written/read by: `links-app.js` (the multi-design workspace collection).

Override cache key: `"memberName|YYYY-MM-DD"`

### Authentication

Staff log in with name (dropdown) + password. The **default** password is their surname (lowercase, no spaces/special chars); since v18.63 (PASSWORD_PLAN.md Track C) a member can **set their own password** in Settings → Password, and sign-in accepts either the typed password or — for anyone still on the default — the surname (`credentialCandidatesFor` in `auth-identity.js` builds the ordered candidate list, `ensureFirebaseSession` tries each). If a member forgets a self-set password, the **admin resets it** back to the surname default (Operations → Account status → Reset, backed by the `resetMemberPassword` Cloud Function). Sessions expire **60 days after sign-in**, full stop (60 days since v20.47, owner decision — 30 until then; the 7-day inactivity cutoff went at v20.41 with its timestamp machinery). Inactivity alone never ends a session; nothing extends one either, so `expiry` is set once at sign-in and `getSession()` is a pure read. Everything that genuinely REVOKES access is unchanged and still immediate: an explicit sign-out (which signs Firebase out too), a disabled or deleted account, revoked Firebase credentials, and the claim-epoch sweep. The Calendar **viewer** is a different thing entirely and is untouched — it holds no `name` claim and its persistence is session-only, so it ends when the browser session does. `CONFIG.ADMIN_NAMES = ['G. Miller']` — elevated access. `CONFIG.LINKS_DESIGNERS = ['G. Miller', 'S. Silva', 'M. Robson']` — access to the Links design workspace.

The login dropdown groups members by grade (CEA · CES · Dispatcher · Management, in that order). `managerOnly: true` members (managers/clerks) appear **only** in the Management group and are hidden from the calendar's member selector — they have login access but no roster of their own. Their grade dropdown filtering lives in `admin-app.js` (`GRADE_ORDER`).

**Forced migration (v18.92 — PASSWORD_PLAN.md Phase 2).** `CONFIG.FORCE_PASSWORD_SET` (a kill switch,
currently `true`) makes `password-force.js` compel any member still on the surname default to choose
their own password **at their next sign-in** — nobody is signed out to accelerate it. No forced sign-out
is needed: sessions cap at 60 days absolute and an expired session forces a real typed
login, so coverage completes itself inside 60 days and staggers by each member's own expiry rather than
landing on everyone at once. It shows only for a `named` identity — never the calendar's anonymous
session nor a soft-failed paycalc one, where `updatePassword` cannot succeed and the block would be
unsatisfiable — and fails open on any failure it cannot recover from. A member who only ever views the
roster never signs in anywhere and is therefore never compelled: accepted (reaching them means Track E).
**It is now the ONLY post-login overlay.** The work-email check that used to queue behind it was
retired at v19.30 (every member's email is registered; a wrong one is corrected in Settings), taking
the precedence rule and its marker-deletion with it. If a second post-login overlay is ever added,
read the note above `_show` in `password-force.js` first — anything that must happen when an overlay
OPENS has to fire before the await, never after it (the v18.94 bug).

**Password security note:** The *default* password is surname-derived and not a secret — protection relies on Firebase Auth rate-limiting (v9.53) and Firestore rules (`request.auth != null`). A member who sets their own password (v18.63) does get a real secret; the surname default remains valid **only until** they do (the sign-in candidate ladder tries the typed value first, then falls back to the surname). An admin reset returns the account to the surname default. Full design + phasing: `PASSWORD_PLAN.md`.

**Calendar access — the staff PIN (v20.12).** The Calendar opens for a named member session OR the shared staff PIN, and for nothing else. A signed-in member is never interrupted. A shared office PC enters four digits and gets the full Calendar including overrides, in a session that lives exactly as long as the browser session. Everything privileged still requires a real member sign-in — the viewer has no `name`, `admin`, `manager` or `linksDesigner` claim and cannot write anywhere. The PIN value lives only in the `CALENDAR_VIEWER_PIN` secret. Design: `calendar-access.js` / `calendar-access-core.js`; operations + rotation: OPERATIONS_REFERENCE.md; the closed limitation: KNOWN_LIMITATIONS.md.

**A consequence worth expecting in support questions:** a member who has never signed in anywhere now has to unlock each browser session, where before the Calendar simply opened. Signing in once (a 60-day session) removes the PIN entirely, which is what the `pw-own-2026` notice already asks of exactly that group.

Firebase SDK: currently v12.16.0. Check version before any new Firebase work. **An SDK bump must also update `FIREBASE_SDK_VERSION` in `service-worker.js`** (the SDK offline cache is keyed on it) — `sw-asset-check.test.mjs` fails the build if they diverge.

---

## Key rules

- **Offline first** — Firestore is an enhancement. Every Firestore call needs a silent fallback. Never block rendering waiting for Firestore.
- **Mobile is primary** — all staff use Android phones. Test every change at 375px.
- **Print CSS** — any new shift type, cell class, or badge needs `@media print` rules.
- **No `alert()`** — `console.error()` for developer errors. No visible error text for recoverable failures.
- **Code quality** — pure functions where possible, JSDoc on all functions, meaningful variable names, error handling on all async operations.

---

## Known issues & deferred work

Active constraints, deferred fixes, and the four v11 security tasks: **see `KNOWN_LIMITATIONS.md`**.
UX experiments tried and reverted, plus future capabilities: **see `ROADMAP.md`**.

**Do-not-change UI labels (Claude-relevant):**
- **Admin button label** — "Admin" = administration, not administrator. Intentional. Do not rename.
- **Shift type count** — 6 pills in the admin selector (v15.57; was 7 — Spare moved into the Other submenu). New day KINDS go into the Other submenu, not new top pills.

### Staff-facing wording conventions

Applies to **all user-visible copy** (cards, hints, tips, lightboxes, error banners, notifications) — not to code identifiers, data values, or comments.

**"the admin" vs "your manager" — who a staff member is told to contact:**
- **App / account matters → "the admin".** Anything about the app itself or a staff member's account: password reset, who can read a saved work email, a technical failure (roster won't display, a Huddle link is broken, data won't load). The admin (developer/app owner) fixes these.
- **Work / operational matters → "your manager".** Anything about the roster as work: booking annual leave, recording absence, shift changes, general rota queries. The manager owns these.
- Rationale: staff can't fix app faults by asking a line manager, and the admin isn't the right contact for an AL request. Matching the contact to the problem is the whole point. When in doubt, ask: *"is this a broken-app problem or a work problem?"*
- Note on data access: only the **owner + admin** can read a `staffContact` work email (Firestore rules) — a manager cannot — so "only you and the admin can see this email" is the factually correct phrasing, not "your manager".

**Canonical terms (use these exact forms in visible copy; established in the v15.05 wording sweep):**
- **"Change a Shift"** — never "override", "Recording a Shift Change", or "shift override" (the word "override" stays in code/data only).
- **"Absent" / "record an absence"** — never "sick"/"sickness" in UI copy (the reason is never stored — GDPR). The internal data value `SICK` and ids are fine.
- **"Year to Date"** — always spelled out, never bare "YTD". The two payslip figures are exactly **"Taxable Pay"** and **"Tax Paid"** (never "Gross Pay" for the YTD figure). See `.claude/rules/paycalc.md` → payslip line names.
- **"Fill from calendar" / "From your calendar" / "Replace with calendar values"** — the paycalc pre-fill reads the *calendar* function, not the base roster; do not reword to "roster".
- **"self-service password reset (in a future update)"** — the one phrasing for the *email-based* self-service recovery that is still to come (PASSWORD_PLAN.md Stage 4). Never "recovery" or "coming soon". **Note (v18.63):** a password *reset* now exists **today** via the admin (Operations → Account status → Reset) and staff can set their own password (Settings → Password), so do NOT say a password reset is flatly "not available" — only the *email self-service* route is future. Present-day recovery copy is "To reset a password today, contact the admin."
- **App name "Marylebone Roster"** — the on-screen name everywhere (incl. bug-report `appLabel` as "Marylebone Roster — <Page>"). **Never "MYB" for the APP or one of its tools** — not "MYB Roster", not "MYB Pay Calculator", not "MYB member". As the app name it survives only in the iOS home-screen `apple-mobile-web-app-title` meta and in comments.
  **But MYB as the STATION CODE is correct and stays** (v20.13 — this rule said "MYB … survives only in the iOS meta and comments" full stop, which is wrong and would send the next person to "fix" the guide mastheads). `MYB` is Marylebone's three-letter code, staff use it daily, and the guides carry "Chiltern Railways · MYB Station" and "Typical MYB — Network-area journeys" correctly. The test is what the letters NAME: the station, fine; the software, never. Enforced by app-name-parity.test.mjs.
- **Documents:** "Daily Huddle" (proper noun), "Weekly Retail Circular", "Marylebone Newsletter".
- **Tone:** calm and factual — no exclamation marks, no marketing voice (mirrors `.claude/rules/notifications.md`).

---

## Huddle ingest

Daily Huddle PDF/DOCX → Power Automate → `ingestHuddle` → Firebase Storage + Firestore `huddles` collection + push notification. The upload button is labelled **"Choose file"** (not "Choose PDF") — intentional, Huddles can be PDF or DOCX.

Full flow diagram, request format, gotchas, and Security Rules: **see `OPERATIONS_REFERENCE.md`**.

**Push notification design language:** all Web Push payloads (Huddle, Pay, and future Circular/Newsletter) must follow `.claude/rules/notifications.md` — leading emoji = the feature's in-app icon, "Latest X" for document arrivals, calm/no-exclamation tone, monochrome badge, and a single `buildPushPayload` builder. Never hand-write a payload literal.

---

## Weekly Roster Upload

Admin uploads PDF → `parseRosterPDF` (model in `functions/index.js` `CLAUDE_MODEL` — currently `claude-sonnet-5`) → JSON → review UI → Firestore. Works for CEA/Bilingual, CES, and Dispatcher rosters.

**Critical:** `RDW|HH:MM-HH:MM` pipe encoding — AI returns `"RDW HH:MM-HH:MM"`, normalised to pipe in review, stripped to plain time on save. Do not strip `RDW` from the AI return value.

**`source: 'roster_import'`** on all roster-upload overrides — used by `computeCellStates()` for COVERED/DIFF/CONFLICT classification.

**`UNKNOWN|<raw>` sentinel (v15.30):** a non-empty cell `normaliseShift` can't parse is NOT defaulted to `RD` (which, when the base is also RD, silently dropped a real shift as a MATCH). It returns `UNKNOWN|<raw>`; `computeCellStates` maps it to an **UNREADABLE** review row. Since **v19.32** that row is no longer skip-ONLY: where the server sent two candidate readings (`choices`) and they survive normalisation as genuinely different values, the row offers them as a CONFLICT-style pick plus a **Skip** button, and a picked value IS written. Unpicked is still the default and still writes nothing, so a row left alone behaves exactly as it did before. Empty/blank cells still → `RD`.

**Day-drift defence (v16.68) — three layers; a one-day shift can no longer be silently written.** The only entry point for a shifted row is the AI's visual ROW read (date assignment is deterministic: day-name keys → server dates). Layers: (1) `applySundayScanCorrections` — the original Sunday-anchored Case A/B repair; (2) **`applyColumnScanCrossCheck`** (`functions/roster-parse-helpers.js`) — the prompt now demands a second, column-by-column read (`columnScan`, generalising `sundayScan` to all 7 columns) and every cell is cross-checked row-vs-column: agreement → keep; a disagreement that realigns exactly under a one-day SUFFIX shift anchored at the first disagreeing day (a dropped blank shifts only the tail after it) with ≥2 disagreements and ≥5 signalled days → deterministic repair (two-source consensus); a **Rest ↔ Absence** disagreement (one read is `SICK` — a positive OD/HA/SC/SN/ML absence code — the other a rest day, and not a Sunday) → **records the absence** (`SICK`), because dropping a real absence is the dangerous SILENT failure (the person appears to be working) whereas a false absence is visible + correctable, and an absence code isn't hallucinated on a blank cell; any OTHER disagreement → the cell becomes `UNKNOWN|<app-language readings>? (PDF unclear)` — the skip-only UNREADABLE review state carrying BOTH readings (the readings use staff-facing terms — "Absent", never "sick"). Fails open when `columnScan` is absent. (3) **`detectShiftedRow`** (`admin-roster-upload.js`, client) — the AI-independent signal: the parsed week is correlated against the member's OWN base roster at offsets −1/0/+1; if a ±1 alignment beats offset 0 by ≥3 matches (and scores ≥5/7), the review section shows a prominent "these days may be one day out" warning banner — catches the residual case where BOTH AI reads misread identically. Warn-only; nothing auto-changed client-side.

Full request/response format and review pipeline: **see `OPERATIONS_REFERENCE.md`**.

---

## Firebase Auth (complete — v7.94)

All staff have Firebase Auth accounts. Firestore rules require `request.auth != null` for all writes.

**Session re-establishment on page load (v10.93):** `admin-app.js` signs in to Firebase Auth
both on fresh login AND on every page load when a localStorage session already exists. This is
critical — a returning user with a valid 60-day localStorage session skips the login screen, so
without the page-load sign-in, `auth.currentUser` stays null and all Firestore writes fail.
`ensureFirebaseSession(name)` in `session.js` handles this: waits for `onAuthStateChanged`
(to detect any IndexedDB-persisted session), then signs in if none exists, self-healing a
missing account via `createUserWithEmailAndPassword` if needed. Do not remove this call.

**Per-member write isolation (STRICT — B2 built v14.53, B3 strict cutover shipped v16.29):**
`overrides` create/update/delete require the member's own `name` claim, OR an `admin`/`manager`
claim (both write on behalf). The rule is now **STRICT** — the old permissive `!('name' in token)`
escape (which allowed a token with no `name` claim so legacy/anonymous sessions could never lock
out) has been REMOVED. The v10.94 hard-cutover outage was avoided this time by the permissive→strict
CLAIM_EPOCH=2 token sweep (v15.33), which force-refreshed every active device onto its correct-tier
claim before the strict rule shipped; stale tokens now self-heal via `writeWithClaimRetry`, so no
mass sign-out is needed. **Three claim tiers**, all set by `setupRosterAuth`:
`{ admin: true, name }` for `ADMIN_NAMES`, `{ manager: true, name }` for `MANAGER_NAMES`, `{ name }`
for everyone else (admin outranks manager). The `manager` tier is load-bearing: managers edit staff
AL/sick/shifts on behalf daily — without the `manager` bypass the isolation rule silently locks
them out. Master-admin collections (huddles/circulars/newsletters/roster/auth) stay `admin`-only —
do NOT grant managers `admin: true`. **Deploy prerequisite:** managers must be re-provisioned
(Operations → Set up accounts, which now sets the `manager` claim) AND token-refreshed before the
isolation rule is relied upon — a stale manager token has `name` but not `manager`. Full scope,
runbook, and the B3 strict step (shipped v16.29): `SECURITY_RELEASE_PLAN.md` → B2/B3; history:
KNOWN_LIMITATIONS.md task #2.

**New starter:** invoke `/new-starter` — the skill has the full 3-step checklist, mid-year field reference, and pro-rata formula invariant.

**Removing a staff member:** Set `hidden: true`, run Set up accounts → "Disable accounts for leavers".

Email/password convention: **see `OPERATIONS_REFERENCE.md`**.

---

## Pay calculator — current reality (v8.21+)

Manual-entry. **Current 2026/27 rates (3.6% RMT award, applied automatically from the 28 Aug 2026 payslip — deferred from 31 Jul, informed Jul 2026): CEA £21.49/hr · CES £22.60/hr · London Allowance £286.10.** Periods paid BEFORE 28 Aug 2026 stay on the 2025/26 rates (CEA £20.74 · CES £21.81 · London £276.16) — the mid-year step is applied automatically by `getRateForPeriod` + `getLondonAllowanceForPeriod` (keyed on the year's `londonAllowFrom`), so historic payslips still match. The **arrears** owed from 1 Apr 2026 up to that payslip stay the **opt-in** back-pay lump (the include tick), not auto-added. Both grades 140hrs/period · pension £147.36 (from 8 May 2026; the historic per-era defaults — £160.78 / £156.29 / £154.77 — are modelled by `PENSION_STEPS` in `paycalc-calc.js`, v18.43). Update `GRADES`/`AWARD_RATES`/`TAX_YEARS` in `paycalc-calc.js` when the next award is announced. Roster-assist pre-fills Sat/Sun/BH/RDW; standard weekday hours not pre-filled. Full detail (rates, state management, layout, payroll rules) in `.claude/rules/paycalc.md`.

**Example payslips for testing:** `MILLER_ACTUALS` in `test-fixtures/miller-actuals.js` (moved out of the served `roster-data.js` at v14.68 for privacy — excluded from Firebase Hosting; the SERVED "Actual Take-Home" comparison — which read `MILLER_ACTUALS` from the then-served `roster-data.js` — was removed in the same change; a **device-local** actuals overlay remains developer-only: `paycalc-app.js` reads `readPayslipActuals()` from localStorage, gated to `G. Miller`, data imported per-device and never served) contains 13 real payslip records from G. Miller's 2025/26 tax year (the 13 four-weekly periods, printed P4–P52 on the payslip) with actual gross, tax, NI, net, and varPay values. `paycalc.test.mjs` imports the fixture to verify tax and NI computations stay within payslip tolerance. When making changes to pay maths (tax, NI, thresholds, variable pay), run the payslip integration tests in `paycalc.test.mjs` and check that existing assertions still hold. Use `paycalc-hpp.test.mjs` for `_varPayForPeriod` regression tests.

---

## Guide pages (railcard, FIP, guide shell)

The guide pages (`guide.html`, `paycalc-guide.html`, `railcard-guide.html`, `fip.html`, `rangers-guide.html` — the fifth, added v20.05, which this line still called "four" until v20.32) share `guide-shell.css` (sticky header, back/PDF buttons, print rules, brand palette tokens). Each has its own CSS file. No `shared.css` import. No inline scripts or `onclick` (CSP blocks them). Full design principles, factual accuracy notes, and shell spec in `.claude/rules/guide-pages.md`.
