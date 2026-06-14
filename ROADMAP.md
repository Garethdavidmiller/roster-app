# MYB Roster — Product Roadmap

*Last updated: June 2026 — v12.70 · Updated every 0.10 version*

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

Staff enter their hours; the calculator computes estimated tax, NI, pension, and take-home pay per pay period. Lives at `paycalc.html` / `paycalc.js`, fully integrated into the main app.

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

A shared slide-out nav panel (`nav-panel.js`) replaced the ad-hoc per-page navigation controls. Started on the original three pages (index, admin, paycalc); extended to operations at v10.99, settings at v11.06, and links at v12.07 — all six app pages now have it.

- **v10.57** — `nav-panel.js` module added. Burger `☰` button in the first three page headers. `NAV_PAGES` drives the page-switcher pill row (current page omitted). `NAV_INFORMATION` drives the always-open Information section (Workplace: Daily Huddle, Weekly Retail Circular, Railcard Guide; Staff Travel: FIP Guide). Coming-soon lightbox placeholder added.
- **v10.59** — Sign-out button moved from page headers to nav panel footer. `initNavPanel({ onSignOut })` pattern — each page passes its own callback.
- **v10.61** — Notification bell 🔔/🔕 added to nav panel footer. States: on / off-default / off-lapsed / denied / unsupported. All push logic stays in `notif.js`; nav-panel.js owns only the UI.
- **v10.63** — Header back buttons removed from `admin.html` and `paycalc.html` (duplicate nav paradigm; conflicted visually with the grid layout). Navigation back to the calendar is now via the nav panel's Calendar pill.
- **v10.64** — Nationality flags added to nav panel footer. Optional `flags: ['🇬🇧', '🇳🇬']` array on a `teamMembers` entry; `nav-panel.js` looks up the logged-in member and renders up to 2 emoji between the name and the bell.
- **v10.65** — Flags hidden on Windows (flag emoji render as two-letter codes on Windows). Detection uses `navigator.userAgentData?.platform ?? navigator.platform` with a `navigator.userAgent` fallback.
- **v10.66** — `admin.html` / `paycalc.html` headers switched to CSS grid (`1fr auto 1fr`). `<div class="app-header-brand">` wrapper holds icon + title in the `auto` centre column. Equal `1fr` side columns guarantee true geometric centring regardless of burger/badge width asymmetry.
- **v10.67** — All remaining CEA members given flags arrays (UK flag by default; heritage flags where known).
- **v10.68** — `justify-self: start` added to `.btn-burger` — pins burger to the left edge of its `1fr` grid column (was floating centre after the grid switch).
- **v10.69** — Nav panel hardening: double-init guard (`burger.dataset.navPanelInit`); Tab/Shift+Tab focus trap while panel is open; coming-soon lightbox focus restoration (`_csReturnFocus`); keydown listener cleanup moved to start of `_closeComingSoon()` to prevent listener leak.
- **v10.71** — Huddle push notification PDF fix. Notification taps carry no transient user activation — `window.open('_blank')` was blocked as a pop-up, and `location.href` to the cross-origin Storage URL broke standalone mode (Android wrapped the app in browser chrome). Fix: `_triggerAutoOpen()` now renders an in-overlay "📄 Open Huddle" button; tapping it IS a real gesture, `window.open` opens the PDF as a Custom Tab over the intact standalone app, and Back returns cleanly.

**Key design outcome:** The nav panel replaced the need for a bottom navigation bar (see "UX experiments" below). Cross-page navigation is clean without occupying fixed screen space.

---

### Security hardening (v10.72–v10.74)

Progress on the four v11 security tasks. Authoritative current status and the re-introduction checklist live in **KNOWN_LIMITATIONS.md → "The four v11 security tasks"**.

- **v10.72 — Firestore member write isolation ⚠️ later suspended (v10.94):** `firestore.rules` was updated so each staff member could only write overrides for themselves (`memberName == request.auth.token.name`), with an admin claim bypass for G. Miller. This was **reverted at v10.94** after it caused a production outage; rules are back to `request.auth != null` with field validation retained. See KNOWN_LIMITATIONS.md task #2 for the full post-mortem and re-introduction checklist.

- **v10.73 — Back pay variable pay included in HPP:** G. Miller's period 32 payslip confirmed Chiltern itemises back pay per category with explicit `(Back Pay)` suffix lines. `calcBackPay()` now computes `_bpVarAmount` (overtime, RDW, Sunday, BH, London Allowance uplifts in the rate-difference period). `calcHPP()` adds `_bpVarAmount` to `totalVar` for the paid-in period — HPP estimate is now correct after a back pay event.

- **v10.74 — Code quality fixes:** `.gitignore` added (example payslips, node_modules, .env files). `nav-panel.js` `_closeComingSoon()` given a `transitionend` fallback timer (400 ms) to prevent body scroll staying locked on iOS or under `prefers-reduced-motion`. `paycalc.html` static `rosterHintText` aligned with the JS-set wording. `OPERATIONS_REFERENCE.md` stale `ROSTER_SECRET` reference removed.

- **GCP API key restriction (manual, May 2026):** Firebase web API key restricted to `myb-roster.firebaseapp.com/*` and `myb-roster.web.app/*` HTTP referrers in GCP Console. Verified correct via curl tests.

### Railcard reference guide ✓ (v10.30–v10.48)

`railcard-guide.html` — a standalone at-work reference sheet for staff checking and selling railcard-discounted tickets at the gateline. Linked from admin.html; no JS module (static page, served network-first).

- **v10.30–v10.33**: Initial guide added, collapse/lightbox interaction fixes.
- **v10.34–v10.40**: Rewritten as a quick-glance at-work sheet — colour-coded stripe per card (green / amber / red morning rule), weekend-and-bank-holiday rule banner, page-wide plain-English pass.
- **v10.41–v10.45**: Research-backed accuracy overhaul against official 2026 sources. Chiltern-specific callouts on Network area (valid to Banbury/Kings Sutton), Gold Card (covers the whole Chiltern route incl. Birmingham — the 12th card), Senior and Family & Friends (Network-area morning-peak rules). Two Together, Veterans, Jobcentre Plus corrected.
- **v10.46**: Scannable labelled-row layout (Save / When / Who), GroupSave section, and a Save-as-PDF button (`window.print()` with `@media print` rules).
- **v10.47–v10.48**: GroupSave validity time made specific (after 09:30 Mon–Fri; ScotRail's "any time" change does not apply to Chiltern), season-ticket guidance added (standard railcards do **not** discount season tickets — only Jobcentre Plus and 16-17 Saver do; Gold Card is itself a season-ticket benefit), and the July/August minimum-fare waiver flagged per card (16-25, HM Forces, Veterans waived; 26-30 not).

**Key design decisions:**
- Each card is self-contained — its exact time rule lives in its own **When** row so staff never have to cross-reference a key
- Accuracy verified per card against the relevant official railcard site (nationalrail.co.uk and the individual card sites), re-checked May 2026
- Static HTML, no module — kept deliberately simple as a low-frequency reference page

### Cross-page consistency pass ✓ (v11.70–v11.88)

A second polish pass focused on making the four sub-pages (admin, paycalc, operations, settings) and the calendar read as one consistent family. No new features — spacing and typography only.

- **v11.70–v11.76** — Header title optically centred (absolute-positioned `.app-header-brand` / `.header h1`, decoupled from badge width — the iOS/Material nav-bar pattern); admin badge standardised to solid gold; header→first-card gap tightened to 4px and inter-card gaps unified at 12px across the sub-pages; white-card padding standardised (`11px 16px` header, `12px 16px` body).
- **v11.77–v11.79** — Typography scale standardised on the `shared.css --type-*` tokens. Card-header `h2` settled at 13px/700 on all four sub-pages; `.hint` at 12px; form labels at `--type-small` (12px); inputs/selects at `--type-medium` (16px — also prevents iOS focus-zoom); primary action buttons (`.btn-action`/`.btn-primary`/`.btn-save`) at 15px; `body` base at `--type-body` (14px). Genuinely distinct components (nav pills, dense roster-review rows, badges) intentionally keep their own sizes. Body bottom padding reduced from `max(20px, safe-area)` to `max(10px, safe-area)` to trim the navy floor on Android phones without a gesture bar.
- **v11.80–v11.81** — Calendar `.header` padding brought into line with the sub-pages' `.app-header` at every breakpoint (16px 20px / 14px 18px / 10px 12px); the header→controls margin was then trimmed (16→8px) to absorb the extra height the taller bar added, keeping the nav buttons the same visual distance from the title.
- **v11.82** — Nav drawer head→pills gap reduced 36→22px (head bottom padding 18→10px, body top padding 18→12px) so the page pills sit closer to the drawer header.
- **v11.84** — Shared CSS components (card-header, collapsible, btn-action, btn-primary, btn-secondary, btn-card-tips, tips lightbox) extracted from page-inline `<style>` blocks and consolidated into `shared.css`. All transitions tokenised to `--dur-fast`/`--ease-standard`; hardcoded `scale(0.98)` press effect in operations.html replaced with `var(--press-scale)`.
- **v11.85** — Guide brand palette (`--navy`, `--navy-dark`, `--navy-mid`, `--gold`) moved from each guide page's `:root` into `guide-shell.css :root`. 23 inline `style=` attributes in `paycalc.html` extracted to named utility classes in `paycalc.css`. Team View key-dot spans switched from inline `style=` to `.tv-key-dot--*` modifier classes in `index.css`.
- **v11.86** — `admin.css` 1024–1399px stacked layout now correctly hides `.col-pills` and `.col-time` on inactive rows. Settings and Operations print blocks show a "not designed for printing" message via `body::before` instead of a blank page.
- **v11.87** — SW offline document fallback extended: `operations.html` and `settings.html` added to routing chain (previously both fell back to `index.html`).
- **v11.88** — Stale comments cleaned across 10 JS/CSS files: old filename references (`admin-huddle.js`), wrong page attributions, provenance notes ("Extracted from admin-app.js at vX.YZ"), and drifting cross-file line numbers.

### Comprehensive UI polish ✓ (v11.64)

A full line-by-line CSS audit across all five stylesheets (`index.css`, `admin.css`, `paycalc.css`, `shared.css`, `guide-shell.css`) with fixes for iOS, Android, desktop, and print.

**Motion tokens applied throughout:**
- All hardcoded `cubic-bezier(0.4, 0, 0.2, 1)` animation values replaced with the shared motion vocabulary tokens (`--ease-standard`, `--dur-fast`, `--dur-base`) so timing is consistent and controlled from one place.
- All `scale(0.94)` press effects replaced with `scale(var(--press-scale))` so the `@media (prefers-reduced-motion)` override in `shared.css` correctly suppresses them (previously the hardcoded scale bypassed the override).

**Focus and accessibility fixes:**
- `.decimal-hrs-input:focus` (paycalc) was `outline: none` with no visible replacement — keyboard users had no focus indicator. Replaced with `:focus-visible` + gold ring (`border-color: var(--accent-gold); box-shadow: 0 0 0 3px rgba(245,200,0,0.25)`) matching every other input.

**Touch affordances (guide-shell.css):**
- `.btn-back` gained `min-width: 44px; min-height: 44px; display: inline-flex; align-items: center` (44×44 tap target per iOS HIG).
- `.btn-pdf:hover` moved inside `@media (hover: hover) and (pointer: fine)` so touch devices don't get sticky hover states; `.btn-back:active` and `.btn-pdf:active` added for tactile feedback on tap.

**Hardcoded colours replaced with design tokens:**
- `#fff9f9` → `var(--error-bg)` (roster conflict row background)
- `#c0392b` → `var(--error-red)` (AL balance at zero)
- `#111` → `var(--text-dark)` (huddle viewer body text)

### Navy header — unified chrome across all pages ✓ (v11.69)

The floating card header (white background, drop shadow, rounded corners) was replaced with a transparent navy chrome on all five pages. Since the body canvas is already navy and theme-color is navy, the old light card created a visual seam at the top of every page. Removing the card chrome makes the header flow continuously from the OS status bar — matching the nav drawer and login overlay that were unified at v11.54.

- All pages: `.header` / `.app-header` — `background`, `box-shadow`, `border-radius` removed
- Burger button and h1 flipped to `white` throughout; comment cleaned up
- Brand icon sized up to 32px, `border-radius: 7px`, dark shadow removed — matches `.nav-panel-icon` exactly
- Admin badge: was navy-on-navy (invisible) → now raised chip (`rgba(255,255,255,0.09)` fill, hairline border, gold text) — mirrors the drawer's Admin pill treatment
- Print resets added: `background: white !important` on `.header` / `.app-header`, `color: var(--primary-blue) !important` on h1 and burger — navy would print solid ink without these
- ROADMAP "Full-bleed navy header" entry updated from "reverted" to shipped; icon blocker (white fringe, white ring) was resolved by the icon processing changes in the same session

### Huddle DOCX flow rework ✓ (v11.66)

Power Automate flow redesigned: old flow used a noon time-of-day condition (before noon = DOCX branch, after noon = PDF branch), meaning afternoon emails always sent PDF even when DOCX was attached. New flow is DOCX-first: filter attachments for DOCX MIME type → if found send DOCX to `ingestHuddle`; else filter for PDF → if found send PDF. No time condition at all.

Viewer code hardened to match: `app-huddle-viewer.js` now uses simple `if (htmlContent) render inline; else show "📄 Open Huddle" button` — eliminating a silent DOCX failure in `_triggerAutoOpen` and an incorrect error message in the manual click handler. The auto-open notification path and manual-click path are now logically identical in their branching.

---

### Pay reminder infrastructure fix ✓ (v11.65)

`sendPayReminderNotification` (scheduled Cloud Function, daily 08:00 London) had never fired because its Cloud Scheduler job was never created. Two root causes:

- The `FIREBASE_SERVICE_ACCOUNT` lacked `roles/cloudscheduler.admin` — Firebase silently failed to create the scheduler job on every deploy. Fixed by adding the role in GCP IAM.
- A stale `us-central1` deployment record (from the function's first deployment before the region was pinned to `europe-west2`) blocked all subsequent deploys with a 404 on cleanup. Fixed by deleting the old function manually from Firebase Console.

Schedule format also hardened from `'every day 08:00'` (App Engine cron) to `'0 8 * * *'` (standard Unix cron, better supported by firebase-functions v2). A try/catch wrapper ensures runtime errors are explicitly logged. Force-run on 31 May 2026 confirmed the function executes and correctly skips non-cutoff days. First live test: **27 June 2026** (cutoff for the 3 Jul payday).

### CSS extraction and infrastructure hardening ✓ (v12.01–v12.05)

Refactoring and security hardening with no end-user visible behaviour change.

- **v12.01** — `operations.css` and `settings.css` extracted from inline `<style>` blocks into external CSS files, completing the extraction that began at v11.41 (`index.css`, `admin.css`, `paycalc.css`).
- **v12.04** — Guide page styles extracted to `guide.css`, `paycalc-guide.css`, `railcard-guide.css`, `fip.css` — every page now uses `<link rel="stylesheet">` rather than inline `<style>` blocks. DOMPurify self-hosted at `./purify.es.mjs` (v3.4.8) — CDN import replaced; `<link rel="modulepreload">` in `index.html`; SW caches it network-first. Security headers added to `firebase.json`: `Strict-Transport-Security`, `Cross-Origin-Opener-Policy`, expanded `Permissions-Policy`. `normaliseSurname()` extracted to `firebase-client.js` (shared implementation for Auth password derivation). `PAGE_FALLBACKS` array in `service-worker.js` replaces long ternary chain in offline routing. Cultural calendar admin banner upgraded: `warnIfCulturalCalendarMissingYear()` now returns missing dataset names — a ⚠️ urgent banner appears year-round if data is missing, not just in Nov/Dec. ESLint and Firebase SDK version consistency checks added to the pre-commit hook. `@media (prefers-reduced-motion: reduce)` guards added for `sync-pulse` and `pulse-confirm` CSS animations.
- **v12.05** — Firestore `overrides` read auth requirement reverted. v12.04 required anonymous Firebase Auth for calendar reads — more complexity than value (anyone can obtain an anonymous token as easily as the app does). Intentionally left open; decision and trade-offs documented in `KNOWN_LIMITATIONS.md` and commented in `firestore.rules`.

### Links design workspace ✓ (v12.06–v12.47)

A 28-line rotating link design tool for Marylebone station. Accessible only to `CONFIG.LINKS_DESIGNERS` (currently G. Miller and S. Silva, added v12.33). Flagged beta — a working sketch for agreeing the pattern before the final link is built.

**What was built:**
- **v12.06–v12.07** — Initial Links page (`links.html` / `links-app.js` / `links.css`): auth guard, Firestore load/save to `linkDesigns/combined-28`, 28-line grid editable via per-cell dropdown (Line + staff name columns), early/late coverage bar chart, collapsible cards, nav panel integration.
- **v12.33** — Beta marker (gold-outline chip + `#betaLightbox` first-visit notice following canonical lightbox lifecycle); S. Silva added to `LINKS_DESIGNERS`; `deploy-pages.yml` workflow added for GitHub Pages.
- **v12.37** — Print layout (A4 landscape grid + coverage); sticky day headers at ≥1024px using `overflow: clip` (not `hidden`) on the card to avoid creating a scroll container; concurrency guard: `saveChanges()` re-reads `updatedAt` and names the other designer before overwriting; `loadFailed` flag to distinguish a Firestore error from "no design yet".
- **v12.39** — Full redesign: staff names removed (the design is patterns-only, "Line 1"–"Line 28" — who goes on which line is a separate decision made after patterns are agreed); paint-mode brush bar (arm a shift chip, then single-click cells to fill — no dropdown required; Escape or re-tap to disarm); Design Checks card (weekends off, short turnarounds <12h across the circular rotation, longest consecutive-days stretch, early/late/spare balance); auto-generator rebuilt as slot-based targets (see v12.40 entry); `links-design.js` extracted as pure-maths module.
- **v12.40** — Slot-based generator: one row per distinct shift time, each with separate **Mon–Fri / Sat / Sun** headcount targets (the real roster genuinely differs on all three day classes); generator seeded from the current roster via `buildRosterTargets()` so designers start from what today's roster provides; rotating-window algorithm guarantees forward body-clock rotation (a person's week only moves later — never a late finish followed by an early start). Hourly coverage heat map: hour-by-hour on-duty headcount replacing the early/late bar chart; intensity buckets `heat-b0`–`heat-b5`; red `0` flags a coverage gap inside a staffed span; SP column for spares. `links-design.test.mjs` added — covering all pure-maths functions.
- **v12.41** — Vacant-lines model removed: "lines 23–27 are vacant placeholders" (`VACANT_FROM`) dropped. All 28 lines are now editable rotating rows.
- **v12.42** — Fixed-line model removed: "line 28 is C. Reen's fixed link" (`FIXED_POS`, the separator row, non-editable cells) dropped. In a rotating link everyone passes through every line — an all-rest line is an unfinished pattern, not a vacancy. C. Reen's adjusted shifts are handled as overrides on the base roster (the normal mechanism), not inside this designer. `ROTATING_LINES = 28`. Design checks and amber `.row-unfilled` marker flag any line that is entirely rest days.
- **v12.43** — Generator-only model: "Initialise from current rosters" and "↺ Reset patterns from current rosters" buttons removed (`buildDefaultDesign`, `normalisePattern`, `initFromRosters`, `resetFromRosters` all deleted). The auto-generator is now the only entry point for creating a new design — it reads Mon–Fri/Sat/Sun headcount targets and produces a complete 28-line rotation. When no design exists, the generator card auto-expands so designers don't have to discover it collapsed.
- **v12.44–v12.45** — Load-failure fix (template-literal apostrophe SyntaxError); stale `.row-unfilled` marker updated in-place by `applyShift()`; merged `buildShiftOptions()`; `weekendsOffPct` moved into `runDesignChecks()`; `.sr-only` promoted to `shared.css`.
- **v12.46** — Multi-design + compare: `linkDesigns` becomes a collection of named documents `{ name, patterns, updatedAt, updatedBy }`; legacy `combined-28` auto-migrated to "Design 1" on first load. Design picker (+ New / ⎘ Duplicate / ✎ Rename / ✕ Delete), ⇔ Compare mode with gold-outline cell diffs (side-by-side ≥1024px, stacked on phones). Card order changed to Grid → Generator → Coverage → Checks. 44px touch targets on coarse-pointer devices.
- **v12.47** — Cross-platform review fixes: picker chips restructured (`<div>` wrapping separate buttons — nested `<button>`s are force-closed by the HTML parser, silently breaking the markup); compare columns keep `overflow-x:auto` on desktop (two 560px tables can't share an 1100px container); main grid stays rendered-but-screen-hidden in compare mode so print always outputs the active design; print-only `#printDesignName` label; `touch-action: manipulation` on cells/brush chips (rapid paint taps triggered double-tap zoom on iOS/Android); duplicate forks the live in-memory patterns (unsaved edits included); designs sorted by name with last-active remembered in localStorage; `alert()` removed from delete guard.

**Key design decisions:**
- **Patterns-only documents** — removing staff names decoupled the pattern-design decision from the assignment decision. Each design document stores `{ name, patterns, updatedAt, updatedBy }` only (multi-design collection since v12.46; the legacy `linkDesigns/combined-28` singleton is auto-migrated on first load and then ignored); legacy `meta` from older saves is silently dropped on next write.
- **Slot-based generator over early/late binary** — the station is staffed in waves (opens ~06:20, morning build 07:00–08:30, middles 11:00–12:00, afternoons 13:30–14:30, closes 15:00+) with ~25 distinct shift times and genuinely different Saturday and Sunday patterns. A two-bucket binary cannot represent this shape.
- **Hourly heat map over per-type bar chart** — the bar chart aggregated by shift class and hid whether the waves overlapped or left gaps mid-day. The heat map shows the actual on-duty headcount shape of the day.
- **Pure-maths module** — all design maths in `links-design.js` (no DOM, no Firebase): `classifyShift`, `normaliseCustomShift`, `calcCoverage`, `calcHourlyCoverage`, `generatePatterns`, `runDesignChecks`, `dayClass`. Tested independently of the app.
- **Night shifts not applicable (confirmed June 2026)** — CEAs do not work night shifts. `normaliseCustomShift()` rejects starts between 21:00–03:59; the Night option was never exposed.

---

### Profile photo / avatar ✗ (v12.12–v12.21 → removed v12.22) — full spec preserved for future restoration

**Removed at v12.22.** Feature was present from v12.12 (photo upload, display) through v12.21 (interactive reposition editor v12.19). Removed because it was non-vital and the interactive canvas editor was disproportionate complexity for a 26px badge. The nav-panel footer now shows initials on a stable per-name colour instead (`avatarInitials`/`avatarHue` from `roster-data.js`, painted directly in `nav-panel.js`). Firebase data cleanup required: delete `memberAvatars` collection docs and `avatars/` Storage objects via Firebase Console (no Admin SDK in client-side code).

**To restore:** see "Restoration path" section below.

A member's optional profile photo — a circular badge in the nav-drawer footer (and the photo in the About panel), with an initials-on-colour fallback when no photo is set. Added v12.12; the **interactive reposition editor** (drag/pinch/zoom to frame the shot on a `<canvas>`) followed at v12.19.

**Status: explicitly non-vital.** It is a "nice to have" — staff's names become a photo in a menu. A decision may be taken later to remove it, or to simplify it back to what we had before the editor. This entry records that decision space and the exact revert path so it can be done cleanly.

**Honest assessment (deep review, v12.20):**
- The **display + storage + cross-device-sync layer is good, well-factored code** worth keeping regardless — the shared painter (`avatar.js`), the Storage-object + Firestore-pointer model (`firebase-client.js`), and the 3-layer sync (cache → Firestore refresh → live events).
- The **interactive editor is gold-plated for a non-vital feature.** It is ~350 of the feature's ~700 JS lines — canvas crop geometry, a Pointer-Events pinch/pan state machine, dpr-aware rendering, and a `ResizeObserver` refit. It is the highest-risk, hardest-to-maintain, untested part of the whole app, protecting a badge that renders at **26px**. At that size an off-centre face is invisible, so the precise reframing it buys is largely wasted, and it is the one chunk the owner cannot realistically debug unaided.

**Two ways to simplify if kept but trimmed (cheaper than a full revert):**
1. **Auto centre-crop (drop the editor entirely).** The `centreImage()` + `exportBlob()` core already produces a good centred square; deleting the gestures/slider/`ResizeObserver`/`setZoom`/`clampPos` removes ~300 lines and keeps the full value (choose a photo → it appears → remove it).
2. **Slider-zoom only (drop pan + pinch).** Keep `setZoom` driven by the slider, delete the Pointer-Events block — removes the bug-prone gesture state machine (~120 lines) while keeping zoom.

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

**Implementation notes (already written, can be restored):**
- CSS lives in shared.css — `.bottom-nav`, `.bottom-nav-item`, `.bottom-nav-icon`
- Each page needs `<nav class="bottom-nav">` before `</body>` with the active item marked
- Body needs `padding-bottom: calc(64px + env(safe-area-inset-bottom))` on mobile only
- Hidden on desktop (≥768px) via `display: none` in the base rule; shown via `@media (max-width: 767px)` block
- Print: `display: none !important` already in the media query

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
- JS: `updateSummaryStrip()` in app.js — called from `renderCalendar()`
- The AL query is de-duplicated via `_summaryALFetched` flag, reset in `clearMemberCaches()`
- All data sources are already imported — no new dependencies needed

### Full-bleed navy header (calendar page)
**Status:** ✓ Shipped at v11.69 — see "Navy header — unified chrome across all pages" entry above. Implemented as transparent/canvas chrome (not negative-margin full-bleed) unified across all 5 pages. Icon blocker resolved by the icon processing changes in the same session.

The calendar header (`.header`) was redesigned to bleed edge-to-edge with a navy background, matching the nav drawer and creating a single continuous navy band across the top of the page. The idea was to give the calendar page a stronger visual identity — the drawer already opens as navy, so extending that colour into the header would feel cohesive rather than abrupt.

**What was built (v11.59):**
- `.header` loses its white card surface (`background: var(--surface)`) and becomes `background: var(--primary-blue)`
- Burger and h1 flipped to `color: white`
- `.title-icon` box-shadow removed (shadow on a navy field is invisible)
- Full-bleed achieved via negative margins that cancel the body's safe-area side padding at every breakpoint, with the header restoring its own internal padding — the panel's own content stays at the same 16px–48px inset as the cards below it

**Why it was held back:**
- The `.title-icon` brand icon is currently an image sized for a white/card background. On navy it needs either a white-circle version or the icon itself redesigned — shipping the current icon on a navy strip looks rough.
- The overall composition needs more review: border between the header strip and the first card below it, how the today-button gold contrasts on navy, and whether the month/year text weight reads cleanly at all sizes.

**When to revisit:**
- After the brand icon has been updated to a version that reads clearly on navy (ideally a white circular background or a reversed variant)
- Review the full composition in context — nav drawer open/close, today button, month jump, the controls card directly below

**Implementation notes (already written, can be restored):**
- The core CSS pattern for full-bleed at the main body breakpoints (≤599px body has 16px side padding; 600–1039px uses `clamp(20px, 3vw, 48px)`):
  ```css
  /* Inside index.css .header */
  background: var(--primary-blue);
  margin-left: calc(-1 * max(16px, env(safe-area-inset-left)));
  margin-right: calc(-1 * max(16px, env(safe-area-inset-right)));
  padding-left: max(16px, env(safe-area-inset-left));
  padding-right: max(16px, env(safe-area-inset-right));
  border-radius: 0;
  box-shadow: none;

  @media (min-width: 600px) {
    margin-left: calc(-1 * max(clamp(20px, 3vw, 48px), env(safe-area-inset-left)));
    margin-right: calc(-1 * max(clamp(20px, 3vw, 48px), env(safe-area-inset-right)));
    padding-left: max(clamp(20px, 3vw, 48px), env(safe-area-inset-left));
    padding-right: max(clamp(20px, 3vw, 48px), env(safe-area-inset-right));
  }
  ```
- `.header h1 { color: white; }` and `.btn-burger { color: white; }` (override the navy text colour from the card version)
- Print reset: `@media print { .header { background: white !important; } .header h1, .btn-burger { color: var(--primary-blue) !important; } }`
- `.title-icon { box-shadow: none; }` — shadow is invisible on navy, remove it

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

**Implementation notes (already written, can be restored):**
```css
/* index.css */
.day-number {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-mid);
}

.calendar-day:active .shift-badge {
  transform: scale(var(--press-scale)); /* was scale(0.94) — use token for reduced-motion */
}
```
Note: the press-scale fix alone (`scale(0.94)` → `scale(var(--press-scale))`) is a clean independent change with no visual effect at default settings — it just ensures the `@media (prefers-reduced-motion)` override in `shared.css` correctly suppresses the press animation on that element too.

---

## Design audit — April 2026

Design review against a 10-point modernisation list. Already well-implemented: shadows (minimal, 10% opacity), 5-tier type scale (`--type-micro` → `--type-large`), motion tokens, WCAG AA colour contrast across all shift types, touch targets, safe-area padding, and reduced-motion support. Navigation was the one real gap — addressed by the nav panel overhaul (v10.57). **Shipped from this audit:** Pay result hierarchy (v7.67) — period line and hint text brightened from 72%/48% to 88%/62% opacity.

---

## Future capabilities — not committed, no fixed sequence

Each area is independent unless a dependency is noted.

### Dispatcher pay calculator support
**What:** Add Dispatcher pay rates to the `GRADES` object in `paycalc-calc.js` so Dispatcher staff can use the pay calculator.

**Blocked on:** Confirmed Dispatcher pay rates from Chiltern payroll. Do not add placeholder rates — the calculator must be accurate or it misleads staff.

**Action needed:** Once Gareth has confirmed the Dispatcher hourly rate, contracted hours, and pension contribution, add a `dispatcher` entry to `GRADES` in `paycalc-calc.js` and update the grade-selection UI in `paycalc.js` to offer Dispatcher as an option.

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

**GDPR:** Staff shift data is personal data. The `faithCalendar` field stores a religious preference — see KNOWN_LIMITATIONS.md for the note on handling. If the app becomes official infrastructure, data controller status and full retention policies will need documenting.
