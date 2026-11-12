# Marylebone Roster

A staff roster app for Chiltern Railways' Marylebone station: shifts, annual leave, overtime
availability (built, and paused for now), a pay estimator, and the daily operational documents. It is an offline-first
Progressive Web App — **vanilla JavaScript with no framework and no build step** — served as static
files, with Firebase (Auth, Firestore, Storage, Cloud Functions) behind it.

There is no `dist/`, no bundler and no transpile step: what is in the repository is what runs in the
browser. That is a deliberate trade, and the conditions under which it would be revisited are
written down in `CLAUDE.md` → "When a build step earns its keep".

## Reviewing this repository without installing anything

**The test suite runs on nothing but a Node binary.** From a bare checkout or an unzipped archive,
with no `node_modules` anywhere:

```
npm test                        # the default suite: hygiene + parse + unit
node scripts/test-nodeps.mjs    # every suite that needs no install, and it prints how many
```

Both print their own totals, so this page does not restate a number that would go stale. The second
command also names the suites it is skipping and why. Neither needs npm to have installed anything;
`node scripts/test-nodeps.mjs` does not need npm at all.

This is worth saying plainly because external reviewers have repeatedly reported the estate as
unverified after an install failed in their sandbox. Almost none of it depends on an install.

### What genuinely needs an install, and what each lane buys

| Lane | Command | Needs |
|---|---|---|
| Cloud Functions handlers | `npm run test:functions` | `cd functions && npm ci` — these `require()` the real Firebase Admin SDK, and the roster-geometry suite drives the real PDF parser |
| Security rules | `npm run test:rules` | the Firebase emulator binary, plus a root `npm ci` |
| Lint, typecheck, browser tests | `npm run lint` · `npm run typecheck` · `npm run test:e2e` | a root `npm ci` |
| Signed-in browser journeys | `npm run test:signed-in` | Java 21 for the Firestore emulator, a root `npm ci`, `cd functions && npm ci`, and Playwright's Chromium and WebKit |

With a root install, `npm run check` is the full pre-push gate: lint, typecheck, then `npm test`.

### Do not substitute `npx tsc`

`npm run typecheck` runs the TypeScript version this project pins, against `jsconfig.json`. If that
compiler is not installed the command now **refuses and says so** rather than reaching for `npx`.

That refusal replaced a fallback, because the fallback was actively misleading: on a tree with no
`node_modules` it resolved an unpinned compiler and reported missing-module errors for
devDependencies that were never installed. Those look like application defects in a report and are
not. A reviewer was right to discount them; the repository should not have produced them.

What the typecheck actually covers — and the two areas `jsconfig.json` deliberately excludes — is
recorded, with the measurements behind that decision, in `typecheck-scope.test.mjs`.

### There are no secrets in this tree

The repository is public and holds no credentials. Deploys authenticate through Workload Identity
Federation rather than a stored key; the Firebase API key is referrer-restricted; the shared
Calendar PIN lives only in Secret Manager. No test can look for the digits themselves (a test that knew
them would be the leak), so `calendar-viewer-parity.test.mjs` checks the shapes a leak would take — a
client file naming the secret, a comparison in the browser, a stored verifier. Keeping the digits out of
the repository is a rule, not a guard.

## The test lanes

What each lane proves, and what it cannot see. `CLAUDE.md` lists the commands; this is the detail
behind them.

- **`npm test`** — `test:hygiene` + `test:parse` + `test:unit`: every root test file except the
  `test:functions` and `test:rules` suites, on a bare checkout with nothing installed (above).
- **`npm run test:nodeps`** (the same as `node scripts/test-nodeps.mjs`) — every suite that needs
  nothing installed. It prints how many suites it runs and which it skips, and its exclusion list is
  DERIVED from the `test:functions` and `test:rules` scripts, so nothing here restates either. It
  gates every branch and pull request as the `nodeps` job in `e2e.yml`, which runs it with NO
  `npm ci` and fails if `node_modules` exists at all — the absence is the test. Before that job
  existed the lane's one claim could only be falsified by the stranger it was written for, and it
  was: a parity suite had started importing through `e2e/helpers.js`, which imports
  `@playwright/test`. A list the no-install suites need now lives in a file that imports nothing
  (`e2e/touch-projects.js`).
- **The `test:payslip-local` script** — the real-payslip regression, which REQUIRES the gitignored
  fixture and FAILS without it. `npm test` skips that regression honestly when the fixture is absent,
  which is right for a public lane and means a green run cannot tell you whether the comparison RAN;
  this one can. Owner's checkout only, by design — run it before any pay-maths release
  (`.claude/rules/paycalc.md` → Example payslips).
- **`npm run test:functions`** — the Cloud Functions handler and roster-parser suites (the list is
  `package.json` → `test:functions`; it needs `functions/node_modules`). It gates every branch and
  pull request as the `functions` job in `e2e.yml`, on Node 24, the runtime `functions/package.json`
  declares. It used to run only when a push to `main` deployed the functions, so a regression could
  not fail a pull request and was caught after the merge with the deploy blocked — and on Node 20, a
  deploy-tool constraint, so the handlers were only ever tested on a version they never run on.
- **`npm run test:rules`** — the Firestore and Storage security rules against the emulator, which
  starts automatically.
- **`npm run test:e2e`** — the smoke suite in real headless Chromium (the dev environment's own
  build only if it matches Playwright's). The axe-core accessibility gate (WCAG A/AA, several states
  per page) runs inside it and is BLOCKING: `playwright.config.mjs` leaves out the csp, visual,
  offline, live and signed-in specs, not axe. **`npm run test:a11y`** runs that gate on its own; the baseline and triage
  are `docs/A11Y_BASELINE.md`.
- **`npm run test:csp`** — the deployed-CSP proof. It serves the app through the Firebase Hosting
  emulator with the real `firebase.json` header applied and asserts that real Chromium refuses
  nothing the app loads: the runtime counterpart to the static `csp-hygiene.test.mjs`. Not part of
  `npm test`; gated in CI as the `csp` job.
- **`npm run test:visual`** — clock-pinned, Firebase-stubbed, fixed-member screenshots of every key
  surface, compared against committed PNGs in `e2e/visual-baselines/`. It locks page composition (the
  accepted desktop voids included) against silent CSS and layout drift. It is sensitive to the
  environment, so it gates nothing: in branch CI it is REPORT-ONLY (`visual` in `e2e.yml`,
  `continue-on-error`) and always uploads its diffs. **That job's conclusion is `success` on a
  drifted lane and a clean one alike**, so the lane reports in two other places: one pull-request
  comment, updated in place and edited back when the drift clears (a workflow annotation on a push
  with no pull request), and its own check run, **`visual baselines`**, which is `neutral` when
  baselines drifted and `success` when they match (`neutral` does not block a merge). **Read
  `visual baselines`, not `visual`.** A drift once went unread for eight releases behind a green job,
  and a later release merged stale baselines that the pull-request comment had named, because the
  session that shipped it read the job conclusions. The baselines are CI's render, and a container's
  differs (`docs/KNOWN_LIMITATIONS.md`), so regenerate them from the pull request's `visual-diffs`
  artifact: unzip it (check its digest) and run `node scripts/refresh-visual-baselines.mjs <folder>`,
  which copies CI's render of each failed screenshot over its baseline. With no folder,
  `npm run test:visual:refresh` redraws the failed ones from this machine's render, which is for
  looking, not committing. Keep
  `-- --update-snapshots=all` for a deliberate sweep of drift inside the tolerance, then run
  `git status e2e/visual-baselines/` and revert anything you cannot explain.
- **`npm run test:visual:webkit`** — the same idea under Safari's engine, as a deliberately small set
  (config `playwright.visual-webkit.mjs`, baselines under `e2e/visual-baselines/webkit/` — a
  different engine's pixels, which will never equal their Chromium twins). Every Chromium baseline is
  Chromium's, so iOS BEHAVIOUR was far better proven than iOS APPEARANCE. **The mobile month grid is
  deliberately left out:** its fractional 390/7 columns are no more stable here than in Chromium, and
  a flaky baseline is worse than none, so the Calendar is represented by the day panel. Report-only
  in branch CI, for the same reason as the Chromium lane. It measured stable on a container (repeat
  runs green, a full regeneration byte-identical), which is why its tolerance is the Chromium lane's
  0.001 and not looser.
- **`npm run test:webkit`** — the smoke suite under Safari's engine: branch CI, not the deploy gate
  (`docs/DECISIONS.md` → WebKit stays out of the deploy gate). **The browser is not in a fresh dev
  container:** `npx playwright install webkit && npx playwright install-deps webkit`. The second step
  is apt, so it needs root; without it the launch dies listing missing shared objects, which reads
  like "unsupported". The standing "do not run playwright install" advice is about CHROMIUM, which IS
  pre-installed — reading it as a blanket ban once left a CSS-adjacent release to meet this engine
  for the first time on CI.
- **`npm run test:signed-in`** — the app's REAL Firebase SDK, signed in, against the Auth, Firestore
  and Functions emulators, under the real security rules and the real Cloud Functions, on both phone
  engines. Every other browser lane stubs the SDK and the rules suite tests the rules on their own, so
  this is the one place the app, the SDK, the rules and the server meet before production: a first
  sign-in and the forced password change, a day of leave saved, reloaded and drawn on the Calendar, a
  colleague's day refused, a manager recording on behalf, a save with no signal, the staff PIN's real
  exchange, and Back after signing out (`e2e/signed-in.spec.js`). `scripts/signed-in.mjs` builds a
  throwaway Firebase project folder in the temp directory — the emulator settings from `firebase.json`,
  a random four-digit PIN, never the real one — and writes nothing into the checkout. Each page keeps
  its own CSP, widened only by the emulators' addresses. **What it cannot see** is what only
  production has: the API key's allowed sites, the rules as DEPLOYED rather than as committed, Web
  Push, the service worker (blocked, so every request reaches the routes) and the Pages mirror. Nor
  a page brought back from the back/forward cache: Playwright launches Chrome with that cache off,
  so Back always loads afresh here. That guard is `page-session.test.mjs` and `e2e/auth.spec.js`,
  which send the restore event themselves.
  Branch CI runs both engines as the `signed-in` job. Since 12 Nov 2026 its Android Chrome half also
  gates the Hosting deploy, on the tree being released (`deploy-hosting.yml`); the iPhone half stays
  out of that gate, as all of WebKit does (`docs/DECISIONS.md` → WebKit stays OUT of the deploy
  gate). Behind a proxy, run `npx firebase setup:emulators:firestore` once first (the script's header
  says why).
- **`npm run test:live`** — the deployment health check in `CLAUDE.md`, run against the real site:
  both origins, the root and two sub-pages, asserting served, splash down, something usable and no
  console errors. Opt-in, and it gates nothing: the network and whatever is deployed right now are not
  properties of the branch under test. Run it after every deploying merge, once both Deploy Firebase
  Hosting and the Pages mirror's deploy that follows it have finished, and in a review. Since 10
  November 2026 the mirror publishes only what that Hosting run released, a minute or two after it.
  **It prints its mode per page.** `DIRECT` is the full check;
  `RELAYED` means the browser could not complete TLS to the open internet, so each request was fetched
  with curl and fulfilled into the page — real bytes, real headers, real parsing, but the API-key
  HTTP-referrer restriction and a live Firebase round trip are NOT covered. Do not read a relayed pass
  as the whole check. It also runs on a schedule (`live-health.yml`, four-hourly on a GitHub runner)
  with `LIVE_REQUIRE_DIRECT=1`, so a run that would have to relay FAILS instead of passing weakly; a
  page still failing when the check looks again a minute later is reported on the `deploy-failure`
  issue thread, and one that has cleared by then is only noted on the run. The hourly
  `production-currency.yml` asks a different question — whether the served version matches `main` —
  which a stuck splash answers "yes" to.
- **`npm run test:offline`** — `e2e/offline.spec.js` under `playwright.offline.mjs`: the service
  worker's offline-first paths with the network cut. Not in `npm test` or any gate; it runs weekly,
  non-blocking, in `offline.yml`.

**Run one Playwright lane at a time, and do not switch branches under one.** The suites share a dev
server and `test-results/`: two concurrent runs once produced a false red, and checking out another
branch mid-run invalidated a long e2e pass that then had to be redone.

**A local browser run tests only this checkout.** Each checkout's dev-server port comes from its path,
and two checkouts can land on the same one, so before the first test a run checks that the server it
found serves this checkout's files, and stops if not (`e2e/server-identity.mjs`).
`E2E_DEV_PORT=<port>` pins this checkout to another port.

## Where to read next

| Document | What it is |
|---|---|
| `docs/ARCHITECTURE.md` | **the index** — which document is authoritative for each subject, and where what is deployed differs from what is documented. Start here |
| `CLAUDE.md` | the working manual: architecture decisions, conventions, change impact (the file catalogue is `docs/FILE_INDEX.md`, the data model `docs/DATA_MODEL.md`) |
| `docs/AI_MAP.md` | every module and its exports |
| `docs/OPERATIONS_REFERENCE.md` | how the app is run day to day |
| `docs/KNOWN_LIMITATIONS.md` | what is wrong or deferred, and why |
| `docs/RECOVERY_RUNBOOK.md` | backup, rollback and incident playbooks |

Feature behaviour is stated as numbered invariants in `docs/CALENDAR_DATA.md`, `docs/AUTH_AND_SESSIONS.md`,
`docs/OVERTIME_AVAILABILITY.md` and the rule files under `.claude/rules/`. Design reasoning lives in each
module's own header, next to the code it constrains, rather than being copied into these documents.
