# CLAUDE.md

*Last updated: November 2026 — v27.30 · Updated every 0.10 version*

# Claude Code Instructions — MYB Roster App

## Project identity — read this first

| Property | Value |
|----------|-------|
| GitHub repository | `Garethdavidmiller/roster-app` |
| Firebase project ID | `myb-roster` |
| Firebase project region | `europe-west2` (London) |
| Documentation milestone | `27.30` — the 0.10 checkpoint these docs are written against, and **deliberately NOT the current version**, which only `APP_VERSION` in `roster-data.js` states. The stamp in every stamped doc (this file, AI_MAP, OPERATIONS_REFERENCE, KNOWN_LIMITATIONS, ROADMAP) is held to the latest milestone by `sw-asset-check.test.mjs` and `githooks/pre-commit`, so a bump crossing a 0.10 line fails until each is reviewed and re-stamped. |
| Hosted URL | Deployed to Firebase Hosting via GitHub Actions on push to `main` |
| Staff-facing URL | `https://myb-roster.web.app` — canonical, the **primary install + notification target**. The GitHub Pages mirror `https://garethdavidmiller.github.io/roster-app/` (**note the `/roster-app/` path**; the bare origin 404s) still serves about **half the staff**: installed users are roughly level between the two (owner, 27 Nov 2026 — the gradual changeover is working; it was most staff in Sep 2026). It serves **no redirects and no HTTP headers**, so weigh any change that relies on Firebase Hosting against the mirror, not the canonical URL — which is why every page carries a `<meta>` CSP. ARCHITECTURE.md EXC-006; the API key note below. |
| Cloud Function URLs | Base `https://europe-west2-myb-roster.cloudfunctions.net/` + the endpoint name. Each endpoint's header holds its rules; the two that are easy to get wrong are marked: |
| | `ingestHuddle` (Power Automate, server to server, bearer `HUDDLE_SECRET`) · `parseRosterPDF` (`.claude/rules/roster-import.md`) · `setupRosterAuth` (accounts and claim tiers from `functions/roster-members.json`) · `rotateDocumentLinks` (admin, EXC-007) · `getSignInStats` (admin READ, four integers, no identity) · `getAccountSetupGaps` (admin READ; it returns NAMES, so it stays apart from `getSignInStats`) |
| | `resetMemberPassword` — admin break-glass to the surname default, and `requestPasswordReset` — the only public unauthenticated endpoint, which records a request and resets nothing. **Both push through `sendTargetedPush`, never `fanOutPush`, and never carry a password** (a push renders on a lock screen); a reset for a lost or stolen phone sends no notice and deletes its push records. `.claude/rules/notifications.md` |
| | `getDocumentUrl` — a SHORT-LIVED URL for the latest Huddle / Circular / Newsletter; the caller names a KIND, never a path. **It needs `roles/iam.serviceAccountTokenCreator` on the runtime service account, granted to ITSELF**, or every call 503s (RECOVERY_RUNBOOK.md). AUTH_AND_SESSIONS.md → E6 |
| | The five Overtime endpoints — not deployed while Overtime is paused (OVERTIME_AVAILABILITY.md) |
| Development branch convention | `claude/<description>-<sessionId>` — always push to this branch, never directly to `main` |

**Secrets** (Firebase Secret Manager; no workflow reads any of them — deploys authenticate by Workload
Identity Federation, and the old `FIREBASE_SERVICE_ACCOUNT` key is retired: RECOVERY_RUNBOOK.md →
"The deploy identity"): `HUDDLE_SECRET` (bearer for `ingestHuddle`) · `ANTHROPIC_API_KEY` (`parseRosterPDF`) ·
`VAPID_PRIVATE_KEY` (Web Push; the PUBLIC key is a literal in `functions/index.js` **and** `notif.js`,
and the two must match).

**Workflows:** `deploy-functions.yml` · `deploy-hosting.yml` · `deploy-rules.yml`, all by Workload
Identity Federation, each `deploy` job alone holding `id-token: write` and running no test
(`workflow-hygiene.test.mjs`). **The three fire in PARALLEL from one push, with no ordering
guarantee**, so any change where the new client DEPENDS on new rules (a new override field, a new
analytics counter id, a new collection) ships **backend-first, in its own push**: rules that ACCEPT the
field first, the client that WRITES it only after the rules deploy is confirmed — in one push every
such write permission-denies for minutes, and it has happened. Loosening the other way is always safe.
**The Pages mirror** is published by `deploy-mirror.yml`, only from a commit a passing Hosting run
released. The root **`.nojekyll`** marker is the way back to a branch-built mirror — do not delete it
(OPERATIONS_REFERENCE.md → "The Pages mirror").

**⚠️ Firebase API key referrer restriction — add every domain the app is served from.** The web API
key is restricted to HTTP referrers (GCP Console → APIs & Services → Credentials). If a domain is
missing, **every Firebase Auth call fails** — sign-ins, Firestore writes, push subscriptions — and
nothing on screen names the cause. The allowlist must include `myb-roster.firebaseapp.com/*`,
`myb-roster.web.app/*` and `garethdavidmiller.github.io/*` (until GitHub Pages is retired). A new
domain means updating the allowlist **and `ADMIN_FUNCTION_ORIGINS` in `functions/index.js`** in the same
change — KNOWN_LIMITATIONS.md task #1.

---

## Deployment health check — do this occasionally (and in every review)

> **⚠️ The installed PWA hides live-site breakage.** An installed phone launches, and even updates,
> from the service-worker cache **even when the live site is completely broken** — a real outage went
> unnoticed exactly this way. **"My phone works" is never evidence the site is up.**

**Verify the LIVE URLs in a fresh browser / private window (no cache, no SW):**

- [ ] `https://myb-roster.web.app` — loads *past* the splash to the calendar
- [ ] `https://garethdavidmiller.github.io/roster-app/` — loads (not `404`; **note the `/roster-app/` path**)
- [ ] A sub-page deep-link works (`/admin.html`, `/paycalc.html`) — not just the root
- [ ] DevTools → Console on each shows **no red errors** (CSP / failed module / `404` / `api-key-not-valid` / referrer-blocked)

**Cadence:** every review, **and** immediately after any change to `firebase.json` (CSP/headers), the
Firebase SDK version, the API-key referrer allowlist, or the hosting/Pages setup. Rationale and the
symptom table: KNOWN_LIMITATIONS.md → "The installed PWA masks live-site breakage". **After every merge
that deploys, run `npm run test:live` once Deploy Firebase Hosting and the mirror's deploy have
FINISHED** — not at the merge, which reads the previous release (README.md → "The test lanes").

---

## Version bumping (MANDATORY on every change)

**Every change a user can see or experience is bumped, with `npm run bump <version>` (e.g.
`npm run bump 13.48`) — never by hand-editing.** That means logic, data, UI text, CSS, security rules,
HTTP headers, the manifest and service-worker caching. Pure `.md` edits, tests, CI and dev scripts do
not bump. **A comment-only change to a served file does** — any `.js`, `.css` or `.html` the app serves,
or anything under `functions/` — because CI's `version` job (`e2e.yml`) cannot tell a comment from
code. **If in doubt, bump**: a missed bump serves staff a stale cached asset. **Before every `git
commit`, ask: did this touch anything a user can see or experience?**

The rules; the incident behind each is DECISIONS.md → "Version bumping and merging — the incidents
behind the rules".

- **Bump against `main`, NOT the branch you started from** — re-check `git show
  origin/main:roster-data.js | grep APP_VERSION` immediately before merging. Two branches on one number
  merge without conflict and ship a byte-identical `service-worker.js`, so no device updates.
- **A gap in the version space is the rule working** — never reuse a number to close it up.
- **The increment is exactly 0.01 per change — never 0.10**, and never a value ≤ `main`'s: the version
  names the SW cache. The "every 0.10" rule below is only when to re-stamp the docs.
- **"CI is green" means the run that COMPLETED included the `version` job, and no run FAILED** — one of
  each PR's two runs is cancelled by design. A red `version` job on a release that shipped fine is
  probably the two-runs trap (`e2e.yml`).
- **Do not stack a branch on an unmerged one** — `main` squash-merges. **Once your own PR has
  squash-merged, restart its branch from `main`**; where a force push is refused, `git checkout -B
  <branch> origin/main && git merge -s ours origin/<branch>` makes the restart a fast-forward.
- **One Playwright run at a time, and do not switch branches under one** — they share a dev server
  and `test-results/`.

**2 runtime bump locations**, both written by `npm run bump` (`scripts/bump-version.mjs`) and checked by
`sw-asset-check.test.mjs`: `export const APP_VERSION` in `roster-data.js` (the **primary source**) and
`const APP_VERSION` in `service-worker.js` (names the SW cache). No version comment stamps and no `?v=`
strings — do not add either back; freshness is `Cache-Control: no-cache` plus the version-named cache.

**Documentation update policy:** every **0.10 version** (e.g. 10.10 → 10.20), or immediately on: new pay
grade, auth/Firestore model change, SW strategy change, new page or module, data model change.

**Same-commit rule:** a commit that adds, removes or renames a JS module — **or removes/renames an
exported symbol** — updates `docs/FILE_INDEX.md` and `docs/AI_MAP.md` too (the export line is written by
`npm run generate:ai-map`, never by hand). `githooks/pre-commit` enforces it, and also blocks a stale
doc stamp, runs ESLint on staged JS, and refuses a second Firebase SDK version in `firebase-client.js`.

---

## How to work with the owner

Gareth built this app through extended Claude.ai collaboration. He has strong operational knowledge and is actively learning software development. Every session is both development and teaching.

- **Explain decisions** — what, why, what the alternative was
- **Plain language first** — explain new concepts before implementation
- **Name the pattern** — name any design pattern and say why it fits
- **Flag trade-offs** — briefly note what the other option was
- **Never assume prior knowledge** of cloud services, auth patterns, or backend concepts
- **UK English** — British spelling, 3 November 2026 dates, 24-hour times: in all app copy and every message to the owner (owner, 3 Nov 2026; `uk-english-parity.test.mjs`)

---

## Compact instructions

When compacting, always preserve:
- The list of modified files and their purpose
- Any unresolved errors or test failures
- The current version number being worked on
- Any decisions made about architecture or approach
- The branch name

---

## Area rules — what loads only when you open an area's files

Each `.claude/rules/*.md` file loads automatically when a file matching its `paths:` globs is read or
edited. **Read the one for your area before changing it**: it holds the "never change without
discussion" decisions that bind only that area. A decision that binds more than one area stays here.

| Rule file | What it holds | Loaded by |
|---|---|---|
| `calendar.md` | the Calendar page | `index.html` · `index.css` · `calendar-*` · `e2e/calendar*.spec.js` |
| `admin.md` | the Admin page, Change a Shift, leave on a rest day | `admin.*` · `admin-*` · `al-contract` · `al-entitlement*` · `al-swapped-days*` · `e2e/admin*.spec.js` |
| `nav-drawer.md` | the drawer, About, sign-out, the bell, Android Back, the topmost overlay | `nav-panel.js` · `nav-destinations.js` · `nav-guide-search.js` · `overlay.js` · `about-lightbox.js` and their tests |
| `pwa.md` | the service worker's caching and update lifecycle, the manifest, Firestore's local cache | `service-worker.js` · `sw-register.js` · `sw-*.test.mjs` · `manifest.json` · `firebase-client.js` · the offline lane |
| `sessions.md` | one local session, re-establishing Firebase on load, write isolation, the claim tiers | the session, sign-in and auth modules · `firestore.rules` · the functions' auth and identity files |
| `roster-data.md` | the member fields, `rosterChanges`, the cycles and fixed patterns, `APP_VERSION` | `roster-data.js` · `roster-cycle-data.js` · `roster-member-data.js` · `roster-roles.js` |
| `roster-import.md` | the weekly roster import, and every defence against a week on the wrong days | the import modules and `functions/roster-*` |
| `paycalc.md` | the Pay Calculator | `paycalc*` |
| `link-designer.md` | the Link Designer | `link-designer*` |
| `css-tokens.md` | surfaces, colour, type, motion, spacing, focus, the app-drawn controls | every `*.css` |
| `guide-pages.md` | the guide pages | the guide pages |
| `notifications.md` | the push notification language and the single builder | the push senders, `notif.js`, `notif-card*.js`, `service-worker.js` |
| `operations.md` | the Operations page | `operations*` · `al-leave-*` · `e2e/operations.spec.js` |
| `staff-copy.md` | the owner's standard for words that teach, and the reasons behind the wording conventions below | every page's HTML · `*-words.js` · `*-tips.js` · `*-render.js` · the notices |

---

## Feature contracts — read one BEFORE changing a feature

> **Lost? `ARCHITECTURE.md` is the index**: which document is authoritative for each subject, **what is
> deployed where that differs from what the documents describe** (the `EXC-*` table), and what the four
> status words mean.

Five documents state, as numbered invariants, what each feature must never stop doing — routing
tables, each row pointing at the module header that argues it:

| Feature | Contract | What it protects |
|---|---|---|
| Calendar data | `CALENDAR_DATA.md` | what may be SHOWN, and when — knowledge states, the access gate, cache ordering |
| Authentication | `AUTH_AND_SESSIONS.md` | session ↔ identity ↔ claim, the three ways they disagree, and a write whose account has gone |
| Overtime | `OVERTIME_AVAILABILITY.md` → Invariants | the frozen population, the deadline clock, no-response ≠ not-available |
| Pay calculator | `.claude/rules/paycalc.md` → Invariants | round trips, per-member keys, and never guessing a figure |
| Link Designer | `.claude/rules/link-designer.md` → Invariants | advisory vs hard limits, co-editing, refusing rather than half-loading |

**When an invariant changes, the row changes in the same commit** — a contract nobody updates is
worse than none, because it is believed.

## Change impact — what one edit reaches

Most of this app is one page deep. These are the exceptions, and every one of them has caused a
regression somewhere the author was not looking.

| Change this | And you have changed | Verify with |
|---|---|---|
| `resolveEffectiveShift` (`override-utils.js`) | Calendar · Team Week View · Admin · Overtime roster context | `override-utils.test.mjs` · `e2e/overtime.spec.js` |
| `calendar-renderer/-swipe/-keyboard/-legend.js`, `index.css` | the Links Selector | `e2e/links-selector.spec.js` |
| the day-detail panel (`calendar-al-lightbox.js` + its `index.css` block) | the ONLY place a member reads what a day is on touch — its two shipped defects were invisible to behaviour | `e2e/calendar-day-detail.spec.js` · `lightbox-transform-parity.test.mjs` · `day-detail-explains.test.mjs` |
| `getBaseShift` / `resolveMemberRoster` (`roster-data.js`) | every shift the app displays, on every page, plus roster PDF import | `roster-data.test.mjs` · `admin-roster-upload.test.mjs` |
| `christmas-leave.js` (`resolveDayShift`, `boxingDayLieuDays`) | 25/26 December on every surface that draws a day, the leave records, the allowance (`entitlementFor`) and Admin's save checks | `christmas-leave.test.mjs` · `admin-al-projection.test.mjs` · the `christmas` e2e (`calendar-leave-panel`, `admin-leave-records` specs) |
| `session.js` · `silent-sign-in.js` · `login-overlay.js` · `login-core.js` · `auth-policy.js` · `page-session.js` · `page-start.js` | every app page at once — `page-session.js` is every page's sign-out, unsaved-work question, Back-after-sign-out guard and session-loss sign-in; `page-start.js` every sign-in page's start-up | `e2e/auth.spec.js` · `page-session.test.mjs` · `page-start.test.mjs` · `page-contract-parity.test.mjs` |
| `claim-retry.js` / `withClaimRetry` (`firebase-client.js`) | every write, what it reports when its outcome is unknown, and when any page may reload for an update | `claim-retry.test.mjs` · `sw-register.test.mjs` · `e2e/admin-saves.spec.js` · `e2e/operations.spec.js` |
| a COLLECTION's fields | `docs/DATA_MODEL.md` + `firestore.rules` + the client writer, together | `npm run test:rules` runs the REAL writers of `overrides` (`buildOverrideWrite`), `analytics`, `clientErrors`, `linkTargetSets` and the three documents, and `al-leave-save.test.mjs` pins `alUploads`; for `staffContact`, `passwordStatus`, `pushSubscriptions` and `linkDesigns` check the writer's keys against the rule's `hasOnly()` BY HAND |
| `firestore.rules` | client and server together — the client copies of ownership rules only drive BUTTONS | `npm run test:rules` **and** `firestore-contract-parity.test.mjs` |
| `firebase.json` CSP header | every page's `<meta>` CSP, because the Pages mirror serves no headers — run `npm run generate:copies`, which writes them | `generated-copies.test.mjs` · `csp-meta-parity.test.mjs` · `npm run test:csp` |
| the Mammoth version (`huddle.js`) | the CSP `script-src` in `firebase.json` and every page's `<meta>`, which name that version's folder | `dependency-pin-parity.test.mjs` |
| any `overlay.js` lifecycle | every lightbox in the app, including the one-time notices | `overlay.test.mjs` · `overlay-history.test.mjs` |
| adding a PAGE | ONE entry in `scripts/app-pages.mjs`, a `PAGE_POLICIES` entry and a nav pill (whose name the Operations reports read), then `npm run generate:copies`, which writes the SW, rules analytics id and guide back-arrow lists | `page-contract-parity.test.mjs` names each list the page has not joined |
| adding a MODULE or changing its exports | `docs/FILE_INDEX.md` + `docs/AI_MAP.md`, same commit; `npm run generate:copies` | `githooks/pre-commit` · `doc-parity.test.mjs` |
| `CONFIG.ADMIN_NAMES` / `MANAGER_NAMES` / `LINKS_DESIGNERS` / `OVERTIME_BETA` / `OVERTIME_ENABLED` / `MAX_YEAR` / `FIRST_PAYDAY` / `PAYDAY_INTERVAL_DAYS`, or any `teamMembers` row | the SERVER's copy — run `npm run generate:roster-members` in the same commit | `sw-asset-check.test.mjs` |
| a Firebase SDK bump (`firebase-client.js`) | `FIREBASE_SDK_VERSION` in `service-worker.js` and every page's SDK preloads — run `npm run generate:copies`, which writes both | `generated-copies.test.mjs` |
| the VAPID key | `functions/index.js` **and** `notif.js` — a mismatch is silent AND permanent | `sw-asset-check.test.mjs` |

---

## Current file structure

**The file catalogue is `docs/FILE_INDEX.md`** — one line per file. It ROUTES; it does not explain,
and it is not a changelog. Three homes, one fact each:

| What | Where | Why there |
|---|---|---|
| **Routing** — what a file is, what it owns | `FILE_INDEX.md`, one line | it is what you need before you have opened anything |
| **Design reasoning** — the invariants an edit can silently break | the module's own header | it is where an editor is already looking, and it cannot drift from the code beside it |
| **Release history** — what changed at which version | git log | it describes the past; it cannot be checked, and it is read almost never |

A fact kept in two places drifts, and that drift is behind every stale doc claim this repo has had to
correct. So a new module gets a one-line `FILE_INDEX.md` entry and its argument in its header
(`AI_MAP.md` carries each module's generated export list and the task → file table). Reasoning leaves a doc only
after it is verified in the module header. `doc-parity.test.mjs` caps this file's size, because it is
loaded into every session.

**The rule tested, the wiring not** — the named risk. A helper can be perfect and the answer still
wrong, because the production line that calls it passed the wrong argument, was never called, ran in
the wrong access context, or had its result discarded. So, for anything that moves money, decides
access, or names a person:

- **Test the entry point, not only the helper** — at least one test through the real production path
  to the resulting behaviour: the rendered £, the written payload, the sent audience.
- **Mutate before you claim a guard, with `scripts/mutate.mjs`.** Delete or invert the line and re-run;
  if nothing fails, the rule is documented, not protected. Say which line you deleted and what stayed
  green. **Never a hand-rolled `sed`/`replace`**: a search string the source lacks is a silent no-op
  that looks exactly like a green run. The script refuses an absent, ambiguous (`--in` narrows) or
  no-op edit, and always puts the file back.
- **A harness that discards is a harness that cannot see.** A mock that answers `set: () => {}` can
  assert nothing about a payload; record what it is given.
- **Access context is a dimension.** Safe-for-a-member is not safe-for-every-unlock-mode.

**Run the tests** — every lane, what it needs, proves and gets wrong, and the traps (visual baselines,
WebKit's install, a `RELAYED` `test:live`, the absent payslip fixture, Functions on Node 24): **README.md
→ "The test lanes"**. The everyday ones:
```
npm test                    # test:hygiene + test:parse + test:unit — needs NOTHING installed
npm run check               # lint + typecheck + npm test (full pre-push gate)
npm run test:functions      # Cloud Functions suites (needs functions/node_modules)
npm run test:rules          # Firestore + Storage security rules (the emulator starts automatically)
npm run test:e2e            # the smoke suite in headless Chromium, with the blocking axe gate
npm run test:payslip-local  # the real-payslip regression — run it before any pay-maths release
npm run test:live           # the DEPLOYMENT HEALTH CHECK against the real site, both origins
```

**Service worker caching:** every asset is served from the version-named cache `myb-roster-v{APP_VERSION}`
and **a cached file is never re-fetched**, so a change reaches devices only through a version bump;
roster DATA is always live from Firestore. The lifecycle and its do-not-revert decisions:
`.claude/rules/pwa.md`.

---

## Brand colours — Chiltern Railways

Full hex table and "never hardcode" rule: see `.claude/rules/css-tokens.md` → Brand colours.

---

## Architecture decisions — never change without discussion

These bind more than one area. A decision that binds only one area is in that area's rule file
(Area rules, above).

| Decision | Rule |
|----------|------|
| No framework (vanilla JS) | No build step. Do not introduce React, Vue, or any UI framework. A **few** vetted, self-contained libraries are allowed — Firebase, Mammoth (DOCX→HTML for the Huddle), DOMPurify and PDF.js (`pdf-viewer.js` — owner, 10 Nov 2026); on the server, `pdfjs-dist`. Adding another runtime library is a discuss-first decision. |
| No bundler | Dependencies load without a build step: **vendored** where offline-first or CSP demands it (DOMPurify `purify.es.mjs`, PDF.js `pdfjs/<version>/` — a new version is a new folder — and the Inter font), otherwise **from a pinned CDN** with SRI where practical (Firebase from gstatic, Mammoth from jsdelivr). |
| **When a build step earns its keep (threshold, not yet crossed)** | The no-build trade is paid for in hand-maintained work a bundler does for free. **Revisit — do not auto-adopt — when (a) you want real TypeScript types, or (b) a bug is traced to drift in a hand-maintained list.** The cost list and the measured input that is NOT a trigger: **DECISIONS.md → "No build step"**. |
| **Self-hosted Inter is the app's ONLY typeface** | `fonts/inter-latin.woff2`, served from origin (CSP `font-src 'self'`, offline-first). `--font-sans` in `:root` (`shared.css`, and `guide-shell.css`). Do not re-add a Google Fonts `<link>`; a second face was tried and reverted (owner decision). `css-tokens.md` → "Self-hosted Inter typeface". |
| **No native `<select>` POPUP** | The OS draws a select's list, so the app's design stops at its edge. **Every dropdown a reader READS goes through `enhanceSelect` / `initSelectSheets` (`select-sheet.js`)**; the `<select>` stays as the value holder. The rules an enhancement breaks without touching the call site, and every native-by-decision exclusion, are numbered contracts in **`select-sheet-parity.test.mjs`**. |
| **The OS draws nothing the app can draw** | Checkboxes and radios (ONE recipe in `shared.css` — recolour through `--check-fill`/`--check-border`, never a size or an `accent-color`), resize grips, scrollbars, `::selection`, `::placeholder`, `caret-color`, autofill and the password field's OS buttons are app-drawn. **`title` tooltips were REMOVED, not rebuilt** (hover-only is wrong on a phone). Safari's strong-password button is LEFT. `native-surface-parity.test.mjs`; `css-tokens.md`; DECISIONS.md → Tooltips. |
| Pointer Events API for swipe | Touch, mouse and trackpad in one handler (the Calendar's month swipe, the Admin week swipe, the range picker). Do not revert to Touch Events. |
| CSS variables for all colours | Defined in `:root`. Never hardcode hex in CSS or JS — `css-hex-parity.test.mjs`, whose header argues its few exemptions: do not add one without an argument. Never below 16px on a focusable field (iOS focus-zoom). `.claude/rules/css-tokens.md`. |
| Semantic elements (`<nav>`, `<header>`, `<main>`) | Screen readers depend on these landmarks. Do not revert to `<div>`. |
| `isChristmasRD()` applied before Firestore overrides | Forces Dec 25 and Dec 26 to RD first; Firestore can then override Dec 26 to RDW for overtime. Never reorder this. **Christmas LEAVE sits on top** in `christmas-leave.js`: every surface draws a day through `resolveDayShift` — `CALENDAR_DATA.md` 19. |
| `getBaseShift(member, date)` for all base shift lookups | Direct access to `roster.data[week][day]` bypasses `startDate` suppression, Christmas rules, and future base-shift logic. Always call `getBaseShift()`, never read `roster.data` directly. |
| `isBeforeMemberStart(member, date)` in `override-utils.js` | Returns true if `date` is before the member's `startDate`. Always use this helper — never inline the date comparison. |
| **Sundays are non-contracted — AL and Absent cannot be recorded on Sundays** | The forbidden write types are declared ONCE, `SUNDAY_FORBIDDEN_TYPES` in `override-utils.js` (a worked Sunday is `rdw`) — **do not restate the list**. **SEVEN enforcement layers, none removable alone**, numbered in code comments, so APPEND rather than renumber: (1) the week grid's pills; (2) bulk-apply; (3) `recordRangeOverrides`; (4) the roster upload's normalising; (5) display, `isOverrideDisplaySuppressed`; (6) the single-row save, `collectWeekRows` (`admin-week-collect.js`); (7) the leave sheet's Save, `writableDate` (`al-leave-plan.js`). |
| **`🪑` is the absence emoji — do not change** | Absence covers sickness, childcare, bereavement, and other reasons. Using 🤒 implies illness — GDPR concern. The reason for absence is never stored. **Always ask Gareth before changing the absence icon.** |
| `lsGet` / `lsSet` / `lsDel` / `lsKeys` from `ls.js` | iOS Safari private mode throws `SecurityError` on any `localStorage` access. **Never call `localStorage` directly** in `calendar-app.js`, `admin-app.js`, or `paycalc-app.js` — always use these wrappers. `lsKeys()` is for code that must enumerate storage. |
| Per-member paycalc localStorage namespacing | On a shared device two staff must not read each other's pay data: **never a paycalc key without `pcPrefix()`/`SK`** — `.claude/rules/paycalc.md` invariant 3. |
| Text clock boxes — `clock-input.js` | Three digits whose first is 3–9 take a leading `'0'` while typing (`"630"` → `"06:30"`); any other three wait for the box to be left. **What is left of a time is never re-read as a new one** (`"22:3"` stays). A screen shapes with `shapeClockBoxInPlace` and reads with `readClockBox`, never `settleClockBox` itself. The rules and their incidents: the module header. |
| **Calendar access: a named session only** | The staff PIN is RETIRED (owner, 23 Nov 2026): the Calendar and Trains open only to a person signed in by name, and somebody with no roster gets an **Other Staff** login. **Anonymous grants nothing** — ask for a CLAIM, never a session. The invariants: `CALENDAR_DATA.md` 3/4/11/12/17 and `AUTH_AND_SESSIONS.md` 8/9/17/19; the releases: DECISIONS.md → "The staff PIN retired". |
| `cors: ADMIN_FUNCTION_ORIGINS` on every endpoint the browser calls | The explicit origin allowlist in `functions/index.js` — defence-in-depth on top of each endpoint's own check. Add any new hosting domain to it with the API key allowlist (Project identity). `ingestHuddle` keeps `cors: false` (server-to-server). |
| Canonical lightbox lifecycle | Every `.lb-overlay` lightbox is built with **`createLightbox` in `overlay.js`** — never a hand-written lifecycle (focus, scroll lock, Android Back, Escape, the Tab trap, the `transitionend` fallback). Close controls are `<button class="lb-close">`. **A one-time notice opens through `openNoticeIfClear(lightbox)`**, and **a link out of a lightbox goes through `followLinkOutOf(lightbox, click)`**. The three exceptions: `createLightbox`'s JSDoc. `.claude/rules/nav-drawer.md`. |
| Page chrome — the header and the drawer | Every app page has the burger `#navMenuBtn` and the shared drawer (`initNavPanel`, its pill gates from `navGatesFor`). Sign-out lives only in the drawer footer; a sub-page's header logo goes back to the calendar (`wireHeaderLogo`), and the Calendar's opens About. `.claude/rules/nav-drawer.md`. |
| Overtime page — the two audiences | **PAUSED** (`CONFIG.OVERTIME_ENABLED`). **Reviewing** (`isOvertimeReviewer`, the `admin`/`manager` claim) sees everybody's declarations; **participating** (`CONFIG.OVERTIME_BETA`) answers only for oneself. **Never widen `isOvertimeReviewer` to make the pill work** — AUTH_AND_SESSIONS.md 14. |
| Huddle notification → `#huddle` hash pattern | The documents' viewers open **only** via their hash (`#huddle`, `#circular`, `#newsletter`). `.claude/rules/calendar.md` → "The document viewers open by hash". |
| `initErrorReporter()` call pattern | It writes `clientErrors`, so it needs an auth context. **Never call it bare** — every write is silently rejected and the error log looks HEALTHY because it is broken. The three canonical call sites: the header of **`error-reporter.js`**; AUTH_AND_SESSIONS.md 13. |

---

## One-time notice pattern

**Invoke `/new-notice` to add, re-post or retire a notice** — the skill holds the template, the rules,
the lessons and **the current-notices table**. A notice is for signed-in members only, opens through
`openNoticeIfClear`, and goes INERT the moment `isNoticeExpired` fires. **Monthly cleanup:** on the 1st,
remove every notice where `(today − Posted) > 180 days` — the HTML block, the JS IIFE and its table row —
and bump the version.

---

## Payday calculator — integrated

Paydays and cut-offs come from `getPaydaysAndCutoffs` / `isPayday` / `isCutoffDate` (`roster-data.js`)
and draw as 💷 / ✂️ on the Calendar; the rest is `docs/PAYCALC_REFERENCE.md` → "Paydays, cut-offs and
the roster-assist".

---

## Shift types

| Value | Badge | Meaning |
|-------|-------|---------|
| `'RD'` | 🏠 Rest | Rest day |
| `'OFF'` | 🏠 Rest | Off day — bilingual roster only, treated identically to RD |
| `'SPARE'` | 📋 Spare | On standby, shift not yet assigned. Type `spare_shift`. Recorded via the **Other** pill's submenu, but stays its own type/badge |
| `'RDW'` | 💼 RDW | Rest Day Working — overtime |
| `'AL'` | 🏖️ AL | Annual leave |
| `'SICK'` | 🪑 Absent | Sick/absent day — recorded via override |
| `'HH:MM-HH:MM'` | ☀️/🌙/🦉 | Worked shift |
| `'TRG'` / `'IND'` / `'ASSESS'` / `'TEAM'` / `'UNION'` / `'MEET'` (+ optional `' RDW'`, `' HH:MM-HH:MM'`) | 🏷️ Train / Ind / Assess / Team / Union / Meet | The **"Other" family** (OTHER_DAYS.md, `OTHER_FLAVOURS`): LEAF-GREEN `--other`; pays as the day underneath (`resolveOtherPay`); never on a Sunday, Christmas Day or Boxing Day (Gareth: Jul and 21 Nov 2026) |

**Classification:** Early 04:00–10:59 · Late 11:00–20:59 · Night 21:00–03:59

**`isWorkedShift`:** false for RD, OFF, SPARE, AL, SICK. True for everything else including RDW.

---

## Roster data structure

### teamMembers fields

> **⚠️ The member table is WORLD-READABLE**, served from both origins with no session — a field added
> to `roster-member-data.js` is **published the moment it ships**, so anything a stranger should not read
> belongs in Firestore behind a claim (`public-data-classification.test.mjs`). **A PATTERN IS PUBLIC; A
> PAYSLIP IS NOT** (`payroll-anonymity.test.mjs`). In full: `.claude/rules/roster-data.md`.

The field reference — every field, `rosterChanges`, the cycles and the fixed patterns — is
**`.claude/rules/roster-data.md`**. Three facts every area needs:

- `name` **MUST match Firestore `memberName` exactly**.
- `rosterChanges` (scheduled roster moves) are applied by `getBaseShift` and `getWeekNumberForDate`
  through `resolveMemberRoster`, so **no call site needs special handling**.
- Each rotating cycle's length is a `CONFIG.*_ROSTER_WEEKS` constant (never write the number down).
  `fixed` never rotates, and **a `fixedRoster` pattern is SHARED, so editing one member's hours there
  edits everyone on that line.**

**AL entitlement** — read the whole allowance through `entitlementFor` in `al-entitlement.js`, never
`getALEntitlement` (`al-contract.js`) directly: it adds a worked Boxing Day's day in lieu where it is
spent — that December when leave after it needs it, else the NEXT year (`boxingDayLieuYear`) — and
`christmas-leave.test.mjs` fails on any other caller. `proRatedAL[year]` takes
priority for every role **except Dispatcher**, where it scales the BASE only and the lieu days are still
added on top (owner decision): the 22 is an allowance a part-year deserves part of, a lieu day is owed
because a specific day was worked.

| Role / type | Days |
|-------------|------|
| CEA on a **bilingual contract** (`bilingualContract: true`) — the CONTRACT, not the line | 34/year |
| CEA, every other contract (main, fixed) | 32/year |
| CES (`ces`) | 34/year |
| Dispatcher | 22 + 1 lieu per BH worked (`countDispatcherBankHolidaysWorked`) — a joining year's `proRatedAL` replaces the **22**, never the total |
| anything else, an unresolved member, or a year before the member joined | **`null`** — never a guessed figure; `getALEntitlement`'s comments say which case is reachable today. **Callers must TEST for null and refuse to render**: `null - taken - booked` is a NUMBER, not NaN. |

### Firestore collections

Every collection's fields, meanings, access summary and retention: **`docs/DATA_MODEL.md`**.
`firestore.rules` remains the authority on access. Override cache key: `"memberName|YYYY-MM-DD"`

## Key rules

- **Offline first** — Firestore is an enhancement. Every Firestore call needs a silent fallback. Never block rendering waiting for Firestore.
- **Mobile is primary — TWO platforms, served EQUALLY** (owner, 8 Sep 2026). Test every change at
  375px, on both engines. **Who runs what is an OWNER FACT: do not infer it from a screenshot, a bug
  report or one device.**
  - **Android and iOS are both first class**; the personal-phone population is mixed.
  - **The work phone is Android, and getting the app INSTALLED on it is the GOAL** — the company does
    not permit it today, so the Android install path (`beforeinstallprompt`) is as load-bearing as iOS's.
  - **The iOS hazards are PLATFORM FACTS**: Web Push only inside an installed PWA, no system Back,
    `localStorage` can throw, a Safari tab loses ALL its storage after a week away, and Safari fires
    neither `beforeprint` for AirPrint nor `transitionend` on a backgrounded tab. **Oldest iOS
    supported: 16.4** (owner, 7 Nov 2026).
  - **The ~5 station PCs: a Windows login each**, so nothing in a browser there is shared (owner;
    DECISIONS.md → "Shared office PCs").
  - **Every release passes the Chromium suite and a few Safari tests on the deploy** (owner, 17 Nov
    2026); the whole WebKit suite runs on branches only, so weigh a branch WebKit failure seriously.
- **Print CSS** — any new shift type, cell class, or badge needs `@media print` rules.
- **No `alert()`** — `console.error()` for developer errors. No visible error text for recoverable failures.
- **Code quality** — pure functions where possible, JSDoc on all functions, meaningful variable names, error handling on all async operations.

---

## Known issues & deferred work

Active constraints and deferred fixes: **`KNOWN_LIMITATIONS.md`**. Future capabilities: **`ROADMAP.md`**.
Decisions already taken, so not re-argued: **`DECISIONS.md`**.

**Do-not-change UI labels (Claude-relevant):**
- **Admin button label** — "Admin" = administration, not administrator. Intentional. Do not rename.
- **The Huddle upload button reads "Choose file"**, not "Choose PDF" — intentional, a Huddle can be PDF or DOCX.
- **`AL` and the Admin pill row** — `.claude/rules/admin.md` (the `AL` label stays short; new day kinds go into the Other submenu, never a new top pill).

### Staff-facing wording conventions

Applies to **all user-visible copy** (cards, hints, tips, lightboxes, error banners, notifications) —
not to code identifiers, data values, or comments. The reason behind each: `.claude/rules/staff-copy.md`.

- **App / account matters → "the admin"; work / operational matters → "your manager".** A password,
  a saved work email, a broken page is the admin's; leave, absence, shift changes and rota queries are
  the manager's. Ask: *is this a broken-app problem or a work problem?* Only the owner and the admin can
  read a `staffContact` work email, so "only you and the admin can see this email" is the right phrasing.
- **"Change a Shift"** — never "override" (that word stays in code and data).
- **"Absent" / "record an absence"** — never "sick"/"sickness" in UI copy (the reason is never stored — GDPR).
- **"Year to Date"** — never bare "YTD"; the two payslip figures are exactly **"Taxable Pay"** and **"Tax Paid"** (`.claude/rules/paycalc.md` → payslip line names).
- **"Fill from calendar" / "From your calendar" / "Replace with calendar values"** — not "roster".
- **"account recovery"** is what a saved work email is FOR (owner decision). Today's copy: "Self-service recovery isn't available yet. For now, ask the admin if you forget your password." Never "coming soon"; and never say a password reset is flatly unavailable — the admin can reset one today ("To reset a password today, contact the admin").
- **App name "Marylebone Roster"** everywhere (bug reports: "Marylebone Roster — <Page>"). **Never "MYB" for the APP or one of its tools** — not "MYB Roster", not "MYB Pay Calculator". As the app name it survives only in the iOS home-screen title meta and the manifest's `short_name`, by decision. **MYB as the STATION CODE is correct and stays.** `app-name-parity.test.mjs`.
- **Documents:** "Daily Huddle" (proper noun), "Weekly Retail Circular", "Marylebone Newsletter".
- **Never name an internal document in staff-facing copy** — describe the reader's own position instead (`overtime-format.test.mjs`).
- **Tone:** calm and factual — no exclamation marks, no marketing voice.

**Plain English that TEACHES — write for the colleague who has never heard the term** (owner, 3 Sep
2026). At 22:00 on a late turn there is nobody to ask, so every surface works for somebody who does not
yet know the word: **Discover** → **Understand** in one sentence → **Act** → **Deep dive** on demand.
Disclosure may hide the fourth, never the first. In full: **`.claude/rules/staff-copy.md`**.

## Huddle ingest

Daily Huddle PDF/DOCX → Power Automate → `ingestHuddle` → Firebase Storage + Firestore `huddles` + a push notification: **see `OPERATIONS_REFERENCE.md`**. **Every Web Push payload follows `.claude/rules/notifications.md`** — the feature's own emoji first, "Latest X" for documents, a calm tone, the monochrome badge, and the single `buildPushPayload` builder. Never hand-write a payload literal.

---

## Weekly Roster Upload

Admin uploads PDF → `parseRosterPDF` (`MODEL_REQUEST` in `functions/roster-prompt.js`) → review UI → Firestore, for every grade's roster. **`source: 'roster_import'`** on every roster-upload override (`computeCellStates()` reads it). **Read `.claude/rules/roster-import.md` before changing anything in the import** — every rule in it is there because a week was written onto the wrong days, or nearly was. The request/response format: `OPERATIONS_REFERENCE.md`.

---

## Firebase Auth

**Firestore writes need a claim, never a bare `request.auth != null`** (AUTH_AND_SESSIONS 9). The
contract is `docs/AUTH_AND_SESSIONS.md`; the working notes are `.claude/rules/sessions.md`.

- **Every write page re-establishes the Firebase session on load** (`ensureNamedSession(name)`,
  `session.js`) — without it a returning member's every write fails. Do not remove the call.
- **Per-member write isolation is STRICT** — the member's own bound name, or an `admin`/`manager` claim
  writing on behalf (AUTH_AND_SESSIONS 4, 19).
- **Three claim tiers** from `setupRosterAuth`, `linksDesigner` on top. **The `manager` tier is
  load-bearing; do NOT grant managers `admin: true`.** A newly listed manager needs `npm run
  generate:roster-members` in the same commit, then — once Deploy Firebase Functions has finished — Set
  up accounts and a token refresh.
- **An Other Staff login** admits only pages whose `PAGE_POLICIES` entry says `otherStaff: true`
  (`auth-policy.js`).

**New starter:** invoke `/new-starter` — the ordered checklist (the account step comes only after the roster change has deployed).

**The depot annual-leave workbook:** invoke `/al-workbook` the moment one is uploaded, or any question is asked about somebody's leave. **Read `docs/AL_WORKBOOK.md` §0 before answering from the spreadsheet** — `AL over depot quota` days are real leave, invisible in the calendar grid. **A leave file names colleagues: it never enters the tree** (`leave-file-privacy.test.mjs`).

**Removing a staff member:** invoke `/leaver`. The step everybody gets wrong: **upload their final roster PDF FIRST** (`hidden` drops them from the import's name list).

Email/password convention: **see `OPERATIONS_REFERENCE.md`**.

---

## Pay calculator

Manual-entry: staff enter hours, and the calculator computes tax, NI, pension and take-home. **The
rates, allowances and pension defaults live in `docs/PAYCALC_REFERENCE.md` alone** (code:
`paycalc-calc.js`) — never restate them. The pay-maths regression net is real payslips kept OUT of the
repo: paycalc.md → Example payslips.

---

## Guide pages

The guide pages — one per `NAV_GUIDES` entry in `nav-destinations.js` — share `guide-shell.css`, each with its own CSS file and no `shared.css`. No inline scripts or `onclick` (CSP blocks them). `.claude/rules/guide-pages.md`.
