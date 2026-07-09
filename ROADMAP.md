# MYB Roster — Product Roadmap

*Last updated: July 2026 — v16.30 · Updated every 0.10 version*

This file covers what's been built, what could come next, and design experiments that were tried and reverted. For implementation specs (Firestore schema, Cloud Function APIs, Firebase Auth, etc.), see CLAUDE.md.

---

## Completed phases

### Phase 1 — Firestore read layer ✓
Owner manually enters shift overrides. App reads and overlays them on the base roster. No user logins required.

### Phase 2 — Staff self-service portal ✓
Individual staff log in and enter their own overrides. Admin (G. Miller) has elevated access.

**What was built:**
- admin.html — self-service portal for all staff plus admin tools
- Individual login per staff member (name + surname password)
- AL booking with entitlement tracking (32 days CEA, 34 days CES & Fixed, 22 + 1 lieu per worked BH for Dispatcher)
- Bulk override operations and override history
- Cultural calendar marker preference per member (Islamic, Hindu, Chinese, Jamaican, Congolese, Portuguese)
- Dispatcher and fixed roster types
- Firestore security rules — server-side validation of all writes

**Auth note:** The original plan specified Firebase Auth (Microsoft SSO or email/password). The implementation uses a simpler surname-based password with localStorage sessions. This was a deliberate divergence — no Chiltern IT dependency, no registration flow, works immediately for all staff. Firebase Auth is now partially wired in (v7.61) for future hardening; see CLAUDE.md — "Firebase Auth (complete — v7.94)".

---

## Built since Phase 2

### Daily Huddle viewer ✓ (v5.53–v6.95)

The daily Huddle PDF arrives by email and appears automatically in the `📋 Huddle` button in index.html.

- ✅ Manual upload via admin.html (Phase 1, v5.53)
- ✅ Automated upload via Power Automate → Cloud Function `ingestHuddle` (Phase 2, v5.66)
- ✅ Both PDF and DOCX file types supported (v6.95)
- ✅ Push notifications when a new Huddle arrives (v6.11, v6.61)

**Not needed:** A Huddle history viewer was previously listed here as still to build. The Huddle is a daily operational briefing — its value is knowing your duties on the day in question. Historical browsing is not a real use case for staff.

### Weekly Roster Upload ✓ (v5.77–v5.91)

Admin uploads the weekly PDF roster. Cloud Function `parseRosterPDF` passes the PDF to Claude AI, which reads the table and extracts each person's shifts. The app then shows a per-person review UI and saves only the approved changes.

**Key design decisions:**
- Direct PDF input to Claude rather than text extraction — pdf-parse destroys the table column structure; Claude reads the visual layout correctly
- `RDW|HH:MM-HH:MM` internal encoding — preserves the RDW flag through the review pipeline so RDW is identified correctly even on SPARE weeks
- `source: 'roster_import'` on saved overrides — distinguishes auto-applied from hand-entered; previous imports are always replaced cleanly by a new upload

See CLAUDE.md → "Weekly Roster Upload" for the full API and review pipeline.

### Payday calculator ✓ (v6.50–v7.07)

Staff enter their hours; the calculator computes estimated tax, NI, pension, and take-home pay per pay period. Lives at `paycalc.html` / `paycalc-app.js` (UI coordinator), fully integrated into the main app.

**Key design decisions:**
- One service worker rather than per-page SWs — two SWs sharing the same scope competed and wiped each other's caches
- A separate `pay-manifest.json` was used initially so the calculator could install with its own name ("MYB Pay"); since consolidated into the single `manifest.json` (the file no longer exists — PWA long-press shortcuts now cover Calendar/Pay/Admin)
- Roster-aware fill bar (v7.07) — pre-fills Saturday/Sunday/BH counts from the base roster in one tap; works offline

The calculator is **not** a payslip replacement — estimates only. Actual payslips may differ.

### Huddle push notifications ✓ (v6.11)

Web Push notifications via Firebase Cloud Functions. When a new Huddle arrives, every subscribed device gets a push. Staff subscribe via the toggle in admin.html. VAPID keys live in Firebase Secret Manager.

**iOS note:** Requires Safari and the app installed to the Home Screen. Android Chrome works via the browser.

**iOS notification delivery confirmed (v10.04):** Staff on iOS are receiving Huddle push notifications reliably in real daily use. Native app is not required for this reason.

### Huddle viewer improvements ✓ (v8.97)

Two reliability fixes for the daily Huddle button:

- **Removed Google Docs Viewer iframe** — PDFs now open directly via `window.open(storageUrl)`. Android Chrome's built-in PDF viewer handles it natively, eliminating the 3-round-trip lag that made the old viewer feel slow.
- **Real-time listener** — replaced the one-time `getDocs` fetch at startup with an `onSnapshot` listener via `subscribeToLatestHuddle()` in `firebase-client.js`. The Huddle button now updates automatically when a new briefing arrives — staff no longer need to refresh the page.
- **Offline persistence** — `firebase-client.js` now initialises Firestore with `persistentLocalCache()`, which stores query results in IndexedDB. The Huddle button shows the cached briefing instantly on repeat visits before the network confirms.

### Pay calculator — roster pre-fill ✓ (v7.07, improved v8.93–v9.02)

The roster pre-fill bar reads the member's base roster and Firestore overrides, then suggests Saturday/Sunday/bank holiday/RDW/Boxing Day hours in one tap.

- **v8.93–v8.96**: Added per-category row UI (tap a row to fill just that category), confidence badges, day breakdown list.
- **v8.96**: Desktop layout breakpoint refined; Checking… badge removed (cleaner state display).
- **v9.02**: Reverted swap/ambig suggestion buckets — rest-day weekday overrides are ignored again (the categorisation was wrong more often than right). Simplified row labels and badge text for plain-English clarity.

### Team Week View ✓ (v8.22–v8.40)

All logged-in staff can view the whole team's shifts for any week directly from the calendar page. Tap **👥 Team** to switch from the personal monthly calendar to a week grid — one row per person, one column per day (Sun–Sat, following the Chiltern working week convention).

- CEA, CES, and Dispatcher rosters are tab-selectable
- Firestore overrides are fetched and overlaid on the base roster in real time
- The 📋 Huddle button appears in the header so staff can open the day's briefing without leaving the view
- Week navigation: Prev / Next buttons; the Today button snaps back to the current week
- Shift cells are colour-coded identically to the personal calendar (☀️ early / 🌙 late / 🌃 night / 🏠 RD / 🏖️ AL / 💼 RDW etc.)
- Print-ready — the table prints cleanly on A4 landscape

**Key design decisions:**
- Sun–Sat week via `getSunday(date)` (Chiltern convention — not Mon–Sun)
- `fetchToken` pattern: rapid week navigation cancels stale Firestore results so the UI never shows data for the wrong week
- Grade-tabs row uses CSS grid (`1fr auto 1fr`) to keep the tab group centred regardless of how many utility buttons sit on the right
- Admin-only gate removed at v8.40 — the feature was admin-only (v8.22–v8.39) during development; all staff can now access it

### Navigation overhaul ✓ (v10.57–v10.71)

A shared slide-out nav panel (`nav-panel.js`) replaced the ad-hoc per-page navigation controls —
started on index/admin/paycalc, extended to operations (v10.99), settings (v11.06), and links
(v12.07); all six app pages now have it. Key shipped pieces:
- `NAV_PAGES` page-switcher pills + `NAV_INFORMATION` (Huddle/Circular/Newsletter) + Guides section.
- Sign-out button and notification 🔔/🔕 bell moved to the drawer footer (`onSignOut` callback per
  page; push logic stays in `notif.js`).
- Header back buttons removed from admin/paycalc (duplicate paradigm) → return via the Calendar pill;
  headers switched to `1fr auto 1fr` grid for true-centred branding.
- Hardening: double-init guard, Tab focus trap, coming-soon lightbox focus restoration.
- **Huddle notification-tap PDF fix (v10.71):** a tap carries no user activation, so `window.open`
  was pop-up-blocked and `location.href` broke standalone mode. `_triggerAutoOpen()` renders an
  in-overlay "📄 Open Huddle" button; the tap IS a real gesture → opens as a Custom Tab over the
  intact PWA. (Full rationale: OPERATIONS_REFERENCE.md → "Huddle notification tap behaviour".)

(The v10.64–v10.67 nationality-flags feature was **removed at v12.22** — the footer now shows an
initials avatar; there is no `flags` field on `teamMembers` today. See "Profile photo / avatar".)

**Key design outcome:** the nav panel removed the need for a bottom navigation bar (see "UX
experiments"). Cross-page navigation is clean without occupying fixed screen space.

---

### Security hardening (v10.72–v10.74)

Progress on the four v11 security tasks. Authoritative current status and the re-introduction checklist live in **KNOWN_LIMITATIONS.md → "The four v11 security tasks"**.

- **v10.72 — Firestore member write isolation ⚠️ later suspended (v10.94):** `firestore.rules` was updated so each staff member could only write overrides for themselves (`memberName == request.auth.token.name`), with an admin claim bypass for G. Miller. This was **reverted at v10.94** after it caused a production outage (rules went back to `request.auth != null` with field validation retained). Per-member isolation was later **rebuilt as the three-tier permissive rule (B2, v14.53)** and then **made strict (B3, shipped v16.29)** — overrides create/update/delete now require `token.name == memberName || token.admin || token.manager`, with the legacy no-name escape removed. See KNOWN_LIMITATIONS.md task #2 for the full post-mortem and re-introduction history.

- **v10.73 — Back pay variable pay included in HPP:** G. Miller's period 32 payslip confirmed Chiltern itemises back pay per category with explicit `(Back Pay)` suffix lines. `calcBackPay()` now computes `_bpVarAmount` (overtime, RDW, Sunday, BH, London Allowance uplifts in the rate-difference period). `calcHPP()` adds `_bpVarAmount` to `totalVar` for the paid-in period — HPP estimate is now correct after a back pay event.

- **v10.74 — Code quality fixes:** `.gitignore` added (example payslips, node_modules, .env files). `nav-panel.js` `_closeComingSoon()` given a `transitionend` fallback timer (400 ms) to prevent body scroll staying locked on iOS or under `prefers-reduced-motion`. `paycalc.html` static `rosterHintText` aligned with the JS-set wording. `OPERATIONS_REFERENCE.md` stale `ROSTER_SECRET` reference removed.

- **GCP API key restriction (manual, May 2026):** Firebase web API key restricted to `myb-roster.firebaseapp.com/*` and `myb-roster.web.app/*` HTTP referrers in GCP Console. Verified correct via curl tests.

### Railcard reference guide ✓ (v10.30–v10.48)

`railcard-guide.html` — a standalone at-work reference sheet for staff checking and selling railcard-discounted tickets at the gateline. Linked from the nav panel (Guides section, via `NAV_GUIDES` in `nav-panel.js`) — the old admin.html link was dropped in the v10.57–v10.71 nav overhaul. JS in `railcard-guide.js` (print + chip-bar nav); static page, served by the SW like every other page (SWR since v16.10).

Built over v10.30–v10.48: from an initial guide to a quick-glance at-work sheet (colour-coded
morning-rule stripe, weekend/BH banner), then a research-backed accuracy overhaul against official
2026 sources (Network area, Gold Card, Senior/Family & Friends peak rules, GroupSave, season-ticket
exceptions, the July/August minimum-fare waiver list). Card-by-card factual detail lives in
`.claude/rules/guide-pages.md`.

**Key design decisions:**
- Each card is self-contained — its exact time rule lives in its own **When** row so staff never have to cross-reference a key
- Accuracy verified per card against the relevant official railcard site (nationalrail.co.uk and the individual card sites), re-checked May 2026
- Static HTML, no module — kept deliberately simple as a low-frequency reference page

### Cross-page / navy-chrome / typography consistency passes ✓ (v11.64–v11.88)

A series of completed CSS-only polish passes making the calendar + 4 sub-pages read as one family
(no behaviour change; the actual token rules live in `.claude/rules/css-tokens.md`):
- **Comprehensive UI audit (v11.64):** motion tokens + `scale(var(--press-scale))` applied
  throughout (so the reduced-motion override works); `:focus-visible` gold rings on all inputs;
  44×44 touch targets on guide buttons; hardcoded hex → design tokens.
- **Navy header — unified chrome (v11.69):** the white card header (background/shadow/radius)
  replaced by transparent navy chrome on all pages so the header flows from the OS status bar and
  matches the navy canvas/drawer; burger + h1 flipped white; admin badge → raised gold chip; print
  resets force white bg + navy ink (navy would print as solid ink otherwise).
- **Cross-page consistency (v11.70–v11.88):** optically-centred header title (decoupled from badge
  width); standardised card padding/gaps; typography settled on the `--type-*` scale (inputs stay
  ≥16px to block iOS focus-zoom); shared components extracted to `shared.css`; SW offline fallback
  extended to operations/settings; stale code comments cleaned across 10 files.

### Huddle DOCX flow rework ✓ (v11.66)

Power Automate flow redesigned: old flow used a noon time-of-day condition (before noon = DOCX branch, after noon = PDF branch), meaning afternoon emails always sent PDF even when DOCX was attached. New flow is DOCX-first: filter attachments for DOCX MIME type → if found send DOCX to `ingestHuddle`; else filter for PDF → if found send PDF. No time condition at all.

Viewer code hardened to match: `calendar-huddle-viewer.js` now uses simple `if (htmlContent) render inline; else show "📄 Open Huddle" button` — eliminating a silent DOCX failure in `_triggerAutoOpen` and an incorrect error message in the manual click handler. The auto-open notification path and manual-click path are now logically identical in their branching.

---

### Pay reminder infrastructure fix ✓ (v11.65)

`sendPayReminderNotification` (scheduled daily 08:00 London) had never fired — its Cloud Scheduler
job was never created. Two root causes, both fixed: the deploy service account lacked
`roles/cloudscheduler.admin` (Firebase silently failed to create the job every deploy); and a stale
`us-central1` deployment record (from before the region was pinned to `europe-west2`) blocked deploys
with a 404 on cleanup. Schedule also hardened to Unix cron (`0 8 * * *`). First live test **27 June
2026** (cutoff for the 3 Jul payday).

### CSS extraction and infrastructure hardening ✓ (v12.01–v12.05)

No end-user-visible behaviour change: all page + guide CSS extracted from inline `<style>` into
external files; DOMPurify self-hosted (`./purify.es.mjs` v3.4.8, CDN import removed); security headers
added to `firebase.json` (HSTS, COOP, expanded Permissions-Policy); `normaliseSurname()` shared from
`firebase-client.js`; ESLint + Firebase-SDK-version checks added to the pre-commit hook.
- **v12.05 decision:** the v12.04 requirement for anonymous Firebase Auth on calendar `overrides`
  reads was **reverted** — more complexity than value (anyone can mint an anonymous token as easily
  as the app). Left open; trade-offs in KNOWN_LIMITATIONS.md + commented in `firestore.rules`.

### Links design workspace ✓ (v12.06–v12.47)

A 28-line rotating link design tool for Marylebone station. Accessible only to `CONFIG.LINKS_DESIGNERS` (currently G. Miller and S. Silva, added v12.33). Flagged beta — a working sketch for agreeing the pattern before the final link is built.

**What was built (v12.06–v12.47):** initial grid + Firestore load/save and nav integration (v12.06–07);
beta marker + first-visit notice (v12.33); print layout + sticky headers + concurrency guard (v12.37);
the v12.39 full redesign (patterns-only "Line 1–28", paint-mode brush bar, Design Checks card,
`links-design.js` pure-maths module); slot-based generator + hourly coverage heat map (v12.40);
removal of the vacant-lines (v12.41) and fixed-line (v12.42) models so all 28 lines are normal
rotating rows; generator-only creation (v12.43); and multi-design + ⇔ compare (v12.46–47, with the
`<div>`-wrapped picker chips — nested `<button>`s are force-closed by the parser). Full current
architecture: `.claude/rules/links-design.md`.

**Key design decisions:**
- **Patterns-only documents** — removing staff names decoupled the pattern-design decision from the assignment decision. Each design document stores `{ name, patterns, updatedAt, updatedBy }` only (multi-design collection since v12.46; the legacy `linkDesigns/combined-28` singleton is auto-migrated on first load and then ignored); legacy `meta` from older saves is silently dropped on next write.
- **Slot-based generator over early/late binary** — the station is staffed in waves (opens ~06:20, morning build 07:00–08:30, middles 11:00–12:00, afternoons 13:30–14:30, closes 15:00+) with ~25 distinct shift times and genuinely different Saturday and Sunday patterns. A two-bucket binary cannot represent this shape.
- **Hourly heat map over per-type bar chart** — the bar chart aggregated by shift class and hid whether the waves overlapped or left gaps mid-day. The heat map shows the actual on-duty headcount shape of the day.
- **Pure-maths module** — all design maths in `links-design.js` (no DOM, no Firebase): `classifyShift`, `normaliseCustomShift`, `calcCoverage`, `calcHourlyCoverage`, `generatePatterns`, `runDesignChecks`, `dayClass`. Tested independently of the app.
- **Night shifts not applicable (confirmed June 2026)** — CEAs do not work night shifts. `normaliseCustomShift()` rejects starts between 21:00–03:59; the Night option was never exposed.

---

### E2E smoke tests ✓ (added v12.65 → removed v12.75 → restored v13.95)

**RESTORED v13.95.** The sole blocker — "the Playwright Chromium binary cannot be
downloaded in the dev environment" — no longer holds: the Claude Code on the web
environment ships Chromium pre-installed at `/opt/pw-browsers` (revision 1194 =
141.0.7390.37), matched by pinning `@playwright/test` to `1.56.1`. The suite now runs
locally before every push (the missing iteration loop), and CI installs its own
Chromium via `npx playwright install --with-deps chromium`. The restored suite is nine
page-load tests (the original eight, with the settings tips regression guard split into
its own signed-in test). It keeps the CDN-stub fixture unchanged; two stale tests were updated (paycalc now has a
session guard → seed a session; the settings signed-in test's faith-radio anchor was
removed with the cultural calendar at v13.23 → now anchors on the Work Email card's
`aria-expanded`). Wired into `e2e.yml` (branches/PRs) and `deploy-hosting.yml` (Firebase Hosting gate).
(A `deploy-pages.yml` E2E gate also existed v13.96–v14.25 for a cross-repo staff site; that workflow was
removed as redundant — the staff site is served by the roster-app repo's own native Pages from `main`.) Residual
caveats: (1) the local browser is environment-specific — iterating on the suite outside the
web container needs a system Chromium; (2) the local http-server does not apply Firebase
Hosting's CSP headers, so CSP violations are not caught — use `firebase emulators:start
--only hosting` for that.

The original history is kept below for context.

**Why they were needed in the first place:** Every app page statically imports
`./firebase-client.js`, which in turn statically imports the Firebase SDK from
`https://www.gstatic.com/firebasejs/…`. In ES modules a static import that fails to
resolve aborts the *entire* module graph — if that CDN is slow, throttled, or blocked on
a CI runner, none of the app's JavaScript ever runs. The calendar never renders, dropdowns
stay empty, auth redirects never fire, and every assertion times out. No timeout increase
or retry count can fix a hard dependency failure — which is why earlier timeout/retry
tweaks in the CI config never stuck.

The solution was a Playwright fixture (`e2e/fixtures.js`) that intercepted
`https://www.gstatic.com/firebasejs/**` at the network layer and served tiny local no-op
stubs for every symbol `firebase-client.js` imports. With the CDN dependency removed,
the app's JS executed locally and the tests verified our own code rather than Firebase's
availability. Eight smoke tests verified: calendar renders + member dropdown + nav drawer
(3 tests), admin login overlay, paycalc period selector, settings login overlay (including
a regression guard for the `initTipsLightbox` wiring), operations auth redirect, and links
auth redirect.

(The suite was removed v12.75–v13.94 when the Chromium binary couldn't be downloaded in the dev
environment — tests could be listed but not run, so fixes were push-and-pray. Now moot: the
pre-installed browser closed that gap. Full removed/restored history: KNOWN_LIMITATIONS.md →
"E2E smoke tests".)

**Whatever E2E tool is ever chosen, keep the Firebase CDN-stub approach** (`e2e/fixtures.js`):
intercepting the CDN at the network layer before any page load is the right way to decouple
page-load correctness from Firebase availability — any tool with request interception can do it.

---

### Cultural calendar overlay ✗ (v11.06–v13.22 → removed v13.23)

**Removed at v13.23.** A per-staff optional setting that overlaid cultural or religious date markers as small emoji icons on matching days in the calendar. Staff selected one calendar from: Islamic, Hindu, Chinese lunisolar, Jamaican, Congolese, or Portuguese. Chosen calendar stored in `memberSettings` Firestore collection as a `faithCalendar` field. The Settings page had a radio-group card; selected icons appeared in the bottom-right corner of matching calendar day cells (`.day-faith`); the legend gained a full cultural row.

**Why removed:**
- **Annual maintenance burden** — 15 lunar/lunisolar datasets (Islamic, Hindu, Chinese) needed manually updating each November/December from external sources. Jamaican, Congolese, and Portuguese were rule-based but the Islamic/Hindu/Chinese sets were hardcoded year-by-year arrays.
- **GDPR exposure** — `faithCalendar` is a religious preference, which is special-category personal data under UK GDPR Article 9. No right-to-erasure flow was ever implemented. Low practical risk on a closed team app, but a real compliance liability.
- **Low observed usage** — no staff had asked for it or were known to use it. Staff have dedicated calendar apps that do this better.

**What it looked like:**
- `roster-data.js`: ~300 lines of date datasets + `resolveFaithCalendar()` / `getFaithBadge()` lookup functions
- `calendar-app.js`: read `memberSettings` from Firestore on calendar render; injected `.day-faith` spans into day cells; rendered a full legend row
- `settings-app.js` + `settings.html`: radio-group card with disclaimer text
- `shared.css`: ~75 lines of `.faith-radio-*` / `.religious-*` / `.calendar-active-tag` styles
- `firestore.rules`: `memberSettings` collection with per-member write isolation

**To bring back:**
1. Restore the dataset `const`s and lookup functions in `roster-data.js` (Islamic, Hindu, Chinese needed for current year; Jamaican/Congolese/Portuguese are rule-based)
2. Re-add the `memberSettings` Firestore collection rules (`faithCalendar` field, owner-only write)
3. Re-add the `initCulturalCalendarCard()` function to `settings-app.js` and the radio-group HTML to `settings.html`
4. Re-add `.day-faith` rendering in `calendar-app.js` calendar render loop and legend
5. Re-add shared CSS in `shared.css`
6. Implement a proper right-to-erasure path for the stored `faithCalendar` before re-deploying (e.g. a "Remove cultural calendar data" button in Settings)
7. Consider whether annual update maintenance can be automated (e.g. a Cloud Function that fetches dates from a public Islamic calendar API rather than hardcoded arrays)

---

### Profile photo / avatar ✗ (v12.12–v12.21 → removed v12.22) — full spec preserved for future restoration

**Removed at v12.22.** Feature was present from v12.12 (photo upload, display) through v12.21 (interactive reposition editor v12.19). Removed because it was non-vital and the interactive canvas editor was disproportionate complexity for a 26px badge. The nav-panel footer now shows initials on a stable per-name colour instead (`avatarInitials`/`avatarHue` from `roster-data.js`, painted directly in `nav-panel.js`). Firebase data cleanup required: delete `memberAvatars` collection docs and `avatars/` Storage objects via Firebase Console (no Admin SDK in client-side code).

**To restore:** see "Restoration path" section below.

A member's optional profile photo — a circular badge in the nav-drawer footer (and the photo in the About panel), with an initials-on-colour fallback when no photo is set. Added v12.12; the **interactive reposition editor** (drag/pinch/zoom to frame the shot on a `<canvas>`) followed at v12.19.

**Status: explicitly non-vital.** It is a "nice to have" — staff's names become a photo in a menu. A decision may be taken later to remove it, or to simplify it back to what we had before the editor. This entry records that decision space and the exact revert path so it can be done cleanly.

**Honest assessment (deep review, v12.20):**
- The **display + storage + cross-device-sync layer is good, well-factored code** worth keeping regardless — the shared painter (`avatar.js`), the Storage-object + Firestore-pointer model (`firebase-client.js`), and the 3-layer sync (cache → Firestore refresh → live events).
- The **interactive editor is gold-plated for a non-vital feature.** It is ~350 of the feature's ~700 JS lines — canvas crop geometry, a Pointer-Events pinch/pan state machine, dpr-aware rendering, and a `ResizeObserver` refit. It is the highest-risk, hardest-to-maintain, untested part of the whole app, protecting a badge that renders at **26px**. At that size an off-centre face is invisible, so the precise reframing it buys is largely wasted, and it is the one chunk the owner cannot realistically debug unaided.

_(The "simplify instead of remove" options are moot — the feature was fully removed at v12.22. The full-revert checklist below is the live record for a clean restoration.)_

**Full-revert checklist (back to no avatar feature at all):**
- **Delete files:** `avatar.js`, `settings-avatar.js`.
- **`firebase-client.js`:** delete the "Profile Avatars" block (`avatarStoragePath`, `uploadAvatar`, `deleteAvatar`, `fetchAvatarUrl`). Keep `_getStorageSdk` — shared with `uploadHuddle`.
- **`roster-data.js`:** delete `avatarInitials` + `avatarHue`.
- **`nav-panel.js`:** remove the avatar import line, `_avatarSettled` / `_avatarLiveBound` flags, `_paintLbAvatar`, the live-update listener block, and the avatar paint block; **restore the footer `👤` glyph** in place of `<span id="navPanelAvatar">` (the span replaced that glyph).
- **`settings-app.js`:** remove the `initAvatarCard` import + call (and its `initCardCollapse('profileToggleHeader'…)`).
- **`settings.html`:** remove the whole Profile card.
- **All 6 HTML pages:** remove the `<div id="lightboxAvatar" class="lightbox-avatar-badge">` line from each About lightbox (keep `<img id="lightboxAppIcon">`).
- **CSS:** `settings.css` Profile + editor block; `shared.css` `.lightbox-avatar-badge` and `.nav-panel-avatar` rules.
- **`service-worker.js`:** remove `avatar.js` + `settings-avatar.js` from both asset lists; **bump APP_VERSION** (else `sw-asset-check.test.mjs` fails).
- **Rules:** remove `match /avatars/{fileName}` (`storage.rules`) and `match /memberAvatars/{memberName}` (`firestore.rules`); needs a rules deploy to take effect.
- **Docs:** remove the `avatar.js` / `settings-avatar.js` rows and the "Profile photo / avatar" decision row + `memberAvatars` block from `CLAUDE.md`; the `settings-avatar.js` entry from `AI_MAP.md`; this ROADMAP entry. The pre-commit hook enforces CLAUDE.md + AI_MAP updates on module deletion.
- **Leftover data (not code):** existing `avatars/*.jpg` Storage objects and `memberAvatars/*` docs become orphaned (harmless; purge manually if desired).

**Footprint:** ~865 lines total (~700 JS), spread as: `settings-avatar.js` 504 · `firebase-client.js` ~86 · `avatar.js` 51 · `settings.css` ~108 · `nav-panel.js` ~60 · `shared.css` ~52 · `settings.html` ~42 · `roster-data.js` ~20 · rules ~38 · misc (6 HTML lines, SW, settings-app) ~14.

---

## UX experiments — explored but held back

Ideas that were prototyped and reverted. Implementation notes preserved here so they can be restored quickly if the case for them changes.

### Bottom navigation bar
**Status:** Prototyped at v7.66, reverted — felt like clutter at current scale. Case reassessed v10.01 — not needed, navigation is complete without it. Navigation overhaul (v10.57–v10.71) added a slide-out nav panel that covers cross-page navigation, guide links, sign-out, and notifications — this need is now fully met. **Do not revisit.**

A fixed tab bar at the bottom of the screen on mobile with three items:
📅 Roster · 💷 Pay · 🔐 Admin

The active tab would be highlighted in gold; all three pages would share the same bar via shared.css.

**Why it was held back:**
Cross-page navigation is already complete without a universal nav bar:
- The calendar controls row has dedicated **Pay** and **Admin** buttons
- Both the pay calculator and admin pages have a **back button** that returns to the calendar
- PWA long-press shortcuts cover Calendar / Pay / Admin for installed users

Adding a persistent nav bar introduces two layout problems with no navigational payoff:
1. **Calendar screen real estate** — a fixed bottom bar on mobile takes ~50px from the calendar grid, which is the primary content staff use every day
2. **Sticky pay total conflict** — the pay calculator already has a fixed bar at the bottom showing the take-home total. Two competing fixed bars at the bottom of the same page is poor UX

**When to revisit:**
- If the controls row is simplified and loses the dedicated Pay/Admin buttons
- If a new page is added that doesn't fit the current hub-and-spoke pattern
- If the sticky pay total bar is removed or redesigned

**Note:** Team Week View (v8.22) is an in-page view within the calendar — it does not replace cross-page navigation between Calendar / Pay / Admin.

_(Implementation-notes restore-kit dropped — this is a "do not revisit" idea; recover from git history if the case ever changes.)_

### Glanceable summary strip
**Status:** Prototyped at v7.66, reverted — adds clutter above the calendar

A horizontal scrolling row of four white pill chips below the controls, shown only when logged in:

| Chip | Source | Notes |
|------|--------|-------|
| **Today** | Base roster + override cache | Offline-first; shows type or start time |
| **Next RD** | Base roster scan (90 days) | Override cache applied where available |
| **Leave left** | Firestore (async) | Shows "…" until loaded; fires once per member |
| **Payday** | `getPaydaysAndCutoffs()` | Offline; shows date + days remaining |

**Why it was held back:**
On a phone the calendar itself is the primary information — the strip adds a layer of noise between the controls and the calendar grid. The same information is already reachable (AL via the 🏖️ AL button; payday from the pay period strip; today's shift from the calendar cell itself).

**When to revisit:**
- If staff on longer shifts want a "what am I doing today?" glance without scrolling to find today's cell
- If the pay period strip is removed (the strip was partly redundant with it)
- Consider putting it *inside* the controls card as a collapsed/expandable panel rather than between controls and calendar

**Implementation notes (already written, can be restored):**
- HTML: four `<div class="sc">` chips in `<div id="summaryStrip">` after `#payPeriodStrip`
- CSS: `.summary-strip` (flex, overflow-x: auto), `.sc`, `.sc-label`, `.sc-val`
- JS: `updateSummaryStrip()` in calendar-app.js — called from `renderCalendar()`
- The AL query is de-duplicated via `_summaryALFetched` flag, reset in `clearMemberCaches()`
- All data sources are already imported — no new dependencies needed

### Full-bleed navy header (calendar page)
**✓ Shipped at v11.69** — see the "Navy header — unified chrome" bullet under "Cross-page / navy-chrome / typography consistency passes" above. Implemented as transparent/canvas chrome (not negative-margin full-bleed), unified across all 5 pages; the icon-on-navy blocker was resolved by the icon processing in the same session. (No longer a held-back experiment; the earlier full-bleed CSS restore-kit was dropped as dead once this shipped.)

### Calendar cell type hierarchy
**Status:** Built at v11.57, reverted — needs more consideration before shipping.

The calendar day cell has two competing elements: the `.day-number` (date) and the `.shift-badge` (shift type). At v11.57 the hierarchy was inverted so the shift badge reads as primary — the date quieter and supporting — on the theory that on any given day the shift type is what staff actually need to identify at a glance.

**What was built (v11.57):**
- `.day-number`: `font-size: 20px; font-weight: 700; color: var(--text-dark)` → `font-size: 14px; font-weight: 500; color: var(--text-mid)` — quieter, supporting role
- `.calendar-day:active .shift-badge`: `transform: scale(0.94)` → `transform: scale(var(--press-scale))` — wired to the unified press token so the reduced-motion override works correctly

**Why it was held back:**
- Needs broader review before committing — the date is also important context (particularly for spotting upcoming RDs and AL days across the month at a glance), and shrinking it significantly changes how the grid reads at the month level.
- The press-scale fix is a safe, independent change and could be shipped on its own.

**When to revisit:**
- Review the calendar grid in real daily use with both sizes side by side — compare scanning for a specific date vs identifying shift patterns across a week.
- If revisting: consider whether a middle position (e.g. 16px/600) is a better balance than the full step down to 14px/500.

**Implementation notes:** shrink `.day-number` to 14px/500/`--text-mid`. The independent press-scale
fix (`scale(0.94)` → `scale(var(--press-scale))`) is a clean no-visual-change tidy that lets the
`prefers-reduced-motion` override suppress the badge press too — shippable on its own. (Full CSS in
git if revisited.)

---

## Design audit — April 2026

Design review against a 10-point modernisation list. Already well-implemented: shadows (minimal, 10% opacity), 5-tier type scale (`--type-micro` → `--type-large`), motion tokens, WCAG AA colour contrast across all shift types, touch targets, safe-area padding, and reduced-motion support. Navigation was the one real gap — addressed by the nav panel overhaul (v10.57). **Shipped from this audit:** Pay result hierarchy (v7.67) — period line and hint text brightened from 72%/48% to 88%/62% opacity.

### Design — low-risk visual wins (planned June 2026) — ✅ COMPLETE (audited v16.30)

A short batch of **no/low-risk, additive-CSS** polish items. Reviewed v16.30: most were already
shipped incrementally; the batch is now closed. Higher-effort/higher-risk ideas (View Transitions on
the swipe carousel, `:has()` state refactors, container queries, an SVG icon set, dark mode) remain
deliberately **excluded** — tracked under Future capabilities / UX experiments.

1. **Tabular numerals on data** — ✅ **DONE** (shipped incrementally; verified v16.29).
   `font-variant-numeric: tabular-nums` is live on every intended surface: all Pay Calculator
   figures (`.net-amount`, `.sum-row .val`, `.b-val`, `.bp-val`, `.hpp-amount`, `.sticky-amount` in
   `paycalc.css`), calendar shift times (`index.css`, v14.54), and admin AL/date counts (`admin.css`).
2. **`text-wrap: balance` on headings, `text-wrap: pretty` on paragraphs** — ✅ **DONE.** Live on all
   6 app pages via `shared.css` (`:where(h1..h6){balance}` / `p{pretty}`), and extended to the four
   guide pages via `guide-shell.css` (v16.30 — they don't import `shared.css`).
3. **Display-heading typography** — ✅ **DONE / N-A.** Every genuinely-large heading already carries
   display-appropriate negative tracking (`.app-header h1` −0.3px, `.month-year` −0.5px, `.net-amount`
   −2px). The proposed fluid `clamp()` on `--type-xl` was **dropped**: that token is used in exactly one
   place (an operations heading), so a clamp buys nothing and would only add a shared-token risk.
4. **Motion completeness audit** — ✅ **DONE.** All six keyframe animations (`todayPulse`, `sync-pulse`,
   `shimmer`, `pulse-confirm`, `spin`, `beta-sheen`) already sit behind `prefers-reduced-motion`
   guards, plus the shared press-scale override. The optional global `scroll-behavior: smooth` was
   **skipped** (optional; changes scroll feel app-wide for marginal benefit).
5. **Focus-visible / tap-target audit** — ✅ **DONE (audit-led).** Focus: fully covered — a
   zero-specificity safety net in `shared.css` rings every button/link/`[role=button]`, on top of ~60
   explicit `:focus-visible` rules; guides carry their own. Tap targets: every primary and
   mobile-facing control meets the 44px minimum (explicit `min-height/width:44px` on lightbox close,
   burger, week-nav, range-picker, type-pills, help, guide buttons). The only sub-44px controls are
   niche **desktop-admin/designer** controls — the ✎/✕ chip buttons (`links.css`, 2 designers) and the
   `.roster-tick` (`operations.css`, admin) — where a proper 44px fix needs spacing/resizing (the ✎/✕
   sit adjacent, so equal 44px hit areas would overlap). That's a layout change this batch explicitly
   excludes, so they are **left as-is by design** (mouse-driven admin surfaces, not mobile thumbs).

---

## First-run onboarding usability (from the UX + v15.07 reviews) — SHIPPED v15.10–v15.12

Small, high-value first-use fixes for a brand-new, non-technical staff member. All copy /
first-run-state changes — no data-model or auth change.

1. **First-run "choose your name" state (H1) — ✓ SHIPPED v15.11.** A fresh visitor (no saved member
   AND no session) previously saw the default member's roster with no cue it wasn't theirs. Now
   `isFirstRun()` (calendar-member.js) drives a "👋 Choose your name to see your shifts" prompt —
   guarded at the top of `renderCalendar()` so every render path (init, initial-fetch re-render, swipe)
   respects it; the dropdown leads with a "— Choose your name —" placeholder. Picking a name renders
   normally and is one-time. Distinct from the stale-member banner path.
2. **Sign-in password helper (H2) — ✓ SHIPPED v15.10.** A helper line under the login password field
   ("Initial password: your surname in lowercase, no spaces."), wired via `aria-describedby`. Shared
   overlay → all 5 protected pages. Not a secret (protection is rate-limiting + rules).
3. **Pay Calculator first-use reframe (M3) — ✓ SHIPPED v15.12 (copy refined v15.14).** The setup
   banner was reworded from "Enter your…" to "👋 Estimate your take-home — we've filled in the usual
   defaults; check your hourly rate and tax code, then tap **Save settings**; you can add your hours
   with **Fill from calendar**" (JS-set + static). The v15.14 pass named **Save settings** as the step
   that actually dismisses the banner (it writes the settings key; Fill-from-calendar does not).

---

## Future capabilities — not committed, no fixed sequence

Each area is independent unless a dependency is noted.

### Dark mode (toggleable) — idea only, not scoped

**What:** A true dark theme. Especially relevant to *this* user base — staff work early/late/night
shifts and check the roster at 04:30 in dim mess rooms, on platforms before dawn, or in bed the
night before. A dark theme is an ergonomic fit for the actual use context, not just a trend.

**Why it's tractable here:** the canvas is already brand navy (half-way conceptually), and the
palette is **oklch**, so a dark theme is mostly inverting the lightness channel of the surface
tokens and nudging a few accents — far easier than it would be with hex. The three-surface model
(canvas → card → sunken) maps cleanly onto dark (canvas darkest → card lighter → sunken between).

**Important — a toggle is essential, initially.** Do **not** ship dark mode as a silent
`prefers-color-scheme` switch on day one. Ship it behind an explicit **on/off (and ideally
on/off/auto) toggle** in Settings, defaulting to today's light theme, so staff opt in and nobody is
surprised by a changed app. Today the app forces `color-scheme: light` in `shared.css` — that opt-out
is what a dark theme would replace, gated behind the toggle.

**Effort/risk when scoped:** medium effort (every surface/text token needs a dark counterpart, AA
re-verified in both themes), low risk (additive, behind the toggle). Not scoped yet — this entry is
a placeholder so the idea isn't lost.

---

### Deferred: student-loan payslip integration tests

**What:** `computeSL` in `paycalc-calc.js` is tested via internal cross-checks but not against real payslip figures. `MILLER_ACTUALS` in `test-fixtures/miller-actuals.js` includes an `sl` field on each record, so the data exists to add per-period assertions like `assert.ok(Math.abs(computeSL(...) - MILLER_ACTUALS[n].sl) < 0.01)`.

**Blocked on:** Confirming which Student Loan plan is active. The payslip Settings page shows the selected plan; once confirmed, add `computeSL(gross, planCode)` assertions against the 13 real `sl` values in `MILLER_ACTUALS` (the 13 four-weekly periods of the 2025/26 tax year — printed P4–P52 on the payslip).

**When to do it:** In the same commit that confirms/changes the SL plan in `GRADES` or `MILLER_ACTUALS`. There is no point adding assertions before the plan code is known — they would either all be zero (no SL) or wrong.

---

### Deferred: mid-year pension step for 2025/26

**What:** The pay calculator models the pension contribution as two values — `pensionPre` £154.77 (before 8 May 2026) and `pension` £147.36 (from 8 May 2026) in `GRADES` (`paycalc-calc.js`). But G. Miller's **09/05/2025** payslip shows `Smart RPS CR Scheme` at **£160.78**, so the pension actually stepped **£160.78 → £154.77** at some point during the 2025/26 tax year that the app doesn't model. Historic pre-step 2025/26 periods therefore estimate pension ~£6 too low (take-home ~£6 too high). This is the pension counterpart to the mid-year *rate* step already modelled by `getRateForPeriod` (v15.95) and the London step (`londonAllowFrom`).

**Blocked on:** Finding **when the £160.78 → £154.77 pension change came in** — the exact payslip/date it dropped. One payslip (09/05/2025 = £160.78) isn't enough to locate the step; need a payslip from later in 2025/26 showing £154.77 and ideally the first one that changed. `MILLER_ACTUALS` stores net/tax/NI but **not** the pension line, so the date can't be read from the repo — it needs a payslip.

**When to do it:** Once the step date is known, model it exactly like the rate/London steps — add `pensionPre2/pensionFrom2` (or generalise to a small per-date pension table) so `getPensionForPeriod` returns £160.78 before the step, £154.77 between the step and 8 May 2026, and £147.36 after. Then a historic 2025/26 period matches the real payslip on pension too.

---

### Deferred: validate the back-pay accrual against the real 24 Oct 2025 payslip

**What:** Two assumptions in `calcBackPay` are payslip-checkable but unverified: (1) the accrual includes the **full April-paid period** (P4, paid 11 Apr 2025) even though its work window is mostly late March — if Chiltern pro-rates the award from literal 1 April, P4's row overstates slightly; (2) the per-bucket arithmetic (`_accrueBackPayPeriod`) should reproduce the real lump when the 2025/26 hours are entered. The 24 Oct 2025 payslip carries the actual back-pay lines (the basic-line spike was ~£591 vs a contracted-only estimate of ~£730 including London — the gap is explainable by variable-line placement, but unconfirmed).

**Blocked on:** Reading the 24 Oct 2025 payslip's back-pay line breakdown (Gareth has it).

**When to do it:** One-time check; if P4 turns out to be pro-rated, add a first-period factor to the accrual and a fixture-based test.

---

### Dispatcher pay calculator support
**What:** Add Dispatcher pay rates to the `GRADES` object in `paycalc-calc.js` so Dispatcher staff can use the pay calculator.

**Blocked on:** Confirmed Dispatcher pay rates from Chiltern payroll. Do not add placeholder rates — the calculator must be accurate or it misleads staff.

**Action needed:** Once Gareth has confirmed the Dispatcher hourly rate, contracted hours, and pension contribution, add a `dispatcher` entry to `GRADES` in `paycalc-calc.js` and update the grade-selection UI in `paycalc-app.js` to offer Dispatcher as an option.

---

### Operational visibility
**What:** Daily deployment view — who is working, spare, or on AL across the whole team for any given day. Useful for supervisors planning cover.

**Partially addressed:** Team Week View (v8.22) shows the whole team by week. A true daily view (single column for one date with a cover-status summary) would be a further step, but in practice the week view may be sufficient — supervisors can see the full week at a glance and identify gaps.

**Depends on:** Nothing new. All data already in Firestore.

**Worth doing if:** Supervisors find the week view insufficient for daily cover planning and want a more condensed single-day format.

### Approval workflows
**What:** Staff submit requests (shift swaps, overtime availability). Supervisor sees pending requests and approves or declines. Outcomes recorded in Firestore.

**Depends on:** Current auth model is sufficient for submitting requests. Supervisor UI needed.

**Decision point:** How much request volume is there? If the owner currently handles a small number of changes by direct conversation, formal workflows may add process without adding value.

### Notifications — approval/assignment events
**What:** Staff notified when a spare is assigned or a request is approved. Supervisor notified when requests arrive.

**Depends on:** Approval workflows (above). The Cloud Function infrastructure for push is already in place — extending it to cover other event types is a smaller lift now that the foundation exists.

### Notification badge — monochrome silhouette asset — ✅ DONE
**What:** A dedicated monochrome badge PNG (`icon-badge.png`, white-on-transparent, 96px) so Android
doesn't mask the full-colour app icon into a muddy blob in the status bar. **Shipped:** the asset
exists, is precached by the service worker (`service-worker.js` asset list), and the push handler
sets `badge: ${self.registration.scope}icon-badge.png` (not `icon-192.png`). CLAUDE.md lists it as an
asset and `.claude/rules/notifications.md` → "Icon, badge, tag" documents the rule (never use
`icon-192.png` as the badge). No further work.

### Formal AL management
**What:** Official AL request and approval workflow with entitlement tracking across the year.

**Depends on:** Approval workflows (above).

**Important caveat:** Chiltern Railways has an official HR system for leave management. Building a parallel approval process risks conflict between the two systems. This capability should remain clearly informational unless there is explicit agreement with management that the app's approval carries official weight.

### Calendar export — WebCal subscription
**What:** Staff subscribe to a URL; their phone calendar (Google Calendar, Apple Calendar,
Outlook) polls it automatically and shows shifts as events, kept up to date as overrides change.

**Why not a static .ics download:** A one-off file export becomes stale the moment any
override is recorded. Re-importing creates duplicate events in most calendar apps. A static
export of the base cycle only avoids this but omits the things most worth having (RDW, AL,
swaps). The static route was considered and rejected.

**The right approach — dynamic WebCal endpoint (Cloud Function):**
A Cloud Function returns a fresh .ics built from base roster + current Firestore overrides
for a given member on every request. Calendar apps poll automatically (typically every 24
hours). New override types appear without any change to the subscription. The URL would be
member-specific with a short-lived or HMAC-signed token to prevent one member reading another's calendar.

**Effort:** ~1 day. Cloud Function to generate .ics, token generation in admin.html,
subscribe button/URL display for staff.

**Build when:** At least a few staff ask for it. The existing roster and override data is
already the right shape — no data model changes needed.

### Native app (conditional)
**Only pursue if one of these is true:**
- iOS push notification delivery is unacceptably unreliable in real use
- Chiltern IT require app store distribution via MDM
- PWA limitations are genuinely felt by users

**If pursued:** React Native. Same JavaScript language, Firebase carries over, only the UI layer needs rewriting. Requires Apple Developer account ($99/year) and Google Play ($25).

Do not build speculatively. The PWA works well for the current use case.

### Password security improvements — staged plan (Stage 1 shipped v12.68)

The current surname-based password provides minimal security — surnames are semi-public, the pattern is known, and there is no recovery path if a staff member's account is compromised. A five-stage plan to progressively harden this without disrupting the name-dropdown login UX. Each stage is independently shippable; later stages depend on earlier ones.

**Stage 1 — Work email registration ✓ (v12.68)**
Settings page → Work Email card. Staff enter their Chiltern work email. Saved to the new `staffContact` Firestore collection (owner-only write via `name` JWT claim; admin read-all). This is the data foundation all later stages build on. Work email only — no personal email (the company already holds the work address; no separate GDPR policy required for something Chiltern already processes).

**Stage 2 — Email verification**
Send a 6-digit time-limited code to the registered work email when the member taps "Verify" in the Work Email card. A Cloud Function (extend `setupRosterAuth` or add a new `verifyContactEmail` function) sends the email via Power Automate relay (already used for Huddle ingest) or Firebase Trigger Email, and marks `staffContact.verified = true` on correct code entry. **The client cannot set `verified` itself** — the flag must be server-set via Cloud Function to prevent self-verification without genuine email access.

*Decisions needed before building:* code expiry window (10 minutes is standard); retry/rate-limit policy; whether to allow email correction before verification (or require admin contact if the wrong address was saved).

**Stage 3 — Self-service password change (while logged in)**
A "Change password" section in the Work Email card in Settings, shown only to members with a verified email (Stage 2 complete). Member enters their current password + new password twice → `reauthenticateWithCredential` + `updatePassword` via Firebase Auth.

*Critical prerequisite — `ensureFirebaseSession` rework:* The current implementation assumes `password = normaliseSurname(name)` and silently falls back to an anonymous session on failure. A member who has set a custom password will have `ensureFirebaseSession` try the surname, fail, and land on an anonymous session — they will appear not logged in to Firestore writes even though their localStorage session is valid. **Before Stage 3 ships**, `ensureFirebaseSession` must be updated to detect this case: catch `auth/wrong-password` / `auth/invalid-credential` specifically and surface a "Please sign in again" prompt rather than silently falling back to anonymous.

*Ordering:* Stage 4 (reset path) should ship before or alongside Stage 3 so a member who forgets their custom password has a self-service recovery route and does not have to contact admin.

**Stage 4 — Forgotten-password reset (self-service)**
Recovery flow without admin involvement: a "Forgot password?" link on the login screen → member selects their name → Cloud Function looks up `staffContact.workEmail` where `verified == true` → sends a one-time 6-digit code → member enters the code + chooses a new password → Cloud Function calls `admin.auth().updateUser(uid, { password })` via Firebase Admin SDK.

Code expires after 10 minutes; 3 failed attempts invalidate it (member must request a new code). The reset endpoint must be a Cloud Function — client-side `sendPasswordResetEmail` sends to the synthetic Firebase Auth email (`name@myb-roster.firebaseapp.com`), not the member's real work address.

**Admin break-glass:** Operations page → Staff Login Accounts → reset any member's password to the surname default. Always available regardless of verification status. Use when a member cannot access their work email or is locked out during rollout.

**Stage 5 — Retire the surname password**
Once Stages 2–4 are live and staff have had adequate time to migrate:
1. Show a persistent Settings banner to any member still on the surname-derived password, prompting a change.
2. Remove the surname-password seed from `setupRosterAuth` new-starter setup — new starters receive a temporary code via work email instead.
3. Remove the surname fallback from `ensureFirebaseSession`.

*This stage is irreversible* — once the surname fallback is removed, staff without a custom password can only recover via Stage 4. Do not ship Stage 5 until ≥90% of active accounts have set a custom password (monitor via `staffContact.verified` count vs active `teamMembers` in Firestore Console).

---

**Shared architecture notes (Stage 2 onward):**
- `staffContact` writes require the `name` JWT claim set by `setupRosterAuth`. Anonymous fallback sessions lack this claim — the Settings UI already shows a `permission-denied` error prompting sign-out and back in. This is intentional.
- All sensitive operations (send code, verify code, update password) must go through Cloud Functions with the Firebase Admin SDK. Never trust the client to set security-relevant fields (`verified`, `password`).
- Stages 3–5 require end-to-end testing on Android Chrome (primary platform) and iOS Safari standalone before shipping.

---

## Dependency maintenance — firebase-admin v14

`firebase-admin@14` clears the 9 moderate transitive `uuid` advisories but is blocked until
`firebase-functions` widens its peer range to include v14 (practical risk low — the uuid bug isn't
reachable via Firebase's usage). **Watch** `npm outdated` in `functions/`; full detail + the
step-by-step upgrade checklist live in **KNOWN_LIMITATIONS.md**.

---

## Build tooling — Vite (not yet, but likely eventually)

**Current state:** No bundler or build step. Source files are served directly to the browser — what you write is what loads. GitHub Actions deploys the source tree as-is.

**Why this is a constraint:** `roster-data.js` is a browser ES module; `functions/index.js` is Node.js CommonJS. The two module systems cannot import from each other. This forces duplication of any data needed by both sides — most visibly `teamMembers` / `STAFF_NAMES` (currently duplicated between `roster-data.js` and the Cloud Function). A build step would allow a shared source file to be compiled into both targets.

**When the threshold is "probably worth it":**
- A second Cloud Function also needs roster data and the duplication becomes a real bug risk (e.g. a new staff member is added to `roster-data.js` but not the Cloud Function)
- TypeScript adoption is desired (meaningfully improves safety across the larger files)
- Bundle size starts affecting load time on staff phones

**Recommended tool when the time comes: Vite**
- Minimal config; native ES modules; good Firebase and PWA plugin support
- Output looks very similar to what you write today — the transition is not bewildering
- GitHub Actions workflow change: add `npm run build` before the Firebase Hosting deploy; point the deploy at the `dist/` output directory rather than the source root
- Cloud Functions remain separate (they have their own `functions/package.json` and are not bundled by Vite)

**Do not add a bundler speculatively.** The current no-build setup is the right call while the app is small enough that every file is readable without tooling. Add complexity when the pain of not having it is concrete.

---

## Open decisions

**Auth hardening:** A five-stage plan to replace the surname-based password with a custom password backed by verified work email is documented under "Password security improvements" above (Stage 1 shipped v12.68). The staged approach preserves the name-dropdown login UX while progressively adding security. Key risk during rollout: `ensureFirebaseSession` must be reworked before Stage 3 ships — see that entry. See also KNOWN_LIMITATIONS.md → the four v11 security tasks (task #2, Firestore member write isolation, suspended) for related context.

**Multi-admin:** ✓ Resolved — `CONFIG.ADMIN_NAMES` is now an array in `roster-data.js`. Adding another admin is a one-line change (name must match `teamMembers[n].name` exactly).

**Official status:** Is this app sanctioned by Chiltern Railways? The more operationally critical it becomes, the more important this question is.

**Profile photo / avatar:** Non-vital. Keep as-is, simplify (auto centre-crop or slider-only — drops the high-risk interactive editor), or revert entirely. See the "Profile photo / avatar" entry above for the assessment and the exact revert checklist.

**GDPR:** Staff shift data is personal data. The `faithCalendar` field (a religious preference stored in the `memberSettings` Firestore collection) was removed at v13.23 along with the Cultural Calendar feature — see the "Cultural calendar overlay" entry above for full details and the revert checklist if it is ever re-introduced. If the app becomes official infrastructure, data controller status and full retention policies will need documenting.

---

## Security project — per-member override write isolation

**Now SHIPPED (strict) and tracked in `SECURITY_RELEASE_PLAN.md` (phases B2/B3) — this section is a
pointer, not the live plan.** `overrides` writes require the member's own `name` claim (with
admin + manager bypass) so a signed-in member can only write their own overrides. Tried at v10.72,
**suspended at v10.94 after a production outage** (post-mortem: KNOWN_LIMITATIONS.md task #2), then
rebuilt as the three-tier permissive rule **B2 (built v14.53)**, and made **strict (B3, shipped v16.29)** —
the legacy no-name escape branch has been removed, so overrides create/update/delete now require
`token.name == memberName || token.admin || token.manager`.

Two load-bearing facts that survive here so they aren't lost when reading the roadmap alone:
- **The admin/manager bypass is load-bearing, not optional.** Admin + managers write overrides for
  *other* members constantly (AL/sick on their behalf; every `source:'roster_import'` upload). The
  rule must keep `|| admin || manager` or roster upload and on-behalf booking break.
- **The one real rollout risk is cached tokens, not code.** A valid 30-day session carries a token
  minted before the claim existed; a strict rule would fail its writes until re-auth — essentially
  the v10.94 outage. B3 handled this with the permissive→strict `CLAIM_EPOCH` token-refresh sweep
  (`CONFIG.CLAIM_EPOCH = 2`), and stale tokens self-heal via `writeWithClaimRetry` on the write path.

Full staged plan and deploy runbook: **`SECURITY_RELEASE_PLAN.md` → B2/B3** (B3 strict cutover shipped v16.29).

---

## Deferred security/reliability backlog (from the v14.11 external review)

The v14.11 external security review confirmed the release-readiness blockers (fixed in v14.13:
ESLint gate, the `spare_shift`/`correction` rule-vs-app contract, and the Rules/Functions
workflows now run the canonical gate). The items below were assessed as **real but not
deployment blockers** and deliberately deferred. Captured here so they survive between sessions.
Roughly ordered by value-to-effort.

### Next maintenance release (bug-class) — ✓ SHIPPED (v14.23–v14.28)

All shipped with tests across v14.23–v14.28: push-subscription auth race (shared `calendarAuthReady`);
VAPID rotation (unsubscribe-before-subscribe); orphaned-Storage cleanup on repeat Huddle uploads;
paycalc namespace ownership prompt (no silent first-loader claim); Huddle download-URL validation
(`isSafeStorageUrl`, bucket-narrowed); overlapping Sunday-correction deletion (`computePeriodDeleteIds`);
tightened Firestore field schemas (overrides/push-sub/analytics); roster-parse empty-after-filter
check; file-signature (magic-byte) checks. Plus the v14.26 delta: `getSession()` expiry now signs
Firebase out too, pinned roster-transition tests, and the Calendar duplicate-retry-listener fix.

**Deferred sub-parts of the schema work:** the Chiltern work-email DOMAIN check on `staffContact`
(now **done, v14.97**) and the `storagePath` prefix check (low value, still open).

### Dedicated security release (the big authorisation project)

> **Master sequencing + risk doc: `SECURITY_RELEASE_PLAN.md`.** The items below are the
> *scope*; that file is the *order* — the dependency graph, the permissive→strict token-refresh
> migration that avoids re-creating the v10.94 outage, the hard "never enforce App Check during
> the isolation rollout" constraint, and the owner-decision checklist. Read it before starting
> any item here.

These are interlocking; most remain and should ship together, but the headline gap is now closed:
- **Per-member override + Links write isolation — ✓ DONE (v16.29).** This was the headline
  authorisation gap (any authenticated identity could write/delete any member's overrides and any
  Links design). Override isolation went **strict (B3, v16.29)** — create/update/delete require
  `token.name == memberName || token.admin || token.manager`, no-name escape removed — and Links
  write isolation shipped in the same release (**H2, v16.29**): `linkDesigns` writes require
  `token.linksDesigner || token.admin` (reads stay open to any auth), with `linksDesigner` set by
  `setupRosterAuth` from `CONFIG.LINKS_DESIGNERS` and stale tokens self-healing via
  `writeWithClaimRetry`. Full history is in the "Security project — per-member override write
  isolation" section above.
- **Separate named sessions from the anonymous public session** — confine anonymous auth to the
  genuinely public Calendar reads; require a named session for Admin/Operations/Links/Settings/Pay.
- **Remove browser-side account creation** — stop the client auto-creating a Firebase account once
  server-side provisioning + recovery exist (today a missing account would otherwise become a
  staff-access outage).
- **Server-owned roster/role lists (B4)** — ✅ **SHIPPED v16.30.** `setupRosterAuth` reads the member
  + admin/manager/designer lists from `roster-members.json` (generated from `roster-data.js`,
  CI-locked) instead of the client payload, with dry-run orphan removal (preview → confirm), refresh-
  token revocation on disable, and fail-closed guards on an empty admin/members config.
- **Surname-password retirement** — the existing five-stage plan (verify work email → change →
  recovery → migrate → retire) under "Password security improvements"; do not rush, since locking
  staff out of the core roster is a bigger operational risk than the present small-team model.

### Infrastructure phase

- **App Check (monitor-first)** — register live domains, configure CI/dev debug tokens, observe,
  then enforce Firestore → Storage → browser-called Functions. (Note: a separate "considered and
  declined" assessment for the *current* threat model is in KNOWN_LIMITATIONS.md; revisit if the app
  is advertised more widely or becomes official infrastructure.)
- **Workload Identity Federation** ✓ **DONE (A2, v14.93)** — all 3 deploy workflows authenticate via
  keyless GitHub OIDC/WIF; the long-lived `FIREBASE_SERVICE_ACCOUNT` JSON key + GitHub secret are
  both deleted. See SECURITY_RELEASE_PLAN.md → Appendix A2.
- **Header-capable staff hosting** — the GitHub Pages staff URL can't receive Firebase Hosting's
  security headers (CSP etc.); migrate to Firebase Hosting or a header-capable custom domain when
  auth is redesigned or the app is officially adopted.

### Documentation accuracy fixes ✓ (v14.37–v14.38)

Done: the `pushSubscriptions` delete posture (any authenticated identity that knows the doc id) and
the bearer-URL read distinction (open Firestore metadata read; Storage object reached via a tokenised
URL that bypasses Storage rules) are now stated accurately in the docs + rule comments. The remaining
*rule* tightening is folded into SECURITY_RELEASE_PLAN.md B2 — not a doc fix.

---

## Usage analytics ✓ (v14.14)

Anonymous usage visibility in the Operations page: a **Usage** card (📊) showing how many
individual accounts have signed in (this calendar month and the rolling last 30 days) and how
popular each page is. Built first-party in Firestore — **not** Google/Firebase Analytics, which
would breach the `script-src 'self'` CSP and the no-third-party-CDN rule and ship data to Google.

**Privacy by design — no identity is ever stored server-side.** The server holds only integer
counters (`analytics/pv_<YYYY-MM>` for page popularity, `analytics/activeAccounts` for unique-
account counts). Uniqueness is deduped **on the client**: `usage-reporter.js` keeps localStorage
flags keyed by member name (`myb_usage_m_*` per calendar month, `myb_usage_d30_*` per rolling
window) that never leave the device, so each account self-suppresses and the server only ever
receives `increment(1)`. "Last 30 days" = sum of the `daily` buckets over the window (each account
counted once). This means the bulk of the data is genuinely anonymous aggregate counts — the
employee-monitoring/GDPR weight of per-person tracking is avoided entirely.

**Shape:**
- `usage-stats.js` — pure date-bucketing + aggregation (tested by `usage-stats.test.mjs`).
- `usage-reporter.js` — `recordUsage(page, member?)`, called once per page from each coordinator
  at the same auth-timing as `initErrorReporter()` (writes need `request.auth != null`). The
  anonymous calendar records page views only (no member); authenticated pages also count the account.
- `firebase-client.js` — `recordPageView` / `recordActiveAccount` (increment-only, fire-and-forget)
  and `getUsageStats` (reads + prunes stale daily buckets).
- `operations-app.js` / `operations.css` — the admin-only Usage card.
- `firestore.rules` — `analytics`: admin-only read, authenticated increment write, no client delete.

**Known limits (intentional):** counts are per account-device, so a multi-device user counts more
than once — it's a usage *trend*, not a precise headcount. Dedup trusts the client (App Check is the
eventual integrity backstop). Both are acceptable for the small-team, unadvertised threat model.

**Possible later:** per-month page-popularity history/trends; an all-time page total; a true
device-independent unique count (would require server-side identity — deliberately not done).

---

## Performance (load speed)

A deep, code-grounded performance pass (June 2026). **Measure cold loads with Lighthouse
mobile (throttled Slow-4G + 4× CPU) in a private window** before/after — the installed PWA
loads from the SW cache and hides the cold-load cost real first-time staff pay (same lesson as
"the installed PWA masks live-site breakage").

**Where we are (v15.07) — two independent latency tracks:**
- **Cold page-load (this section):** Batches 1/3/4 shipped (preconnect, stale-while-revalidate JS/CSS,
  paycalc modulepreload). **Next:** the deferred lazy-Firebase pass below — but **only if** the
  App-speed data shows the Firebase SDK dominating paycalc's cold load; otherwise leave it.
- **Login latency (separate track):** the post-login `reload()` has been removed page-by-page
  (in-place login). **ROLLOUT COMPLETE — all five coordinators enabled: paycalc (v15.07), operations
  (v15.08), links (v15.09), admin (v15.16), settings (v15.17).** The per-page kill-switch in
  `CONFIG.INPLACE_LOGIN` still stands (set any key back to `false` to revert that page). Full plan:
  **ARCHITECTURE_PLAN.md → Phase 9**.

### Shipped

- **Batch 1 (v14.17) — preconnect + lazy DOMPurify + immutable icon caching.** All 6 app pages
  `preconnect` to `gstatic.com` (Firebase SDK) and `firestore.googleapis.com` (data) so DNS/TLS
  overlaps HTML parse. DOMPurify (~45 KB) is now dynamically imported only when a DOCX huddle's
  HTML is rendered (was static + modulepreloaded on every calendar load). PNG icons get immutable
  1-year caching. *Deliberately did NOT eager-`modulepreload` the Firebase SDK URLs — that would
  hard-code the SDK version into 6 HTML files with no test guard.*
- **Batch 3 (v14.18) — stale-while-revalidate for JS/CSS.** The SW was network-first for all app
  files, so every online load waited on ~30+ per-file round trips (cache was offline-only). JS/CSS
  are now served instantly from the version-pinned cache and refreshed in the background; HTML
  stayed network-first until v16.10 (see the v16.09–16.10 SW pass below). This was the biggest
  perceived-load win for the common case (returning installed-PWA staff).
- **Batch 4 (v14.94) — paycalc modulepreload (collapse the deepest waterfall).** `paycalc.html`
  declares its whole static import graph (~32 local modules **+ the 3 gstatic Firebase SDK URLs**)
  as `<link rel="modulepreload">` so the browser fetches everything in parallel from first HTML
  parse instead of discovering it file-by-file (paycalc has the deepest graph → the worst cold-load
  waterfall). `modulepreload` only fetches/compiles — no behaviour change. This is the one place
  Batch 1's "don't eager-preload the SDK URLs" caveat is reversed **because** it is now safe:
  `sw-asset-check.test.mjs` guards the list against paycalc's real transitive graph AND against the
  SDK version pinned in `firebase-client.js`, so it can't silently drift. **paycalc is the only page
  with the FULL graph + SDK-URL preload** (its graph is the deepest/slowest). The calendar
  (`index.html`) has a lighter 4-module preload of its top-level entry modules only (`calendar-app`,
  `nav-panel`, `roster-data`, `firebase-client` — **no** SDK URLs); the four write pages rely on
  `preconnect` alone. There is **no plan to make the full/SDK preload universal** — each page's SDK
  preload would need its own drift guard first (the Batch 1 reason). **Let this settle** (watch the
  Operations App-speed data) before the deferred lazy-Firebase pass below.

- **v16.09–v16.10 — service-worker deep pass (owner-approved architecture changes).** v16.09:
  Navigation Preload (HTML fetch overlaps SW boot), SWR revalidation throttled to once per SW
  lifetime (~35 no-op 304s per open removed), warm-up chunked (8-way) + skips already-cached
  assets, first-install double-load fixed (`sw-register.js` hadController guard), notification
  taps always navigate, redirect hygiene (`unredirect` + opaqueredirect pass-through + `./` links,
  manifest start_url). v16.10: **HTML joined JS/CSS as stale-while-revalidate** (instant from
  cache; the preload response doubles as the background refresh; cache-miss falls back to
  network-first with the 2s race) and the **gstatic Firebase SDK is cached cache-first** in a
  dedicated `myb-roster-sdk-v{ver}` cache warmed with the app — offline no longer depends on the
  browser HTTP cache (`sw-asset-check.test.mjs` pins the SW's SDK version to firebase-client.js).
### Deferred — lazy-load the Firebase SDK off the calendar's first paint

**What:** `firebase-client.js` statically imports the 3 gstatic Firebase modules (firestore is the
single largest payload), and `calendar-app.js` reaches Firebase through *eight* static paths
(firebase-client, calendar-overrides, calendar-initial-fetch, calendar-huddle-viewer,
calendar-team-view, error-reporter, usage-reporter, **and nav-panel** — on every page). So the
calendar can't execute until the whole SDK downloads+parses, even though first paint only needs
local roster data. A true fix splits `calendar-overrides.js` (pure cache vs Firebase fetch — its
`rosterOverridesCache`/`getShiftTypesInMonth` are render-critical), makes `nav-panel.js`
lazy-import Firebase, and restructures the calendar init to paint first, then dynamically
`import()` the Firebase-dependent modules.

**Why deferred (not just unstarted):**
1. **Diminished benefit after Batches 1+3 (and further after v16.10).** Returning
   installed-PWA users now get app code instantly from the SWR cache, and the Firebase SDK
   is served cache-first from the SW's own `myb-roster-sdk-v*` cache (v16.10 — no longer
   just the evictable browser HTTP cache) — so they're already fast. Lazy Firebase mainly
   helps *first-time* loads, which are rare for staff who install once. Preconnect
   (Batch 1) already trims the cold-connection cost.
2. **High risk on the two most-used surfaces** (calendar + nav-panel), with subtle failure modes
   (overrides silently not loading, auth race, sync chip stuck).
3. **The automated gates can't validate it** — the e2e suite stubs Firebase at the network layer,
   so it would pass even if the deferred-Firebase timing were broken. It needs real-device
   cold-load + real-data verification.

**Decision:** only pursue if a cold-load Lighthouse profile shows the Firebase SDK dominating TTI
*and* it's worth a dedicated branch with real-device verification. Otherwise leave as-is.

> **Reviewers keep re-suggesting "lazy-import Firebase in `nav-panel.js`" as a standalone win —
> it is worth ZERO in isolation, do not do it on its own.** Every page that renders the nav drawer
> already pulls the Firebase SDK through other static imports (`calendar-app.js` reaches it via seven
> paths besides nav-panel; `admin`/`operations`/`links`/`settings` import `firebase-client.js`
> directly; `paycalc` via `session.js`). So deferring Firebase in nav-panel alone removes nothing from
> any page's module graph — it only converts the synchronous bell render (`notifSupported()`) and the
> circular/newsletter tap path to async-import paths, adding complexity + risk to the most fragile
> shared surface for no download saved. The nav-panel lazy-import is only meaningful **bundled with**
> the calendar-init restructure above (paint first, then `import()` the Firebase-dependent modules) —
> never as a lone change. (Evaluated and declined again in the v15.69 review.)

### Minor / not worth it now
- `paycalc.calculate()` runs on every keystroke (a few `lsGet`s per call; `getGrade` already
  cached) — a short rAF/debounce would smooth rapid typing on low-end phones. Marginal.
- Font is already optimal (one variable woff2, preloaded, `font-display: swap`, immutable).
- **Lazy-load the heavy Operations-page card imports** (`operations-app.js` and its Firebase/Functions
  paths). Reviewers periodically flag this, but `operations.html` is **admin-only** — effectively a
  single user (the developer) — and is opened rarely. Deferring its imports optimises a page almost
  no staff ever load, for real churn on a page whose init is already gated behind an access check.
  Not worth it; only reconsider if Operations ever becomes staff-facing. (Evaluated and declined in
  the v15.69 review.)
- Vite build step (bundle the ~52 modules, tree-shake Firebase) — the "nuclear option"; Batches
  1+3 capture most of the benefit without a build step. Stays deferred (see "Build tooling — Vite").

---

## Maintainability roadmap (added v13.72)

A phased plan to make the codebase easier to maintain and extend without introducing a build system or framework. Each phase is self-contained and safe to defer. Phases are ordered by value-to-effort ratio.

**Phases 0–7 ✓ complete (v13.72–v13.86)** — the codebase-hygiene track, all shipped:
- **0 Safety net** — `npm run lint`/`check`; `import-graph.test.mjs` (circular-import detector);
  dead-CSS-token + Firestore-cross-reference tests in `sw-asset-check.test.mjs`; PR template.
- **1 Type hints** — `// @ts-check` on every root module; `COLLECTIONS` constant; roster-data
  integrity tests.
- **2 Session consolidation** — `sessionReady`/`resolveSession()` replace the `window._mybSession`
  global.
- **3 Decision comments** — `// Rule: see CLAUDE.md — "…"` at each surprising enforcement site
  (Christmas-RD ordering, manual-beats-import, the Sunday layers).
- **4 DOM-wiring tests** — `nav-panel.test.mjs`, `overlay.test.mjs`, `session.test.mjs`.
- **5 ESLint devDependency** — clean-checkout `npm run check`.
- **6 File-size refactor** — `calendar-app.js` 1,950→~670 and `paycalc-app.js` ~1,950→~1,270 via
  focused sub-modules (`calculate()` stays in the coordinator, passed as a callback to avoid cycles).
- **7 Firestore emulator suite** — `firestore.rules.test.mjs` + `storage.rules.test.mjs` (gated in
  `deploy-rules.yml`); the prerequisite for the password + write-isolation work.

### Phase 8 — Password security (Stages 2–5)

**Depends on Phase 7 (Firestore emulator) being in place first** — auth changes are high-risk
without it. Phase 7 is now done.

This phase is the canonical five-stage plan described in full under **"Password security
improvements — staged plan"** below — do not re-number the stages here. In brief:

- Stage 1 ✓ (v12.68): Work-email registration via `staffContact`.
- Stage 2: Email verification.
- Stage 3: Self-service password change (while logged in).
- Stage 4: Forgotten-password reset (self-service, via verified work email).
- Stage 5: Retire the surname-derived password.

Stages 2–5 are parked pending the owner setting up Power Automate (the email-delivery channel).

**Note:** per-member Firestore write isolation (`request.auth.token.name == memberName`,
suspended at v10.94, rebuilt permissive at v14.53, now **strict and LIVE as of v16.29**) is a
**separate** security project — see "Security project — per-member override write isolation" below
and KNOWN_LIMITATIONS.md task #2. It is *not* a stage of the password plan; earlier drafts of this
section conflated the two.

### Phase 9 — TypeScript zero-diagnostic baseline ✓ (9a–9c complete, June 2026)

Progressively hardened `tsc --noEmit` (via `// @ts-check` + `jsconfig.json`) from ~570 errors to
zero, enforced by the fail-closed `scripts/typecheck.mjs` CI gate:
- **9a** — `checkJs: true`; fixed all 57 non-DOM errors (the only suppressions are targeted
  `// @ts-ignore` on the Firebase CDN `import()` lines in `firebase-client.js`, unavoidable in a
  no-bundler setup).
- **9b** — all DOM `.value`/`.dataset`/etc. errors resolved with JSDoc `/** @type {HTMLXxxElement} */`
  casts (33 files); gate now enforces zero errors of any kind.
- **9c** — `strict: true`; null-safety guards + implicit-any annotations across 46 files; **no**
  `// @ts-ignore` — all explicit annotations or runtime-safe guards.
- **9d** (replace `any` casts with precise types) — **partially done (v16.29).** All DOM-element
  casts (`/** @type {any} */ (document.getElementById(…))` → precise `HTMLElement`/`HTMLButtonElement`)
  are converted (admin-roster-upload, calendar-al-lightbox, links-app), typecheck stays at zero errors.
  **Remaining ~180 `@type {any}` casts, deliberately not converted:** ~56 are genuinely dynamic and
  SHOULD stay `any` (Firestore `doc.data()`, caught errors, snapshots — no static type without generated
  Firestore types); the rest are object-shape params (period/member/override objects) that would want a
  shared `@typedef` (e.g. a `Period` type across the paycalc cluster) — a larger, higher-regression-risk
  refactor for marginal real-world safety, since strict null/DOM checking (9a–9c) already catches the
  bugs that matter. Do the `Period` typedef as its own focused pass if pursued; otherwise the current
  `any` on dynamic data is correct, not debt.

## Deferred backlog (from the v14.96 external review)

A thorough external review of v14.96 confirmed no release blocker for current small-team use. Most
findings were already done (B1 re-enabled v14.98; App-speed admin-exclusion v14.95; B3 strict
override isolation shipped v16.29; B4 server-owned role lists shipped v16.30) or already sequenced
(the C-series password track, in-place login rollout, the app-perf caching pass). Quick wins (fail-closed uploads, stale auth-doc fixes, a
MILLER_ACTUALS export guard, the primeAuth comment) shipped at v14.99. Two items captured here:

### M8 — lazy-load heavy Cloud Function dependencies (cold-start)

`functions/index.js` requires `@anthropic-ai/sdk`, `mammoth`, and `web-push` at the top level, so
every function pays their load cost even when it doesn't use them. Move each to a lazy `require()`
inside the function that needs it — Anthropic only in `parseRosterPDF`, `mammoth` only for DOCX
huddle ingest, `web-push` only in the notification fan-out. Medium value (functions cold-start),
low risk (mechanical), independent of the auth release. Functions tests already cover the helpers.

### L4 — paycalc collapsible fixed `max-height` — ✅ CHECKED, within cap (no fix needed)

`paycalc.css` gives open collapsible bodies a fixed `max-height` for the open/close animation.
**Checked (v16.29):** the tallest real content is well within the cap. The `.bd-body` back-pay
breakdown accrues at most one row per period in a single award tax year (≤ ~13 rows, capped at
`todaysPeriodNum()` and excluding the paid-in period) and the result breakdown is a fixed ~20-line
category list — ~550–800px against the 1400px cap; print already unclips it. So it does not clip at
realistic sizes, and `max-height:none` would break the animation. A finite cap is correct here; the
`paycalc.css` comment records the reasoning. Only revisit if a future breakdown could exceed the cap
(then prefer measure-height-and-drop-cap-after-`transitionend` over a bigger magic number).
