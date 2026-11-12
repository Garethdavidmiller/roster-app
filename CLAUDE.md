# CLAUDE.md

*Last updated: November 2026 — v25.80 · Updated every 0.10 version*

# Claude Code Instructions — MYB Roster App

## Project identity — read this first

| Property | Value |
|----------|-------|
| GitHub repository | `Garethdavidmiller/roster-app` |
| Firebase project ID | `myb-roster` |
| Firebase project region | `europe-west2` (London) |
| Documentation milestone | `25.80` — the 0.10 checkpoint these docs are written against, and **deliberately NOT the current version**, which only `APP_VERSION` in `roster-data.js` states (a current-version row rots on every release, because bumping it is not part of shipping). The version stamp in **every** doc (this file, AI_MAP, OPERATIONS_REFERENCE, KNOWN_LIMITATIONS, ROADMAP) is held to the latest 0.10 milestone by `sw-asset-check.test.mjs` and `githooks/pre-commit`, so a bump crossing a 0.10 line fails until each doc is reviewed and re-stamped. |
| Hosted URL | Deployed to Firebase Hosting via GitHub Actions on push to `main` |
| Staff-facing URL | `https://myb-roster.web.app` (canonical — Firebase Hosting; the **primary install + notification target**). A GitHub Pages mirror is served at `https://garethdavidmiller.github.io/roster-app/` — the **roster-app repo's OWN** Pages, built from `main`; **note the `/roster-app/` path** (the bare origin is a separate empty repo that 404s). **Most staff still open the app there** (owner, Sep 2026 — the changeover to the canonical URL is deliberate and gradual, not a rump to be discounted). The mirror serves **no redirects and no HTTP headers**, so a change relying on something only Firebase Hosting can do — a rename protected by a `redirects` entry, a policy carried by a header — reaches the smaller half of the staff: weigh it against the mirror, not the canonical URL. That is why every page carries a `<meta>` CSP. `STAFF_SITE_URL` in `functions/index.js` is the bare canonical origin; it only sets the notification payload's path/hash, and each device's service worker re-bases that onto its own scope, so github.io installs keep working. See the API key note below. |
| Cloud Function URLs | Base `https://europe-west2-myb-roster.cloudfunctions.net/` + the endpoint name: |
| | `ingestHuddle` — the Daily Huddle upload from Power Automate, server to server (bearer `HUDDLE_SECRET`) |
| | `parseRosterPDF` — the weekly roster import (`.claude/rules/roster-import.md`) |
| | `setupRosterAuth` — provisions accounts and their claim tiers from the server-owned `functions/roster-members.json` |
| | `resetMemberPassword` — admin-only break-glass: resets a member's password to their surname default (PASSWORD_DESIGN.md Track C) and TELLS THE MEMBER on their own devices via `sendTargetedPush` — never `fanOutPush`, and never carrying the new password, because a push renders on a lock screen. How it reports each stage: `.claude/rules/notifications.md` |
| | `unlockCalendarViewer` — the staff Calendar PIN exchange: POST a four-digit PIN, get a custom token carrying ONE claim, `calendarViewer: true`. The PIN lives ONLY in the `CALENDAR_VIEWER_PIN` secret; never in source, docs, tests or any client asset. Throttled per source and across all sources under a fixed key no header can influence; the per-source key is the END of `x-forwarded-for`, because a caller can only PREPEND to it. Limits and history: `functions/calendar-viewer-auth.js` |
| | `getDocumentUrl` — a SHORT-LIVED URL for the latest Huddle / Circular / Newsletter. The caller names a KIND, never a path; the door mirrors `firestore.rules`. **Needs `roles/iam.serviceAccountTokenCreator` on the runtime service account, granted to ITSELF** — without it every call 503s and the client falls back to the stored URL. The opening surfaces (nav drawer, `calendar-doc-viewer.js`, `calendar-huddle-viewer.js`) mint BEFORE the click — awaiting inside a handler spends the user gesture and gets `window.open` pop-up-blocked — and a signed link opens only the file on screen (`resolveDocumentOpenUrl`). AUTH_PLAN.md §5 |
| | `getSignInStats` — admin-only READ: the EXACT unique-account sign-in counts, from Firebase Auth's own `lastSignInTime`. Four integers; no identity |
| | `getAccountSetupGaps` — admin-only READ: who on the roster has no login, whose claim tier is wrong, and which leaver can still sign in. It returns NAMES, which is why it is not folded into `getSignInStats` and its "no identity" contract. Changes nothing |
| | `requestPasswordReset` — one of the app's TWO public unauthenticated endpoints, with `unlockCalendarViewer`: a locked-out member asks the admin for a reset. It records a request, never resets anything, and pushes it to the **admin's devices only** via `sendTargetedPush` — never `fanOutPush` |
| | The five Overtime endpoints: `createOvertimeWindow` · `getOvertimeManagerOverview` · `getMyOvertimeState` · `submitOvertimeAvailability` · `withdrawOvertimeParticipant` — not deployed while Overtime is paused (OVERTIME_AVAILABILITY.md) |
| Development branch convention | `claude/<description>-<sessionId>` — always push to this branch, never directly to `main` |

**Secrets** (Firebase Secret Manager unless stated — no workflow reads any of these; deploys authenticate by WIF):

| Secret | What it is |
|--------|-----------|
| ~~`FIREBASE_SERVICE_ACCOUNT`~~ | **Retired.** Every deploy authenticates by Workload Identity Federation (below); the old key and the GitHub secret are both deleted, so no standing full-project deploy credential remains in GitHub. Pool, provider and service account: SECURITY_RELEASE_PLAN.md → Appendix A2. |
| `HUDDLE_SECRET` | Bearer token for `ingestHuddle` |
| `ANTHROPIC_API_KEY` | Claude AI key for `parseRosterPDF` |
| `VAPID_PRIVATE_KEY` | Web Push private key. The PUBLIC key is a literal in `functions/index.js` **and** `notif.js`, and the two must match (see Change impact) |
| `CALENDAR_VIEWER_PIN` | The shared staff Calendar PIN — set INTERACTIVELY, never committed. Rotating it needs no client release; see OPERATIONS_REFERENCE.md → "Rotating the Calendar PIN" |

**Workflows:** `deploy-functions.yml` (functions only) · `deploy-hosting.yml` (PWA → Firebase Hosting) · `deploy-rules.yml` (Firestore/Storage rules). **All three authenticate via Workload Identity Federation** (`google-github-actions/auth`, pinned `v3.0.0`; each job declares `permissions: id-token: write`). **The three fire in PARALLEL from one push, with no ordering guarantee** (successive pushes QUEUE per workflow — a `concurrency` group with `cancel-in-progress: false` — so an older push can never release last, and a re-run a newer run has overtaken stops itself, `.github/actions/refuse-overtaken-rerun`). So any change where the new client DEPENDS on new rules (a schema expansion: a new override field, a new analytics counter id, a new collection) must ship **backend-first, in its own push**: rules that ACCEPT the field first, the client that WRITES it only after the rules deploy is confirmed. In one push there is a minutes-long window where the live client writes a field the live rules' `hasOnly()` still rejects, and every such write permission-denies — it has happened. Loosening in the opposite direction (rules gaining a field no client writes yet) is always safe. **The GitHub Pages mirror** is published by **`deploy-mirror.yml`**, only from a commit a passing Hosting run released, under a minute after it (the first took about nine) (Settings → Pages → Source has been GitHub Actions since 10 November 2026). The root **`.nojekyll`** marker (empty file — do not delete) is for the way back: set the source to the branch again and it stops that build running Jekyll, which hard-times-out at 10 minutes.

**⚠️ Firebase API key referrer restriction — add every domain the app is served from:**
The Firebase web API key is restricted to specific HTTP referrers in GCP Console → APIs & Services → Credentials. If a domain is missing, **every Firebase Auth call fails** — sign-ins, Firestore writes and push subscriptions all break, and nothing on screen names the cause (a typed sign-in says only "Couldn’t sign you in"). Current allowlist must include:
- `myb-roster.firebaseapp.com/*`
- `myb-roster.web.app/*`
- `garethdavidmiller.github.io/*` ← staff-facing URL, must stay until GitHub Pages is retired

If a new custom domain is ever added, update the GCP allowlist **and `ADMIN_FUNCTION_ORIGINS` in `functions/index.js`** in the same change. The rule is KNOWN_LIMITATIONS.md task #1; its history is ROADMAP_HISTORY.md → "The four v11 security tasks".

---

## Deployment health check — do this occasionally (and in every review)

> **⚠️ The installed PWA hides live-site breakage.** The app is offline-first, so
> a phone that already has it installed launches — and even updates — straight
> from the service-worker cache, **even when the live site is completely broken**
> (splash that never clears, `404`, CSP failure, expired API-key referrer). You
> will NOT see the problem from your own installed app — a real outage went
> unnoticed exactly this way. **"My phone works" is never evidence the site is up.**

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

**After every merge that deploys, run `npm run test:live` once Deploy Firebase Hosting, and the
mirror's deploy that follows it, have FINISHED** — not at the merge. The deploy runs the whole
browser suite before it releases anything, so a check started at the merge reads the previous
release, and its pass says nothing about the new one. A merge whose files all sit in that workflow's
`paths-ignore` (docs, tests, workflows, Functions, rules) starts no Hosting deploy, so there is
nothing to wait for.

---

## Version bumping (MANDATORY on every change)

**Every change a user can see or experience is bumped, with `npm run bump <version>` (e.g.
`npm run bump 13.48`) — never by hand-editing.** That means logic, data, UI text, CSS
layout/appearance, security rules, HTTP headers, the manifest and service-worker caching. Pure `.md`
edits, tests, CI and dev scripts do not bump. **A comment-only change to a served file does** — any
`.js`, `.css` or `.html` the app serves, or anything under `functions/`: it alters nothing a user
sees, but CI's `version` job (`e2e.yml`) cannot tell a comment from code and fails the branch without
one. **If in doubt,
bump** — it costs nothing, while a missed bump serves staff a stale cached asset, and fixing it in a
follow-up commit is worse than bumping unnecessarily. **Before every `git commit`, ask: did this
touch anything a user can see or experience?**

The rules, each with its reason. The incidents behind them are DECISIONS.md → "Version bumping and
merging — the incidents behind the rules".

- **Bump against `main`, NOT against the branch you started from.** Re-check
  `git show origin/main:roster-data.js | grep APP_VERSION` immediately before merging, and re-bump if
  somebody got there first. Two parallel branches bump to the same number and the second merge does
  not conflict; `service-worker.js` is then byte-identical across two releases, so the browser
  installs no new worker and every device that took the first keeps its files until the next bump.
  Nothing heals that; the remedy is a fresh bump and a redeploy.
- **A gap in the version space is the rule working.** A caught collision skips a number. Never reuse
  one to close it up: the version only ever increases, and a number that briefly named two trees
  should never name a third.
- **The increment is exactly 0.01 per change — never 0.10.** A batch goes `15.90 → 15.91 → 15.92`.
  The "every 0.10 version" documentation rule below is only about when to re-stamp the docs, not the
  step size. Never set a value ≤ what is already on `main`: the version names the SW cache.
- **"CI is green" means the run that COMPLETED included the `version` job, and no run FAILED.** Every
  PR fires a `push` and a `pull_request` run in one concurrency group, so one is normally cancelled
  within seconds — that is the design (`e2e.yml`; DECISIONS.md). Do not go looking for a second full
  green run. **A red `version` job on a release that shipped fine is probably the two-runs trap**: a
  run fired when the PR was opened compared the branch against a `main` that already contained it.
  The job now skips a branch `main` already contains, judged by content because `main` squash-merges.
- **Do not stack a branch on an unmerged one.** `main` squash-merges, so a child branch cannot be
  rebased once its parent lands — every commit replays and conflicts. Wait for the parent to merge,
  or accept cutting a fresh branch from `main` and cherry-picking. The backend-first rule forces a
  split in TIME, not in branches. **Once your own PR has squash-merged, restart its branch from
  `main`.** Where a force push is refused, `git checkout -B <branch> origin/main && git merge -s ours
  origin/<branch>` makes the restart a fast-forward: the tree is main's and the old head stays
  reachable as the second parent.
- **One Playwright run at a time, and do not switch branches under one.** The suites share a dev
  server and `test-results/`; either mistake shows up only as a confusing false failure.

**2 runtime bump locations** — `npm run bump` (`scripts/bump-version.mjs`) writes both, and
`sw-asset-check.test.mjs` checks both:

| File | Location |
|------|----------|
| `roster-data.js` | `export const APP_VERSION = '...'` — **primary source** (every runtime read; the About panel shows it) |
| `service-worker.js` | `const APP_VERSION = '...'` — names the SW cache (the freshness lever) |

There are no version comment stamps and no `?v=` cache-busting strings — do not add either back.
Cache freshness is `Cache-Control: no-cache` in `firebase.json` plus the version-named SW cache.

**Documentation update policy:** Update every **0.10 version** (e.g. 10.10 → 10.20), or immediately on: new pay grade, auth/Firestore model change, SW strategy change, new page or module, data model change.

**Same-commit rule:** Any commit that adds, removes, or renames a JS module — **or removes/renames an exported symbol** from one — must also update `docs/FILE_INDEX.md` and `docs/AI_MAP.md` in the same commit. The pre-commit hook (`githooks/pre-commit`) enforces both (modules must be listed in both docs; a staged module whose exported surface changed vs `HEAD` requires `AI_MAP.md` to be staged too). It **also blocks** a commit when any stamped doc's "Last updated" line has fallen behind the latest 0.10 milestone (mirroring `sw-asset-check.test.mjs`), runs ESLint on staged JS files (if ESLint is installed), and checks that `firebase-client.js` does not import more than one Firebase SDK version.

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
edited, so an area's decisions cost nothing to a session working somewhere else. **Read the one for
your area before changing it.** Each holds the "never change without discussion" decisions that bind
only that area; a decision that binds more than one area stays in this file.

| Rule file | What it holds | Loaded by |
|---|---|---|
| `calendar.md` | the Calendar page — month announcements, the swipe seam, a removed member, the sync chip, the notification strip, Team Week, the day panel, the pay jump | `index.html` · `index.css` · `calendar-*` · `e2e/calendar*.spec.js` |
| `admin.md` | the Admin page — the pill types, "Recording for", AL on a rest day, Sunday corrections, the range picker | `admin.*` · `admin-*` · `al-*` · `e2e/admin.spec.js` |
| `nav-drawer.md` | the drawer, About and the header logo, sign-out, the bell, App Notices, Android Back, the topmost overlay | `nav-panel.js` · `nav-guide-search.js` · `overlay.js` · `about-lightbox.js` and their tests |
| `pwa.md` | the service worker's caching and update lifecycle, the offline fallback, the manifest, Firestore's local cache | `service-worker.js` · `sw-register.js` · `sw-*.test.mjs` · `manifest.json` · `firebase-client.js` · the offline lane |
| `sessions.md` | one local session, re-establishing Firebase on load, strict write isolation, the claim tiers, `normaliseSurname` | `session.js` · `page-session.js` · `login-overlay.js` · `auth-*` · `claim-retry.js` · `password-force.js` · `firebase-client.js` · `firestore.rules` · the functions' auth and identity files |
| `roster-data.md` | the member fields, `rosterChanges`, the cycles and fixed patterns, `APP_VERSION` | `roster-data.js` · `roster-cycle-data.js` · `roster-member-data.js` |
| `roster-import.md` | the weekly roster import, and every defence against a week written onto the wrong days | the import modules and `functions/roster-*` |
| `paycalc.md` | the Pay Calculator — rates, payroll rules, state, layout, the real-payslip net | `paycalc*` |
| `links-design.md` | the Links workspace | `links*` |
| `css-tokens.md` | surfaces, colour, type, motion, spacing, focus, the app-drawn controls | every `*.css` |
| `guide-pages.md` | the guide pages' shell, design principles and factual standards | the guide pages |
| `notifications.md` | the push notification language and the single builder | the push senders, `notif.js`, `service-worker.js` |

---

## Feature contracts — read one BEFORE changing a feature

> **Lost? `ARCHITECTURE.md` is the index.** One page: which document is authoritative for
> each subject, **what is actually deployed where that differs from what the documents describe**
> (the `EXC-*` table — when it is empty, documented and deployed have converged), and what the four
> status words mean. It holds no design and no history; if it has not sent you somewhere else, it has
> failed.

Five documents state, as numbered invariants, what each feature must never stop doing. They are
**routing tables, not explanations**: each row names the property and points at the module header
where the reasoning lives beside the code. That is the same three-homes discipline as the file
index — a contract that restated its own reasoning would be a fourth copy of it.

| Feature | Contract | What it protects |
|---|---|---|
| Calendar data | `CALENDAR_DATA.md` | what may be SHOWN, and when — knowledge states, the access gate, cache ordering |
| Authentication | `AUTH_AND_SESSIONS.md` | session ↔ identity ↔ claim, the three ways they disagree, and a write whose account has gone |
| Overtime | `OVERTIME_AVAILABILITY.md` → Invariants | the frozen population, the deadline clock, no-response ≠ not-available |
| Pay calculator | `.claude/rules/paycalc.md` → Invariants | round trips, per-member keys, and never guessing a figure |
| Links workspace | `.claude/rules/links-design.md` → Invariants | advisory vs hard limits, co-editing, refusing rather than half-loading |

**When an invariant changes, the row changes in the same commit** — a contract nobody updates is
worse than none, because it is believed.

## Change impact — what one edit reaches

Most of this app is one page deep. These are the exceptions, and every one of them has caused a
regression somewhere the author was not looking.

| Change this | And you have changed | Verify with |
|---|---|---|
| `resolveEffectiveShift` (`override-utils.js`) | Calendar · Team Week View · Overtime roster context | `override-utils.test.mjs` · `e2e/overtime.spec.js` |
| the day-detail panel (`calendar-al-lightbox.js` + its `index.css` block) | the ONLY place a member reads what a day is on touch — and its two shipped defects (a frozen 85% scale, a date under the close button) were both invisible to behaviour | `e2e/calendar.spec.js` (the `day detail:` block) · `lightbox-transform-parity.test.mjs` · `day-detail-explains.test.mjs` |
| `getBaseShift` / `resolveMemberRoster` (`roster-data.js`) | every shift the app displays, on every page, plus roster PDF import | `roster-data.test.mjs` · `admin-roster-upload.test.mjs` |
| `christmas-leave.js` (`resolveDayShift`, `boxingDayLieuDays`) | 25/26 December on the Calendar, Team Week, the legend, Overtime's roster and Admin's week grid, the leave records, and the allowance (`entitlementFor`) | `christmas-leave.test.mjs` · the `christmas` e2e in `calendar.spec.js` and `admin.spec.js` |
| `session.js` · `login-overlay.js` · `auth-policy.js` · `page-session.js` | all eight protected pages at once — `page-session.js` is every page's sign-out, unsaved-work question, Back-after-sign-out guard and session-loss sign-in | `e2e/auth.spec.js` (the overlay on every sign-in page) · `page-session.test.mjs` · `page-contract-parity.test.mjs` |
| `claim-retry.js` / `withClaimRetry` (`firebase-client.js`) | every write, and what it reports when its outcome is unknown | `claim-retry.test.mjs` · `e2e/admin.spec.js` · `e2e/operations.spec.js` |
| a COLLECTION's fields | `docs/DATA_MODEL.md` + `firestore.rules` + the client writer, together | `npm run test:rules` — for `overrides` it writes the REAL `buildOverrideWrite` output; for every other collection check the writer's keys against the rule's `hasOnly()` BY HAND (`firestore-contract-parity.test.mjs` checks ids and allowlists, not field sets) |
| `firestore.rules` | client and server together — the client copies of ownership rules only drive BUTTONS | `npm run test:rules` **and** `firestore-contract-parity.test.mjs` |
| `firebase.json` CSP header | every page's `<meta>` CSP, because the Pages mirror serves no headers | `csp-meta-parity.test.mjs` · `npm run test:csp` |
| any `overlay.js` lifecycle | every lightbox in the app, including the one-time notices | `overlay.test.mjs` · `overlay-history.test.mjs` |
| adding a PAGE | ONE entry in `scripts/app-pages.mjs` — the test suites read their pages from it — plus the app's own lists (SW, auth policy, nav pill, rules analytics id, report names, guide back-arrow), which stay hand-written because there is no build step | `page-contract-parity.test.mjs` — it names each app-side list the page has not joined, and checks the page list against the files on disk |
| adding a MODULE or changing its exports | `docs/FILE_INDEX.md` + `docs/AI_MAP.md`, same commit | `githooks/pre-commit` · `doc-parity.test.mjs` |
| `CONFIG.LINKS_DESIGNERS` / `OVERTIME_BETA` / `OVERTIME_ENABLED` / `MAX_YEAR` | the SERVER's copy — run `npm run generate:roster-members` in the same commit | `sw-asset-check.test.mjs` |
| a Firebase SDK bump (`firebase-client.js`) | `FIREBASE_SDK_VERSION` in `service-worker.js` | `sw-asset-check.test.mjs` |
| the VAPID key | `functions/index.js` **and** `notif.js` — a mismatch is silent AND permanent | `sw-asset-check.test.mjs` |

---

## Current file structure

**The file catalogue is `docs/FILE_INDEX.md`** — one line per file. It ROUTES; it does not explain,
and it is not a changelog. Three homes, one fact each:

| What | Where | Why there |
|---|---|---|
| **Routing** — what a file is, what it owns | `FILE_INDEX.md`, one line | it is what you need before you have opened anything |
| **Design reasoning** — the invariants an edit can silently break | the module's own header | it is where an editor is already looking, and it cannot drift from the code beside it |
| **Release history** — what changed at which version | git log, and the plan docs | it describes the past; it cannot be checked, and it is read almost never |

A fact kept in two places drifts, and that drift is behind every stale doc claim this repo has had to
correct. So when you add a module, give it a one-line entry in `FILE_INDEX.md` and put the argument
in its header; see `AI_MAP.md` for full module descriptions and export lists. Reasoning leaves a doc
only after it is verified in the module header. `doc-parity.test.mjs` caps each catalogue entry and
the version stamps in it, refuses a file routed twice, and caps this file's total size, because it is
loaded into every session; `githooks/pre-commit` refuses a module that is not listed in
`FILE_INDEX.md` and `AI_MAP.md`.

**The rule tested, the wiring not** — the named risk. This repo's breadth of rule, contract and
hygiene tests is its strength and also its blind spot: a helper can be perfect and the answer still
wrong, because the production line that calls it passed the wrong argument, was never called, ran in
the wrong access context, or had its result discarded. So, for anything that moves money, decides
access, or names a person:

- **Test the entry point, not only the helper.** At least one test that runs the real production path
  through to the resulting behaviour — the rendered £, the written payload, the sent audience.
- **Mutate before you claim a guard, and use `scripts/mutate.mjs` to do it.** Delete or invert the
  line and re-run. If nothing fails, the rule is documented, not protected. Say which line you
  deleted and what stayed green. **Never a hand-rolled `sed`/`replace`:** a search string the source
  does not contain is a silent no-op, and a replace-first can land on the wrong copy of a repeated
  block — both look exactly like a green run, and both argue for WEAKENING a test that is fine, the
  worst direction for an error here. The script refuses an absent target, refuses an ambiguous one
  (`--in` narrows to a rule, a function or a rules block), refuses an edit that changed nothing,
  refuses a command that fails WITHOUT the mutation (it runs it unchanged first), and puts the file
  back however the run ends, even when the tool is killed outright.
- **A harness that discards is a harness that cannot see.** A mock that answers `set: () => {}` can
  assert nothing about a payload; record what it is given.
- **Access context is a dimension.** Safe-for-a-member is not safe-for-every-unlock-mode.

**Run the tests** — what each lane needs, proves and gets wrong: README.md → "The test lanes".
```
npm test                    # test:hygiene + test:parse + test:unit (every root test file but the Functions and rules suites) — needs NOTHING installed
npm run check               # lint + typecheck + npm test (full pre-push gate)
npm run lint                # ESLint on all JS files
npm run typecheck           # tsc --noEmit on all root JS modules
npm run test:hygiene        # the no-emulator, no-mock suites; the list is package.json `test:hygiene`, not restated here
npm run test:parse          # module-parse (--experimental-vm-modules)
npm run test:unit           # all --experimental-test-module-mocks tests
npm run test:nodeps         # every suite that needs nothing installed; gates every branch and PR as the `nodeps` job
npm run test:payslip-local  # the real-payslip regression; FAILS without the gitignored fixture — run it before any pay-maths release
npm run test:functions      # Cloud Functions handler + parser suites (needs functions/node_modules); gates every PR on Node 24
npm run test:rules          # Firestore + Storage security rules (the Firebase emulator starts automatically)
npm run test:e2e            # the smoke suite in headless Chromium — the axe accessibility gate runs inside it, blocking
npm run test:a11y           # that accessibility gate on its own (A11Y_BASELINE.md)
npm run test:csp            # the real firebase.json CSP, served by the Hosting emulator; gated in CI (`csp` job)
npm run test:visual         # Chromium visual baselines — REPORT-ONLY in branch CI
npm run test:visual:webkit  # a small Safari-engine visual set — report-only
npm run test:webkit         # the smoke suite under WebKit — branch CI, not the deploy gate
npm run test:live           # the DEPLOYMENT HEALTH CHECK against the real site, both origins; gates nothing
npm run test:offline        # SW/offline paths with the network cut — weekly, non-blocking (offline.yml)
npm run test:signed-in      # the real SDK on the emulators: signed-in journeys, both phones; branch CI only
```
- **Read the `visual baselines` check, not the `visual` job** — the job is `success` on a drifted lane
  and a clean one alike; the check run is `neutral` when baselines drifted, and the PR comment names
  them. Regenerate from the PR's `visual-diffs` artifact (the baselines are CI's render):
  `node scripts/refresh-visual-baselines.mjs <unzipped artifact>` copies CI's render of each FAILED
  one (with no folder it redraws locally — for looking, not committing); keep
  `-- --update-snapshots=all` for a deliberate sweep, **then `git status e2e/visual-baselines/` and
  revert anything you cannot explain**.
- **WebKit is not in a fresh dev container:** `npx playwright install webkit && npx playwright install-deps webkit`
  — the second is apt and needs root (without it the launch dies listing missing shared objects and
  reads like "unsupported"). The standing "do not run playwright install" advice is about CHROMIUM,
  which IS pre-installed.
- **`test:live` prints `DIRECT` or `RELAYED` per page — a RELAYED pass is partial** (no API-key
  referrer check, no live Firebase round trip). Its scheduled run requires DIRECT. The hourly
  production-currency check is a different question: it asks whether the served version matches
  `main`, which a stuck splash answers "yes" to.
- **`npm test` skips the payslip regression honestly when the fixture is absent**, so a green run
  cannot tell you whether the comparison RAN — `test:payslip-local` can (owner's checkout only).
- **Keep the Functions PR job on Node 24**, the runtime `functions/package.json` declares, so the
  handlers are tested on the version they run on.

**Service worker caching:** every asset is served from the version-named cache `myb-roster-v{APP_VERSION}`
and **a cached file is never re-fetched**, so a change reaches devices only through a version bump →
new worker → new cache; roster DATA is always live from Firestore. The lifecycle, the warm-up and the
fallback rules — and the do-not-revert decisions behind them — are `.claude/rules/pwa.md`.

---

## Brand colours — Chiltern Railways

Full hex table and "never hardcode" rule: see `.claude/rules/css-tokens.md` → Brand colours.

---

## Architecture decisions — never change without discussion

These bind more than one area. A decision that binds only one area is in that area's rule file
(Area rules, above), and the rule files are where to look before changing an area.

| Decision | Rule |
|----------|------|
| No framework (vanilla JS) | No build step. Do not introduce React, Vue, or any UI framework. A **few** vetted, self-contained libraries are allowed where they earn their place — currently Firebase (auth/Firestore/Storage), Mammoth (DOCX→HTML for the Huddle), DOMPurify (sanitising that HTML) and PDF.js (the in-app PDF viewer, `pdf-viewer.js` — owner, 10 Nov 2026); on the server, `pdfjs-dist` (the roster grid read). Adding another runtime library is a discuss-first decision, not a default. |
| No bundler | External dependencies load without a build step: **vendored** (served from origin) where offline-first or CSP demands it — DOMPurify (`purify.es.mjs`), PDF.js (`pdfjs/` — its worker must be same-origin) and the Inter font are vendored — otherwise **from a pinned CDN** with SRI where practical (Firebase from gstatic, Mammoth from jsdelivr). Prefer vendoring for anything the app must work offline without. |
| **When a build step earns its keep (threshold, not yet crossed)** | The no-build rule is a deliberate trade — zero toolchain, direct debuggability, no build-supply-chain — paid for by hand-maintained work a bundler does for free (the `modulepreload` lists, the SW precache, the 2-location version bump, `generate-*` codegen, the CSP `*-boot.js` shims, the pure-helper splits, the `normaliseSurname` duplication). **Revisit — do not auto-adopt — when either (a) you want real TypeScript types, or (b) a bug is traced to drift in a hand-maintained list.** Until then the trade favours no build. The full cost list, why the figures are COUNTED rather than written down, and the third input that is measured but is NOT a trigger: **DECISIONS.md → "No build step"**. |
| **Self-hosted Inter is the app's ONLY typeface** | `fonts/inter-latin.woff2` is served from origin, NOT Google Fonts CDN: CSP is `font-src 'self'`, and self-hosting keeps the app offline-first with no third-party request. `--font-sans` in `:root` is the single place the stack is defined, and every page's `body` and form control uses it. Do not re-add a Google Fonts `<link>`. A display face was tried and reverted (owner decision) — don't add a second face without a fresh discussion. Detail: `css-tokens.md` → "Self-hosted Inter typeface". |
| **No native `<select>` POPUP** | A select's list is drawn by the OS, so the app's design stops at its edge — on Android it is a full-bleed Material radio sheet, which is how a ~50-name roster arrived as fifty oversized ungrouped rows. **Every dropdown a reader READS goes through `enhanceSelect` / `initSelectSheets` (`select-sheet.js`)**; the `<select>` stays as the value holder, so consumers are untouched. The rules an ENHANCEMENT breaks without touching the call site — the `.fieldpick` and `#<id>Trigger` CSS counterparts, never `.focus()` an enhanced select, announce a selection changed IN CODE, never enhance a `hidden` one — are numbered contracts in **`select-sheet-parity.test.mjs`**, each failing with its own fix. That file also holds every native-by-decision exclusion with its reason and carries the argument; DECISIONS.md has the history, including the sign-in cascade (decided and enhanced, 9 Sep 2026). |
| **The OS draws nothing the app can draw** | The `<select>` rule above, generalised: where the platform draws a control, the app's design stops at its edge. Checkboxes and radios (ONE recipe in `shared.css` — recolour through `--check-fill`/`--check-border`, and never set a size or an `accent-color`), textarea resize grips, scrollbars, `::selection`, `::placeholder`, `caret-color`, autofill's repaint and the password field's OS buttons are all app-drawn now. **`title` tooltips were REMOVED, not rebuilt** — a hover-only surface is the wrong answer on a phone, so the few that explained a DISABLED state became a line in the row instead. Safari's strong-password button is LEFT: a feature, not a duplicate. `native-surface-parity.test.mjs` enforces every recipe; the reasoning is each recipe's own header, `.claude/rules/css-tokens.md` → Checkboxes and radios / The six the first audit missed, and DECISIONS.md → Tooltips. |
| Pointer Events API for swipe | Handles touch, mouse, and trackpad in one handler (the Calendar's month swipe, the Admin week swipe, the range picker). Do not revert to Touch Events. |
| CSS variables for all colours | Defined in `:root`. Never hardcode hex anywhere in CSS or JS — `css-hex-parity.test.mjs` enforces it. Four structural exemptions (a token DEFINITION, a `var()` fallback, a mask channel, `@media print`) and one named JS exemption, each argued in that file's header: do not add a fifth without one. The surfaces, motion and type scale — never below 16px on a focusable field (iOS focus-zoom) — are `.claude/rules/css-tokens.md`. |
| Semantic elements (`<nav>`, `<header>`, `<main>`) | Screen readers depend on these landmarks. Do not revert to `<div>`. |
| `isChristmasRD()` applied before Firestore overrides | Forces Dec 25 and Dec 26 to RD first; Firestore can then override Dec 26 to RDW for overtime. Never reorder this. **Christmas LEAVE sits on top of it** in `christmas-leave.js`: from 2026 a member whose PATTERN had them at work is shown on leave there, never counted and never stored, and every surface draws a day through `resolveDayShift` — `CALENDAR_DATA.md` 19. |
| `getBaseShift(member, date)` for all base shift lookups | Direct access to `roster.data[week][day]` bypasses `startDate` suppression, Christmas rules, and future base-shift logic. Always call `getBaseShift()`, never read `roster.data` directly. |
| `isBeforeMemberStart(member, date)` in `override-utils.js` | Returns true if `date` is before the member's `startDate`. Always use this helper — never inline the date comparison. |
| **Sundays are non-contracted — AL and Absent cannot be recorded on Sundays** | Sundays are uncontracted for all grades. The forbidden write types are declared ONCE, as `SUNDAY_FORBIDDEN_TYPES` in `override-utils.js` — `annual_leave`, `sick`, `other` and plain `shift` (a worked Sunday is `rdw`, deliberately absent). **Do not restate the list in prose or in a new call site**; consult it, or be pinned to it by `override-utils.test.mjs`. **SIX enforcement layers, none removable alone** — they are numbered in the code comments, so APPEND rather than renumber: (1) week-grid disables the AL/Absent pills on Sunday rows and the Shift pill too; (2) bulk-apply silently skips Sunday rows; (3) `recordRangeOverrides` filters Sundays out of `workingDates`; (4) roster upload normalises a Sunday `AL`/`SICK` to `RD`; (5) display — `isOverrideDisplaySuppressed` hides a leave, absence or Other override on a Sunday, so legacy data never renders; (6) the single-row save in `admin-app.js`, which answers for all four types with three different outcomes (`shift` → promoted to `rdw`; `other` → refused unless Spare; `annual_leave`/`sick` → refused) and so cannot loop over the list — pinned to it by a test instead. A worked Sunday time is always RDW, never AL/Absent. |
| **`🪑` is the absence emoji — do not change** | Absence covers sickness, childcare, bereavement, and other reasons. Using 🤒 implies illness — GDPR concern. The reason for absence is never stored. **Always ask Gareth before changing the absence icon.** |
| `touch-only` CSS class in `shared.css` | `display:none` by default; revealed via `@media (pointer: coarse)`. Use for touch-only UI. Do not use inline `display:none`. **Gesture-tutorial UI must only show on touch devices** — guard it with `window.matchMedia('(pointer: coarse)')`, as `initSwipeHint()` in `calendar-app.js` does. |
| **Do not gate layout on `(hover: hover) and (pointer: fine)` alone** | Some Android devices misreport `hover: hover`. For layout breakpoints, always use `min-width`. Hover/pointer queries are only safe for cosmetic `:hover` transitions. |
| `lsGet` / `lsSet` / `lsDel` / `lsKeys` from `ls.js` | iOS Safari private mode throws `SecurityError` on any `localStorage` access. **Never call `localStorage` directly** in `calendar-app.js`, `admin-app.js`, or `paycalc-app.js` — always use these wrappers. `lsKeys()` returns a safe snapshot of all key names for code that must enumerate storage (e.g. the paycalc namespace migration). |
| Per-member paycalc localStorage namespacing | On a shared device two staff must not read each other's pay data — every per-member key carries a `myb_pc_<slug>_…` member segment (`pcPrefix()` in `paycalc-migrations.js` is the single source; Settings' backup reads through it too). **Never read/write a paycalc key without `pcPrefix()`/`SK`, and never namespace device-level flags** (`DEVICE_KEYS`). **A retired device flag stays declared** in `RETIRED_DEVICE_KEYS`: nothing writes it any more but it still exists on devices, and deleting it reclassifies it as member data and fires the ownership prompt at people with none. Legacy unnamespaced data is claimed via a one-time ownership prompt, never silently. Full detail: `.claude/rules/paycalc.md`. |
| 3-digit time input auto-correction — `formatClockInput` / `finaliseClockInput` in `clock-input.js` | While typing, three digits whose FIRST is 3–9 take a leading `'0'` (`"630"` → `"06:30"`, never `"63:0"`). A first pair of 24–29 (`"240"`) may be the start of `"2400"`, so it waits for the box to be LEFT; every consumer calls both. One rule for every text clock box — no page keeps its own copy. |
| **Calendar access: a named session OR the staff PIN** | `overrides` reads need a bound member (`isMember()`), `admin` or the shared `calendarViewer` capability. **Sign-in card first, PIN one tap behind** — an order, not a grant. **Anonymous grants nothing**, which is the substance: the Calendar used to sign every visitor in anonymously, so `request.auth != null` would re-admit exactly the people it closes out — ask for a CLAIM, never a session. The PIN is the real boundary; rollback is reverting a release. **The invariants are NOT restated here**, because two contracts own them and both require linking rather than repeating: `CALENDAR_DATA.md` 3/4/11/12 and `AUTH_AND_SESSIONS.md` 7–10, 19–20, **18** (the PIN is a barrier, not authentication — and what no surface may say about it) and **24** (the pages it may read). Before the grant, a member may see their own stored roster, labelled (owner, 5 Oct 2026 — `CALENDAR_DATA.md` 17, DECISIONS.md). Rollout, rollback, the caching caveat and the standing GCP IAM prerequisite: RECOVERY_RUNBOOK.md → "The Calendar PIN"; operations: OPERATIONS_REFERENCE.md. |
| `cors: ADMIN_FUNCTION_ORIGINS` on every endpoint the browser calls | Each restricts CORS to the explicit origin allowlist `ADMIN_FUNCTION_ORIGINS` in `functions/index.js` — defence-in-depth on top of the real control, each endpoint's own check (an ID token and claim for all but the two public ones). Add any new hosting domain to that array, with the API key allowlist (Project identity). `ingestHuddle` keeps `cors: false` (server-to-server). |
| Canonical lightbox lifecycle | Every `.lb-overlay` lightbox is built with **`createLightbox({ overlay, content, closeBtn, initialFocus, onOpen, onClose })` in `overlay.js`** — do NOT hand-write the lifecycle in a page module. It owns focus save/restore, the scroll lock, Android Back, Escape (the topmost overlay only), the Tab trap, backdrop/close-button close and the mandatory `transitionend` fallback. Close controls are `<button class="lb-close">`, never `<span>` — not keyboard-focusable. **A one-time notice opens through `openNoticeIfClear(lightbox)`, never `lightbox.open()`.** **Three exceptions, each with its reason: AI_MAP → `overlay.js`** — the drawer's two lightboxes (they share the drawer's history entry, which is why they hand-roll it) and the huddle viewer (a full-bleed panel). The mechanism: `.claude/rules/nav-drawer.md`. |
| Page chrome — the header and the drawer | Every app page has the burger `#navMenuBtn` and the shared drawer (`initNavPanel`), passing its pill gates, `onLogoClick: () => openAboutLightbox?.()` and its `onSignOut`. Sign-out lives only in the drawer footer and About opens from the drawer head. A sub-page's header logo goes back to the calendar (`wireHeaderLogo`, `about-lightbox.js`) and there is no header back button; the Calendar's own header logo opens About and must not navigate. Detail: `.claude/rules/nav-drawer.md`. |
| Overtime page — the two audiences | **PAUSED**: `CONFIG.OVERTIME_ENABLED` false closes it to all, admin included (OVERTIME_AVAILABILITY.md → Paused). Reviewing and PARTICIPATING reach the same page, and keeping them apart is a safety property: a reviewer sees everybody's declarations, a beta participant answers only for themselves. **Reviewing** = the `admin`/`manager` claim (`isOvertimeReviewer`). **Participating** = a name in `CONFIG.OVERTIME_BETA` (`roster-data.js`) — **regenerate in the same commit**: `selectParticipants` reads the server copy. The nav pill and the page policy both gate on `canOpenOvertime` (either audience), and every page coordinator must pass it (page-contract-parity enforces it). **Never widen `isOvertimeReviewer` to make the pill work** — that hands a beta tester everybody else's availability (AUTH_AND_SESSIONS.md 14). |
| Huddle notification → `#huddle` hash pattern | SW navigates to `#huddle`; the `hashchange` handler in `calendar-huddle-viewer.js` triggers the viewer (`calendar-doc-viewer.js` handles `#circular`/`#newsletter`). **Two viewer paths — do not unify, and do not revert the notification path to a direct `window.open`/`location.href`:** with `htmlContent` (DOCX converted server-side) it renders inline; without it (PDF, or a failed conversion) the viewer offers an in-overlay "📄 Open Huddle" button, whose click is a REAL GESTURE — a direct open on a hash-open would be pop-up-blocked or knock the PWA out of standalone. The viewer opens **only** via the `#huddle` hash, from both the drawer link and a notification tap. **The three documents are behind the PIN or a password (owner decision, 7 Sep 2026)** — the viewers and the drawer's links consult `calendar-doc-access.js`, so a locked visitor's tap is answered with what to do and no read is issued. Full rationale: **OPERATIONS_REFERENCE.md → "Huddle notification tap behaviour"**. |
| `initErrorReporter()` call pattern | It writes to Firestore `clientErrors`, so a valid auth token is required. **Never call it bare** — without an auth context every write is silently rejected by the rules, so the error log looks HEALTHY because it is broken. **Four canonical call sites**, differing because the pages establish identity differently: the Calendar (`calendarAuthReady`, which resolves only once access is granted — a locked Calendar starts no reporter), the pages with `sessionReady`, the Pay Calculator (which has none), and Trains' PIN branch once `holdsStaffPin` has confirmed the viewer. The exact shapes: the header of **`error-reporter.js`**; the rule: `AUTH_AND_SESSIONS.md` invariant 13. |

---

## One-time notice pattern

**Invoke `/new-notice` to add, re-post or retire a notice.** The skill (`.claude/skills/new-notice/`)
holds the HTML template, the JS patterns, the rules, the lessons of past notices and **the
current-notices table**, which is kept current there.

- **Every notice declares an AUDIENCE** — `'members'` (the default: anything about pay, settings or
  an account), `'signed-out'` (only where nobody is signed in on this device — a PIN unlock) or
  `'everyone'` (rarely right). The rule is `noticeAudienceAllows` in `calendar-access-core.js`; a
  refused notice is left unflagged, so it arrives when that device's position changes. No live notice
  is `'signed-out'`, so **the positive direction of the gate has nothing exercising it** until the
  next one — the skill names the two tests that come back with it.
- **A notice opens through `openNoticeIfClear(lightbox)`** (Canonical lightbox lifecycle, above).
- **A notice goes INERT the moment `isNoticeExpired` fires** — it is marked seen *without being
  shown*, long before the removal rule below — so the table's Status column must say so.
- **Monthly cleanup:** on the 1st of each month, remove every notice where `(today − Posted) > 180 days`
  — delete the HTML block and the JS IIFE, remove its row from the skill's table, and bump the version.

---

## Payday calculator — integrated

| Component | Location |
|-----------|----------|
| `getPaydaysAndCutoffs(year)` | `roster-data.js` |
| `isPayday(date)` / `isCutoffDate(date)` | `roster-data.js` |
| 💷 / ✂️ calendar markers | `calendar-renderer.js` — `.payday` / `.cutoff` CSS classes |
| `getRosterSuggestion(p, member)` | `paycalc-roster-suggestions.js` — counts Sat/Sun/BH/Boxing Day/RDW, and **never infers an ambiguous category** (swap shifts, rest-day weekday overrides) — a permanent policy, `paycalc.md` invariant 11 |
| `getEffectiveContr(p)` | `paycalc-settings.js` — contracted hours, pro-rated if member has `startDate` in the period |
| Reference guide | `paycalc-guide.html` |

---

## Shift types

| Value | Badge | Meaning |
|-------|-------|---------|
| `'RD'` | 🏠 Rest | Rest day |
| `'OFF'` | 🏠 Rest | Off day — bilingual roster only, treated identically to RD |
| `'SPARE'` | 📋 Spare | On standby, shift not yet assigned. Type `spare_shift`. Recorded via the **Other** pill's submenu, but stays its own type/badge |
| `'RDW'` | 💼 RDW | Rest day worked — overtime |
| `'AL'` | 🏖️ AL | Annual leave |
| `'SICK'` | 🪑 Absent | Sick/absent day — recorded via override |
| `'HH:MM-HH:MM'` | ☀️/🌙/🦉 | Worked shift |
| `'TRG'` / `'IND'` / `'ASSESS'` / `'TEAM'` / `'UNION'` / `'MEET'` (+ optional `' RDW'`, `' HH:MM-HH:MM'`) | 🏷️ Train / Ind / Assess / Team / Union / Meet | The **"Other" family** (OTHER_DAYS.md): Training / Induction / Assessment / Team Day / Union course / Meeting. `'TEAM'` appears on the roster as the multi-word label "Team Day", `'UNION'` as "Union course", and `'MEET'` as the code "MTG" (also "MEETING"); the parser collapses each to its sentinel. LEAF-GREEN `other-day` family (`--other`, hue 136° — deliberately NOT bronze, which was hue-identical to Early's orange); hours slot shows actual times → `RDW` → base time — **except Meeting/Union (`hideBaseTime` in `OTHER_FLAVOURS`), which show the badge with NO time** unless a time is actually entered (they're attend-an-event days, not tied to a rostered shift; Training/Induction/Assessment/Team keep the base time as they run during your shift); tap shows the FULL word; pays as the day underneath (`resolveOtherPay` in `override-utils.js` — flavour-agnostic, unaffected by `hideBaseTime`); Sundays and Boxing Day (26 Dec) can never be training/Other days (confirmed by Gareth Jul 2026). The unknown-value fallback classes are `unknown-day`/`badge-unknown`, which keeps the `other-*` names free |

**Classification:** Early 04:00–10:59 · Late 11:00–20:59 · Night 21:00–03:59

**isWorkedDay:** false for RD, OFF, SPARE, AL, SICK. True for everything else including RDW.

---

## Roster data structure

### teamMembers fields

> **⚠️ The member table is WORLD-READABLE.** It lives in `roster-member-data.js` (re-exported by
> `roster-data.js`), and both are served from both origins with no session, no PIN and no token:
> every name on the roster, each one's pattern and cycle position, and whatever optional fields an
> entry carries — join dates, a joining year's pro-rated leave, scheduled roster moves, and which
> people hold a BILINGUAL CONTRACT, which is a fact about their terms rather than their rota. That the
> base roster is public is a deliberate classification (owner, 4 Sep 2026 — shift patterns are on the
> station's own printed rosters); the reasoning is `AUTH_PLAN.md` §2. **A field added there is
> published the moment it ships**, so anything a stranger should not read belongs in Firestore behind
> a claim — as `staffContact` (the work email) already does. `public-data-classification.test.mjs`
> fails on an unclassified field. State the exposure as KINDS of field, never as counts: a tally
> describes the file only until the next edit. **A PATTERN IS PUBLIC; A PAYSLIP IS NOT** —
> `payroll-anonymity.test.mjs` fails when a roster name sits on the same line as a payroll term
> anywhere in the tracked tree, because the Pages mirror serves the test files themselves (measured:
> 200 there, 404 on Firebase). Keep the arithmetic, drop the attribution.

The field reference — every field with its meaning, `rosterChanges`, the cycles and the fixed
patterns — is **`.claude/rules/roster-data.md`**, which loads with `roster-data.js`. Three facts every
area needs:

- `name` **MUST match Firestore `memberName` exactly**.
- `rosterChanges` (scheduled roster moves) are applied by `getBaseShift` and `getWeekNumberForDate`
  through `resolveMemberRoster`, so **no call site needs special handling**.
- Each rotating cycle's length is a `CONFIG.*_ROSTER_WEEKS` constant (never write the number down).
  `fixed` never rotates: its `currentWeek` selects a `fixedRoster` pattern, and **a pattern is SHARED,
  so editing one member's hours there edits everyone on that line.**

**AL entitlement** — read the whole allowance through `entitlementFor` in `al-entitlement.js`, never
`getALEntitlement` (`roster-data.js`) directly: it adds the day in lieu for working a Boxing Day the
member was due to work, from 2026, and `christmas-leave.test.mjs` fails on any other caller.
`proRatedAL[year]` takes priority for every role **except Dispatcher**, where it scales the BASE only
and the lieu days are still added on top (owner decision): the 22 is an allowance a part-year
deserves part of, a lieu day is owed because a specific day was worked.

| Role / type | Days |
|-------------|------|
| CEA on a **bilingual contract** (`bilingualContract: true`) — the CONTRACT, not the line | 34/year |
| CEA, every other contract (main, fixed) | 32/year |
| CES (`ces`) | 34/year |
| Dispatcher | 22 + 1 lieu per BH worked (`countDispatcherBankHolidaysWorked`) — a joining year's `proRatedAL` replaces the **22**, never the total |
| anything else, or an unresolved member | **`null`** — no entitlement on record, never a guessed figure. Not reachable today: every Management row is hidden from the pickers (`calendar-member.test.mjs` pins that). **Callers must TEST for null and refuse to render**: `null - taken - booked` is a NUMBER, not NaN, so the arithmetic that looks harmless is the one that invents a balance. |

### Firestore collections

Every collection's fields, meanings, access summary and retention: **`docs/DATA_MODEL.md`**.
`firestore.rules` remains the authority on access.

Override cache key: `"memberName|YYYY-MM-DD"`

## Key rules

- **Offline first** — Firestore is an enhancement. Every Firestore call needs a silent fallback. Never block rendering waiting for Firestore.
- **Mobile is primary — TWO platforms, served EQUALLY** (owner, 8 Sep 2026). Test every change at
  375px, on both engines. **Who runs what is an OWNER FACT: do not infer it from a screenshot, a bug
  report or one device** — this line has been wrong in both directions.
  - **Android and iOS are both first class. Neither is the default and neither is the edge case.**
    The owner's own phone is Android and the personal-phone population is mixed, so there is no
    majority path to design toward.
  - **The work phone is Android, and getting the app INSTALLED on it is the GOAL.** The company does
    not permit the install today, so on the device staff carry on shift there is no home-screen
    icon, no standalone window, and nothing that only an installed PWA gets — a feature that assumes
    the install is invisible to somebody at work. Treat that as a **current restriction with a
    direction of travel**, not a permanent property: the Android install path
    (`beforeinstallprompt`) is as load-bearing as the iOS one, not a fallback behind it.
  - **The iOS hazards stay defended — they are PLATFORM FACTS, not a claim about numbers.** Web Push
    exists only inside an installed PWA, there is no system Back, `localStorage` can throw, a Safari
    tab loses ALL its storage after a week away while the Home Screen app keeps a separate store, and
    Safari fires neither `beforeprint` for AirPrint nor `transitionend` on a backgrounded tab.
    `install-prompt.js` and `notif.js` already branch correctly for both engines. **Oldest iOS
    supported: 16.4** (owner, 7 Nov 2026 — DECISIONS.md).
  - **Chromium gates every deploy and WebKit does not** (`npm run test:webkit` is branch CI only) —
    an unequal gate under equal service, weighed and left as it is (owner, 8 Sep 2026; DECISIONS.md,
    with the trigger that would reopen it). **Weigh a WebKit failure on a branch accordingly**: it is
    the only lane that sees Safari before release.
- **Print CSS** — any new shift type, cell class, or badge needs `@media print` rules.
- **No `alert()`** — `console.error()` for developer errors. No visible error text for recoverable failures.
- **Code quality** — pure functions where possible, JSDoc on all functions, meaningful variable names, error handling on all async operations.

---

## Known issues & deferred work

Active constraints and deferred fixes, including task #1 of the four v11 security tasks: **see
`KNOWN_LIMITATIONS.md`**. Future capabilities: **see `ROADMAP.md`**; UX experiments tried and
reverted, and everything closed: `ROADMAP_HISTORY.md` → "Tried and held back". Decisions already
taken, so they are not re-argued: **`DECISIONS.md`**.

**Do-not-change UI labels (Claude-relevant):**
- **Admin button label** — "Admin" = administration, not administrator. Intentional. Do not rename.
- **The Huddle upload button reads "Choose file"**, not "Choose PDF" — intentional, a Huddle can be PDF or DOCX.
- **`AL` and the Admin pill row** — `.claude/rules/admin.md` (the `AL` label stays short; new day kinds go into the Other submenu, never a new top pill).

### Staff-facing wording conventions

Applies to **all user-visible copy** (cards, hints, tips, lightboxes, error banners, notifications) — not to code identifiers, data values, or comments.

**"the admin" vs "your manager" — who a staff member is told to contact:**
- **App / account matters → "the admin".** Anything about the app itself or a staff member's account: password reset, who can read a saved work email, a technical failure (roster won't display, a Huddle link is broken, data won't load). The admin (developer/app owner) fixes these.
- **Work / operational matters → "your manager".** Anything about the roster as work: booking annual leave, recording absence, shift changes, general rota queries. The manager owns these.
- Rationale: staff can't fix app faults by asking a line manager, and the admin isn't the right contact for an AL request. Matching the contact to the problem is the whole point. When in doubt, ask: *"is this a broken-app problem or a work problem?"*
- Note on data access: only the **owner + admin** can read a `staffContact` work email (Firestore rules) — a manager cannot — so "only you and the admin can see this email" is the factually correct phrasing, not "your manager".

**Canonical terms (use these exact forms in visible copy):**
- **"Change a Shift"** — never "override", "Recording a Shift Change", or "shift override" (the word "override" stays in code/data only).
- **"Absent" / "record an absence"** — never "sick"/"sickness" in UI copy (the reason is never stored — GDPR). The internal data value `SICK` and ids are fine.
- **"Year to Date"** — always spelled out, never bare "YTD". The two payslip figures are exactly **"Taxable Pay"** and **"Tax Paid"** (never "Gross Pay" for the YTD figure). See `.claude/rules/paycalc.md` → payslip line names.
- **"Fill from calendar" / "From your calendar" / "Replace with calendar values"** — the paycalc pre-fill reads the *calendar* function, not the base roster; do not reword to "roster".
- **"account recovery"** is the term for what a saved work email is FOR (owner decision; it replaced "self-service password reset (in a future update)", which was accurate and read like a product roadmap). It separates the two questions a member actually has. **Why you are giving us this:** "Save your Chiltern work email for account recovery." **What works today:** "Self-service recovery isn't available yet. For now, ask the admin if you forget your password." Never "coming soon". The future email route is SECURITY_RELEASE_PLAN.md track C2. A password *reset* exists **today** via the admin (Operations → Account status → Reset), and staff can set their own password (Settings → Password), so do NOT say a password reset is flatly "not available" — only the *email self-service* route is future. Present-day recovery copy is "To reset a password today, contact the admin."
- **App name "Marylebone Roster"** — the on-screen name everywhere (incl. bug-report `appLabel` as "Marylebone Roster — <Page>"). **Never "MYB" for the APP or one of its tools** — not "MYB Roster", not "MYB Pay Calculator", not "MYB member". As the app name it survives only in the iOS home-screen `apple-mobile-web-app-title` meta, the manifest's `short_name` (exempt by key in `app-name-parity.test.mjs`) and comments.
  **But MYB as the STATION CODE is correct and stays** — it is Marylebone's three-letter code, staff use it daily, and the guides carry "Chiltern Railways · MYB Station" and "Typical MYB — Network-area journeys" correctly. The test is what the letters NAME: the station, fine; the software, never. Enforced by `app-name-parity.test.mjs`.
- **Documents:** "Daily Huddle" (proper noun), "Weekly Retail Circular", "Marylebone Newsletter".
- **Never name an internal document in staff-facing copy.** "The draft roster has been planned" was date-accurate and still read as untrue, because the draft is the roster office's own artefact and "the roster" to staff means the one released on the Thursday. Describe the reader's own position instead. The **reviewer's** surfaces and OPERATIONS_REFERENCE may name it freely; it is their document. Pinned by `overtime-format.test.mjs`.
- **Tone:** calm and factual — no exclamation marks, no marketing voice (mirrors `.claude/rules/notifications.md`).

**Plain English that TEACHES — write for the colleague who has never heard the term** (owner, 3 Sep 2026).
Many colleagues do not know what HPP is, how back pay works, or how to use a FIP card or coupon. The
app's job is to let them use and discover these things without asking anyone — and without being
overwhelmed. "For dummies" is the standard, not an insult. The rules, each learned the hard way:
- **Audience first.** Every staff-facing surface must work for someone who does not yet know the
  word. Expand a term on first sight within a surface (HPP → "Holiday Pay Premium"); never assume
  the abbreviation is understood because it is on the payslip.
- **Educate in place, at the point of use.** The guides are for depth; the row, card header or `?`
  panel is where the learning happens. The pattern that works is already in the app: *name → one
  sentence on what it is → where you see it in the real world* — "Paid once a year on a January
  payslip — look for the green note on that payslip"; "Shows as 'RDW Sun 1.5' on your payslip".
- **A collapsed header is a teaching surface, not unused space.** The title + hint of a collapsed
  card is persistent micro-documentation; ask what its collapsed state is communicating before
  hiding, grouping or shortening it. This nearly went wrong once: DECISIONS.md → "More pay tools …
  DECLINED", and `.claude/rules/paycalc.md` → invariant 16.
- **Discovery must not depend on data the member has not supplied yet.** A contextual prompt gated
  on a stored figure reaches only people who already know. Before relying on one, check the
  "new member, nothing entered" cohort still has a route — that cohort is who the education is for.
- **Not overwhelming means fewer DECISIONS at once, not fewer words or pixels.** Simplify by
  reducing what the reader must decide, and by sequencing; never by removing the explanation. Page
  height is not a UX metric. The question is where staff spend effort for little value.
- **Educational is not chatty.** The calm tone above still applies; one idea per line.
- **Test it on the reader, not the owner.** The check for a new surface is a colleague who does not
  know the term using it from the app alone. And score two things separately, because they are not
  the same: **usability** (can somebody who understands the subject work the screen?) and
  **learnability** (can somebody who does not yet understand it learn enough here to act correctly?).
  A colleague can be a fluent phone user and still have no idea how a FIP coupon works.

**The four things a surface owes a member, in order.** This is not an imported UX model — it is the
app's own best pattern, named. Every Hours row already does all four:
**Discover** it exists (*"Rest Day Working"*) → **Understand** it in one sentence (*"Came in on a
rest day, or worked a Saturday that wasn't in your roster"*) → **Act** (*"Shows as 'RDW 1.25' on your
payslip"*) → **Deep dive** on demand (the card body, the `?` panel, the guide).
**Progressive disclosure may hide the fourth. It may never hide the first.** That single line is what
separates good hiding (*"Holiday Pay Premium — paid once a year on a January payslip"* with the
calculation fields collapsed beneath it) from bad (*"More pay tools ▾"*, where the member cannot know
a premium is in there).

**One question decides any hiding proposal: *what knowledge disappears if this is hidden?*** If the
answer is "none, it is depth" — hide it. If a member could stop knowing the thing exists, do not.

**Searchability is not discoverability.** The cross-guide search is genuinely good and does not solve
this: a member who has never heard of an International Coupon cannot search for one, and a member who
does not know they receive a Holiday Pay Premium cannot search "HPP". Orientation, headings and
signposting come first; search serves the member who already knows what they are looking for. Do not
answer a discovery gap with "it is findable".

**Challenge both extremes.** *"This is too complicated, hide it"* and *"the information is technically
present somewhere, so discovery is solved"* are the same failure from opposite ends, and this app has
now produced one of each. Neither is good enough, because there is frequently **nobody to ask**: a
colleague on a late turn wondering about January's payslip has no manager, no colleague and no
helpdesk at 22:00. The app is the source. See ROADMAP.md → "Plain-English education pass".

---

## Huddle ingest

Daily Huddle PDF/DOCX → Power Automate → `ingestHuddle` → Firebase Storage + Firestore `huddles` collection + push notification. Full flow diagram, request format, gotchas, and Security Rules: **see `OPERATIONS_REFERENCE.md`**.

**Push notification design language:** all Web Push payloads must follow `.claude/rules/notifications.md` — leading emoji = the feature's in-app icon, "Latest X" for document arrivals, calm/no-exclamation tone, monochrome badge, and a single `buildPushPayload` builder. Never hand-write a payload literal.

---

## Weekly Roster Upload

Admin uploads PDF → `parseRosterPDF` (model and settings: `MODEL_REQUEST` in `functions/roster-prompt.js`) → JSON → review UI → Firestore. Works for CEA/Bilingual, CES, and Dispatcher rosters. **`source: 'roster_import'`** on all roster-upload overrides — used by `computeCellStates()` for COVERED/DIFF/CONFLICT classification.

**Everything else about the import is `.claude/rules/roster-import.md`**, which loads whenever the
parser, the alignment check, the review states or the cell controls are opened. **Read it before
changing anything in the import** — every rule in it is there because a week was written onto the
wrong days, or nearly was. Full request/response format and review pipeline: **see `OPERATIONS_REFERENCE.md`**.

---

## Firebase Auth (complete — v7.94)

All staff have Firebase Auth accounts. **Firestore writes need a claim, never a bare
`request.auth != null`** (AUTH_AND_SESSIONS 9). The contract is `docs/AUTH_AND_SESSIONS.md`; the
working notes are `.claude/rules/sessions.md`, which loads with the session and auth modules.

- **Every write page re-establishes the Firebase session on load**, through `ensureNamedSession(name)`
  (`session.js`). A returning member with a valid 60-day local session skips the login screen, so
  without it `auth.currentUser` stays null and every Firestore write fails. Do not remove this call.
- **Per-member write isolation is STRICT**: an `overrides` write needs the member's own bound name, or
  an `admin`/`manager` claim writing on behalf (AUTH_AND_SESSIONS 4, 19).
- **Three claim tiers**, all set by `setupRosterAuth` from the server-owned list — admin, manager,
  member, with `linksDesigner` on top (AUTH_AND_SESSIONS 3). **The `manager` tier is load-bearing**:
  managers edit staff AL/sick/shifts on behalf daily, and without it the isolation rule silently locks
  them out. Master-admin collections (huddles/circulars/newsletters/roster/auth) stay `admin`-only —
  **do NOT grant managers `admin: true`.** A newly listed manager needs Operations → Set up accounts
  and a token refresh before their writes work.

**New starter:** invoke `/new-starter` — the skill has the full 3-step checklist, mid-year field reference, and pro-rata formula invariant.

**The depot annual-leave workbook (the roster clerks' Excel file):** invoke `/al-workbook` the moment one is uploaded, or any question is asked about somebody's leave, allowance or days remaining. It is a TRIGGER, not a checklist — it sends you to `docs/AL_WORKBOOK.md` §0 and requires the learnings to be written back in the same session. **Read §0 before answering from the spreadsheet** — answering first has gone wrong twice, on the same person, in sessions that had the document: a person's `AL over depot quota` days are real leave, invisible in the calendar grid, and belong in any list of their annual leave.

**Removing a staff member:** invoke `/leaver` — the ordered checklist, including the step everybody gets wrong (**upload their final roster PDF FIRST**: `hidden` also drops them from the AI-parsing name list, and a later upload then reports their row as `missingMembers`, which reads exactly like a genuine absence) and the verification step that closes it (the Staff Login Accounts audit — every other failure in the sequence is silent). The reasoning, and what it deliberately does not do (Overtime weeks are frozen; their data stays): OPERATIONS_REFERENCE.md → "Removing a staff member".

Email/password convention: **see `OPERATIONS_REFERENCE.md`**.

---

## Pay calculator — current reality (v8.21+)

Manual-entry: staff enter hours, and the calculator computes tax, NI, pension and take-home.
**The pay rates, London Allowance and pension defaults — and how a mid-year award step and the opt-in
back-pay lump work — live in `.claude/rules/paycalc.md` alone** (code: `paycalc-calc.js`). Do not
restate the figures; when the next award is announced, follow paycalc.md → Current rates. Roster-assist
pre-fills Sat/Sun/BH/RDW; standard weekday hours are not pre-filled.

**Example payslips for testing:** the pay-maths regression net is real payslips, kept OUT of the
repository — what it is, why it is gitignored, and what `npm run test:payslip-local`'s green proves:
`.claude/rules/paycalc.md` → Example payslips, which loads whenever a paycalc file is open.

---

## Guide pages (railcard, FIP, guide shell)

The guide pages — one per `NAV_GUIDES` entry in `nav-panel.js` — share `guide-shell.css` (sticky header, back/PDF buttons, print rules, brand palette tokens). Each has its own CSS file. No `shared.css` import. No inline scripts or `onclick` (CSP blocks them). Full design principles, factual accuracy notes, and shell spec in `.claude/rules/guide-pages.md`.
