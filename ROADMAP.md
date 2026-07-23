# MYB Roster — Product Roadmap

*Last updated: July 2026 — v18.70 · Updated every 0.10 version*

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
- AL booking with entitlement tracking (32 days CEA incl. Fixed, 34 days CES, 22 + 1 lieu per worked BH for Dispatcher)
- Bulk override operations and override history
- Cultural calendar marker preference per member (Islamic, Hindu, Chinese, Jamaican, Congolese, Portuguese)
- Dispatcher and fixed roster types
- Firestore security rules — server-side validation of all writes

**Auth note:** The original plan specified Firebase Auth (Microsoft SSO or email/password). The implementation uses a simpler surname-based password with localStorage sessions. This was a deliberate divergence — no Chiltern IT dependency, no registration flow, works immediately for all staff. Firebase Auth has since been fully wired in (complete v7.94; named-session enforcement on since v14.98) — see CLAUDE.md → "Firebase Auth".

---

## Built since Phase 2

A changelog of shipped features. The **authoritative** record for each is the code + CLAUDE.md /
AI_MAP / the `.claude/rules/*` files pointed to below — this section is condensed to the durable
**design decisions**, the **"considered but NOT shipped"** notes, and the reverts that aren't captured
elsewhere. **Removed features (✗) keep their full revert/restoration spec below — that is the valuable
part.**

**Shipped ✓ (see the linked authoritative doc for live detail):**

- **Daily Huddle viewer** (v5.53–v6.95) — manual + Power-Automate/`ingestHuddle` upload, PDF+DOCX, push notifications. CLAUDE.md → "Huddle ingest". *(A Huddle history viewer was considered and dropped — the Huddle's value is same-day duties, not browsing.)*
- **Weekly Roster Upload** (v5.77–v5.91) — `parseRosterPDF` → Claude reads the PDF table → per-person review UI. CLAUDE.md → "Weekly Roster Upload". Durable decisions: direct PDF-to-Claude (pdf-parse destroys the table columns; Claude reads the visual layout); the `RDW|HH:MM-HH:MM` internal encoding; `source:'roster_import'` on saved overrides.
- **Payday calculator** (v6.50–v7.07) — `.claude/rules/paycalc.md`. Durable: **ONE** service worker for all pages (two SWs sharing one scope competed and wiped each other's caches).
- **Huddle push notifications** (v6.11) — Web Push via Functions; VAPID keys in Secret Manager; iOS needs Safari + installed-to-Home-Screen (confirmed reliable in daily use, v10.04). `.claude/rules/notifications.md`.
- **Huddle viewer reliability** (v8.97) — direct `window.open(storageUrl)` (dropped the Google Docs iframe + its lag), an `onSnapshot` live listener (`subscribeToLatestHuddle`), and `persistentLocalCache()` for instant cached display.
- **Pay-calc roster pre-fill** (v7.07; v8.93–v9.02) — per-category fill + confidence badges + day breakdown. **v9.02 reverted the swap/ambiguous suggestion buckets** (rest-day weekday overrides ignored again — the categorisation was wrong more often than right; now permanent — `.claude/rules/paycalc.md` "Conservatism policy").
- **Team Week View** (v8.22–v8.40) — CLAUDE.md → "Team Week View". Durable: Sun–Sat weeks (`getSunday`, Chiltern convention); the `fetchToken` stale-result discard on rapid week nav; admin-only gate dropped at v8.40 (all staff now).
- **Navigation overhaul** (v10.57–v10.71) — shared `nav-panel.js` slide-out drawer on all 6 pages; sign-out + 🔔/🔕 bell moved to the footer; header back buttons removed (return via the Calendar pill); headers → `1fr auto 1fr` centred branding. **Notification-tap PDF fix (v10.71):** a tap carries no user activation so `window.open` was pop-up-blocked — `_triggerAutoOpen()` renders an in-overlay "Open Huddle" button (the tap IS a gesture). OPERATIONS_REFERENCE.md → "Huddle notification tap behaviour".
- **Security hardening** (v10.72–74) — the v10.72 per-member write isolation was **reverted at v10.94 (production outage)**, later rebuilt as the permissive 3-tier rule (B2, v14.53) then made strict (B3, v16.29) — KNOWN_LIMITATIONS task #2. v10.73 back-pay-in-HPP was **superseded at v16.89** (it double-counted the award uplift — `.claude/rules/paycalc.md`). Plus `.gitignore`, an iOS scroll-lock `transitionend` fallback, and the May-2026 GCP API-key referrer restriction.
- **Railcard guide** (v10.30–v10.48) + **FIP guide** — `.claude/rules/guide-pages.md`, GUIDE_SOURCES.md. FIP country-finder (v17.64) + sticky section chip-bar (v17.66) + scrollspy (v17.68) shipped. **Three FIP v2 ideas deliberately NOT shipped:** per-card reliability badges (a "Confirmed" tier would over-promise against GUIDE_SOURCES' explicit "sampled, not certified" carrier posture); per-section review dates (already tracked per-row in the register — clutter on a staff reference); collapsible major sections (invasive, low value now the finder + chip-bar carry navigation).
- **Cross-page / navy-chrome / typography consistency passes** (v11.64–v11.88) — CSS-only, no behaviour change; all resulting token/surface/motion/type rules live in `.claude/rules/css-tokens.md`.
- **Huddle DOCX flow rework** (v11.66) — Power Automate flow made DOCX-first (the old noon time-of-day condition meant afternoon emails always sent PDF even with a DOCX attached); the viewer's auto-open + manual-click branches unified (`if htmlContent render inline; else "Open Huddle" button`).
- **Pay reminder infrastructure fix** (v11.65) — the daily 08:00 reminder had **never fired**: the deploy SA lacked `roles/cloudscheduler.admin` (Firebase silently failed to create the Scheduler job every deploy) and a stale `us-central1` record blocked deploys; first live 27 Jun 2026.
- **CSS extraction + infra hardening** (v12.01–05) — page/guide CSS extracted to external files; DOMPurify self-hosted; security headers (HSTS/COOP/Permissions-Policy); pre-commit ESLint + single-SDK check. **v12.05 reverted** the v12.04 anonymous-auth requirement on calendar `overrides` reads (more complexity than value — anyone can mint an anonymous token as easily as the app; KNOWN_LIMITATIONS → "Override data is publicly readable").
- **Links design workspace** (v12.06–v12.47) — `.claude/rules/links-design.md`. Durable decisions: patterns-only documents (decouples pattern design from assignment); a slot-based generator over an early/late binary (the station is staffed in **waves**, ~25 distinct start times, distinct Sat/Sun); an hourly heat map over a per-type bar chart (shows the real on-duty shape/gaps); CEAs do not work nights (`normaliseCustomShift` rejects 21:00–03:59).
- **E2E smoke tests** (v12.65 → removed v12.75 → restored v13.95) — CLAUDE.md → `e2e/`. **The one principle to preserve — whatever E2E tool is ever chosen, keep the Firebase CDN-stub approach** (`e2e/fixtures.js`): every page's module graph statically imports the gstatic Firebase SDK, and in ES modules one failed static import aborts the whole graph — so a slow/blocked CDN on a CI runner fails every test in ways no timeout/retry can fix. Intercept `gstatic.com/firebasejs/**` and serve local no-op stubs; any tool with request interception can do it.

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
**✓ Shipped at v11.69** — see the "Navy header — unified chrome" bullet under "Cross-page / navy-chrome / typography consistency passes" above. Implemented as transparent/canvas chrome (not negative-margin full-bleed), unified across all six app pages (links joined at v12.07); the icon-on-navy blocker was resolved by the icon processing in the same session. (No longer a held-back experiment; the earlier full-bleed CSS restore-kit was dropped as dead once this shipped.)

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

### ✓ DONE (v17.16): student-loan payslip integration tests

Shipped as part of the statutory-deductions patch: Plan 1 was confirmed, and `paycalc.test.mjs` now
asserts `computeSL` against every clean `sl` value in `MILLER_ACTUALS` (the regression that locks
the HMRC rounding method — the £214-vs-£213 P2 case). See `.claude/rules/paycalc.md` → Statutory
deductions.

---

### ~~Deferred: mid-year pension step for 2025/26~~ — SHIPPED v18.43

**Shipped (v18.43 — review item 8).** The "can't be read from the repo" blocker turned out to be
wrong: the per-payslip pension IS derivable from `MILLER_ACTUALS` as
`pension ≈ basic (140 × era rate) + varPay − Taxable Pay` — the derivation self-validates by
reproducing both payslip-confirmed values (£160.78 Apr–Jul 2025, £154.77 from 29 Aug 2025) in the
right eras with a consistent reconstruction bias. The old two-value `pensionPre`/`pensionFrom` pair
was generalised to the **`PENSION_STEPS`** table in `paycalc-calc.js` (newest-first, null-from
floor; `getPensionForPeriod` walks it): £160.78 → **£156.29 on the 1 Aug 2025 payslip** (a
transitional value matching NEITHER era — DERIVED, not read; correct it from the real payslip's
`Smart RPS CR Scheme` line if ever checked) → £154.77 from 29 Aug 2025 → £147.36 from 8 May 2026.
Historic 2025/26 periods now default the right pension (the ~£6 take-home overstatement is gone),
and the year-so-far summary inherits the fix via `getPensionDefault`. The companion
KNOWN_LIMITATIONS deferral ("pension default is frozen onto a touched period") was closed in the
same change — `readFormData` stores `null` when the field still equals the period's default.
---

### Deferred: validate the back-pay accrual against the real 24 Oct 2025 payslip

**What:** Two assumptions in `calcBackPay` are payslip-checkable but unverified: (1) the accrual includes the **full April-paid period** (P4, paid 11 Apr 2025) even though its work window is mostly late March — if Chiltern pro-rates the award from literal 1 April, P4's row overstates slightly; (2) the per-bucket arithmetic (`_accrueBackPayPeriod`) should reproduce the real lump when the 2025/26 hours are entered. The 24 Oct 2025 payslip carries the actual back-pay lines (the basic-line spike was ~£591 vs a contracted-only estimate of ~£730 including London — the gap is explainable by variable-line placement, but unconfirmed).

**Blocked on:** Reading the 24 Oct 2025 payslip's back-pay line breakdown (Gareth has it).

**When to do it:** One-time check; if P4 turns out to be pro-rated, add a first-period factor to the accrual and a fixture-based test.

---

### Possible: "Fill this year from calendar" — bulk roster pre-fill (paycalc)

**What:** The last open item (7) of the July 2026 pay-calculator improvement plan (items 1–6, 8, 9,
11 shipped v18.39–v18.44). One tap runs the roster-assist pre-fill across **every paid-but-empty
payslip of the viewed tax year** — instead of visiting each period and filling it individually.
The multiplier for everything shipped around it: the HPP hours estimate, the back-pay accrual, and
the "This tax year so far" summary all sharpen directly with filled periods, and the v18.42
"Not entered yet: 10 Apr, 8 May" lines name exactly what one tap would fix.

**Guard rails (already decided):**
- **Never overwrites** a period the member has entered — only paid-but-empty periods are touched
  (the same paid/empty test the "Not entered yet" lists use).
- Fills follow the existing **conservatism policy** (v9.02): premium categories only
  (Sat/Sun/BH/Boxing/RDW from base roster + overrides) — no inferred ambiguous categories, no
  standard weekday hours.
- Filled values are **marked as roster-suggested** (gold), exactly like the single-period pre-fill,
  so the member can see and correct what was assumed; the result card's 📅 "Hours from calendar"
  provenance chip (v18.44) then discloses it on each affected payslip.

**Design questions to settle with the owner before building (deliberately not decided):**
1. **Where the button lives** — leaning: beside the "Not entered yet: …" lines (HPP card and/or
   the year-so-far block), since they name what it fixes; alternative: the roster-hint bar.
2. **Confirm or not** — leaning NO confirm (it can't overwrite anything) with a clear receipt
   afterwards ("Filled 2 payslips from your calendar: 10 Apr, 8 May"); the alternative is a
   preview-first flow, which fights the one-tap point.
3. Whether the fill needs Firestore overrides for HISTORIC months (the override cache may not span
   the whole year client-side — check `fetchOverridesForPeriod` coverage) or base-roster-only is
   acceptable for old periods.

**Effort:** medium — the per-period suggestion engine (`getRosterSuggestion` /
`fetchOverridesForPeriod`) already exists; the work is the loop, the receipt UI, and the tests.

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
`icon-badge.png` (white-on-transparent, 96px) shipped, SW-precached, used by the push handler.
Rule ("never use `icon-192.png` as the badge") lives in `.claude/rules/notifications.md`. No further work.

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

> **⚠️ Status update (v18.63): the "C-lite" plan in `PASSWORD_PLAN.md` (SECURITY_RELEASE_PLAN → Track C) has since superseded parts of this five-stage sequence — and it did NOT wait on email verification.** Already SHIPPED: **self-service password change** (Stage 3 — Settings → Password card, `savePasswordSetAt`), the **admin break-glass reset** (below — `resetMemberPassword` Cloud Function, Operations → Account status → Reset), and the **`ensureFirebaseSession` rework** that Stage 3 named as a prerequisite (`credentialCandidatesFor` gated dual-attempt sign-in). Migration is now tracked by the **`passwordStatus`** collection (`passwordSetAt`/`resetAt`), not the unbuilt `staffContact.verified`. Still open: Stage 2 (email verification, needs an email relay), the Stage-4 *email-based* self-service reset, and Stage 5 (retire the surname default). Read PASSWORD_PLAN.md for the authoritative current state; the stage text below is the original design.

**Stage 1 — Work email registration ✓ (v12.68)**
Settings page → Work Email card. Staff enter their Chiltern work email. Saved to the new `staffContact` Firestore collection (owner-only write via `name` JWT claim; admin read-all). This is the data foundation all later stages build on. Work email only — no personal email (the company already holds the work address; no separate GDPR policy required for something Chiltern already processes).

**Stage 2 — Email verification**
Send a 6-digit time-limited code to the registered work email when the member taps "Verify" in the Work Email card. A Cloud Function (extend `setupRosterAuth` or add a new `verifyContactEmail` function) sends the email via Power Automate relay (already used for Huddle ingest) or Firebase Trigger Email, and marks `staffContact.verified = true` on correct code entry. **The client cannot set `verified` itself** — the flag must be server-set via Cloud Function to prevent self-verification without genuine email access.

*Decisions needed before building:* code expiry window (10 minutes is standard); retry/rate-limit policy; whether to allow email correction before verification (or require admin contact if the wrong address was saved).

**Stage 3 — Self-service password change (while logged in)** — ✅ SHIPPED v18.63 (Track C, decoupled from Stage 2)
A dedicated **Password card** in Settings (not gated on email verification — that decoupling is the "C-lite" change). Member enters their current password + new password twice → `reauthenticateWithPassword` + `setOwnPassword` (`updatePassword` + `savePasswordSetAt`) via Firebase Auth.

*Critical prerequisite — `ensureFirebaseSession` rework:* ✅ DONE v18.63. `credentialCandidatesFor(fullName, typed)` (`auth-identity.js`) builds an ordered candidate list (typed password first, surname fallback only while still on it) and `ensureFirebaseSession` tries each — so a member on a self-set password authenticates without landing on anonymous. *(Original problem, for context:)* The old implementation assumed `password = normaliseSurname(name)` and silently fell back to an anonymous session on failure. A member who has set a custom password will have `ensureFirebaseSession` try the surname, fail, and land on an anonymous session — they will appear not logged in to Firestore writes even though their localStorage session is valid. **Before Stage 3 ships**, `ensureFirebaseSession` must be updated to detect this case: catch `auth/wrong-password` / `auth/invalid-credential` specifically and surface a "Please sign in again" prompt rather than silently falling back to anonymous.

*Ordering:* Stage 4 (reset path) should ship before or alongside Stage 3 so a member who forgets their custom password has a self-service recovery route and does not have to contact admin.

**Stage 4 — Forgotten-password reset (self-service)**
Recovery flow without admin involvement: a "Forgot password?" link on the login screen → member selects their name → Cloud Function looks up `staffContact.workEmail` where `verified == true` → sends a one-time 6-digit code → member enters the code + chooses a new password → Cloud Function calls `admin.auth().updateUser(uid, { password })` via Firebase Admin SDK.

Code expires after 10 minutes; 3 failed attempts invalidate it (member must request a new code). The reset endpoint must be a Cloud Function — client-side `sendPasswordResetEmail` sends to the synthetic Firebase Auth email (`name@myb-roster.firebaseapp.com`), not the member's real work address.

**Admin break-glass:** ✅ SHIPPED v18.63. Operations page → **Account status** → **Reset** → the `resetMemberPassword` Cloud Function resets a member's password to the surname default (and revokes their refresh tokens by default). Always available regardless of verification status. Use when a member cannot access their work email or is locked out during rollout.

**Stage 5 — Retire the surname password**
Once Stages 2–4 are live and staff have had adequate time to migrate:
1. Show a persistent Settings banner to any member still on the surname-derived password, prompting a change.
2. Remove the surname-password seed from `setupRosterAuth` new-starter setup — new starters receive a temporary code via work email instead.
3. Remove the surname fallback from `ensureFirebaseSession`.

*This stage is irreversible* — once the surname fallback is removed, staff without a custom password can only recover via Stage 4 (or the admin break-glass reset). Do not ship Stage 5 until ≥90% of active accounts have set a custom password (monitor via the **`passwordStatus`** collection — a doc with `passwordSetAt >= resetAt` = migrated — vs active `teamMembers`; the Operations Account-status card already renders this count. The old `staffContact.verified` field was never built).

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

**Why this is a constraint:** `roster-data.js` is a browser ES module; `functions/index.js` is Node.js CommonJS. The two module systems cannot import from each other. This forces duplication of any data needed by both sides — most visibly the roster name/role lists, though that specific risk is now MANAGED via codegen: `functions/roster-members.json` is generated from `roster-data.js` by `npm run generate:roster-members` and CI-locked by `sw-asset-check.test.mjs` (a new starter missing the generate step fails the build, not the parse). A build step would remove the codegen step by compiling one shared source into both targets.

**When the threshold is "probably worth it":**
- The codegen/duplication pattern spreads (a second generated file, or a shared-logic duplicate beyond `normaliseSurname`) and drift starts slipping past the CI locks
- TypeScript adoption is desired (meaningfully improves safety across the larger files)
- Bundle size starts affecting load time on staff phones

**Recommended tool when the time comes: Vite**
- Minimal config; native ES modules; good Firebase and PWA plugin support
- Output looks very similar to what you write today — the transition is not bewildering
- GitHub Actions workflow change: add `npm run build` before the Firebase Hosting deploy; point the deploy at the `dist/` output directory rather than the source root
- Cloud Functions remain separate (they have their own `functions/package.json` and are not bundled by Vite)

**Do not add a bundler speculatively.** The current no-build setup is the right call while the app is small enough that every file is readable without tooling. Add complexity when the pain of not having it is concrete.

**Load-time measurement — the calendar (Jul 2026, field + local).** Field telemetry (Operations → App Speed) shows the calendar is the slowest page but ~85% of loads are sub-second — good, not a problem. A local investigation into the >1s tail characterised *what* gates its first paint, so a future optimiser doesn't chase the wrong lever:
- The paint path is fully synchronous (base roster renders with no `await`); every Firestore write is gated behind `calendarAuthReady.finally(…)`, off the critical path. Nothing is blocked on a query.
- Under **6× CPU throttle**, FCP moved only 272 → 360ms — i.e. eager JS execution is **~18ms**. The cost is **not** parse/execute; it's **fetching the module graph** (35 JS files before FCP; the slowest single request ~104ms is the Firebase SDK).
- **Consequence — lazy-loading modules (dynamic `import()`) does NOT help here.** It reduces execution cost, and execution isn't the bottleneck; it would only add a fetch round-trip when a deferred feature (huddle/doc viewer) is first used. Measured and rejected — do not re-propose without new evidence.
- **The only real levers are file-count/size on the eager path:** (a) a bundler (this section — collapses ~35 files into 1–2), or (b) deferring the **Firebase SDK** off the eager path (render base roster first, then load Firebase + fetch). (b) is the single biggest item but high-risk — `firebase-client.js` is imported transitively across the module graph. **Neither is worth its risk while the page is 85% sub-second.** Reach for (b), or reconsider the bundler, only if the App Speed card shows the calendar tail drifting materially worse.

---

## Open decisions

**Auth hardening:** A five-stage plan to replace the surname-based password with a custom password backed by verified work email is documented under "Password security improvements" above (Stage 1 shipped v12.68). The staged approach preserves the name-dropdown login UX while progressively adding security. Key risk during rollout: `ensureFirebaseSession` must be reworked before Stage 3 ships — see that entry. See also KNOWN_LIMITATIONS.md → the four v11 security tasks (task #2, Firestore member write isolation, shipped STRICT at v16.29) for related context.

**Multi-admin:** ✓ Resolved — `CONFIG.ADMIN_NAMES` is now an array in `roster-data.js`. Adding another admin is a one-line change (name must match `teamMembers[n].name` exactly).

**Official status:** Is this app sanctioned by Chiltern Railways? The more operationally critical it becomes, the more important this question is.

**Profile photo / avatar:** ✓ Decision taken — removed at v12.22 (the nav-panel footer badge now shows initials on a stable per-name colour). See the "Profile photo / avatar" entry above for the restore checklist if it ever comes back.

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
- **Per-member override + Links write isolation — ✓ DONE (v16.29).** The headline authorisation
  gap, closed: override isolation strict (B3) + Links designer-claim writes (H2) in the same
  release. Full history: the "Security project — per-member override write isolation" section
  above; live rule detail: SECURITY_RELEASE_PLAN.md B2/B3.
- **Separate named sessions from the anonymous public session** — ✓ **effectively SHIPPED via B1**
  (`ENFORCE_NAMED_SESSION = true`, v14.98). Anonymous auth is already confined to the public Calendar
  read bootstrap (`calendarAuthReady`); the four write pages (Admin/Operations/Links/Settings) already
  refuse the anonymous fallback and re-prompt a named login, and Pay stays soft (it writes no isolated
  data). B1.1 (v14.40) removed the anonymous fallback + self-heal from `ensureFirebaseSession` on the
  write path. **One dormant residual, deliberately held:** the `signInAnonymously` fallback branch and
  the `CONFIG.ENFORCE_NAMED_SESSION` flag still physically exist in `session.js` — the fallback is
  unreachable *while the flag is on*, so retiring both (and making named-only permanent) is pure dead-
  code removal, **not** a behaviour change. It is being left in place on purpose: the flag is the
  one-line, no-rules-deploy rollback for the whole B1/B2/B3 named-session + isolation release, and the
  release is still soaking. **Do it only after a few weeks of clean production running** and once
  self-service recovery (C4) reduces the value of an instant rollback. Retirement scope + checklist:
  SECURITY_RELEASE_PLAN.md → "B1 detailed scope" → "Deferred residual".
- **Remove browser-side account creation** — ✓ **effectively DONE via B1.1** (v14.40):
  `ensureFirebaseSession` no longer self-creates a Firebase account with `createUserWithEmailAndPassword`
  on the write path. The provisioning prerequisite (every member has a server account before B1) is in
  place, and `/new-starter` marks "Set up accounts" mandatory. Same dormant residual as above — the
  self-heal `create` call sits alongside the anonymous fallback under the `ENFORCE_NAMED_SESSION` guard
  and is retired in the same cleanup.
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

Done: the `pushSubscriptions` delete posture and the bearer-URL read distinction (open Firestore
metadata read; Storage object reached via a tokenised URL that bypasses Storage rules) are stated
accurately in the docs + rule comments. **Since tightened (A5 / F-SEC-5, v17.76):** the delete rule is
now **per-owner** — an authenticated session may delete a subscription only if
`resource.data.owner == request.auth.uid` (or the legacy doc carries no `owner`), so merely knowing a
doc id no longer permits deletion. (This superseded the earlier "any authenticated identity that knows
the doc id" posture described above.)

---

## Usage analytics ✓ (v14.14)

Anonymous usage visibility in the Operations page (📊 Usage card): active-account counts + page
popularity. Built first-party in Firestore — **not** Google/Firebase Analytics, which would breach
the `script-src 'self'` CSP and the no-third-party-CDN rule and ship data to Google. The full data
model (client-side dedup, no identity stored server-side, collection shape, module split) is
documented canonically in **CLAUDE.md → `analytics` collection** — this entry records the decisions,
not the model.

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

**Where we are (latency work current to v16.10) — two independent latency tracks:**
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
  `sw-asset-check.test.mjs` guards the list against the page's real transitive graph AND against the
  SDK version pinned in `firebase-client.js`, so it can't silently drift. **The two heaviest pages —
  paycalc AND the calendar (`index.html`) — now carry the FULL graph + SDK-URL preload** (~35 local
  modules + the 3 gstatic URLs each, both CI-locked); the four write pages deliberately have none
  (shallower graphs, less latency-critical) and rely on `preconnect` alone — `sw-asset-check.test.mjs`
  locks their zero-preload state too. There is **no plan to extend the preload further** — each
  page's SDK preload needs its own drift guard (the Batch 1 reason). **Let this settle** (watch the
  Operations App-speed data) before the deferred lazy-Firebase pass below.

- **v16.09–v16.10 — service-worker deep pass (owner-approved architecture changes).** Navigation
  Preload, SWR-throttling, chunked warm-up, first-install double-load fix, redirect hygiene
  (v16.09); HTML joined JS/CSS as stale-while-revalidate and the gstatic Firebase SDK moved to a
  cache-first SDK-versioned cache (v16.10). The full current caching model is documented
  canonically in **CLAUDE.md → "Service worker caching"** — this entry is the shipped-batch record.
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
improvements — staged plan"** above — do not re-number the stages here. In brief:

- Stage 1 ✓ (v12.68): Work-email registration via `staffContact`.
- Stage 2: Email verification.
- Stage 3 ✓ (v18.63, Track C): Self-service password change (while logged in) — shipped decoupled from email.
- Stage 4: Forgotten-password reset — **admin break-glass shipped v18.63**; the *email-based* self-service half remains.
- Stage 5: Retire the surname-derived password.

Only the **email-based** routes (Stage 2, and Stage 4's self-service half) are parked pending the owner
setting up Power Automate (the email-delivery channel). The chosen-password core (Stage 3 + admin reset)
shipped without waiting on it — see the "C-lite" status note under the staged plan above.

**Note:** per-member Firestore write isolation (`request.auth.token.name == memberName`,
suspended at v10.94, rebuilt permissive at v14.53, now **strict and LIVE as of v16.29**) is a
**separate** security project — see "Security project — per-member override write isolation" above
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
MILLER_ACTUALS export guard, the primeAuth comment) shipped at v14.99. Two items were captured here — **both now resolved:**

### M8 — lazy-load heavy Cloud Function dependencies (cold-start) — ✅ SHIPPED

`functions/index.js` now lazy-`require`s all three heavy deps inside the paths that use them, each
tagged with an `M8:` comment: `mammoth` only for DOCX huddle conversion, `web-push` via a cached
`_webpush` accessor in the notification fan-out, and `@anthropic-ai/sdk` only in `parseRosterPDF`. No
top-level require of the three remains, so a function no longer pays their load cost when it doesn't
use them.

### L4 — paycalc collapsible fixed `max-height` — ✅ CHECKED, within cap (no fix needed)

`paycalc.css` gives open collapsible bodies a fixed `max-height` for the open/close animation.
**Checked (v16.29):** the tallest real content is well within the cap. The `.bd-body` back-pay
breakdown accrues at most one row per period in a single award tax year (≤ ~13 rows, capped at
`todaysPeriodNum()` and excluding the paid-in period) and the result breakdown is a fixed ~20-line
category list — ~550–800px against the 1400px cap; print already unclips it. So it does not clip at
realistic sizes, and `max-height:none` would break the animation. A finite cap is correct here; the
`paycalc.css` comment records the reasoning. Only revisit if a future breakdown could exceed the cap
(then prefer measure-height-and-drop-cap-after-`transitionend` over a bigger magic number).
