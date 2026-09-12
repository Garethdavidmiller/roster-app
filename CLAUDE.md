# CLAUDE.md

*Last updated: September 2026 — v23.60 · Updated every 0.10 version*

# Claude Code Instructions — MYB Roster App

## Project identity — read this first

| Property | Value |
|----------|-------|
| GitHub repository | `Garethdavidmiller/roster-app` |
| Firebase project ID | `myb-roster` |
| Firebase project region | `europe-west2` (London) |
| Documentation milestone | `23.60` — the 0.10 checkpoint these docs are written against. **This row is deliberately NOT the current version**, and used to be: it read `23.23` while the app shipped 23.24, then 23.25, then 23.26 — a figure that rots on every release and that nobody bumps, because bumping it is not part of shipping. The exact version lives in `roster-data.js`, where `APP_VERSION` is authoritative and is the only place a reader should look for it. What the guard actually requires here is the MILESTONE, so that is what this row now states. The version stamp in **every** doc (this file, AI_MAP, OPERATIONS_REFERENCE, KNOWN_LIMITATIONS, ROADMAP) is enforced against the latest 0.10 milestone by `sw-asset-check.test.mjs` and `githooks/pre-commit` — a bump crossing a 0.10 line fails until each doc is reviewed and re-stamped. |
| Hosted URL | Deployed to Firebase Hosting via GitHub Actions on push to `main` |
| Staff-facing URL | `https://myb-roster.web.app` (canonical — Firebase Hosting; **primary install + notification target** since v14.29). A GitHub Pages mirror is still served at `https://garethdavidmiller.github.io/roster-app/` — the **roster-app repo's OWN** Pages, built from `main`; **note the `/roster-app/` path**, NOT the bare origin (which is a separate empty repo that 404s) — **still where the MAJORITY of staff open the app** (owner, Sep 2026 — the changeover to the canonical URL is deliberate and gradual, not a rump to be discounted). That matters for any change relying on something only Firebase Hosting can do: this origin serves **no redirects and no HTTP headers**, so a rename protected by a `redirects` entry, or a policy carried by a header, reaches the smaller half of the staff. Weigh such a change against the mirror, not against the canonical URL. The `<meta>` CSP exists for exactly this reason. `STAFF_SITE_URL` in `functions/index.js` is now the bare `https://myb-roster.web.app` (no sub-path). It only sets the notification payload's path/hash — each device's service worker discards the origin and re-bases the page onto its own scope, so existing github.io installs keep working. See API key note below. |
| Cloud Function URLs | `https://europe-west2-myb-roster.cloudfunctions.net/ingestHuddle` |
| | `https://europe-west2-myb-roster.cloudfunctions.net/parseRosterPDF` |
| | `https://europe-west2-myb-roster.cloudfunctions.net/setupRosterAuth` |
| | `https://europe-west2-myb-roster.cloudfunctions.net/resetMemberPassword` (admin-only break-glass — resets a member's password to their surname default; PASSWORD_DESIGN.md Track C. Since v23.62 it also TELLS THE MEMBER on their own devices via `sendTargetedPush` — never `fanOutPush`, and never carrying the new password, because a push renders on a lock screen. Reported as `notified`, a third independently-reported stage beside `revoked` and `stamped`: past the password write this endpoint reports what happened, never "nothing did") |
| | `https://europe-west2-myb-roster.cloudfunctions.net/unlockCalendarViewer` (the staff Calendar PIN exchange, v20.12 — POST a four-digit PIN, get a custom token carrying ONE claim, `calendarViewer: true`. The PIN lives ONLY in the `CALENDAR_VIEWER_PIN` secret; never in source, docs, tests or any client asset. Server-throttled TWO ways since v20.35: 30 failed attempts per source per 15 min, **and** an all-sources ceiling of 200 per 15 min under a fixed key no header can influence — the per-source key is derived from the END of `x-forwarded-for` because a caller can only PREPEND to it, and taking the first entry (as v20.12–v20.34 did) let anyone mint an unlimited supply of buckets) |
| | `https://europe-west2-myb-roster.cloudfunctions.net/getSignInStats` (admin-only READ — the EXACT unique-account sign-in counts, from Firebase Auth's own `lastSignInTime`. Returns four integers; no identity. v18.96) |
| | `https://europe-west2-myb-roster.cloudfunctions.net/getAccountSetupGaps` (admin-only READ — who on the roster has no login, whose claim tier is wrong, and which leaver can still sign in. Returns NAMES, which is why it is not folded into `getSignInStats` and its "four integers, no identity" contract. Changes nothing. v22.53)
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

**Workflows:** `deploy-functions.yml` (functions only) · `deploy-hosting.yml` (PWA → Firebase Hosting, added v8.14) · `deploy-rules.yml` (Firestore/Storage rules). **All three authenticate via Workload Identity Federation** (`google-github-actions/auth`, pinned `v2.1.13`) — each job declares `permissions: id-token: write` and exchanges GitHub's OIDC token for short-lived credentials; there is no `FIREBASE_SERVICE_ACCOUNT` key file. **The three fire in PARALLEL from one push, with no ordering guarantee** (that is about ONE push; successive pushes now QUEUE per workflow — each deploy carries a `concurrency` group with `cancel-in-progress: false`, so a second push waits rather than racing the first and possibly releasing the older tree last) — so any change where the new client DEPENDS on new rules (a schema expansion: a new override field, a new analytics counter id, a new collection) must ship **backend-first, in its own push**: rules that ACCEPT the field first, the client that WRITES it only after the rules deploy is confirmed. Shipping both in one push opens a minutes-long window where the live client writes a field the live rules' `hasOnly()` still rejects, and every such write permission-denies (the `replacedType` release, v21.55, shipped through exactly that window; the Calendar PIN rollout made the same ordering by hand — see that entry). Loosening in the opposite direction (rules gaining a field no client writes yet) is always safe. The GitHub Pages staff mirror at `garethdavidmiller.github.io/roster-app/` is served by the **roster-app repo's own native Pages** ("pages build and deployment" — Settings → Pages → Deploy from `main`/root), so there is **no Pages workflow file**. The root **`.nojekyll`** marker (empty file — do not delete) makes Pages skip its Jekyll build and copy files directly: without it every mirror deploy ran the app through Jekyll, which hard-times-out at 10 minutes and caused repeated mirror deploy failures (Jul 2026). (The old cross-repo `deploy-pages.yml` + `PAGES_DEPLOY_TOKEN` secret were removed v14.25: redundant — they pushed a copy to a separate bare-origin `garethdavidmiller.github.io` repo that nothing used, and failed on every run.)

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

> **⚠️ BUMP AGAINST `main`, NOT AGAINST THE BRANCH YOU STARTED FROM.** Two sessions working in
> parallel will both branch from the same version and both bump to the same next one, and the second
> merge does not conflict — `roster-data.js` and `service-worker.js` already say the value the
> incoming commit wants. **v22.29 shipped twice** (the logo change, #1311, and the Huddle table fix,
> #1312) and the consequence is the one this whole rule exists to prevent: `service-worker.js` was
> then BYTE-IDENTICAL across the two releases, so a browser byte-comparing it installs no new worker
> — no activate, no new cache, no precache — and a device that took the first 22.29 keeps serving
> the first release's assets. It self-heals only on the stale-while-revalidate pass, which runs at
> most once per SW process lifetime, so the fix arrives an open or two later rather than on the next
> one. **Re-check `git show origin/main:roster-data.js | grep APP_VERSION` immediately before
> merging**, and re-bump if somebody got there first. The remedy afterwards is a fresh bump and a
> redeploy; there is no way to make the duplicated version reach those devices.
>
> **The rule WORKING leaves a gap in the version space, and that is the cheaper outcome.** There is
> no v23.22: two branches held it at once on 8 Sep 2026, both re-checked main before merging, and
> both re-bumped (to 23.23 and 23.24). A skipped number is not a mistake to hunt for — it is what a
> caught collision looks like from afterwards. Do not reuse one to close it up; the version only
> ever increases, and a number that briefly named two different trees should never name a third.
>
> **⚠️ A RED `version` JOB ON A RELEASE THAT SHIPPED FINE IS PROBABLY THE TWO-RUNS TRAP.** Every PR
> gets **two** CI runs — one for `push`, one for `pull_request` — and the second fires when the PR is
> OPENED. Merge promptly and that run's `version` job compares the branch against a main which by
> then CONTAINS it: `main is v22.99 . this branch is v22.99`, failed, and an email about a release
> that was correct. It happened twice on 6 Sep 2026. **Two lessons, and the second is the one that
> cost something:** the job now detects an already-landed branch by CONTENT and skips (ancestry
> cannot tell you, because main squash-merges), so this should not recur — and *"CI is green"* means
> BOTH runs, not the one you happened to open. Reporting a merge as fully green off the `push` run
> alone is how the first of those two went unnoticed.
>
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

## Feature contracts — read one BEFORE changing a feature

> **Lost? `ARCHITECTURE.md` is the index** (v21.38). One page: which document is authoritative for
> each subject, **what is actually deployed where that differs from what the documents describe**
> (the `EXC-*` table — when it is empty, documented and deployed have converged), and what the four
> status words mean. It holds no design and no history; if it has not sent you somewhere else, it has
> failed.

Five documents state, as numbered invariants, what each feature must never stop doing. They are
**routing tables, not explanations**: each row names the property and points at the module header
where the reasoning lives beside the code. That is the same three-homes discipline as the file tree
below — a contract that restated its own reasoning would be a fourth copy of it.

| Feature | Contract | What it protects |
|---|---|---|
| Calendar data | `CALENDAR_DATA.md` | what may be SHOWN, and when — knowledge states, the access gate, cache ordering |
| Authentication | `AUTH_AND_SESSIONS.md` | session ↔ identity ↔ claim, and the three ways they disagree |
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
| `session.js` · `login-overlay.js` · `auth-policy.js` | all six protected pages at once | `e2e/auth.spec.js` (it drives each page) |
| a COLLECTION's fields | `docs/DATA_MODEL.md` + `firestore.rules` + the client writer, together | `npm run test:rules` · `firestore-contract-parity.test.mjs` |
| `firestore.rules` | client and server together — the client copies of ownership rules only drive BUTTONS | `npm run test:rules` **and** `firestore-contract-parity.test.mjs` |
| `firebase.json` CSP header | every page's `<meta>` CSP, because the Pages mirror serves no headers | `csp-meta-parity.test.mjs` · `npm run test:csp` |
| any `overlay.js` lifecycle | every lightbox in the app, including the one-time notices | `overlay.test.mjs` · `overlay-history.test.mjs` |
| adding a PAGE | ~8 hand-maintained lists (CSP meta, nav pill, policy, SW, analytics id, boot shim…) | `page-contract-parity.test.mjs` — it checks the checkers |
| adding a MODULE or dropping an export | `CLAUDE.md` + `AI_MAP.md`, same commit | `githooks/pre-commit` · `doc-parity.test.mjs` |
| `CONFIG.LINKS_DESIGNERS` / `CONFIG.OVERTIME_BETA` | the SERVER's copy — run `npm run generate:roster-members` in the same commit | `sw-asset-check.test.mjs` |
| a Firebase SDK bump (`firebase-client.js`) | `FIREBASE_SDK_VERSION` in `service-worker.js` | `sw-asset-check.test.mjs` |
| the VAPID key | `functions/index.js` **and** `notif.js` — a mismatch is silent AND permanent | `sw-asset-check.test.mjs` |

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
See **`docs/FILE_INDEX.md`** — the one-line-per-file catalogue, moved out of this document on
11 Sep 2026 (external review). It was ~200,000 characters, 64% of a file loaded into EVERY session,
and it is a LOOKUP TABLE: a session working on the Pay Calculator paid to be told about the roster
parser, the Overtime endpoints and the FIP guide tests, on every task, for ever. Moving it changes
nothing about the discipline — the rules above still govern it, `doc-parity.test.mjs` still enforces
the entry cap, the one-entry-per-file rule and the version-stamp ceiling against it, and the
pre-commit hook still refuses a module that is not listed there and in `AI_MAP.md`.

The cap that replaced it is on THIS file's total size, because a per-entry cap never bounded a
document that keeps gaining entries — which is how the tree grew 36% under a rule working exactly
as written.
```


**The rule tested, the wiring not** — the named risk (v21.83, external review). This repo's breadth
of rule, contract and hygiene tests is its strength and also its blind spot: a helper can be perfect
and the answer still wrong, because the production line that calls it passed the wrong argument, was
never called, ran in the wrong access context, or had its result discarded. Three v21.79 defects were
that shape, and a mutation audit then found three more seams where deleting the decisive line left
every suite green. So, for anything that moves money, decides access, or names a person:

- **Test the entry point, not only the helper.** At least one test that runs the real production path
  through to the resulting behaviour — the rendered £, the written payload, the sent audience.
- **Mutate before you claim a guard.** Delete or invert the line and re-run. If nothing fails, the
  rule is documented, not protected. Say which line you deleted and what stayed green.
- **A harness that discards is a harness that cannot see.** The admin batch mock returned `set: () => {}`
  for years; nothing could assert on a payload until it recorded them.
- **Access context is a dimension.** Safe-for-a-member is not safe-for-every-unlock-mode.

**Run all tests:**
```
npm test              # test:hygiene + test:parse + test:unit (every root test file; the tree below lists them)
npm run check         # lint + typecheck + npm test (full pre-push gate)
npm run lint          # ESLint on all JS files
npm run typecheck     # tsc --noEmit on all root JS modules

# By test runner (same as npm test, useful for --watch or targeting specific files):
npm run test:hygiene  # the no-emulator, no-mock suites — the authoritative list is package.json `test:hygiene`. It is NOT enumerated here: this line used to list most-but-not-all of them while naming package.json as authoritative in its own parenthetical — a 1,085-character restatement asking not to be trusted.
npm run test:parse    # module-parse (--experimental-vm-modules)
npm run test:unit     # all --experimental-test-module-mocks tests
# EVERY SUITE THAT NEEDS NOTHING INSTALLED — for a reviewer working from a GitHub ZIP.
# The great majority of this estate runs on a bare checkout with no node_modules at all, on nothing
# but a Node binary — `npm test` INCLUDED: the whole default lane passes with nothing installed,
# which is the single most useful fact about verifying this repo and is now stated in README.md. An external reviewer reported they could not count it as executed because the
# archive "doesn't contain the necessary installed dependency trees" — true of a handful of files
# and false of nearly all the rest, and the repo had never said so. Only three things need an
# install: the Cloud Functions handler suites (`functions/node_modules`), the two rules suites (the
# emulator), and lint/typecheck/Playwright (the root install). The command PRINTS how many suites
# it is running and which it is skipping, so the figures are never written down here to go stale,
# and its exclusion list is DERIVED from the test:functions and test:rules scripts below.
# **IT NOW GATES EVERY BRANCH AND PR** as the `nodeps` job in e2e.yml (6 Sep 2026), which runs it
# with NO `npm ci` and fails if `node_modules` exists at all — the absence is the test. Until then
# nothing ran this lane, so its one claim could only be falsified by the stranger it was written
# for, and it was: `touch-gate-parity.test.mjs` had started importing `TOUCH_PROJECTS` through
# `e2e/helpers.js`, which imports `@playwright/test`, so the suite promising "nothing installed"
# was the only one in the lane that needed an install. The list now lives in `e2e/touch-projects.js`:
npm run test:nodeps

npm run test:functions # Cloud Functions tests (roster-parse-helpers.test.mjs + functions-surface.test.mjs, which requires functions/index.js and pins the deploy surface, + overtime-endpoints.test.mjs + auth-endpoints.test.mjs + push-transport.test.mjs + documents-endpoints.test.mjs + index-endpoints.test.mjs, which drives the two handlers that stayed in the composition root) — not part of npm test (needs functions/node_modules)
                       # GATES EVERY BRANCH AND PR since v21.82, as the `functions` job in e2e.yml, ON NODE 22 — the runtime
                       # functions/package.json declares. Until then it ran ONLY in deploy-functions.yml, which fires on a push
                       # to main: a Functions regression could not fail a PR, and was caught after the merge with the deploy
                       # blocked (production safe, wrong end of the merge). That job stays on Node 20 for firebase-tools auth,
                       # which is a DEPLOY-TOOL constraint — so the handlers were only ever tested on a version they never run
                       # on. Do not align the PR job back to 20.

# Firestore + Storage security rules tests (requires Firebase emulator binary — starts automatically):
npm run test:rules

# E2E smoke tests (real headless Chromium; uses pre-installed browser in the dev env):
npm run test:e2e

# Accessibility gate (axe-core, WCAG A/AA; one rendered state per page). It is GREEN + BLOCKING and
# runs inside `npm run test:e2e` — `playwright.config.mjs` testIgnores csp/visual/offline, not axe.
# This said "Opt-in" until v21.63, contradicting the tree entry for axe.spec.js. This script just
# runs it STANDALONE. Baseline + triage: A11Y_BASELINE.md:
npm run test:a11y

# Deployed-CSP proof — serves the app via the Firebase Hosting emulator (real firebase.json CSP
# header applied) and asserts real Chromium refuses nothing the app loads. Runtime counterpart to
# the static csp-hygiene.test.mjs; not part of npm test. Gated in CI (e2e.yml `csp` job):
npm run test:csp

# Visual-regression baselines (Section B / F-VIS) — clock-pinned, Firebase-stubbed, fixed-member
# screenshots of every key surface compared against committed PNGs in e2e/visual-baselines/.
# Locks page composition (incl. the accepted desktop voids) against silent CSS/layout drift.
# Opt-in and env-sensitive, so it does not GATE anything — but since v21.54 it runs in branch CI as a
# REPORT-ONLY job (`visual` in e2e.yml, `continue-on-error`) that always uploads its diffs. It cannot
# fail a build on a renderer difference nobody can act on. Same staged path the a11y gate took: watch
# the noise, and promote to blocking only if the runner proves consistent.
# **THE ARTIFACT ALONE WAS NOT THE SIGNAL IT WAS BILLED AS.** This paragraph used to claim a stale
# baseline "shows up as an artifact the week it happens"; it does not — the job is green either way,
# so nothing distinguishes a clean visual lane from a drifted one without opening the run and
# downloading a zip, and a real drift went unread for eight releases (v22.38 → v22.45) while every
# other lane passed. A signal you have to go looking for is not a signal. The job now SAYS SO on the
# pull request instead (one comment, updated in place, and edited back when the drift clears), and
# falls back to a workflow annotation on a push with no PR. It still never fails — which is the
# trap for anyone reading CI through the API rather than the PR page: **`visual: success` is not
# a drift signal and never was.** `continue-on-error` means the conclusion is `success` on a
# drifted lane and a clean one alike, so a run that reports every job green has told you nothing
# about the baselines. READ THE COMMENT. That is not hypothetical either: v23.47 rewrote both
# guides, the lane commented on the PR naming the two drifted baselines, and the session that
# shipped it reported the release fully green off the job conclusions and merged the stale
# baselines to main. Second instance of the same blind spot, first one with a machine reading
# the wrong field. Regenerate: `npm run test:visual -- --update-snapshots=all` (`=all` is load-bearing — a bare `--update-snapshots` only rewrites baselines whose comparison FAILED, so a baseline that drifted inside the tolerance could never be refreshed). **Then `git status e2e/visual-baselines/` and revert anything you cannot explain** (v19.62): `=all` rewrites every baseline including the ones that PASSED, so a run intended to capture ONE change came back with FIVE modified — four of them sub-tolerance rendering noise that would have been committed as though reviewed. Reverting a file and re-running is the check: still passes ⇒ it was noise and does not belong in the diff:
npm run test:visual

# The smoke suite under Safari's engine. Runs in branch CI, not the deploy gate. **The browser is
# NOT in a fresh dev container** — `npx playwright install webkit && npx playwright install-deps
# webkit` (the second is apt, so it needs root; without it the launch dies listing missing shared
# objects and reads like "unsupported"). Measured after that: 719 passed in 13.2 min. The standing
# "do not run playwright install" advice is about CHROMIUM, which IS pre-installed — reading it as
# a blanket ban is what left a CSS-adjacent release to meet this engine for the first time on CI:
npm run test:webkit

# THE DEPLOYMENT HEALTH CHECK against the real deployed site, both origins, root + two sub-pages.
# This is the check the "Deployment health check" section above asks for. For a long time there was
# no way to run it, so it was done by hand or not at all. Asserts served / splash down / something
# usable / no console errors. Opt-in and gates NOTHING: the network and whatever is deployed right
# now are not properties of the branch under test. Run it after a release and in a review.
# It PRINTS its mode per page. `DIRECT` is the full check; `RELAYED` means the browser could not
# complete TLS to the open internet and each request was fetched with curl and fulfilled into the
# page — real bytes, real headers, real parsing, but the API-key HTTP-REFERRER restriction and a
# live Firebase round trip are NOT covered. Do not read a relayed pass as the whole check.
# **IT ALSO RUNS ON A SCHEDULE since v23.60** — `live-health.yml`, every four hours on a GitHub runner,
# with `LIVE_REQUIRE_DIRECT=1` so a run that would have to relay FAILS rather than passing weakly
# where nobody is reading the mode line. A failure comments on the `deploy-failure` issue thread the
# deploy workflows and `production-currency.yml` already use. That hourly currency check is NOT this
# check: it asks whether the served version matches main, which a stuck splash answers "yes" to:
npm run test:live

# Offline-behaviour proof (e2e/offline.spec.js under playwright.offline.mjs) — SW/offline-first paths
# with the network cut. Opt-in, NOT in npm test/CI:
npm run test:offline
```

**Service worker caching:**
- **Update lifecycle (v15.41; hardened v15.46):** install does ONLY `skipWaiting()`; activate does ONLY `clients.claim()`; the whole-app precache runs as a DETACHED post-activation warm-up. Never move the precache back into install's or activate's `waitUntil` — install's held every update behind a no-cache fetch of every precached asset (~190 of them and growing — CORE_ASSETS + SUPPLEMENTARY_ASSETS in service-worker.js are the count, and this said ~110 for long enough to understate it by 76%) (the "app updates with a lot of lag" complaint), and activate's would queue every fetch of the freshly-reloaded page behind the warm-up. **Warm-up resilience (v15.46):** a `__precache-complete` marker is written only when EVERY asset cached; the SW's top-level startup check re-runs an incomplete warm-up on every wake (covers a killed mid-run warm-up AND first installs — offline-first coverage converges instead of silently staying partial); the fetch handler piggybacks the in-flight warm-up onto `event.waitUntil` so page traffic keeps the SW alive through it; **old-version caches are deleted only after a FULLY-successful warm-up** (they are the transition fallback — a partial warm-up keeps them and retries). The doc/navigation fallback checks the CURRENT-version cache before the global any-cache lookup (the global `caches.match` prefers the OLDEST cache, which served previous-version HTML to a fresh-JS page — a mixed-version hazard); the JS/CSS SWR path keeps its any-cache LAST resort for pure-offline mid-transition. **v16.09 latency pass:** Navigation Preload is enabled on activate (the browser starts the network-first HTML fetch in parallel with SW boot; the doc branch consumes `event.preloadResponse`); the warm-up runs in batches of 8 (not the whole list in parallel) and skips assets the reloading page already cached; fonts/icons warm without `cache:'no-cache'` (immutable, served from HTTP cache); navigations are cached under the bare path (query stripped — `ignoreSearch` on fallback match) and redirected responses are re-wrapped before caching/serving (`unredirect` — Firebase 301s `/index.html`→`/`; in-app links now navigate to `./`); the 2s abort is guarded so it can never kill a response that already resolved. An `opaqueredirect` (status 0 — a redirect under the navigation's 'manual' redirect mode, which is how navigation preload surfaces the start_url `./index.html` → `/` 301) is passed straight through so the browser follows it — treating it as a broken-site response would send every installed-PWA launch down the cache fallback. `manifest.json` `start_url` and the Calendar shortcut now point at `./` (takes effect on reinstall; the pass-through covers existing installs).
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
| **When a build step earns its keep (threshold, not yet crossed)** | The no-build rule is a deliberate trade (zero toolchain, direct debuggability, no build-supply-chain) paid for by hand-maintained work a bundler does for free: the `modulepreload` lists (index/paycalc/links — the deepest graphs; the other four carry only the three fixed gstatic SDK tags every page has, which name one URL each and cannot fall behind a graph; CI-locked by sw-asset-check.test.mjs), the SW precache, the 2-location version bump, `generate-*` codegen, the CSP `*-boot.js` shims, the pure-helper splits that keep `firebase-client.js` testable in Node, and the `normaliseSurname` browser/functions duplication. **The cost side is COUNTED FROM THE FILESYSTEM, not written here** — `doc-parity.test.mjs` derives those totals and fails on a stale figure. It has to: all five were understated at v21.62, two by ~80%, every one in the direction that makes the trade look cheaper than it is. **Revisit — do not auto-adopt — when either: (a) you want real TypeScript types** (`tsc --noEmit` runs the checker without the emit — though not over `functions/` or the SW: `typecheck-scope.test.mjs`), **or (b) a bug is traced to drift in a hand-maintained list.** Until then the trade favours no build. **A third input, measured and NOT a trigger:** the Calendar's cold parse+execute cost under 6× CPU throttling is in `LATENCY.md` → Phase 3, beside the ladder reading that would justify acting on it. Not a reason to adopt one by itself — the assets are SW-cached and the cost is one-off per version. |
| **Self-hosted Inter typeface (v11.53)** | `fonts/inter-latin.woff2` is served from origin, NOT Google Fonts CDN. CSP is `font-src 'self'` — a CDN would mean loosening it, and self-hosting keeps the app offline-first (SW precaches the file) with no third-party request. One variable woff2 (latin, wght 100–900) covers every weight. `@font-face` lives in `shared.css`; `--font-sans` token in `:root` is the single place the stack is defined; every page's `body` uses `var(--font-sans)`. Do not re-add a Google Fonts `<link>`. **Inter is the app's ONLY typeface** — a Barlow Semi Condensed display face for the hero £/month heading was tried at v16.73 and reverted at v16.74 (owner decision: the gain was modest, and Inter — a neo-grotesque like the real Rail Alphabet — already fits the brand). Don't re-add a display face without a fresh discussion. |
| **No native `<select>` POPUP (v23.33)** | A select's list is drawn by the OS, so the app's design stops at its edge — on Android it is a full-bleed Material radio sheet, which is how a ~50-name roster arrived as fifty oversized ungrouped rows. `date-picker.js` had already made this argument about `<input type="date">` and it simply never reached selects. **Every dropdown a reader READS goes through `enhanceSelect` / `initSelectSheets` (`select-sheet.js`)**; the `<select>` stays as the value holder, so consumers are untouched. **A page that styles its fields by ELEMENT (`.controls select`, `.field select`) must name `.fieldpick` beside it** — a class cannot inherit an element selector, and a trigger that misses one renders as a bare button. Three more rules an ENHANCEMENT breaks without touching the call site: an id-level CSS rule needs a `#<id>Trigger` counterpart; **nothing may `.focus()` an enhanced select** (1px and `aria-hidden` — focus `#<id>Trigger`); and **a selection changed IN CODE must say so** — `option.selected = true` mutates no attribute and fires no event, so the trigger keeps its old label (v23.42: the pay-period picker named the wrong TAX YEAR, the AL and Absence pickers the wrong person). Dispatch `input`, as `_setSelectPeriod` and `_setSelectValue` now do. **`select-sheet-parity.test.mjs` enforces all of it**, holds every native-by-decision exclusion with its reason, and carries the argument; DECISIONS.md has the history, including the one still open — the sign-in cascade. |
| **The OS draws nothing the app can draw (v23.50)** | The `<select>` rule above, generalised, after an audit (9 Sep 2026) counted what the platform was still drawing: **25 checkboxes and radios** (tinted by `accent-color`, otherwise the OS's box, tick and animation — five of them the pay-figure mode pickers), **47 `title` tooltips** (30 duplicating an `aria-label`; all invisible on touch, which is the primary platform), three textarea resize grips, and every scrollbar. Now: one checkbox/radio recipe in `shared.css` — a page may recolour through `--check-fill`/`--check-border` and may put the focus ring on an option ROW, and may not set a size or an `accent-color`; **tooltips are REMOVED, not rebuilt** — a hover-only surface is the wrong answer on a phone, so the redundant ones went, the informational ones already had visible text, and the three that explained a DISABLED state became a line in the row (`.sunday-note`, `.bp-mode-why`, the roster review's existing Sunday note); textareas grow with their content (`field-sizing`) instead of offering a grip; scrollbars are thin and trackless in both `shared.css` and `guide-shell.css`. `native-surface-parity.test.mjs` enforces all of it; the recipe's reasoning is its own header and `.claude/rules/css-tokens.md` → Checkboxes and radios. **Six more closed since** — the password field's OS buttons, autofill repainting `--field-bg`, `::selection`, `::placeholder`, `caret-color`, and `spellcheck="false"` at every `<body>`. Safari's strong-password button is LEFT: a feature, not a duplicate. Reasoning: the recipes' own headers. |
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
| "Recording for &lt;name&gt;" on the AL and Absence cards (v22.45) | `.card-member-for` at the TOP OF EACH CARD BODY, filled by `_syncMemberFor` in `admin-app.js` from the same sites that sync the two member displays. **Managers and admin only** — they are the only identities that can point these cards at somebody else, and for a self-service member the row would state the one fact they already know. Three things not to "tidy": it is **not** in the `.card-header-actions` cluster (the longest roster name is 23 characters, and beside the AL-left chip, the `?` and the chevron it either wraps the title or ellipsises to something that no longer identifies a person); it is **outside `#alBanner`** (the banner hides itself when the entitlement is unknown, and the state where a manager most needs the name must not be the state that removes it); and `.card-member-for[hidden] { display: none !important; }` is load-bearing, because `display: flex` out-specifies the `hidden` attribute — the `page-visibility-parity.test.mjs` trap, where the row draws empty and nothing throws. Both cards share ONE component on purpose: they ask the same question. |
| Type pills in admin — single source of truth (v13.48) | `PILL_TYPES` in `admin-shift-types.js` is the one authoritative list (declared there since the v21.39 split; `admin-overrides.js` re-exports it). `renderWeekGrid()` (admin-week-editor.js) generates per-row pills from it; `admin-app.js` generates the bulk-bar pills from it at init — **minus `other`**, deliberately (the Other flavours need per-row sub-controls a bulk bar cannot host; the rationale is beside the filter) (the `#bulkTypePills` div in `admin.html` is empty — populated at runtime). Order: AL · Shift · RDW · Absent · Rest Day · Other (v15.37; renamed from Training v15.40; **Spare moved OUT of the top row into the Other submenu v15.57** — a rarely-used placeholder, so 6 top pills now). Never hardcode either list. Other reveals per-row sub-controls (full-word flavour chips Training/Induction/Assessment/Team Day/Union/Meeting + **Spare** — + a pre-ticked-on-rest-day RDW tick + OPTIONAL times — `timesOptional: true`); the save collector composes the grammar `FLAVOUR[" RDW"][" HH:MM-HH:MM"]`. **Spare is special-cased:** it stays its own `spare_shift`/'SPARE' override type (📋 purple badge, not worked), so picking Spare in the submenu writes a `spare_shift` (not an 'other' day) and hides the RDW tick + times. |
| **`AL` pill label must stay as `AL`** | Compact mobile layout requires short labels. `AL` is the standard Chiltern abbreviation. Do not expand without discussing layout impact. |
| **`🪑` is the absence emoji — do not change** | Absence covers sickness, childcare, bereavement, and other reasons. Using 🤒 implies illness — GDPR concern. The reason for absence is never stored. **Always ask Gareth before changing the absence icon.** |
| `_staleMemberName` in `calendar-member.js` (the BANNER is in `calendar-app.js`) | When `getSelectedMemberIndex()` can't find a saved name, sets flag, falls back to default member. On the next page open the banner fires via `_showStaleMemberBanner()` — called from the pre-branch init block for team-view users (v14.08), or from inside `renderCalendar()` for calendar-view users. `takeStaleMemberName()` is one-shot so only one path fires. |
| Sync chip state machine in `calendar-app.js` | hidden → (800ms) → "↻ Updating…" → silent remove on success, or "⚠ Couldn't update" (stays, 10s timeout). "✓ Up to date" removed (v10.19) — noise. Never show raw errors to staff. |
| App Notices system (v13.36) | `nav-panel.js` owns the archive: `archiveNotice({ id, title, section, date, body })` writes to localStorage `myb_app_notices` (capped at 50 entries, deduped by `id`). "📣 App Notices" in `NAV_INFORMATION` opens the archive panel. Notice lightboxes live on individual pages; see **"One-time notice pattern"** section below for the full creation guide. Current notices are tracked in that section's table — do not duplicate the list here. |
| `_clearState` in `paycalc-app.js` / `CONDITIONAL_ROWS` in `paycalc-periods.js` | `_clearState` groups destructive-clear state atomically (includes `countdownTimer`). `CONDITIONAL_ROWS` is data-driven: condition → row/field IDs — add a new conditional row by adding one array entry. It lives in `paycalc-periods.js`, beside `updateBhRows` which iterates it; this row said `paycalc-app.js` until v21.34, which is where a reader following that instruction would have gone and not found it. See `.claude/rules/paycalc.md`. |
| `touch-only` CSS class in `shared.css` | `display:none` by default; revealed via `@media (pointer: coarse)`. Use for touch-only UI. Do not use inline `display:none`. `(hover: hover)` inverse was dropped (v10.15) — some Android devices misreport it. |
| `window.matchMedia('(pointer: coarse)')` in `initSwipeHint()` | Gesture-tutorial UI must only show on touch devices. Always add this guard. |
| **Do not gate layout on `(hover: hover) and (pointer: fine)` alone** | Some Android devices misreport `hover: hover`. For layout breakpoints, always use `min-width`. Hover/pointer queries are only safe for cosmetic `:hover` transitions. |
| Admin's week grid — one template, one left edge (v22.22) | The `.week-grid-header` and `.day-row` templates are declared in four blocks and must stay identical; `--wg-base-col`/`--wg-time-col` are what make that true, and the badge's own `min-width` reads the same token. An `auto` track in one of them resolves to that grid's own content and silently pulls the header off the column it labels. Every block on the card shares the content width — a control that should not stretch is capped ITSELF (`.week-date-wrap`), never by capping the row that positions it. Full reasoning: `.claude/rules/css-tokens.md`. |
| `paycalc.html` desktop grid on `<main>` | CSS grid applies to direct children only — declare on `main { display: grid }`. `.app` only holds max-width. |
| `lsGet` / `lsSet` / `lsDel` / `lsKeys` from `ls.js` | iOS Safari private mode throws `SecurityError` on any `localStorage` access. **Never call `localStorage` directly** in `calendar-app.js`, `admin-app.js`, or `paycalc-app.js` — always use these wrappers. `lsKeys()` (v14.11) returns a safe snapshot of all key names for code that must enumerate storage (e.g. the paycalc namespace migration). |
| Per-member paycalc localStorage namespacing (v14.11) | On a shared device two staff must not read each other's pay data — every per-member key carries a `myb_pc_<slug>_…` member segment (`pcPrefix()` in `paycalc-migrations.js` is the single source). **Never read/write a paycalc key without `pcPrefix()`/`SK`, and never namespace device-level flags** (`DEVICE_KEYS`). Legacy unnamespaced data is claimed via a one-time ownership prompt, never silently. Full detail: `.claude/rules/paycalc.md`. | **A retired device flag stays declared (v19.37):** `RETIRED_DEVICE_KEYS` in `paycalc-migrations.js` holds keys nothing writes any more but which still exist on devices — deleting one reclassifies it as member data and fires the ownership prompt at people with none (the v19.36 bug).
| VAPID fingerprint migration | Both pages store first 12 chars of VAPID key in `localStorage('myb_vapid_ver')`. On mismatch, silently unsubscribes → re-subscribes. Cloud Function `fanOutPush` deletes a subscription ONLY on 410/404 (genuinely dead); a 401 is a VAPID-auth failure (server misconfig, not a dead endpoint) and is logged, NOT deleted — deleting on 401 would wipe the whole collection on any VAPID key error (v16.15). |
| One-off notification prompt (`#notifPrompt`) | Appears once per device between `</nav>` and pay-period strip. Both Enable and × set `myb_notif_prompt_done`. Do not move below the calendar. |
| PWA shortcuts in `manifest.json` | Three long-press shortcuts. Changes require reinstall to take effect on existing installs. |
| **`manifest.json` `name` is SHORT, and that is the splash screen (v23.55)** | Chrome's pre-Android-12 splash draws `background_color`, the largest icon, and **`name` as text at the bottom** — in the DEVICE'S system font, because it is painted before any web content exists, so Inter can never reach it. Android 12+ uses the platform SplashScreen API instead, which shows the icon alone and no label, which is why this is invisible on a newer phone. `name` was "Marylebone Roster — Chiltern Railways": 37 characters drawn small, and carrying an **em dash** an OEM font may not have, so Android fell back mid-string — reported as "a strange font". It is now "Marylebone Roster", matching `#splash-title` in `index.html`, which the member sees a beat later. **Keep it short and keep it ASCII**; `short_name` is the launcher label and does not reach the splash. Like the shortcuts above, it reaches an existing install only on REINSTALL (the WebAPK is regenerated). |
| Paycalc desktop workspace + sticky bar (`#stickyTotal`) | ≥1024px: three-column grid whose workspace is ONE shared row (v18.47) — `.pc-work` (period band + Hours + Settings) spans the two work columns beside the col-3 sidebar `.pc-side` (result + the year-so-far card + the four occasional cards, v16.67, owner-approved; the year card joined at v22.08 — see paycalc-year-card.js). One row means neither column's height can inflate the other's spacing (the old row-span model let an all-expanded sidebar open a mid-page navy void). The result is **not sticky**; the `#stickyTotal` fixed bottom bar keeps the take-home £ visible on all widths. Full layout rules (mobile `display:contents`, margin-reset specificity note): `.claude/rules/paycalc.md`. |
| 3-digit time input auto-correction in `admin-overrides.js` | On blur, if length is 3 and `parseInt(raw.slice(0,2)) > 23`, prepend `'0'`. Without this, `"630"` produced `"63:0"`. |
| Range picker clear button (`.rp-clear`) | Resets both `from` and `to` dates. Built into `buildRangePicker()` in `admin-rangepicker.js`. |
| **Sundays are non-contracted — AL and Absent cannot be recorded on Sundays** | Sundays are uncontracted for all grades. The forbidden write types are declared ONCE, as `SUNDAY_FORBIDDEN_TYPES` in `override-utils.js` — `annual_leave`, `sick`, `other` and plain `shift` (a worked Sunday is `rdw`, deliberately absent). **Do not restate the list in prose or in a new call site**; consult it, or be pinned to it by `override-utils.test.mjs`. **SIX enforcement layers, none removable alone** — they are numbered in the code comments, so APPEND rather than renumber: (1) week-grid disables the AL/Absent pills on Sunday rows and the Shift pill too; (2) bulk-apply silently skips Sunday rows; (3) `recordRangeOverrides` filters Sundays out of `workingDates`; (4) roster upload normalises a Sunday `AL`/`SICK` to `RD`; (5) display — the calendar and month legend suppress a `sick` override on a Sunday, so legacy data never renders; (6) the single-row save in `admin-app.js`, which answers for all four types with three different outcomes (`shift` → promoted to `rdw`; `other` → refused unless Spare; `annual_leave`/`sick` → refused) and so cannot loop over the list — pinned to it by a test instead. A worked Sunday time is always RDW, never AL/Absent. |
| Sunday RD corrections on absence/AL save | Every Sunday in the range is checked; if `getBaseShift` returns a non-RD shift, an explicit `correction/RD` override is written alongside the AL/sick overrides. Used in both save handlers. |
| Range picker swipe — pointer capture on `grid` not `clip` | Events dispatched to a capture target do not bubble down to children — captures on `clip` breaks the drag animation. |
| Team Week View | Available to all logged-in staff; grade state (`currentTeamGrade`) persists across re-renders, week nav clamped to `CONFIG.MIN_YEAR`/`MAX_YEAR`. **Overrides come from the SHARED month fetch** (`ensureOverridesCached`, injected — v18.76), never a fetcher of its own: a second authoritative reconciler racing the first evicted overrides the 3-month fetch had just loaded, blanking the grid back to base roster. That is `CALENDAR_DATA.md` invariant 6, and the narrative behind it is in `calendar-overrides.js`. **No override-load status indicator** — proposed by review and accepted as won't-do: a failed month releases from `fetchedMonths` (retryable) and leaves the last-good cache untouched, so a failed refresh keeps the last-good grid silently, which is the minimal-noise behaviour this app wants. |
| **Calendar access: a named session OR the staff PIN (v20.12)** | `overrides` reads require a member `name` claim or the shared `calendarViewer` capability. **Sign-in card first, PIN one tap behind** — an order, not a grant. **Anonymous grants nothing**, which is the substance: the Calendar used to sign every visitor in anonymously, so `request.auth != null` would re-admit exactly the people it closes out — ask for a CLAIM, never a session. And the PIN is a low-friction STAFF BARRIER, not individual authentication — one code for the whole station, unattributable, unrevocable per person — so **no surface may describe it as more**. **The invariants are NOT restated here**, because two contracts were written to own them and both say other documents must link rather than repeat: `CALENDAR_DATA.md` 3/4/11/12/13 (refuse the cached read at source · a re-grant is not the first grant · a member is never sent to the PIN · a provisional paint is not access) and `AUTH_AND_SESSIONS.md` 7–10 and 14 (the viewer holds no identity claims · session-only persistence · anonymous grants nothing · the PIN is never compared on the client). **CLOSED 26 Aug 2026 — the PIN is the real boundary now.** `CALENDAR_PIN_ACCESS: false` is therefore **no longer a rollback**; reverting the rules push is. **One owner-decided exception since v22.97, the PROVISIONAL PAINT: `decideProvisionalAccess`.** Design: AI_MAP → `calendar-access.js`; rollout, rollback, the caching caveat and the standing GCP IAM prerequisite: RECOVERY_RUNBOOK.md → "The Calendar PIN"; operations: OPERATIONS_REFERENCE.md. |
| `persistentLocalCache()` in `firebase-client.js` | Firestore stores queries in IndexedDB. Do not revert to `getFirestore()` — Huddle viewer and override cache depend on instant load. |
| `subscribeToLatestHuddle` in `firebase-client.js` | Persistent `onSnapshot` — Huddle viewer updates automatically when a new Huddle arrives. Do not replace with one-time fetch. |
| `normaliseSurname()` in `auth-identity.js` (v12.04; moved out of `firebase-client.js` v16.50) | Shared surname derivation for Firebase Auth: lowercases and strips non-alpha (the ≥6-char padding for the Firebase *password* is applied separately by the password builders in `session.js` / `functions`, **not** inside `normaliseSurname`). Lives in the pure `auth-identity.js` (so it's unit-testable) and is **re-exported by `firebase-client.js`**; `getSurname()` in `session.js` delegates to it. A deliberate duplicate also exists in `functions/roster-parse-helpers.js` — Cloud Functions are CommonJS and cannot import browser ES modules, so unification requires a build step. If the rule ever changes, update both locations (surname-parity.test.mjs enforces it). |
| `cors: ADMIN_FUNCTION_ORIGINS` on `parseRosterPDF`, `setupRosterAuth`, and `resetMemberPassword` | All three functions restrict CORS to an explicit origin allowlist (`ADMIN_FUNCTION_ORIGINS` in `functions/index.js`: `garethdavidmiller.github.io`, `myb-roster.web.app`, `myb-roster.firebaseapp.com`) — defence-in-depth on top of the real control, which is Firebase ID token + admin claim. Add any new hosting domain to that array. `ingestHuddle` keeps `cors: false` (server-to-server). |
| Only the TOPMOST overlay reacts to the keyboard (v19.53) | Every open overlay attaches its own `document` keydown listener, so ONE Escape used to close them ALL — and `trapFocus` on a buried overlay pulled Tab into a dialog the user couldn't see. `createLightbox`'s `onKey` now returns unless `_isTopOverlay(close)` (reads the existing `_backHandlers` stack; **fails open**, because a suppressed Escape traps the user). Back and ✕ were always correct. **A one-time notice must open via `openNoticeIfClear(lightbox)`, never `lightbox.open()`** — with two notices up, one Escape ran both `onClose` callbacks, so the buried one was archived and flagged permanently seen by someone who never saw it. Not opening leaves it unflagged, so it returns next load. The rule is unit-tested; the WIRING needs the e2e (deleting the `onKey` guard leaves every unit test green). |
| Android Back button overlay pattern | Overlays push `history.pushState({ mybOverlay: true })` when opening, close on `popstate`. `_pushOverlayState(handler)` / `_clearOverlayHistory()` helpers in all seven app pages. |
| Canonical lightbox lifecycle (standardised v11.50, factored into `createLightbox` v12.50) | Every `.lb-overlay` lightbox (About, AL, Team info, Month jump, per-card Tips, paycalc Help/Welcome, links Beta) is built with **`createLightbox({ overlay, content, closeBtn, initialFocus, onOpen, onClose })` in `overlay.js`** — do NOT hand-write the lifecycle in a page module. It implements focus save/restore, `.visible`→`.open`, `lockBodyScroll`, Android Back (`_pushOverlayState`), Escape, the `trapFocus` Tab trap, and backdrop/closeBtn close — including a **mandatory 500ms `transitionend` fallback** (iOS suppresses `transitionend` on a backgrounded tab; reduced-motion finishes synchronously). Close controls are `<button class="lb-close">` (never `<span>` — not keyboard-focusable). The shared About/Tips panels are `about-lightbox.js` / `tips-lightbox.js`. **Exceptions:** the drawer's two lightboxes — coming-soon and **App Notices** — are owned **only** by `nav-panel.js` (they share the drawer's history entry, which is why they hand-roll it; never re-wire `#navComingSoonLightbox` or `#navNoticesLightbox`, or migrate either to `createLightbox`). This named only the first for years, so the second read as drift rather than as the same decision; both are injected at runtime, so `overlay-parity.test.mjs`'s served-HTML scan does not see them, and its close-control contract does; the huddle viewer (`#huddleViewer`) is a full-bleed panel, so it has no overlay-click-to-close (intentional). Full lifecycle detail: AI_MAP → `overlay.js`. |
| Nav panel on all 7 pages (v10.57; **restructured v20.06**, Reference reopened v20.09) | `nav-panel.js` injects overlay + drawer; burger `#navMenuBtn` in each page header. **THREE ZONES, ONE IDIOM EACH:** pills = go to a page · Latest = the documents you open on a shift · Reference = look something up. (The heading says **Latest**, not Today, since v22.23: the idiom is right and the reader does not have it — only one of the three documents is today's, the others being weekly and monthly.) `NAV_PAGES` drives the pill row, `NAV_INFORMATION` the flat Workplace section, `NAV_GUIDES` the Reference submenu (`#navGuidesToggle` / `#navGuidesList`). Four rules that have each been broken once: the **current page renders as an inert `aria-current` pill, NOT omitted** (this row said "omitted" for ten versions while the code did the opposite); **Settings is a pill**, not a pinned link; **pills are one per row**, which is arithmetic and not taste; and **`aria-expanded` is the ONLY state** for the Reference fold — there is no `.open` class, and re-adding one re-creates the v20.09 stuck-arrow bug. **The measurements and the argument behind all four now live in `nav-panel.js`'s header** (moved there v21.63; this row was 3,379 chars — twice the cap the file tree enforces on itself — and most of it was a design retrospective). Adding a guide = one `NAV_GUIDES` entry; adding a live doc = one `links` entry in `NAV_INFORMATION`; `comingSoon: true` renders a `<button>` opening `#navComingSoonLightbox`. |
| Dark (navy) drawer + scoped tokens (v11.54) | Continuous navy surface. Scoped tokens: `--nav-raised/strong`, `--nav-text/muted/faint`, `--nav-border`. Admin pill = `--nav-raised` + gold text (not navy-fill). Do not revert to white drawer. See `.claude/rules/css-tokens.md`. |
| Nav-panel logo = About; drawer head shows version (v11.21) | The drawer head is a `#navPanelBrand` button (logo + title + `Version {APP_VERSION}` muted text). Tapping it closes the panel (via `closePanelForNavigation`) then calls `onLogoClick`, which each page passes as `() => openAboutLightbox?.()` — opening that page's existing `#iconLightbox` (version, update status, bug report, and page-specific print/guide links). Each page exposes its scoped open fn through a module-level `let openAboutLightbox` assigned inside its About-lightbox IIFE. This replaces the header logo's old role (see header-logo back button entry). |
| Settings page — shared session, flat nav link (v11.06) | `settings.html` uses the same `AUTH_KEY` as `admin-app.js` — a user already signed in on any page arrives without seeing the login overlay. **The nav is wired by `wireNavPanel()`, NOT at module scope, and deliberately NOT for a signed-out visitor** while `CONFIG.INPLACE_LOGIN.settings` is on: it is deferred to `initAuthorised()` so the drawer renders ONCE, with the signed-in identity, and the full-screen login overlay covers the burger meanwhile. Operations and Links do the same. This row said the opposite until v23.41 — "called at module scope … regardless of sign-in state so unsigned users can navigate away" — which is the direction of error that gets a deliberate fix undone: a reader restoring it would re-create the two-identity double render. **A signed-out visitor is not stranded**; the login overlay carries its own "← Back to roster" (`login-overlay.js`), which is the escape route now. Overtime is the one page that still wires the drawer while signed out, on purpose — its own comment says why. Settings link renders outside the scrollable `nav-panel-body` (pinned above footer) so it is always visible without scrolling. Hidden only on the settings page itself. Styled as a flat link (not a pill). `--indigo` badge colour. |
| Nav-panel footer initials badge (v12.22) | The footer shows a 26px circular badge (`#navPanelAvatar`) before the member name — previously showed a profile photo, now always shows initials on a stable per-name colour. `avatarInitials(name)` and `avatarHue(name)` from `roster-data.js` are called directly in `nav-panel.js` — no fetch, no localStorage, no event listeners. Profile photo feature removed at v12.22; full spec and revert checklist in ROADMAP_HISTORY.md → "Removed features — full restoration specs". |
| Operations page — admin-only pill (v10.99) | `NAV_PAGES` entry for Operations has `adminOnly: true`. `initNavPanel({ isAdmin })` filters it out for non-admins. `calendar-app.js`, `admin-app.js`, and `paycalc-app.js` pass `isAdmin: CONFIG.ADMIN_NAMES.includes(member)`. `operations-app.js` passes `isAdmin: true` (page already guards against non-admins). When NOT signed in, Operations shows the **shared in-place login** (`login-overlay.js`, v14.45+) — it no longer redirects to `admin.html` to authenticate. A signed-in **non-admin** is still redirected to `admin.html` (that is access control, not a login divert). |
| Overtime page — the two audiences (v20.76) | Reviewing and PARTICIPATING are different things that reach the same page, and the distinction is a safety property: a reviewer sees everybody's declarations, a beta participant answers only for themselves. **Reviewing** = the `admin`/`manager` claim (`isOvertimeReviewer`). **Participating** = a name in `CONFIG.OVERTIME_BETA` (`roster-data.js`) — **and run `npm run generate:roster-members` in the same commit**, because `selectParticipants` reads the server-owned copy, so an un-regenerated list gives somebody a page with no form on it. The nav pill and the page policy both gate on `canOpenOvertime` (either audience); `NAV_PAGES` uses `overtimeAudienceOnly`, and all seven coordinators must pass `canOpenOvertime` (page-contract-parity enforces it). **Never widen `isOvertimeReviewer` to make the pill work** — that hands a beta tester everybody else's availability. At full launch both lists drop away and participation alone decides. |
| Links page — access control (v12.06) | `linksDesignerOnly: true` in `NAV_PAGES`. Add name to `CONFIG.LINKS_DESIGNERS` in `roster-data.js` to grant access — **and run `npm run generate:roster-members` in the same commit**, because the `linksDesigner` claim is set by `setupRosterAuth` from the server-owned `functions/roster-members.json`, not from the client list. Then run Operations → Set up accounts, or the new designer holds no claim and every save permission-denies. Current designers: `’G. Miller’`, `’S. Silva’`, `’M. Robson’`. |
| Links page — beta marker REMOVED (v19.50) | The gold-OUTLINE `.beta-chip` and its `beta-sheen` keyframes are gone (owner decision, Aug 2026 — the workspace is the tool the Dec 2026 proposals are built in, not a sketch to be announced). The first-visit notice was rewritten at v19.51 (`#linksWelcomeLb`, 14-day window, new `myb_links_welcome_seen` key) — the beta paragraph went, the useful one stayed. See `.claude/rules/links-design.md`. |
| Links page — design and save model (v12.09–v12.47) | Multi-design Firestore collection `linkDesigns` `{ name, patterns, updatedAt, updatedBy }`. Full rotation of `ROTATING_LINES` lines (**24 since v20.01**; 22 at v19.98, was 28) — every line must carry a real pattern; never restate the number, `links-rotation-parity.test.mjs` fails on a literal. CEAs do not work nights. Auto-generator is the only way to create a new design; it is NAMED on its first save (v23.30 — the masthead, `links-design-header.js`). Grid clicks delegated on `#linksGridBodyRows`. Position keys always `String`. Delete is a SOFT delete since v19.41 (a bin with no automatic expiry — v19.86/v19.96). See `.claude/rules/links-design.md` for full grid/paint/generator/coverage/checks/fatigue/concurrency/deletion/print detail — its `paths:` globs, so it loads whenever any `links-*.js` is edited. |
| Links page — fatigue factors are ADVISORY, never pass/fail (v19.46) | The Design checks card's second half reports which of the ORR's p3 factors are **present** in a design (`links-fatigue.js`). The ORR states these are not prescriptive limits, so **nothing here may render as red/green or read as a certificate** — a design showing few findings and being read as approved is the failure this feature must not cause. Three consequences that are easy to undo by accident: **never hardcode a status** (FF13's was, and put a green tick beneath the amber finding it duplicates); **NOT-APPLICABLE, CLEAR and STANDING are three different answers**, not synonyms for "fine"; and every rule must **lap the rotation**, since a person on line 28 goes to line 1 next week. Full rules + the four v19.48 regressions: `.claude/rules/links-design.md` → Fatigue factors. Project context: `LINKS_DEC2026_PLAN.md`. |
| Header back button removed (v10.63) | `admin.html` / `paycalc.html` no longer have a header `←` back button — it duplicated the nav drawer's Calendar pill (two competing nav paradigms) and clashed visually with the logo box. Navigation back to the roster is via the drawer. Header is now `[☰] [logo] Title … [badge]`. The admin "open calendar on the month I was editing" behaviour moved from the back button onto the `.nav-panel-pill--calendar` click in `admin-app.js`. `.btn-back` CSS removed from `shared.css` (still defined locally in `fip-guide.html` / `railcard-guide.html`). |
| Header logo = back to calendar on sub-pages (v11.21) | On `admin.html` / `paycalc.html` / `operations.html` / `settings.html` the header logo `#appIcon` now navigates to `./` (the app root — `./index.html` 301s on Firebase Hosting, a wasted round trip per tap; changed v16.09) (`title`/`aria-label` = "Back to calendar"). This restores an iOS-friendly back affordance (iOS standalone PWA has no system back) without re-adding a visible back button — kept "invisible" as just the logo. The About lightbox it used to open moved to the **nav-panel drawer logo** (see that entry). The **calendar page keeps its header logo opening About** (`.title-icon` in `calendar-app.js`) — home has no "back" target. Do not wire the calendar header logo to navigate. |
| `.app-header` brand centering (v10.66) | `admin.html` / `paycalc.html` headers use `display:grid; grid-template-columns:1fr auto 1fr`. Burger sits in col 1 (`justify-self:start`), logo+title in an `.app-header-brand` flex wrapper in col 2 (auto, truly centred), badge in col 3 (`justify-self:end`). Equal `1fr` side columns guarantee the brand is always centred regardless of burger/badge width asymmetry. The calendar uses a different `.header` (balanced spacers), unaffected. |
| Sign-out in nav panel footer (v10.59) | Sign-out button moved from page headers to the nav panel footer. `initNavPanel({ onSignOut: fn })` — each page passes its own sign-out callback. Footer (member name + Sign out button) renders only when `onSignOut` is supplied. `.btn-signout` CSS removed from `shared.css`. |
| Notification bell in nav panel footer (v10.61) | `notif.js` is the shared Web Push module; `nav-panel.js` imports it and renders a 🔔/🔕 toggle in the footer (signed-in only, hidden when `notifSupported()` is false — incl. iOS non-standalone). Bell refreshes on every panel open; tap keeps the panel open. States: `on`/`off-default`/`off-lapsed`/`denied`/`unsupported`. `calendar-app.js` and `huddle.js` also import `notif.js` — VAPID key and subscribe/unsubscribe logic live in one place (v10.79). The `#notifPrompt` calendar strip stays on the calendar; the Notifications card lives on settings.html (moved v11.06). **The bell is a COMPACT icon next to Sign out (`.nav-panel-bell`)** — a labelled full-width "Notifications — On/Off" row has been tried and reverted TWICE (v13.14→v13.19, v16.56→v16.75; owner decision: the settings.html Notifications card is the canonical surface, the drawer bell is just a quick toggle). Don't re-promote it without a fresh discussion. |
| Guide pages back button → index.html (v10.57) | `railcard-guide.html` and `fip-guide.html` back buttons now link to `./index.html` (not `./admin.html`) — guides are accessed from the nav panel, not the admin page. |
| Maskable icons | 512px entry uses `"purpose": "any maskable"` for Android adaptive shapes. Smaller icons omit this. |
| **Chiltern payroll rules** | Rostered Sat → `sat` (1.25×); Sat-on-RD → `rdw`. Sunday-on-BH: Sunday wins (1.5×) — `dow===0` before `isBH`. BH + `rdw` is additive (`bhOt` + `bh`). Confirmed May 2026; tests assert. See `.claude/rules/paycalc.md` for full detail. |
| `initALSection()` / `initSickSection()` in `admin-app.js` | `alMember`, `sickMember`, `syncMemberDisplay`, `syncSickMemberDisplay` are hoisted to module scope above the `fieldMember` change handler — that handler fires before init. Do not move them inside the init functions. |
| SW synthesised offline page uses status 200 | Some browsers suppress 5xx response bodies. `Cache-Control: no-store` prevents caching the synthesised page. |
| SW offline fallback only for navigation requests (v10.15) | Only `event.request.destination === 'document'` requests get the offline HTML page. JS/CSS get `Response.error()`. Without this, `/admin-app.js` matched `'admin'` in the fallback logic and got HTML for a JS request — MIME-type error. Fallback routing chain (v11.87): `paycalc` → `paycalc.html` · `operations` → `operations.html` · `settings` → `settings.html` · `admin` → `admin.html` · otherwise → `index.html`. |
| Huddle notification → `#huddle` hash pattern | SW navigates to `#huddle`; `calendar-app.js` `hashchange` handler triggers the viewer (`_autoOpen` is `let` so it can reset). **Two viewer paths — do not unify, do not revert notification path to direct `window.open`/`location.href`:** `htmlContent` present (DOCX converted server-side) → renders inline in both paths. No `htmlContent` (PDF or failed conversion) → the viewer shows an in-overlay "📄 Open Huddle" button (`#huddleOpenFileBtn`); its click is a real gesture (a direct `window.open`/`location.href` on a hash-open would be pop-up-blocked or knock the PWA out of standalone). The viewer is opened **only** via the `#huddle` hash — from both the nav-panel "Daily Huddle" link and notification taps (the old `#huddleBtn` was removed at v12.57). **The three documents are behind the PIN or a password (owner decision, 7 Sep 2026; client v23.17, rules v23.18).** The viewers and the drawer's document links consult `calendar-doc-access.js`, which `calendar-app.js` opens on the full access grant — so a locked visitor's tap is answered with what to do, no read is issued (the local cache would answer one), and a notification tap that landed on the PIN card is finished the moment the PIN is entered. Full rationale: **OPERATIONS_REFERENCE.md → "Huddle notification tap behaviour"**. |
| `isBeforeMemberStart(member, date)` in `override-utils.js` (v10.16) | Returns true if `date` is before the member's `startDate`. Always use this helper — never inline the date comparison. |
| **A calendar day opens the day panel — on EVERY pointer type (v23.59)** | Owner request: *"I want the day detail lightboxes like mobile on desktop."* The click handler in `calendar-renderer.js` has **no pointer branch** and must not regain one — the comment on that handler says what went and why. **The pay jump is not lost, it is one click deeper**, on the panel's own `#dayDetailPayBtn`, which `personalActionsAllowed` already gates. **Three things that go with it and are easy to undo:** the hover tooltip STAYS as the preview, and `body.lb-open #calTooltip` takes it down — belt and braces, since a `mouseover` on the appearing overlay already does (measured by deleting the rule on both engines), and e2e/calendar.spec.js pins the behaviour rather than the mechanism; `.calendar-day:not(.other-month)` gets `cursor: pointer` on a fine pointer, because a cell that acts like a button has to look like one; and **the KEYBOARD is deliberately unchanged** — Enter still jumps from a pay cell and falls through to the panel when refused (v23.07), that being the one route with neither a hover nor a visible button. A mouse DRAG needed no guard, and that was measured rather than assumed — `e2e/calendar.spec.js` holds the reading and the platform assumption it rests on. |
| `navigateToPaycalc(paydayStr)` in `calendar-app.js` (v10.17) | The one route from a payday or cut-off cell to the calculator, carrying `?payday=`. Always call this helper — never duplicate the navigation logic. **It does NOT check the session** and has not since v14.45: paycalc runs its own in-place sign-in and the query survives the post-login reload, so a bounce through admin would only lose the date. This row said "session-check-then-navigate" until v22.93, which is the opposite of what the function does and would have had the next reader add a guard back. The day panel's other action, `#dayDetailLeaveBtn` to Admin, is the same shape for the same reason. |
| SW `new Request(url)` fetch pattern (v10.16) | `new Request(event.request.url, { cache: 'no-store', ... })` instead of passing opts to an existing Request. Passing opts alongside a Request doesn't reliably override cache mode on older Safari/Chromium. |
| `initErrorReporter()` call pattern (v13.78) | Writes to Firestore `clientErrors`, so a valid auth token is required. Three canonical call sites: (1) **`calendar-app.js`** — wait for auth persistence, run `reconcileExpiredIdentity()` (item 7 — sign out a lingering expired named identity), then sign in anonymously only if no named user remains: `authReady.then(()=>reconcileExpiredIdentity()).then(()=>auth.currentUser?null:signInAnonymously(auth).catch(()=>{})).catch(()=>{}).finally(()=>initErrorReporter())` — this preserves a valid named identity instead of racing with or replacing it; (2) **Authenticated pages with `sessionReady`** (`admin-app.js`, `settings-app.js`, `operations-app.js`, `links-app.js`) — call `sessionReady.then(()=>initErrorReporter())`; (3) **`paycalc-app.js`** (no `sessionReady`) — call `ensureNamedSession(name).catch(()=>{}).finally(afterAuth)`, where the `afterAuth` callback runs `initErrorReporter()` (alongside `recordUsage`/`recordPageLatency`); the `else` branch (no member) calls `afterAuth()` directly. Never call `initErrorReporter()` bare without an auth context — writes will be silently rejected by Firestore rules. |

---

## One-time notice pattern

Full HTML template, JS patterns (close-only and CTA+snooze), rules table, and monthly cleanup instructions are in `.claude/skills/new-notice/` — invoke `/new-notice` when adding a notice.

**Current notices** (keep this table current — monthly cleanup removes entries older than 180 days):

> **Every notice declares an AUDIENCE** (v21.81, third value v21.84) — `'members'` (a signed-in
> member; the default, and where anything about pay, settings or an account belongs), `'signed-out'`
> (only where nobody is signed in on this device — a PIN unlock; for a notice about signing in, which
> then retires ITSELF the moment they do, since the audience is re-checked every load), or
> `'everyone'` (both; rarely right). The rule is `noticeAudienceAllows` in `calendar-access-core.js`;
> a refused notice is left unflagged, so it arrives when that device's position changes. Below,
> every live notice is `'members'`: `sign-in-2026` was the only `'signed-out'` one and was retired at
> v23.23, so **the positive direction of the gate has nothing exercising it** until the next such
> notice — `.claude/skills/new-notice/` names the two tests that come back with it.

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
| `ytd_2627` | `paycalc.html` | Enter your Year to Date figures | 💷 Pay | **RE-POSTED 28 Aug 2026** (first run 6 Apr) | 90 days | ✅ live until ~26 Nov 2026 — a ONE-OFF restart on a NEW key (`myb_pc_ytd_notice_2_shown`; run 1's key is retired, not deleted). Re-dating alone would have reached nobody: the expiry branch flags a device silently, so everyone who arrived after ~5 Jul was already marked "shown" for a notice they never saw. **It opens LAST on the page** — behind the data-ownership prompt and the forced set-password overlay. **When this run lapses, decide rather than re-date**: a seasonal prompt wants to key off whether the member has entered YTD figures for the current tax year, which is not the one-time notice pattern | One-time; `NOTICE_YTD_KEY` set on close |
| `links-workspace-2026` | `links.html` | Links Workspace | 🔗 Links | 2 Aug 2026 | **none — the expiry was REMOVED at v22.59** | ✅ **converted to permanent ORIENTATION** (external review). The v21.50 sweep called expiring "right for this one" on the reading that it welcomed a designer to a workspace they had been using for a fortnight — true of the welcome, and false of what the panel actually holds: nothing here touches the live roster, the fatigue checks report rather than approve, and designs are shared. Those are the facts a FIRST-TIME designer needs, and from 16 Aug a first-time designer was flagged seen and shown nothing. The announcement half stays archived exactly once; the orientation half never expires and `#linksHowBtn` reopens it — a ROW IN THE ABOUT PANEL since v22.83, beside 🔧 Operations and 🐛 Report a bug, because that is where this app already keeps a page's own links. It was a control of its own on the page for three releases (`.header-end`, above the header, below the header) and read as foreign in all three; the lesson was that no other page has a standalone help control, not that this one was styled wrongly. **Not a candidate for the 180-day removal** — it is no longer a notice | One-time on first visit; `myb_links_welcome_seen` set on close. The button ignores the flag |
| `al-booking-2026` | `index.html` | Book your remaining 2026 leave | 📅 Calendar | 8 Sep 2026 | 90 days (~7 Dec 2026) | ✅ live — audience `'members'`. **A ONE-OFF since v23.60** (owner decision, 10 Sep 2026): it shipped on the actionable pattern — a 7-day snooze on any dismissal, 1 day on the CTA, repeating until expiry — and the owner ruled it a heads-up, not a nag. Every dismissal (×, backdrop, Escape, "Not now", the CTA to Admin's Annual Leave card) now sets the done key; a snooze already on a device is promoted to done on the next open rather than re-shown. The leave-year reasoning for repeating is recorded in the module header beside the rule that replaced it | One-time; `myb_notice_al_booking_2026_done` set on any dismissal (the old `_snooze` key is read only to promote it) |

The retired `links-beta-2026` (posted 9 Jun 2026, 28 days) was replaced at v19.51: the beta chip
went at v19.50, so its lead paragraph described a page that no longer existed. Only the paragraph
that was still true survived, joined by the fatigue-checks framing and the shared-designs/bin note
(which said 30 days until v19.86). It took a **new storage key** (`myb_links_welcome_seen`) — reusing the old one would have
meant every current designer, all of whom closed the beta notice months ago, never saw the
replacement.

The retired `sign-in-2026` (posted 27 Aug 2026, `'signed-out'`) was deleted at **v23.23 by owner
decision, seven weeks before its 90-day expiry** — the one notice here retired for being WRONG
rather than old, and the reason is worth keeping because it is a shape that recurs. v23.19 made the
Calendar's front door a sign-in card; from that release its entire audience — somebody reading the
roster on the staff PIN — had already been shown that card and had chosen the PIN, so the notice
spent its life re-offering a choice the reader declined a moment earlier. Two of its three claims
had also moved house: the PIN card itself now states the code lasts only while the browser stays
open, and its CTA pointed at Settings for a sign-in that is on the page underneath it. **The general
rule: when a notice's ask becomes a control on the same screen, the notice is arguing with the app.**
Its two guards did not survive it — no live notice declares `'signed-out'`, and it was the only one
the accessibility suite scanned (that scan moved to `backpay-2026`, and at v23.31 to `al-booking-2026` when back pay was deleted past its cutoff). Both are recorded in
`.claude/skills/new-notice/` for whoever adds the next one.

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
| `'TRG'` / `'IND'` / `'ASSESS'` / `'TEAM'` / `'UNION'` / `'MEET'` (+ optional `' RDW'`, `' HH:MM-HH:MM'`) | 🏷️ Train / Ind / Assess / Team / Union / Meet | The **"Other" family** (v15.35; evolved v15.40, Team Day v15.51, Union v18.56, Meeting v18.61, OTHER_DAYS.md): Training / Induction / Assessment / Team Day / Union course / Meeting. `'TEAM'` appears on the roster as the multi-word label "Team Day", `'UNION'` as "Union course", and `'MEET'` as the code "MTG" (also "MEETING"); the parser collapses each to its sentinel. LEAF-GREEN `other-day` family (`--other`, hue 136° — deliberately NOT bronze, which was hue-identical to Early's orange); hours slot shows actual times → `RDW` → base time — **except Meeting/Union (`hideBaseTime` in `OTHER_FLAVOURS`), which show the badge with NO time** unless a time is actually entered (they're attend-an-event days, not tied to a rostered shift; Training/Induction/Assessment/Team keep the base time as they run during your shift); tap shows the FULL word; pays as the day underneath (`resolveOtherPay` in `override-utils.js` — flavour-agnostic, unaffected by `hideBaseTime`); Sundays and Boxing Day (26 Dec) can never be training/Other days (confirmed by Gareth Jul 2026). The unknown-value fallback classes were renamed `unknown-day`/`badge-unknown` (v15.40) to free the `other-*` names |

**Classification:** Early 04:00–10:59 · Late 11:00–20:59 · Night 21:00–03:59

**isWorkedDay:** false for RD, OFF, SPARE, AL, SICK. True for everything else including RDW.

---

## Roster data structure

### teamMembers fields

> **⚠️ This file is WORLD-READABLE.** `roster-data.js` is served from both origins with no session,
> no PIN and no token — every name on the roster, each one's pattern and cycle position, and whatever
> optional fields the entries below carry: join dates, a joining year's pro-rated leave, scheduled
> roster moves, and (since v22.99) which two people hold a BILINGUAL CONTRACT, which is a fact about
> their terms rather than their rota. **The exposure is stated as KINDS, not counts** — this sentence
> said "nine leave entitlements" against four, because a tally taken on one afternoon describes the
> file for about as long as nobody edits it, and the roster is edited constantly. That the base
> roster is public is a deliberate classification (owner, 4 Sep 2026 — shift patterns are on the
> station's own printed rosters), and
> the reasoning is `AUTH_PLAN.md` §2. **A field added below is published the moment it ships**, so
> anything a stranger should not read belongs in Firestore behind a claim — as `staffContact` (the
> work email) already does. `public-data-classification.test.mjs` fails on an unclassified field.


```javascript
{
  name: 'G. Miller',       // MUST match Firestore memberName exactly
  currentWeek: 3,
  rosterType: 'main',      // 'main' | 'bilingual' | 'fixed' | 'ces' | 'dispatcher'
  role: 'CEA',             // 'CEA' | 'CES' | 'Dispatcher' | 'Management'
  hidden: false,           // Optional — hides from dropdown
  managerOnly: false,      // Optional — login-only manager/clerk account (Management group); hidden from the calendar member selector, has no roster of its own
  permanentShift: 'early', // Optional — forces early/late badge on all worked days
  bilingualContract: true, // Optional — this CEA holds a BILINGUAL CONTRACT: 34 days' leave, not 32.
                           // The CONTRACT, not the line. A plain CEA is routinely placed on a bilingual
                           // line until a CEA one frees up, so `rosterType` cannot stand in for this.
  startDate: new Date(2026, 3, 20), // Optional — midnight local time: new Date(year, month-1, day)
  noProRate: true,                  // Optional — set for secondment returns: startDate suppresses pre-return shifts but pay and AL are full-year (no pro-rating in paycalc; joiner banner hidden)
  proRatedAL: { 2026: 23 }, // Optional — the joining year's entitlement (a Dispatcher's lieu days are still added)
  rosterChanges: [{ from: new Date(2026, 6, 1), rosterType: 'ces', currentWeek: 4 }] // Optional — scheduled roster moves
}
```

**`rosterChanges` (v12.31)** — date-driven roster transitions for a member who changes rosterType/link mid-life (e.g. a new starter on a temporary `fixed` pattern who later joins a rotating link). Each entry is `{ from: Date, rosterType, currentWeek }`; from `from` (midnight, **inclusive**) onward the member follows that rosterType/currentWeek instead of the base fields. Array must be **sorted ascending by `from`** — the latest entry whose `from` ≤ date wins. Resolved by `resolveMemberRoster(member, date)` in `roster-data.js`; `getBaseShift` and `getWeekNumberForDate` apply it automatically, so **no call site needs special handling**. The base `rosterType`/`currentWeek` describe the member *before* the first change. `startDate` (join-date RD suppression) is independent and still applies.

**AL entitlement** (`getALEntitlement` in `roster-data.js`) — `proRatedAL[year]` takes priority before the role check for every role **except Dispatcher**, where it scales the BASE only and the lieu days are still added on top (v22.50, owner decision): the 22 is an allowance a part-year deserves part of, a lieu day is owed because a specific day was worked. It used to return outright, so a mid-year Dispatcher's joining year skipped the lieu count and read two days short with nothing to say so:

| Role / type | Days |
|-------------|------|
| CEA on a **bilingual contract** (`bilingualContract: true`) | 34/year |
| CEA, every other contract (main, fixed — incl. C. Reen's fixed line) | 32/year |
| CES (`ces`) | 34/year |
| Dispatcher | 22 + 1 lieu per BH worked (`countDispatcherBankHolidaysWorked`) — a joining year's `proRatedAL` replaces the **22**, never the total |
| anything else, or an unresolved member | **`null`** — no entitlement on record (v22.45). It used to fall through to a CEA's 32, handing a Management row (or any role added later) a complete, plausible figure belonging to somebody else. Not reachable today — every Management row carries `hidden: true`, so no picker offers one — which is why it is a guard rather than a fix. **Callers must TEST for null and refuse to render**: `null - taken - booked` is a NUMBER, not NaN, so the arithmetic that looks harmless is the one that invents a balance. All four call sites do (`alPosition`, the Admin banner + week-grid cap, `admin-al.js`'s booking cap, the calendar AL lightbox, which falls back to its existing em-dash state) |

### Roster cycles

| Type | Weeks |
|------|-------|
| main | 20 |
| bilingual | 8 |
| fixed | 1 per member, no rotation — `currentWeek` selects which fixed pattern in `fixedRoster` (1 = C. Reen 12:00–19:00; 2 = the Mon–Fri 09:00–16:00 line, 35 hours: S. Boyle, plus anyone temporarily off a rotating link — K. Jedlinski before Jun 2026, B. Toth's three training weeks, and S. Faure's maternity row from Jun 2026). **A pattern is SHARED, so editing one member's hours here edits everyone on that line.** |
| ces | 10 |
| dispatcher | 10 |

### Firestore collections

**Moved to `docs/DATA_MODEL.md`** (2 Sep 2026) — every collection's fields, meanings, access summary and
retention, in full. It was 14% of this file and nothing here enforced it; a session working on one
feature was paying for the schema of every other. `firestore.rules` remains the authority on access;
`docs/DATA_MODEL.md` says what the fields mean.

Override cache key: `"memberName|YYYY-MM-DD"`

## Key rules

- **Offline first** — Firestore is an enhancement. Every Firestore call needs a silent fallback. Never block rendering waiting for Firestore.
- **Mobile is primary — TWO platforms, served EQUALLY** (owner, 8 Sep 2026). Test every change at
  375px, on both engines. **This line has now been wrong twice in one day, in opposite directions**
  — it said "all staff use Android phones", was corrected to "the installed app is mainly iPhone",
  and neither was right. The lesson is the one to keep: **who runs what is an OWNER FACT. Do not
  infer it from a screenshot, a bug report or one device.**
  - **Android and iOS are both first class. Neither is the default and neither is the edge case.**
    The owner's own phone is Android (Galaxy S26) and the personal-phone population is mixed, so
    there is no majority path to design toward.
  - **The work phone is Android, and getting the app INSTALLED on it is the GOAL.** The company does
    not permit the install today, so on the device staff carry on shift there is no home-screen
    icon, no standalone window, and nothing that only an installed PWA gets — a feature that assumes
    the install is invisible to somebody at work. Treat that as a **current restriction with a
    direction of travel**, not a permanent property: the Android install path
    (`beforeinstallprompt`) is as load-bearing as the iOS one, not a fallback behind it.
  - **The iOS hazards stay defended — they are PLATFORM FACTS, not a claim about numbers.** Web Push
    exists only inside an installed PWA, there is no system Back, `localStorage` throws in private
    mode, ITP evicts, and Safari fires neither `beforeprint` for AirPrint nor `transitionend` on a
    backgrounded tab. `install-prompt.js` and `notif.js` already branch correctly for both engines;
    that code was right through both wrong versions of this line.
  **One consequence, already decided.** Chromium gates every deploy and WebKit does not
  (`npm run test:webkit` is branch CI only) — an unequal gate under equal service, weighed and left
  as it is (owner, 8 Sep 2026; DECISIONS.md, with the trigger that would reopen it). **Weigh a
  WebKit failure on a branch accordingly**: it is the only lane that sees Safari before release.
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
- **"account recovery"** is now the term for what a saved work email is FOR (v22.37, owner decision — this row previously banned the word "recovery" outright and mandated "self-service password reset (in a future update)"). The old phrasing was accurate and read like a product roadmap; the replacement separates the two questions a member actually has. **Why you are giving us this:** "Save your Chiltern work email for account recovery." **What works today:** "Self-service recovery isn't available yet. For now, ask the admin if you forget your password." Still never "coming soon". The future email route is PASSWORD_DESIGN.md Stage 4. **Note (v18.63):** a password *reset* now exists **today** via the admin (Operations → Account status → Reset) and staff can set their own password (Settings → Password), so do NOT say a password reset is flatly "not available" — only the *email self-service* route is future. Present-day recovery copy is "To reset a password today, contact the admin."
- **App name "Marylebone Roster"** — the on-screen name everywhere (incl. bug-report `appLabel` as "Marylebone Roster — <Page>"). **Never "MYB" for the APP or one of its tools** — not "MYB Roster", not "MYB Pay Calculator", not "MYB member". As the app name it survives only in the iOS home-screen `apple-mobile-web-app-title` meta and in comments.
  **But MYB as the STATION CODE is correct and stays** (v20.13 — this rule said "MYB … survives only in the iOS meta and comments" full stop, which is wrong and would send the next person to "fix" the guide mastheads). `MYB` is Marylebone's three-letter code, staff use it daily, and the guides carry "Chiltern Railways · MYB Station" and "Typical MYB — Network-area journeys" correctly. The test is what the letters NAME: the station, fine; the software, never. Enforced by app-name-parity.test.mjs.
- **Documents:** "Daily Huddle" (proper noun), "Weekly Retail Circular", "Marylebone Newsletter".
- **Never name an internal document in staff-facing copy** (v20.70). The Overtime phase line said "the draft roster has been planned" — date-accurate, and still read as untrue, because the draft is the roster office's own artefact and "the roster" to staff means the one released on the Thursday. Describe the reader's own position instead. The **reviewer's** surfaces and OPERATIONS_REFERENCE may name it freely; it is their document. Pinned by `overtime-format.test.mjs`.
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
  hiding, grouping or shortening it. This nearly went wrong once: ROADMAP.md → "More pay tools —
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

Daily Huddle PDF/DOCX → Power Automate → `ingestHuddle` → Firebase Storage + Firestore `huddles` collection + push notification. The upload button is labelled **"Choose file"** (not "Choose PDF") — intentional, Huddles can be PDF or DOCX.

Full flow diagram, request format, gotchas, and Security Rules: **see `OPERATIONS_REFERENCE.md`**.

**Push notification design language:** all Web Push payloads (Huddle, Pay, and future Circular/Newsletter) must follow `.claude/rules/notifications.md` — leading emoji = the feature's in-app icon, "Latest X" for document arrivals, calm/no-exclamation tone, monochrome badge, and a single `buildPushPayload` builder. Never hand-write a payload literal.

---

## Weekly Roster Upload

Admin uploads PDF → `parseRosterPDF` (model in `functions/index.js` `CLAUDE_MODEL` — currently `claude-sonnet-5`) → JSON → review UI → Firestore. Works for CEA/Bilingual, CES, and Dispatcher rosters.

**Critical:** `RDW|HH:MM-HH:MM` pipe encoding — AI returns `"RDW HH:MM-HH:MM"`, normalised to pipe in review, stripped to plain time on save. Do not strip `RDW` from the AI return value.

**`source: 'roster_import'`** on all roster-upload overrides — used by `computeCellStates()` for COVERED/DIFF/CONFLICT classification.

**An unreadable cell can be ANSWERED IN THE REVIEW (v22.17).** It used to be a dead end: the row said "check the paper roster" and the only way to act was to finish the review, leave for the Admin page, and remember the person and the day. v22.16 briefly made it worse by routing every unmarked Sunday time into the same state; that rule went at v22.19 (false premise), but the control it prompted is a keeper — the real Supervisor roster contains `SEE NATHAN` and `See CEM`, which no parser will ever read as a shift. The row now offers type pills — generated from `PILL_TYPES`, so this control and Change a Shift cannot drift — plus 24-hour `HH:MM` boxes for Shift/RDW. The composed value goes through `manualCellValue` (override-utils.js) and then the SAME `normaliseCellValue` guards as any parsed value, so entering a value is never a route to write something the parsed path would have refused. Sunday exclusions are read from `isForbiddenOnSunday`, not restated. **`other` is deliberately unsupported** — its grammar needs the week editor's flavour chips — and the control says so rather than offering a pill that does nothing.

**`UNKNOWN|<raw>` sentinel (v15.30):** a non-empty cell `normaliseShift` can't parse is NOT defaulted to `RD` (which, when the base is also RD, silently dropped a real shift as a MATCH). It returns `UNKNOWN|<raw>`; `computeCellStates` maps it to an **UNREADABLE** review row. Since **v19.32** that row is no longer skip-ONLY: where the server sent two candidate readings (`choices`) and they survive normalisation as genuinely different values, the row offers them as a CONFLICT-style pick plus a **Skip** button, and a picked value IS written. Unpicked is still the default and still writes nothing, so a row left alone behaves exactly as it did before. Empty/blank cells still → `RD`.

**Day-drift defence (v16.68) — three layers; a one-day shift can no longer be silently written.** The only entry point for a shifted row is the AI's visual ROW read (date assignment is deterministic: day-name keys → server dates). Layers: (1) `applySundayScanCorrections` — the original Sunday-anchored Case A/B repair; (2) **`applyColumnScanCrossCheck`** (`functions/roster-parse-helpers.js`) — the prompt now demands a second, column-by-column read (`columnScan`, generalising `sundayScan` to all 7 columns) and every cell is cross-checked row-vs-column: agreement → keep; a disagreement that realigns exactly under a one-day SUFFIX shift anchored at the first disagreeing day (a dropped blank shifts only the tail after it) with ≥2 disagreements and ≥5 signalled days → deterministic repair (two-source consensus); a **Rest ↔ Absence** disagreement (one read is `SICK` — a positive OD/HA/SC/ML absence code; **SN is not one**, it is sickness on a day not booked to work and reads as RD — the other a rest day, and not a Sunday) → **records the absence** (`SICK`), because dropping a real absence is the dangerous SILENT failure (the person appears to be working) whereas a false absence is visible + correctable, and an absence code isn't hallucinated on a blank cell; any OTHER disagreement → the cell becomes `UNKNOWN|<app-language readings>? (PDF unclear)` — the skip-only UNREADABLE review state carrying BOTH readings (the readings use staff-facing terms — "Absent", never "sick"). Fails open when `columnScan` is absent. (3) **`detectShiftedRow`** (`roster-alignment.js`, client) — the AI-independent signal: the parsed week is correlated against the member's OWN base roster at offsets −1/0/+1; if a ±1 alignment beats offset 0 by ≥3 matches (and scores ≥5/7), the row is suspect.

**THE THREE "LAYERS" ARE NOT THREE WITNESSES, AND v22.16 STOPPED PRETENDING THEY WERE.** Layers 1 and 2 both come from ONE model call looking at ONE PDF — so when it visually collapses the blank Sunday cell and repeats that positional mistake across the row read, `sundayScan` AND `columnScan`, every server-side check agrees with the wrong answer and a whole week is written onto the wrong days. Nothing errors. Reproduced, and pinned by the "consistently shifted read" block in `roster-parse-helpers.test.mjs`. Layer 3 is the only genuinely independent evidence, and it was **warn-only above a fully-ticked list** — so the default action on a misread week was to save it. Now:

- **A suspect member's rows start UNTICKED** (`computeCellStates` owns the decision, so the save path inherits it).
- **`assessRosterAlignment` refuses the WHOLE read** when `ALIGNMENT_BLOCK_THRESHOLD` (3) members drift the same DIRECTION — a batch signature is a parser failure, not several people changing their week at once. No per-row override and no "save anyway": ticks are inert, conflict choices are inert, the Save button is removed, and the save loop skips every blocked cell.
- ~~An unmarked plain-time Sunday is never promoted to RDW~~ — **REMOVED at v22.19, premise disproved.** It assumed a genuinely worked Sunday carries an RDW marker on the paper roster. Three real rosters say otherwise: **21 worked Sundays across the CEA, Supervisor and Dispatch sheets, not one marked, while all 10 RDW markers sit on Mon–Sat.** RDW means *a rest day being worked*; Sunday is uncontracted, so its work is inherently overtime and the sheet never labels it. The rule would have sent all 21 to review — and, worse, it **fed the client's own circuit breaker an UNKNOWN exactly where the strongest drift evidence was**: on a left-shifted row the Sunday cell holds Monday's real value, which matches the base roster at +1. Measured over the whole roster, blinding it loses 2 of 14 detections, and the batch threshold is 3.
- **A blank cell is an answer on SUNDAY and a question everywhere else** (v22.19, replacing the flat "missing key → RD"). Mon–Sat unworked days are stated explicitly on every roster type — `RD`, `AL`, `SC`, `SN`, `OD`, `HA`, `ML`, `NA` — so a blank there is not a rest day, it is a cell nobody read. Measured over 50 member rows: 24 blank Sundays, and 5 blank Mon–Sat cells, all five belonging to ONE person who appears on a second roster and works only its Saturday — a case that wants an admin rather than a default, since writing RD across their Mon–Fri would overwrite what their primary roster's import had just written. The rule is applied at BOTH sites in `buildSafeEntries` (a day whose header the model never listed, and a header listed with nothing in it); it was `'RD'` at both, so fixing one would have fixed nothing.
- **The review offers the original PDF**, because every message above ends in "check it against the PDF" and the file had left the workflow at parse time.

**The strong witness is now IN the pipeline (v22.31, `functions/roster-geometry.js` — ROADMAP "Roster import" phase 1).** The roster's table rules are DRAWN in the PDF, at nine fixed x positions on every content page of every roster type measured, and assigning each text run by coordinate places every cell — on the row that drifts, not one text object sits in the Sunday column. `parseRosterPDF` reads that grid in parallel with the model call and applies it as the FINAL gate, after the column cross-check and the Sunday corrections: **an AI day landing in a physically EMPTY cell is refused, not weighed** — the cell becomes UNREADABLE and the row comes back as `geometryRefused`, which `roster-alignment.js` treats exactly like a base-roster drift (unticked; three trip the breaker). Zero false refusals on the corpus. It fails open everywhere and says so (`geometry.status`), and it cannot see a fully occupied week or an `RD` in an occupied cell — those are phases 2 and 3, and KNOWN_LIMITATIONS says so. `pdfjs-dist@4.10.38` is now a dependency of `functions/` (server-side; the fourth vetted library — the owner's call to keep, and one line to remove).

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

**Removing a staff member:** invoke `/leaver` — the ordered checklist, including the step everybody gets wrong (**upload their final roster PDF FIRST**: `hidden` also drops them from the AI-parsing name list, and a later upload then reports their row as `missingMembers`, which reads exactly like a genuine absence) and the verification step that closes it (the Staff Login Accounts audit, v22.53 — every other failure in the sequence is silent). The reasoning, and what it deliberately does not do (Overtime weeks are frozen; their data stays), is OPERATIONS_REFERENCE.md → "Removing a staff member"; the skill routes there rather than restating it.

Email/password convention: **see `OPERATIONS_REFERENCE.md`**.

---

## Pay calculator — current reality (v8.21+)

Manual-entry. **Current 2026/27 rates (3.6% RMT award, applied automatically from the 28 Aug 2026 payslip — deferred from 31 Jul, informed Jul 2026): CEA £21.49/hr · CES £22.60/hr · London Allowance £286.10.** Periods paid BEFORE 28 Aug 2026 stay on the 2025/26 rates (CEA £20.74 · CES £21.81 · London £276.16) — the mid-year step is applied automatically by `getRateForPeriod` + `getLondonAllowanceForPeriod` (keyed on the year's `londonAllowFrom`), so historic payslips still match. The **arrears** owed from 1 Apr 2026 up to that payslip stay the **opt-in** back-pay lump (the include tick), not auto-added. Both grades 140hrs/period · pension **£151.86** (from the 28 Aug 2026 payslip — **a pay award moves the pension too**, which `PENSION_STEPS` had not anticipated; the earlier per-era defaults, £147.36 back to £160.78, are in that table in `paycalc-calc.js`). Update `GRADES`/`AWARD_RATES`/`TAX_YEARS` in `paycalc-calc.js` when the next award is announced. Roster-assist pre-fills Sat/Sun/BH/RDW; standard weekday hours not pre-filled. Full detail (rates, state management, layout, payroll rules) in `.claude/rules/paycalc.md`.

**Example payslips for testing:** `MILLER_ACTUALS` in `test-fixtures/miller-actuals.js` (moved out of the served `roster-data.js` at v14.68 for privacy — excluded from Firebase Hosting, though NOT from the GitHub Pages mirror, which serves the repo root: see AUTH_ARCHITECTURE.md → MILLER_ACTUALS; the SERVED "Actual Take-Home" comparison — which read `MILLER_ACTUALS` from the then-served `roster-data.js` — was removed in the same change; a **device-local** actuals overlay remains developer-only: `paycalc-app.js` reads `readPayslipActuals()` from localStorage, gated to `G. Miller`, data imported per-device and never served) contains 13 real payslip records from G. Miller's 2025/26 tax year (the 13 four-weekly periods, printed P4–P52 on the payslip) with actual gross, tax, NI, net, and varPay values. `paycalc.test.mjs` imports the fixture to verify tax and NI computations stay within payslip tolerance. When making changes to pay maths (tax, NI, thresholds, variable pay), run the payslip integration tests in `paycalc.test.mjs` and check that existing assertions still hold. Use `paycalc-hpp.test.mjs` for `_varPayForPeriod` regression tests.

---

## Guide pages (railcard, FIP, guide shell)

The guide pages (`staff-guide.html`, `paycalc-guide.html`, `railcard-guide.html`, `fip-guide.html`, `rangers-guide.html` — the fifth, added v20.05, which this line still called "four" until v20.32) share `guide-shell.css` (sticky header, back/PDF buttons, print rules, brand palette tokens). Each has its own CSS file. No `shared.css` import. No inline scripts or `onclick` (CSP blocks them). Full design principles, factual accuracy notes, and shell spec in `.claude/rules/guide-pages.md`.
